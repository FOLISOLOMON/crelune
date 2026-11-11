# CRELUNE — Milestone 3, Stage 3.3.1: Photo Storage Security & Reliability Hardening Report

- **Date:** 2026-11-11
- **Baseline Commit:** `1cb98ad`
- **Branch:** `main`
- **Target Neon Branch:** `development` (`br-nameless-silence-bexjp44k`, endpoint `ep-muddy-math-ben8e8p7`, database `neondb`)
- **Status:** Implemented and Verified (Stopped prior to Stage 3.4 for Product Owner review)

---

## 1. Exact Runtime Storage Allowlisting (`apps/web/src/lib/storage/storage-config.ts`)

`getObjectStorageConfig()` no longer permits arbitrary non-production hostnames or partial substring matching. It now validates strict HTTPS origin structure (no embedded credentials, ports, paths, or query parameters), rejects placeholder values (`replace-with-...`, `br-example-id`), rejects unapproved environment prefixes (such as `staging`, `preview`, `dev`), and enforces:

| Environment | Exact Endpoint Host | Region | Bucket | Env Prefix | Neon Branch Name | Neon Branch ID |
|---|---|---|---|---|---|---|
| `development` | `br-nameless-silence-bexjp44k.storage.c-9.us-east-2.aws.neon.tech` | `us-east-2` | `crelune-dev-member-photos` | `development` | `development` | `br-nameless-silence-bexjp44k` |
| `production` | *Fail-closed (`APPROVED_PROD_STORAGE_TARGET = null`)* | *Unapproved* | *Unapproved* | `production` | *Fail-closed* | *Fail-closed* |

Explicit rejections verified in `apps/web/src/lib/storage/storage-config.test.ts`:
- Wrong or lookalike endpoints (subdomains, suffixes, alternate regions, custom ports, path injections, non-HTTPS).
- Wrong region, wrong/lookalike bucket, wrong/unapproved environment prefix.
- Missing `NEON_BRANCH` or missing `NEON_BRANCH_ID`, or mismatched branch name and branch ID.
- Development prefix paired with production endpoint, branch, `DATABASE_URL`, or credential branch metadata (`OBJECT_STORAGE_CREDENTIAL_BRANCH_ID`).
- Production prefix paired with development endpoint/bucket/branch/credentials, AND production prefix with unapproved production endpoints (fails closed unconditionally until explicitly provisioned and approved).
- Existing integration-test guardrails in `apps/web/src/test/assert-dev-db.ts` and `apps/web/scripts/run-pg-integration.mjs` remain intact and unweakened.

---

## 2. Upload Request-Body Protection & Hosting Limitations

### Server-Side Bounded Streaming Reader (`apps/web/src/lib/storage/bounded-multipart.ts`)
- Replaced direct `await request.formData()` calls in `POST /api/members/[id]/photo` with `readBoundedMultipartFormData(request, MAX_MULTIPART_CONTENT_LENGTH)`.
- Enforces `MAX_MULTIPART_CONTENT_LENGTH = 10 MiB + 256 KiB` (`10,747,904` bytes) BEFORE multipart parsing begins.
- Pre-checks `Content-Type` (`multipart/form-data; boundary=...`) and optional `Content-Length` syntax/bounds, and **streams `request.body` chunk-by-chunk** via `ReadableStream.getReader()`, cancelling the stream (`reader.cancel()`) and throwing `413 Payload Too Large` immediately if transmitted bytes exceed the limit — even when `Content-Length` is absent or falsely small (e.g., `Content-Length: 128` on a 20 MB stream).
- Inner `file` Blob size is re-verified (`<= 10 MiB`), and malformed/empty multipart payloads fail safely with `400`.

### Hosting Platform Request-Size Limitations (Documented)
- **Next.js 15 App Router Limitation:** Next.js App Router Route Handlers (`app/api/.../route.ts`) do not support legacy `export const config = { api: { bodyParser: { sizeLimit } } }` pre-Edge body-size configuration. Consequently, pre-handler enforcement depends on the hosting ingress / reverse proxy in front of Node.
- **Managed Serverless Hosting (e.g., Vercel Serverless Functions):** Standard Serverless Functions impose a hard **4.5 MB** platform request/response body cap (`FUNCTION_PAYLOAD_TOO_LARGE`) before application code runs, which will reject direct proxied photo uploads between `4.5 MB` and `10 MB` at the edge unless hosted on a Node server / container runtime or migrated later to direct signed uploads.
- **Self-Hosted Node / Reverse Proxy (Nginx, Caddy, Railway, Docker):** Must configure an ingress ceiling slightly above `MAX_MULTIPART_CONTENT_LENGTH` (for example `client_max_body_size 11m;` in Nginx) so oversized bodies are dropped before reaching Node while legitimate `<= 10 MB` photo uploads succeed.

---

## 3. EXIF/GPS Stripping, Orientation & Safe Re-encoding (`apps/web/src/lib/storage/image-processor.ts`)

