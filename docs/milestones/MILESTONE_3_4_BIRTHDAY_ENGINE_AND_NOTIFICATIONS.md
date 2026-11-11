# CRELUNE — Milestone 3, Stage 3.4 Verification & Completion Report

**Stage:** 3.4 — Birthday Engine, Reminder Generation & Notification Processing  
**Status:** Complete & Verified (Stopped prior to Stage 3.5 / Stage 3.6)  
**Starting Baseline Commit:** `4437ffd` (`main`)  
**Target Environment:** Neon `development` (`br-nameless-silence-bexjp44k`, database `neondb`)  
**Schema Migrations Required:** None (`packages/database/prisma/schema.prisma` already contained `LeapDayPolicy`, `BirthdayPrepStatus`, `ReminderStatus`, `NotificationType`, `UserPreference`, `BirthdayPreparation`, `BirthdayReminder`, `Notification`, and `AuditLog`)

---

## 1. Architecture & Shared Domain Contracts

### 1.1 Pure Date & Preference Validation (`@crelune/shared`)
- [`packages/shared/src/domain/birthday-date.ts`](file:///d:/Projects/Crelune/packages/shared/src/domain/birthday-date.ts):
  - Added `MAX_REMINDER_LEAD_DAY = 365`, `MAX_REMINDER_INTERVAL_COUNT = 16`, `isValidIanaTimeZone(timeZone)`, and `validateReminderLeadDays(value)`.
  - `isValidIanaTimeZone` validates syntax (`UTC`, `Etc/UTC`, or IANA `Region/City` without whitespace) and confirms acceptance via `Intl.DateTimeFormat('en-US', { timeZone })`, rejecting fixed-offset strings like `UTC+2`, `GMT+1`, or empty/unknown zones.
- [`packages/shared/src/schemas/birthday.ts`](file:///d:/Projects/Crelune/packages/shared/src/schemas/birthday.ts) & [`packages/shared/src/index.ts`](file:///d:/Projects/Crelune/packages/shared/src/index.ts):
  - Exported shared contracts and Zod schemas: `NotificationType`, `NotificationItem`, `NotificationListPaginationMeta`, `NotificationListResponse`, `BirthdaySyncSummary`, `notificationIdParamSchema`, `notificationListQuerySchema` (`unreadOnly`, `page`, `limit` bounded to `100`), and `birthdaySyncRequestSchema` (`.object({}).strict()`).

### 1.2 Schedule Reconciliation & Idempotency Rules
- [`apps/web/src/lib/birthdays/birthday-preferences.ts`](file:///d:/Projects/Crelune/apps/web/src/lib/birthdays/birthday-preferences.ts):
  - `validateAndNormalizeOwnerPreferences` and `loadOwnerBirthdayPreferences` apply CRELUNE defaults (`Africa/Accra`, `FEB_28`, `[7, 3, 1, 0]`) **only** when `UserPreference` is `null` (absent). Invalid configured timezones, leap-day policies, or interval arrays throw `InvalidBirthdayPreferencesError` loudly instead of falling back silently.
- [`apps/web/src/lib/birthdays/birthday-schedule-service.ts`](file:///d:/Projects/Crelune/apps/web/src/lib/birthdays/birthday-schedule-service.ts):
  - `reconcileOrganisationBirthdaySchedules(organisationId, ownerUserId, options)` serializes per-organisation runs via `SELECT pg_advisory_xact_lock(hashtext('bday_sync:' || organisationId))` inside a PostgreSQL transaction (`{ maxWait: 15_000, timeout: 30_000 }`) and batches new `BirthdayPreparation` and `BirthdayReminder` inserts with `createMany(..., { skipDuplicates: true })`.
  - Materializes and reconciles `[today.year, today.year + 1]` in the owner's validated IANA timezone (covering late-December → early-January lead-day overlap).
  - Supports unknown `birthYear: null`, honours `FEB_28` vs `MAR_1` leap-day celebration policy, skips archived or incomplete-birthday members cleanly, updates pending schedules on birthday/preference edits, re-arms `CANCELLED` reminders on restore or policy re-enablement, expires stale pre-cutoff rows to `SKIPPED`, and **never** alters existing `SENT` reminders or emitted `Notification` history.

### 1.3 Delayed vs Expired Cutoff, Row Locks & Retry Safety
- [`apps/web/src/lib/birthdays/birthday-processor-service.ts`](file:///d:/Projects/Crelune/apps/web/src/lib/birthdays/birthday-processor-service.ts):
  - `processDueBirthdayReminders` queries due candidates (`status IN ('PENDING', 'FAILED')`, `attemptCount < MAX_REMINDER_ATTEMPTS`, `scheduledForDate <= todayUtc` in owner timezone) and processes each inside a PostgreSQL transaction (`{ maxWait: 15_000, timeout: 25_000 }`) under `SELECT id FROM birthday_reminders ... FOR UPDATE`.
  - Reconfirms inside the lock that: (a) the member is active and in the same `organisationId` with a valid birthday tuple, (b) current preference intervals and birthday schedule parity still match, and (c) `today <= celebrationDate`.
  - **Delayed delivery vs expired cutoff:** Reminders processed late **on or before** `celebrationDate` are still delivered (`SENT` + `Notification`); reminders whose `celebrationDate < today` transition to `SKIPPED` with zero notifications emitted.
  - **Atomic notification ordering:** Inserts `Notification` (`type = 'BIRTHDAY_REMINDER'`, unique `birthdayReminderId`) **before** updating `BirthdayReminder` to `status = 'SENT'`. Any failure rolls back the `Notification` write cleanly.
  - **Bounded retries & failure audit:** Failures increment `attemptCount` up to `MAX_REMINDER_ATTEMPTS = 3` (or immediately on `PermanentReminderProcessingError` / `P2003` / `P2025`), store sanitized `lastError` (`ErrorName[:code]`, max 100 chars, no URLs/credentials/PII), and emit a sanitized `AUDIT_ACTIONS.BIRTHDAY_REMINDER_FAILED` audit entry when `attemptCount >= MAX_REMINDER_ATTEMPTS`.

### 1.4 Owner Notification Service & Privacy Rules
- [`apps/web/src/lib/notifications/notification-service.ts`](file:///d:/Projects/Crelune/apps/web/src/lib/notifications/notification-service.ts):
  - Enforces strict `organisationId` + `userId` ownership scoping on `listOwnerNotifications`, `markNotificationAsRead` (idempotent repeat reads, `NotificationNotFoundError` for cross-owner/cross-org IDs), and `markAllNotificationsAsRead` (transactional update + `AUDIT_ACTIONS.NOTIFICATION_READ_ALL` audit event).
  - Notification copy contains only display name (`preferredName || fullName`), celebration month/day/year, lead-day phrasing, leap-day policy note when applicable, and safe in-app link (`/members/{id}`) — excluding `notes`, `phone`, `email`, `photoStorageKey`, and `birthYear`.

### 1.5 Audit Service Extensions
- [`apps/web/src/lib/audit/audit-service.ts`](file:///d:/Projects/Crelune/apps/web/src/lib/audit/audit-service.ts):
  - Extended `AUDIT_ACTIONS` with `BIRTHDAY_PREFERENCES_UPDATED`, `BIRTHDAY_REMINDER_FAILED`, and `NOTIFICATION_READ_ALL`, extended `entityType` to include `'BirthdayReminder' | 'Notification' | 'UserPreference'`, and made `actorUserId` optional for system-triggered reminder-failure audits.

---

## 2. Protected API Endpoints, Middleware & `CRON_SECRET` Configuration

- **Shared HTTP/Orchestration Helpers**:
  - [`apps/web/src/lib/birthdays/birthday-engine-service.ts`](file:///d:/Projects/Crelune/apps/web/src/lib/birthdays/birthday-engine-service.ts) (`runOrganisationBirthdayCycle`, `runScheduledBirthdayRemindersForActiveOwners`)
  - [`apps/web/src/lib/birthdays/birthday-http.ts`](file:///d:/Projects/Crelune/apps/web/src/lib/birthdays/birthday-http.ts) (`Cache-Control: private, no-store`, strict empty-body parser, validated ID/query responses, sanitized `500` error responses)
  - [`apps/web/src/lib/auth/cron-auth.ts`](file:///d:/Projects/Crelune/apps/web/src/lib/auth/cron-auth.ts) (`verifyCronBearerRequest`: rejects URL query-string secrets with `401`, fails closed with `503` if `CRON_SECRET` is unset/placeholder/short, validates `Authorization: Bearer <secret>` via constant-time SHA-256 `crypto.timingSafeEqual`)
- **Middleware Exception**:
  - [`apps/web/src/middleware.ts`](file:///d:/Projects/Crelune/apps/web/src/middleware.ts): Permits unauthenticated cookie passthrough **exclusively** for `(pathname === '/api/cron/birthday-reminders' && request.method === 'POST')` so the route handler enforces `CRON_SECRET` Bearer authentication; all other `/api/birthdays/*` and `/api/notifications/*` routes continue requiring valid owner session cookies.
- **API Route Handlers**:
  - `POST` [`apps/web/src/app/api/birthdays/sync/route.ts`](file:///d:/Projects/Crelune/apps/web/src/app/api/birthdays/sync/route.ts) — Owner session + active DB owner + CSRF + strict empty/no-extra-fields `{}` body.
  - `POST` [`apps/web/src/app/api/cron/birthday-reminders/route.ts`](file:///d:/Projects/Crelune/apps/web/src/app/api/cron/birthday-reminders/route.ts) — `CRON_SECRET` Bearer auth + strict empty/`{}` body + minimal non-PII aggregate summary response.
  - `GET` [`apps/web/src/app/api/notifications/route.ts`](file:///d:/Projects/Crelune/apps/web/src/app/api/notifications/route.ts) — Owner session + strict `unreadOnly`/`page`/`limit` query validation + `unreadCount`.
  - `PATCH` [`apps/web/src/app/api/notifications/[id]/read/route.ts`](file:///d:/Projects/Crelune/apps/web/src/app/api/notifications/%5Bid%5D/read/route.ts) — Owner session + CSRF + ID format validation + `404` on cross-owner/unknown IDs.
  - `POST` [`apps/web/src/app/api/notifications/read-all/route.ts`](file:///d:/Projects/Crelune/apps/web/src/app/api/notifications/read-all/route.ts) — Owner session + CSRF + strict empty/`{}` body.
- **`CRON_SECRET` & Deferred Scheduler Integration**:
  - Documented `CRON_SECRET="replace-with-secure-random-cron-secret"` in [`.env.example`](file:///d:/Projects/Crelune/.env.example).
  - Hosting/external cron scheduler selection and provisioning remain explicitly deferred until hosting decisions are approved; when deployed, the scheduler must send `POST /api/cron/birthday-reminders` with `Authorization: Bearer $CRON_SECRET` (never URL query strings).

---

## 3. Automated Verification & Exact Observed Results

All checks below ran cleanly **after** the final code edits (command exit code `0`):

| Check | Exact Command | Scope & Result | Status |
|---|---|---|---|
| Shared package build | `npm run build --workspace=@crelune/shared` | Compiled `@crelune/shared` cleanly | **PASS** |
| Workspace type checks | `npm run type-check` | `tsc --noEmit` across `@crelune/web`, `@crelune/database`, `@crelune/shared`, `@crelune/ui` | **PASS** |
| Unit & API route suites | `npm test` | `@crelune/web` (`16 files, 141 tests`), `@crelune/shared` (`4 files, 34 tests`), `@crelune/ui` (`1 file, 3 tests`) — total **21 files, 178 tests passed** | **PASS** |
| PostgreSQL integration suite (Neon `development`) | `npm run test:integration:db` | Verified `development` (`br-nameless-silence-bexjp44k`), `neondb`; serial file execution (`--no-file-parallelism --testTimeout=30000` in [`run-pg-integration.mjs`](file:///d:/Projects/Crelune/apps/web/scripts/run-pg-integration.mjs)): **5 files, 30 tests passed** (`birthday-engine.pg.integration.test.ts` 13 tests, `member-photo.pg.integration.test.ts` 4 tests, `member-directory.pg.integration.test.ts` 5 tests, `rate-limit.pg.integration.test.ts` 5 tests, `member-birthday-schema.pg.integration.test.ts` 3 tests) | **PASS** |
| Production build | `npm run build` | Next.js `15.5.29` build + `@crelune/database`, `@crelune/shared`, `@crelune/ui`; includes all 5 new API routes | **PASS** |
| Lint check | `npm run lint` | Interactive Next.js ESLint setup prompt (`No ESLint configuration exists in repo yet`); unchanged outside Stage 3.4 scope | **BLOCKED (Not configured)** |

### 3.1 Stage 3.4 Test Files
- [`packages/shared/src/domain/birthday-date.test.ts`](file:///d:/Projects/Crelune/packages/shared/src/domain/birthday-date.test.ts) (`14 tests`)
- [`apps/web/src/middleware.test.ts`](file:///d:/Projects/Crelune/apps/web/src/middleware.test.ts) (`20 tests`)
- [`apps/web/src/lib/birthdays/birthday-engine.test.ts`](file:///d:/Projects/Crelune/apps/web/src/lib/birthdays/birthday-engine.test.ts) (`4 tests`)
- [`apps/web/src/app/api/birthdays/birthday-notification-routes.test.ts`](file:///d:/Projects/Crelune/apps/web/src/app/api/birthdays/birthday-notification-routes.test.ts) (`4 tests`)
- [`apps/web/src/test/birthday-engine.pg.integration.test.ts`](file:///d:/Projects/Crelune/apps/web/src/test/birthday-engine.pg.integration.test.ts) (`13 tests` against Neon `development`)

---

## 4. Database Cleanliness & Production Isolation Evidence

Executed after the full integration suite:
- **Neon `development` (`br-nameless-silence-bexjp44k` / `neondb`) row counts:** `organisations: 1`, `users: 1`, `userPreferences: 1`, `members: 0`, `birthdayPreparations: 0`, `birthdayReminders: 0`, `notifications: 0`, `auditLogs: 0`, `pendingStorageCleanups: 0`.
- **Neon `development` bucket (`crelune-dev-member-photos`):** `folders: []`, `objects: []`.
- **Neon `production` (`br-withered-moon-be8coj8h`):** `written_data_bytes: 0`, buckets `[]` (untouched).

---

## 5. Known Limitations & Next Stage Handoff

- **UI deferred cleanly:** Member directory UI, birthday calendar UI, notification inbox/bell UI, and owner preference settings UI belong to **Stage 3.5 / Stage 3.6** and were intentionally not implemented here.
- **External scheduler deferred cleanly:** `POST /api/cron/birthday-reminders` is implemented and protected with `CRON_SECRET`; external cron invocation setup depends on Product Owner hosting selection.
- **Serial PG integration execution:** [`apps/web/scripts/run-pg-integration.mjs`](file:///d:/Projects/Crelune/apps/web/scripts/run-pg-integration.mjs) runs PostgreSQL integration files serially (`--no-file-parallelism --testTimeout=30000`) so parallel test suites do not contend on Neon `development` pools/storage or cross-interfere with multi-owner cron test fixtures.
