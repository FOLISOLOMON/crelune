import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { hashPassword } from '@/lib/auth/password';
import { createSessionToken, SESSION_COOKIE_NAME } from '@/lib/auth/session';

const TEST_SECRET = 'crelune_milestone_2_1_1_test_secret_64_bytes_minimum_validation_key';

interface MockUserRecord {
  id: string;
  email: string;
  passwordHash: string;
  firstName: string;
  lastName: string;
  role: string;
  isActive: boolean;
  organisationId: string;
  sessionVersion: number;
  organisation: { id: string; name: string };
  preferences: {
    theme: string;
    dateFormat: string;
    timezone: string;
    leadTimeDaysBirthday: number;
    leadTimeDaysEvent: number;
    defaultExportFormat: string;
  } | null;
}

interface MockThrottleBucket {
  bucketKey: string;
  attempts: number;
  windowStart: Date;
  blockedUntil: Date | null;
  updatedAt: Date;
}

const mockState = vi.hoisted(() => ({
  cookies: new Map<string, string>(),
  deletedCookies: [] as string[],
  setCookies: [] as Array<{ name: string; value: string }>,
  users: new Map<string, MockUserRecord>(),
  throttles: new Map<string, MockThrottleBucket>(),
  dbConnected: true,
}));

vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({
    get: (name: string) => {
      const value = mockState.cookies.get(name);
      return value !== undefined ? { name, value } : undefined;
    },
    set: (name: string, value: string, options?: { maxAge?: number }) => {
      if (options?.maxAge === 0) {
        mockState.cookies.delete(name);
        mockState.deletedCookies.push(name);
      } else {
        mockState.cookies.set(name, value);
        mockState.setCookies.push({ name, value });
      }
    },
    delete: (name: string) => {
      mockState.cookies.delete(name);
      mockState.deletedCookies.push(name);
    },
  })),
}));

vi.mock('@crelune/database', () => ({
  checkDatabaseConnection: vi.fn(async () => ({
    connected: mockState.dbConnected,
    latencyMs: 3,
    error: mockState.dbConnected ? undefined : 'connection error',
  })),
  prisma: {
    user: {
      findUnique: vi.fn(async ({ where }: { where: { id?: string; email?: string } }) => {
        for (const user of mockState.users.values()) {
          if (where.id && user.id === where.id) return { ...user };
          if (where.email && user.email === where.email) return { ...user };
        }
        return null;
      }),
    },
    authThrottle: {
      findMany: vi.fn(
        async ({ where }: { where: { bucketKey: { in: string[] } } }) => {
          const results: Array<{ bucketKey: string; blockedUntil: Date | null }> = [];
          for (const key of where.bucketKey.in) {
            const row = mockState.throttles.get(key);
            if (row) {
              results.push({ bucketKey: row.bucketKey, blockedUntil: row.blockedUntil });
            }
          }
          return results;
        }
      ),
      deleteMany: vi.fn(async ({ where }: { where: { bucketKey: string } }) => {
        const existed = mockState.throttles.delete(where.bucketKey);
        return { count: existed ? 1 : 0 };
      }),
    },
    $queryRaw: vi.fn(async (_strings: TemplateStringsArray, ...values: unknown[]) => {
      // Mirrors parameter positions in recordAtomicBucketFailure():
      // [0]bucketKey [1]now [2]initialBlockedUntil [5]windowCutoff [14]maxAttempts [15]blockUntil
      const bucketKey = values[0] as string;
      const now = values[1] as Date;
      const initialBlockedUntil = values[2] as Date | null;
      const windowCutoff = values[5] as Date;
      const maxAttempts = values[14] as number;
      const blockUntil = values[15] as Date;

      const existing = mockState.throttles.get(bucketKey);
      if (!existing) {
        const created: MockThrottleBucket = {
          bucketKey,
          attempts: 1,
          windowStart: now,
          blockedUntil: initialBlockedUntil,
          updatedAt: now,
        };
        mockState.throttles.set(bucketKey, created);
        return [
          {
            attempts: created.attempts,
            windowStart: created.windowStart,
            blockedUntil: created.blockedUntil,
          },
        ];
      }

      const blockExpired =
        existing.blockedUntil !== null && existing.blockedUntil <= now;
      const windowExpired =
        existing.blockedUntil === null && existing.windowStart <= windowCutoff;
      const currentlyBlocked =
        existing.blockedUntil !== null && existing.blockedUntil > now;

      let nextAttempts: number;
      let nextWindowStart: Date;
      let nextBlockedUntil: Date | null;

      if (blockExpired || windowExpired) {
        nextAttempts = 1;
        nextWindowStart = now;
        nextBlockedUntil = initialBlockedUntil;
      } else if (currentlyBlocked) {
        nextAttempts = existing.attempts;
        nextWindowStart = existing.windowStart;
        nextBlockedUntil = existing.blockedUntil;
      } else {
        nextAttempts = existing.attempts + 1;
        nextWindowStart = existing.windowStart;
        nextBlockedUntil = nextAttempts >= maxAttempts ? blockUntil : null;
      }

      const updated: MockThrottleBucket = {
        bucketKey,
        attempts: nextAttempts,
        windowStart: nextWindowStart,
        blockedUntil: nextBlockedUntil,
        updatedAt: now,
      };
      mockState.throttles.set(bucketKey, updated);

      return [
        {
          attempts: updated.attempts,
          windowStart: updated.windowStart,
          blockedUntil: updated.blockedUntil,
        },
      ];
    }),
  },
}));

