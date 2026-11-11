/**
 * CRELUNE — Durable PostgreSQL Authentication Rate Limiting & Client Identity
 *
 * Implements race-safe, PostgreSQL-backed throttling with strict client IP resolution:
 *
 *   When a trustworthy client IP IS established (`TRUST_PROXY=true` with valid proxy headers):
 *     1. Source IP + account identifier (`ip_acct`) — max 5 failures / 15m -> 15m block (401 indistinguishable)
 *     2. Source IP aggregate (`ip`) — max 20 failures / 15m -> 15m block (429 generic rate-limit)
 *
 *   When a trustworthy client IP CANNOT be established (`ip === null`):
 *     - No global/shared IP aggregate bucket is created or checked (prevents any visitor from
 *       exhausting a shared placeholder bucket and blocking the legitimate owner).
 *     - Account-specific abuse protection remains active via `acct_noip` (max 5 failures / 15m
 *       per account identifier -> bounded 15m block returning indistinguishable 401).
 *
 * Security & lifecycle properties:
 * - Unknown client IPs are NEVER mapped to a shared synthetic string (`direct-client` / `proxy-unknown`).
 * - `X-Real-IP` and `X-Forwarded-For` are completely ignored unless `TRUST_PROXY=true`.
 * - Atomic `INSERT ... ON CONFLICT DO UPDATE` prevents concurrent counter race conditions.
 * - Expired windows and expired blocks auto-reset; retries while blocked never extend `blocked_until`.
 * - Opportunistic bounded pruning (`pruneExpiredThrottles`) removes only strictly expired rows.
 */

import crypto from 'node:crypto';
import { isIP } from 'node:net';
import { prisma } from '@crelune/database';

export const IP_ACCOUNT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
export const IP_ACCOUNT_MAX_ATTEMPTS = 5;
export const IP_ACCOUNT_BLOCK_MS = 15 * 60 * 1000; // 15 minutes

export const IP_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
export const IP_MAX_ATTEMPTS = 20;
export const IP_BLOCK_MS = 15 * 60 * 1000; // 15 minutes

export const THROTTLE_CLEANUP_BATCH_SIZE = 250;
export const THROTTLE_CLEANUP_COOLDOWN_MS = 10 * 60 * 1000; // 10 minutes
export const THROTTLE_CLEANUP_COLD_SAMPLE_RATE = 0.05;

export interface ClientIpResolution {
  ip: string | null;
  source: 'trusted_proxy_x_real_ip' | 'trusted_proxy_x_forwarded_for' | 'unknown';
}

export interface ThrottleStatus {
  ipBlocked: boolean;
  accountBlocked: boolean;
}

export interface ThrottleRow {
  attempts: number;
  windowStart: Date;
  blockedUntil: Date | null;
}

let lastCleanupAtMs = 0;
let cleanupInFlight: Promise<number> | null = null;

/**
 * Validates and canonicalizes an IPv4 or IPv6 address (including optional port-suffixed IPv4
 * or bracketed IPv6, and unwrapping IPv4-mapped `::ffff:a.b.c.d` forms). Rejects malformed
 * addresses, zone IDs (`%`), leading-zero octets, and multi-address lists.
 */
export function parseValidIp(raw: string | null | undefined): string | null {
  if (!raw || typeof raw !== 'string') {
    return null;
  }

  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > 64 || /[\s,%\\/?#@]/.test(trimmed)) {
    return null;
  }

  let candidate = trimmed;

  // Handle bracketed IPv6, with optional `:port`, e.g. `[2001:db8::1]:443`
  if (candidate.startsWith('[')) {
    const match = /^\[([^\]]+)\](?::(\d{1,5}))?$/.exec(candidate);
    if (!match) {
      return null;
    }
    if (match[2]) {
      const port = Number(match[2]);
      if (!Number.isInteger(port) || port < 1 || port > 65535) {
        return null;
      }
    }
    candidate = match[1];
    if (isIP(candidate) !== 6) {
      return null;
    }
  } else {
    // Handle `a.b.c.d:port` (exactly 3 dots and single trailing `:port`)
    const ipv4PortMatch = /^(\d{1,3}(?:\.\d{1,3}){3}):(\d{1,5})$/.exec(candidate);
    if (ipv4PortMatch) {
      const port = Number(ipv4PortMatch[2]);
      if (!Number.isInteger(port) || port < 1 || port > 65535) {
        return null;
      }
      candidate = ipv4PortMatch[1];
    }
  }

  const ipVersion = isIP(candidate);
  if (ipVersion === 4) {
    return candidate;
  }

  if (ipVersion === 6) {
    // Unwrap IPv4-mapped IPv6 (`::ffff:a.b.c.d`) cleanly when present
    const v4Mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(candidate);
    if (v4Mapped && isIP(v4Mapped[1]) === 4) {
      return v4Mapped[1];
    }

    try {
      // Canonicalize IPv6 to lowercase compressed RFC 5952 representation
      return new URL(`http://[${candidate}]`).hostname.slice(1, -1).toLowerCase();
    } catch {
      return null;
    }
  }

  return null;
}

