# CRELUNE — Milestone 3, Stage 3.2: Member Directory API, Duplicate Detection & Audit Logging Report

- **Date:** 2026-11-11
- **Baseline Commit:** `45935de`
- **Branch:** `main`
- **Target Database:** Neon `development` branch (`br-nameless-silence-bexjp44k`, endpoint `ep-muddy-math-ben8e8p7`, database `neondb`)
- **Status:** Implemented and Verified (Stopped prior to Stage 3.3 for Product Owner review)

---

## 1. Summary

Milestone 3, Stage 3.2 implements the authenticated, organisation-scoped Member Directory backend APIs, shared Zod input validation and DTO contracts (`@crelune/shared`), concurrency-safe normalized duplicate detection (including archived members and explicit confirmation override), and transactional append-only application-level audit logging (`AuditLog`) with PII/secret metadata redaction.

No database schema migrations were added in Stage 3.2; this stage builds strictly on the schema established in Stage 3.1. UI screens, member photo uploads, Neon Object Storage buckets, signed URLs, reminder scheduling/notifications, and production database modifications remain out of scope for Stage 3.2.

---

## 2. Implemented Files

- Shared validation & DTO contracts (`@crelune/shared`):
  - `packages/shared/src/schemas/member.ts`
  - `packages/shared/src/schemas/member.test.ts`
  - `packages/shared/src/index.ts`
- Owner API guard & CSRF/payload parsing (`@crelune/web`):
  - `apps/web/src/lib/auth/api-owner-guard.ts`
- Transactional application-level audit logging (`@crelune/web`):
  - `apps/web/src/lib/audit/audit-service.ts`
  - `apps/web/src/lib/audit/audit-service.test.ts`
- Member directory service & HTTP error mapping (`@crelune/web`):
  - `apps/web/src/lib/members/member-service.ts`
  - `apps/web/src/lib/members/member-service.test.ts`
  - `apps/web/src/lib/members/member-http.ts`
- Next.js App Router API endpoints (`@crelune/web`):
  - `apps/web/src/app/api/members/route.ts` (`GET`, `POST`)
  - `apps/web/src/app/api/members/[id]/route.ts` (`GET`, `PATCH`)
  - `apps/web/src/app/api/members/[id]/archive/route.ts` (`POST`)
  - `apps/web/src/app/api/members/[id]/restore/route.ts` (`POST`)
- Tests (`@crelune/web`):
  - `apps/web/src/app/api/members/members-routes.test.ts`
  - `apps/web/src/test/member-directory.pg.integration.test.ts`

---

## 3. Authentication, Authorisation & CSRF Enforcement

1. **Middleware + Route-Level Defense in Depth**:
   - Next.js Edge `middleware.ts` blocks unauthenticated requests to `/api/members*` with `401 Unauthorized` before route execution.
   - Inside every route handler (`requireAuthenticatedOwnerApi` in `apps/web/src/lib/auth/api-owner-guard.ts`), `resolveAuthenticatedOwner()` performs a server-side Prisma check (`verifyActiveOwnerInDatabase`) verifying `isActive: true`, `role === 'OWNER'`, and matching `sessionVersion`.
   - Revoked, inactive, or non-`OWNER` sessions receive `401 Unauthorized` (`session` cookie cleared).
2. **CSRF Protection on Mutations**:
   - All mutating endpoints (`POST /api/members`, `PATCH /api/members/[id]`, `POST /api/members/[id]/archive`, `POST /api/members/[id]/restore`) call `requireAuthenticatedOwnerApi(request, { verifyCsrf: true })` using `validateRequestOrigin(request)`.
   - Mismatched or missing `Origin`/`Referer` headers return `403 Forbidden` (`{ error: 'Forbidden: Cross-site request rejected' }`).
3. **Request Size & Caching Controls**:
   - JSON mutations (`POST /api/members`, `PATCH /api/members/[id]`) enforce a 16 KB (`DEFAULT_MAX_API_BODY_BYTES = 16384`) limit via `parseJsonBodyWithLimit` (`413 Payload too large` on excess `Content-Length` or decoded byte length; `400` on empty/malformed JSON).
   - All member API JSON responses emit `Cache-Control: private, no-store`.
4. **Strict Organisation Scoping**:
   - All reads and writes filter by `auth.owner.profile.organisationId`. Clients cannot supply `organisationId`, `archivedAt`, or `isActive` (`.strict()` Zod schemas reject unknown keys with `400`).

---

## 4. API Endpoints & Contracts

### `GET /api/members`

