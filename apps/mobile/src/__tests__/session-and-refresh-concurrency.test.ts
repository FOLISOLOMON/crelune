import { ApiClientError, CreluneApiClient } from '@/api/client';
import {
  SecureStoragePersistenceError,
  type CredentialStorageAdapter,
  type StoredMobileCredentials,
} from '@/auth/secure-store';
import {
  AuthSessionError,
  SessionManager,
  TemporaryRefreshError,
} from '@/auth/session-manager';

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function makeJsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

function makeCredentials(params: {
  accessToken: string;
  refreshToken: string;
  accessExpMs: number;
  refreshExpMs: number;
}): StoredMobileCredentials {
  return {
    accessToken: params.accessToken,
    accessTokenExpiresAt: new Date(params.accessExpMs).toISOString(),
    refreshToken: params.refreshToken,
    refreshTokenExpiresAt: new Date(params.refreshExpMs).toISOString(),
    tokenType: 'Bearer',
    device: {
      id: 'dev_0123456789',
      platform: 'ANDROID',
      deviceName: 'Pixel 9 Pro',
      osVersion: 'Android 16',
      appVersion: '0.1.0',
      hasPushToken: false,
      pushPermissionStatus: null,
      pushEnabled: true,
      status: 'ACTIVE',
      activeSessionCount: 1,
      lastSeenAt: '2026-11-24T04:00:00.000Z',
      revokedAt: null,
      revocationReason: null,
      createdAt: '2026-11-24T04:00:00.000Z',
    },
    user: {
      id: 'usr_0123456789',
      email: 'owner@crelune.test',
      firstName: 'Foli',
      lastName: 'Solomon',
      role: 'OWNER',
      organisationId: 'org_0123456789',
      organisationName: 'CRELUNE Studio',
      timezone: 'Africa/Accra',
    },
  };
}

function createMemoryStorage(initial: StoredMobileCredentials | null = null) {
  let saved: StoredMobileCredentials | null = initial;
  const installId = 'cln_dev_11112222333344445555666677778888';

  const adapter: CredentialStorageAdapter & {
    getSaved: () => StoredMobileCredentials | null;
    saveCredentials: jest.Mock<Promise<void>, [StoredMobileCredentials]>;
    loadCredentials: jest.Mock<Promise<StoredMobileCredentials | null>, []>;
    clearCredentials: jest.Mock<Promise<void>, []>;
    getOrCreateDeviceInstallId: jest.Mock<Promise<string>, []>;
  } = {
    getSaved: () => saved,
    saveCredentials: jest.fn(async (creds: StoredMobileCredentials) => {
      saved = creds;
    }),
    loadCredentials: jest.fn(async () => saved),
    clearCredentials: jest.fn(async () => {
      saved = null;
    }),
    getOrCreateDeviceInstallId: jest.fn(async () => installId),
  };

  return adapter;
}

