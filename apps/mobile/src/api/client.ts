/**
 * CRELUNE Mobile — Shared Authenticated API Client
 *
 * Security & Concurrency Guarantees:
 * - Attaches `Authorization: Bearer <accessToken>` strictly via header (never query params).
 * - Coordinates proactive refresh & reactive 401 refresh exclusively through SessionManager's
 *   single-flight `refreshInFlightPromise`.
 * - Tracks each request's sent accessToken + credentialGeneration to prevent stale-token
 *   double refreshes.
 * - Retries any 401 request AT MOST ONCE (`hasRetried = true`) — zero infinite retry loops.
 * - Validates every response through Zod schemas at the client boundary.
 */

import type { DashboardSnapshotResponse } from '@crelune/shared';
import type { z } from 'zod';
import {
  apiErrorBodySchema,
  authMeResponseSchema,
  dashboardSnapshotResponseSchema,
} from '@/api/schemas';
import {
  AuthSessionError,
  SessionManager,
  TemporaryRefreshError,
} from '@/auth/session-manager';

export const DEFAULT_API_TIMEOUT_MS = 15_000;

export type ApiClientErrorKind =
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'VALIDATION'
  | 'CONFLICT'
  | 'RATE_LIMITED'
  | 'SERVER'
  | 'NETWORK'
  | 'TIMEOUT'
  | 'INVALID_RESPONSE';

export class ApiClientError extends Error {
  public readonly kind: ApiClientErrorKind;
  public readonly statusCode?: number;
  public readonly serverCode?: string;

  constructor(
    kind: ApiClientErrorKind,
    message: string,
    options?: { statusCode?: number; serverCode?: string }
  ) {
    super(message);
    this.name = 'ApiClientError';
    this.kind = kind;
    this.statusCode = options?.statusCode;
    this.serverCode = options?.serverCode;
  }
}

export interface ApiRequestOptions<T> {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  schema?: z.ZodType<T>;
  timeoutMs?: number;
  skipProactiveRefresh?: boolean;
}

export interface ApiClientDeps {
  sessionManager: SessionManager;
  getApiBaseUrl: () => string;
  fetchImpl?: typeof fetch;
  defaultTimeoutMs?: number;
}

function isAbortError(err: unknown): boolean {
  return (
    err instanceof Error &&
    (err.name === 'AbortError' || /abort|timeout/i.test(err.message))
  );
}

function mapHttpError(
  status: number,
  body: unknown
): ApiClientError {
  const parsed = apiErrorBodySchema.safeParse(body);
  const serverMessage = parsed.success ? parsed.data.error : undefined;
  const serverCode = parsed.success ? parsed.data.code : undefined;

  if (status === 401) {
    return new ApiClientError(
      'UNAUTHORIZED',
      serverMessage || 'Authentication required.',
      { statusCode: status, serverCode }
    );
  }
  if (status === 403) {
    return new ApiClientError(
      'FORBIDDEN',
      serverMessage || 'You do not have permission to perform this action.',
      { statusCode: status, serverCode }
    );
  }
  if (status === 404) {
    return new ApiClientError(
      'NOT_FOUND',
      serverMessage || 'The requested record was not found.',
      { statusCode: status, serverCode }
    );
  }
  if (status === 409) {
    return new ApiClientError(
      'CONFLICT',
      serverMessage || 'This request conflicts with existing workspace data.',
      { statusCode: status, serverCode }
    );
  }
  if (status === 429) {
    return new ApiClientError(
      'RATE_LIMITED',
      'Too many requests. Please wait a moment and try again.',
      { statusCode: status, serverCode }
    );
  }
  if (status >= 400 && status < 500) {
    return new ApiClientError(
      'VALIDATION',
      serverMessage || 'Please check your input and try again.',
      { statusCode: status, serverCode }
    );
  }
  return new ApiClientError(
    'SERVER',
    'CRELUNE encountered a temporary server error. Please try again.',
    { statusCode: status, serverCode }
  );
}

export class CreluneApiClient {
  private readonly sessionManager: SessionManager;
  private readonly getApiBaseUrl: () => string;
  private readonly fetchImpl: typeof fetch;
  private readonly defaultTimeoutMs: number;

