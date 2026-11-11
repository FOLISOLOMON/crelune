/**
 * CRELUNE — Durable PostgreSQL Authentication Rate Limiting & Throttling
 *
 * Implements race-safe, PostgreSQL-backed throttling scoped by:
 *   1. Source IP + account identifier (`ip_acct`) — max 5 failures / 15m -> 15m block (401 indistinguishable)
 *   2. Source IP (`ip`) — max 20 failures / 15m -> 15m IP block (429 generic rate-limit)
 *
 * Security properties:
 * - Atomic `INSERT ... ON CONFLICT DO UPDATE` prevents concurrent counter race conditions.
 * - Expired windows and expired blocks automatically reset on the next attempt.
 * - Retrying while already blocked never extends `blocked_until` (prevents indefinite lockout).
 * - External attackers on different IPs cannot lock out the legitimate owner's IP.
 * - Tracked identically for existing and non-existing accounts (prevents enumeration).
 */

import crypto from 'node:crypto';
import { prisma } from '@crelune/database';

export const IP_ACCOUNT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
export const IP_ACCOUNT_MAX_ATTEMPTS = 5;
export const IP_ACCOUNT_BLOCK_MS = 15 * 60 * 1000; // 15 minutes

export const IP_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
export const IP_MAX_ATTEMPTS = 20;
export const IP_BLOCK_MS = 15 * 60 * 1000; // 15 minutes

export interface ThrottleStatus {
  ipBlocked: boolean;
  ipAccountBlocked: boolean;
}

export interface ThrottleRow {
  attempts: number;
  windowStart: Date;
  blockedUntil: Date | null;
}

/**
 * Extracts client IP safely. Proxy headers (`x-forwarded-for`, `x-real-ip`)
 * are ignored unless `TRUST_PROXY=true` is explicitly configured.
 */
export function extractClientIp(request: Request): string {
  if (process.env.TRUST_PROXY === 'true') {
    const forwardedFor = request.headers.get('x-forwarded-for');
    if (forwardedFor) {
      const firstIp = forwardedFor.split(',')[0]?.trim();
      if (firstIp && firstIp.length <= 64 && /^[0-9a-fA-F:.]+$/.test(firstIp)) {
        return firstIp;
      }
    }
    const realIp = request.headers.get('x-real-ip')?.trim();
    if (realIp && realIp.length <= 64 && /^[0-9a-fA-F:.]+$/.test(realIp)) {
      return realIp;
    }
    return 'proxy-unknown';
  }

  return 'direct-client';
}

export function hashBucketIdentifier(raw: string): string {
  return crypto.createHash('sha256').update(raw, 'utf8').digest('hex');
}

export function buildThrottleKeys(ip: string, normalizedEmail: string) {
  return {
    ipKey: `ip:${hashBucketIdentifier(ip)}`,
    ipAccountKey: `ip_acct:${hashBucketIdentifier(`${ip}|${normalizedEmail}`)}`,
  };
}

/**
 * Checks durable throttle buckets before password verification.
 */
export async function checkLoginThrottle(
  ip: string,
  normalizedEmail: string,
  now: Date = new Date()
): Promise<ThrottleStatus> {
  const { ipKey, ipAccountKey } = buildThrottleKeys(ip, normalizedEmail);

  const rows = await prisma.authThrottle.findMany({
    where: {
      bucketKey: { in: [ipKey, ipAccountKey] },
    },
    select: {
      bucketKey: true,
      blockedUntil: true,
    },
  });

  let ipBlocked = false;
  let ipAccountBlocked = false;

  for (const row of rows) {
    if (row.blockedUntil && row.blockedUntil > now) {
      if (row.bucketKey === ipKey) ipBlocked = true;
      if (row.bucketKey === ipAccountKey) ipAccountBlocked = true;
    }
  }

  return { ipBlocked, ipAccountBlocked };
}

/**
 * Atomically increments a single durable throttle bucket in PostgreSQL.
 * Race-safe under concurrent requests via row-level lock on `ON CONFLICT (bucket_key)`.
 */
