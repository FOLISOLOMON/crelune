# CRELUNE — Critical Correction Cycle Report (Stage 3.6 & Milestone 4)

- **Project:** CRELUNE
- **Baseline Commit:** `82a256bf2a1c452da35b1614cfb91e74756cdf32` (`main`)
- **Scope:** Corrective remediation for independent code-review Findings 1, 2, and 3
- **Database Environment:** Neon `development` (`br-nameless-silence-bexjp44k`), production untouched (`written_data_bytes: 0`)

---

## 1. Summary of Defects & Fixes

### Finding 1 — Swapped `resolveCelebrationDateForYear` Arguments
- **Defect**: `updateBirthdayPreparationStatus` in [`birthday-overview-service.ts`](file:///d:/Projects/Crelune/apps/web/src/lib/birthdays/birthday-overview-service.ts) invoked `resolveCelebrationDateForYear(targetYear, member.birthMonth, member.birthDay, settings.leapDayPolicy)` instead of `(member.birthMonth, member.birthDay, targetYear, settings.leapDayPolicy)`.
- **Audit of All Call Sites**: Verified all other call sites (`birthday-overview-service.ts` overview query, `birthday-processor-service.ts`, both call sites in `birthday-schedule-service.ts`, and `design-job-service.ts`) already passed `(birthMonth, birthDay, targetYear, leapDayPolicy)`.
- **Fix**: Corrected argument order and added explicit `Number.isInteger(targetYear) && targetYear >= 2000 && targetYear <= 2200` guard throwing `MemberValidationError`.

### Finding 2 — Concurrent Duplicate Birthday Design Jobs
- **Defect**: `createDesignJob` in [`design-job-service.ts`](file:///d:/Projects/Crelune/apps/web/src/lib/designs/design-job-service.ts) created `BIRTHDAY_FLYER` jobs and upserted `BirthdayPreparation` without a per-tuple concurrency lock or duplicate rejection, and without checking existing `BirthdayPreparation.designJobId` ownership.
- **Duplicate Policy ([ADR 014](../TECHNICAL_DECISIONS.md#adr-014--birthday-design-job-uniqueness-advisory-locking--preparation-reconciliation))**: Reject attempts to create, edit, or reopen a duplicate active (`status !== 'CANCELLED'`) `BIRTHDAY_FLYER` job for the same `(organisationId, memberId, birthdayTargetYear)`, or attach onto a `BirthdayPreparation` owned by a different job, with **HTTP `409 Conflict`** (`DesignJobConflictError`, code `DUPLICATE_BIRTHDAY_DESIGN_JOB` / `BIRTHDAY_PREP_ALREADY_LINKED`).
- **Fix**: Added exported `deriveBirthdayDesignJobLockKeys` (SHA-256 of canonical `JSON.stringify(['crelune:birthday-design-job:v1', organisationId, memberId, targetYear])`, reading two signed 32-bit big-endian ints) and sorted `pg_advisory_xact_lock(int4, int4)` acquisition inside `prisma.$transaction`, plus `assertNoBirthdayJobOrPrepConflict` and HTTP `409` handling in [`design-http.ts`](file:///d:/Projects/Crelune/apps/web/src/lib/designs/design-http.ts).

### Finding 3 — `BirthdayPreparation.designJobId` Reconciliation & Schema Consistency
- **Defect**: `updateDesignJob` could change `memberId` or `category` (including clearing `memberId` or switching away from `BIRTHDAY_FLYER`) without detaching old `BirthdayPreparation.designJobId` links, updating destination links, clearing `birthdayTargetYear`, or locking rows; `transitionDesignJobStatus` did not detach on `CANCELLED` or guard conflicts on `CANCELLED -> DRAFT`; Zod schemas allowed incomplete `BIRTHDAY_FLYER` jobs (`memberId` without `birthdayTargetYear`).
- **Fixes**:
  - Updated [`schemas/design-job.ts`](file:///d:/Projects/Crelune/packages/shared/src/schemas/design-job.ts): `BIRTHDAY_FLYER` creation and updates require both `memberId` and `birthdayTargetYear` (`2000..2200`), and non-birthday jobs forbid non-null `birthdayTargetYear`.
  - Updated `updateDesignJob` in [`design-job-service.ts`](file:///d:/Projects/Crelune/apps/web/src/lib/designs/design-job-service.ts) to lock `design_jobs` (`FOR UPDATE`), validate active member & complete birthday invariants, acquire sorted advisory locks for `[oldTuple, newTuple]`, reject conflicts with `409`, detach prior `BirthdayPreparation` rows ONLY when `designJobId === job.id` (preserving `status` and `notes`), auto-clear `birthdayTargetYear = null` when leaving `BIRTHDAY_FLYER`, and attach destination preparation without overwriting `PUBLISHED`, `SKIPPED`, or existing non-`UPCOMING` statuses.
  - Updated `transitionDesignJobStatus` to acquire the birthday tuple lock on `CANCELLED` / `CANCELLED -> DRAFT`, detach `BirthdayPreparation.designJobId` cleanly when cancelling (preserving status), and enforce duplicate/ownership checks before re-linking on `CANCELLED -> DRAFT`.
  - Aligned [`MemberProfileClient.tsx`](file:///d:/Projects/Crelune/apps/web/src/components/members/MemberProfileClient.tsx) (pre-filling computed next `birthdayTargetYear` and `dueDate` on 1-click Member Profile flyer creation), [`DesignJobModal.tsx`](file:///d:/Projects/Crelune/apps/web/src/components/designs/DesignJobModal.tsx), [`DesignJobDetailClient.tsx`](file:///d:/Projects/Crelune/apps/web/src/components/designs/DesignJobDetailClient.tsx), and [`design-form-utils.ts`](file:///d:/Projects/Crelune/apps/web/src/lib/designs/design-form-utils.ts).

---

## 2. Verification Summary

- `npm run build --workspace=@crelune/shared`: `PASS`
- `npm run type-check`: `PASS` (`0` TypeScript errors across `@crelune/web`, `@crelune/database`, `@crelune/shared`, `@crelune/ui`)
- `npm run lint`: `PASS` (`No ESLint warnings or errors`)
- `npm test`: `PASS` (`30` test files, `227` tests passed, `0` failed, `0` skipped — `180` web, `44` shared, `3` ui)
- `npm run test:integration:db` (Neon `development` `br-nameless-silence-bexjp44k`): `PASS` (`6` test files, `39` tests passed, `0` failed, `0` skipped)
- Clean `npm run build`: `PASS` (`Next.js 15.5.29` + workspace `tsc -b`)
- Neon `production` (`br-withered-moon-be8coj8h`): untouched (`written_data_bytes: 0`)
- Neon `development` workspace preservation: verified `1` organisation (`crelune-ops`), `1` owner, `1` member (`thomas`), `2` auditLogs, and `0` leaked synthetic `__pg_*` records.
