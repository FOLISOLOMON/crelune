# CRELUNE — Architectural Decision Records (ADR)

**Document:** Formal Technical Decisions, Trade-Off Analyses, and Unresolved Decisions  
**Project:** CRELUNE  
**Version:** 1.0  
**Status:** Approved for Milestone 0 Foundation  
**Primary Reference:** [`docs/PRODUCT_MASTER_SPECIFICATION.md`](file:///d:/Projects/Crelune/docs/PRODUCT_MASTER_SPECIFICATION.md)

---

## 1. Approved Technical Decisions

### ADR 001: Monorepo Workspace Structure with npm Workspaces
- **Status**: Approved.
- **Context**: CRELUNE comprises three interconnected clients (Web, Mobile, Windows Creative Agent) and shared backend models, types, and design tokens.
- **Decision**: Adopt native npm workspaces (`apps/*`, `packages/*`). Maintain `@crelune/shared`, `@crelune/ui`, and `@crelune/database` as internal packages.
- **Alternatives Evaluated**: Turborepo, Nx, separate Git repositories.
- **Rationale**: Built-in npm workspaces eliminate complex external build orchestrators during initial milestones while enforcing strict package boundaries and direct code sharing.
- **Consequences**: Fast local linking, single `npm install`, zero external CLI dependencies for monorepo management.

---

### ADR 002: Three-Tier Client Architecture & Windows Creative Agent Boundary
- **Status**: Approved.
- **Context**: The founder needs web management, mobile companion capabilities, and desktop Affinity automation. Browser security models strictly prevent web pages from interacting directly with local desktop applications or filesystems.
- **Decision**: Decouple the ecosystem into CRELUNE Web (Next.js), CRELUNE Mobile (React Native/Expo), and a standalone CRELUNE Windows Creative Agent (Node.js/TypeScript daemon) communicating through a shared backend API.
- **Alternatives Evaluated**: Electron all-in-one desktop app; browser extension with local web sockets; browser-only web app.
- **Rationale**: An Electron app creates high memory overhead and fails to solve mobile needs. Browser extensions are fragile. A dedicated background agent cleanly bridges the local Windows 11 Affinity environment without compromising web security.
- **Consequences**: Web and Mobile clients remain lightweight and portable; local desktop automation is isolated, auditable, and restricted.

---

### ADR 003: Single-Owner Initial Scope with Extensible Relational Model
- **Status**: Approved.
- **Context**: The founder is the initial sole user. However, future expansion may include church media team members and multi-organisation capabilities.
- **Decision**: Build for a single owner first. Do not implement public registration, user invitations, or team permissions in early milestones. However, include `organisationId` foreign keys on core database tables.
- **Alternatives Evaluated**: Full multi-tenant SaaS architecture with granular RBAC; completely single-user schema with no organisation entity.
- **Rationale**: Building multi-tenancy prematurely introduces immense complexity (invitations, email verification, team roles) before core creative workflows are validated. Adding an `organisationId` column now ensures future tenancy without costly schema rewrites later.
- **Consequences**: Rapid milestone progression focused 100% on the founder's daily creative operations.

---

### ADR 004: Affinity 3.3 Non-Destructive Working Copy Strategy
- **Status**: Approved.
- **Context**: Automating flyer generation must not risk corrupting or overwriting master creative templates (`.afdesign`, `.aftemplate`, `.psd`).
- **Decision**: All automated operations must execute on a byte-for-byte working copy created in a sandboxed job workspace (`workspaces/jobs/{jobId}/`). Original templates are marked read-only on disk.
- **Alternatives Evaluated**: In-place modification with undo history; saving modified layers back to the master file.
- **Rationale**: Creative files represent significant creative labor. A crash or script error during an in-place save would destroy the original template. Disposable working copies guarantee complete safety.
- **Consequences**: Master templates remain immutable; failed jobs can simply discard their working copies without side effects.

---

### ADR 005: Neon Lakebase Postgres with Dual-URL Strategy
- **Status**: Approved.
- **Context**: The application uses Prisma ORM and runs serverless web APIs alongside database schema migrations. Connection pooling is required for high concurrency, but pooling interferes with migration locks.
- **Decision**: Deploy on Neon Lakebase Postgres using two connection strings:
  1. `DATABASE_URL`: Pooled connection string (`-pooler`) for web API queries.
  2. `DATABASE_URL_UNPOOLED`: Direct connection string for Prisma migrations (`directUrl`).
- **Alternatives Evaluated**: Self-hosted local Docker Postgres; single unpooled connection for everything.
- **Rationale**: Neon provides serverless autoscaling, instant branching for testing migrations, and built-in connection pooling. The dual-URL configuration is Prisma's official recommended architecture for Postgres poolers.
- **Consequences**: Reliable serverless scaling with zero migration locking errors.

---

### ADR 006: Genuinely Native Mobile Companion (Zero WebViews)
- **Status**: Approved.
- **Context**: Mobile access is required for rapid member capture, camera uploads, and notification alerts.
- **Decision**: Build CRELUNE Mobile using React Native and Expo SDK with exclusively native UI components. Strictly prohibit embedding web views or URL shells.
- **Alternatives Evaluated**: PWA (Progressive Web App); WebView wrapper (Capacitor/Cordova).
- **Rationale**: WebViews provide poor camera UX, unreliable background notifications, and slow, laggy list scrolling. A native React Native app provides instant 60 FPS scrolling, native haptics, and native camera integration.
- **Consequences**: Superior user experience for quick 30-second mobile member registrations.

---

### ADR 007: Private Storage with Short-Lived Pre-Signed URLs
- **Status**: Approved.
- **Context**: Church members' photographs and personal details must be protected against public scraping and unauthorized exposure.
- **Decision**: All member media and template assets must reside in private-by-default cloud storage buckets. Access is granted solely via temporary pre-signed URLs with a 15-minute maximum TTL.
- **Alternatives Evaluated**: Public S3 bucket with obscured filenames; proxying all image bytes through the Node API server.
- **Rationale**: Obscured public URLs can still be shared or indexed. Proxying full-resolution images through the web server consumes excessive server bandwidth and RAM. Pre-signed URLs provide airtight security with direct cloud download speed.
- **Consequences**: Complete privacy compliance with zero server bandwidth bottleneck.

---

### ADR 008: Windows Creative Agent Inter-Process Communication & Affinity 3.3 Integration
- **Status**: Partially Resolved / Contingent Architecture (Empirically Corrected in Milestone 1.1).
- **Context**: The Windows Creative Agent requires a secure, supported, non-destructive IPC mechanism to orchestrate Affinity 3.3 on Windows 11. Empirical testing on installed Affinity 3.3.1.4940 confirmed that while `libmcp.dll` is loaded in process memory, TCP port 33001 does not open a listening socket in standard operation, and CLI script parameters are not executed.
- **Decision**:
  1. **Template Immutability Protocol (`VERIFIED`)**: Enforce strict read-only master templates; operations execute exclusively on ephemeral working copies in `workspaces/jobs/{jobId}/`, verified by pre- and post-execution SHA-256 checksum comparison.
  2. **Application Lifecycle (`VERIFIED`)**: Use the sanctioned Windows App Execution Alias (`%LOCALAPPDATA%\Microsoft\WindowsApps\Affinity.exe`) for process lifecycle management and document activation, complying with MSIX package boundaries.
  3. **IPC Dispatch Bridge (`CONTINGENT`)**: Architect the Windows Creative Agent to target Affinity's native MCP Server (`http://localhost:33001/sse`) as primary protocol, while mandating a fallback integration path (e.g. Script Library file staging or GUI automation bridge) in Milestone 5 if Canva retains port 33001 as dormant in public releases.
  4. **PSD Import Configuration (`DOCUMENTED`)**: Configure `ApplicationSettings.loadPSDWithEditableText = true` for Photoshop template imports to preserve live text typography.
- **Alternatives Evaluated**: Standalone headless CLI (confirmed absent in Affinity 3.3.1); direct binary injection (unsafe, rejected for security and stability).
- **Rationale**: Reflects empirical ground truth. Protects master templates through verified immutability checks and process lifecycle management while transparently acknowledging that external headless execution via MCP cannot be verified until Canva activates the listener.
- **Consequences**: Template integrity is checked using pre- and post-execution SHA-256 comparisons. Filesystem permissions and isolated working copies provide additional protection. Creative Agent IPC is decoupled from unverified assumptions and will implement a validated fallback in Milestone 5 if port 33001 remains dormant.

---

### ADR 009: Web Application Architecture, Owner Authentication & Session Management
- **Status**: Approved (Implemented in Milestone 2).
- **Context**: The Web Foundation milestone requires establishing the central management application and a secure owner authentication layer. The system must strictly enforce the single-owner scope with zero public registration while avoiding unnecessary paid auth services.
- **Decision**:
  1. Build CRELUNE Web (`apps/web`) using **Next.js 15 App Router**, React, strict TypeScript, and Tailwind CSS configured with CRELUNE brand design tokens.
  2. Implement **owner-only authentication** using Node's native `crypto.scrypt` (16-byte random salt, 64-byte key) and constant-time verification.
  3. Store sessions in tamper-evident tokens signed via **HMAC-SHA256** backed by `SESSION_SECRET` ($\ge 32$ chars) in HTTP-only cookies (`crelune_session`) with `SameSite=Lax` and `Secure` attributes.
  4. Enforce **server-side route protection** via Next.js `middleware.ts` using Web Crypto API universal verification, redirecting unauthenticated traffic to `/login` and protecting private API endpoints.
  5. Provision the owner account strictly via local terminal CLI (`scripts/create-owner.mjs`). Public self-registration endpoints are completely omitted.
- **Alternatives Evaluated**: Third-party hosted auth (Clerk/Auth0 — rejected to prevent recurring cost and external dependency for a single-owner app); NextAuth/Auth.js (heavy abstraction with frequent breaking changes); basic auth (inadequate UX).
- **Rationale**: Standard cryptographic primitives eliminate external subscriptions, preserve full data ownership, guarantee portable PostgreSQL persistence, and enforce single-owner security boundaries.
- **Consequences**: Complete control over owner authentication, zero third-party auth outages, fast local build times, and clean architectural separation between auth, domain logic, and UI.

### ADR 010: Web Authentication Hardening, Zero-PII Tokens, and Anti-Enumeration Protections
- **Status**: Approved (Implemented in Milestone 2.1).
- **Context**: Code review of Milestone 2 identified areas for hardening: development fallback secrets, PII stored inside session cookies, permissive middleware wildcard bypass rules (`pathname.includes('.')`), lack of durable login attempt throttling, and sensitive CLI argument exposure in owner provisioning.
- **Decision**:
  1. **Eliminate All Fallback Secrets**: Require `SESSION_SECRET` ($\ge 32$ chars) across all environments. If missing or invalid, all session verification and middleware execution fails closed.
  2. **Zero-PII Signed Tokens**: Session cookies contain only minimal operational claims (`{ sub, role: "OWNER", org, iat, exp }`). Full name, email, and PII are never encoded into client cookies. Server components query user details directly via Prisma using `session.sub`.
  3. **Strict Route Protection**: Remove `pathname.includes('.')` bypass. Restrict whitelists strictly to Next.js internal static assets (`/_next/static`, `/_next/image`, `/favicon.ico`) and exact public routes (`/login`, `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/health`). Intercept all dotted private endpoints (`/api/export.json`, `/api/members.csv`) with `401 Unauthorized`.
  4. **Anti-Enumeration & Throttling**: Execute constant-time dummy `scrypt` hashing for unknown users to neutralize response timing enumeration. Durably throttle failed attempts in PostgreSQL (`failedLoginAttempts`, `lockedUntil`), locking accounts for 15 minutes after 5 consecutive failures. Cap request payloads at 4KB.
  5. **Open Redirect & CSRF Defenses**: Strictly validate `callbackUrl` against internal relative path rules (rejecting `//`, `/\`, or scheme indicators `:`). Enforce HTTP POST on `/api/auth/logout` and validate `Host` against `Origin`/`Referer` headers.
  6. **Health Endpoint Shielding**: Return minimal status only on public GET requests (`{"status": "ok", "timestamp": "..."}`), gating database and environment diagnostics behind authenticated owner sessions.
  7. **CLI Provisioning Hardening**: Disallow `--password` CLI arguments to prevent leaking into shell history and process tables (`ps`). Enforce masked interactive console input (`*`), reject common/trivial passwords, set default timezone to `Africa/Accra`, and guarantee connection teardown.
- **Consequences**: Production-grade threat defense against enumeration, session tampering, credential leakage, open redirection, and CSRF without introducing third-party services. *Note*: Login CSRF protection, `(IP, account)` throttle isolation, Web Crypto constant-time Edge verification, `503` fail-closed middleware handling, and DB-backed `sessionVersion`/`isActive` revocation were subsequently refined in ADR 011 (Milestone 2.1.1).

### ADR 011: Final Web Authentication Hardening — Anti-Lockout PostgreSQL Throttling, Edge `SubtleCrypto` Parity, and Server-Side Session Revocation
- **Status**: Approved (Implemented in Milestone 2.1.1).
- **Context**: Review of Milestone 2.1 identified six remaining security gaps: missing Origin/Referer CSRF validation on `POST /api/auth/login`, global email-only lockout (`User.lockedUntil`) allowing remote attacker DoS against the sole owner, `/login` infinite self-redirect loop when `SESSION_SECRET` is invalid/missing, string comparison instead of Web Crypto `verify()` in Edge session verification, absence of server-side `isActive` / `sessionVersion` revocation checks on signed cookies, and missing `exp - iat <= TTL` validation.
- **Decision**:
  1. **CSRF on Auth Mutations**: Apply [`validateRequestOrigin`](file:///d:/Projects/Crelune/apps/web/src/lib/auth/csrf.ts) to both `POST /api/auth/login` and `POST /api/auth/logout`, ignoring `x-forwarded-host`/`x-forwarded-proto` unless `TRUST_PROXY=true` and honoring optional `APP_URL`/`ALLOWED_ORIGINS`.
  2. **Race-Safe Scoped Throttling**: Introduce `AuthThrottle` (`auth_throttles`) table with SHA-256-hashed bucket keys (`ip:<hash>`, `ip_acct:<hash>`), updated atomically via `INSERT ... ON CONFLICT (bucket_key) DO UPDATE`. Enforce 5 failures / 15m per `(IP, email)` returning indistinguishable `401 Invalid email or password`, and 20 failures / 15m per IP returning `429`. Expired windows/blocks reset automatically without extending `blocked_until` on retries.
  3. **Fail-Closed `503` Middleware Responses**: When `SESSION_SECRET` fails validation (`< 32` chars or missing), return static `503` HTML (`Cache-Control: no-store`) for pages (including `/login`) and `503` JSON for non-health APIs, while preserving `GET /api/health` liveness (`{ status: "ok", timestamp }`).
  4. **Universal Edge Verification & Shared Lifetime Bounds**: Use Web Crypto `crypto.subtle.verify()` on raw HMAC-SHA256 bytes in Edge middleware and share `validateSessionPayload()` enforcing `exp > iat`, `exp - iat <= 604800`, `exp > now`, and `iat <= now + 60`.
  5. **Real-Time DB Revocation**: Add `User.sessionVersion` (`ver` JWT-style claim) and enforce `isActive`, `role === 'OWNER'`, `organisationId`, and `sessionVersion` in PostgreSQL via [`resolveAuthenticatedOwner`](file:///d:/Projects/Crelune/apps/web/src/lib/auth/owner-guard.ts). Render [`SessionRevokedNotice`](file:///d:/Projects/Crelune/apps/web/src/components/auth/SessionRevokedNotice.tsx) in dashboard SSR when revoked to avoid redirect loops with stateless Edge middleware.
- **Trade-offs & Operational Impact**:
  - *Anti-Lockout vs. Distributed Botnets*: Scoping lockouts to `(IP, email)` + `IP` prevents single/few-IP attackers from locking out the owner remotely without adding paid Redis/Upstash infrastructure; heavily distributed credential-stuffing relies on scrypt cost and high-entropy owner credentials, and can be supplemented with WAF/Edge rules later if deployed publicly.
  - *DB Lookup Latency*: Enforcing active owner & `sessionVersion` executes one indexed primary-key lookup (`users.id` with `organisation` and `preferences`) per protected SSR/API request (~1–5ms on warm Neon pool; cold Neon resume after scale-to-zero incurs standard wake latency).
  - *Recovery*: Stale/compromised sessions are immediately invalidated by incrementing `users.session_version` or setting `users.is_active = false`; throttle blocks recover automatically after 15 minutes (or immediately upon `DELETE FROM auth_throttles` / valid owner login clearing `(IP, account)`).

### ADR 012: Client IP Identity Resolution, Unknown-IP Fallback, and `auth_throttles` Record Lifecycle
- **Status**: Approved (Implemented in Milestone 2.1.2).
- **Context**: Review of Milestone 2.1.1 identified that `extractClientIp()` fell back to a shared synthetic identifier (`'direct-client'` / `'proxy-unknown'`), causing requests without trusted proxy headers to collide in a single shared `ip:` aggregate bucket (enabling shared IP lockout denial of service). In addition, regex-only IP checks accepted malformed values, PostgreSQL throttle atomicity had only been tested with mocks, and `auth_throttles` lacked expired-row cleanup.
- **Decision**:
  1. **Null Unknown IP (`string | null`)**: [`extractClientIp`](file:///d:/Projects/Crelune/apps/web/src/lib/auth/rate-limit.ts) returns `null` when `TRUST_PROXY !== 'true'` or forwarding headers fail strict `node:net` `isIP` / RFC 5952 IPv6 validation ([`parseValidIp`](file:///d:/Projects/Crelune/apps/web/src/lib/auth/rate-limit.ts)).
  2. **Trusted Proxy Contract**: When `TRUST_PROXY=true`, reads single-valued `X-Real-IP` first or the rightmost hop of `X-Forwarded-For` written by the trusted ingress proxy.
  3. **Scoped Fallback**: When `ip === null`, skip the `ip:` aggregate bucket completely and track only the account-scoped `acct_noip:<hash>` bucket (`5/15m`, bounded `15m` block, indistinguishable `401`).
  4. **Opportunistic Bounded Pruning**: Add `@@index([windowStart])` on `AuthThrottle` and run [`maybePruneExpiredThrottles`](file:///d:/Projects/Crelune/apps/web/src/lib/auth/rate-limit.ts) (cooldown `10m` / cold sample `5%`, `LIMIT 250` per batch) deleting only expired blocks/windows.
- **Consequences**: Unknown-IP visitors can never exhaust a shared IP bucket against the owner, account protection remains active in direct/local deployments, random login probes cannot grow `auth_throttles` without bound, and PostgreSQL atomic upsert semantics are directly verified via [`rate-limit.pg.integration.test.ts`](file:///d:/Projects/Crelune/apps/web/src/lib/auth/rate-limit.pg.integration.test.ts).

### ADR 013: Birthday Reminder Schedule Reconciliation, Transactional Processing, and `CRON_SECRET` Execution
- **Status**: Accepted & Implemented (Stage 3.4)
- **Context**: Birthday schedules must remain idempotent across concurrent on-demand web syncs and scheduled runs, respect owner IANA timezones and leap-day policies without silent fallback on corrupted configuration, preserve `SENT` notification history across birthday/preference/archive changes, guarantee zero duplicate notifications, and expose a scheduled trigger endpoint before a cloud scheduler provider is chosen.
- **Decisions**:
  1. **Two-Year Civil Schedule Window & Advisory Lock Serialization**: [`reconcileOrganisationBirthdaySchedules`](file:///d:/Projects/Crelune/apps/web/src/lib/birthdays/birthday-schedule-service.ts) acquires a transaction-scoped `pg_advisory_xact_lock` keyed by `bday_sync:<organisationId>` and materializes/updates schedules across `[today.year, today.year + 1]` in the owner's validated IANA timezone (covering Dec → Jan lead-day overlap), without altering historical `SENT` rows.
  2. **Transactional Notification Persistence Before `SENT`**: [`processDueBirthdayReminders`](file:///d:/Projects/Crelune/apps/web/src/lib/birthdays/birthday-processor-service.ts) acquires `FOR UPDATE` row locks inside PostgreSQL transactions, reconfirms active member state, birthday data, current preference parity, and celebration cutoff (`scheduledForDate <= today <= celebrationDate`), creates the `Notification` row BEFORE marking the `BirthdayReminder` row `SENT`, marks past-birthday reminders `SKIPPED`, and caps retries at `MAX_REMINDER_ATTEMPTS = 3` with sanitized `lastError` labels and `BIRTHDAY_REMINDER_FAILED` audit entries.
  3. **Strict IANA & Lead-Day Validation**: [`validateAndNormalizeOwnerPreferences`](file:///d:/Projects/Crelune/apps/web/src/lib/birthdays/birthday-preferences.ts) applies defaults only when `UserPreference` is absent (`null`) and throws `InvalidBirthdayPreferencesError` on invalid configured timezones or intervals rather than falling back silently.
  4. **Timing-Safe `CRON_SECRET` Fail-Closed Endpoint**: `POST /api/cron/birthday-reminders` passes middleware route matching only for exact path/method and is guarded by [`verifyCronBearerRequest`](file:///d:/Projects/Crelune/apps/web/src/lib/auth/cron-auth.ts) (`503` when `CRON_SECRET` is unset/placeholder, `401` on URL query-string secrets or timing-safe SHA-256 Bearer mismatch) while returning aggregate non-PII counters only. Hosting scheduler provider provisioning remains deferred.
- **Consequences**: Duplicate schedules and duplicate in-app notifications are prevented by PostgreSQL locks, unique constraints, and transactional ordering; delayed reminders still deliver up to the celebration day; owner notifications stay strictly privacy-safe and organisation/user isolated.

### ADR 014: Authoritative Milestone 4 Design Job Pipeline & Non-Inferred Publication
- **Status**: Accepted & Implemented (Stage 3.6 + Milestone 4 Bundle)
- **Context**: Two pre-implementation draft docs (`DEVELOPMENT_ROADMAP.md` and `DATABASE_DESIGN.md`) used condensed placeholder statuses (`PENDING`, `DISPATCHED`, `IN_PROGRESS`, `AWAITING_APPROVAL`, `COMPLETED`, `FAILED`) including Windows Agent states from Milestone 5, whereas the authoritative [`PRODUCT_MASTER_SPECIFICATION.md`](file:///d:/Projects/Crelune/docs/PRODUCT_MASTER_SPECIFICATION.md) Module 4 and `.agents/AGENTS.md` Section 16 explicitly require 8 statuses (`DRAFT`, `PENDING`, `IN_PROGRESS`, `AWAITING_REVIEW`, `APPROVED`, `EXPORTED`, `PUBLISHED`, `CANCELLED`), 7 categories (`BIRTHDAY_FLYER`, `CHURCH_PROGRAMME_FLYER`, `EVENT_ANNOUNCEMENT`, `SERVICE_FLYER`, `SOCIAL_MEDIA_GRAPHIC`, `SPECIAL_EVENT_ARTWORK`, `GENERAL_GRAPHIC_DESIGN`), and strictly non-inferred publication after export.
- **Decisions**:
  1. **Follow Authoritative Master Specification States**: Implemented `DesignCategory`, `DesignJobStatus`, and `DesignPriority` in PostgreSQL (`schema.prisma`) and [`design-job.ts`](file:///d:/Projects/Crelune/packages/shared/src/domain/design-job.ts) with an explicit server-enforced transition matrix (`ALLOWED_DESIGN_JOB_TRANSITIONS`) wrapped in `FOR UPDATE` PostgreSQL transactions and append-only [`DesignJobHistory`](file:///d:/Projects/Crelune/packages/database/prisma/schema.prisma) logs.
  2. **Separate Export & Publication**: `APPROVED -> EXPORTED -> PUBLISHED` requires two distinct explicit owner transitions; `EXPORTED` stamps `exportedAt` only and never sets `publishedAt` or `PUBLISHED`.
  3. **Milestone Scope Discipline**: Deferred Milestone 5 (`Template`, `CreativeAgent`, `DISPATCHED`), Milestone 7 (`Event`), and Milestone 8 (`Asset`) relations cleanly without creating speculative tables early, linking `BirthdayPreparation.designJobId` (`onDelete: SetNull`) cleanly to `DesignJob`.
- **Consequences**: Web Design Management and Birthday Flyer workflows are immediately coherent, auditable, and strictly faithful to CRELUNE's master specification without breaking future Windows Agent integration in Milestone 5.

---

## 2. Unresolved Technical Decisions (Awaiting Milestone Evaluation)

The following decisions remain intentionally deferred until their corresponding milestones, with trade-offs outlined below:

### Decision A: Private Object Storage Provider
- **Status**: Approved in Stage 3.1 (Architectural Selection Only — Provisioning Deferred to Stage 3.3).
- **Context**: Needed for storing member photographs and high-resolution creative assets (Milestone 3 & 8).
- **Options Evaluated**:
  1. *AWS S3*: Industry standard, high reliability, standard AWS IAM.
  2. *Cloudflare R2*: S3-compatible, zero egress fees.
  3. *Neon Object Storage*: Integrated directly with Neon database branches.
- **Decision**: Product Owner approved **Neon Object Storage** for member photo metadata (`Member.photoStorageKey`, `photoMimeType`, `photoByteSize`, `photoUpdatedAt` added in Stage 3.1 schema) so object storage stays aligned with Neon Postgres branching. Bucket provisioning, uploads, and pre-signed URLs remain deferred until Stage 3.3.

### Decision B: Mobile Push Notification Infrastructure
- **Status**: Proposed Recommendation — Awaiting Product Owner Approval (Milestone 6 Phase 0).
- **Context**: Needed for mobile birthday alerts and design job review notifications on both Android and iOS (Milestone 6). Empirical validation in Phase 0 confirmed that remote push notifications do not operate inside Expo Go on modern Expo SDKs (requiring EAS Development Builds) and require platform credentials for both Google **FCM v1** (Firebase Service Account JSON + `google-services.json`) and Apple **APNs** (`.p8` Auth Key via paid Apple Developer Program).
- **Options**:
  1. *Expo Push Notification Service (backed by FCM v1 + APNs via EAS)*: Unified dispatch API, native integration with `expo-notifications`, automatic credential management via EAS, free tier suitable for single-owner usage, paired with a durable PostgreSQL `PushDelivery` outbox.
  2. *Direct FCM v1 + Direct APNs from CRELUNE Backend*: Eliminates Expo Push Service hop, but requires maintaining separate OAuth2/JWT HTTP/2 clients, key rotation, and platform-specific feedback handling in the backend.
- **Recommendation**: Use **Expo Push Notification Service** (with FCM v1 + APNs credentials managed in EAS and optional `EXPO_ACCESS_TOKEN` backend auth) paired with a decoupled PostgreSQL `PushDelivery` outbox (`UNIQUE(notification_id, mobile_device_id)`).
- **Approval Required**: Product Owner decision before Milestone 6 Stage 6.1 / 6.6.

### Decision C: Windows Creative Agent IPC Protocol & Automation Fallback (Resolved in ADR 015)
- **Status**: Resolved for Milestone 5 in [ADR 015](#adr-015--exact-template-version-pinning-standalone-manual-fallback--windows-creative-agent-architecture).

### Decision D: Native Mobile Authentication & Token Lifecycle
- **Status**: Proposed Recommendation — Awaiting Product Owner Approval (Milestone 6 Phase 0).
- **Context**: Empirical source audit confirmed CRELUNE Web APIs currently enforce cookie-only `crelune_session` authentication and browser `Origin`/`Referer` CSRF checks, which native iOS/Android apps cannot safely reuse as-is.
- **Options**:
  1. *Per-Device `MobileDevice` + Rotating `MobileSession` Refresh Tokens (`30d`, SHA-256 hashed, family replay revocation) + Short-Lived Signed Mobile Access Tokens (`15m`, `typ: 'mobile_access'`)* stored in `expo-secure-store` (iOS Keychain / Android Keystore), with unified `requireAuthenticatedOwnerApi` handling Web Cookie (+ CSRF) and Mobile Bearer cleanly on existing `/api/*` routes.
  2. *Long-Lived Opaque Per-Device Bearer Token*: Simpler implementation, but lacks short-lived access-token exposure reduction and automatic refresh-token theft/replay detection.
- **Recommendation**: Option 1 (per-device rotating refresh tokens + `15m` access tokens + instant single-device revocation from Web/Mobile Settings).
- **Approval Required**: Product Owner decision before Milestone 6 Stage 6.1.

### Decision E: Unconfirmed External Accounts, Device Availability & Release Blockers
- **Status**: External Dependencies & Release Blockers — Partially Confirmed (Milestone 6 Phase 0 Update).
- **Confirmed Hosting & Distribution Direction (Moved to ADR 016)**: Existing **Expo account** for EAS config/cloud builds (do not assume paid tiers or configured credentials), **Vercel** as intended Web/API hosting paired with **Neon** (deployment & cron config to be validated before production changes), **Google Play Internal Testing** + **Apple TestFlight Internal Testing** as initial distribution channels, Android-first verification priority, and mandatory dual-platform Android + iOS compatibility.
- **Unconfirmed External Accounts (Never Assumed)**:
  1. **Apple Developer Program (\$99/yr)**: Unconfirmed — blocks iOS signing/provisioning, APNs `.p8` push keys, and TestFlight Internal Testing.
  2. **Google Play Console (\$25 one-time)**: Unconfirmed — blocks Google Play Internal Testing uploads (does not block local Android emulator or APK sideloading).
  3. **Firebase Project (FCM v1)**: Unconfirmed — blocks real Android remote push notification delivery (`google-services.json` + FCM v1 Service Account Key).
  4. **App Identifiers**: Final reverse-DNS namespace (`com.crelune.app` / `com.crelune.app.dev` or founder-owned domain) pending confirmation before Stage 6.2.
- **Physical Device Release Blocker**:
  - **No physical iPhone is currently available.** Physical iOS runtime, camera/HEIC capture, APNs push delivery, VoiceOver/Dynamic Type, and TestFlight acceptance MUST remain marked `PENDING / BLOCKED` until tested on a real iPhone. **EAS cloud iOS builds alone do NOT constitute physical-device verification, and physical iPhone testing is mandatory before public release.**

---

## ADR 014 — Birthday Design Job Uniqueness, Advisory Locking & Preparation Reconciliation

- **Date**: 2026-11-11
- **Status**: Accepted
- **Scope**: Birthday Operations (`@crelune/shared`, `apps/web/src/lib/designs/design-job-service.ts`, `design-http.ts`)

### Context

An independent code review identified three integrity gaps across the Stage 3.6 / Milestone 4 bundle:
1. [`updateBirthdayPreparationStatus`](file:///d:/Projects/Crelune/apps/web/src/lib/birthdays/birthday-overview-service.ts) invoked `resolveCelebrationDateForYear` with reversed arguments `(targetYear, birthMonth, birthDay, policy)`.
2. Concurrent `createDesignJob` requests for `BIRTHDAY_FLYER` jobs on the same `(organisationId, memberId, birthdayTargetYear)` lacked a concurrency lock and could create duplicate active flyer jobs or race against `BirthdayPreparation.designJobId`.
3. `updateDesignJob` and cancellation/reopen transitions did not reconcile `BirthdayPreparation.designJobId` or enforce bidirectional consistency between `category === 'BIRTHDAY_FLYER'`, `memberId`, and `birthdayTargetYear`.

### Decisions

1. **Duplicate Behaviour Policy**: Reject concurrent or sequential creation, update, or `CANCELLED -> DRAFT` reopening that would produce more than one active (`status !== 'CANCELLED'`) `BIRTHDAY_FLYER` job per `(organisationId, memberId, birthdayTargetYear)`, or overwrite a `BirthdayPreparation.designJobId` owned by another job, with **HTTP `409 Conflict`** (`DesignJobConflictError`, code `DUPLICATE_BIRTHDAY_DESIGN_JOB` or `BIRTHDAY_PREP_ALREADY_LINKED`). Cancelled `BIRTHDAY_FLYER` jobs detach their `BirthdayPreparation.designJobId` so a clean replacement flyer may be created; reopening an old cancelled job once a replacement exists is rejected with `409`. Non-birthday categories may link multiple jobs to the same member independently without touching `BirthdayPreparation`.
2. **Transaction-Scoped Deterministic Advisory Locking**: Before checking active conflicts or mutating `BirthdayPreparation`, services acquire PostgreSQL transaction-scoped advisory locks (`SELECT pg_advisory_xact_lock(int4, int4)`) keyed from the SHA-256 digest (first two signed 32-bit big-endian ints) of canonical `JSON.stringify(['crelune:birthday-design-job:v1', organisationId, memberId, targetYear])`. When updating a birthday tuple (`oldTuple -> newTuple`), locks are acquired in sorted key order to prevent AB-BA deadlocks.
3. **Strict Category & Preparation Reconciliation Invariants**:
   - `BIRTHDAY_FLYER` creation and updates require both an active member with complete `(birthMonth, birthDay)` and an integer `birthdayTargetYear` (`2000..2200`). Non-birthday jobs forbid a non-null `birthdayTargetYear`.
   - Reassigning `memberId` or `birthdayTargetYear`, converting away from `BIRTHDAY_FLYER` (automatically clearing `birthdayTargetYear`), or transitioning to `CANCELLED` detaches only `BirthdayPreparation` rows where `designJobId === job.id` without clearing existing `status` or `notes`, and links any destination preparation only if unowned while preserving `PUBLISHED`, `SKIPPED`, and existing progress statuses.

### Consequences

- Strong concurrency correctness and atomic multi-table reconciliation on PostgreSQL without requiring destructive DDL migrations on production or brittle composite unique constraints on nullable/cancelled columns.
- Zero interference with non-birthday creative workflows or historical preparation states.

---

## ADR 015 — Exact Template Version Pinning, Standalone Manual Fallback & Windows Creative Agent Architecture

- **Date**: 2026-11-23
- **Status**: Accepted (Supersedes contingent status of Decision C / ADR 008 for Milestone 5)
- **Scope**: Milestone 5 Stages 5.4 & 5.5 (`@crelune/shared`, `apps/web`, `apps/agent`)

### Context

Live workstation verification on 2026-11-23 confirmed Affinity MSIX package `Canva.Affinity_3.3.3.5004_x64__8a0j1tnjnt4a4` installed with App Execution Alias `%LOCALAPPDATA%\Microsoft\WindowsApps\Affinity.exe`, while both `ScriptingPreferences.xml` (`ScriptingEnabled=False`) and `MCPPreferences.xml` (`EnableMCPServer=False`) remain disabled by default. Neither an official headless Affinity scripting CLI nor safe automatic PSD layer editing exists for production automation.

### Decisions

1. **Exact Immutable Version Pinning (`Stage 5.4`)**:
   - Binding a template to a `DesignJob` pins an exact `TemplateVersion` (`templateVersionId`), protected by both application validation and Stage 5.1.2 PostgreSQL `FOR NO KEY UPDATE` consistency triggers. Updating a template's active version never alters existing pinned jobs, and active dispatches lock template rebinding (`409 TEMPLATE_LOCKED_BY_ACTIVE_DISPATCH`).
2. **Dual Execution Architecture: Agent Queue + Standalone Manual Fallback**:
   - CRELUNE Web exposes both an idempotent dispatch queue for the Windows Creative Agent and complete standalone manual endpoints (`manifest`, SHA-256-verified `master`, private member photo, and manual verified export upload) so creative work never depends on the local agent running.
3. **Outbound-Only Windows Creative Agent with Windows DPAPI (`Stage 5.5`)**:
   - `@crelune/agent` operates strictly outbound over HTTPS using revocable per-machine Bearer tokens stored exclusively via Windows DPAPI (`CurrentUser` scope) on disk and SHA-256 hashed in PostgreSQL.
   - Dispatches are claimed atomically via `FOR UPDATE SKIP LOCKED` with lease expiration and instant revocation cleanup.
4. **Truthful Assisted/Manual Affinity Handoff**:
   - The agent isolates each job in `<workspaceRoot>/jobs/<jobId>/{source,working,assets,exports,logs}/`, marks `source/` masters read-only with pre/post SHA-256 checks, gates launching allowlisted `Affinity.exe` on the `working/` copy behind explicit user approval (`ASSISTED`), and records `MANUAL` whenever launch is declined or unavailable. Global Affinity Scripting/MCP preferences are never modified; any future MCP bridge remains strictly opt-in and loopback-only.

### Consequences

- Preserves 100% template immutability, zero unverified automation claims, and reliable day-to-day creative production on Windows 11 with Affinity 3.3.3.5004.
- Maintains a clean seam to introduce verified MCP or scripting tools later without breaking existing schemas, manifests, or security invariants.

---

## ADR 016 — Milestone 6 Mobile Platform Scope & Empirically Verified Compatibility Baseline

- **Date**: 2026-11-23
- **Status**: Confirmed Scope & Verified Baseline (Implementation Recommendations in Decisions B, D, E Remain Pending Approval)
- **Scope**: Milestone 6 Phase 0 Planning (`apps/mobile`, `packages/shared`, `packages/ui`, `apps/web`)
- **Detailed Plan**: [`docs/milestones/MILESTONE_6_MOBILE_ARCHITECTURE_AND_EXECUTION_PLAN.md`](file:///d:/Projects/Crelune/docs/milestones/MILESTONE_6_MOBILE_ARCHITECTURE_AND_EXECUTION_PLAN.md)

### Approved Product Owner Decisions

1. **Dual-Platform First Release (Mandatory)**: CRELUNE Mobile MUST support **both Android and iOS** from its initial release (resolving the prior open platform scope in `PRODUCT_MASTER_SPECIFICATION.md` Section 4.2 and `crelune-mobile` Section 4). Android-only libraries and platform assumptions are prohibited; iOS config and build compatibility must be maintained throughout development.
2. **Android-First Development & iOS Physical-Device Release Gate**: Prioritize Android emulator and physical Android device verification (camera, image processing, uploads, push notifications, auth, navigation) during development. Because no physical iPhone is currently available, physical iOS runtime, camera, push, and TestFlight acceptance remain explicitly marked `PENDING / BLOCKED`; EAS cloud builds alone do not count as physical-device verification, and real iPhone testing is mandatory before public release.
3. **Existing Expo Account for EAS**: Use the Product Owner's existing Expo account for EAS configuration and cloud builds without assuming paid EAS tiers or preconfigured signing/push credentials.
4. **Native-Only UI (Reaffirming ADR 006) & Single Shared Backend**: Mobile must be a genuine native application (React Native / Expo / TypeScript / Expo Router direction) with zero WebViews and zero second backend or direct DB/storage access.
5. **Hosting & Initial Distribution**: **Vercel** is approved as the intended CRELUNE Web/API hosting platform while **Neon** remains the database and private object storage provider (deployment settings, body-size constraints, and cron triggers must be validated on development/preview before any production changes). **Google Play Internal Testing** and **Apple TestFlight Internal Testing** are the planned initial distribution channels.

### Empirically Verified Workstation & Repository Capabilities (`2026-11-23`)

1. **Monorepo React Parity**: Installed workspace React is `19.3.1` (`next@15.5.29`, `zod@4.6.7`, Node `v24.21.0`). Published Expo **SDK 58** (`expo@58.0.26`, `expo-router@58.0.32`, `react-native@0.88.1`) requires `react@^19.3.0` and `@types/react@^19.1.1` (New Architecture mandatory), aligning cleanly with the existing monorepo without a React version split.
2. **Shared Package Boundaries**: `@crelune/shared` contains zero Node built-in imports (`zod` + `date-fns` only) and is directly reusable by mobile (excluding server-only `validateEnv()`). `@crelune/ui` root exports HTML/DOM web components and CSS-unit tokens; mobile will require a pure hex-color subpath export (`@crelune/ui/colors`) rather than importing web DOM components.
3. **Photo Format & Auth Constraints**: Backend member photo uploads (`POST /api/members/[id]/photo`) enforce `image/jpeg`, `image/png`, and `image/webp` (`<= 10 MB`, `sharp` EXIF stripping), so iOS HEIC/HEIF captures require client-side JPEG transcoding before upload. Existing owner APIs enforce cookie-only sessions + browser CSRF Origin checks, requiring dedicated mobile token auth before mobile implementation (see proposed Decision D).
4. **Workstation Build Capabilities**: Windows 11 host has JDK `21.0.13.9`, Android SDK (`adb`, `build-tools 36/37`, `android-37.0`, `emulator.exe`, AVDs `Medium_Phone_API_37.0` and `Small_Phone`) for local Android testing, and no Xcode (`xcodebuild` absent), making EAS cloud macOS builders necessary for iOS builds.
5. **Roadmap Boundary Fact**: `Event` (Milestone 7) and general `Asset` (Milestone 8) models and APIs are not yet implemented in `schema.prisma` or `apps/web/src/app/api/*`.

### Proposed Implementation Details & Open Blockers (Not Yet Approved / Confirmed)

- **Proposed Implementation Details Awaiting Approval**: Mobile rotating-token auth ([Decision D](#decision-d-native-mobile-authentication--token-lifecycle)), Expo Push + `PushDelivery` outbox ([Decision B](#decision-b-mobile-push-notification-infrastructure)), Milestone 7/8 placeholder scope in Milestone 6, and app reverse-DNS identifiers (`com.crelune.*`).
- **Unconfirmed External Dependencies & Release Blockers**: Apple Developer Program (\$99/yr), Google Play Console (\$25 one-time), Firebase project (FCM v1), physical Android device confirmation, Vercel preview/cron validation, and unavailable physical iPhone (see [Decision E](#decision-e-unconfirmed-external-accounts-device-availability--release-blockers)).