export async function recordAtomicBucketFailure(
  bucketKey: string,
  options: {
    now: Date;
    windowMs: number;
    maxAttempts: number;
    blockMs: number;
  }
): Promise<ThrottleRow> {
  const { now, windowMs, maxAttempts, blockMs } = options;
  const windowCutoff = new Date(now.getTime() - windowMs);
  const blockUntil = new Date(now.getTime() + blockMs);
  const initialBlockedUntil = maxAttempts <= 1 ? blockUntil : null;

  const rows = await prisma.$queryRaw<ThrottleRow[]>`
    INSERT INTO auth_throttles (bucket_key, attempts, window_start, blocked_until, updated_at)
    VALUES (${bucketKey}, 1, ${now}, ${initialBlockedUntil}, ${now})
    ON CONFLICT (bucket_key) DO UPDATE SET
      attempts = CASE
        WHEN (auth_throttles.blocked_until IS NOT NULL AND auth_throttles.blocked_until <= ${now})
          OR (auth_throttles.blocked_until IS NULL AND auth_throttles.window_start <= ${windowCutoff})
        THEN 1
        WHEN auth_throttles.blocked_until IS NOT NULL AND auth_throttles.blocked_until > ${now}
        THEN auth_throttles.attempts
        ELSE auth_throttles.attempts + 1
      END,
      window_start = CASE
        WHEN (auth_throttles.blocked_until IS NOT NULL AND auth_throttles.blocked_until <= ${now})
          OR (auth_throttles.blocked_until IS NULL AND auth_throttles.window_start <= ${windowCutoff})
        THEN ${now}
        ELSE auth_throttles.window_start
      END,
      blocked_until = CASE
        WHEN (auth_throttles.blocked_until IS NOT NULL AND auth_throttles.blocked_until <= ${now})
          OR (auth_throttles.blocked_until IS NULL AND auth_throttles.window_start <= ${windowCutoff})
        THEN ${initialBlockedUntil}
        WHEN auth_throttles.blocked_until IS NOT NULL AND auth_throttles.blocked_until > ${now}
        THEN auth_throttles.blocked_until
        WHEN auth_throttles.attempts + 1 >= ${maxAttempts}
        THEN ${blockUntil}
        ELSE NULL
      END,
      updated_at = ${now}
    RETURNING attempts, window_start AS "windowStart", blocked_until AS "blockedUntil";
  `;

  return rows[0];
}

/**
 * Records a failed authentication attempt across both IP and (IP, account) buckets.
 */
export async function recordFailedLoginAttempt(
  ip: string,
  normalizedEmail: string,
  now: Date = new Date()
): Promise<ThrottleStatus> {
  const { ipKey, ipAccountKey } = buildThrottleKeys(ip, normalizedEmail);

  const [ipRow, ipAcctRow] = await Promise.all([
    recordAtomicBucketFailure(ipKey, {
      now,
      windowMs: IP_WINDOW_MS,
      maxAttempts: IP_MAX_ATTEMPTS,
      blockMs: IP_BLOCK_MS,
    }),
    recordAtomicBucketFailure(ipAccountKey, {
      now,
      windowMs: IP_ACCOUNT_WINDOW_MS,
      maxAttempts: IP_ACCOUNT_MAX_ATTEMPTS,
      blockMs: IP_ACCOUNT_BLOCK_MS,
    }),
  ]);

  return {
    ipBlocked: Boolean(ipRow?.blockedUntil && ipRow.blockedUntil > now),
    ipAccountBlocked: Boolean(ipAcctRow?.blockedUntil && ipAcctRow.blockedUntil > now),
  };
}

/**
 * Clears the (IP, account) throttle bucket after successful owner authentication.
 */
export async function clearIpAccountThrottle(
  ip: string,
  normalizedEmail: string
): Promise<void> {
  const { ipAccountKey } = buildThrottleKeys(ip, normalizedEmail);
  await prisma.authThrottle.deleteMany({
    where: { bucketKey: ipAccountKey },
  });
}
