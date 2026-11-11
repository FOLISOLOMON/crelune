import crypto from 'node:crypto';
import { describe, it, expect, beforeAll, afterEach, afterAll } from 'vitest';
import { prisma } from '@crelune/database';
import { assertSafeDevDatabaseEnvironment } from '@/test/assert-dev-db';
import {
  IP_ACCOUNT_BLOCK_MS,
  IP_ACCOUNT_MAX_ATTEMPTS,
  IP_BLOCK_MS,
  IP_MAX_ATTEMPTS,
  buildThrottleKeys,
  checkLoginThrottle,
  clearAccountThrottle,
  pruneExpiredThrottles,
  recordAtomicBucketFailure,
  recordFailedLoginAttempt,
} from './rate-limit';

describe('PostgreSQL auth_throttles Integration Verification (Milestone 2.1.2)', () => {
  const runId = crypto.randomBytes(6).toString('hex');
  const createdBucketKeys = new Set<string>();

  function trackIpAndEmail(ip: string | null, email: string): string[] {
    const { ipKey, accountKey } = buildThrottleKeys(ip, email);
    if (ipKey) createdBucketKeys.add(ipKey);
    createdBucketKeys.add(accountKey);
    return ipKey ? [ipKey, accountKey] : [accountKey];
  }

  async function cleanupTrackedRows() {
    if (createdBucketKeys.size === 0) return;
    const keys = Array.from(createdBucketKeys);
    await prisma.authThrottle.deleteMany({
      where: { bucketKey: { in: keys } },
    });
    createdBucketKeys.clear();
  }

  beforeAll(async () => {
    assertSafeDevDatabaseEnvironment(process.env);
    // Wake Neon compute & verify database identity before timing concurrency tests
    const rows = await prisma.$queryRaw<Array<{ db: string }>>`SELECT current_database() AS db`;
    if (rows[0]?.db !== 'neondb') {
      throw new Error(`Unexpected database name "${rows[0]?.db}" for integration test.`);
    }
  }, 30_000);

  afterEach(async () => {
    await cleanupTrackedRows();
  });

  afterAll(async () => {
    await cleanupTrackedRows();
    await prisma.$disconnect();
  });

  it('increments counters atomically under concurrent PostgreSQL upserts and activates block at threshold', async () => {
    const ip = `203.0.113.${10 + (parseInt(runId.slice(0, 2), 16) % 200)}`;
    const email = `__pg_concurrent_${runId}@invalid.crelune.test`;
    const [, accountKey] = trackIpAndEmail(ip, email);

    const now = new Date();
    const results = await Promise.all(
      Array.from({ length: IP_ACCOUNT_MAX_ATTEMPTS }, () =>
        recordFailedLoginAttempt(ip, email, now)
      )
    );

    expect(results.some((r) => r.accountBlocked)).toBe(true);

    const dbRow = await prisma.authThrottle.findUnique({
      where: { bucketKey: accountKey },
    });
    expect(dbRow).not.toBeNull();
    expect(dbRow!.attempts).toBe(IP_ACCOUNT_MAX_ATTEMPTS);
    expect(dbRow!.blockedUntil).not.toBeNull();
    expect(dbRow!.blockedUntil!.getTime()).toBeGreaterThan(now.getTime());

    const status = await checkLoginThrottle(ip, email, now);
    expect(status.accountBlocked).toBe(true);
    expect(status.ipBlocked).toBe(false);
  }, 20_000);

  it('does not extend blockedUntil on repeated attempts during an active block and resets on expiry', async () => {
    const ip = `198.51.100.${10 + (parseInt(runId.slice(2, 4), 16) % 200)}`;
    const email = `__pg_expiry_${runId}@invalid.crelune.test`;
    trackIpAndEmail(ip, email);
    const { accountKey } = buildThrottleKeys(ip, email);

    const t0 = new Date();
    for (let i = 0; i < IP_ACCOUNT_MAX_ATTEMPTS; i++) {
      await recordAtomicBucketFailure(accountKey, {
        now: t0,
        windowMs: IP_ACCOUNT_BLOCK_MS,
        maxAttempts: IP_ACCOUNT_MAX_ATTEMPTS,
        blockMs: IP_ACCOUNT_BLOCK_MS,
      });
    }

    const initialRow = await prisma.authThrottle.findUnique({
      where: { bucketKey: accountKey },
    });
    const initialBlockedUntil = initialRow!.blockedUntil!;

    // Retry 5 minutes into active block — must NOT extend blockedUntil
    const tRetry = new Date(t0.getTime() + 5 * 60 * 1000);
    await recordAtomicBucketFailure(accountKey, {
      now: tRetry,
      windowMs: IP_ACCOUNT_BLOCK_MS,
      maxAttempts: IP_ACCOUNT_MAX_ATTEMPTS,
      blockMs: IP_ACCOUNT_BLOCK_MS,
    });

    const afterRetryRow = await prisma.authThrottle.findUnique({
      where: { bucketKey: accountKey },
    });
    expect(afterRetryRow!.blockedUntil!.getTime()).toBe(initialBlockedUntil.getTime());
    expect(afterRetryRow!.attempts).toBe(IP_ACCOUNT_MAX_ATTEMPTS);

    // After block expires, check reports unblocked and next failure resets counter cleanly
    const tExpired = new Date(initialBlockedUntil.getTime() + 2000);
    const unblocked = await checkLoginThrottle(ip, email, tExpired);
    expect(unblocked.accountBlocked).toBe(false);

    const resetRow = await recordAtomicBucketFailure(accountKey, {
      now: tExpired,
      windowMs: IP_ACCOUNT_BLOCK_MS,
      maxAttempts: IP_ACCOUNT_MAX_ATTEMPTS,
      blockMs: IP_ACCOUNT_BLOCK_MS,
    });
    expect(resetRow.attempts).toBe(1);
    expect(resetRow.blockedUntil).toBeNull();
  });

  it('isolates independent client IPs and clears only the authenticated IP+account bucket on success', async () => {
    const attackerIp = '198.51.100.201';
    const ownerIp = '203.0.113.202';
    const sharedEmail = `__pg_isolation_${runId}@invalid.crelune.test`;

    trackIpAndEmail(attackerIp, sharedEmail);
    trackIpAndEmail(ownerIp, sharedEmail);

    const now = new Date();
    await Promise.all(
      Array.from({ length: IP_ACCOUNT_MAX_ATTEMPTS }, () =>
        recordFailedLoginAttempt(attackerIp, sharedEmail, now)
      )
    );

    await recordFailedLoginAttempt(ownerIp, sharedEmail, now);
    await recordFailedLoginAttempt(ownerIp, sharedEmail, now);

    expect((await checkLoginThrottle(attackerIp, sharedEmail, now)).accountBlocked).toBe(true);
    expect((await checkLoginThrottle(ownerIp, sharedEmail, now)).accountBlocked).toBe(false);

    await clearAccountThrottle(ownerIp, sharedEmail);

    const { accountKey: ownerAcctKey } = buildThrottleKeys(ownerIp, sharedEmail);
    const { accountKey: attackerAcctKey } = buildThrottleKeys(attackerIp, sharedEmail);

    expect(
      await prisma.authThrottle.findUnique({ where: { bucketKey: ownerAcctKey } })
    ).toBeNull();
    expect(
      await prisma.authThrottle.findUnique({ where: { bucketKey: attackerAcctKey } })
    ).not.toBeNull();
  });

  it('enforces IP aggregate threshold cleanly across distinct accounts without cross-IP leakage', async () => {
    const floodIp = '192.0.2.210';
    const otherIp = '192.0.2.211';
    const now = new Date();

    const tasks: Promise<unknown>[] = [];
    for (let i = 0; i < IP_MAX_ATTEMPTS; i++) {
      const email = `__pg_flood_${runId}_${i}@invalid.crelune.test`;
      trackIpAndEmail(floodIp, email);
      tasks.push(recordFailedLoginAttempt(floodIp, email, now));
    }
    await Promise.all(tasks);

    const floodCheck = await checkLoginThrottle(
      floodIp,
      `__pg_flood_target_${runId}@invalid.crelune.test`,
      now
    );
    const otherCheck = await checkLoginThrottle(
      otherIp,
      `__pg_flood_target_${runId}@invalid.crelune.test`,
      now
    );

    expect(floodCheck.ipBlocked).toBe(true);
    expect(otherCheck.ipBlocked).toBe(false);

    const { ipKey } = buildThrottleKeys(floodIp, 'x');
    const ipRow = await prisma.authThrottle.findUnique({ where: { bucketKey: ipKey! } });
    expect(ipRow!.attempts).toBe(IP_MAX_ATTEMPTS);
    expect(ipRow!.blockedUntil!.getTime()).toBe(now.getTime() + IP_BLOCK_MS);
  });

  it('uses acct_noip without creating ip: buckets when client IP is unknown and prunes only expired rows', async () => {
    const unknownEmail = `__pg_noip_${runId}@invalid.crelune.test`;
    const [acctNoIpKey] = trackIpAndEmail(null, unknownEmail);

    const now = new Date();
    await Promise.all(
      Array.from({ length: IP_ACCOUNT_MAX_ATTEMPTS }, () =>
        recordFailedLoginAttempt(null, unknownEmail, now)
      )
    );

    expect(acctNoIpKey.startsWith('acct_noip:')).toBe(true);
    const status = await checkLoginThrottle(null, unknownEmail, now);
    expect(status.ipBlocked).toBe(false);
    expect(status.accountBlocked).toBe(true);

    const expiredBlockKey = `__pg_exp_block_${runId}`;
    const expiredWindowKey = `__pg_exp_win_${runId}`;
    const activeWindowKey = `__pg_act_win_${runId}`;
    createdBucketKeys.add(expiredBlockKey);
    createdBucketKeys.add(expiredWindowKey);
    createdBucketKeys.add(activeWindowKey);

    await prisma.authThrottle.createMany({
      data: [
        {
          bucketKey: expiredBlockKey,
          attempts: 5,
          windowStart: new Date(now.getTime() - 30 * 60 * 1000),
          blockedUntil: new Date(now.getTime() - 1000),
        },
        {
          bucketKey: expiredWindowKey,
          attempts: 2,
          windowStart: new Date(now.getTime() - 20 * 60 * 1000),
          blockedUntil: null,
        },
        {
          bucketKey: activeWindowKey,
          attempts: 2,
          windowStart: new Date(now.getTime() - 2 * 60 * 1000),
          blockedUntil: null,
        },
      ],
    });

    const pruned = await pruneExpiredThrottles({ now, batchSize: 100 });
    expect(pruned).toBeGreaterThanOrEqual(2);

    const remaining = await prisma.authThrottle.findMany({
      where: {
        bucketKey: {
          in: [acctNoIpKey, expiredBlockKey, expiredWindowKey, activeWindowKey],
        },
      },
      select: { bucketKey: true },
    });
    const remainingKeys = remaining.map((r) => r.bucketKey).sort();
    expect(remainingKeys).toEqual([acctNoIpKey, activeWindowKey].sort());
  });
});
