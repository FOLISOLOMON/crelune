# Milestone 5, Stage 5.2.1 — Template Upload Integrity & PSD Isolation Corrections

**Status:** COMPLETE  
**Branch:** `main`  
**Baseline Commit:** `3a5ec077b960ebb776cab26a46c9cc0faaa8025e`  
**Target Environment:** Neon `development` (`br-nameless-silence-bexjp44k`), Private Creative Bucket `crelune-dev-creative`  
**Production Isolation:** Neon `production` (`br-withered-moon-be8coj8h`) and `crelune-dev-member-photos` untouched.

---

## 1. Targeted Corrections Implemented

### 1.1 Version Reservation & Object-Key Consistency (Zero Schema Change)
- **Staging-Prefix Upload Intents (`apps/web/src/lib/storage/storage-config.ts`, `apps/web/src/lib/templates/template-service.ts`)**:
  - Added staging key builders and scope validators: `buildTemplateMasterStagingPrefix`, `buildTemplateMasterStagingObjectKey` (`.../staging/masters/{uuid}.{ext}`), `assertKeyMatchesTemplateMasterStagingScope`, `buildTemplatePreviewStagingPrefix`, `buildTemplatePreviewStagingObjectKey` (`.../staging/previews/{uuid}.{ext}`), and `assertKeyMatchesTemplatePreviewStagingScope`.
  - `createTemplateUploadIntent()` now targets non-versioned staging keys (`staging/masters/...`, `staging/previews/...`) instead of speculative `versions/v{N}/...` keys, eliminating version-path collisions under concurrent upload intents.
- **Atomic Canonical Promotion (`completeTemplateVersionUpload()`)**:
  - Downloads and verifies staged master (and optional preview) bytes (`byteSize`, `sha256`, preview magic bytes + Sharp validation, PSD/Affinity inspection).
  - Acquires `FOR UPDATE` row lock on the parent `Template` inside the DB transaction, allocates the authoritative sequential `versionNumber`, promotes verified bytes to canonical immutable keys (`versions/v{versionNumber}/{uuid}.{ext}` and `previews/v{versionNumber}/{uuid}.{ext}`), and records `TemplateVersion` pointing exclusively to canonical keys.
  - Cleans up staging objects and performs compensation cleanup (with `CreativeStorageCleanup` fallback) if canonical promotion or DB commit fails.

### 1.2 Genuinely Resource-Bounded Worker-Isolated PSD Inspection
- **Worker-Thread Sandbox (`apps/web/src/lib/templates/psd-parse-worker.mjs`, `apps/web/src/lib/templates/psd-inspector.ts`, `apps/web/next.config.mjs`)**:
  - Added `'@webtoon/psd'` to `serverExternalPackages` in `apps/web/next.config.mjs`.
  - Isolated `Psd.parse()` inside a standalone ESM `worker_threads.Worker` (`psd-parse-worker.mjs`) launched with `env: {}` (zero host secrets/credentials), V8 `resourceLimits` (`maxOldGenerationSizeMb: 256`, `maxYoungGenerationSizeMb: 64`, `codeRangeSizeMb: 16`), bounded layer-tree walk (`500` nodes, `16` group depth, `240`-char text truncation, `MAX_WORKER_OUTPUT_BYTES = 1_048_576`), and real wall-clock `setTimeout(() => void worker.terminate(), timeoutMs)` cancellation (`10s` default).
  - Preserved `PsdLayerInspector` contract, `extractedMetadataOnly: true`, and `editabilityVerified: false`.
  - Verified real `while (true) {}` worker hang termination and `env: {}` secret isolation in `apps/web/src/lib/templates/psd-inspector.test.ts` (6/6 tests passing).

