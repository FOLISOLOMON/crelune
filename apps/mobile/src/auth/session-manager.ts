/**
 * CRELUNE Mobile — Authoritative Session Manager & Single-Flight Refresh Coordinator
 *
 * Non-Negotiable Concurrency & Recovery Guarantees (Stage 6.2):
 * A. Single-flight refresh: ONE application-wide `refreshInFlightPromise` shared across
 *    proactive pre-expiry refreshes, reactive 401 handling, foreground resume, and React Query.
 * B. Stale access-token protection: compares each failed request's token/generation against
 *    the active credential state so already-refreshed sessions retry directly without a
 *    duplicate refresh rotation.
 * C. Concurrent request handling: all waiters share one refresh promise, retry at most once,
 *    and reject cleanly on refresh failure or mid-flight logout.
 * D. SecureStore persistence ordering: newly rotated access + refresh tokens MUST persist to
 *    SecureStore BEFORE mutating active in-memory state, resolving `refreshInFlightPromise`,
 *    or releasing waiting API requests. Persistence failures fail closed and clear auth state.
 * E. Failure recovery: strictly separates terminal authentication failures (SESSION_EXPIRED,
 *    DEVICE_REVOKED, REFRESH_TOKEN_REUSE_DETECTED, INVALID_REFRESH_TOKEN -> clear SecureStore,
 *    clear query/read + private image caches, single-shot redirect to login with clear notice)
 *    from temporary network/timeout/offline/5xx failures (preserve credentials, do not sign out,
 *    surface retry state). Explicitly handles lost refresh responses via server replay detection.
 */

import {
  mobileLoginSchema,
  type MobileDeviceMetadataInput,
  type MobileLoginInput,
} from '@crelune/shared';
import {
  apiErrorBodySchema,
  mobileAuthSessionResponseSchema,
} from '@/api/schemas';
import type {
  CredentialStorageAdapter,
  StoredMobileCredentials,
} from '@/auth/secure-store';

export const PROACTIVE_REFRESH_BUFFER_MS = 60_000; // Refresh within 60s of 15m expiry
export const AUTH_REQUEST_TIMEOUT_MS = 15_000;

export const TERMINAL_AUTH_ERROR_CODES = [
  'SESSION_EXPIRED',
  'DEVICE_REVOKED',
  'REFRESH_TOKEN_REUSE_DETECTED',
  'INVALID_REFRESH_TOKEN',
] as const;

export type TerminalAuthErrorCode = (typeof TERMINAL_AUTH_ERROR_CODES)[number];

export type AuthErrorCode =
  | TerminalAuthErrorCode
  | 'INVALID_CREDENTIALS'
  | 'TOO_MANY_REQUESTS'
  | 'STORAGE_PERSISTENCE_FAILED'
  | 'UNAUTHENTICATED'
  | 'LOGGED_OUT';

export type TemporaryErrorCode =
  | 'NETWORK_ERROR'
  | 'TIMEOUT'
  | 'SERVER_UNAVAILABLE';

export class AuthSessionError extends Error {
  public readonly code: AuthErrorCode;
  public readonly isTerminal: boolean;

  constructor(code: AuthErrorCode, message: string, isTerminal = true) {
    super(message);
    this.name = 'AuthSessionError';
    this.code = code;
    this.isTerminal = isTerminal;
  }
}

export class TemporaryRefreshError extends Error {
  public readonly code: TemporaryErrorCode;
  public readonly statusCode?: number;

