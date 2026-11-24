# CRELUNE — Milestone 6, Stage 6.1 Completion Report: Mobile Authentication, Device Sessions, Unified Guards & Dashboard API

**Document:** Stage 6.1 Verification & Delivery Report  
**Project:** CRELUNE  
**Milestone:** Milestone 6 — Mobile Application (Stage 6.1 Backend & Shared Preparation)  
**Baseline Commit:** `f9b1b5a63eeab2310098e53caf6c215e7d516ca9`  
**Final Stage 6.1 Commit:** `9437b31f6a2b83b1f58f4c14e2c4bae8bdd4fc61`  
**Branch:** `main`  
**Status:** Stage 6.1 Accepted & Closed (Final M3–M5 PostgreSQL Regression Verified)

---

## 1. Stage Scope & Explicit Boundaries

Stage 6.1 delivers strictly the backend, database, shared contract, and Web Settings security foundation required before scaffolding the native mobile application:

- Shared mobile authentication contracts and RN-safe color token subpath (`@crelune/shared`, `@crelune/ui/colors`).
- Non-destructive PostgreSQL schema additions and PostgreSQL CHECK integrity constraints validated strictly on Neon `development` (`br-nameless-silence-bexjp44k`).
- Per-device mobile session management with cryptographically random single-use rotating refresh tokens stored exclusively as SHA-256 hashes, 15-minute signed mobile access tokens, hard 30-day session family cap, atomic concurrency-safe rotation, confirmed replay token-family revocation, and independent device revocation.
- Unified owner authentication guards (`middleware.ts`, `owner-guard.ts`, `api-owner-guard.ts`) separating Mobile Bearer authentication from existing Web Cookie + CSRF protection while rejecting ambiguous mixed credentials (`400`) and query-string tokens.
- `GET /api/dashboard`, `GET/PATCH /api/settings/notifications`, Bearer-capable `GET /api/auth/me`, and Web Settings connected mobile device visibility & one-click revocation (`MobileDevicesCard`).

**Explicitly Deferred (Not Implemented in Stage 6.1):**
- Stage 6.2+: `apps/mobile` Expo / React Native scaffold, native navigation, screens, and EAS configuration.
- Stage 6.6: Expo push token registration endpoint (`POST /api/mobile/push-token`) and Expo Push API delivery worker/dispatcher (`PushDelivery` schema is prepared now; delivery service is intentionally deferred to Stage 6.6).
- Production Neon branch (`br-withered-moon-be8coj8h`, `ep-mute-forest-bepsjmsu`): **Untouched**.

---

## 2. Database Schema & Non-Destructive Migration Evidence