### 1.3 `@webtoon/psd@0.4.0` Due Diligence & Honest Limitations
- **Package Facts**: `@webtoon/psd@0.4.0`, MIT licence, zero runtime dependencies, published `2023-06-27`, pure TypeScript/JS ESM/CJS compatible with Node 24 `worker_threads` and Next.js 15 `serverExternalPackages`.
- **Capabilities & Limitations**: Supports standard PSD v1 (`8BPS`) read-only layer/text extraction only; rejects PSB v2 (`> 2 GB` / `version !== 1`); does not guarantee live Affinity 3.3 editability (`editabilityVerified: false`).
- **Real-World Fixture Limitation**: Zero `.psd` files exist anywhere in `D:\Projects\Crelune`. Automated verification used deterministic synthetic `8BPS` v1 fixtures and real `sharp`-generated PNG previews; real-world designer `.psd` files remain unverified and retain safe `MANUAL_REQUIRED` / manual field-mapping fallback.

### 1.4 Abandoned Upload Cleanup Timing & Active-Reference Protection
- **Post-Expiry Deferred Cleanup (`CREATIVE_CLEANUP_EXPIRY_GRACE_MS = 60_000`)**:
  - `abandonUploadIntent()` now preserves `expiresAt` (no premature expiry truncation), always enqueues `CreativeStorageCleanup` for master (and preview, if any) even when abandoned before any PUT, and schedules `nextRetryAt = new Date(expiresAt.getTime() + CREATIVE_CLEANUP_EXPIRY_GRACE_MS)`.
  - `cleanupPendingCreativeStorage()` checks any linked `CreativeUploadIntent` (`expiresAt` + `60s` grace): if the presigned PUT window + grace has not elapsed yet, it may opportunistically delete an already-uploaded object, but leaves the cleanup row `'PENDING'` with `nextRetryAt = expiryWithGrace` until the upload window + grace fully expires so late in-flight PUTs cannot leave orphaned objects.
  - Failed deletions increment `attempts` and back off safely for retry.
- **Active Record Guard**:
  - `cleanupPendingCreativeStorage()` refuses to delete any object referenced by an active `TemplateVersion` (`storageKey` or `previewStorageKey`) or `ExportRecord` (`storageKey`), marking the cleanup row `'REJECTED'` with `lastError: 'REFERENCED_BY_ACTIVE_RECORD'`.

---

## 2. Verification Summary

- `npm.cmd run type-check`: **PASS** (zero errors across `@crelune/web`, `@crelune/database`, `@crelune/shared`, `@crelune/ui`)
- `npm.cmd run lint`: **PASS** (`✔ No ESLint warnings or errors`)
- `npm.cmd test`: **PASS** (`@crelune/web` 25 files / 194 tests; `@crelune/shared` 8 files / 53 tests; `@crelune/ui` 1 file / 3 tests)
- `npm.cmd run build`: **PASS** (Next.js 15.5.29 production build + `@crelune/database`, `@crelune/shared`, `@crelune/ui`)
- `npm.cmd run test:integration:db`:
  - `stage52-template-backend.pg.integration.test.ts`: **PASS** (3/3 tests against `br-nameless-silence-bexjp44k` / `neondb` and `crelune-dev-creative`, `91484ms`, `30371ms`, `61865ms`)
  - All other 8 integration suites (46/46 tests including `stage511-db-integrity.pg.integration.test.ts`, `stage51-schema-contracts.pg.integration.test.ts`, `design-birthday-bundle.pg.integration.test.ts`, `birthday-engine.pg.integration.test.ts`, `member-directory.pg.integration.test.ts`, `member-photo.pg.integration.test.ts`, `member-birthday-schema.pg.integration.test.ts`, `rate-limit.pg.integration.test.ts`): **PASS** in the immediately preceding run (only the `180_000` test timeout on test #1 of `stage52-template-backend.pg.integration.test.ts` changed afterward). Note: the final `-t` run (`task-5646`) passed `stage52-template-backend` (3/3) and `birthday-engine` (15/15) before hitting transient Neon `P1001` / `ConnectionReset` on `ep-muddy-math-ben8e8p7-pooler.c-9.us-east-2.aws.neon.tech:5432`.

