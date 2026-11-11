# CRELUNE — Milestone 3, Stage 3.5 Verification & Completion Report

**Stage:** 3.5 — Member Directory Experience UI  
**Status:** Complete & Verified (Stopped prior to Stage 3.6 for Product Owner review)  
**Starting Baseline Commit:** `8cb53f1` (`main`)  
**Target Platform & Environment:** CRELUNE Web (`@crelune/web`) · Neon `development` (`br-nameless-silence-bexjp44k`, `neondb`)

---

## 1. Delivered Modules & Files

### 1.1 Pure Form, Formatting & API Client Layer
- [`apps/web/src/lib/members/member-form-utils.ts`](file:///d:/Projects/Crelune/apps/web/src/lib/members/member-form-utils.ts):
  - Zod-backed `buildCreateMemberPayload` and diff-based `buildUpdateMemberPayload` using `@crelune/shared` schemas (`createMemberSchema`, `updateMemberSchema`).
  - Date-only birthday display formatting (`formatMemberBirthday`, `formatBirthdayMonthDay`) without `new Date()` timezone-shift risk; preserves `birthYear: null` when unknown and clears all three birthday fields atomically when removed.
  - Client image file pre-validation (`validateClientPhotoFile`: `image/jpeg`, `image/png`, `image/webp`, non-empty, max `10 MB`) and private cache-busted stream URL builder (`getMemberPhotoStreamUrl`: `/api/members/[id]/photo?v=...` without storage keys).
  - Duplicate match-reason descriptions and Zod/API field issue mapping (`mapServerIssuesToFieldErrors`).
- [`apps/web/src/lib/members/member-api-client.ts`](file:///d:/Projects/Crelune/apps/web/src/lib/members/member-api-client.ts):
  - Same-origin authenticated client wrappers (`credentials: 'same-origin'`) for `/api/members`, `/api/members/[id]`, `/archive`, `/restore`, and `/photo` (`POST`/`DELETE`), handling `409 POTENTIAL_DUPLICATE_MEMBER` and typed `MemberApiError` field errors.

### 1.2 Member Directory & Profile Components
- [`apps/web/src/components/members/MemberAvatar.tsx`](file:///d:/Projects/Crelune/apps/web/src/components/members/MemberAvatar.tsx): Private photo thumbnail rendering via `/api/members/[id]/photo` with fallback initials and graceful load-error fallback.
- [`apps/web/src/components/members/MemberFormFields.tsx`](file:///d:/Projects/Crelune/apps/web/src/components/members/MemberFormFields.tsx): Shared accessible form fields for Full Name (`*`), Preferred Name, Date-Only Birthday (`birthMonth`, `birthDay`, optional `birthYear`), Phone, Email, and Private Pastoral/Creative Notes with field-level error presentation.
- [`apps/web/src/components/members/DuplicateMemberDialog.tsx`](file:///d:/Projects/Crelune/apps/web/src/components/members/DuplicateMemberDialog.tsx): Accessible confirmation dialog showing `duplicateCandidates` (`Active`/`Archived` status, match reason, birthday day/month, inspect profile link) with safe cancellation (retaining entered form fields) and explicit `confirmDuplicate: true` retry.
- [`apps/web/src/components/members/AddMemberModal.tsx`](file:///d:/Projects/Crelune/apps/web/src/components/members/AddMemberModal.tsx): Member creation workflow with duplicate-submit protection, duplicate-confirmation flow, and optional initial photo preview + post-creation private upload (preserving the created member record with a clear retry banner if an optional photo upload fails transiently).
- [`apps/web/src/components/members/MemberPhotoManager.tsx`](file:///d:/Projects/Crelune/apps/web/src/components/members/MemberPhotoManager.tsx): Private profile photo upload, live browser `URL.createObjectURL` preview (cleaned up on change/unmount), replace, confirmation-guarded removal, and archived-member upload lock notice.
- [`apps/web/src/components/members/MemberDirectoryClient.tsx`](file:///d:/Projects/Crelune/apps/web/src/components/members/MemberDirectoryClient.tsx): Responsive desktop table and mobile card directory with debounced search (`q`), status (`active`/`archived`/`all`), birth month filter, sorting, loading skeletons, distinct empty states, error retry banner, pagination, and strict omission of private `notes`.
- [`apps/web/src/components/members/MemberProfileClient.tsx`](file:///d:/Projects/Crelune/apps/web/src/components/members/MemberProfileClient.tsx): Full member profile view, prepopulated inline edit mode (`PATCH /api/members/[id]`), private photo manager, and confirmation-guarded Archive / Restore lifecycle controls without any permanent delete operation.

### 1.3 Web Routes
- [`apps/web/src/app/(dashboard)/members/page.tsx`](file:///d:/Projects/Crelune/apps/web/src/app/(dashboard)/members/page.tsx): Auth-guarded Server Component (`resolveAuthenticatedOwner`, `force-dynamic`) hydrating initial active members via `listMembers`.
- [`apps/web/src/app/(dashboard)/members/[id]/page.tsx`](file:///d:/Projects/Crelune/apps/web/src/app/(dashboard)/members/[id]/page.tsx): Auth-guarded Server Component (`resolveAuthenticatedOwner`, `force-dynamic`) validating `memberIdParamSchema` and loading `MemberDetail` via `getMemberById`, with a clean not-found view.

### 1.4 Automated UI & Helper Tests Added
- [`apps/web/src/lib/members/member-ui-logic.test.ts`](file:///d:/Projects/Crelune/apps/web/src/lib/members/member-ui-logic.test.ts) (`12` tests)
- [`apps/web/src/components/members/member-components.test.tsx`](file:///d:/Projects/Crelune/apps/web/src/components/members/member-components.test.tsx) (`7` tests using `react-dom/server` `renderToStaticMarkup` and Server Component auth/not-found assertions)

---

## 2. Verification Results & Honest Limitations

All checks below ran after the final Stage 3.5 code edit:

| Check | Exact Command | Outcome & Observed Scope | Status |
|---|---|---|---|
| Type check | `npm run type-check` | Passed cleanly across `@crelune/web`, `@crelune/database`, `@crelune/shared`, and `@crelune/ui` | **PASS** |
| Unit & component suite | `npm test` | `@crelune/web`: **18 files, 160 tests passed** (incl. 19 new Stage 3.5 tests); `@crelune/shared`: **4 files, 34 tests passed**; `@crelune/ui`: **1 file, 3 tests passed** | **PASS** |
| DB integration suite (Neon `development`) | `npm run test:integration:db` | Verified target `development` (`br-nameless-silence-bexjp44k`), `neondb`; **5 files, 32 tests passed**; post-run Neon `development` counts confirmed (`members: 0`, `birthdayReminders: 0`, `notifications: 0`, `auditLogs: 0`) | **PASS** |
| Production build | `npm run build` | Next.js `15.5.29` build + TypeScript project builds across `@crelune/database`, `@crelune/shared`, `@crelune/ui`; `/members` (`6.41 kB`) and `/members/[id]` (`5.07 kB`) compiled cleanly as dynamic routes | **PASS** |
| Workspace ESLint script | `npm run lint` | `next lint` exited `1` in non-interactive shell because `@crelune/web` has no configured `.eslintrc` file yet (prompts interactively) | **BLOCKED** |
| Live headless browser E2E | — | No browser E2E runner (Playwright/Cypress) or `@testing-library/react` / `jsdom` is installed in the workspace | **NOT RUN** |

---

## 3. Scope Guard & Stage 3.6 Boundary

- No Stage 3.6 UI features were started (no birthday calendar UI, birthday dashboard widgets, birthday preparation workflow UI, notification centre UI, or reminder preferences settings UI).
- Pre-existing unstaged files outside Stage 3.5 scope (`SessionRevokedNotice.tsx`, `owner-guard.ts`, and earlier milestone reports) remain untouched and unstaged.
