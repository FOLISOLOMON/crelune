# Milestone 5, Stage 5.2 — Template Backend Completion Report

**Status:** COMPLETE  
**Branch:** `main`  
**Baseline Commit:** `93f0727570211a44d2822ad0aebadfb896682744`  
**Target Environment:** Neon `development` (`br-nameless-silence-bexjp44k`), Private Creative Bucket `crelune-dev-creative`  
**Production Isolation:** Neon `production` (`br-withered-moon-be8coj8h`) and `crelune-dev-member-photos` untouched.

---

## 1. Summary of Implementation

Stage 5.2 delivers the production-oriented Template Management backend while preserving strict boundaries ahead of Stage 5.3 (Web UI), Stage 5.4 (Windows Creative Agent), and Stage 5.5 (Affinity Scripting & MCP):

1. **Dependencies Added (`apps/web/package.json`)**:
   - `@aws-sdk/s3-request-presigner@^3.1167.0` (Apache-2.0) — generates short-lived (`<= 900s`) presigned `PutObjectCommand` URLs for `crelune-dev-creative`.
   - `@webtoon/psd@^0.4.0` (MIT, zero runtime dependencies) — pure TypeScript/JS read-only PSD v1 parser wrapped behind bounded resource limits.
2. **Shared Schemas & Contracts (`packages/shared/src/schemas/template.ts`)**:
   - Added `templateIdParamSchema`, `templateVersionIdParamSchema`, `uploadIntentIdParamSchema`, `createTemplateUploadIntentRequestSchema`, `TemplateVersionDetail`, and `PresignedUploadTarget`.
3. **Creative Object Storage Provider (`apps/web/src/lib/storage/creative-storage.ts`)**:
   - Implemented `NeonS3CreativeStorageProvider` bound strictly to `getCreativeObjectStorageConfig()` (`crelune-dev-creative`), with `createPresignedPutUrl`, bounded-stream `getObjectBounded`, `headObject`, `putPrivateObject`, `deleteObject`, and `assertCreativeKeyEnvPrefix`.
4. **Bounded PSD Layer Inspector (`apps/web/src/lib/templates/psd-inspector.ts`)**:
   - Implemented `WebtoonPsdLayerInspector` (`engineId: 'webtoon-psd-0.4.0'`) enforcing `8BPS` v1 header validation, `<= 100 MB` size cap, `1..30,000px` dimension bounds, `500` layer nodes max, `16` group depth max, `240` char text preview truncation, and `10s` timeout.
   - Always outputs `extractedMetadataOnly: true` and `editabilityVerified: false` — never claiming live Affinity 3.3 editability.
5. **Template Domain Service & HTTP Layer**:
   - `apps/web/src/lib/templates/template-service.ts`: full CRUD, pagination/filtering, immutable sequential `TemplateVersion` registration with row-level `FOR UPDATE` locking, presigned upload-intent creation & idempotency, authoritative post-PUT download verification (`byteSize`, `sha256`, preview magic bytes + Sharp validation, PSD inspection or native Affinity `.af*` `MANUAL_REQUIRED` fallback), active-version rollback, version-scoped `TemplateFieldMapping` replacement, soft archival/restore, intent abandonment, durable `CreativeStorageCleanup`, and sanitized `AuditLog` events.
   - `apps/web/src/lib/templates/template-http.ts`: standardized JSON responses, Zod error mapping, scoped ID parsing, and sanitized domain error handling.
   - `apps/web/src/lib/auth/audit-service.ts`: added `TEMPLATE_RESTORED`.
   - `apps/web/src/lib/auth/rate-limit.ts`: added `consumeUploadIntentRateLimit` (`60` attempts / `15m`, `5m` block).
6. **App Router API Endpoints (`apps/web/src/app/api/templates/**`)**:
   - `GET /api/templates`, `POST /api/templates`
   - `GET /api/templates/[id]`, `PATCH /api/templates/[id]`
   - `POST /api/templates/[id]/archive`, `POST /api/templates/[id]/restore`
   - `POST /api/templates/[id]/upload-intents`
   - `POST /api/templates/[id]/versions`
   - `GET /api/templates/[id]/versions/[versionId]`
   - `GET /api/templates/[id]/versions/[versionId]/preview` (`Cache-Control: private, no-store`, `X-Content-Type-Options: nosniff`, `X-Robots-Tag: noindex, nofollow, noarchive`)
   - `PUT /api/templates/[id]/versions/[versionId]/mappings`
   - `POST /api/templates/upload-intents/[intentId]/abandon`

---

## 2. Verification Results

| Check | Command | Result | Scope / Notes |
|---|---|---|---|
| Shared Build | `npm run build --workspace=@crelune/shared` | **PASS** | Compiled `@crelune/shared` cleanly |
| Type Check | `npm run type-check` | **PASS** | Zero errors across `@crelune/web`, `@crelune/database`, `@crelune/shared`, `@crelune/ui` |
| Lint | `npm run lint` | **PASS** | `✔ No ESLint warnings or errors` |
| Unit Tests | `npm test` | **PASS** | `@crelune/web` 25 files / 192 tests, `@crelune/shared` 8 files / 53 tests, `@crelune/ui` 1 file / 3 tests |
| DB + S3 Integration | `npm run test:integration:db` | **PASS** | 9 files / 48 tests passed against `br-nameless-silence-bexjp44k` (`neondb`) and `crelune-dev-creative`, with complete `afterAll` cleanup |
| Full Build | `npm run build` | **PASS** | Next.js 15.5.29 production build + all workspace packages compiled cleanly |
