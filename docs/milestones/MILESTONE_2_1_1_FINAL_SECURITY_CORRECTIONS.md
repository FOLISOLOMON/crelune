# CRELUNE — Milestone 2.1.1: Final Authentication Security Corrections Report

**Document:** Milestone 2.1.1 Completion & Remediation Verification Report
**Project:** CRELUNE — Personal Creative and Media Operations Platform
**Version:** 1.0
**Baseline Parent Commit:** `cb72f5f`
**Authoritative References:**
- Operating Instructions: [`.agents/AGENTS.md`](file:///d:/Projects/Crelune/.agents/AGENTS.md)
- Security Specification: [`docs/SECURITY.md`](file:///d:/Projects/Crelune/docs/SECURITY.md) (Section 9)
- Technical Decisions: [`docs/TECHNICAL_DECISIONS.md`](file:///d:/Projects/Crelune/docs/TECHNICAL_DECISIONS.md) (ADR 011)
- Testing Strategy: [`docs/TESTING_STRATEGY.md`](file:///d:/Projects/Crelune/docs/TESTING_STRATEGY.md) (Section 7)

---

## 1. Executive Summary

Milestone 2.1.1 addresses all six remaining authentication review findings identified after commit `cb72f5f` without altering committed history or introducing paid external dependencies:

1. **Login CSRF Protection (`POST /api/auth/login`)**: Enforced strict `Origin` / `Referer` validation (`403` on missing, malformed, or mismatched origins), removed the test-environment bypass on `POST /api/auth/logout`, and gated `x-forwarded-host` / `x-forwarded-proto` trust strictly behind explicit `TRUST_PROXY=true` alongside optional `APP_URL` / `ALLOWED_ORIGINS`.
2. **Anti-Lockout Durable PostgreSQL Rate Limiting**: Replaced global account lockout blocking (`User.lockedUntil`) with atomic PostgreSQL `INSERT ... ON CONFLICT (bucket_key) DO UPDATE` buckets on `auth_throttles` scoped by `(IP, normalized email)` and `IP`. Prevents remote IP A attackers from locking out the owner on IP B, eliminates concurrent counter races, avoids indefinite extension on repeated retries, auto-resets expired windows/blocks, and returns indistinguishable `401 Invalid email or password` on `(IP, account)` blocks (`429` only on pure IP floods).
3. **Fail-Closed Middleware Without Redirect Loops**: When `SESSION_SECRET` is missing or `< 32` characters, middleware fails closed with static `503` HTML (`Cache-Control: no-store`) for pages (including `/login`) and `503` JSON for protected APIs, while preserving public `GET /api/health` liveness (`{ status: "ok", timestamp }`).
4. **Edge Cryptographic Verification Parity**: Updated `verifySessionTokenEdge()` to verify exact raw HMAC-SHA256 bytes via Web Crypto `crypto.subtle.verify()`, strict base64url pattern and 32-byte length validation, and fatal UTF-8 decoding—achieving full parity with Node's `crypto.timingSafeEqual`.
5. **Real-Time Server-Side Session Revocation & Active Owner Check**: Added `User.sessionVersion` (`ver` token claim) and PostgreSQL-backed [`resolveAuthenticatedOwner`](file:///d:/Projects/Crelune/apps/web/src/lib/auth/owner-guard.ts) enforcing `isActive === true`, `role === 'OWNER'`, `organisationId`, and `sessionVersion` across dashboard SSR layout/pages, `/api/auth/me`, and `/api/health`. SSR renders [`SessionRevokedNotice`](file:///d:/Projects/Crelune/apps/web/src/components/auth/SessionRevokedNotice.tsx) when revoked so Edge middleware never loops with SSR redirects.
6. **Consistent Session Lifetime Validation**: Centralized `SESSION_TTL_SECONDS = 604800` and shared [`validateSessionPayload`](file:///d:/Projects/Crelune/packages/shared/src/schemas/auth.ts) enforcing `exp > iat`, `exp - iat <= 604800`, `exp > now`, and `iat <= now + 60` across Node and Edge.

---

## 2. Finding-by-Finding Remediation Matrix

| Finding | Implemented Correction | Key Files | Status |
| :--- | :--- | :--- | :--- |
| Missing CSRF validation on `POST /api/auth/login` & test bypass on logout | Shared [`validateRequestOrigin`](file:///d:/Projects/Crelune/apps/web/src/lib/auth/csrf.ts) checks `Origin`/`Referer` against host/allowlists; `TRUST_PROXY=true` required for proxy headers; test bypass removed on logout | [`csrf.ts`](file:///d:/Projects/Crelune/apps/web/src/lib/auth/csrf.ts), [`login/route.ts`](file:///d:/Projects/Crelune/apps/web/src/app/api/auth/login/route.ts), [`logout/route.ts`](file:///d:/Projects/Crelune/apps/web/src/app/api/auth/logout/route.ts) | **RESOLVED** |
| Global account lockout enabled DoS & non-atomic increments | Added [`AuthThrottle`](file:///d:/Projects/Crelune/packages/database/prisma/schema.prisma) (`auth_throttles`) with atomic PostgreSQL `ON CONFLICT DO UPDATE` for `(IP, email)` (`5/15m` -> `401`) and `IP` (`20/15m` -> `429`) | [`schema.prisma`](file:///d:/Projects/Crelune/packages/database/prisma/schema.prisma), [`rate-limit.ts`](file:///d:/Projects/Crelune/apps/web/src/lib/auth/rate-limit.ts) | **RESOLVED** |
| Missing `SESSION_SECRET` caused `/login` self-redirect loop | Middleware returns static `503` HTML (`Cache-Control: no-store`) on page routes including `/login` and `503` JSON on APIs; `GET /api/health` remains public liveness | [`middleware.ts`](file:///d:/Projects/Crelune/apps/web/src/middleware.ts) | **RESOLVED** |
| Edge verifier used string equality instead of `SubtleCrypto.verify()` | Replaced string comparison with Web Crypto `crypto.subtle.verify()` over decoded signature bytes + strict base64url + fatal UTF-8 decode | [`edge-session.ts`](file:///d:/Projects/Crelune/apps/web/src/lib/auth/edge-session.ts), [`session.ts`](file:///d:/Projects/Crelune/apps/web/src/lib/auth/session.ts) | **RESOLVED** |
| Deactivated/revoked owners retained access until cookie expiry | Added `User.sessionVersion` (`ver` claim) + server-side [`resolveAuthenticatedOwner`](file:///d:/Projects/Crelune/apps/web/src/lib/auth/owner-guard.ts) + [`SessionRevokedNotice`](file:///d:/Projects/Crelune/apps/web/src/components/auth/SessionRevokedNotice.tsx) | [`owner-guard.ts`](file:///d:/Projects/Crelune/apps/web/src/lib/auth/owner-guard.ts), [`me/route.ts`](file:///d:/Projects/Crelune/apps/web/src/app/api/auth/me/route.ts), [`health/route.ts`](file:///d:/Projects/Crelune/apps/web/src/app/api/health/route.ts), [`(dashboard)/layout.tsx`](file:///d:/Projects/Crelune/apps/web/src/app/(dashboard)/layout.tsx) | **RESOLVED** |
| Edge/Node omitted `exp > iat` and `exp - iat <= TTL` checks | Added shared [`validateSessionPayload`](file:///d:/Projects/Crelune/packages/shared/src/schemas/auth.ts) with `SESSION_TTL_SECONDS = 604800` enforced identically in Node and Edge | [`packages/shared/src/schemas/auth.ts`](file:///d:/Projects/Crelune/packages/shared/src/schemas/auth.ts) | **RESOLVED** |

---

## 3. Trade-Offs, Recovery & Performance Notes

- **Anti-Lockout Trade-Off**: Scoping login throttling to `(IP, email)` and `IP` eliminates single/few-IP owner lockout DoS without requiring paid Redis/Upstash infrastructure. Distributed multi-IP credential stuffing remains constrained per IP, reinforced by scrypt cost and strong password requirements, and can be supplemented with edge WAF rules in future hosting if needed.
- **Schema Compatibility**: `User.failedLoginAttempts` and `User.lockedUntil` remain non-destructively in `users` with deprecation comments alongside the new `User.sessionVersion` column (`DEFAULT 1`) and `auth_throttles` table, avoiding destructive data loss on the live Neon database.
- **Session Revocation Recovery & Performance**:
  - Revoking active owner sessions immediately requires incrementing `users.session_version` (or toggling `users.is_active = false`), rejecting existing cookies on the next SSR page load or API request.
  - Because [`resolveAuthenticatedOwner`](file:///d:/Projects/Crelune/apps/web/src/lib/auth/owner-guard.ts) executes one indexed primary-key query per protected SSR request or private API call, active checks add ~1–5 ms on warm pooled Neon connections (and wake latency if Neon Lakebase Postgres has autosuspended).
  - Throttle buckets expire automatically after 15 minutes (`window_start` / `blocked_until`) or clear immediately for `(IP, account)` upon a valid owner login.

---

## 4. Verification Evidence & Honest Status

| Check | Exact Command / Method | Result | Scope & Notes |
| :--- | :--- | :--- | :--- |
| Schema Sync | `cmd /c npm run db:push` | **PASS** | Pushed `users.session_version` and `auth_throttles` to Neon Postgres; regenerated Prisma Client |
| Package Builds | `cmd /c npm run build` | **PASS** | Compiled `@crelune/web` (17 routes, Middleware `52.3 kB`), `@crelune/database`, `@crelune/shared`, `@crelune/ui` |
| Type Checking | `cmd /c npm run type-check` | **PASS** | Zero TypeScript errors across all 4 workspaces (`tsc --noEmit`) |
| Unit & Route Tests | `cmd /c npm test` | **PASS** | 95/95 tests passing (`@crelune/web`: 78 across 5 files; `@crelune/shared`: 14; `@crelune/ui`: 3). Route handler & concurrency throttle tests run with mocked Prisma/cookie store |
| Live HTTP Tests | Ephemeral `next start` (`127.0.0.1:3109` & `3110`) | **PASS** | Verified real Next.js runtime with `.env.local` and empty `SESSION_SECRET` (`307`, `200`, `401`, `403`, `503` non-loop, minimal `/api/health`) without mutating Neon owner data |
| Standalone ESLint | `cmd /c npm run lint` | **NOT CONFIGURED** | `next lint` prompts interactively to create ESLint config and exits `1`; Next.js built-in type/lint validation passes during `next build` |
| Browser E2E UI | Playwright / browser test | **NOT RUN** | No headless browser suite configured for Milestone 2.1.1; verified via SSR/route unit tests and live `next start` HTTP requests |

---

## 5. Remaining Scope Boundaries

- Public registration, invitations, multi-tenancy, and Milestone 3+ domain features (`Members`, `Birthdays`, `Design Management`) remain intentionally unimplemented in compliance with the Milestone 2 boundary.
