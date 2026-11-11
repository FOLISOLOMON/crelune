# CRELUNE — Milestone 2.1.2: Rate-Limit Client Identity & PostgreSQL Verification Report

**Document:** Milestone 2.1.2 Remediation & Real PostgreSQL Concurrency Verification Report
**Project:** CRELUNE — Personal Creative and Media Operations Platform
**Version:** 1.0
**Baseline Parent Commit:** `8084163`
**Authoritative References:**
- Operating Instructions: [`.agents/AGENTS.md`](file:///d:/Projects/Crelune/.agents/AGENTS.md)
- Security Specification: [`docs/SECURITY.md`](file:///d:/Projects/Crelune/docs/SECURITY.md) (Section 10)
- Technical Decisions: [`docs/TECHNICAL_DECISIONS.md`](file:///d:/Projects/Crelune/docs/TECHNICAL_DECISIONS.md) (ADR 012)
- Testing Strategy: [`docs/TESTING_STRATEGY.md`](file:///d:/Projects/Crelune/docs/TESTING_STRATEGY.md) (Section 8)

---

## 1. Executive Summary

Milestone 2.1.2 resolves the client IP identity flaw in [`apps/web/src/lib/auth/rate-limit.ts`](file:///d:/Projects/Crelune/apps/web/src/lib/auth/rate-limit.ts), prevents shared-placeholder unknown-IP lockouts, adds bounded expired-record lifecycle pruning on `auth_throttles`, and verifies atomic PostgreSQL throttling concurrency directly against the project's Neon PostgreSQL database without modifying user or production application records.

---

## 2. Implemented Changes

### 2.1 Client IP Resolution & Validation (`rate-limit.ts`)
- Replaced `'direct-client'` / `'proxy-unknown'` string fallbacks with typed `string | null` via [`resolveClientIp`](file:///d:/Projects/Crelune/apps/web/src/lib/auth/rate-limit.ts) and [`extractClientIp`](file:///d:/Projects/Crelune/apps/web/src/lib/auth/rate-limit.ts).
- Added [`parseValidIp`](file:///d:/Projects/Crelune/apps/web/src/lib/auth/rate-limit.ts) using Node's native `node:net` `isIP()`:
  - Validates canonical IPv4, optional `a.b.c.d:port`, canonical IPv6 (lowercase RFC 5952 via `URL`), bracketed `[ipv6]:port`, and unwraps IPv4-mapped `::ffff:a.b.c.d`.
  - Rejects malformed octets (`999.1.2.3`, `1.2.3`), leading-zero octets (`01.02.03.04`), invalid ports, zone IDs (`fe80::1%eth0`), whitespace, and comma-joined values.
- **Trusted Proxy Configuration (`TRUST_PROXY=true`)**:
  - When `TRUST_PROXY !== 'true'` (default), all `X-Real-IP` and `X-Forwarded-For` headers are ignored and [`extractClientIp`](file:///d:/Projects/Crelune/apps/web/src/lib/auth/rate-limit.ts) returns `null`.
  - `TRUST_PROXY=true` must ONLY be set behind a trusted reverse proxy ingress configured to overwrite incoming forwarding headers from untrusted clients:
    1. Checks `X-Real-IP` first (accepted only as a single valid IP).
    2. Otherwise reads the **rightmost** entry of `X-Forwarded-For`, matching single-hop trusted ingress append/overwrite semantics so client-prepended entries (`X-Forwarded-For: 1.2.3.4`) cannot spoof client identity.

### 2.2 Unknown-IP Fallback & IP Aggregate Isolation
- **Known Client IP (`ip !== null`)**:
  - Tracks both `ip:<sha256(ip)>` (`20` failures / `15m` -> `429 Too many requests. Please try again later.`) and `ip_acct:<sha256(ip|email)>` (`5` failures / `15m` -> indistinguishable `401 Invalid email or password`).
- **Unknown Client IP (`ip === null`)**:
  - Skips the `ip:` aggregate bucket completely (`ipBlocked` is always `false`). Malicious visitors sending random/arbitrary emails without a trusted IP cannot exhaust a shared bucket to cause a global `429` lockout.
  - Preserves account-specific brute-force protection via `acct_noip:<sha256(email)>` (`5` failures / `15m` -> bounded `15m` block returning indistinguishable `401 Invalid email or password`, cleared on successful unknown-IP login and isolated from `ip_acct:` buckets when `TRUST_PROXY=true` is used).

### 2.3 `auth_throttles` Lifecycle & Bounded Opportunistic Cleanup
- Added `@@index([windowStart])` alongside `@@index([blockedUntil])` in [`AuthThrottle`](file:///d:/Projects/Crelune/packages/database/prisma/schema.prisma) and synchronized to Neon Postgres via `cmd /c npm run db:push`.
- Added [`pruneExpiredThrottles`](file:///d:/Projects/Crelune/apps/web/src/lib/auth/rate-limit.ts) deleting at most `THROTTLE_CLEANUP_BATCH_SIZE = 250` strictly expired rows per call:
  - Deletes rows matching `(blocked_until IS NOT NULL AND blocked_until <= now)` or `(blocked_until IS NULL AND window_start <= now - 15m)`.
  - Active blocks (`blocked_until > now`) and active unblocked windows (`window_start > now - 15m`) are never deleted.
- Added non-blocking [`maybePruneExpiredThrottles`](file:///d:/Projects/Crelune/apps/web/src/lib/auth/rate-limit.ts) throttled by an in-memory `10`-minute cooldown on warm processes and a `5%` sampling gate on cold worker starts, avoiding cleanup queries on normal logins and requiring zero paid services.

---

## 3. PostgreSQL Integration Verification Result

- **Environment Disclosure**: Running `cmd /c neon branches list` showed a single project default branch named `production` (`br-withered-moon-be8coj8h`, endpoint `ep-mute-forest-bepsjmsu`), which `.env.local` targets as the Milestone 2 development database (`neondb`). No production user/organisation records were read, modified, or created.
- **Test Scope & Isolation**: [`apps/web/src/lib/auth/rate-limit.pg.integration.test.ts`](file:///d:/Projects/Crelune/apps/web/src/lib/auth/rate-limit.pg.integration.test.ts) operates strictly on `auth_throttles` using synthetic run-scoped identifiers (`__pg_*`), tracks every created `bucketKey`, deletes ONLY those tracked test keys in `afterEach`/`afterAll`, and leaves `0` rows behind (`{"totalAuthThrottleRows":0}`).
- **Executed Command**: `cmd /c npm run test:integration:db`
- **Observed Result (`PASS`, `5/5` tests in `24.65s` after pool warmup)**:
  1. Concurrent `Promise.all` (`5` simultaneous failures) incremented `attempts` atomically to `5` and activated `blockedUntil` (`4915ms`).
  2. Additional attempts during an active block kept `attempts = 5` and left `blockedUntil` unchanged; after block expiry, check reported unblocked and next attempt reset `attempts = 1` (`3580ms`).
  3. Attacker IP block isolated from owner IP on the same account; `clearAccountThrottle` removed only the owner IP+account row (`3790ms`).
  4. IP aggregate threshold (`20` distinct accounts) blocked the flooding IP without affecting an independent IP (`4669ms`).
  5. Unknown IP (`null`) created `acct_noip:` only (zero `ip:` rows), and `pruneExpiredThrottles` deleted only expired test block/window rows while keeping active windows and blocks intact (`5219ms`).

---

## 4. Full Verification Summary

| Check | Exact Command | Status | Observed Output / Scope |
| :--- | :--- | :--- | :--- |
| Schema Sync & Package Build | `cmd /c "npm run db:push && npm run build --workspace=@crelune/database"` | **PASS** | Added `auth_throttles_window_start_idx` index on Neon Postgres and rebuilt Prisma Client |
| Unit & Route Tests | `cmd /c npm test` | **PASS** | `107` passed, `0` failed, `0` skipped across `8` files (`@crelune/web`: `90` across `6` files incl. `rate-limit.test.ts` `11` & `auth-routes.test.ts` `19`; `@crelune/shared`: `14`; `@crelune/ui`: `3`) |
| Real PostgreSQL Integration | `cmd /c npm run test:integration:db` | **PASS** | `5` passed, `0` failed against Neon `auth_throttles`; post-run table row count verified `0` |
| Type Checking | `cmd /c npm run type-check` | **PASS** | `tsc --noEmit` exited `0` across all 4 workspaces |
| Production Build | `cmd /c npm run build` | **PASS** | `next build` (`17` routes, Middleware `52.3 kB`) + workspace `tsc -b` succeeded |
| Standalone ESLint | `cmd /c npm run lint` | **NOT CONFIGURED** | `next lint` requires interactive initialization (unchanged from Milestone 2.1.1) |

---

## 5. Remaining Limitations & Operational Notes

- If CRELUNE is exposed to the public internet **without** a reverse proxy (`TRUST_PROXY=false`) or if the ingress proxy strips/fails to set `X-Real-IP` / `X-Forwarded-For`, requests share `acct_noip:<hash>` per target email, meaning a targeted brute-force campaign against the owner email can still rate-limit that email for bounded 15-minute intervals (though random-email probing can no longer cause a global `429` IP lockout). Production internet deployments should sit behind a trusted ingress with `TRUST_PROXY=true`.
- When using `TRUST_PROXY=true` behind chained proxies (e.g., CDN + load balancer), ingress must be configured to populate single-valued `X-Real-IP` (or strip external forwarding headers) so the client IP—not an intermediate proxy IP—is supplied.
- Before deploying a separate production environment, provision a dedicated Neon branch for production and keep `.env.local` pointed solely at a dedicated development branch.
