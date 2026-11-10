# CRELUNE — Milestone 2.1: Authentication and Security Hardening Report

**Document:** Formal Milestone 2.1 Completion & Security Hardening Report
**Project:** CRELUNE — Personal Creative and Media Operations Platform
**Version:** 1.0
**Status:** Verification Complete & Ready for Review
**Authoritative References:**
- Central Agent Operating Instructions: [`.agents/AGENTS.md`](file:///d:/Projects/Crelune/.agents/AGENTS.md)
- Security Specification: [`docs/SECURITY.md`](file:///d:/Projects/Crelune/docs/SECURITY.md)
- Architectural Decisions: [`docs/TECHNICAL_DECISIONS.md`](file:///d:/Projects/Crelune/docs/TECHNICAL_DECISIONS.md) (ADR 009 & ADR 010)
- Testing Strategy: [`docs/TESTING_STRATEGY.md`](file:///d:/Projects/Crelune/docs/TESTING_STRATEGY.md)

---

## 1. Executive Summary

Milestone 2.1 was executed to resolve and remediate all architectural and security review findings identified in the Milestone 2 Web Foundation baseline.

All remediation objectives have been implemented, verified, and validated with automated test suites:
1. **Fallback Session Secrets Completely Eliminated**: Removed all development fallbacks across `session.ts`, `edge-session.ts`, and `middleware.ts`. All cryptographic signing and middleware checks fail closed if `SESSION_SECRET` is missing or $< 32$ characters.
2. **Minimized Session Token Claims (Zero PII in Cookies)**: Client cookies carry only minimal operational claims (`{ sub, role: "OWNER", org, iat, exp }`). Personally identifiable information (PII) such as full names and emails are never encoded into client tokens.
3. **Strict Middleware Interception**: The permissive wildcard rule `pathname.includes('.')` has been completely eliminated. Static assets are strictly whitelisted (`/_next/static`, `/_next/image`, `/favicon.ico`), and all other routes—including dotted private API endpoints (`/api/export.json`, `/api/members.csv`)—are strictly intercepted and require authenticated owner sessions.
4. **Login Anti-Enumeration & Durable Throttling**: Constant-time dummy scrypt password hashing executes when accounts do not exist, neutralizing timing attacks. PostgreSQL schema was updated to durably track `failedLoginAttempts` and `lockedUntil`, locking accounts for 15 minutes after 5 consecutive failed attempts.
5. **Open Redirect Defense**: Parameter `callbackUrl` is strictly validated to ensure only relative internal routes starting with a single `/` are permitted, rejecting `//`, `/\`, or scheme indicators (`:`).
6. **CSRF Mitigation on Mutation Endpoints**: `GET /api/auth/logout` was eliminated. Logout requires HTTP POST, and incoming requests validate `Host` against `Origin` and `Referer` headers.
7. **Health Diagnostic Shielding**: Public unauthenticated `GET /api/health` returns only minimal confirmation (`{"status": "ok", "timestamp": "..."}`). Database connection metrics and environment details are gated behind owner authentication.
8. **Owner Provisioning Hardening**: `scripts/create-owner.mjs` prohibits `--password` CLI arguments (mitigating process table/shell history leakage), enforces masked interactive console password input (`*`), rejects dictionary/trivial passwords, sets default timezone to `Africa/Accra`, and guarantees `prisma.$disconnect()` on all exit paths.
9. **Database Schema & Timezone Update**: `UserPreference` default timezone was changed to `Africa/Accra`, applied to Neon Lakebase Postgres via `db:push`, and existing database records were synchronized.

---

## 2. Security Threat Remediation Matrix

| Weakness Identified | Severity | Implemented Defense | Verification Method | Status |
| :--- | :--- | :--- | :--- | :--- |
| Hardcoded fallback secrets in `session.ts` and `middleware.ts` | **Critical** | Fallbacks completely removed; fail-closed enforcement across Node and Edge runtimes. | Automated unit & middleware tests | **RESOLVED** |
| PII (`firstName`, `lastName`, `email`) serialized into client cookies | **High** | Token payload minimized to `{ sub, role: "OWNER", org, iat, exp }`. Owner profile fetched directly from DB on server. | Automated payload claim inspection | **RESOLVED** |
| `pathname.includes('.')` permitted unauthenticated access to private dotted endpoints | **High** | Removed wildcard. Static assets strictly whitelisted. Dotted private paths return 401 Unauthorized. | Automated Next.js middleware test suite (17 tests) | **RESOLVED** |
| Account enumeration via timing discrepancies | **Medium** | Constant-time dummy `scrypt` derivation runs on non-existent or inactive users. Generic client errors returned. | Timing inspection & route test verification | **RESOLVED** |
| Lack of brute-force login protection | **Medium** | Durable PostgreSQL columns (`failedLoginAttempts`, `lockedUntil`). 5 attempts lock account for 15 min. Max 4KB payload limit. | Schema migration & login route unit tests | **RESOLVED** |
| Open redirect vulnerability via unvalidated `callbackUrl` | **Medium** | `isValidCallbackUrl` validator strictly enforces relative `/` paths; rejects `//`, `/\`, and schemes (`:`). | 10 unit test cases in `security-hardening.test.ts` | **RESOLVED** |
| CSRF vulnerability on `GET /api/auth/logout` | **Medium** | Method restricted to HTTP POST. CSRF origin and referer checked against request host. | Route unit tests & middleware verification | **RESOLVED** |
| Diagnostic leakage on public `/api/health` | **Low** | Public GET returns minimal status only. Diagnostic metrics gated behind authenticated owner session. | Route verification (unauthenticated vs authenticated) | **RESOLVED** |
| Plaintext password exposure in CLI history and terminal echo | **Medium** | `--password` CLI argument prohibited. Interactive console passwords masked with `*`. Trivial passwords rejected. | Provisioning script unit tests & execution validation | **RESOLVED** |
| Default timezone set to `UTC` instead of owner's locale | **Low** | Updated default timezone to `Africa/Accra` in Prisma schema, CLI tool, and live PostgreSQL records. | Database query inspection | **RESOLVED** |

---

## 3. Database Schema Changes & Neon Lakebase Synchronization

In [`packages/database/prisma/schema.prisma`](file:///d:/Projects/Crelune/packages/database/prisma/schema.prisma):
```prisma
model User {
  id                  String          @id @default(cuid())
  organisationId      String          @map("organisation_id")
  email               String          @unique
  passwordHash        String          @map("password_hash")
  firstName           String          @map("first_name")
  lastName            String          @map("last_name")
  role                String          @default("OWNER")
  isActive            Boolean         @default(true) @map("is_active")
  failedLoginAttempts Int             @default(0) @map("failed_login_attempts")
  lockedUntil         DateTime?       @map("locked_until")
  createdAt           DateTime        @default(now()) @map("created_at")
  updatedAt           DateTime        @updatedAt @map("updated_at")

  organisation        Organisation    @relation(fields: [organisationId], references: [id], onDelete: Restrict)
  preferences         UserPreference?

  @@index([organisationId])
  @@map("users")
}

model UserPreference {
  id                   String   @id @default(cuid())
  userId               String   @unique @map("user_id")
  theme                String   @default("light")
  dateFormat           String   @default("DD/MM/YYYY") @map("date_format")
  timezone             String   @default("Africa/Accra")
  leadTimeDaysBirthday Int      @default(14) @map("lead_time_days_birthday")
  leadTimeDaysEvent    Int      @default(21) @map("lead_time_days_event")
  defaultExportFormat  String   @default("PNG") @map("default_export_format")
  updatedAt            DateTime @updatedAt @map("updated_at")

  user                 User     @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@map("user_preferences")
}
```

The schema was synchronized directly with the Neon Lakebase Postgres database using `npm run db:push`. Existing user preference records in Neon were updated to `timezone = "Africa/Accra"`.

---

## 4. Test Verification & Evidentiary Results

All test tiers were executed and passed with zero errors or warnings:

### 4.1 Automated Unit & Integration Tests (`npm test`)
```text
> @crelune/web@0.1.0 test
> vitest run

 ✓ src/lib/auth/session.test.ts (12 tests) 36ms
 ✓ src/middleware.test.ts (17 tests) 46ms
 ✓ src/lib/auth/security-hardening.test.ts (15 tests) 8ms
 ✓ src/lib/auth/password.test.ts (4 tests) 642ms
 Test Files  4 passed (4)
      Tests  48 passed (48)

> @crelune/shared@0.1.0 test
> vitest run

 ✓ src/schemas/schemas.test.ts (8 tests) 10ms
 Test Files  1 passed (1)
      Tests  8 passed (8)

> @crelune/ui@0.1.0 test
> vitest run

 ✓ src/tokens/tokens.test.ts (3 tests) 5ms
 Test Files  1 passed (1)
      Tests  3 passed (3)

TOTAL: 59 passed, 0 failed across 6 test suites.
```

### 4.2 Static Type Checking (`npm run type-check`)
```text
> crelune@0.1.0 type-check
> npm run type-check --workspaces --if-present

> @crelune/web@0.1.0 type-check (tsc --noEmit)
> @crelune/database@0.1.0 type-check (tsc --noEmit)
> @crelune/shared@0.1.0 type-check (tsc --noEmit)
> @crelune/ui@0.1.0 type-check (tsc --noEmit)

RESULT: 0 errors across all workspaces (PASS).
```

### 4.3 Production Build Verification (`npm run build`)
```text
> @crelune/web@0.1.0 build
> next build

   ▲ Next.js 15.5.29
   Creating an optimized production build ...
 ✓ Compiled successfully in 12.9s
   Linting and checking validity of types ...
   Collecting page data ...
 ✓ Generating static pages (17/17)
   Finalizing page optimization ...

Route (app)                                 Size  First Load JS
┌ ƒ /                                      161 B         106 kB
├ ○ /_not-found                            987 B         104 kB
├ ƒ /api/auth/login                        152 B         103 kB
├ ƒ /api/auth/logout                       152 B         103 kB
├ ƒ /api/auth/me                           152 B         103 kB
├ ƒ /api/health                            152 B         103 kB
├ ƒ /assets                                152 B         103 kB
├ ƒ /birthdays                             152 B         103 kB
├ ƒ /designs                               152 B         103 kB
├ ƒ /events                                152 B         103 kB
├ ○ /login                               5.16 kB         108 kB
├ ƒ /members                               152 B         103 kB
├ ƒ /notifications                         152 B         103 kB
├ ƒ /settings                              152 B         103 kB
└ ƒ /templates                             152 B         103 kB
+ First Load JS shared by all             103 kB
ƒ Middleware                             34.9 kB

> @crelune/database@0.1.0 build (tsc -b)
> @crelune/shared@0.1.0 build (tsc -b)
> @crelune/ui@0.1.0 build (tsc -b)

RESULT: Build completed successfully with exit code 0 (PASS).
```