import { POST as loginPost } from './login/route';
import { POST as logoutPost } from './logout/route';
import { GET as meGet } from './me/route';
import { GET as healthGet } from '../health/route';
import { verifyActiveOwnerInDatabase } from '@/lib/auth/owner-guard';
import {
  IP_ACCOUNT_BLOCK_MS,
  IP_ACCOUNT_MAX_ATTEMPTS,
  IP_MAX_ATTEMPTS,
  buildThrottleKeys,
  checkLoginThrottle,
  recordAtomicBucketFailure,
} from '@/lib/auth/rate-limit';

describe('Authentication Route Handlers & DB Enforcement (Milestone 2.1.1)', () => {
  const originalEnv = process.env;
  let ownerPasswordHash: string;

  const ownerUser = (): MockUserRecord => ({
    id: 'owner-user-1',
    email: 'owner@crelune.test',
    passwordHash: ownerPasswordHash,
    firstName: 'Foli',
    lastName: 'Solomon',
    role: 'OWNER',
    isActive: true,
    organisationId: 'org-1',
    sessionVersion: 2,
    organisation: { id: 'org-1', name: 'CRELUNE Studio' },
    preferences: {
      theme: 'SYSTEM',
      dateFormat: 'YYYY-MM-DD',
      timezone: 'Africa/Accra',
      leadTimeDaysBirthday: 7,
      leadTimeDaysEvent: 14,
      defaultExportFormat: 'PNG',
    },
  });

  function makeLoginRequest(
    body: unknown,
    headers: Record<string, string> = {}
  ): Request {
    return new Request('https://crelune.test/api/auth/login', {
      method: 'POST',
      headers: {
        host: 'crelune.test',
        origin: 'https://crelune.test',
        'content-type': 'application/json',
        ...headers,
      },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    });
  }

  beforeEach(async () => {
    vi.resetModules();
    process.env = {
      ...originalEnv,
      SESSION_SECRET: TEST_SECRET,
      TRUST_PROXY: 'false',
      ALLOWED_ORIGINS: '',
    };
    mockState.cookies.clear();
    mockState.deletedCookies = [];
    mockState.setCookies = [];
    mockState.users.clear();
    mockState.throttles.clear();
    mockState.dbConnected = true;

    ownerPasswordHash = await hashPassword('CorrectHorseBattery!2026');
    const user = ownerUser();
    mockState.users.set(user.id, user);
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('POST /api/auth/login — CSRF, Size & Auth Hardening', () => {
    it('rejects requests missing both Origin and Referer headers with 403', async () => {
      const req = new Request('https://crelune.test/api/auth/login', {
        method: 'POST',
        headers: {
          host: 'crelune.test',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          email: 'owner@crelune.test',
          password: 'CorrectHorseBattery!2026',
        }),
      });

      const res = await loginPost(req);
      expect(res.status).toBe(403);
    });

    it('rejects mismatched Origin headers with 403', async () => {
      const req = makeLoginRequest(
        { email: 'owner@crelune.test', password: 'CorrectHorseBattery!2026' },
        { origin: 'https://evil.example' }
      );

      const res = await loginPost(req);
      expect(res.status).toBe(403);
    });

    it('ignores spoofed x-forwarded-host when TRUST_PROXY is not enabled', async () => {
      const req = makeLoginRequest(
        { email: 'owner@crelune.test', password: 'CorrectHorseBattery!2026' },
        {
          origin: 'https://spoofed.example',
          'x-forwarded-host': 'spoofed.example',
          'x-forwarded-proto': 'https',
        }
      );

      const res = await loginPost(req);
      expect(res.status).toBe(403);
    });

    it('accepts trusted reverse-proxy origin when TRUST_PROXY=true', async () => {
      process.env.TRUST_PROXY = 'true';
      const req = makeLoginRequest(
        { email: 'owner@crelune.test', password: 'CorrectHorseBattery!2026' },
        {
          origin: 'https://app.crelune.example',
          'x-forwarded-host': 'app.crelune.example',
          'x-forwarded-proto': 'https',
        }
      );

      const res = await loginPost(req);
      expect(res.status).toBe(200);
    });

    it('accepts valid same-origin Referer when Origin is absent', async () => {
      const req = new Request('https://crelune.test/api/auth/login', {
        method: 'POST',
        headers: {
          host: 'crelune.test',
          referer: 'https://crelune.test/login',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          email: 'owner@crelune.test',
          password: 'CorrectHorseBattery!2026',
        }),
      });

      const res = await loginPost(req);
      expect(res.status).toBe(200);
    });

    it('rejects oversized login payloads (> 4KB) with 413', async () => {
      const req = makeLoginRequest({
        email: 'owner@crelune.test',
        password: 'a'.repeat(5000),
      });

      const res = await loginPost(req);
      expect(res.status).toBe(413);
    });

    it('returns identical 401 errors for unknown email, inactive owner, wrong password, and (IP, account) block', async () => {
      // Unknown email
      const unknownRes = await loginPost(
        makeLoginRequest({
          email: 'nobody@crelune.test',
          password: 'WrongPassword!123',
        })
      );
      const unknownBody = await unknownRes.json();

      // Wrong password on existing owner
      const wrongPwRes = await loginPost(
        makeLoginRequest({
          email: 'owner@crelune.test',
          password: 'WrongPassword!123',
        })
      );
      const wrongPwBody = await wrongPwRes.json();

      // Deactivated owner with valid password
      const inactive = mockState.users.get('owner-user-1')!;
      inactive.isActive = false;
      const inactiveRes = await loginPost(
        makeLoginRequest({
          email: 'owner@crelune.test',
          password: 'CorrectHorseBattery!2026',
        })
      );
      const inactiveBody = await inactiveRes.json();

      expect(unknownRes.status).toBe(401);
      expect(wrongPwRes.status).toBe(401);
      expect(inactiveRes.status).toBe(401);
      expect(unknownBody.error).toBe('Invalid email or password');
      expect(wrongPwBody.error).toBe('Invalid email or password');
      expect(inactiveBody.error).toBe('Invalid email or password');
    });

    it('authenticates active owner, sets session cookie with sessionVersion, and clears (IP, account) throttle', async () => {
      process.env.TRUST_PROXY = 'true';
      // 2 failed attempts first
      for (let i = 0; i < 2; i++) {
        const failRes = await loginPost(
          makeLoginRequest(
            { email: 'owner@crelune.test', password: 'WrongPassword!123' },
            { 'x-forwarded-for': '203.0.113.10' }
          )
        );
        expect(failRes.status).toBe(401);
      }

      const { ipAccountKey } = buildThrottleKeys('203.0.113.10', 'owner@crelune.test');
      expect(mockState.throttles.get(ipAccountKey)?.attempts).toBe(2);

      // Now correct password
      const okRes = await loginPost(
        makeLoginRequest(
          { email: 'owner@crelune.test', password: 'CorrectHorseBattery!2026' },
          { 'x-forwarded-for': '203.0.113.10' }
        )
      );
      expect(okRes.status).toBe(200);
      expect(mockState.cookies.has(SESSION_COOKIE_NAME)).toBe(true);
      expect(mockState.throttles.has(ipAccountKey)).toBe(false);
    });
  });

  describe('Durable PostgreSQL Rate Limiting & Anti-Lockout Properties', () => {
    it('prevents concurrent race conditions and blocks (IP, account) after threshold with indistinguishable 401', async () => {
      process.env.TRUST_PROXY = 'true';

      // Fire 6 parallel bad password requests from attacker IP
      const responses = await Promise.all(
        Array.from({ length: 6 }, () =>
          loginPost(
            makeLoginRequest(
              { email: 'owner@crelune.test', password: 'WrongPassword!123' },
              { 'x-forwarded-for': '198.51.100.44' }
            )
          )
        )
      );

      for (const res of responses) {
        expect(res.status).toBe(401);
        const body = await res.json();
        expect(body.error).toBe('Invalid email or password');
      }

      const { ipAccountKey } = buildThrottleKeys('198.51.100.44', 'owner@crelune.test');
      const bucket = mockState.throttles.get(ipAccountKey);
      expect(bucket?.blockedUntil).toBeInstanceOf(Date);
      expect(bucket?.attempts).toBe(IP_ACCOUNT_MAX_ATTEMPTS);

      // Even correct password from attacker IP is blocked with indistinguishable 401
      const blockedRes = await loginPost(
        makeLoginRequest(
          { email: 'owner@crelune.test', password: 'CorrectHorseBattery!2026' },
          { 'x-forwarded-for': '198.51.100.44' }
        )
      );
      expect(blockedRes.status).toBe(401);
      expect((await blockedRes.json()).error).toBe('Invalid email or password');

      // Attacker cannot indefinitely lock out legitimate owner on a separate IP
      const ownerOkRes = await loginPost(
        makeLoginRequest(
          { email: 'owner@crelune.test', password: 'CorrectHorseBattery!2026' },
          { 'x-forwarded-for': '203.0.113.99' }
        )
      );
      expect(ownerOkRes.status).toBe(200);
    });

    it('blocks excessive pure-IP floods across accounts with 429', async () => {
      process.env.TRUST_PROXY = 'true';
      for (let i = 0; i < IP_MAX_ATTEMPTS; i++) {
        const res = await loginPost(
          makeLoginRequest(
            { email: `probe${i}@crelune.test`, password: 'WrongPassword!123' },
            { 'x-forwarded-for': '192.0.2.77' }
          )
        );
        expect(res.status).toBe(401);
      }

      const flooded = await loginPost(
        makeLoginRequest(
          { email: 'owner@crelune.test', password: 'CorrectHorseBattery!2026' },
          { 'x-forwarded-for': '192.0.2.77' }
        )
      );
      expect(flooded.status).toBe(429);
    });

    it('does not extend blockedUntil on retries and automatically recovers after block expiry', async () => {
      const t0 = new Date('2026-11-11T10:00:00.000Z');
      const bucketKey = 'ip_acct:recovery-test';

      let lastRow;
      for (let i = 0; i < IP_ACCOUNT_MAX_ATTEMPTS; i++) {
        lastRow = await recordAtomicBucketFailure(bucketKey, {
          now: t0,
          windowMs: IP_ACCOUNT_BLOCK_MS,
          maxAttempts: IP_ACCOUNT_MAX_ATTEMPTS,
          blockMs: IP_ACCOUNT_BLOCK_MS,
        });
      }
      const initialBlockedUntil = lastRow!.blockedUntil!;
      expect(initialBlockedUntil.getTime()).toBe(t0.getTime() + IP_ACCOUNT_BLOCK_MS);

      // Retrying 5 minutes later must NOT extend blockedUntil
      const tRetry = new Date(t0.getTime() + 5 * 60 * 1000);
      const retryRow = await recordAtomicBucketFailure(bucketKey, {
        now: tRetry,
        windowMs: IP_ACCOUNT_BLOCK_MS,
        maxAttempts: IP_ACCOUNT_MAX_ATTEMPTS,
        blockMs: IP_ACCOUNT_BLOCK_MS,
      });
      expect(retryRow.blockedUntil?.getTime()).toBe(initialBlockedUntil.getTime());

      // After block duration passes, checkLoginThrottle clears block and next failure resets window cleanly
      const tAfter = new Date(initialBlockedUntil.getTime() + 1000);
      const statusAfter = await checkLoginThrottle('198.51.100.1', 'nobody@crelune.test', tAfter);
      expect(statusAfter.ipAccountBlocked).toBe(false);

      const resetRow = await recordAtomicBucketFailure(bucketKey, {
        now: tAfter,
        windowMs: IP_ACCOUNT_BLOCK_MS,
        maxAttempts: IP_ACCOUNT_MAX_ATTEMPTS,
        blockMs: IP_ACCOUNT_BLOCK_MS,
      });
      expect(resetRow.attempts).toBe(1);
      expect(resetRow.blockedUntil).toBeNull();
    });
  });

  describe('POST /api/auth/logout — Strict CSRF Enforcement', () => {
    it('rejects logout without valid Origin/Referer even when NODE_ENV=test', async () => {
      const req = new Request('https://crelune.test/api/auth/logout', {
        method: 'POST',
        headers: { host: 'crelune.test' },
      });
      const res = await logoutPost(req);
      expect(res.status).toBe(403);
    });

    it('clears session cookie when Origin matches host', async () => {
      mockState.cookies.set(SESSION_COOKIE_NAME, 'valid.token');
      const req = new Request('https://crelune.test/api/auth/logout', {
        method: 'POST',
        headers: {
          host: 'crelune.test',
          origin: 'https://crelune.test',
        },
      });
      const res = await logoutPost(req);
      expect(res.status).toBe(200);
      expect(mockState.cookies.has(SESSION_COOKIE_NAME)).toBe(false);
    });
  });

  describe('GET /api/auth/me, GET /api/health & Server-Side Revocation Guard', () => {
    it('returns authenticated owner profile for active owner matching sessionVersion', async () => {
      const token = createSessionToken({
        id: 'owner-user-1',
        organisationId: 'org-1',
        sessionVersion: 2,
      });
      mockState.cookies.set(SESSION_COOKIE_NAME, token);

      const res = await meGet();
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.authenticated).toBe(true);
      expect(body.user.userId).toBe('owner-user-1');
    });

    it('rejects and clears cookie when sessionVersion has been incremented (session revoked)', async () => {
      const token = createSessionToken({
        id: 'owner-user-1',
        organisationId: 'org-1',
        sessionVersion: 2,
      });
      mockState.cookies.set(SESSION_COOKIE_NAME, token);
      mockState.users.get('owner-user-1')!.sessionVersion = 3;

      const res = await meGet();
      expect(res.status).toBe(401);
      expect(mockState.deletedCookies).toContain(SESSION_COOKIE_NAME);
    });

    it('rejects and clears cookie when owner is deactivated (isActive=false)', async () => {
      const token = createSessionToken({
        id: 'owner-user-1',
        organisationId: 'org-1',
        sessionVersion: 2,
      });
      mockState.cookies.set(SESSION_COOKIE_NAME, token);
      mockState.users.get('owner-user-1')!.isActive = false;

      const res = await meGet();
      expect(res.status).toBe(401);
      expect(mockState.deletedCookies).toContain(SESSION_COOKIE_NAME);
    });

    it('returns minimal liveness on /api/health when unauthenticated, deactivated, or revoked', async () => {
      // Unauthenticated
      const unauthRes = await healthGet();
      expect(unauthRes.status).toBe(200);
      const unauthBody = await unauthRes.json();
      expect(Object.keys(unauthBody).sort()).toEqual(['status', 'timestamp']);
      expect(unauthBody.status).toBe('ok');

      // Revoked sessionVersion
      const token = createSessionToken({
        id: 'owner-user-1',
        organisationId: 'org-1',
        sessionVersion: 1,
      });
      mockState.cookies.set(SESSION_COOKIE_NAME, token);
      const revokedRes = await healthGet();
      const revokedBody = await revokedRes.json();
      expect(revokedBody.database).toBeUndefined();
      expect(revokedBody.status).toBe('ok');

      // Active valid session
      const validToken = createSessionToken({
        id: 'owner-user-1',
        organisationId: 'org-1',
        sessionVersion: 2,
      });
      mockState.cookies.set(SESSION_COOKIE_NAME, validToken);
      const authRes = await healthGet();
      const authBody = await authRes.json();
      expect(authBody.status).toBe('healthy');
      expect(authBody.database.connected).toBe(true);
    });

    it('verifyActiveOwnerInDatabase rejects role, organisation, isActive, and version mismatches', async () => {
      const baseSession = {
        sub: 'owner-user-1',
        role: 'OWNER' as const,
        org: 'org-1',
        ver: 2,
        iat: 1000,
        exp: 2000,
      };

      expect((await verifyActiveOwnerInDatabase(baseSession)).status).toBe('authenticated');
      expect(
        (await verifyActiveOwnerInDatabase({ ...baseSession, org: 'org-other' })).status
      ).toBe('revoked');
      expect(
        (await verifyActiveOwnerInDatabase({ ...baseSession, ver: 1 })).status
      ).toBe('revoked');

      mockState.users.get('owner-user-1')!.role = 'MEMBER';
      expect((await verifyActiveOwnerInDatabase(baseSession)).status).toBe('revoked');

      mockState.users.get('owner-user-1')!.role = 'OWNER';
      mockState.users.get('owner-user-1')!.isActive = false;
      expect((await verifyActiveOwnerInDatabase(baseSession)).status).toBe('revoked');
    });
  });
});
