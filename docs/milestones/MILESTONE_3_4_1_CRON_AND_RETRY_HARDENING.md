# CRELUNE — Stage 3.4.1 Verification & Completion Report

**Stage:** 3.4.1 — Cron Secret Strength & Concurrency-Safe Retry Accounting  
**Status:** Complete & Verified (Stopped prior to Stage 3.5 / Stage 3.6)  
**Starting Baseline Commit:** `c9939b8` (`main`)  
**Target Environment:** Neon `development` (`br-nameless-silence-bexjp44k`, database `neondb`)

---

## 1. Original Gaps Identified

1. **`CRON_SECRET` minimum length not enforced at runtime:** [`apps/web/src/lib/auth/cron-auth.ts`](file:///d:/Projects/Crelune/apps/web/src/lib/auth/cron-auth.ts) rejected missing, blank, and placeholder secrets (`replace-with-*`, `changeme`, `example`) with HTTP `503`, but accepted weak non-placeholder secrets shorter than `32` characters after trimming.
2. **Race window on concurrent reminder failure accounting:** [`apps/web/src/lib/birthdays/birthday-processor-service.ts`](file:///d:/Projects/Crelune/apps/web/src/lib/birthdays/birthday-processor-service.ts) calculated `nextAttemptCount` from a pre-transaction `observedAttemptCount` variable and wrote a fixed `attemptCount` value inside the failure transaction. Two concurrent transient failures could overwrite each other (`attemptCount = 1` instead of `2`), exceed or double-audit at the retry cap, or fail without locking the row cleanly against concurrent completion transitions.

---

## 2. Implemented Fixes

### 2.1 `CRON_SECRET` Minimum-Length Enforcement
- [`apps/web/src/lib/auth/cron-auth.ts`](file:///d:/Projects/Crelune/apps/web/src/lib/auth/cron-auth.ts):
  - Exported `MIN_CRON_SECRET_LENGTH = 32`.
  - Required `configuredSecret = (env.CRON_SECRET || '').trim()` to have `configuredSecret.length >= 32` and not match placeholder values (`replace-with-*`, `changeme`, `change-me`, `example`, `placeholder`), failing closed with HTTP `503`.
  - Preserved exclusive `Authorization: Bearer <token>` parsing, rejection of URL query-string parameters (`401`), SHA-256 `crypto.timingSafeEqual` digest comparison, and zero secret exposure in logs or responses.
- [`.env.example`](file:///d:/Projects/Crelune/.env.example): Documented the `32+` character minimum length requirement and updated the example placeholder to `replace-with-a-secure-random-cron-secret-at-least-32-chars`.

### 2.2 Concurrency-Safe Failure Attempt Accounting
- [`apps/web/src/lib/birthdays/birthday-processor-service.ts`](file:///d:/Projects/Crelune/apps/web/src/lib/birthdays/birthday-processor-service.ts):
  - Removed the stale pre-transaction `observedAttemptCount` variable completely.
  - Inside the failure-recording PostgreSQL transaction (`errTx`), acquired a row-level lock (`SELECT id FROM birthday_reminders ... FOR UPDATE`) and verified committed row state before mutating.
  - Applied a conditional atomic update (`where: { id, organisationId, status: { in: ['PENDING', 'FAILED'] }, attemptCount: { lt: MAX_REMINDER_ATTEMPTS } }`):
    - Transient failures execute `attemptCount: { increment: 1 }`.
    - Permanent failures set `attemptCount: MAX_REMINDER_ATTEMPTS`.
    - Reminders already marked `SENT`, `SKIPPED`, or `CANCELLED`, or already at `attemptCount >= MAX_REMINDER_ATTEMPTS`, are never mutated or reverted to `FAILED`.
  - Re-read the committed `status` and `attemptCount` inside `errTx` after the conditional update and emitted `AUDIT_ACTIONS.BIRTHDAY_REMINDER_FAILED` only when `updated.count > 0 && afterUpdate.status === 'FAILED' && afterUpdate.attemptCount >= MAX_REMINDER_ATTEMPTS`, preventing duplicate terminal failure audits under concurrent boundary races.
  - Kept `lastError` sanitized (`ErrorName[:code]`, max `100` chars) and preserved transactional `Notification` creation before `SENT`.

---

## 3. Regression Verification & Observed Evidence

All checks below executed and passed **after** the final code edits (exit code `0`):

| Check | Exact Command | Scope & Result | Status |
|---|---|---|---|
| Workspace type checks | `npm run type-check` | `tsc --noEmit` across `@crelune/web`, `@crelune/database`, `@crelune/shared`, `@crelune/ui` | **PASS** |
| Unit & API route tests | `npm test` | `@crelune/web` (`16` files, `141` tests), `@crelune/shared` (`4` files, `34` tests), `@crelune/ui` (`1` file, `3` tests) — **21 files, 178 tests passed** | **PASS** |
| PostgreSQL integration tests (Neon `development`) | `npm run test:integration:db` | Verified target `development` (`br-nameless-silence-bexjp44k`), `neondb`; **5 files, 32 tests passed** (`birthday-engine.pg.integration.test.ts` `15` tests, `member-photo.pg.integration.test.ts` `4`, `member-directory.pg.integration.test.ts` `5`, `rate-limit.pg.integration.test.ts` `5`, `member-birthday-schema.pg.integration.test.ts` `3`) | **PASS** |
| Production build | `npm run build` | Next.js `15.5.29` (`@crelune/web`) + `@crelune/database`, `@crelune/shared`, `@crelune/ui` | **PASS** |

### 3.1 Cron Authentication Cases Verified
Covered in [`apps/web/src/lib/birthdays/birthday-engine.test.ts`](file:///d:/Projects/Crelune/apps/web/src/lib/birthdays/birthday-engine.test.ts) and [`apps/web/src/app/api/birthdays/birthday-notification-routes.test.ts`](file:///d:/Projects/Crelune/apps/web/src/app/api/birthdays/birthday-notification-routes.test.ts):
- Missing secret (`undefined`) -> `503`
- Blank secrets (`""`, `"   "`) -> `503`
- Placeholder secrets (`"replace-with-..."`, `"changeme"`, `"example"`) -> `503`
- 1-character secret (`"x"`) -> `503`
- 31-character secret (and whitespace-padded 31-character secret) -> `503`
- Exactly 32-character secret (including whitespace trimming) -> accepted (`true`) with matching Bearer token
- Longer valid secret -> accepted (`true`)
- Invalid Bearer token -> `401` (no secret echoed in response)
- Query-string secret (`?secret=...`) even with valid Bearer header -> `401`

### 3.2 Concurrency-Safe Retry Accounting Evidence (Neon `development`)
Covered in [`apps/web/src/test/birthday-engine.pg.integration.test.ts`](file:///d:/Projects/Crelune/apps/web/src/test/birthday-engine.pg.integration.test.ts):
- Two concurrent transient failures from `attemptCount = 0` persisted `attemptCount = 2` (not `1`) with `status = 'FAILED'` and zero premature terminal audit records.
- Two concurrent transient failures at the boundary (`attemptCount = 2`) capped strictly at `attemptCount = 3` (`MAX_REMINDER_ATTEMPTS`) with **1** `BIRTHDAY_REMINDER_FAILED` audit log (no PII leaked).
- Subsequent processing runs made zero updates and kept `attemptCount = 3` and audit count `1`.
- Concurrent success vs failure racing on a due reminder ended with `status = 'SENT'`, `1` `Notification`, and subsequent failing attempts did not revert `SENT` to `FAILED`.
- Existing duplicate-notification and concurrent sync schedule tests all remained green (`15/15` passing).

---

## 4. Development Cleanliness & Production Isolation

- **Neon `development` (`br-nameless-silence-bexjp44k` / `neondb`):** Post-suite counts confirmed clean baseline (`organisations: 1`, `users: 1`, `userPreferences: 1`, `members: 0`, `birthdayPreparations: 0`, `birthdayReminders: 0`, `notifications: 0`, `auditLogs: 0`, `pendingStorageCleanups: 0`); `crelune-dev-member-photos` bucket empty (`folders: []`, `objects: []`).
- **Neon `production` (`br-withered-moon-be8coj8h`):** Untouched (`written_data_bytes: 0`, buckets `[]`).