- Added `sharp` (`0.35.5`, Apache-2.0, requires `Node >= 20.9.0`, configured with `serverExternalPackages: ['sharp']` in `apps/web/next.config.mjs`).
- `processUploadedMemberPhoto()` runs a 3-stage pipeline:
  1. Structural binary pre-validation (`validateUploadedMemberPhoto`), blocking executables, SVG/XML/HTML, filename traversal, container corruption, and dimension/pixel/zlib bombs (`<= 6000x6000`, `<= 25,000,000` pixels, `<= 10 MiB`).
  2. In-memory decoding via `sharp(inputBuffer, { failOn: 'error', limitInputPixels: 25_000_000 })`, strict format match verification (`jpeg`/`png`/`webp`, single-page only — animated/multi-frame rejected), `.rotate()` to bake EXIF orientation (`1..8`) into pixels, `.toColorspace('srgb')` without `.withMetadata()`, and canonical re-encoding (`jpeg({ quality: 88, mozjpeg: true })`, `png({ compressionLevel: 9 })`, `webp({ quality: 88 })`) preserving PNG/WebP transparency and visual fidelity while stripping EXIF, GPS, XMP, IPTC, ICC, and comments.
  3. Post-encoding verification checking final `<= 10 MiB` byte size, re-running `validateUploadedMemberPhoto` on final bytes (plus progressive multi-scan JPEG support added to `image-validator.ts`), and confirming zero residual `exif`, `iptc`, `xmp`, `icc`, `comments`, or non-upright `orientation` markers.
- `uploadMemberPhoto()` enforces `ProcessedMemberPhoto` (`processed: true`) at both compile time and runtime so raw unprocessed upload bytes can never be stored. Metadata values are never logged.

---

## 4. Durable Object Cleanup & Retry Lifecycle

- Added Prisma model `PendingStorageCleanup` (`pending_storage_cleanups`) with enums `StorageCleanupStatus` (`PENDING`, `COMPLETED`, `REJECTED`) and `StorageCleanupReason` (`POST_UPLOAD_VERIFY_FAILURE`, `DB_TRANSACTION_ROLLBACK`, `PREVIOUS_PHOTO_CLEANUP`, `MEMBER_PHOTO_REMOVED`), pushed strictly to Neon `development` (`ep-muddy-math-ben8e8p7.c-9.us-east-2.aws.neon.tech`) with zero changes to `production`.
- When storage deletion fails during upload verification compensation, DB transaction rollback compensation, old-photo cleanup after replacement, or member photo deletion cleanup, `attemptDeleteOrEnqueue` persists a `PENDING` `PendingStorageCleanup` row (idempotently upserted on `storageKey`) with a sanitized error label (`formatSafeCleanupError`, containing only error class + optional HTTP status code — never URLs, keys, or credentials).
- Committed member metadata and audit transactions remain completely independent of downstream external storage deletion failures, and the previous photo remains intact until DB commit succeeds.
- `retryPendingStorageCleanups()` enforces:
  - Approved environment fail-closed check (refuses unapproved targets).
  - Exact environment, organisation, and member key-scope verification via `assertKeyMatchesMemberScope` AND active-photo protection (refuses to delete any key currently referenced by `Member.photoStorageKey`).
  - Out-of-scope or protected keys are marked `REJECTED` and **never** passed to `storage.deleteObject`.
  - Atomic conditional status updates (`where: { id, status: 'PENDING' }`) guaranteeing idempotent retry and safe duplicate-retry no-ops.

---

## 5. Verification Results

| Check | Command | Result |
|---|---|---|
| TypeScript Check | `cmd /c "npm run type-check"` | **PASS** — `0` errors across `@crelune/web`, `@crelune/database`, `@crelune/shared`, `@crelune/ui`. |
| Unit & Route Suites | `cmd /c "npm test"` | **PASS** — `19` test files, `165` tests passed (`@crelune/web`: `14` files / `129` tests; `@crelune/shared`: `4` files / `33` tests; `@crelune/ui`: `1` file / `3` tests), `0` failed, `0` skipped. |
| Neon `development` PG + S3 Integration | `cmd /c "npm run test:integration:db"` | **PASS** — `4` test files, `17` tests passed (`0` failed, `0` skipped) including EXIF/GPS stripped Neon S3 persistence and all `6` durable cleanup/retry/rejection scenarios. |
| Production Build | `cmd /c "npm run build"` | **PASS** — Next.js `15.5.29` production build + `tsc -b` across workspace packages. |
| Post-Test Cleanliness & Prod Isolation | Node/Prisma count + `neon.cmd` | **PASS** — `members: 0`, `auditLogs: 0`, `authThrottles: 0`, `pendingStorageCleanups: 0`; `crelune-dev-member-photos`: `0` objects; `production` (`br-withered-moon-be8coj8h`): `[]` buckets, `written_data_bytes: 0`. |
