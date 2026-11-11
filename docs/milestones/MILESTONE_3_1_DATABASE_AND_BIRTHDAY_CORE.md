# CRELUNE — Milestone 3, Stage 3.1 Report: Database Schema & Birthday Date Core

- **Document:** Stage 3.1 Implementation & Verification Evidence
- **Project:** CRELUNE — Personal Creative and Media Operations Platform
- **Branch:** `main`
- **Starting Commit:** `bf56dc1` (`docs(m3): isolate development DB, harden PG test env, and plan Milestone 3`)
- **Final Commit:** Committed on `main` as `feat: establish member and birthday data foundation` *(exact SHA reported in the Stage 3.1 completion response)*
- **Status:** Complete & Verified on Neon `development` — **Stopped for Product Owner Review (Stage 3.2 Not Started)**

---

## 1. Environment & Database Safety Confirmation

- **Target Neon Branch:** `development` (`br-nameless-silence-bexjp44k`)
- **Verified Endpoint:** `ep-muddy-math-ben8e8p7`
  - Pooled host: `ep-muddy-math-ben8e8p7-pooler.c-9.us-east-2.aws.neon.tech` (`/neondb`)
  - Direct unpooled host: `ep-muddy-math-ben8e8p7.c-9.us-east-2.aws.neon.tech` (`/neondb`)
- **Production Integrity Confirmation:**
  - Neon `production` branch (`br-withered-moon-be8coj8h`, endpoint `ep-mute-forest-bepsjmsu`) was **not connected to, migrated, or modified**.
  - `cmd /c "neon branches get production -o json"` confirmed `written_data_bytes: 0` after all Stage 3.1 schema and integration operations completed.
