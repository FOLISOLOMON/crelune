# CRELUNE — Stage 3.5 Independent Review, Stage 3.6 & Milestone 4 Consolidated Delivery Report

**Scope:** Stage 3.5 Review (`95697da`) + Stage 3.6 (Birthday Calendar, Preparation, Notifications & Preferences UI) + Milestone 4 (Design Management Backend & Web Experience)  
**Baseline Commit:** `95697da` (`main`)  
**Target Platform & Environment:** CRELUNE Web (`@crelune/web`), Shared (`@crelune/shared`), Database (`@crelune/database`) · Neon `development` (`br-nameless-silence-bexjp44k`, `neondb`)  
**Milestone Boundary:** Stopped cleanly prior to Milestone 5 (Templates & Affinity Integration).

---

## 1. Part A — Independent Review of Stage 3.5 (`95697da`) & Resolutions

Commit `95697da` was inspected directly against source code and runtime behavior:

1. **Duplicate Initial SSR Mount Fetch (`MemberDirectoryClient.tsx`)**:
   - **Finding:** The initial `useEffect` check relied on `isFirstRender` ref, which resets on React 18/19 Strict-Mode double mount in development, firing an unnecessary duplicate `GET /api/members?...` immediately after SSR hydration.
   - **Resolution:** Replaced `isFirstRender` with `lastFetchedQueryKeyRef` seeded from SSR `initialQueryKey` so initial hydration triggers zero redundant fetch calls, verified in [`member-interactions.test.tsx`](file:///d:/Projects/Crelune/apps/web/src/components/members/member-interactions.test.tsx).
2. **Non-Interactive ESLint Blocked (`apps/web`)**:
   - **Finding:** `npm run lint` failed in non-interactive shells because `apps/web` lacked `.eslintrc.json`.
   - **Resolution:** Installed `eslint@8.57.1` and `eslint-config-next@15.5.29` and added [`apps/web/.eslintrc.json`](file:///d:/Projects/Crelune/apps/web/.eslintrc.json) (`next/core-web-vitals`, `next/typescript`), achieving `0` ESLint warnings/errors.
3. **Lack of Real DOM Interaction Tests**:
   - **Finding:** Stage 3.5 UI tests used `react-dom/server` `renderToStaticMarkup` only without exercising client state transitions, `409` duplicate confirmation dialogs, or button handlers.
   - **Resolution:** Installed `@testing-library/react`, `@testing-library/dom`, and `jsdom` and added DOM workflow tests in [`member-interactions.test.tsx`](file:///d:/Projects/Crelune/apps/web/src/components/members/member-interactions.test.tsx) and [`stage36-m4-ui.test.tsx`](file:///d:/Projects/Crelune/apps/web/src/components/workflows/stage36-m4-ui.test.tsx).
4. **Verified Preserved Invariants in `95697da`**:
   - Server-side owner session guard (`resolveAuthenticatedOwner`), omission of private `notes` & raw storage keys from directory DTOs, date-only birthday formatting without timezone shift, unknown `birthYear: null` preservation, zero permanent delete controls, and clean upload preview lifecycle (`URL.revokeObjectURL`) all held cleanly.

---

## 2. Part B — Stage 3.6 & Milestone 4 Implemented Modules

### 2.1 Database Schema (`@crelune/database`)
- Updated [`packages/database/prisma/schema.prisma`](file:///d:/Projects/Crelune/packages/database/prisma/schema.prisma) and pushed to Neon `development` (`br-nameless-silence-bexjp44k`):
  - Added enums `DesignCategory`, `DesignJobStatus`, and `DesignPriority`.
  - Added `DesignJob` and `DesignJobHistory` models (with optional `memberId`, `templateId`, `eventId`, explicit `fromStatus`/`toStatus` transition history, and owner/org indexes).
  - Linked nullable `BirthdayPreparation.designJobId` FK (`onDelete: SetNull`) to prevent duplicate birthday flyer creation while allowing safe job links.

### 2.2 Shared Domain & Validation Contracts (`@crelune/shared`)
- [`packages/shared/src/domain/design-job.ts`](file:///d:/Projects/Crelune/packages/shared/src/domain/design-job.ts): Explicit `DESIGN_JOB_TRANSITIONS` state machine and helpers enforcing `EXPORTED` != `PUBLISHED` and non-skipping review/approval transitions.
- [`packages/shared/src/schemas/design-job.ts`](file:///d:/Projects/Crelune/packages/shared/src/schemas/design-job.ts): Zod schemas for creating, updating, querying, and transitioning design jobs.
- [`packages/shared/src/schemas/birthday.ts`](file:///d:/Projects/Crelune/packages/shared/src/schemas/birthday.ts): Zod contracts for Birthday Overview queries, `BirthdayPreparation` status mutations, and IANA-validated Owner Birthday & Timezone Preferences updates.
- [`packages/shared/src/constants/routes.ts`](file:///d:/Projects/Crelune/packages/shared/src/constants/routes.ts): Added `/designs/[id]` route constant and builder.

### 2.3 Backend Services & REST APIs (`apps/web`)
- [`apps/web/src/lib/birthdays/birthday-overview-service.ts`](file:///d:/Projects/Crelune/apps/web/src/lib/birthdays/birthday-overview-service.ts): Monthly Birthday Calendar & Today/Upcoming aggregation respecting active owner IANA timezone, leap-day policy (`FEB_28` / `MAR_1`), archived-member exclusion, transactional preparation status updates, and owner preference updates that trigger immediate schedule reconciliation without altering `SENT` history.
- [`apps/web/src/lib/designs/design-job-service.ts`](file:///d:/Projects/Crelune/apps/web/src/lib/designs/design-job-service.ts): Organisation-scoped `DesignJob` CRUD, status transitions recorded atomically in `DesignJobHistory` + `AuditLog`, archived-member target prevention, advisory-locked birthday flyer creation (`linkedBirthdayTargetYear`) preventing duplicate linked flyers, and `EXPORTED` != `PUBLISHED` enforcement.
- [`apps/web/src/lib/dashboard/dashboard-service.ts`](file:///d:/Projects/Crelune/apps/web/src/lib/dashboard/dashboard-service.ts): Live owner dashboard snapshot aggregating active members, upcoming birthdays, active design jobs, unread notifications, and active due/upcoming items.
- **API Routes**: `/api/birthdays`, `/api/birthdays/[memberId]/[targetYear]/status`, `/api/settings/birthdays`, `/api/designs`, `/api/designs/[id]`, `/api/designs/[id]/transition` (all guarded by `requireApiOwner` + `validateRequestOrigin` CSRF origin validation, Zod validation, and sanitized HTTP error mappers).

### 2.4 CRELUNE Web Experiences (`apps/web`)
- **Birthdays Workspace (`/birthdays`)**: [`BirthdayOperationsClient.tsx`](file:///d:/Projects/Crelune/apps/web/src/components/birthdays/BirthdayOperationsClient.tsx) — Monthly calendar grid & chronological roster, today/upcoming buckets, preparation status transitions, one-click linked birthday flyer job creation, and manual "Run Reminder Sync" action.
- **Design Management Workspace (`/designs`, `/designs/[id]`)**: [`DesignJobsClient.tsx`](file:///d:/Projects/Crelune/apps/web/src/components/designs/DesignJobsClient.tsx), [`DesignJobDetailClient.tsx`](file:///d:/Projects/Crelune/apps/web/src/components/designs/DesignJobDetailClient.tsx), and [`DesignJobModal.tsx`](file:///d:/Projects/Crelune/apps/web/src/components/designs/DesignJobModal.tsx) — Status counters, filters/search, create/edit modal, detail view with explicit transition actions (`Start Work`, `Send to Review`, `Approve`, `Export`, `Publish`, `Archive`, etc.), chronological audit history timeline, and explicit exported-vs-published separation.
- **Notifications Centre (`/notifications`) & Shell Header**: [`NotificationsClient.tsx`](file:///d:/Projects/Crelune/apps/web/src/components/notifications/NotificationsClient.tsx) & [`ShellLayout.tsx`](file:///d:/Projects/Crelune/apps/web/src/components/shell/ShellLayout.tsx) — Filterable notifications inbox (`All` / `Unread`), single & bulk mark-read actions, and live unread notification counter in header/navigation.
- **Settings (`/settings`) & Dashboard (`/`)**: [`BirthdayPreferencesCard.tsx`](file:///d:/Projects/Crelune/apps/web/src/components/settings/BirthdayPreferencesCard.tsx) (IANA timezone, `FEB_28` vs `MAR_1` leap-day policy, custom reminder lead-day chips, quiet hours, sync toggle) and live Dashboard operational overview.
- **Member Profile (`/members/[id]`)**: Extended [`MemberProfileClient.tsx`](file:///d:/Projects/Crelune/apps/web/src/components/members/MemberProfileClient.tsx) with linked Design Jobs list & "Create Design Job" action for active members.

---

## 3. Verification Results & Environment Hygiene

All checks below were executed cleanly **after** all code & test edits:

| Check | Exact Command | Observed Scope & Result | Status |
|---|---|---|---|
| Type check | `npm run type-check` | Zero TypeScript errors across `@crelune/web`, `@crelune/database`, `@crelune/shared`, `@crelune/ui` | **PASS** |
| Linter | `npm run lint` | `next lint` (`✔ No ESLint warnings or errors`) | **PASS** |
| Unit, route & DOM suites | `npm test` | `@crelune/web` (`22` files / `176` tests), `@crelune/shared` (`6` files / `44` tests), `@crelune/ui` (`1` file / `3` tests) = **`223` passed, `0` failed, `0` skipped** | **PASS** |
| DB + Storage integration | `npm run test:integration:db` | Verified Neon `development` (`br-nameless-silence-bexjp44k`), `neondb`; **`6` files / `35` tests passed, `0` failed, `0` skipped** (incl. `design-birthday-bundle.pg.integration.test.ts` `3/3`) | **PASS** |
| Production build | `npm run build` | Clean Next.js `15.5.29` build (after clearing `.next` cache) + `tsc -b` across workspace packages | **PASS** |
| Neon isolation & hygiene | `neon branches list -o json` + dev DB count check | Zero residual `__pg_*` test organisations/rows on `development`; `production` (`br-withered-moon-be8coj8h`) confirmed untouched (`written_data_bytes: 0`) | **PASS** |
| Pre-commit hygiene | `git diff --check` + regex secret scan | Zero whitespace/conflict issues in any bundle files; zero leaked credentials or keys in source files | **PASS** |

*Note on Neon `development` data:* `check-dev-db` confirmed zero leftover automated test data (`designJobs: 0`, `birthdayPreparations: 0`, `birthdayReminders: 0`, `notifications: 0`, `pendingStorageCleanups: 0`, `authThrottles: 0`), while preserving the Product Owner's live `crelune-ops` owner account and `1` owner-created member (`thomas` + `2` audit entries created during manual testing).

---

## 4. Honest Limitations & Milestone 5 Boundary

1. **Automated Reminder Delivery Scheduler:** In-app reminders can be generated and processed synchronously via the `/api/birthdays/sync` endpoint or Settings/Birthdays UI, and `/api/cron/birthday-reminders` enforces `CRON_SECRET`; continuous time-based automated cron invocation relies on external production deployment scheduling (Vercel Cron / server cron — Milestone 9).
2. **Browser E2E Tests:** Interactive UI state flows are verified in `jsdom` via `@testing-library/react`; headless browser Playwright/Cypress E2E tests are deferred to Milestone 9 QA.
3. **Milestone 5+ Deferred Scope:** No Template management, Affinity 3.3 integration, Windows Creative Agent, Events/Programmes, or Asset Library runtime implementation was started; `templateId` and `eventId` on `DesignJob` remain forward-compatible nullable fields.