  constructor(deps: ApiClientDeps) {
    this.sessionManager = deps.sessionManager;
    this.getApiBaseUrl = deps.getApiBaseUrl;
    this.fetchImpl = deps.fetchImpl ?? globalThis.fetch.bind(globalThis);
    this.defaultTimeoutMs = deps.defaultTimeoutMs ?? DEFAULT_API_TIMEOUT_MS;
  }

  public async request<T>(
    path: string,
    options: ApiRequestOptions<T> = {}
  ): Promise<T> {
    const method = options.method ?? 'GET';
    const timeoutMs = options.timeoutMs ?? this.defaultTimeoutMs;
    const normalizedPath = path.startsWith('/') ? path : `/${path}`;
    const url = `${this.getApiBaseUrl()}${normalizedPath}`;

    let hasRetriedAfter401 = false;

    while (true) {
      let accessToken: string;
      let credentialGeneration: number;

      if (!hasRetriedAfter401 && !options.skipProactiveRefresh) {
        const creds = await this.sessionManager.ensureFreshCredentials('proactive');
        const snap = this.sessionManager.getAccessTokenSnapshot();
        accessToken = snap?.accessToken ?? creds.accessToken;
        credentialGeneration = snap?.generation ?? this.sessionManager.getSnapshot().generation;
      } else {
        const snap = this.sessionManager.getAccessTokenSnapshot();
        if (!snap) {
          throw new AuthSessionError(
            'UNAUTHENTICATED',
            'Sign in is required to continue.'
          );
        }
        accessToken = snap.accessToken;
        credentialGeneration = snap.generation;
      }

      const headers: Record<string, string> = {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
        'X-Crelune-Client': 'mobile',
      };
      let body: string | undefined;
      if (options.body !== undefined) {
        headers['Content-Type'] = 'application/json';
        body = JSON.stringify(options.body);
      }

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      let response: Response;
      try {
        response = await this.fetchImpl(url, {
          method,
          headers,
          body,
          signal: controller.signal,
        });
      } catch (err) {
        clearTimeout(timer);
        if (isAbortError(err)) {
          throw new ApiClientError(
            'TIMEOUT',
            'Request timed out. Check your connection and retry.'
          );
        }
        throw new ApiClientError(
          'NETWORK',
          'Unable to reach CRELUNE. Check your internet connection and retry.'
        );
      } finally {
        clearTimeout(timer);
      }

      if (response.status === 401) {
        if (!hasRetriedAfter401) {
          hasRetriedAfter401 = true;
          // Passes exact token + generation used by this request (Requirement B)
          // and awaits single-flight refresh (Requirements A & C)
          await this.sessionManager.handleUnauthorized(
            accessToken,
            credentialGeneration
          );
          continue;
        }

        // Single retry already exhausted — NEVER loop!
        const errorJson = await response.json().catch(() => ({}));
        throw mapHttpError(401, errorJson);
      }

      const responseJson = await response.json().catch(() => null);
      if (!response.ok) {
        throw mapHttpError(response.status, responseJson);
      }

      if (options.schema) {
        const validated = options.schema.safeParse(responseJson);
        if (!validated.success) {
          throw new ApiClientError(
            'INVALID_RESPONSE',
            'CRELUNE returned an unexpected data format. Please update or retry.'
          );
        }
        return validated.data;
      }

      return responseJson as T;
    }
  }

  public fetchDashboardSnapshot(): Promise<DashboardSnapshotResponse> {
    return this.request<DashboardSnapshotResponse>('/api/dashboard', {
      method: 'GET',
      schema: dashboardSnapshotResponseSchema,
    });
  }

  public fetchCurrentOwner() {
    return this.request('/api/auth/me', {
      method: 'GET',
      schema: authMeResponseSchema,
    });
  }
}

export function isRetryableQueryError(error: unknown): boolean {
  if (error instanceof AuthSessionError) return false;
  if (error instanceof TemporaryRefreshError) return false;
  if (error instanceof ApiClientError) {
    return (
      error.kind === 'NETWORK' ||
      error.kind === 'TIMEOUT' ||
      error.kind === 'SERVER'
    );
  }
  return false;
}
