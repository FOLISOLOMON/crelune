# CRELUNE — Milestone 3, Stage 3.3: Private Member Photo Storage Report

- **Date:** 2026-11-11
- **Baseline Commit:** `8be8831`
- **Branch:** `main`
- **Target Neon Branch:** `development` (`br-nameless-silence-bexjp44k`, endpoint `ep-muddy-math-ben8e8p7`, database `neondb`)
- **Status:** Implemented and Verified (Stopped prior to Stage 3.4 for Product Owner review)

---

## 1. Storage Architecture & Provider Method

Stage 3.3 integrates **Neon Object Storage** using its officially documented S3-compatible API via `@aws-sdk/client-s3` configured strictly with `forcePathStyle: true` and SigV4 authentication:

- **Provider Abstraction**: `apps/web/src/lib/storage/object-storage.ts` defines `ObjectStorageProvider` (`putPrivateObject`, `headObject`, `getObject`, `deleteObject`) and `NeonS3ObjectStorageProvider`, decoupling `member-photo-service.ts` from AWS SDK internals.
- **Configuration & Fail-Closed Guard**: `apps/web/src/lib/storage/storage-config.ts` (`getObjectStorageConfig`) enforces server-only credentials (`AWS_ENDPOINT_URL_S3`, `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `OBJECT_STORAGE_BUCKET`, `OBJECT_STORAGE_ENV_PREFIX`) and rejects mismatched branch/environment combinations.
- **No Database Schema Changes**: Reuses `Member.photoStorageKey`, `Member.photoMimeType`, `Member.photoByteSize`, and `Member.photoUpdatedAt` added in Stage 3.1. Image binaries are never stored in PostgreSQL.

---

## 2. Development Bucket Configuration & Environment Isolation

### Actual Provisioned Neon `development` Bucket
- **Project**: `Crelune` (`snowy-glitter-15583384`), region **`aws-us-east-2`** (confirmed supported region for Neon Object Storage).
- **Neon Branch**: `development` (`br-nameless-silence-bexjp44k`).
- **Storage Endpoint**: `https://br-nameless-silence-bexjp44k.storage.c-9.us-east-2.aws.neon.tech` (`AWS_REGION="us-east-2"`).
- **Bucket Name**: `crelune-dev-member-photos`.
- **Privacy Access Level**: `private` (provisioned via `neon bucket create crelune-dev-member-photos --project-id snowy-glitter-15583384 --branch development --access-level private`). Public read is disabled; immutable via S3 API.
- **Branch-Scoped Credential**: Issued dedicated `storage:read` + `storage:write` credential (`crelune-dev-member-photos`) directly on `br-nameless-silence-bexjp44k` rather than inheriting `production`'s default credential. Stored strictly in git-ignored `.env.local` (never logged or bundled in browser code).

### Defense-in-Depth Isolation Controls
1. **Branch-Scoped Storage Endpoint & Credential**: `development` writes hit `br-nameless-silence-bexjp44k.storage.c-9.us-east-2.aws.neon.tech` using a credential valid only for `development` and its descendants (cannot access `production`).
2. **Environment-Prefixed Object Key Structure**: Every object key follows `{envPrefix}/organisations/{organisationId}/members/{memberId}/photos/{generatedUuid}.{ext}` (for `development`: `development/organisations/{organisationId}/members/{memberId}/photos/{uuid}.{ext}`). Original client filenames are never used.
3. **Runtime & Integration Guards**: `getObjectStorageConfig()` and `assertSafeDevStorageEnvironment()` (plus `apps/web/scripts/run-pg-integration.mjs`) fail closed if production branch IDs/hosts (`br-withered-moon-be8coj8h`), production prefixes, wrong buckets, or conflicting shell environment variables appear during development/integration runs.
4. **Production Confirmation**: `neon bucket list --branch production` returns `[]` and `neon branches get production` confirms `written_data_bytes: 0`.

---

## 3. Privacy & Retrieval Strategy

### Authenticated Server-Side Private Streaming (`GET /api/members/[id]/photo`)
Rather than handing browser-facing S3 presigned URLs to the frontend, Stage 3.3 implements authenticated server-side binary retrieval in `GET /api/members/[id]/photo`:

- **Immediate Revocation & Zero Unauthenticated Window**: Every request is checked by Edge `middleware.ts` and `requireAuthenticatedOwnerApi` (`verifyActiveOwnerInDatabase`). Logout, session revocation, role change, or password change revokes access to a copied URL immediately with `401 Unauthorized` (zero presigned-URL expiry window).
- **Zero Storage Key / Credential Exposure**: Browser clients fetch only `/api/members/[id]/photo`. Neither Neon storage hostnames, bucket names, raw `photoStorageKey` paths, nor `X-Amz-Credential` token IDs leave the server.
- **Mandatory Security Response Headers**:
  - `Content-Type` from persisted verified `photoMimeType` (`image/jpeg`, `image/png`, or `image/webp`)
  - `Content-Disposition: inline`
  - `Cache-Control: private, no-store`
  - `X-Content-Type-Options: nosniff`
  - `X-Robots-Tag: noindex, nofollow, noarchive`
- **Archived Member Policy**:
  - `GET` and `DELETE /api/members/[id]/photo` are **allowed** for archived members belonging to the owner's organisation so the owner can inspect historical profiles or purge personal photos without restoring the record first.
  - `POST /api/members/[id]/photo` (upload/replace) is **rejected (`409 Conflict`, code `MEMBER_ARCHIVED`)** on archived members until restored.

---

## 4. Upload Validation Rules (`apps/web/src/lib/storage/image-validator.ts`)

All `POST /api/members/[id]/photo` requests require active owner session + Origin/Referer CSRF verification (`403`) + `multipart/form-data` with a single `file` field:

1. **Client Storage Field Rejection**: Requests carrying client-controlled keys (`storageKey`, `photoStorageKey`, `objectKey`, `key`, `bucket`, `path`, `envPrefix`, `organisationId`) fail immediately with `400 Bad Request`.
2. **Strict Byte-Size Bounds**: Pre-checks `Content-Length` (`<= 10 MB + 256 KB` framing overhead) and actual file size `12 bytes <= size <= 10 MB (10,485,760 bytes)` (`413 Payload Too Large` above `10 MB`).
3. **Dangerous Payload Signature Rejection**: Scans initial bytes (stripping UTF-8 BOM/whitespace) to reject SVG (`<svg`), XML (`<?xml`), HTML (`<!doctype`, `<html`, `<script`), and executable binaries (`MZ`, `\x7fELF`, `#!`).
4. **Magic Bytes + Declared MIME + Filename Consistency**:
   - Accepts only verified JPEG (`FF D8 FF`), PNG (`89 50 4E 47 0D 0A 1A 0A`), or WebP (`RIFF....WEBP`).
   - When declared `file.type` is non-empty, requires exact equality with detected canonical MIME (`image/jpeg`, `image/png`, or `image/webp`).
   - When filename is present, rejects path-traversal sequences (`..`, `/`, `\`, `%2e`, `%2f`, `%5c`, `\0`) and rejects mismatched or disallowed extensions.
5. **Structural Framing, Dimensions & Decompression-Bomb Guard**:
   - Enforces `1..6000` max width/height and `<= 25,000,000` total pixels (`MAX_MEMBER_PHOTO_PIXELS`).
   - **PNG**: Verifies CRC32 on every chunk, strict `IHDR` validation, sequential chunk walk to exact `IEND` at EOF (rejects truncated PNGs and trailing data), and bounded `zlib.inflateSync` on concatenated `IDAT` streams sized from `IHDR` dimensions before decompression.
   - **JPEG**: Sequential marker scan validating every segment length, `SOF0..SOF11` dimension extraction, required `SOS`, and entropy-stream termination at `EOI` (`FF D9`) at EOF.
   - **WebP**: Verifies `RIFF` size `=== bytes.length - 8`, walks `VP8 ` / `VP8L` / `VP8X` subchunks to exact EOF, and verifies keyframe/lossless headers and dimensions.

---

## 5. Replacement, Deletion & Failure Compensation Lifecycle

Implemented in `apps/web/src/lib/members/member-photo-service.ts`:

1. **Upload / Replace (`uploadMemberPhoto`)**:
   - Verifies member exists in owner's organisation and is active before touching storage.
   - Uploads new UUID object `K2` (`putPrivateObject`) and verifies existence & byte length (`headObject`). If upload or verification fails, `K2` is cleaned up best-effort and any previous photo `K1` stays completely untouched.
   - Inside `prisma.$transaction` with member-level PostgreSQL advisory lock (`pg_advisory_xact_lock(hashtext('member_photo:' || memberId))`), updates `Member` metadata and inserts transactional `AuditLog` (`MEMBER_PHOTO_UPLOADED` or `MEMBER_PHOTO_REPLACED`).
   - If Postgres transaction fails, executes best-effort compensation `deleteObject(K2)` so no orphaned object remains in Neon Object Storage.
   - Only after the Postgres commit succeeds is `K1` deleted (`assertKeyMatchesMemberScope` checked before deletion to prevent cross-organisation deletion).
2. **Idempotent Delete (`deleteMemberPhoto`)**:
   - Returns `{ member, removed: false }` cleanly if `photoStorageKey` is already `null` (no redundant audit rows).
   - Otherwise acquires `pg_advisory_xact_lock`, validates key namespace via `assertKeyMatchesMemberScope`, clears all 4 photo columns inside `$transaction` with `MEMBER_PHOTO_REMOVED` audit event, and deletes the S3 object after commit succeeds.

---

## 6. Audit Events (`apps/web/src/lib/audit/audit-service.ts`)

- Added `MEMBER_PHOTO_UPLOADED`, `MEMBER_PHOTO_REPLACED`, and `MEMBER_PHOTO_REMOVED`.
- `sanitizeAuditMetadata` additionally strips `storageKey`, `objectKey`, `signedUrl`, `presignedUrl`, `imageBytes`, `accessKeyId`, and `secretAccessKey` alongside `photoStorageKey`, credentials, and personal contact/notes fields.
- Audit writes commit or roll back atomically within the enclosing Prisma transaction; immutability is enforced at the application-service layer (no database triggers added).

---

## 7. Cost, Allowance & Monitoring (Neon Free Plan Verified)

Verified against `neon orgs list -o json` (`org-lucky-leaf-77881525` is on the **`free`** plan) and official Neon documentation (`neon.com/docs/introduction/plans.md`, `neon.com/docs/storage/overview.md`):

- **Free Plan Object Storage Allowance**: **5 GB per project** shared across all branches (`Copy-on-write` semantics mean branch forks do not duplicate unmodified objects).
- **Free Plan Public Network Transfer (Egress)**: **5 GB per project per month** shared across **both** Postgres queries and Object Storage downloads.
- **No Overage Charges on Free**: Operations that attempt to exceed the storage or egress allowance fail until storage is freed or the plan is upgraded.
- **Paid Plan Reference (Launch / Scale)**: `$0.023 / GB-month` for storage with **no per-operation (`GET`/`PUT`/`LIST`) fees**, plus `500 GB/month` public transfer included (`$0.10/GB` thereafter).
- **Owner Monitoring**: Check project-wide usage anytime under **Project Overview -> Object storage** (storage footprint) and **Monitoring / Billing** (public network transfer) in the Neon Console. Note that because `GET /api/members/[id]/photo` streams through Next.js on `private, no-store`, frequent uncached large portrait views count against Neon's shared egress budget.

---

## 8. Verification Results

| Check | Command | Scope & Results | Status |
|---|---|---|---|
| Unit & Route Suites | `cmd /c "npm test"` | `@crelune/web`: `13` files, `122` tests (`storage-config.test.ts` `4`, `image-validator.test.ts` `5`, `member-photo-route.test.ts` `3`, `assert-dev-db.test.ts` `10`, `audit-service.test.ts` `3`, plus existing auth/middleware/member suites); `@crelune/shared`: `4` files, `33` tests; `@crelune/ui`: `1` file, `3` tests. **Total: `158` passed, `0` failed, `0` skipped.** | PASS |
| TypeScript Check | `cmd /c "npm run type-check"` | Zero errors across `@crelune/web`, `@crelune/database`, `@crelune/shared`, `@crelune/ui`. | PASS |
| Neon `development` PG + S3 Integration | `cmd /c "npm run test:integration:db"` | Guard verified branch `development` (`br-nameless-silence-bexjp44k`), DB `neondb`, pooled/direct DB hosts, and storage host `br-nameless-silence-bexjp44k.storage.c-9.us-east-2.aws.neon.tech`. Executed `4` files, `17` tests (`member-photo.pg.integration.test.ts` `4`, `member-directory.pg.integration.test.ts` `5`, `rate-limit.pg.integration.test.ts` `5`, `member-birthday-schema.pg.integration.test.ts` `3`): **17 passed, 0 failed, 0 skipped**. Verified unauthenticated HTTP `GET` to Neon object URL returns `403`, real JPEG/WebP/PNG upload-replace-delete-compensation lifecycle works end-to-end, and zero synthetic DB rows or S3 objects remain afterward. | PASS |
| Production Build | `cmd /c "npm run build"` | Clean Next.js `15.5.29` build (including `/api/members/[id]/photo`) and `@crelune/database`, `@crelune/shared`, `@crelune/ui` `tsc -b` builds. | PASS |
| Production Isolation Check | `neon.cmd branches get production -o json` & `bucket list` | `production` (`br-withered-moon-be8coj8h`) has `written_data_bytes: 0` and `[]` (zero buckets). | PASS |
| ESLint CLI | `npm run lint` | Still unconfigured interactively in `apps/web` (unchanged from prior milestones; Next.js type/lint checks ran during `next build`). | NOT CONFIGURED |

---

## 9. Known Limitations & Production Deployment Requirements

### Known Limitations
- **Image Format Re-Encoding / EXIF Stripping**: Stage 3.3 validates and stores original verified JPEG/PNG/WebP bytes cleanly without native C++ image-processing dependencies (`sharp`), meaning camera EXIF metadata inside uploaded JPEGs is preserved rather than stripped/re-encoded. Add server-side re-encoding/EXIF stripping if future threat models require stripping GPS/device EXIF tags.
- **Streaming Cache Budget**: `GET /api/members/[id]/photo` intentionally enforces `Cache-Control: private, no-store` to maximize privacy revocation speed; this increases Neon Object Storage egress compared to browser private caching (`max-age`), which is acceptable for single-owner directory traffic but should be monitored against the `5 GB/month` Free plan transfer cap.
- **No Database-Level Audit Triggers**: Audit immutability remains enforced in `audit-service.ts` rather than PostgreSQL row triggers.

### Production Deployment Requirements (Before Production Launch)
1. Provision a dedicated **`private` bucket** on the **`production` Neon branch** (`br-withered-moon-be8coj8h`) — buckets created only on `development` do not automatically sync upward to `production`.
2. Issue a dedicated **production** credential (`storage:read`, `storage:write`) bound to `br-withered-moon-be8coj8h` and set `AWS_ENDPOINT_URL_S3`, `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `OBJECT_STORAGE_BUCKET`, and `OBJECT_STORAGE_ENV_PREFIX="production"` in production host secrets only.
3. Never use `OBJECT_STORAGE_ENV_PREFIX="development"` or `development` credentials in production (`getObjectStorageConfig` blocks cross-branch combinations).