  constructor(code: TemporaryErrorCode, message: string, statusCode?: number) {
    super(message);
    this.name = 'TemporaryRefreshError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

export type SessionStatus = 'hydrating' | 'authenticated' | 'unauthenticated';

export interface SessionSnapshot {
  status: SessionStatus;
  credentials: StoredMobileCredentials | null;
  generation: number;
  notice: string | null;
}

export interface AccessTokenSnapshot {
  accessToken: string;
  generation: number;
  expiresAtMs: number;
}

export type RefreshTrigger =
  | 'proactive'
  | 'reactive_401'
  | 'foreground'
  | 'query_retry';

export type SessionListener = (snapshot: SessionSnapshot) => void;

export interface SessionManagerDeps {
  storage: CredentialStorageAdapter;
  getApiBaseUrl: () => string;
  buildDeviceMetadata: (deviceInstallId: string) => MobileDeviceMetadataInput;
  fetchImpl?: typeof fetch;
  now?: () => number;
  onClearProtectedCaches?: () => Promise<void> | void;
  onTerminalSessionEnded?: (notice: string, code: AuthErrorCode) => void;
  requestTimeoutMs?: number;
}

export function isTerminalAuthCode(code: string | undefined): code is TerminalAuthErrorCode {
  return (
    typeof code === 'string' &&
    (TERMINAL_AUTH_ERROR_CODES as readonly string[]).includes(code)
  );
}

export function formatTerminalSessionNotice(code: AuthErrorCode): string {
  switch (code) {
    case 'DEVICE_REVOKED':
      return 'This device was revoked from CRELUNE Settings. Sign in again to reconnect.';
    case 'REFRESH_TOKEN_REUSE_DETECTED':
      return 'Your session was closed for security after an interrupted or duplicate refresh. Please sign in again.';
    case 'SESSION_EXPIRED':
      return 'Your session expired. Please sign in again.';
    case 'STORAGE_PERSISTENCE_FAILED':
      return 'Unable to securely save your updated session on this device. Please sign in again.';
    case 'INVALID_REFRESH_TOKEN':
    default:
      return 'Your session is no longer valid. Please sign in again.';
  }
}

function isAbortError(err: unknown): boolean {
  return (
    err instanceof Error &&
    (err.name === 'AbortError' || /abort|timeout/i.test(err.message))
  );
}

async function fetchWithTimeout(
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit,
  timeoutMs: number,
  externalController?: AbortController
): Promise<Response> {
  const controller = externalController ?? new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export class SessionManager {
  private readonly storage: CredentialStorageAdapter;
  private readonly getApiBaseUrl: () => string;
  private readonly buildDeviceMetadata: (
    deviceInstallId: string
  ) => MobileDeviceMetadataInput;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private readonly requestTimeoutMs: number;
  private onClearProtectedCaches: () => Promise<void> | void;
  private onTerminalSessionEnded?: (notice: string, code: AuthErrorCode) => void;

  private status: SessionStatus = 'hydrating';
  private activeCredentials: StoredMobileCredentials | null = null;
  private credentialGeneration = 0;
  private logoutGeneration = 0;
  private notice: string | null = null;
  private refreshInFlightPromise: Promise<StoredMobileCredentials> | null = null;
  private refreshAbortController: AbortController | null = null;
  private terminalCleanupInFlight: Promise<void> | null = null;
  private listeners = new Set<SessionListener>();

  constructor(deps: SessionManagerDeps) {
    this.storage = deps.storage;
    this.getApiBaseUrl = deps.getApiBaseUrl;
    this.buildDeviceMetadata = deps.buildDeviceMetadata;
    this.fetchImpl = deps.fetchImpl ?? globalThis.fetch.bind(globalThis);
    this.now = deps.now ?? (() => Date.now());
    this.requestTimeoutMs = deps.requestTimeoutMs ?? AUTH_REQUEST_TIMEOUT_MS;
    this.onClearProtectedCaches = deps.onClearProtectedCaches ?? (() => undefined);
    this.onTerminalSessionEnded = deps.onTerminalSessionEnded;
  }

  public setLifecycleHooks(hooks: {
    onClearProtectedCaches?: () => Promise<void> | void;
    onTerminalSessionEnded?: (notice: string, code: AuthErrorCode) => void;
  }): void {
    if (hooks.onClearProtectedCaches) {
      this.onClearProtectedCaches = hooks.onClearProtectedCaches;
    }
    if (hooks.onTerminalSessionEnded) {
      this.onTerminalSessionEnded = hooks.onTerminalSessionEnded;
    }
  }

  public getSnapshot(): SessionSnapshot {
    return {
      status: this.status,
      credentials: this.activeCredentials,
      generation: this.credentialGeneration,
      notice: this.notice,
    };
  }

  public getAccessTokenSnapshot(): AccessTokenSnapshot | null {
    if (!this.activeCredentials || this.status !== 'authenticated') {
      return null;
    }
    const expiresAtMs = Date.parse(this.activeCredentials.accessTokenExpiresAt);
    return {
      accessToken: this.activeCredentials.accessToken,
      generation: this.credentialGeneration,
      expiresAtMs: Number.isFinite(expiresAtMs) ? expiresAtMs : 0,
    };
  }

  public isRefreshInFlight(): boolean {
    return this.refreshInFlightPromise !== null;
  }

  public subscribe(listener: SessionListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(): void {
    const snapshot = this.getSnapshot();
    for (const listener of this.listeners) {
      listener(snapshot);
    }
  }

  public clearNotice(): void {
    if (this.notice !== null) {
      this.notice = null;
      this.emit();
    }
  }

  /**
   * Hydrates credentials from SecureStore on cold launch.
   * Never assumes a stored token guarantees live server authorization —
   * subsequent API calls or foreground checks validate authoritatively.
   */
  public async hydrate(): Promise<SessionSnapshot> {
    const stored = await this.storage.loadCredentials();
    if (!stored) {
      this.activeCredentials = null;
      this.status = 'unauthenticated';
      this.emit();
      return this.getSnapshot();
    }

    const refreshExpMs = Date.parse(stored.refreshTokenExpiresAt);
    if (!Number.isFinite(refreshExpMs) || refreshExpMs <= this.now()) {
      await this.handleTerminalAuthFailure(
        'SESSION_EXPIRED',
        formatTerminalSessionNotice('SESSION_EXPIRED')
      );
      return this.getSnapshot();
    }

    this.activeCredentials = stored;
    this.credentialGeneration += 1;
    this.status = 'authenticated';
    this.notice = null;
    this.emit();
    return this.getSnapshot();
  }

  /**
   * Authenticates the owner via POST /api/mobile/auth/login and persists
   * credentials to SecureStore before entering the authenticated shell.
   */
  public async login(email: string, password: string): Promise<StoredMobileCredentials> {
    const deviceInstallId = await this.storage.getOrCreateDeviceInstallId();
    const payload: MobileLoginInput = {
      email: email.trim().toLowerCase(),
      password,
      device: this.buildDeviceMetadata(deviceInstallId),
    };

    const validatedInput = mobileLoginSchema.safeParse(payload);
    if (!validatedInput.success) {
      throw new AuthSessionError(
        'INVALID_CREDENTIALS',
        'Please enter a valid email address and password.',
        false
      );
    }

    const baseUrl = this.getApiBaseUrl();
    let response: Response;
    try {
      response = await fetchWithTimeout(
        this.fetchImpl,
        `${baseUrl}/api/mobile/auth/login`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            'X-Crelune-Client': 'mobile',
          },
          body: JSON.stringify(validatedInput.data),
        },
        this.requestTimeoutMs
      );
    } catch (err) {
      if (isAbortError(err)) {
        throw new TemporaryRefreshError(
          'TIMEOUT',
          'Sign-in timed out. Check your connection and try again.'
        );
      }
      throw new TemporaryRefreshError(
        'NETWORK_ERROR',
        'Unable to reach CRELUNE. Check your internet connection and try again.'
      );
    }

    const rawBody = await response.json().catch(() => ({}));
    if (!response.ok) {
      const parsedError = apiErrorBodySchema.safeParse(rawBody);
      const code = parsedError.success ? parsedError.data.code : undefined;
      const msg = parsedError.success ? parsedError.data.error : undefined;

      if (response.status === 429 || code === 'TOO_MANY_REQUESTS') {
        throw new AuthSessionError(
          'TOO_MANY_REQUESTS',
          'Too many sign-in attempts. Please wait a few minutes and try again.',
          false
        );
      }
      if (response.status >= 500) {
        throw new TemporaryRefreshError(
          'SERVER_UNAVAILABLE',
          'CRELUNE server is temporarily unavailable. Please try again shortly.',
          response.status
        );
      }
      throw new AuthSessionError(
        'INVALID_CREDENTIALS',
        msg || 'Invalid email or password.',
        false
      );
    }

    const parsedSession = mobileAuthSessionResponseSchema.safeParse(rawBody);
    if (!parsedSession.success) {
      throw new TemporaryRefreshError(
        'SERVER_UNAVAILABLE',
        'Received an unexpected response from the CRELUNE server.'
      );
    }

    // Persist to SecureStore BEFORE updating active state
    try {
      await this.storage.saveCredentials(parsedSession.data);
    } catch {
      await this.storage.clearCredentials();
      throw new AuthSessionError(
        'STORAGE_PERSISTENCE_FAILED',
        'Unable to save your session securely on this device.',
        false
      );
    }

    this.activeCredentials = parsedSession.data;
    this.credentialGeneration += 1;
    this.status = 'authenticated';
    this.notice = null;
    this.emit();
    return parsedSession.data;
  }

  /**
   * Ensures a fresh access token is available before sending an API call or
   * upon foreground resume. Funnelled through the single-flight mutex.
   */
  public async ensureFreshCredentials(
    trigger: RefreshTrigger = 'proactive'
  ): Promise<StoredMobileCredentials> {
    if (this.refreshInFlightPromise) {
      return this.refreshInFlightPromise;
    }

    const current = this.activeCredentials;
    if (!current || this.status !== 'authenticated') {
      throw new AuthSessionError(
        'UNAUTHENTICATED',
        'Sign in is required to continue.'
      );
    }

    const accessExpMs = Date.parse(current.accessTokenExpiresAt);
    const needsRefresh =
      !Number.isFinite(accessExpMs) ||
      accessExpMs - this.now() <= PROACTIVE_REFRESH_BUFFER_MS;

    if (!needsRefresh) {
      return current;
    }

    return this.performSingleFlightRefresh(trigger);
  }

  /**
   * Handles a reactive HTTP 401 from an authenticated API request.
   *
   * Stale-token protection (Requirement B):
   * If a newer access token or higher credential generation is ALREADY active
   * (e.g., because a proactive/foreground/sibling refresh finished while this
   * request was in flight), returns the active credentials immediately WITHOUT
   * invoking POST /api/mobile/auth/refresh again!
   */
  public async handleUnauthorized(
    failedAccessToken: string,
    failedGeneration: number
  ): Promise<StoredMobileCredentials> {
    if (this.refreshInFlightPromise) {
      return this.refreshInFlightPromise;
    }

    const current = this.activeCredentials;
    if (!current || this.status !== 'authenticated') {
      throw new AuthSessionError(
        'UNAUTHENTICATED',
        'Your session is no longer active. Please sign in again.'
      );
    }

    if (
      current.accessToken !== failedAccessToken ||
      this.credentialGeneration > failedGeneration
    ) {
      return current;
    }

    return this.performSingleFlightRefresh('reactive_401');
  }

  /**
   * Foreground resume hook: checks token freshness through the exact same
   * single-flight refresh mutex without surfacing unhandled promise rejections.
   */
  public async onAppForeground(): Promise<void> {
    if (this.status !== 'authenticated' || !this.activeCredentials) {
      return;
    }
    try {
      await this.ensureFreshCredentials('foreground');
    } catch {
      // Terminal failures have already wiped state & emitted login redirect;
      // temporary network failures preserve credentials for normal retry UI.
    }
  }

  /**
   * Explicit user-initiated logout. Immediately increments `logoutGeneration`
   * so any concurrent in-flight refresh discards its response and rejects waiters.
   */
  public async logout(): Promise<void> {
    const tokenToRevoke = this.activeCredentials?.accessToken ?? null;
    this.logoutGeneration += 1;
    this.credentialGeneration += 1;
    this.activeCredentials = null;
    this.status = 'unauthenticated';
    this.notice = null;

    // Immediately abort any in-flight refresh so waiting requests reject cleanly
    this.refreshAbortController?.abort();
    this.refreshAbortController = null;

    // Best-effort server logout (clears MobileSession family + push token)
    if (tokenToRevoke) {
      try {
        const baseUrl = this.getApiBaseUrl();
        await fetchWithTimeout(
          this.fetchImpl,
          `${baseUrl}/api/mobile/auth/logout`,
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${tokenToRevoke}`,
              Accept: 'application/json',
              'X-Crelune-Client': 'mobile',
            },
          },
          5_000
        );
      } catch {
        // Proceed with local wipe regardless of network availability
      }
    }

    await this.storage.clearCredentials();
    await Promise.resolve(this.onClearProtectedCaches()).catch(() => {});
    this.emit();
  }

  /**
   * Single-flight refresh executor. Guarantees at most ONE POST /api/mobile/auth/refresh
   * request runs at any instant across the entire application.
   */
  private performSingleFlightRefresh(
    _trigger: RefreshTrigger
  ): Promise<StoredMobileCredentials> {
    if (this.refreshInFlightPromise) {
      return this.refreshInFlightPromise;
    }

    const promise = this.executeRefreshInternal().finally(() => {
      if (this.refreshInFlightPromise === promise) {
        this.refreshInFlightPromise = null;
      }
    });

    this.refreshInFlightPromise = promise;
    return promise;
  }

  private async executeRefreshInternal(): Promise<StoredMobileCredentials> {
    const startLogoutGen = this.logoutGeneration;
    const current = this.activeCredentials;

    if (!current || this.status !== 'authenticated') {
      throw new AuthSessionError(
        'UNAUTHENTICATED',
        'Sign in is required to continue.'
      );
    }

    const refreshExpMs = Date.parse(current.refreshTokenExpiresAt);
    if (!Number.isFinite(refreshExpMs) || refreshExpMs <= this.now()) {
      const notice = formatTerminalSessionNotice('SESSION_EXPIRED');
      await this.handleTerminalAuthFailure('SESSION_EXPIRED', notice);
      throw new AuthSessionError('SESSION_EXPIRED', notice);
    }

    const deviceInstallId = await this.storage.getOrCreateDeviceInstallId();
    const baseUrl = this.getApiBaseUrl();

    const abortController = new AbortController();
    this.refreshAbortController = abortController;

    let response: Response;
    try {
      response = await fetchWithTimeout(
        this.fetchImpl,
        `${baseUrl}/api/mobile/auth/refresh`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            'X-Crelune-Client': 'mobile',
          },
          body: JSON.stringify({
            refreshToken: current.refreshToken,
            deviceInstallId,
          }),
        },
        this.requestTimeoutMs,
        abortController
      );
    } catch (err) {
      // Logout occurred while waiting on network -> reject cleanly as LOGGED_OUT
      if (this.logoutGeneration !== startLogoutGen) {
        throw new AuthSessionError(
          'LOGGED_OUT',
          'You have been signed out.'
        );
      }
      // Temporary failure -> preserve credentials, do NOT sign out!
      if (isAbortError(err)) {
        throw new TemporaryRefreshError(
          'TIMEOUT',
          'Session refresh timed out. Check your connection and retry.'
        );
      }
      throw new TemporaryRefreshError(
        'NETWORK_ERROR',
        'Unable to reach CRELUNE while refreshing your session. Your sign-in is preserved while offline.'
      );
    } finally {
      if (this.refreshAbortController === abortController) {
        this.refreshAbortController = null;
      }
    }

    // Check logout immediately after network response returns
    if (this.logoutGeneration !== startLogoutGen) {
      throw new AuthSessionError('LOGGED_OUT', 'You have been signed out.');
    }

    const rawBody = await response.json().catch(() => ({}));

    if (!response.ok) {
      const parsedError = apiErrorBodySchema.safeParse(rawBody);
      const serverCode = parsedError.success ? parsedError.data.code : undefined;

      // Terminal auth failures (401 or explicit terminal code): clear everything & redirect once
      if (response.status === 401 || isTerminalAuthCode(serverCode)) {
        const terminalCode: AuthErrorCode = isTerminalAuthCode(serverCode)
          ? serverCode
          : 'INVALID_REFRESH_TOKEN';
        const notice = formatTerminalSessionNotice(terminalCode);
        await this.handleTerminalAuthFailure(terminalCode, notice);
        throw new AuthSessionError(terminalCode, notice);
      }

      // Temporary server / rate-limit failure (5xx / 429): preserve credentials!
      throw new TemporaryRefreshError(
        'SERVER_UNAVAILABLE',
        'CRELUNE server is temporarily unavailable. Please try again in a moment.',
        response.status
      );
    }

    const parsedSession = mobileAuthSessionResponseSchema.safeParse(rawBody);
    if (!parsedSession.success) {
      // Malformed 200 body -> temporary server error, do not silently corrupt storage
      throw new TemporaryRefreshError(
        'SERVER_UNAVAILABLE',
        'Received an unexpected refresh response from CRELUNE.'
      );
    }

    const nextCredentials = parsedSession.data;

    // Re-check logout BEFORE persisting rotated tokens
    if (this.logoutGeneration !== startLogoutGen) {
      throw new AuthSessionError('LOGGED_OUT', 'You have been signed out.');
    }

    // Requirement D: Persist rotated tokens to SecureStore BEFORE updating active
    // memory state, resolving `refreshInFlightPromise`, or releasing waiting requests!
    try {
      await this.storage.saveCredentials(nextCredentials);
    } catch {
      // FAIL CLOSED: server already rotated old refresh token out; clear inconsistent auth state!
      const notice = formatTerminalSessionNotice('STORAGE_PERSISTENCE_FAILED');
      await this.handleTerminalAuthFailure('STORAGE_PERSISTENCE_FAILED', notice);
      throw new AuthSessionError('STORAGE_PERSISTENCE_FAILED', notice);
    }

    // Re-check logout AFTER async SecureStore write (handles logout racing mid-write)
    if (this.logoutGeneration !== startLogoutGen) {
      await this.storage.clearCredentials();
      throw new AuthSessionError('LOGGED_OUT', 'You have been signed out.');
    }

    // Only now publish rotated credentials to memory & listeners
    this.activeCredentials = nextCredentials;
    this.credentialGeneration += 1;
    this.status = 'authenticated';
    this.notice = null;
    this.emit();

    return nextCredentials;
  }

  /**
   * Idempotent single-shot terminal failure handler:
   * clears SecureStore, clears protected query/read + image caches,
   * updates state to unauthenticated with notice, and triggers login redirect ONCE.
   */
  public async handleTerminalAuthFailure(
    code: AuthErrorCode,
    notice: string
  ): Promise<void> {
    if (this.terminalCleanupInFlight) {
      return this.terminalCleanupInFlight;
    }

    const wasAlreadyUnauthenticatedWithSameNotice =
      this.status === 'unauthenticated' &&
      this.activeCredentials === null &&
      this.notice === notice;

    const cleanup = (async () => {
      this.logoutGeneration += 1;
      this.credentialGeneration += 1;
      this.activeCredentials = null;
      this.status = 'unauthenticated';
      this.notice = notice;

      await this.storage.clearCredentials();
      await Promise.resolve(this.onClearProtectedCaches()).catch(() => {});
      this.emit();

      if (!wasAlreadyUnauthenticatedWithSameNotice) {
        this.onTerminalSessionEnded?.(notice, code);
      }
    })().finally(() => {
      this.terminalCleanupInFlight = null;
    });

    this.terminalCleanupInFlight = cleanup;
    return cleanup;
  }
}