- **Auth**: Active owner session required (`401` on unauthenticated/revoked).
- **Query Parameters** (`memberListQuerySchema.strict()`):
  - `q`: optional search string (trimmed, max `100` chars). Matches `normalizedName` (contains), `fullName`/`preferredName` (case-insensitive contains), and `normalizedPhone` (contains, when query contains `>= 3` digits).
  - `status`: `'active' | 'archived' | 'all'` (default `'active'`). Filters `archivedAt === null` (`active`) or `archivedAt !== null` (`archived`).
  - `birthMonth`: optional integer `1..12`.
  - `sort`: `'name_asc' | 'name_desc' | 'birthday_asc' | 'recent'` (default `'name_asc'`).
  - `page`: integer `>= 1` (default `1`).
  - `limit`: integer `1..100` (default `25`).
- **Response (`200 OK`)**: `{ members: MemberDirectoryItem[], pagination: MemberPaginationMeta }`.
  - List projection explicitly omits private `notes` and internal `photoStorageKey` (`hasPhoto: boolean` and `photoUpdatedAt` are exposed instead; `isActive` is derived from `archivedAt`).

### `POST /api/members`

- **Auth & CSRF**: Active owner session + Origin/Referer verification + 16 KB JSON limit.
- **Request Body** (`createMemberSchema.strict()`):
  - `fullName`: required string (`1..150` chars after NFKC whitespace collapse).
  - `preferredName`: optional nullable string (max `80` chars; empty strings normalized to `null`).
  - `birthMonth`: optional nullable int `1..12`.
  - `birthDay`: optional nullable int `1..31` (validated with `validateBirthdayTuple` so `birthMonth` and `birthDay` are paired and valid calendar dates, including `Feb 29` when `birthYear` is omitted or a leap year, and rejecting `Feb 29` on non-leap years such as `2025` or `2100`).
  - `birthYear`: optional nullable int `>= MIN_BIRTH_YEAR` and `<= currentYear` in `Africa/Accra`.
  - `phone`: optional nullable string (max `30` chars; normalized phone must contain `7..15` digits).
  - `email`: optional nullable email (max `254` chars; lowercased).
  - `notes`: optional nullable string (max `4000` chars).
  - `confirmDuplicate`: optional boolean (default `false`).
- **Responses**:
  - `201 Created`: `{ member: MemberDetail }` (includes `notes`).
  - `409 Conflict`: `{ error, code: 'POTENTIAL_DUPLICATE_MEMBER', requiresConfirmation: true, duplicateCandidates: DuplicateCandidateSummary[] }` when matching normalized name or normalized phone exists and `confirmDuplicate` is not `true`.
  - `400 / 401 / 403 / 413 / 500` on validation/auth/CSRF/size/server errors.

### `GET /api/members/[id]`

- **Auth**: Active owner session required (`401`).
- **Path Validation**: `memberIdParamSchema` (`1..64` `[a-zA-Z0-9_-]+`, else `400`).
- **Responses**:
  - `200 OK`: `{ member: MemberDetail }`.
  - `404 Not Found`: `{ error: 'Member not found' }` (returned for both nonexistent IDs and IDs belonging to another organisation).

### `PATCH /api/members/[id]`

- **Auth & CSRF**: Active owner session + Origin/Referer verification + 16 KB JSON limit.
- **Request Body** (`updateMemberSchema.strict()`): Requires at least one updatable field (`fullName`, `preferredName`, `birthMonth`, `birthDay`, `birthYear`, `phone`, `email`, `notes`). Unknown/disallowed fields (`organisationId`, `archivedAt`, `isActive`, `confirmDuplicate`) return `400`.
- **Merged Birthday Integrity**: Inside a database transaction, existing `birthMonth`, `birthDay`, and `birthYear` are merged with patch values and re-checked with `validateBirthdayTuple` before saving (preventing partial clear/invalid date combinations such as changing `birthYear` from `2000` to `2025` on a `Feb 29` member).
- **Responses**: `200 OK` `{ member: MemberDetail }` (`MEMBER_UPDATED` audit log recorded only when at least one field actually changed), or `400 / 401 / 403 / 404 / 413 / 500`.

### `POST /api/members/[id]/archive` & `POST /api/members/[id]/restore`

- **Auth & CSRF**: Active owner session + Origin/Referer verification.
- **Behaviour**: Sets (`archive`) or clears (`restore`) `Member.archivedAt` inside a transaction and writes `MEMBER_ARCHIVED` or `MEMBER_RESTORED` audit event only on actual state transitions. Repeating an already-archived/already-active operation returns idempotently (`changed: false`) without duplicate audit spam.
- **Responses**: `200 OK` `{ member: MemberDetail, changed: boolean }`, or `400 / 401 / 403 / 404 / 500`.

---

## 5. Duplicate Detection & Audit Logging Rules (and Known Limitations)

### Duplicate Detection (`member-service.ts`)
- **Signals Checked**:
  - Exact `normalizedPhone` equality (strong signal: `'PHONE'`), excluding null/empty phone numbers.
  - Exact `normalizedName` equality (possible duplicate: `'NAME'`), or `'PHONE_AND_NAME'` when both match.
