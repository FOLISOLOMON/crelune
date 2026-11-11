# CRELUNE — Milestone 3, Stage 3.3.2: Storage, Database & Credential Pairing Hardening Report

- **Date:** 2026-11-11
- **Baseline Commit:** `6c77e9b` (parent `1cb98ad`)
- **Branch:** `main`
- **Target Environment:** Neon `development` (`br-nameless-silence-bexjp44k`) only
- **Status:** Implemented and Verified (Stopped prior to Stage 3.4 for Product Owner review)

---

## 1. Original Gap Identified

During review of Stage 3.3.1, two remaining environment-pairing gaps were identified in runtime object storage configuration ([`storage-config.ts`](../../apps/web/src/lib/storage/storage-config.ts)):

1. **Missing Runtime Database Pairing Check:** `getObjectStorageConfig()` validated `AWS_ENDPOINT_URL_S3`, `AWS_REGION`, `OBJECT_STORAGE_BUCKET`, `OBJECT_STORAGE_ENV_PREFIX`, `NEON_BRANCH`, and `NEON_BRANCH_ID`, but did not inspect `DATABASE_URL` or `DATABASE_URL_UNPOOLED`. A misconfigured deployment could therefore pair development storage credentials/bucket with an arbitrary or production PostgreSQL database URL while `NEON_BRANCH` / `NEON_BRANCH_ID` still declared `development`.
2. **Optional Credential Branch Assertion:** `OBJECT_STORAGE_CREDENTIAL_BRANCH_ID` was previously checked only when set rather than enforced as a mandatory configuration variable.

---

## 2. Runtime Database & Credential Pairing Controls

### Exact Database URL Pairing (`apps/web/src/lib/storage/storage-config.ts`)
- `getObjectStorageConfig()` now requires both `DATABASE_URL` (pooled) and `DATABASE_URL_UNPOOLED` (direct), parsed strictly with `new URL(...)` (no substring or prefix matching).
- For the approved `development` target (`APPROVED_DEV_STORAGE_TARGET`), runtime storage operations are permitted **only** when:

| Variable | Required Exact Value / Target |
|---|---|
| `AWS_ENDPOINT_URL_S3` | `https://br-nameless-silence-bexjp44k.storage.c-9.us-east-2.aws.neon.tech` |
| `AWS_REGION` | `us-east-2` |
| `OBJECT_STORAGE_BUCKET` | `crelune-dev-member-photos` |
| `OBJECT_STORAGE_ENV_PREFIX` | `development` |
| `NEON_BRANCH` | `development` |
| `NEON_BRANCH_ID` | `br-nameless-silence-bexjp44k` |
| `OBJECT_STORAGE_CREDENTIAL_BRANCH_ID` | `br-nameless-silence-bexjp44k` (mandatory) |
| `DATABASE_URL` (pooled) | Host `ep-muddy-math-ben8e8p7-pooler.c-9.us-east-2.aws.neon.tech`, DB `neondb` (PostgreSQL protocol; valid SSL params such as `?sslmode=require` preserved) |
| `DATABASE_URL_UNPOOLED` (direct) | Host `ep-muddy-math-ben8e8p7.c-9.us-east-2.aws.neon.tech`, DB `neondb` (PostgreSQL protocol; valid SSL params such as `?sslmode=require` preserved) |

- Rejects missing URLs, malformed URLs, non-PostgreSQL schemes, swapped pooled/direct URLs, wrong database names, lookalike/suffix/prefix/query-smuggled hosts, arbitrary external databases, and known production database endpoints even when branch metadata declares `development`.
- **Credential-Safe Error Messages:** Validation failures surface only the variable name, host, or database name — never database usernames, passwords, query strings, or raw connection URLs.
- **Fail-Closed Production:** `APPROVED_PROD_STORAGE_TARGET` remains `null`, so `OBJECT_STORAGE_ENV_PREFIX="production"` continues to fail closed unconditionally until production object storage is provisioned and explicitly approved.

### Mandatory `OBJECT_STORAGE_CREDENTIAL_BRANCH_ID` Contract & Limitation
- `OBJECT_STORAGE_CREDENTIAL_BRANCH_ID` is now mandatory in `getObjectStorageConfig()`, `assertSafeDevStorageEnvironment()` ([`assert-dev-db.ts`](../../apps/web/src/test/assert-dev-db.ts)), and [`run-pg-integration.mjs`](../../apps/web/scripts/run-pg-integration.mjs) (must equal `br-nameless-silence-bexjp44k` in development).
- **Important Deployment Limitation:** Documented in [`.env.example`](../../.env.example), `OBJECT_STORAGE_CREDENTIAL_BRANCH_ID` is an **explicit deployment configuration assertion, not cryptographic proof** of which Neon branch issued `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY`. Operators and CI/CD pipelines must still supply genuine branch-scoped S3 credentials alongside matching database URLs and branch metadata.

---

## 3. Verification Results

| Check | Command / Target | Result |
|---|---|---|
| TypeScript Check | `cmd /c "npm run type-check"` | **PASS** — `0` errors across `@crelune/web`, `@crelune/database`, `@crelune/shared`, `@crelune/ui`. |
| Unit & Route Tests | `cmd /c "npm test"` | **PASS** — `19` test files, `166` tests passed (`@crelune/web`: `14` files / `130` tests including `assert-dev-db.test.ts` `10` tests and `storage-config.test.ts` `7` tests; `@crelune/shared`: `4` files / `33` tests; `@crelune/ui`: `1` file / `3` tests), `0` failed, `0` skipped. |
| Neon `development` PG + S3 Integration | `cmd /c "npm run test:integration:db"` | **PASS** — `4` test files, `17` tests passed (`0` failed, `0` skipped) against branch `development` (`br-nameless-silence-bexjp44k`), DB `neondb`. |
| Workspace Production Build | `cmd /c "npm run build"` | **PASS** — Next.js `15.5.29` build + `tsc -b` across workspace packages. |
| Post-Test Cleanliness (`development`) | Prisma table count + `neon bucket object list` | **PASS** — `{"organisations":1,"users":1,"userPreferences":1,"authThrottles":0,"members":0,"birthdayPreparations":0,"birthdayReminders":0,"notifications":0,"auditLogs":0,"pendingStorageCleanups":0}`; `crelune-dev-member-photos` objects: `[]`. |
| Production Isolation Check | `neon bucket list` & `neon branches get production` | **PASS** — `production` (`br-withered-moon-be8coj8h`): `[]` buckets, `written_data_bytes: 0`. |