- **Approved Storage Provider Confirmation:**
  - **Neon Object Storage** is recorded as the approved architectural photo storage provider ([`docs/TECHNICAL_DECISIONS.md`](file:///d:/Projects/Crelune/docs/TECHNICAL_DECISIONS.md)).
  - **No buckets were provisioned, no files were uploaded, and no signed-URL/upload workflows were implemented in Stage 3.1** (reserved for Stage 3.3).

---

## 2. Database Schema Changes & Migration Evidence

Updated [`packages/database/prisma/schema.prisma`](file:///d:/Projects/Crelune/packages/database/prisma/schema.prisma):

1. **Enums Added**:
   - `LeapDayPolicy`: `FEB_28`, `MAR_1`
   - `BirthdayPrepStatus`: `UPCOMING`, `PREPARATION_PENDING`, `DESIGN_IN_PROGRESS`, `AWAITING_APPROVAL`, `PUBLISHED`, `SKIPPED`
   - `ReminderStatus`: `PENDING`, `SENT`, `SKIPPED`, `FAILED`, `CANCELLED`
   - `NotificationType`: `BIRTHDAY_REMINDER`, `SYSTEM`
2. **`UserPreference` Updated Non-Destructively**:
   - Added `birthdayReminderDays Int[] @default([7, 3, 1, 0]) @map("birthday_reminder_days")`
   - Added `leapDayPolicy LeapDayPolicy @default(FEB_28) @map("leap_day_policy")`
   - Retained `timezone` (`@default("Africa/Accra")`), `leadTimeDaysBirthday`, `leadTimeDaysEvent`, `dateFormat`, `theme`, and `defaultExportFormat`.
3. **`Member` (`members`)**:
   - Uses required `fullName`, optional `preferredName`, and indexed `normalizedName` for duplicate detection (no mandatory first/last split).
   - Supports nullable `birthMonth`, `birthDay` (validated together whenever a birthday is supplied), and optional `birthYear` (nullable; never fabricated).
   - Includes optional contact fields (`phone`, `normalizedPhone`, `email`, `notes`), architecture-approved Neon Object Storage photo metadata (`photoStorageKey`, `photoMimeType`, `photoByteSize`, `photoUpdatedAt`), and `archivedAt`.
   - **No `isActive` column added**: active state is derived strictly from `archivedAt IS NULL`.
   - Indexed on `[organisationId, archivedAt, birthMonth, birthDay]`, `[organisationId, normalizedName]`, `[organisationId, normalizedPhone]`, and `[organisationId, archivedAt]`.
4. **`BirthdayPreparation` (`birthday_preparations`)**:
   - Tracks per-member, per-`targetYear` preparation status (`UPCOMING`..`SKIPPED`) with date-only `celebrationDate @db.Date` and timestamps.
   - Enforces `@@unique([memberId, targetYear])` to prevent duplicate annual preparation records.
5. **`BirthdayReminder` (`birthday_reminders`)**:
   - Tracks `memberId`, `targetYear`, `leadDays`, date-only `scheduledForDate @db.Date`, `status`, `attemptCount`, `lastError`, `sentAt`, and `idempotencyKey @unique`.
   - Enforces `@@unique([memberId, targetYear, leadDays])` alongside unique `idempotencyKey`.
6. **`Notification` (`notifications`) & `AuditLog` (`audit_logs`)**:
   - `Notification`: scoped to `organisationId` and `userId`, optionally referencing `memberId` and unique `birthdayReminderId` to prevent duplicate notifications per reminder.
   - `AuditLog`: records `organisationId`, optional `actorUserId`, `action`, `entityType`, `entityId`, `metadata`, and `createdAt` (append-only at the application-service level; **not** enforced by database triggers).

### Migration & Schema Verification Evidence
- Validated schema cleanly via `prisma validate`.
- Pushed schema strictly to `ep-muddy-math-ben8e8p7.c-9.us-east-2.aws.neon.tech` (`development`) via pre-verified Node guard running `prisma db push` and `prisma generate` (`Generated Prisma Client (v6.19.3)`).
- Verified `20` indexes and unique constraints across `members`, `birthday_preparations`, `birthday_reminders`, `notifications`, and `audit_logs` on PostgreSQL, `archived_at` present with `is_active` absent on `members`, and post-test clean row counts (`organisations: 1`, `users: 1`, `userPreferences: 1`, `authThrottles: 0`, `members: 0`, `birthdayPreparations: 0`, `birthdayReminders: 0`, `notifications: 0`, `auditLogs: 0`).

---

## 3. Birthday Date Core & Pure Member Helpers

Implemented pure, dependency-free domain logic in `@crelune/shared`:

- [`packages/shared/src/domain/birthday-date.ts`](file:///d:/Projects/Crelune/packages/shared/src/domain/birthday-date.ts):
  - `DEFAULT_TIMEZONE = 'Africa/Accra'`, `DEFAULT_LEAP_DAY_POLICY = 'FEB_28'`, `DEFAULT_REMINDER_LEAD_DAYS = [7, 3, 1, 0]`.
  - [`isLeapYear`](file:///d:/Projects/Crelune/packages/shared/src/domain/birthday-date.ts): handles 4-year, 100-year (`1900`, `2100` false), and 400-year (`2000` true) Gregorian rules.
  - [`getDaysInMonth`](file:///d:/Projects/Crelune/packages/shared/src/domain/birthday-date.ts) & [`isValidCalendarDay`](file:///d:/Projects/Crelune/packages/shared/src/domain/birthday-date.ts) & [`validateBirthdayTuple`](file:///d:/Projects/Crelune/packages/shared/src/domain/birthday-date.ts): validates month/day pairs, allows `Feb 29` when `birthYear` is omitted/`null`, rejects impossible dates (`Feb 30`, `Apr 31`, `Feb 29` in known non-leap `birthYear`), and requires both month & day whenever any birthday field is provided.
  - [`resolveCelebrationDateForYear`](file:///d:/Projects/Crelune/packages/shared/src/domain/birthday-date.ts): observes `Feb 29` on `Feb 28` by default (`FEB_28`) or `Mar 1` (`MAR_1`) in non-leap years.
  - [`getNextBirthdayOccurrence`](file:///d:/Projects/Crelune/packages/shared/src/domain/birthday-date.ts): resolves upcoming occurrence and `daysUntil` cleanly across Dec -> Jan rollovers and sets `turningAge = null` when `birthYear` is unknown.
  - [`calculateBirthdayReminderDates`](file:///d:/Projects/Crelune/packages/shared/src/domain/birthday-date.ts) & [`addCalendarDays`](file:///d:/Projects/Crelune/packages/shared/src/domain/birthday-date.ts): computes calendar reminder dates (`[7, 3, 1, 0]`) via civil calendar arithmetic across year boundaries without 24-hour/DST shifts.
  - [`getTodayCivilDate`](file:///d:/Projects/Crelune/packages/shared/src/domain/birthday-date.ts), [`civilDateToUtcMidnight`](file:///d:/Projects/Crelune/packages/shared/src/domain/birthday-date.ts), and [`utcDateOnlyToCivilDate`](file:///d:/Projects/Crelune/packages/shared/src/domain/birthday-date.ts): resolves `YYYY-MM-DD` dates in `Africa/Accra` (or configured IANA timezone) and roundtrips PostgreSQL `@db.Date` values without timezone drift.
- [`packages/shared/src/domain/member.ts`](file:///d:/Projects/Crelune/packages/shared/src/domain/member.ts):
  - [`isMemberActive`](file:///d:/Projects/Crelune/packages/shared/src/domain/member.ts) / [`isMemberArchived`](file:///d:/Projects/Crelune/packages/shared/src/domain/member.ts) derived strictly from `archivedAt`.
  - [`normalizeMemberName`](file:///d:/Projects/Crelune/packages/shared/src/domain/member.ts) and [`normalizeMemberPhone`](file:///d:/Projects/Crelune/packages/shared/src/domain/member.ts).

---

## 4. Integration-Test Safety Guard Hardening

Strengthened [`apps/web/src/test/assert-dev-db.ts`](file:///d:/Projects/Crelune/apps/web/src/test/assert-dev-db.ts) and [`apps/web/scripts/run-pg-integration.mjs`](file:///d:/Projects/Crelune/apps/web/scripts/run-pg-integration.mjs):

- Never relies on `NEON_BRANCH=development` alone.
- Requires **all** of:
  1. `NODE_ENV !== 'production'`
  2. `NEON_BRANCH === 'development'` (explicitly rejecting `production`, `prod`, `main`, or other branch names)
  3. `NEON_BRANCH_ID === 'br-nameless-silence-bexjp44k'` (explicitly rejecting `br-withered-moon-be8coj8h`, missing IDs, or mismatched IDs)
  4. `DATABASE_URL` host matching `ep-muddy-math-ben8e8p7` (`*.neon.tech`) and rejecting `ep-mute-forest-bepsjmsu`
  5. `DATABASE_URL_UNPOOLED` present, using the direct non-pooler `ep-muddy-math-ben8e8p7.` Neon host, and rejecting `ep-mute-forest-bepsjmsu`
  6. Parent shell `DATABASE_URL`, `DATABASE_URL_UNPOOLED`, `NEON_BRANCH`, or `NEON_BRANCH_ID` conflicts with `.env.local` abort immediately.

---

## 5. Verification Results (Commands & Actual Outputs)

| Check | Command | Outcome | Observed Result |
| :--- | :--- | :--- | :--- |
| Guard Negative Test | `cmd /c "set NEON_BRANCH=production&& node apps/web/scripts/run-pg-integration.mjs"` | `PASS` | Exited `1`: `Aborted: pre-existing shell NEON_BRANCH conflicts with .env.local.` |
| Unit Tests | `cmd /c "npm test"` | `PASS` | `128/128` passed across `11` files (`@crelune/web`: `96` across `7` files incl. `6` in `assert-dev-db.test.ts`; `@crelune/shared`: `29` across `3` files incl. `13` in `birthday-date.test.ts` & `2` in `member.test.ts`; `@crelune/ui`: `3`; `0` failed, `0` skipped) |
| PG Integration Suite | `cmd /c "npm run test:integration:db"` | `PASS` | Verified `branch="development" (br-nameless-silence-bexjp44k)` & `ep-muddy-math-ben8e8p7`; `8/8` passed across `2` files (`member-birthday-schema.pg.integration.test.ts`: `3`, `rate-limit.pg.integration.test.ts`: `5`) |
| Type Check | `cmd /c "npm run type-check"` | `PASS` | `0` errors across all `4` workspaces (`@crelune/web`, `@crelune/database`, `@crelune/shared`, `@crelune/ui`) |
| Production Build | `cmd /c "npm run build"` | `PASS` | `next build` compiled cleanly (`17/17` static pages) and `tsc -b` succeeded across `@crelune/database`, `@crelune/shared`, `@crelune/ui` |

---

## 6. Files Changed in Stage 3.1

- [`packages/database/prisma/schema.prisma`](file:///d:/Projects/Crelune/packages/database/prisma/schema.prisma)
- [`packages/shared/src/index.ts`](file:///d:/Projects/Crelune/packages/shared/src/index.ts)
- [`packages/shared/src/domain/birthday-date.ts`](file:///d:/Projects/Crelune/packages/shared/src/domain/birthday-date.ts)
- [`packages/shared/src/domain/birthday-date.test.ts`](file:///d:/Projects/Crelune/packages/shared/src/domain/birthday-date.test.ts)
- [`packages/shared/src/domain/member.ts`](file:///d:/Projects/Crelune/packages/shared/src/domain/member.ts)
- [`packages/shared/src/domain/member.test.ts`](file:///d:/Projects/Crelune/packages/shared/src/domain/member.test.ts)
- [`apps/web/src/test/assert-dev-db.ts`](file:///d:/Projects/Crelune/apps/web/src/test/assert-dev-db.ts)
- [`apps/web/src/test/assert-dev-db.test.ts`](file:///d:/Projects/Crelune/apps/web/src/test/assert-dev-db.test.ts)
- [`apps/web/scripts/run-pg-integration.mjs`](file:///d:/Projects/Crelune/apps/web/scripts/run-pg-integration.mjs)
- [`apps/web/src/test/member-birthday-schema.pg.integration.test.ts`](file:///d:/Projects/Crelune/apps/web/src/test/member-birthday-schema.pg.integration.test.ts)
- [`docs/TECHNICAL_DECISIONS.md`](file:///d:/Projects/Crelune/docs/TECHNICAL_DECISIONS.md)
- [`docs/CHANGELOG.md`](file:///d:/Projects/Crelune/docs/CHANGELOG.md)
- [`docs/milestones/MILESTONE_3_1_DATABASE_AND_BIRTHDAY_CORE.md`](file:///d:/Projects/Crelune/docs/milestones/MILESTONE_3_1_DATABASE_AND_BIRTHDAY_CORE.md)

---

## 7. Limitations & Open Boundaries

- **No Prisma SQL migrations directory yet:** Consistent with Milestone 2 baseline (`packages/database/prisma/` had no `migrations/` folder), schema synchronization used `prisma db push` on `development`. Formal SQL migration tracking will be needed before applying schema changes to `production` in future release prep.
- **DB-level `CHECK` & append-only triggers omitted:** Cross-column birth-month/day bounds and `AuditLog` append-only immutability are enforced at the TypeScript/service boundary rather than raw PostgreSQL `CHECK` constraints or DDL triggers.
- **Stage 3.1 scope boundary respected:** Zero member CRUD APIs, UI pages, notification delivery schedulers, `CRON_SECRET` handlers, or Neon Object Storage buckets were implemented.
