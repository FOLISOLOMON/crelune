import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const mockState = vi.hoisted(() => ({
  throttles: new Map<string, { attempts: number; windowStart: Date; blockedUntil: Date | null }>(),
  executeRawCalls: 0,
}));

vi.mock('@crelune/database', () => ({
  prisma: {
    authThrottle: {
      findMany: vi.fn(async ({ where }: { where: { bucketKey: { in: string[] } } }) => {
        const rows: Array<{ bucketKey: string; blockedUntil: Date | null }> = [];
        for (const key of where.bucketKey.in) {
          const row = mockState.throttles.get(key);
          if (row) {
            rows.push({ bucketKey: key, blockedUntil: row.blockedUntil });
          }
        }
        return rows;
      }),
      deleteMany: vi.fn(async () => ({ count: 0 })),
    },
    $queryRaw: vi.fn(async (_strings: TemplateStringsArray, bucketKey: string, now: Date) => [
      { attempts: 1, windowStart: now, blockedUntil: null, bucketKey },
    ]),
    $executeRaw: vi.fn(async () => {
      mockState.executeRawCalls += 1;
      return 0;
    }),
  },
}));

import {
  parseValidIp,
  resolveClientIp,
  extractClientIp,
  buildThrottleKeys,
  checkLoginThrottle,
  maybePruneExpiredThrottles,
  resetCleanupScheduleForTesting,
  THROTTLE_CLEANUP_COOLDOWN_MS,
} from './rate-limit';

