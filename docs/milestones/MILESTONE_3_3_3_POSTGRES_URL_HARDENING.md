# CRELUNE — Milestone 3, Stage 3.3.3: PostgreSQL Connection URL Hardening Report

- **Date:** 2026-11-11
- **Baseline Commit:** `4131baa` (parent `6c77e9b` -> `4131baa`)
- **Branch:** `main`
- **Target Environment:** Neon `development` (`br-nameless-silence-bexjp44k`) only
- **Status:** Implemented and Verified (Stopped prior to Stage 3.4 for Product Owner review)

---

## 1. Issue & Installed Driver Verification

`parsePostgresUrl()` in [`storage-config.ts`](../../apps/web/src/lib/storage/storage-config.ts) previously inspected only `parsed.protocol`, `parsed.hostname`, and `parsed.pathname`, leaving `parsed.port` and query parameters unchecked.

### Observed Behavior Against Installed `@prisma/client` (`6.4.0`)
Safe runtime probes against Neon `development` / localhost using `PrismaClient({ datasources: { db: { url } } })` confirmed:
1. **`?host=...` Overrides Target Endpoint:** Supplying `?host=127.0.0.1` on an otherwise approved pooled Neon URL caused Prisma 6.4.0's Quaint engine to attempt connection to `127.0.0.1:5432` instead of the URL authority hostname.
2. **Explicit Ports Override Default Port `5432`:** Supplying `:5433` attempted connection on port `5433`, whereas omitted port or `:5432` targeted the Neon endpoint cleanly.
3. **Duplicate Query Parameters Use Last-Wins Semantics:** `?sslmode=disable&sslmode=require` succeeded, whereas `?sslmode=require&sslmode=disable` disabled TLS and failed authentication against Neon.

Even though `@prisma/client` (`6.4.0`) ignored `port=`, `dbname=`, `user=`, `password=`, and `hostaddr=` query overrides during `$connect()`, Prisma CLI migrations, `libpq`, and PostgreSQL drivers honor those libpq connection parameters, so all routing, endpoint, identity, external-config, and TLS-downgrade parameters must be rejected uniformly.

---

## 2. Hardened PostgreSQL URL Validation Rules

Implemented [`parseStrictPostgresUrl`](../../apps/web/src/lib/database/postgres-url.ts) and wired it into:
- [`parsePostgresUrl`](../../apps/web/src/lib/storage/storage-config.ts) (runtime `getObjectStorageConfig()`)
- [`parseValidatedTargetUrl`](../../apps/web/src/test/assert-dev-db.ts) (integration guard `assertSafeDevDatabaseEnvironment()`)
- [`validateUrlHost`](../../apps/web/scripts/run-pg-integration.mjs) (integration CLI preflight script)

Enforced rules:
1. **Protocol & Fragment:** Only `postgresql:` or `postgres:`; URL fragments (`#...`) rejected.
2. **Hostname & Database:** Non-empty hostname without `,` or `%` encoding; single non-empty database path segment without nested `/` or `%`.
3. **Port Enforcement:** Only the default PostgreSQL port (omitted port or canonical `:5432`) is permitted. Explicit unapproved ports (`:5433`, `:6432`, `:54320`, `:443`, `:05432`, empty trailing `:`) are rejected.
4. **Routing / Identity / External-Config Query Parameters Rejected (case-insensitive & `%`-key obfuscation blocked):**
   - `host`, `hostaddr`, `port`, `dbname`, `database`, `user`, `username`, `password`, `service`, `passfile`, `options`, `replication`, `target_session_attrs`, `sslkey`, `sslcert`, `sslrootcert`, `sslcrl`, `sslcrldir`, `sslpassword`, `krbsrvname`, `gsslib`, `gssencmode`.
   - Semicolon delimiters (`;`) and malformed query segments (`?=...`, missing `=`, empty trailing `&`) are rejected.