### 2.1 Additive Schema Additions
- [`packages/database/prisma/schema.prisma`](file:///d:/Projects/Crelune/packages/database/prisma/schema.prisma):
  - Enums: `MobilePlatform` (`ANDROID`, `IOS`), `PushDeliveryStatus` (`PENDING`, `SENT`, `FAILED`, `RECEIPT_ERROR`, `SKIPPED`).
  - Models:
    - `MobileDevice` (`mobile_devices`): per-device installation binding (`@@unique([organisationId, userId, deviceInstallId])`), composite org-scoped key (`@@unique([organisationId, id])`), platform, device/OS/app metadata, nullable `expoPushToken`, revocation timestamp/actor/reason, and `lastSeenAt`.
    - `MobileSession` (`mobile_sessions`): per-session rotation record linked via composite org-scoped FK to `MobileDevice`, carrying `familyId`, `sessionVersion`, unique 64-char SHA-256 `refreshTokenHash`, immutable `familyExpiresAt` (30-day hard cap), `expiresAt`, `replacedBySessionId`, and `revokedAt`/`revocationReason`.
    - `PushDelivery` (`push_deliveries`): additive schema preparation for Stage 6.6 with idempotent `@@unique([notificationId, mobileDeviceId])` and composite org-scoped FKs to `Notification` (`notifications(organisation_id, id)`) and `MobileDevice`.
  - Additive columns on `UserPreference` (`user_preferences`, all default-backed `true`): `pushNotificationsEnabled`, `pushBirthdayReminders`, `pushDesignUpdates`.
  - Composite unique key `@@unique([organisationId, id])` on `Notification` (`notifications`) for org-scoped `PushDelivery` FK enforcement.

### 2.2 Explicit Non-Destructive SQL Scripts
- [`packages/database/prisma/sql/milestone_6_1_mobile_schema.sql`](file:///d:/Projects/Crelune/packages/database/prisma/sql/milestone_6_1_mobile_schema.sql): Strictly additive DDL (zero `DROP`, zero `TRUNCATE`, zero destructive alters), executed directly against Neon `development` (`DATABASE_URL_UNPOOLED`).
- [`packages/database/prisma/sql/milestone_6_1_mobile_integrity.sql`](file:///d:/Projects/Crelune/packages/database/prisma/sql/milestone_6_1_mobile_integrity.sql) (`npm run db:integrity:mobile`): Idempotent PostgreSQL `CHECK` constraints enforced directly by PostgreSQL:
  - `chk_mobile_sessions_refresh_hash_sha256`: `char_length(refresh_token_hash) = 64 AND refresh_token_hash ~ '^[0-9a-f]{64}$'` (blocks plaintext refresh tokens at DB engine level).
  - `chk_mobile_sessions_lifetime_cap`: `expires_at <= family_expires_at AND family_expires_at <= created_at + interval '30 days' + interval '5 seconds'` (blocks lifetime extension beyond 30 days at DB engine level).
  - `chk_mobile_sessions_rotated_is_revoked`: `replaced_by_session_id IS NULL OR revoked_at IS NOT NULL` (guarantees every rotated session is immediately revoked).

### 2.3 Neon `development` Verification
- **Target Verified:** Branch `development` (`br-nameless-silence-bexjp44k`), direct host `ep-muddy-math-ben8e8p7.c-9.us-east-2.aws.neon.tech`, pooled host `ep-muddy-math-ben8e8p7-pooler.c-9.us-east-2.aws.neon.tech`, database `neondb`.
- **Zero Drift Proof (`prisma migrate diff --from-url $DATABASE_URL_UNPOOLED --to-schema-datamodel packages/database/prisma/schema.prisma --script`):** Returned `-- This is an empty migration.` (`PASS`).
- **Constraints & Triggers Verified (`pg_constraint` / `pg_trigger`):** All 3 `chk_mobile_sessions_*` constraints and all 3 Milestone 5.1.2 triggers (`trg_creative_job_dispatches_template_consistency`, `trg_design_jobs_template_consistency`, `trg_template_versions_immutability`) confirmed active (`PASS`).
- **Post-Test Hygiene:** `0` residual `__pg*` organisations/users, `0` test rows in `mobile_devices`, `mobile_sessions`, `push_deliveries`, `auth_throttles`, and preserved single workspace owner (`totalOrgs: 1`, `totalUsers: 1`). Neon `production` untouched.

---

## 3. Authentication Architecture & Security Guarantees

1. **Domain-Separated Signed Mobile Access Tokens (`15m` Max TTL):**
   - Wire format: `cln_mob_at.<base64url-payload>.<base64url-hmac-sha256>`, signed with domain prefix `crelune.mobile_access.v1.<payload>` using mandatory `SESSION_SECRET` (`>= 32` chars, fail-closed, zero fallback secrets).
   - Identical validation in Node ([`mobile-token.ts`](file:///d:/Projects/Crelune/apps/web/src/lib/auth/mobile-token.ts)) and Edge Web Crypto ([`edge-session.ts`](file:///d:/Projects/Crelune/apps/web/src/lib/auth/edge-session.ts)) via [`validateMobileAccessPayload`](file:///d:/Projects/Crelune/packages/shared/src/schemas/mobile.ts): enforces `typ: 'mobile_access'`, `iss: 'crelune-api'`, `aud: 'crelune-mobile'`, `role: 'OWNER'`, `exp - iat <= 900`, `exp > now`, clock skew `iat <= now + 60`, `ver`, `dev`, and `sid`.
   - Domain separation prevents cross-transport token replay: web cookie tokens cannot authenticate as Mobile Bearer tokens, and Mobile Bearer tokens cannot authenticate as Web cookies or access web HTML pages.
2. **Single-Use Rotating Refresh Tokens & Replay Family Revocation:**
   - 256-bit cryptographically random secrets (`cln_mob_rt_<64-hex>`) hashed via SHA-256 before persistence.
   - [`refreshMobileSession`](file:///d:/Projects/Crelune/apps/web/src/lib/auth/mobile-auth-service.ts) acquires strict deadlock-free PostgreSQL locks: **L0 `users` (`FOR SHARE`) -> L1 `mobile_devices` (`FOR UPDATE`) -> L2 `mobile_sessions` (`ORDER BY id ASC FOR UPDATE`)**.
   - Concurrent refresh requests on the same refresh token serialize deterministically: strictly one succeeds; the second observes `replacedBySessionId !== null`, atomically revokes every active session in `familyId` inside a **committed** (non-throwing) transaction, records `MOBILE_SESSION_REUSE_DETECTED` in `AuditLog` with zero token material, and returns `401 REFRESH_TOKEN_REUSE_DETECTED`.
   - Every rotation inherits the immutable `familyExpiresAt` (`loginTime + 30 days`) and immediately revokes the superseded session (blocking both its old refresh token and its old access token on the next API request).
3. **Unified Owner Guards & Strict Web CSRF Preservation:**
   - [`middleware.ts`](file:///d:/Projects/Crelune/apps/web/src/middleware.ts) allowlists only `POST /api/mobile/auth/login` and `POST /api/mobile/auth/refresh` as public mobile auth endpoints, requires Mobile Bearer exclusively on `POST /api/mobile/auth/logout`, rejects Web HTML routes without a valid cookie (never accepting Mobile Bearer), rejects mixed Cookie + Bearer headers with `400 AMBIGUOUS_AUTH_CREDENTIALS`, and never reads tokens from query strings.
   - [`requireAuthenticatedOwnerApi`](file:///d:/Projects/Crelune/apps/web/src/lib/auth/api-owner-guard.ts) verifies Mobile Bearer tokens against PostgreSQL (`verifyActiveMobileOwnerInDatabase` checking `User.isActive`, `User.role === 'OWNER'`, `User.sessionVersion`, `MobileDevice.revokedAt === null`, and unrevoked/unrotated/unexpired `MobileSession`) while preserving 100% of existing Web Cookie + Origin/Referer CSRF validation (`403`) on browser mutations.
4. **Independent Revocation & Web Settings Controls:**
   - `POST /api/mobile/devices/[id]/revoke` (and Web Settings [`MobileDevicesCard`](file:///d:/Projects/Crelune/apps/web/src/components/settings/MobileDevicesCard.tsx)) revokes a single device independently without affecting other devices, clears `expoPushToken`, and disables push on that device.
   - `POST /api/mobile/auth/logout` revokes the current session family and clears that device's `expoPushToken`.
   - Incrementing `User.sessionVersion` or setting `User.isActive = false` invalidates all mobile access and refresh tokens immediately.

---

## 4. Verification Summary (Exact Commands & Actual Results)

| Check | Command | Result |
| :--- | :--- | :--- |
| Type-check (5 workspaces) | `cmd /c "npm run type-check"` | `PASS` (`0` errors across `@crelune/agent`, `@crelune/web`, `@crelune/database`, `@crelune/shared`, `@crelune/ui`) |
| Workspace ESLint | `cmd /c "npm run lint"` | `PASS` (`✔ No ESLint warnings or errors`) |
| Shared unit tests | `cmd /c "npm test --workspace=@crelune/shared"` | `PASS` (`9` files, `57` tests passed) |
| UI token unit tests | `cmd /c "npm test --workspace=@crelune/ui"` | `PASS` (`1` file, `3` tests passed) |
| Windows Agent tests | `cmd /c "npm test --workspace=@crelune/agent"` | `PASS` (`1` file, `17` tests passed) |
| Web unit/route/UI tests | `cmd /c "npm test --workspace=@crelune/web -- --testTimeout=15000"` | `PASS` (`31` files, `223` tests passed — includes `middleware.test.ts` `26`, `mobile-auth-routes.test.ts` `5`, `MobileDevicesCard.test.tsx` `2`, `auth-routes.test.ts` `19`) |
| Production build (5 workspaces) | `cmd /c "npm run build"` | `PASS` (Next.js `15.5.29` compiled all routes incl. `/api/dashboard`, `/api/mobile/**`, `/api/settings/notifications`, Middleware `66.5 kB` + `tsc -b`) |
| Neon `development` schema drift | `prisma migrate diff --from-url $DATABASE_URL_UNPOOLED --to-schema-datamodel packages/database/prisma/schema.prisma --script` | `PASS` (`-- This is an empty migration.`) |
| Neon `development` Stage 6.1 & Auth PG tests | `node -r dotenv/config node_modules/vitest/vitest.mjs run --root apps/web --no-file-parallelism --testTimeout=120000 --hookTimeout=45000 src/test/stage61-mobile-auth.pg.integration.test.ts src/lib/auth/rate-limit.pg.integration.test.ts dotenv_config_path=.env.local` | `PASS` (`2` files, `8` tests passed: `3` Stage 6.1 PG tests + `5` `auth_throttles` PG tests) |
| Full M2–M6.1 Neon `development` PG regression | `cmd /c "npm run test:integration:db"` (+ targeted re-run of `rate-limit.pg.integration.test.ts`) | `PASS` (All `11` M3–M5 suites `52/52` + Stage 6.1 `3/3` passed on first run; `2` transient Neon pooler TCP disconnects in `rate-limit.pg.integration.test.ts` confirmed `5/5 PASS` on targeted re-run; exact pre/post counts & S3 hygiene verified clean) |
| Mobile runtime / Android / iOS | `apps/mobile` tests & device checks | `NOT APPLICABLE` (Stage 6.2+ scope; `apps/mobile` not scaffolded yet) |

---

## 5. Remaining Risks & Next Stage Prerequisites

- **Production Database Migration:** Stage 6.1 DDL (`milestone_6_1_mobile_schema.sql`) and CHECK constraints (`milestone_6_1_mobile_integrity.sql`) have been applied **only** to Neon `development`. Production deployment remains gated on Product Owner authorization and Milestone 9 / release procedures.
- **Push Dispatch Deferred to Stage 6.6:** `PushDelivery` schema and `UserPreference` push toggles are persisted and editable via `/api/settings/notifications`, while Expo push token registration and Expo Push API delivery remain intentionally unimplemented until Stage 6.6.
- **Next Authorized Stage:** Ready for Product Owner review and authorization of **Stage 6.2** (Expo / React Native scaffold, native navigation shell, and secure mobile client auth integration).