describe('Rate-Limit Client Identity & Fallback (Milestone 2.1.2)', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv, TRUST_PROXY: 'false' };
    mockState.throttles.clear();
    mockState.executeRawCalls = 0;
    resetCleanupScheduleForTesting();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('parseValidIp — Strict IPv4 & IPv6 Validation / Canonicalization', () => {
    it('validates canonical IPv4 addresses and IPv4:port pairs', () => {
      expect(parseValidIp('203.0.113.5')).toBe('203.0.113.5');
      expect(parseValidIp('  198.51.100.42:8443  ')).toBe('198.51.100.42');
      expect(parseValidIp('127.0.0.1')).toBe('127.0.0.1');
    });

    it('validates and canonicalizes IPv6, bracketed IPv6:port, and IPv4-mapped IPv6', () => {
      expect(parseValidIp('2001:0DB8:0000:0000::1')).toBe('2001:db8::1');
      expect(parseValidIp('[2001:DB8::1]:443')).toBe('2001:db8::1');
      expect(parseValidIp('::1')).toBe('::1');
      expect(parseValidIp('::ffff:203.0.113.10')).toBe('203.0.113.10');
    });

    it('rejects malformed, out-of-range, leading-zero, comma-joined, and zone-ID strings', () => {
      expect(parseValidIp(null)).toBeNull();
      expect(parseValidIp('')).toBeNull();
      expect(parseValidIp('   ')).toBeNull();
      expect(parseValidIp('999.1.2.3')).toBeNull();
      expect(parseValidIp('1.2.3')).toBeNull();
      expect(parseValidIp('01.02.03.04')).toBeNull();
      expect(parseValidIp('192.168.1.1:99999')).toBeNull();
      expect(parseValidIp(':::::')).toBeNull();
      expect(parseValidIp('fe80::1%eth0')).toBeNull();
      expect(parseValidIp('203.0.113.1, 203.0.113.2')).toBeNull();
      expect(parseValidIp('not-an-ip-address')).toBeNull();
      expect(parseValidIp('direct-client')).toBeNull();
    });
  });

  describe('resolveClientIp & extractClientIp — Proxy Trust Boundaries', () => {
    it('returns null (never a shared placeholder string) when TRUST_PROXY is not true', () => {
      const req = new Request('https://crelune.test/api/auth/login', {
        headers: {
          'x-real-ip': '203.0.113.5',
          'x-forwarded-for': '198.51.100.10',
        },
      });

      expect(extractClientIp(req)).toBeNull();
      expect(resolveClientIp(req)).toEqual({ ip: null, source: 'unknown' });
    });

    it('returns null when TRUST_PROXY=true but no forwarding header is present', () => {
      process.env.TRUST_PROXY = 'true';
      const req = new Request('https://crelune.test/api/auth/login');
      expect(extractClientIp(req)).toBeNull();
    });

    it('trusts valid X-Real-IP when TRUST_PROXY=true and rejects invalid X-Real-IP', () => {
      process.env.TRUST_PROXY = 'true';

      const validReq = new Request('https://crelune.test/api/auth/login', {
        headers: { 'x-real-ip': '2001:0DB8::7', 'x-forwarded-for': '192.0.2.99' },
      });
      expect(resolveClientIp(validReq)).toEqual({
        ip: '2001:db8::7',
        source: 'trusted_proxy_x_real_ip',
      });

      // Spoofed/multi-value X-Real-IP must not silently fall back to unverified X-Forwarded-For
      const badReq = new Request('https://crelune.test/api/auth/login', {
        headers: { 'x-real-ip': '203.0.113.1, 1.1.1.1', 'x-forwarded-for': '192.0.2.99' },
      });
      expect(extractClientIp(badReq)).toBeNull();
    });

    it('uses the rightmost hop of X-Forwarded-For when TRUST_PROXY=true to prevent left-spoofing', () => {
      process.env.TRUST_PROXY = 'true';

      const spoofedMultiHop = new Request('https://crelune.test/api/auth/login', {
        headers: { 'x-forwarded-for': '1.2.3.4, 203.0.113.88' },
      });
      expect(resolveClientIp(spoofedMultiHop)).toEqual({
        ip: '203.0.113.88',
        source: 'trusted_proxy_x_forwarded_for',
      });

      // If rightmost entry is invalid, do not fall back to client-supplied left entry
      const invalidRightmost = new Request('https://crelune.test/api/auth/login', {
        headers: { 'x-forwarded-for': '203.0.113.88, forged-value' },
      });
      expect(extractClientIp(invalidRightmost)).toBeNull();
    });
  });

  describe('buildThrottleKeys & Unknown-IP Isolation', () => {
    it('omits ipKey when client IP is null while keeping account-scoped key active', () => {
      const unknownKeys = buildThrottleKeys(null, 'owner@crelune.test');
      expect(unknownKeys.scope).toBe('account_noip');
      expect(unknownKeys.ipKey).toBeNull();
      expect(unknownKeys.accountKey.startsWith('acct_noip:')).toBe(true);

      const knownKeys = buildThrottleKeys('203.0.113.5', 'owner@crelune.test');
      expect(knownKeys.scope).toBe('ip_and_account');
      expect(knownKeys.ipKey?.startsWith('ip:')).toBe(true);
      expect(knownKeys.accountKey.startsWith('ip_acct:')).toBe(true);
      expect(knownKeys.accountKey).not.toBe(unknownKeys.accountKey);
    });

    it('maps different textual forms of the same IPv6 to identical bucket keys', () => {
      const ipA = parseValidIp('2001:0DB8:0000::1');
      const ipB = parseValidIp('2001:db8::1');
      expect(ipA).toBe('2001:db8::1');
      expect(ipB).toBe('2001:db8::1');
      expect(buildThrottleKeys(ipA, 'owner@crelune.test')).toEqual(
        buildThrottleKeys(ipB, 'owner@crelune.test')
      );
    });

    it('never reports ipBlocked when client IP is unknown even if legacy placeholder rows existed', async () => {
      const legacySharedIpKey = buildThrottleKeys('direct-client', 'owner@crelune.test').ipKey!;
      mockState.throttles.set(legacySharedIpKey, {
        attempts: 99,
        windowStart: new Date(),
        blockedUntil: new Date(Date.now() + 60_000),
      });

      const status = await checkLoginThrottle(null, 'owner@crelune.test');
      expect(status.ipBlocked).toBe(false);
      expect(status.accountBlocked).toBe(false);
    });
  });

  describe('Opportunistic Cleanup Cooldown Gate', () => {
    it('skips cleanup queries when cold sample misses or cooldown window has not elapsed', async () => {
      const t0 = new Date('2026-11-11T12:00:00.000Z');

      // Cold worker misses 5% threshold -> 0 cleanup calls
      maybePruneExpiredThrottles(t0, () => 0.9);
      expect(mockState.executeRawCalls).toBe(0);

      // Cold worker hits 5% threshold -> runs 1 cleanup
      maybePruneExpiredThrottles(t0, () => 0.01);
      await vi.waitFor(() => {
        expect(mockState.executeRawCalls).toBe(1);
      });
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Subsequent login 1 minute later respects cooldown -> still 1 call
      maybePruneExpiredThrottles(new Date(t0.getTime() + 60_000), () => 0.01);
      expect(mockState.executeRawCalls).toBe(1);

      // After cooldown expires -> runs 2nd cleanup
      maybePruneExpiredThrottles(
        new Date(t0.getTime() + THROTTLE_CLEANUP_COOLDOWN_MS + 1),
        () => 0.99
      );
      await vi.waitFor(() => {
        expect(mockState.executeRawCalls).toBe(2);
      });
    });
  });
});
