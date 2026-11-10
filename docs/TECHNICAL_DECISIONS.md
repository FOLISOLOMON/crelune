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
- **Status**: Approved (Empirically Verified in Milestone 1).
- **Context**: The Windows Creative Agent requires a secure, supported, non-destructive IPC mechanism to orchestrate Affinity 3.3 on Windows 11.
- **Decision**:
  1. Use Affinity 3.3's built-in **Model Context Protocol (MCP) Server** running on `http://localhost:33001/sse` as the primary IPC bridge. Scripts are dispatched via the standard MCP `execute_script` tool payload.
  2. Use the sanctioned Windows App Execution Alias (`%LOCALAPPDATA%\Microsoft\WindowsApps\Affinity.exe`) for application lifecycle management and document activation, complying with MSIX package boundaries.
  3. Enforce the **Template Immutability Protocol**: master templates are strictly read-only; operations execute exclusively on ephemeral working copies in `workspaces/jobs/{jobId}/`, verified by pre- and post-execution SHA-256 checksum comparison.
  4. Enable `ApplicationSettings.loadPSDWithEditableText = true` for Photoshop template imports to preserve live text typography.
- **Alternatives Evaluated**: Standalone headless CLI (not supported by Affinity 3.3; verified absent in binary audit); Windows UI automation / mouse emulation (fragile, error-prone, non-deterministic).
- **Rationale**: Affinity 3.3 natively implements an MCP SSE server in `libmcp.dll` exposing structured tools (`execute_script`, `render_spread`, `render_selection`). This provides a clean, native, vendor-supported JSON-RPC over SSE communication channel without brittle UI automation or unsupported binary hooks.
- **Consequences**: Deterministic script execution, atomic undoable document commands, high-fidelity exports, zero risk of master template corruption, and full alignment with official Affinity V3 architecture.

---

## 2. Unresolved Technical Decisions (Awaiting Milestone Evaluation)

The following decisions remain intentionally deferred until their corresponding milestones, with trade-offs outlined below:

### Decision A: Private Object Storage Provider
- **Context**: Needed for storing member photographs and high-resolution creative assets (Milestone 3 & 8).
- **Options**:
  1. *AWS S3*: Industry standard, high reliability, standard AWS IAM.
  2. *Cloudflare R2*: S3-compatible, zero egress fees (highly cost-effective for media).
  3. *Neon Object Storage*: Integrated directly with Neon database branches.
- **Recommendation**: Evaluate Cloudflare R2 vs Neon Object Storage during Milestone 3 based on integration ease and cost.
- **Approval Required**: Product Owner decision prior to Milestone 3 implementation.

### Decision B: Mobile Push Notification Infrastructure
- **Context**: Needed for mobile birthday alerts and design job review notifications (Milestone 6).
- **Options**:
  1. *Expo Push Notification Service*: Zero-config setup, native integration with Expo apps, free tier suitable for single owner.
  2. *Firebase Cloud Messaging (FCM)*: Direct provider integration, higher initial setup complexity.
- **Recommendation**: Use Expo Push Notifications for initial milestones; migrate to direct FCM only if multi-tenant enterprise volume is required.
- **Approval Required**: Product Owner decision in Milestone 6.

### Decision C: Windows Creative Agent IPC Protocol — RESOLVED (ADR 008)
- **Status**: Resolved in Milestone 1. See [ADR 008](#adr-008-windows-creative-agent-inter-process-communication--affinity-33-integration) and [`docs/milestones/MILESTONE_1_AFFINITY_VALIDATION.md`](file:///d:/Projects/Crelune/docs/milestones/MILESTONE_1_AFFINITY_VALIDATION.md).
