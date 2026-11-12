# CRELUNE — Milestone 5, Stage 5.1 Completion Report
## Schema, Creative Storage Bucket Separation & Shared Domain Contracts

**Baseline:** `dd13b288a439ed80f26e6f6f53814a591e579848` (`main`)  
**Scope:** Milestone 5 Stage 5.1 ONLY (Schema, Private Creative Bucket, Storage Guards, Shared Contracts & Verification). Stage 5.2 (Template Backend), Stage 5.3 (Web UI), Stage 5.4 (Windows Creative Agent), and Stage 5.5 (Affinity Verification) were **not** started.

---

## 1. Summary of Implemented Deliverables

### 1.1 Prisma Schema & Additive Synchronization (`packages/database/prisma/schema.prisma`)
- Verified additive DDL diff via `prisma migrate diff` (`0` `DROP TABLE`, `0` `DROP COLUMN`, `0` destructive alterations), synchronized to Neon `development` (`br-nameless-silence-bexjp44k`), and regenerated Prisma Client `v6.19.3`:
  - **Enums added:** `TemplateStudioType`, `TemplateFileFormat`, `TemplateInspectionStatus`, `TemplateFieldType`, `CreativeUploadKind`, `CreativeUploadStatus`, `CreativeAgentStatus`, `CreativeDispatchStatus`, `ExportFileFormat`, `CreativeStorageCleanupReason`.
  - **Models added:**
    - `Template`: logical template catalog entry with unique nullable `activeVersionId` enabling atomic version activation and non-destructive rollback.
    - `TemplateVersion`: immutable binary record keyed by unique `(templateId, versionNumber)` and `storageKey`, storing SHA-256 checksum, byte size, MIME metadata, optional preview object key/metadata, and bounded inspection results (`inspectionStatus`, `detectedLayersJson`). Protected by `onDelete: Restrict` against active dispatches.
    - `TemplateFieldMapping`: typed layer mapping (`TEXT`, `IMAGE`, `DATE`, `COLOR`) uniquely constrained per `(templateVersionId, fieldKey)`.
    - `CreativeUploadIntent`: server-issued direct-to-storage upload intent (`PENDING` / `VERIFIED` / `REJECTED` / `EXPIRED` / `ABANDONED`) with `idempotencyKey`, `expectedByteSize`, `maxAllowedBytes`, and `verifiedSha256`.
    - `CreativeAgent`: first-class agent credential registry (`tokenHash`, `tokenPrefix`) with `ACTIVE` / `REVOKED` lifecycle and explicit revocation audit fields (`revokedAt`, `revokedByUserId`, `revocationReason`).
    - `CreativeJobDispatch`: org-scoped handoff queue linking `DesignJob` and `TemplateVersion` with versioned `manifestJson` (`manifestVersion: 1`) and `idempotencyKey`.
    - `ExportRecord`: deliverable artifact registry strictly separated from publication (`isApprovedForPublish` defaults to `false`, `ownerApprovedAt` and `publishedAt` remain `null` until explicit owner action).
    - `CreativeStorageCleanup`: dedicated cleanup queue for `crelune-dev-creative`, preserving `PendingStorageCleanup` untouched for member photos.
  - **Non-destructive `DesignJob` extension:** added nullable `templateId` and `templateVersionId` (`onDelete: SetNull`) plus `creativeDispatches` and `exportRecords` relations.
  - **Zero local filesystem paths:** no workstation/Windows path columns exist anywhere in PostgreSQL.

### 1.2 Private Creative Bucket & Storage Guardrails
- Provisioned private bucket `crelune-dev-creative` (`access_level: private`) on Neon `development` branch `br-nameless-silence-bexjp44k`.
- Preserved `OBJECT_STORAGE_BUCKET="crelune-dev-member-photos"` untouched; added `OBJECT_STORAGE_CREATIVE_BUCKET="crelune-dev-creative"` in `.env.local` and `.env.example`.
- Extended `apps/web/src/lib/storage/storage-config.ts`:
  - Shared validated target resolution via `resolveObjectStorageConfig`, preserving `getObjectStorageConfig()` and adding `getCreativeObjectStorageConfig()`.
  - Enforces strict cross-bucket separation (rejecting `crelune-dev-member-photos` for `OBJECT_STORAGE_CREATIVE_BUCKET` and `crelune-dev-creative` for `OBJECT_STORAGE_BUCKET`) and fail-closed rejection under production configs.
  - Added strict org/environment-scoped key builders and traversal guards across `templates` masters, `templates` previews, `working_assets`, and `exports`.