- **Priority Ordering**: Candidates sort by `PHONE_AND_NAME` -> `PHONE` -> `NAME`, with active members listed ahead of archived members.
- **Archived Scope**: Archived members (`archivedAt !== null`) are included in duplicate detection so previously registered records are surfaced (`isArchived: true`).
- **Concurrency Safety**: `createMember` executes inside `prisma.$transaction` with an organisation-scoped PostgreSQL transaction advisory lock (`SELECT pg_advisory_xact_lock(hashtext('member_create:' || organisationId))`) before reading candidates and inserting. Simultaneous identical requests serialize cleanly so the second request sees the first member and returns `409 Conflict` instead of creating an unintended silent duplicate.
- **Known Limitations (Documented by Design)**:
  - Duplicate matching relies on exact normalized full-name equality (`NFKC`, trimmed/collapsed spaces, case-folded) and exact normalized phone equality; fuzzy/phonetic matching (e.g., typo similarity or partial name permutations) is not implemented in Stage 3.2.
  - Duplicate confirmation prompts are applied on member creation (`POST /api/members`) rather than member edits (`PATCH`).

### Audit Logging (`audit-service.ts`)
- **Actions**: `MEMBER_CREATED`, `MEMBER_UPDATED`, `MEMBER_ARCHIVED`, `MEMBER_RESTORED`.
- **Atomicity**: Every write passes the active Prisma transaction client `tx` to `recordAuditEvent`. If audit insertion fails or required identifiers are invalid, an error is thrown, rolling back the member create/update/archive/restore transaction completely.
- **Application-Service Append-Only Enforcement**: `audit-service.ts` exposes only `recordAuditEvent` (no update or delete audit helpers exist in application code).
- **Sensitive Metadata Redaction**: `sanitizeAuditMetadata` strips credential keys (`password`, `secret`, `token`, `cookie`, `authorization`, `sessionVersion`), private contact/notes payload keys (`notes`, `phone`, `normalizedPhone`, `email`, `photoStorageKey`, `rawBody`), and bounds string length (`120`), array items (`25`), and object depth (`3`), while allowing boolean presence indicators (`hasNotes`, `hasPhone`, `hasEmail`, `hasBirthday`, `hasBirthYear`) and `changedFields`.

---

## 6. Verification Results (Executed Against Local Workspace & Neon `development`)

| Check | Command | Scope & Results | Status |
|---|---|---|---|
| Unit & Route Tests | `cmd /c "npm test"` | `@crelune/web`: `10` files, `109` tests (including `audit-service.test.ts` `3`, `member-service.test.ts` `2`, `members-routes.test.ts` `5`); `@crelune/shared`: `4` files, `33` tests (including `member.test.ts` `4`); `@crelune/ui`: `1` file, `3` tests. Total: `145` passed, `0` failed, `0` skipped. | PASS |
| TypeScript Check | `cmd /c "npm run type-check"` | Zero TypeScript errors across `@crelune/web`, `@crelune/database`, `@crelune/shared`, `@crelune/ui`. | PASS |
| Neon `development` PG Integration | `cmd /c "npm run test:integration:db"` | Verified guard target `development` (`br-nameless-silence-bexjp44k`, `neondb`). Ran `3` files, `13` tests (`member-birthday-schema.pg.integration.test.ts` `3`, `rate-limit.pg.integration.test.ts` `5`, `member-directory.pg.integration.test.ts` `5`): `13` passed, `0` failed, `0` skipped (`72.59s`). Post-test DB counts verified clean (`members: 0`, `auditLogs: 0`, `authThrottles: 0`, owner/organisation/preference preserved at `1/1/1`). | PASS |
| Production Build | `cmd /c "npm run build"` | Full Next.js 15.5.29 production build (showing `/api/members`, `/api/members/[id]`, `/api/members/[id]/archive`, `/api/members/[id]/restore`) and `@crelune/database`, `@crelune/shared`, `@crelune/ui` `tsc -b` builds succeeded. | PASS |
| Production Branch Safety Check | `cmd /c "neon branches get production -o json"` | Confirmed `production` (`br-withered-moon-be8coj8h`, endpoint `ep-mute-forest-bepsjmsu`) has `written_data_bytes: 0`. Production database untouched. | PASS |
| ESLint CLI | `npm run lint` | ESLint interactive setup still unconfigured in `apps/web` (unchanged from Milestone 2.1.1; Next.js type/lint checks run during `next build`). | NOT CONFIGURED |
| Live `next start` Browser E2E | — | Out of scope for API-only Stage 3.2 (UI pages are Stage 3.3+; HTTP routes verified via Vitest route harness and real PostgreSQL integration). | NOT RUN |