5. **Duplicate Query Parameter Rejection:** Any repeated query parameter key (case-insensitive, such as `sslmode=require&sslmode=disable` or `sslmode=require&SSLMODE=require`) is rejected to eliminate last-wins ambiguity.
6. **Preserved Legitimate Neon / Prisma Parameters (Not Blindly Rejected):**
   - `sslmode`: permitted for `require`, `verify-ca`, `verify-full` (rejects `disable`, `allow`, `prefer`, or invalid values).
   - `channel_binding`: permitted for `require`, `prefer` (verified in `.env.local` on both `DATABASE_URL` and `DATABASE_URL_UNPOOLED`; rejects `disable`).
   - `sslaccept`: permitted only when `strict` (rejects `accept_invalid_certs`).
   - Non-routing operational parameters (such as `pgbouncer`, `connect_timeout`, `pool_timeout`, `connection_limit`, `statement_cache_size`, `schema`, `application_name`) remain permitted.
7. **Sanitised Error Messages:** Thrown errors report only variable name and structural reason (never usernames, passwords, query values, or raw connection URLs).

---

## 3. Regression Tests Added

Added explicit regression tests in [`storage-config.test.ts`](../../apps/web/src/lib/storage/storage-config.test.ts) and [`assert-dev-db.test.ts`](../../apps/web/src/test/assert-dev-db.test.ts) covering:
1. Approved pooled host with `?host=evil.example` and `?hostaddr=127.0.0.1`.
2. Approved direct host with `?host=evil.example` and `?hostaddr=192.0.2.1`.
3. Approved hosts with unapproved explicit ports (`:5433`, `:6432`, `:54320`, `:443`, `:05432`, `:`).
4. Approved hosts with query-string port overrides (`?port=5433`, `?port=5432`).
5. Approved hosts with database-name overrides (`?dbname=otherdb`, `?database=otherdb`).
6. Approved hosts with identity/external overrides (`?user=...`, `?password=...`, `?service=...`, `?passfile=...`) plus zero secret leakage assertions.
7. Duplicate or conflicting parameters (`sslmode=require&sslmode=disable`, `sslmode=disable&sslmode=require`, `sslmode=require&SSLMODE=require`, `pgbouncer=true&pgbouncer=false`), TLS downgrades (`sslmode=disable`, `channel_binding=disable`), semicolon smuggling (`sslmode=require;host=evil.example`), and `%68ost` obfuscation.
8. Valid approved URLs with `sslmode=require`, `channel_binding=require`, `pgbouncer=true`, `connect_timeout=10`, and canonical `:5432`.
9. Existing valid development configuration and storage env checks.
10. Existing wrong-host, swapped-host, wrong-database, production fail-closed, and missing-variable tests.

---

## 4. Verification Results

| Check | Command / Target | Result |
|---|---|---|
| TypeScript Check | `cmd /c "npm run type-check"` | **PASS** — `0` errors across `@crelune/web`, `@crelune/database`, `@crelune/shared`, `@crelune/ui`. |
| Unit & Route Tests | `cmd /c "npm test"` | **PASS** — `19` test files, `168` tests passed (`@crelune/web`: `14` files / `132` tests including `assert-dev-db.test.ts` `11` tests and `storage-config.test.ts` `8` tests; `@crelune/shared`: `4` files / `33` tests; `@crelune/ui`: `1` file / `3` tests), `0` failed, `0` skipped. |
| PG & Storage Integration | `cmd /c "npm run test:integration:db"` | **PASS** — `4` test files, `17` tests passed (`0` failed, `0` skipped) strictly against Neon `development` (`br-nameless-silence-bexjp44k`, `neondb`). |
| Workspace Production Build | `cmd /c "npm run build"` | **PASS** — Next.js `15.5.29` build + `tsc -b` across workspace packages. |
| Post-Test Cleanliness (`development`) | Prisma table count + `neon bucket object list` | **PASS** — `{"organisations":1,"users":1,"userPreferences":1,"authThrottles":0,"members":0,"birthdayPreparations":0,"birthdayReminders":0,"notifications":0,"auditLogs":0,"pendingStorageCleanups":0}`; `crelune-dev-member-photos` objects: `[]`. |
| Production Isolation Check | `neon bucket list` & `neon branches get production` | **PASS** — `production` (`br-withered-moon-be8coj8h`): `[]` buckets, `written_data_bytes: 0`. |