/**
 * Resolves the client IP safely.
 *
 * Proxy headers (`X-Real-IP` and the rightmost entry of `X-Forwarded-For`) are trusted
 * ONLY when `TRUST_PROXY=true` is explicitly set in a deployment whose trusted reverse proxy
 * overwrites `X-Real-IP` or sets/appends the true peer IP on `X-Forwarded-For`.
 *
 * Returns `{ ip: null, source: 'unknown' }` whenever client identity cannot be established.
 */
export function resolveClientIp(request: Request): ClientIpResolution {
  if (process.env.TRUST_PROXY !== 'true') {
    return { ip: null, source: 'unknown' };
  }

  // Prefer single-valued `x-real-ip` overwritten by trusted ingress
  const realIpHeader = request.headers.get('x-real-ip');
  if (realIpHeader !== null) {
    const parsedRealIp = parseValidIp(realIpHeader);
    if (parsedRealIp) {
      return { ip: parsedRealIp, source: 'trusted_proxy_x_real_ip' };
    }
    return { ip: null, source: 'unknown' };
  }

  // Otherwise inspect the rightmost entry of `x-forwarded-for`, which a single-hop trusted
  // ingress appends/overwrites (preventing spoofing via client-prepended left entries).
  const forwardedForHeader = request.headers.get('x-forwarded-for');
  if (forwardedForHeader !== null) {
    const segments = forwardedForHeader.split(',');
    const rightmost = segments[segments.length - 1];
    const parsedForwardedIp = parseValidIp(rightmost);
    if (parsedForwardedIp) {
      return { ip: parsedForwardedIp, source: 'trusted_proxy_x_forwarded_for' };
    }
  }

  return { ip: null, source: 'unknown' };
}

/**
 * Returns a canonical validated IPv4/IPv6 client address, or `null` when unknown.
 */
export function extractClientIp(request: Request): string | null {
  return resolveClientIp(request).ip;
}

export function hashBucketIdentifier(raw: string): string {
  return crypto.createHash('sha256').update(raw, 'utf8').digest('hex');
}

export function buildThrottleKeys(ip: string | null, normalizedEmail: string) {
  if (ip !== null) {
    return {
      scope: 'ip_and_account' as const,
      ipKey: `ip:${hashBucketIdentifier(ip)}`,
      accountKey: `ip_acct:${hashBucketIdentifier(`${ip}|${normalizedEmail}`)}`,
    };
  }

  return {
    scope: 'account_noip' as const,
    ipKey: null,
    accountKey: `acct_noip:${hashBucketIdentifier(normalizedEmail)}`,
  };
}

/**
 * Checks durable throttle buckets before password verification.
 * When `ip` is `null`, no shared IP aggregate bucket is consulted (`ipBlocked` is `false`).
 */