- Updated `apps/web/src/test/assert-dev-db.ts` (`assertSafeDevCreativeStorageEnvironment`) and `apps/web/scripts/run-pg-integration.mjs` to enforce `crelune-dev-creative` pairing during PostgreSQL/S3 integration tests.
- Documented bucket provisioning and verified S3 / `PutBucketCors` capability in [`docs/STORAGE_CREATIVE_BUCKET.md`](file:///d:/Projects/Crelune/docs/STORAGE_CREATIVE_BUCKET.md) and reconciled [`docs/DATABASE_DESIGN.md`](file:///d:/Projects/Crelune/docs/DATABASE_DESIGN.md).

### 1.3 Shared Domain Rules, PSD Inspector Contract, Schemas & Audit Actions
- `packages/shared/src/domain/template.ts`: capability truth table (`getTemplateFormatCapabilities` returning `supportsNodeLayerInspection: true` for `PSD` and `supportsNodeLayerInspection: false` / `MANUAL_REQUIRED` for `.af`, `.afphoto`, `.afdesign`, `.afpub`), canonical + `custom.<slug>` field keys, dispatch state transitions, byte caps (`100 MB` master, `10 MB` preview, `25 MB` working asset, `50 MB` export), `CREATIVE_DISPATCH_PUBLICATION_RULE = 'EXPORT_DOES_NOT_PUBLISH'`, and `CREATIVE_WORKFLOW_RESPONSIBILITIES`.
- `packages/shared/src/contracts/psd-inspector.ts`: replaceable `PsdLayerInspector` abstraction and bounded `psdInspectionResultSchema` (`extractedMetadataOnly: true`, `editabilityVerified: false`), isolating Stage 5.2 `@webtoon/psd` evaluation behind a swappable contract.
- `packages/shared/src/schemas/template.ts` & `packages/shared/src/schemas/creative-agent.ts`: Zod validation schemas & DTOs rejecting local Windows/UNC/Unix filesystem path literals, traversal sequences, extension/MIME mismatches, and duplicate `fieldKey` mappings.
- `packages/shared/src/schemas/design-job.ts` & `packages/shared/src/schemas/env.ts`: non-destructive optional template references on `DesignJob` schemas/summary DTO and `OBJECT_STORAGE_CREATIVE_BUCKET` in env schema.
- `apps/web/src/lib/audit/audit-service.ts`: added Stage 5.1 `AUDIT_ACTIONS`, `entityType` union members, and sensitive metadata key exclusions (`agenttoken`, `claimtoken`, `manifestjson`, `detectlayersjson`).

---

## 2. Verification Results (Latest Runs)

| Check | Command | Result |
|---|---|---|
| Schema validation & additive diff | `prisma validate` & `prisma migrate diff` against Neon `development` | **PASS** — valid schema; purely additive SQL (`0` drops) |
| Database sync & client generation | `npm run db:push && npm run db:generate` | **PASS** — synced `neondb` on `ep-muddy-math-ben8e8p7` (`development`); generated Prisma Client `v6.19.3` |
| Shared build & tests | `npm run build --workspace=@crelune/shared && npm run test --workspace=@crelune/shared` | **PASS** — `8 passed (8)` files, `53 passed (53)` tests |
| Type-check (all workspaces) | `npm run type-check` | **PASS** — `@crelune/web`, `@crelune/database`, `@crelune/shared`, `@crelune/ui` |
| Lint (`@crelune/web`) | `npm run lint` | **PASS** — `No ESLint warnings or errors` |
| Unit tests (all workspaces) | `npm run test` | **PASS** — Web `23 passed (23)` files / `183 passed (183)` tests; Shared `8 passed (8)` files / `53 passed (53)` tests; UI `1 passed (1)` file / `3 passed (3)` tests (**239 unit tests total, 0 failures, 0 skipped**) |
| Production build (all workspaces) | `npm run build` | **PASS** — Next.js production build (`19/19` static/dynamic compilation) + workspace `tsc -b` |
| PostgreSQL + Neon S3 Integration | `npm run test:integration:db` | **PASS** — `7 passed (7)` files, `41 passed (41)` tests against Neon `development` PostgreSQL & live `crelune-dev-creative` S3 bucket (`0` failures, `0` skipped, all synthetic rows/objects cleaned up) |
| Neon production isolation | `neon bucket list --branch production -o json` & `neon branch get production` | **PASS** — `[]` buckets, `written_data_bytes: 0` on `br-withered-moon-be8coj8h` |

*Note on integration run timing:* An earlier chained run before fixing the PostgreSQL `23001` (`RESTRICT`) error assertion in `stage51-schema-contracts.pg.integration.test.ts` experienced a transient Neon pooler TCP reset (`Os { code: 10054 }`) in 3 tests of `birthday-engine.pg.integration.test.ts`; the subsequent full `npm run test:integration:db` rerun passed all 7 files (`41 passed (41)`) with zero failures.

---

## 3. Preserved Baseline Items

- All 10 pre-existing unstaged modified files remain untouched outside Stage 5.1 commits.
- Stage 5.0 discovery documents ([`CAPABILITY_MATRIX.md`](file:///d:/Projects/Crelune/docs/affinity/CAPABILITY_MATRIX.md) and [`MILESTONE_5_0_DISCOVERY_REPORT.md`](file:///d:/Projects/Crelune/docs/milestones/MILESTONE_5_0_DISCOVERY_REPORT.md)) remain preserved.
- `crelune-dev-member-photos` configuration and `PendingStorageCleanup` workflows remain intact.

