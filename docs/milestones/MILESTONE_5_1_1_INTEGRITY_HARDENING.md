# Milestone 5.1.1 — Database Integrity Hardening Completion Report

**Status:** COMPLETE (verified against Neon `development`; stopped prior to Stage 5.2 for Product Owner review)  
**Branch:** `main`  
**Baseline Commit:** `ffe203b796e29c6019b12e6bb70c75032a5cef05`  
**Target Database:** Neon `development` (`br-nameless-silence-bexjp44k`, `ep-muddy-math-ben8e8p7`, `neondb`)  
**Scope:** Organisation-scoped referential integrity, template/version consistency across templates, design jobs, dispatches, and exports, plus PostgreSQL-enforced `TemplateVersion` immutability. Stage 5.2+ not started.

---

## 1. Summary of Changes

### 1.1 Organisation-Scoped Composite Keys & Foreign Keys (`packages/database/prisma/schema.prisma`)

- Added composite unique constraints (`[organisationId, id]`, `[organisationId, templateId, id]`, `[organisationId, id, activeVersionId]`, `[organisationId, uploadIntentId]`, `[organisationId, designJobId, id]`) across `User`, `DesignJob`, `Template`, `TemplateVersion`, `CreativeUploadIntent`, `CreativeAgent`, `CreativeJobDispatch`, and `ExportRecord`.
- Replaced single-column cross-model foreign keys with composite foreign keys so every parent/child link within the creative domain enforces identical `organisation_id` values directly in PostgreSQL.
- Enforced same-template and same-job consistency at the schema/FK layer:
  - `Template.activeVersion` uses `(organisation_id, id, active_version_id)` -> `TemplateVersion(organisation_id, template_id, id)`.
  - `DesignJob.templateVersion` uses `(organisation_id, template_id, template_version_id)` -> `TemplateVersion(organisation_id, template_id, id)`.
  - `ExportRecord.dispatch` uses `(organisation_id, design_job_id, dispatch_id)` -> `CreativeJobDispatch(organisation_id, design_job_id, id)`.
- Used `onDelete: NoAction` / `Restrict` on referenced templates, template versions, agents, users, and dispatches to prevent deleting in-use records while preserving version rollback (`activeVersionId` updates) and soft archival (`archivedAt` / `isActive`).

### 1.2 PostgreSQL Consistency & Immutability Triggers (`packages/database/prisma/sql/milestone_5_1_1_integrity.sql`, `package.json`)

Added idempotent SQL triggers and wired `"db:integrity"` in `package.json`:

- **`trg_design_jobs_template_consistency`** (`crelune_enforce_design_job_template_consistency`):
  - Rejects setting `template_version_id` when `template_id IS NULL` (closing PostgreSQL's `MATCH SIMPLE` composite-FK bypass on partial NULLs).
  - Blocks changing `template_id` or `template_version_id` when an active (`status NOT IN ('CANCELLED', 'FAILED')`) `CreativeJobDispatch` conflicts.
- **`trg_creative_job_dispatches_template_consistency`** (`crelune_enforce_dispatch_template_consistency`):
  - Enforces matching `organisation_id`, `DesignJob.template_id`, and pinned `DesignJob.template_version_id` on `CreativeJobDispatch` `INSERT`/`UPDATE`.
- **`trg_template_versions_immutability`** (`crelune_enforce_template_version_immutability`):
  - Blocks modifying `id`, `organisation_id`, `template_id`, `version_number`, `format`, `storage_bucket`, `storage_key`, `original_filename`, `mime_type`, `byte_size`, `sha256`, `uploaded_by_user_id`, `created_at`, or `upload_intent_id` once finalised (`IS NOT NULL`), while allowing controlled updates to inspection metadata (`inspection_status`, `inspection_summary`, `detected_layers_json`, `inspected_at`, `width_px`, `height_px`) and preview metadata (`preview_storage_key`, `preview_mime_type`, `preview_byte_size`).

### 1.3 Known Trigger Limitations & Documentation (`docs/DATABASE_DESIGN.md`)

- Updated `docs/DATABASE_DESIGN.md` to document all composite foreign keys, trigger behaviour, rollback/archival compatibility, and standard PostgreSQL trigger caveats (sessions using `session_replication_role = replica` or table/superuser DDL `DISABLE TRIGGER` bypass triggers and must be restricted to trusted maintenance roles).

### 1.4 PostgreSQL Integration Test Coverage (`apps/web/src/test/stage511-db-integrity.pg.integration.test.ts`)

- Verified direct PostgreSQL rejection of cross-organisation relationships across `Template`, `TemplateVersion`, `TemplateFieldMapping`, `CreativeUploadIntent`, `CreativeAgent`, `User`, `DesignJob`, `CreativeJobDispatch`, and `ExportRecord`.
- Verified `Template.activeVersionId`, `DesignJob`, `CreativeJobDispatch`, and `ExportRecord` cross-template/cross-version/cross-job consistency and `MATCH SIMPLE` NULL-bypass prevention.
- Verified `TemplateVersion` field immutability, permitted inspection updates, in-use deletion protection, and active-version rollback + archival flows.

---

## 2. Verification Results

All checks ran against verified Neon `development` (`br-nameless-silence-bexjp44k`, `ep-muddy-math-ben8e8p7`, `neondb`) after all code and test edits:

| Check | Command | Result |
|---|---|---|
| Prisma Schema Validation | `prisma validate --schema=packages/database/prisma/schema.prisma` | **PASS** |
| Post-Trigger Schema Diff | `prisma migrate diff --from-schema-datasource=... --to-schema-datamodel=... --script` | **PASS** (`-- This is an empty migration.`) |
| Prisma Client Generation | `npm run db:generate` | **PASS** (`v6.19.3`) |
| TypeScript Type-Check | `npm run type-check` (`@crelune/web`, `@crelune/database`, `@crelune/shared`, `@crelune/ui`) | **PASS** |
| Linting | `npm run lint` (`next lint`) | **PASS** (`No ESLint warnings or errors`) |
| Unit Tests | `npm test` | **PASS** (`23` files / `183` tests in `@crelune/web`; `8` / `53` in `@crelune/shared`; `1` / `3` in `@crelune/ui` — `32` files, `239` tests) |
| PostgreSQL Integration Suite | `npm run test:integration:db` | **PASS** (`8` files, `44` tests; includes `3` tests in `stage511-db-integrity.pg.integration.test.ts` and `2` in `stage51-schema-contracts.pg.integration.test.ts`) |
| Workspace Production Build | `npm run build` | **PASS** (`@crelune/web` Next.js 15.5.29, `@crelune/database`, `@crelune/shared`, `@crelune/ui`) |

### Database & Isolation Checks

- **Neon `development` cleanup:** Verified `0` leftover test rows across `templates`, `template_versions`, `template_field_mappings`, `creative_upload_intents`, `creative_agents`, `creative_job_dispatches`, `export_records`, `creative_storage_cleanups`, and `design_jobs` template references.
- **Neon `production` isolation:** Verified `production` (`br-withered-moon-be8coj8h`) remains untouched (`[]` object-storage buckets, `written_data_bytes: 0`).