export async function checkLoginThrottle(
  ip: string | null,
  normalizedEmail: string,
  now: Date = new Date()
): Promise<ThrottleStatus> {
  const { ipKey, accountKey } = buildThrottleKeys(ip, normalizedEmail);
  const bucketKeys = ipKey ? [ipKey, accountKey] : [accountKey];

  const rows = await prisma.authThrottle.findMany({
    where: {
      bucketKey: { in: bucketKeys },
    },
    select: {
      bucketKey: true,
      blockedUntil: true,
    },
  });

  let ipBlocked = false;
  let accountBlocked = false;

  for (const row of rows) {
    if (row.blockedUntil && row.blockedUntil > now) {
      if (ipKey && row.bucketKey === ipKey) ipBlocked = true;
      if (row.bucketKey === accountKey) accountBlocked = true;
    }
  }

  return { ipBlocked, accountBlocked };
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
 * Deletes a bounded batch of strictly expired rows from `auth_throttles`.
 * Never deletes active blocks (`blocked_until > now`) or active unblocked windows.
 */
export async function pruneExpiredThrottles(options?: {
  now?: Date;
  batchSize?: number;
}): Promise<number> {
  const now = options?.now ?? new Date();
  const batchSize = Math.max(1, Math.min(1000, options?.batchSize ?? THROTTLE_CLEANUP_BATCH_SIZE));
  const maxWindowMs = Math.max(IP_WINDOW_MS, IP_ACCOUNT_WINDOW_MS);
  const windowCutoff = new Date(now.getTime() - maxWindowMs);

  const deletedCount = await prisma.$executeRaw`
    DELETE FROM auth_throttles
    WHERE bucket_key IN (
      SELECT bucket_key
      FROM auth_throttles
      WHERE (blocked_until IS NOT NULL AND blocked_until <= ${now})
         OR (blocked_until IS NULL AND window_start <= ${windowCutoff})
      LIMIT ${batchSize}
    );
  `;

  return Number(deletedCount) || 0;
}

/**
 * Opportunistic rate-limited cleanup gate so normal logins do not run cleanup queries
 * on every request, while preventing unbounded growth from random probing identifiers.
 */
export function maybePruneExpiredThrottles(
  now: Date = new Date(),
  randomFn: () => number = Math.random
): void {
  if (cleanupInFlight) {
    return;
  }

  const nowMs = now.getTime();
  if (lastCleanupAtMs === 0) {
    // On cold worker startup, only sample cleanly to avoid running cleanup on every invocation
    if (randomFn() >= THROTTLE_CLEANUP_COLD_SAMPLE_RATE) {
      return;
    }
  } else if (nowMs - lastCleanupAtMs < THROTTLE_CLEANUP_COOLDOWN_MS) {
    return;
  }

  lastCleanupAtMs = nowMs;
  cleanupInFlight = pruneExpiredThrottles({ now })
    .catch(() => 0)
    .finally(() => {
      cleanupInFlight = null;
    });
}

export function resetCleanupScheduleForTesting(): void {
  lastCleanupAtMs = 0;
  cleanupInFlight = null;
}

/**
 * Records a failed authentication attempt across applicable buckets.
 * When `ip` is `null`, skips IP aggregate throttling and tracks `acct_noip` only.
 */
export async function recordFailedLoginAttempt(
  ip: string | null,
  normalizedEmail: string,
  now: Date = new Date()
): Promise<ThrottleStatus> {
  const { ipKey, accountKey } = buildThrottleKeys(ip, normalizedEmail);

  let result: ThrottleStatus;

  if (ipKey !== null) {
    const [ipRow, acctRow] = await Promise.all([
      recordAtomicBucketFailure(ipKey, {
        now,
        windowMs: IP_WINDOW_MS,
        maxAttempts: IP_MAX_ATTEMPTS,
        blockMs: IP_BLOCK_MS,
      }),
      recordAtomicBucketFailure(accountKey, {
        now,
        windowMs: IP_ACCOUNT_WINDOW_MS,
        maxAttempts: IP_ACCOUNT_MAX_ATTEMPTS,
        blockMs: IP_ACCOUNT_BLOCK_MS,
      }),
    ]);

    result = {
      ipBlocked: Boolean(ipRow?.blockedUntil && ipRow.blockedUntil > now),
      accountBlocked: Boolean(acctRow?.blockedUntil && acctRow.blockedUntil > now),
    };
  } else {
    const acctRow = await recordAtomicBucketFailure(accountKey, {
      now,
      windowMs: IP_ACCOUNT_WINDOW_MS,
      maxAttempts: IP_ACCOUNT_MAX_ATTEMPTS,
      blockMs: IP_ACCOUNT_BLOCK_MS,
    });

    result = {
      ipBlocked: false,
      accountBlocked: Boolean(acctRow?.blockedUntil && acctRow.blockedUntil > now),
    };
  }

  maybePruneExpiredThrottles(now);
  return result;
}

/**
 * Clears the matching account throttle bucket after successful owner authentication
 * (`ip_acct` for known IP, or `acct_noip` when `ip` is `null`).
 */
export async function clearAccountThrottle(
  ip: string | null,
  normalizedEmail: string
): Promise<void> {
  const { accountKey } = buildThrottleKeys(ip, normalizedEmail);
  await prisma.authThrottle.deleteMany({
    where: { bucketKey: accountKey },
  });
  maybePruneExpiredThrottles();
}

export const clearIpAccountThrottle = clearAccountThrottle;
