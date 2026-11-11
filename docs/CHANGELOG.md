# CRELUNE — Changelog

All notable changes to the CRELUNE platform will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [0.3.5] - 2026-11-11

### Milestone 3, Stage 3.1: Member & Birthday Database Foundation and Civil Date Core

#### Database (`@crelune/database`)
- **Stage 3.1 Schema & Non-Destructive Preference Defaults**: Added `LeapDayPolicy`, `BirthdayPrepStatus`, `ReminderStatus`, and `NotificationType` enums alongside `Member`, `BirthdayPreparation`, `BirthdayReminder`, `Notification`, and `AuditLog` models in [`packages/database/prisma/schema.prisma`](file:///d:/Projects/Crelune/packages/database/prisma/schema.prisma). Derived active vs archived member status strictly from `archivedAt` (without adding `isActive`), modeled nullable birth fields with optional `birthYear`, stored date-only `@db.Date` reminder/celebration dates, enforced uniqueness per `(memberId, targetYear)` on `BirthdayPreparation` and `(memberId, targetYear, leadDays)` / `idempotencyKey` on `BirthdayReminder`, and added `birthdayReminderDays` (`[7, 3, 1, 0]`) and `leapDayPolicy` (`FEB_28`) on `UserPreference`. Synchronized exclusively to the Neon `development` branch (`br-nameless-silence-bexjp44k`, endpoint `ep-muddy-math-ben8e8p7`), leaving `production` untouched.

#### Domain Core & Test Safety (`@crelune/shared`, `@crelune/web`)
- **Civil Birthday Date Core**: Implemented pure date utilities in [`packages/shared/src/domain/birthday-date.ts`](file:///d:/Projects/Crelune/packages/shared/src/domain/birthday-date.ts) and member domain helpers in [`packages/shared/src/domain/member.ts`](file:///d:/Projects/Crelune/packages/shared/src/domain/member.ts) covering leap years (including `2100` century rule), unknown birth years, `FEB_28` / `MAR_1` leap-day policies, Dec-to-Jan rollovers, `[7, 3, 1, 0]` calendar reminder math, `Africa/Accra` civil-date extraction, and `archivedAt`-based active status (`29` total tests passing in `@crelune/shared`).
- **Exact Development Endpoint Test Guard**: Strengthened [`apps/web/src/test/assert-dev-db.ts`](file:///d:/Projects/Crelune/apps/web/src/test/assert-dev-db.ts) and [`apps/web/scripts/run-pg-integration.mjs`](file:///d:/Projects/Crelune/apps/web/scripts/run-pg-integration.mjs) to require exact development branch ID (`br-nameless-silence-bexjp44k`) and pooled/unpooled endpoint (`ep-muddy-math-ben8e8p7`) in addition to blocking production targets. Verified `8` PostgreSQL integration tests passing in [`member-birthday-schema.pg.integration.test.ts`](file:///d:/Projects/Crelune/apps/web/src/test/member-birthday-schema.pg.integration.test.ts) and `rate-limit.pg.integration.test.ts`.
- **Stage 3.1 Report & Architecture Record**: Documented verification evidence in [`MILESTONE_3_1_DATABASE_AND_BIRTHDAY_CORE.md`](file:///d:/Projects/Crelune/docs/milestones/MILESTONE_3_1_DATABASE_AND_BIRTHDAY_CORE.md) and recorded Product Owner architectural selection of Neon Object Storage in [`docs/TECHNICAL_DECISIONS.md`](file:///d:/Projects/Crelune/docs/TECHNICAL_DECISIONS.md).

---

## [0.3.4] - 2026-11-11

### Milestone 3 Preparation: Database Isolation, Test Environment Hardening & Implementation Plan

#### Database & Environments
- **Neon Development Branch Isolation**: Verified `production` (`br-withered-moon-be8coj8h`, endpoint `ep-mute-forest-bepsjmsu`) holds only owner provisioning data and zero member PII. Created dedicated `development` branch (`br-nameless-silence-bexjp44k`, endpoint `ep-muddy-math-ben8e8p7`) and switched local `.neon` and git-ignored `.env.local` to `development` while keeping `production` untouched.
- **Hardened PostgreSQL Integration Test Runner**: Replaced inline `dotenv/config` flags in [`apps/web/package.json`](file:///d:/Projects/Crelune/apps/web/package.json) with [`apps/web/scripts/run-pg-integration.mjs`](file:///d:/Projects/Crelune/apps/web/scripts/run-pg-integration.mjs) and [`apps/web/src/test/assert-dev-db.ts`](file:///d:/Projects/Crelune/apps/web/src/test/assert-dev-db.ts) (`assertSafeDevDatabaseEnvironment`). Integration tests now explicitly require `NEON_BRANCH=development` and reject production branch IDs, endpoints, and conflicting parent shell variables. Added [`assert-dev-db.test.ts`](file:///d:/Projects/Crelune/apps/web/src/test/assert-dev-db.test.ts) (`5` tests) and updated [`rate-limit.pg.integration.test.ts`](file:///d:/Projects/Crelune/apps/web/src/lib/auth/rate-limit.pg.integration.test.ts) `beforeAll` verification.

#### Planning & Documentation
- **Milestone 3 Implementation Plan**: Authored [`docs/milestones/MILESTONE_3_IMPLEMENTATION_PLAN.md`](file:///d:/Projects/Crelune/docs/milestones/MILESTONE_3_IMPLEMENTATION_PLAN.md) detailing database isolation evidence, test-env hardening, proposed Prisma schema & ERD (`members`, `member_photos`, `birthdays`, `reminder_rules`, `birthday_reminders`, `notification_deliveries`, `audit_events`), API & service contracts, UI/UX design aligned with `DESIGN_SYSTEM.md`, privacy/security controls, reminder generation/deduplication architecture, staged rollout (`3.1`–`3.6`), testing matrix, complexity estimates, and unresolved Product Owner decisions.
- **Testing Strategy Record**: Updated [`docs/TESTING_STRATEGY.md`](file:///d:/Projects/Crelune/docs/TESTING_STRATEGY.md) with Milestone 3 preparation database-isolation and test-guard evidence.

---

## [0.3.3] - 2026-11-11

### Milestone 2.1.2: Rate-Limit Client Identity & PostgreSQL Verification

#### Security & Reliability
- **Strict Client IP Resolution**: Eliminated shared synthetic placeholder IP identities (`direct-client`, `proxy-unknown`) in [`apps/web/src/lib/auth/rate-limit.ts`](file:///d:/Projects/Crelune/apps/web/src/lib/auth/rate-limit.ts). [`extractClientIp`](file:///d:/Projects/Crelune/apps/web/src/lib/auth/rate-limit.ts) now returns `null` when `TRUST_PROXY !== 'true'` or forwarding headers fail strict `node:net` `isIP` / RFC 5952 IPv6 canonicalization. When `TRUST_PROXY=true`, uses `X-Real-IP` or the rightmost hop of `X-Forwarded-For` written by the trusted ingress proxy.
- **Zero Global Unknown-IP Lockout**: When client IP is `null`, the shared `ip:` aggregate bucket is skipped completely (`ipBlocked = false`) so random probes cannot trigger global `429` lockouts, while account-specific protection remains active via `acct_noip:<hash>` (`5/15m`, bounded `15m` block returning indistinguishable `401`).
- **Bounded Throttle Record Cleanup**: Added `@@index([windowStart])` on [`AuthThrottle`](file:///d:/Projects/Crelune/packages/database/prisma/schema.prisma) (`db:push`) and implemented opportunistic bounded batch pruning (`pruneExpiredThrottles` / `maybePruneExpiredThrottles`, `LIMIT 250`, `10m` warm cooldown / `5%` cold sample) deleting only strictly expired records.
- **PostgreSQL Concurrency Verification & Test Expansion**: Added [`rate-limit.test.ts`](file:///d:/Projects/Crelune/apps/web/src/lib/auth/rate-limit.test.ts) (`11` tests), expanded `auth-routes.test.ts` (`19` tests), and added [`rate-limit.pg.integration.test.ts`](file:///d:/Projects/Crelune/apps/web/src/lib/auth/rate-limit.pg.integration.test.ts) (`5` real Neon PostgreSQL concurrency/lifecycle integration tests passing with automatic cleanup), documented in ADR 012 and `MILESTONE_2_1_2_RATE_LIMIT_VERIFICATION.md`.

---

## [0.3.2] - 2026-11-11

### Milestone 2.1.1: Final Authentication Security Corrections

#### Security & Reliability
- **Login CSRF Enforcement & Safe Proxy Configuration**: Applied Origin/Referer host validation (`validateRequestOrigin`) to `POST /api/auth/login` and removed the `NODE_ENV !== 'test'` bypass on `POST /api/auth/logout`. Added explicit `TRUST_PROXY=true` gating and optional `APP_URL` / `ALLOWED_ORIGINS` support in `.env.example` so spoofed forwarded host headers are ignored by default.
- **Anti-Lockout Durable PostgreSQL Rate Limiting**: Added `AuthThrottle` (`auth_throttles`) model in Prisma and implemented race-safe atomic `INSERT ... ON CONFLICT (bucket_key) DO UPDATE` throttling scoped by `(IP, normalized email)` (5 attempts / 15m -> indistinguishable `401 Invalid email or password`) and `IP` (20 attempts / 15m -> `429`), preventing remote attackers from locking out the legitimate owner while guaranteeing block expiry recovery without extending `blocked_until` on retries.
- **Fail-Closed `503` Middleware Handling**: Fixed `/login` infinite self-redirect loop when `SESSION_SECRET` is missing or `< 32` characters by returning static `503` HTML for pages and `503` JSON for non-health APIs (`Cache-Control: no-store`), preserving public `GET /api/health` liveness.
- **Edge Cryptographic Verification Parity**: Replaced custom string comparison in `verifySessionTokenEdge()` with Web Crypto `crypto.subtle.verify()` over raw HMAC-SHA256 bytes, strict base64url decoding, 32-byte signature length verification, and fatal UTF-8 decoding.
- **Real-Time Database Session Revocation**: Added `User.sessionVersion` (`ver` session claim) and server-side [`resolveAuthenticatedOwner`](file:///d:/Projects/Crelune/apps/web/src/lib/auth/owner-guard.ts) enforcing `isActive`, `role === 'OWNER'`, `organisationId`, and `sessionVersion` across dashboard SSR pages, `/api/auth/me`, and `/api/health`, rendering [`SessionRevokedNotice`](file:///d:/Projects/Crelune/apps/web/src/components/auth/SessionRevokedNotice.tsx) to avoid Edge/SSR redirect loops.
- **Consistent Session Lifetime Validation**: Centralized `SESSION_TTL_SECONDS = 604800` and shared [`validateSessionPayload`](file:///d:/Projects/Crelune/packages/shared/src/schemas/auth.ts) enforcing `exp > iat`, `exp - iat <= SESSION_TTL_SECONDS`, `exp > now`, and `iat <= now + 60` across Node and Edge runtimes.
- **Test & Documentation Updates**: Expanded automated test coverage to 95 passing tests across 7 files, synchronized Prisma schema to Neon (`db:push`), verified live HTTP `next start` behavior, and documented ADR 011 plus `MILESTONE_2_1_1_FINAL_SECURITY_CORRECTIONS.md`.

---

## [0.3.1] - 2026-11-10

### Milestone 2.1: Authentication and Security Hardening

#### Security & Hardening
- **Zero Fallback Secrets**: Removed all hardcoded development secret fallbacks across `session.ts`, `edge-session.ts`, and `middleware.ts`. `SESSION_SECRET` ($\ge 32$ chars) is now strictly required in all environments, failing closed if missing.
- **Minimized Session Claims (Zero PII in Cookies)**: Updated session token payload to minimal operational claims (`{ sub, role: "OWNER", org, iat, exp }`), completely eliminating full name, email, and PII from client cookies. Added strict Zod schema validation (`sessionTokenPayloadSchema`) enforcing role literal `'OWNER'`, positive integer timestamps, and clock skew validation.
- **Strict Middleware Interception**: Removed permissive `pathname.includes('.')` bypass. Enforced strict whitelist for Next.js internal static assets (`/_next/static`, `/_next/image`, `/favicon.ico`) and exact public routes with method checking (`/login`, `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/health`). All other routes, including dotted private API endpoints (`/api/export.json`, `/api/members.csv`), now require authenticated owner sessions and return `401 Unauthorized` when unauthenticated.
- **Login Anti-Enumeration & Durable Throttling**: Added constant-time dummy scrypt password verification for non-existent users. Added `failedLoginAttempts` and `lockedUntil` columns to `User` in PostgreSQL, locking accounts for 15 minutes after 5 consecutive failures. Capped login payloads at 4KB.
- **Open Redirect Protection**: Implemented `isValidCallbackUrl` in `@crelune/shared` to ensure `callbackUrl` only allows internal relative paths starting with a single `/`, rejecting protocol-relative (`//`), backslash (`/\`), and scheme-prefixed URLs (`https:`, `javascript:`).
- **CSRF Mitigation on Logout**: Removed insecure `GET /api/auth/logout`. Enforced HTTP POST method and validated `Host` against `Origin`/`Referer` headers.
- **Health Diagnostic Shielding**: Public unauthenticated `GET /api/health` now returns minimal status (`{"status": "ok", "timestamp": "..."}`). Database connection details, latency, and runtime telemetry are gated behind owner authentication.
- **Owner Provisioning Hardening**: Updated `scripts/create-owner.mjs` to prohibit `--password` CLI arguments (preventing process table and shell history leakage), enforce masked interactive password input (`*`), reject common/trivial passwords, set default timezone to `Africa/Accra`, and guarantee connection teardown on all exit paths.
- **Database Schema & Timezone Update**: Updated `UserPreference` default timezone from `UTC` to `Africa/Accra` in Prisma schema, synchronized with Neon Lakebase Postgres via `db:push`, and updated existing database records.
- **Test Coverage Expansion**: Added 42 automated tests across `session.test.ts`, `middleware.test.ts`, `security-hardening.test.ts`, and `schemas.test.ts`, bringing total passing tests to 59 with zero failures.

---

## [0.3.0] - 2026-11-10

### Milestone 2: Web Foundation Completed

#### Added
- **Web Application (`apps/web`)**: Implemented Next.js 15 App Router web application with TypeScript, React 19, and Tailwind CSS.
- **Responsive Application Shell**: Developed desktop sidebar (`Sidebar.tsx`) and mobile slide-over navigation (`MobileNav.tsx`) accommodating all 9 primary operations modules.
- **Owner-Only Authentication**: Implemented secure scrypt password derivation, HMAC-SHA256 session token generation, HTTP-only cookie serialization, and server-side route protection in `middleware.ts`.
- **Local Owner Provisioning CLI**: Authored `scripts/create-owner.mjs` (`npm run owner:create`) for secure local administration with zero public registration exposure.
- **Database Layer (`@crelune/database`)**: Initialized Prisma ORM models (`Organisation`, `User`, `UserPreference`) synchronized to Neon Lakebase Postgres using direct/pooled dual-URL architecture.
- **Shared UI & Design Tokens (`@crelune/ui`)**: Implemented approved brand palette (`#6541A5`, `#A99AD1`, `#F8F7FA`, `#24212B`), typography, radii, and accessible components (`Button`, `Input`, `Card`, `Badge`, `EmptyState`, `Header`).
- **Shared Validation & Schemas (`@crelune/shared`)**: Authored Zod validation schemas for login and environment configuration.
- **Automated Test Suites**: Added 17 unit tests across `@crelune/shared`, `@crelune/ui`, and `@crelune/web` covering schemas, tokens, password hashing, and session tampering.
- **Architectural Decision Record (ADR 009)**: Documented web application architecture, single-owner auth design, and session management in [`docs/TECHNICAL_DECISIONS.md`](./TECHNICAL_DECISIONS.md).

---

## [0.2.1] - 2026-11-10

### Milestone 1.1: Affinity Integration Evidence Correction

#### Changed
- **Eliminated Simulation**: Removed synthetic 45-byte output file creation from `poc_harness.ps1`.
- **Empirical MCP Connectivity Probe**: Updated validation harness to probe live TCP port 33001 and report connection failure honestly (`NOT LISTENING` / `NOT_VERIFIED_INACTIVE_MCP`).
- **Empirical Boundary Correction**: Updated [`docs/milestones/MILESTONE_1_AFFINITY_VALIDATION.md`](./milestones/MILESTONE_1_AFFINITY_VALIDATION.md) and [`docs/TECHNICAL_DECISIONS.md`](./TECHNICAL_DECISIONS.md) (ADR 008) to classify automation capabilities with strict evidentiary rigor (`VERIFIED`, `DOCUMENTED`, `PARTIALLY SUPPORTED`, `NOT VERIFIED`, `NOT SUPPORTED`).
- **Contingent Architecture**: Classified Windows Creative Agent IPC bridge as contingent on Canva MCP activation, establishing fallback evaluation (Script Library staging vs GUI automation) for Milestone 5.
- **Template Immutability Integrity**: Re-verified pre- and post-execution SHA-256 byte-for-byte invariance on master templates (`STRICT PASS`).

---

## [0.2.0] - 2026-11-10

### Milestone 1: Affinity 3.3 Technical Validation

#### Added
- **Affinity 3.3 Validation Report**: Authored comprehensive technical report [`docs/milestones/MILESTONE_1_AFFINITY_VALIDATION.md`](./milestones/MILESTONE_1_AFFINITY_VALIDATION.md) documenting empirical findings on Windows 11.
- **Canva JSLib DOM Specification**: Mapped official JavaScript DOM APIs (`document.js`, `nodes.js`) for text replacement, layer traversal, and file export.
- **Architectural Decision Record (ADR 008)**: Recorded initial Windows Creative Agent IPC protocol, App Execution Alias invocation, and Template Immutability Protocol in [`docs/TECHNICAL_DECISIONS.md`](./TECHNICAL_DECISIONS.md).
- **Milestone 1 Proof of Concept Harness**: Implemented safe validation harness in [`docs/milestones/milestone-1-poc/`](./milestones/milestone-1-poc/) testing environment, execution alias, and template immutability.

---

## [0.1.0] - 2026-11-10

### Milestone 0: Product Foundation Initialized

#### Added
- **Central Agent Operating Rules**: Established [`.agents/AGENTS.md`](../.agents/AGENTS.md) defining mandatory engineering standards, decision authority, single-owner scope, and non-destructive protocols.
- **Specialized AI Skill System**: Authored and validated 9 specialized Google Antigravity Agent Skills in [`.agents/skills/`](../.agents/skills/):
  - `crelune-product-architect`: Milestone progression and cross-platform boundaries.
  - `crelune-ui-ux`: Visual identity, anti-clutter enforcement, and design tokens (`#6541A5`, `#A99AD1`).
  - `crelune-frontend`: Next.js App Router and desktop workspace engineering.
  - `crelune-backend`: API design, service layers, and agent job queues.
  - `crelune-database`: PostgreSQL schema, Prisma migrations, and data protection.
  - `crelune-mobile`: Native React Native & Expo companion (strictly zero WebViews).
  - `crelune-affinity-integration`: Windows Creative Agent and Affinity 3.3 scripting automation.
  - `crelune-security`: Authentication, PII & member photo privacy, and defense-in-depth.
  - `crelune-qa`: Testing pyramid, workflow verification, and regression prevention.
- **Authoritative Specifications**:
  - [`docs/PRODUCT_MASTER_SPECIFICATION.md`](./PRODUCT_MASTER_SPECIFICATION.md): Canonical product specification.
  - [`docs/ARCHITECTURE.md`](./ARCHITECTURE.md): Cross-platform technical architecture and subsystem boundaries.
  - [`docs/DATABASE_DESIGN.md`](./DATABASE_DESIGN.md): Relational schema, Prisma models, indexing, and migration rules.
  - [`docs/DESIGN_SYSTEM.md`](./DESIGN_SYSTEM.md): Visual design tokens, anti-clutter rules, and layout ergonomics.
  - [`docs/SECURITY.md`](./SECURITY.md): Threat modeling, authentication, PII photo protection, and input safety.
  - [`docs/DEVELOPMENT_ROADMAP.md`](./DEVELOPMENT_ROADMAP.md): Milestone 0 through Milestone 9 roadmap and deliverables.
  - [`docs/TECHNICAL_DECISIONS.md`](./TECHNICAL_DECISIONS.md): Architectural Decision Records (ADRs 001–007).
  - [`docs/TESTING_STRATEGY.md`](./TESTING_STRATEGY.md): Testing tiers, verification protocols, and acceptance criteria.
- **Repository Safety & Configuration**:
  - Initialized Git repository on `main` branch connected to GitHub remote (`https://github.com/FOLISOLOMON/crelune.git`).
  - Created comprehensive [`.gitignore`](../.gitignore) strictly excluding all `.env*` files, `.neon`, credentials, build artifacts, and Affinity temp files.
  - Created sanitized [`.env.example`](../.env.example) documenting required environment variables.
  - Initialized npm workspaces monorepo structure with `@crelune/shared` and `@crelune/ui`.
  - Linked and configured Neon Lakebase Postgres database (`DATABASE_URL`, `DATABASE_URL_UNPOOLED`).