describe('CRELUNE Mobile — Refresh-Token Concurrency, Persistence Ordering & Failure Recovery', () => {
  const BASE_URL = 'https://api.crelune.test';
  const NOW = Date.parse('2026-11-24T04:00:00.000Z');
  const TOKEN_1 = 'cln_mob_at.payload_v1.sig_v1';
  const TOKEN_2 = 'cln_mob_at.payload_v2.sig_v2';
  const REFRESH_1 = `cln_mob_rt_${'1'.repeat(64)}`;
  const REFRESH_2 = `cln_mob_rt_${'2'.repeat(64)}`;

  const makeDeviceMetadata = (deviceInstallId: string) => ({
    deviceInstallId,
    platform: 'ANDROID' as const,
    deviceName: 'Pixel Emulator',
    osVersion: 'Android 16',
    appVersion: '0.1.0',
  });

  function setupHarness(options: {
    initialCreds?: StoredMobileCredentials | null;
    fetchImpl: jest.Mock;
    now?: () => number;
  }) {
    const storage = createMemoryStorage(options.initialCreds ?? null);
    const onClearProtectedCaches = jest.fn(async () => undefined);
    const onTerminalSessionEnded = jest.fn();

    const sessionManager = new SessionManager({
      storage,
      getApiBaseUrl: () => BASE_URL,
      buildDeviceMetadata: makeDeviceMetadata,
      fetchImpl: options.fetchImpl as unknown as typeof fetch,
      now: options.now ?? (() => NOW),
      onClearProtectedCaches,
      onTerminalSessionEnded,
    });

    const apiClient = new CreluneApiClient({
      sessionManager,
      getApiBaseUrl: () => BASE_URL,
      fetchImpl: options.fetchImpl as unknown as typeof fetch,
    });

    return {
      storage,
      sessionManager,
      apiClient,
      onClearProtectedCaches,
      onTerminalSessionEnded,
    };
  }

  it('authenticates via POST /api/mobile/auth/login, persists credentials, and rejects invalid credentials cleanly', async () => {
    const freshCreds = makeCredentials({
      accessToken: TOKEN_1,
      refreshToken: REFRESH_1,
      accessExpMs: NOW + 15 * 60_000,
      refreshExpMs: NOW + 30 * 86_400_000,
    });

    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(
        makeJsonResponse(401, {
          error: 'Invalid email or password',
          code: 'INVALID_CREDENTIALS',
        })
      )
      .mockResolvedValueOnce(makeJsonResponse(200, freshCreds));

    const { sessionManager, storage } = setupHarness({ fetchImpl: fetchMock });

    await expect(
      sessionManager.login('owner@crelune.test', 'WrongPass123!')
    ).rejects.toMatchObject({
      code: 'INVALID_CREDENTIALS',
    });
    expect(storage.getSaved()).toBeNull();

    const loggedIn = await sessionManager.login('owner@crelune.test', 'ValidPass123!');
    expect(loggedIn.accessToken).toBe(TOKEN_1);
    expect(storage.getSaved()?.refreshToken).toBe(REFRESH_1);
    expect(sessionManager.getSnapshot().status).toBe('authenticated');
  });

  it('shares ONE single-flight refresh across 5 concurrent 401 waiters and retries each request at most once', async () => {
    const initialCreds = makeCredentials({
      accessToken: TOKEN_1,
      refreshToken: REFRESH_1,
      accessExpMs: NOW + 10 * 60_000,
      refreshExpMs: NOW + 30 * 86_400_000,
    });
    const rotatedCreds = makeCredentials({
      accessToken: TOKEN_2,
      refreshToken: REFRESH_2,
      accessExpMs: NOW + 15 * 60_000,
      refreshExpMs: NOW + 30 * 86_400_000,
    });

    const refreshGate = createDeferred<Response>();
    let refreshCalls = 0;

    const fetchMock = jest.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/api/mobile/auth/refresh')) {
        refreshCalls += 1;
        return refreshGate.promise;
      }
      const authHeader = (init?.headers as Record<string, string>)?.Authorization;
      if (authHeader === `Bearer ${TOKEN_1}`) {
        return makeJsonResponse(401, { error: 'Token expired' });
      }
      if (authHeader === `Bearer ${TOKEN_2}`) {
        return makeJsonResponse(200, { ok: true, path: url });
      }
      return makeJsonResponse(401, { error: 'Unexpected token' });
    });

    const { sessionManager, apiClient, storage } = setupHarness({
      initialCreds,
      fetchImpl: fetchMock,
    });
    await sessionManager.hydrate();

    const requests = [
      apiClient.request<{ ok: boolean }>('/api/dashboard'),
      apiClient.request<{ ok: boolean }>('/api/members'),
      apiClient.request<{ ok: boolean }>('/api/birthdays'),
      apiClient.request<{ ok: boolean }>('/api/designs'),
      apiClient.request<{ ok: boolean }>('/api/notifications'),
    ];

    // Wait microtasks until all 5 hit 401 and coalesce on the single refresh call
    await new Promise((r) => setTimeout(r, 20));
    expect(refreshCalls).toBe(1);
    expect(sessionManager.isRefreshInFlight()).toBe(true);

    refreshGate.resolve(makeJsonResponse(200, rotatedCreds));
    const results = await Promise.all(requests);

    expect(results).toHaveLength(5);
    expect(results.every((r) => r.ok)).toBe(true);
    expect(refreshCalls).toBe(1);
    expect(storage.getSaved()?.refreshToken).toBe(REFRESH_2);
  });

  it('prevents duplicate refresh during proactive/foreground refresh vs reactive 401 race AND handles stale-token 401 without rotating again', async () => {
    // Near expiry (30s left < 60s buffer) so proactive/foreground triggers refresh
    const expiringCreds = makeCredentials({
      accessToken: TOKEN_1,
      refreshToken: REFRESH_1,
      accessExpMs: NOW + 30_000,
      refreshExpMs: NOW + 30 * 86_400_000,
    });
    const rotatedCreds = makeCredentials({
      accessToken: TOKEN_2,
      refreshToken: REFRESH_2,
      accessExpMs: NOW + 15 * 60_000,
      refreshExpMs: NOW + 30 * 86_400_000,
    });

    const refreshGate = createDeferred<Response>();
    let refreshCalls = 0;

    const fetchMock = jest.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/api/mobile/auth/refresh')) {
        refreshCalls += 1;
        return refreshGate.promise;
      }
      const authHeader = (init?.headers as Record<string, string>)?.Authorization;
      if (authHeader === `Bearer ${TOKEN_1}`) {
        return makeJsonResponse(401, { error: 'Expired' });
      }
      return makeJsonResponse(200, { ok: true, usedToken: authHeader });
    });

    const { sessionManager, apiClient } = setupHarness({
      initialCreds: expiringCreds,
      fetchImpl: fetchMock,
    });
    await sessionManager.hydrate();
    const initialGen = sessionManager.getSnapshot().generation;

    // 1. Foreground resume + proactive refresh + reactive 401 all race simultaneously
    const foregroundPromise = sessionManager.onAppForeground();
    const reactivePromise = sessionManager.handleUnauthorized(TOKEN_1, initialGen);
    const proactivePromise = sessionManager.ensureFreshCredentials('proactive');

    await new Promise((r) => setTimeout(r, 15));
    expect(refreshCalls).toBe(1);

    refreshGate.resolve(makeJsonResponse(200, rotatedCreds));
    const [, reactiveCreds, proactiveCreds] = await Promise.all([
      foregroundPromise,
      reactivePromise,
      proactivePromise,
    ]);
    expect(reactiveCreds.accessToken).toBe(TOKEN_2);
    expect(proactiveCreds.accessToken).toBe(TOKEN_2);
    expect(refreshCalls).toBe(1);

    // 2. Late stale-token 401 arrives AFTER refresh already completed (sent TOKEN_1 at initialGen)
    const staleResult = await sessionManager.handleUnauthorized(TOKEN_1, initialGen);
    expect(staleResult.accessToken).toBe(TOKEN_2);
    expect(refreshCalls).toBe(1); // MUST NOT call /api/mobile/auth/refresh a second time!

    // 3. Subsequent API call immediately uses TOKEN_2 cleanly
    const res = await apiClient.request<{ ok: boolean; usedToken: string }>('/api/dashboard');
    expect(res.usedToken).toBe(`Bearer ${TOKEN_2}`);
    expect(refreshCalls).toBe(1);
  });

  it('enforces at-most-once retry when a request still receives 401 after refresh (never infinite loops)', async () => {
    const initialCreds = makeCredentials({
      accessToken: TOKEN_1,
      refreshToken: REFRESH_1,
      accessExpMs: NOW + 10 * 60_000,
      refreshExpMs: NOW + 30 * 86_400_000,
    });
    const rotatedCreds = makeCredentials({
      accessToken: TOKEN_2,
      refreshToken: REFRESH_2,
      accessExpMs: NOW + 15 * 60_000,
      refreshExpMs: NOW + 30 * 86_400_000,
    });

    let apiCalls = 0;
    let refreshCalls = 0;

    const fetchMock = jest.fn(async (url: string) => {
      if (url.endsWith('/api/mobile/auth/refresh')) {
        refreshCalls += 1;
        return makeJsonResponse(200, rotatedCreds);
      }
      apiCalls += 1;
      return makeJsonResponse(401, { error: 'Still unauthorized' });
    });

    const { sessionManager, apiClient } = setupHarness({
      initialCreds,
      fetchImpl: fetchMock,
    });
    await sessionManager.hydrate();

    await expect(apiClient.request('/api/dashboard')).rejects.toMatchObject({
      kind: 'UNAUTHORIZED',
      statusCode: 401,
    });

    // Strictly 1 initial attempt + 1 refresh + 1 retry = 2 API calls total
    expect(refreshCalls).toBe(1);
    expect(apiCalls).toBe(2);
  });

  it('persists rotated tokens to SecureStore BEFORE updating active state or releasing waiters, and fails closed if SecureStore write fails', async () => {
    const initialCreds = makeCredentials({
      accessToken: TOKEN_1,
      refreshToken: REFRESH_1,
      accessExpMs: NOW + 10 * 60_000,
      refreshExpMs: NOW + 30 * 86_400_000,
    });
    const rotatedCreds = makeCredentials({
      accessToken: TOKEN_2,
      refreshToken: REFRESH_2,
      accessExpMs: NOW + 15 * 60_000,
      refreshExpMs: NOW + 30 * 86_400_000,
    });

    // Part 1: Strict persist-before-release ordering check
    const events: string[] = [];
    const saveGate = createDeferred<void>();

    const fetchMock = jest.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/api/mobile/auth/refresh')) {
        events.push('refresh_http_ok');
        return makeJsonResponse(200, rotatedCreds);
      }
      const authHeader = (init?.headers as Record<string, string>)?.Authorization;
      if (authHeader === `Bearer ${TOKEN_1}`) {
        return makeJsonResponse(401, { error: 'Expired' });
      }
      events.push('waiter_retried_with_token2');
      return makeJsonResponse(200, { ok: true });
    });

    const { sessionManager, apiClient, storage } = setupHarness({
      initialCreds,
      fetchImpl: fetchMock,
    });
    await sessionManager.hydrate();

    storage.saveCredentials.mockImplementationOnce(async (creds) => {
      events.push('secure_store_save_started');
      // While SecureStore write is still pending, memory MUST still hold TOKEN_1!
      expect(sessionManager.getAccessTokenSnapshot()?.accessToken).toBe(TOKEN_1);
      await saveGate.promise;
      events.push('secure_store_save_finished');
      // Delegate actual store update
      storage.loadCredentials.mockResolvedValue(creds);
    });

    const reqPromise = apiClient.request<{ ok: boolean }>('/api/dashboard');

    await new Promise((r) => setTimeout(r, 20));
    expect(events).toEqual(['refresh_http_ok', 'secure_store_save_started']);
    // Memory MUST NOT have switched to TOKEN_2 before saveGate resolves!
    expect(sessionManager.getAccessTokenSnapshot()?.accessToken).toBe(TOKEN_1);

    saveGate.resolve();
    const res = await reqPromise;
    expect(res.ok).toBe(true);
    expect(events).toEqual([
      'refresh_http_ok',
      'secure_store_save_started',
      'secure_store_save_finished',
      'waiter_retried_with_token2',
    ]);

    // Part 2: SecureStore write failure MUST fail closed and wipe inconsistent auth state
    const failFetch = jest.fn(async (url: string) => {
      if (url.endsWith('/api/mobile/auth/refresh')) {
        return makeJsonResponse(200, rotatedCreds);
      }
      return makeJsonResponse(401, { error: 'Expired' });
    });
    const failHarness = setupHarness({
      initialCreds,
      fetchImpl: failFetch,
    });
    await failHarness.sessionManager.hydrate();
    failHarness.storage.saveCredentials.mockRejectedValueOnce(
      new SecureStoragePersistenceError('Keystore write failed')
    );

    await expect(
      failHarness.apiClient.request('/api/dashboard')
    ).rejects.toMatchObject({
      code: 'STORAGE_PERSISTENCE_FAILED',
    });

    expect(failHarness.sessionManager.getSnapshot().status).toBe('unauthenticated');
    expect(failHarness.storage.clearCredentials).toHaveBeenCalledTimes(1);
    expect(failHarness.onClearProtectedCaches).toHaveBeenCalledTimes(1);
    expect(failHarness.onTerminalSessionEnded).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['SESSION_EXPIRED', /session expired/i],
    ['DEVICE_REVOKED', /device was revoked/i],
    ['REFRESH_TOKEN_REUSE_DETECTED', /closed for security/i],
    ['INVALID_REFRESH_TOKEN', /no longer valid/i],
  ] as const)(
    'handles terminal refresh error %s by clearing SecureStore, protected caches, and emitting single-shot redirect notice',
    async (serverCode, expectedNoticeRegex) => {
      const initialCreds = makeCredentials({
        accessToken: TOKEN_1,
        refreshToken: REFRESH_1,
        accessExpMs: NOW + 10 * 60_000,
        refreshExpMs: NOW + 30 * 86_400_000,
      });

      const fetchMock = jest.fn(async (url: string) => {
        if (url.endsWith('/api/mobile/auth/refresh')) {
          return makeJsonResponse(401, {
            error: 'Terminal failure',
            code: serverCode,
          });
        }
        return makeJsonResponse(401, { error: 'Expired' });
      });

      const {
        sessionManager,
        apiClient,
        storage,
        onClearProtectedCaches,
        onTerminalSessionEnded,
      } = setupHarness({
        initialCreds,
        fetchImpl: fetchMock,
      });
      await sessionManager.hydrate();

      // Launch 3 concurrent requests so all await the same failing refresh
      const outcomes = await Promise.allSettled([
        apiClient.request('/api/dashboard'),
        apiClient.request('/api/members'),
        apiClient.request('/api/designs'),
      ]);

      expect(outcomes.every((o) => o.status === 'rejected')).toBe(true);
      for (const outcome of outcomes) {
        if (outcome.status === 'rejected') {
          expect(outcome.reason).toBeInstanceOf(AuthSessionError);
          expect((outcome.reason as AuthSessionError).code).toBe(serverCode);
        }
      }

      expect(storage.getSaved()).toBeNull();
      expect(storage.clearCredentials).toHaveBeenCalledTimes(1);
      expect(onClearProtectedCaches).toHaveBeenCalledTimes(1);
      expect(onTerminalSessionEnded).toHaveBeenCalledTimes(1);
      expect(sessionManager.getSnapshot().status).toBe('unauthenticated');
      expect(sessionManager.getSnapshot().notice).toMatch(expectedNoticeRegex);
    }
  );

  it('preserves credentials without signing out on temporary network, timeout, or 5xx refresh failures', async () => {
    const initialCreds = makeCredentials({
      accessToken: TOKEN_1,
      refreshToken: REFRESH_1,
      accessExpMs: NOW + 10 * 60_000,
      refreshExpMs: NOW + 30 * 86_400_000,
    });

    const fetchMock = jest
      .fn()
      // 1. Network offline error during refresh
      .mockResolvedValueOnce(makeJsonResponse(401, { error: 'Expired' }))
      .mockRejectedValueOnce(new TypeError('Network request failed'))
      // 2. Temporary 503 during refresh
      .mockResolvedValueOnce(makeJsonResponse(401, { error: 'Expired' }))
      .mockResolvedValueOnce(makeJsonResponse(503, { error: 'Temporarily down' }));

    const {
      sessionManager,
      apiClient,
      storage,
      onClearProtectedCaches,
      onTerminalSessionEnded,
    } = setupHarness({
      initialCreds,
      fetchImpl: fetchMock,
    });
    await sessionManager.hydrate();

    await expect(apiClient.request('/api/dashboard')).rejects.toBeInstanceOf(
      TemporaryRefreshError
    );
    expect(sessionManager.getSnapshot().status).toBe('authenticated');
    expect(storage.getSaved()?.refreshToken).toBe(REFRESH_1);
    expect(onClearProtectedCaches).not.toHaveBeenCalled();
    expect(onTerminalSessionEnded).not.toHaveBeenCalled();

    await expect(apiClient.request('/api/dashboard')).rejects.toMatchObject({
      code: 'SERVER_UNAVAILABLE',
      statusCode: 503,
    });
    expect(sessionManager.getSnapshot().status).toBe('authenticated');
    expect(storage.getSaved()?.refreshToken).toBe(REFRESH_1);
    expect(onClearProtectedCaches).not.toHaveBeenCalled();
  });

  it('aborts and discards an in-flight refresh cleanly when logout() runs concurrently', async () => {
    const initialCreds = makeCredentials({
      accessToken: TOKEN_1,
      refreshToken: REFRESH_1,
      accessExpMs: NOW + 10 * 60_000,
      refreshExpMs: NOW + 30 * 86_400_000,
    });
    const lateRotatedCreds = makeCredentials({
      accessToken: TOKEN_2,
      refreshToken: REFRESH_2,
      accessExpMs: NOW + 15 * 60_000,
      refreshExpMs: NOW + 30 * 86_400_000,
    });

    const refreshGate = createDeferred<Response>();

    const fetchMock = jest.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/api/mobile/auth/refresh')) {
        // Simulate server resolving late even after abort signal fires
        return refreshGate.promise;
      }
      if (url.endsWith('/api/mobile/auth/logout')) {
        expect((init?.headers as Record<string, string>)?.Authorization).toBe(
          `Bearer ${TOKEN_1}`
        );
        return makeJsonResponse(200, { success: true, revokedSessions: 1 });
      }
      return makeJsonResponse(401, { error: 'Expired' });
    });

    const { sessionManager, apiClient, storage, onClearProtectedCaches } =
      setupHarness({
        initialCreds,
        fetchImpl: fetchMock,
      });
    await sessionManager.hydrate();

    const waiter1 = apiClient.request('/api/dashboard');
    const waiter2 = apiClient.request('/api/members');

    await new Promise((r) => setTimeout(r, 15));
    expect(sessionManager.isRefreshInFlight()).toBe(true);

    // Owner taps Sign Out while refresh is still in flight
    await sessionManager.logout();

    // Now the late HTTP refresh response arrives — MUST NOT resurrect session or overwrite SecureStore!
    refreshGate.resolve(makeJsonResponse(200, lateRotatedCreds));

    const results = await Promise.allSettled([waiter1, waiter2]);
    for (const r of results) {
      expect(r.status).toBe('rejected');
      if (r.status === 'rejected') {
        expect(r.reason).toBeInstanceOf(AuthSessionError);
        expect((r.reason as AuthSessionError).code).toBe('LOGGED_OUT');
      }
    }

    expect(sessionManager.getSnapshot().status).toBe('unauthenticated');
    expect(storage.getSaved()).toBeNull();
    expect(storage.saveCredentials).not.toHaveBeenCalled();
    expect(onClearProtectedCaches).toHaveBeenCalledTimes(1);
  });

  it('recovers deterministically from a lost refresh response (network drop -> preserve -> reconnect replay -> server 401 REFRESH_TOKEN_REUSE_DETECTED -> terminal wipe & login notice)', async () => {
    const initialCreds = makeCredentials({
      accessToken: TOKEN_1,
      refreshToken: REFRESH_1,
      accessExpMs: NOW + 10 * 60_000,
      refreshExpMs: NOW + 30 * 86_400_000,
    });

    // Server-side simulation: first refresh rotates R1 -> R2 on server, then TCP drops before response reaches phone;
    // second refresh presenting R1 triggers Stage 6.1 family revocation (401 REFRESH_TOKEN_REUSE_DETECTED)!
    let serverRefreshAttempts = 0;

    const fetchMock = jest.fn(async (url: string) => {
      if (url.endsWith('/api/mobile/auth/refresh')) {
        serverRefreshAttempts += 1;
        if (serverRefreshAttempts === 1) {
          throw new TypeError('Connection reset before response received');
        }
        return makeJsonResponse(401, {
          error:
            'Unauthorized: Refresh token reuse detected; session family revoked.',
          code: 'REFRESH_TOKEN_REUSE_DETECTED',
        });
      }
      return makeJsonResponse(401, { error: 'Access token expired' });
    });

    const {
      sessionManager,
      apiClient,
      storage,
      onClearProtectedCaches,
      onTerminalSessionEnded,
    } = setupHarness({
      initialCreds,
      fetchImpl: fetchMock,
    });
    await sessionManager.hydrate();

    // Step 1: Network drops mid-refresh -> temporary failure, credentials preserved, user NOT abruptly logged out while offline
    await expect(apiClient.request('/api/dashboard')).rejects.toMatchObject({
      code: 'NETWORK_ERROR',
    });
    expect(sessionManager.getSnapshot().status).toBe('authenticated');
    expect(storage.getSaved()?.refreshToken).toBe(REFRESH_1);
    expect(onTerminalSessionEnded).not.toHaveBeenCalled();

    // Step 2: Device regains connectivity and retries -> server sees R1 replay, revokes family, returns 401 REFRESH_TOKEN_REUSE_DETECTED
    await expect(apiClient.request('/api/dashboard')).rejects.toMatchObject({
      code: 'REFRESH_TOKEN_REUSE_DETECTED',
    });
    expect(sessionManager.getSnapshot().status).toBe('unauthenticated');
    expect(storage.getSaved()).toBeNull();
    expect(onClearProtectedCaches).toHaveBeenCalledTimes(1);
    expect(onTerminalSessionEnded).toHaveBeenCalledTimes(1);
    expect(sessionManager.getSnapshot().notice).toMatch(/interrupted or duplicate refresh/i);
  });

  it('rejects malformed dashboard JSON payloads with ApiClientError INVALID_RESPONSE', async () => {
    const initialCreds = makeCredentials({
      accessToken: TOKEN_1,
      refreshToken: REFRESH_1,
      accessExpMs: NOW + 10 * 60_000,
      refreshExpMs: NOW + 30 * 86_400_000,
    });

    const fetchMock = jest.fn(async () =>
      makeJsonResponse(200, { unexpected: true })
    );

    const { sessionManager, apiClient } = setupHarness({
      initialCreds,
      fetchImpl: fetchMock,
    });
    await sessionManager.hydrate();

    await expect(apiClient.fetchDashboardSnapshot()).rejects.toBeInstanceOf(
      ApiClientError
    );
    await expect(apiClient.fetchDashboardSnapshot()).rejects.toMatchObject({
      kind: 'INVALID_RESPONSE',
    });
  });
});
