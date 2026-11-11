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
- **Context**: Needed for mobile birthday alerts and design job review notifications (Milestone 6).
- **Options**:
  1. *Expo Push Notification Service*: Zero-config setup, native integration with Expo apps, free tier suitable for single owner.
  2. *Firebase Cloud Messaging (FCM)*: Direct provider integration, higher initial setup complexity.
- **Recommendation**: Use Expo Push Notifications for initial milestones; migrate to direct FCM only if multi-tenant enterprise volume is required.
- **Approval Required**: Product Owner decision in Milestone 6.

### Decision C: Windows Creative Agent IPC Protocol & Automation Fallback (Partially Resolved — ADR 008)
- **Status**: Partially Resolved / Contingent. Template immutability and process lifecycle are verified. Final execution bridge (native MCP vs Script Library staging vs GUI automation) is deferred to Milestone 5 evaluation. See [ADR 008](#adr-008-windows-creative-agent-inter-process-communication--affinity-33-integration) and [`docs/milestones/MILESTONE_1_AFFINITY_VALIDATION.md`](file:///d:/Projects/Crelune/docs/milestones/MILESTONE_1_AFFINITY_VALIDATION.md).
