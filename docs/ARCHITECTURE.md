# CRELUNE — System Architecture Specification

**Document:** System Architecture & Component Boundaries  
**Project:** CRELUNE  
**Version:** 1.0  
**Status:** Approved for Milestone 0 Foundation  
**Primary Reference:** [`docs/PRODUCT_MASTER_SPECIFICATION.md`](file:///d:/Projects/Crelune/docs/PRODUCT_MASTER_SPECIFICATION.md)

---

## 1. Executive Architectural Summary

> [!IMPORTANT]
> **Implementation Status: Milestone 2 Web Foundation Implemented**
>
> As of Milestone 2, the web application foundation (`apps/web`), shared domain packages (`@crelune/shared`, `@crelune/ui`, `@crelune/database`), and Neon Lakebase Postgres persistence layer are **IMPLEMENTED**.
>
> Mobile companion (`apps/mobile`) and Windows Creative Agent (`apps/agent`) remain scheduled for Milestone 6 and Milestone 5 respectively. Subsystems are developed sequentially according to the Development Roadmap.

CRELUNE (*kreh-LOON*) is a personal creative and media operations platform designed for a single owner/operator (church media lead and graphic designer). The proposed architecture coordinates three distinct clients through a single unified backend and canonical PostgreSQL database:

```mermaid
flowchart TD
    subgraph Clients["Client Ecosystem"]
        Web["CRELUNE Web (Next.js 15+ / React)\nDesktop Management & Creation Hub"]
        Mobile["CRELUNE Mobile (React Native / Expo)\nEveryday Capture & Notification Companion"]
        Agent["Windows Creative Agent (Node.js Daemon)\nLocal Workstation Bridge"]
    end

    subgraph Backend["Shared Core Infrastructure"]
        API["CRELUNE Shared API & Domain Services\n(TypeScript / Next.js Server / Hono)"]
        Storage["Private Object Storage\n(S3-Compatible / Pre-signed URLs)"]
    end

    subgraph DataTier["Data Tier"]
        DB[("Neon Lakebase Postgres\n(Prisma ORM / Connection Pooling)")]
    end

    subgraph LocalCreative["Local Windows 11 Workstation"]
        Affinity["Serif Affinity 3.3\n(Designer / Photo / Publisher)"]
        FileSystem["Local Working Copy Workspace\n(Protected Master Templates)"]
    end

    Web -->|"HTTPS / REST / Server Actions"| API
    Mobile -->|"HTTPS / REST (JWT Auth)"| API
    Agent -->|"HTTPS / WSS (API Key / Heartbeat)"| API

    API -->|"Prisma Client (Pooled)"| DB
    API -->|"Short-lived Signed URLs (<= 15m)"| Storage

    Agent -->|"Safe File Duplication"| FileSystem
    Agent -->|"Affinity 3.3 JS Scripting API"| Affinity
    Affinity -->|"Render Working Copy / Export"| FileSystem
```

---

## 2. Core Architectural Principles

1. **Personal First (Single-Owner Domain)**:
   - Initial deployment is strictly single-tenant for the founder.
   - Foreign keys and database relations maintain an `organisationId` to permit future multi-user separation, but no multi-tenant invitations, team chat, or granular RBAC are implemented in the initial release.
2. **Authoritative Central Backend**:
   - Web, Mobile, and Windows Creative Agent all communicate with the same shared backend.
   - Business rules (date calculations, birthday reminder detection, job status transitions) reside solely on the backend.
3. **Decoupled Creative Agent**:
   - The browser client **never** attempts direct local execution (no `localhost` port sniffing, no ActiveX/Node runtime in browser).
   - All desktop Affinity operations flow asynchronously via the backend-coordinated job queue.
4. **Master Template Immutability**:
   - Master Affinity (`.afdesign`, `.aftemplate`) and Photoshop (`.psd`) templates are never modified in place.
   - The Windows Creative Agent executes a mandatory byte-for-byte copy to a disposable working workspace before executing any layer operations.
5. **Privacy by Default**:
   - Church member personal information (birthdays, contact numbers, photographs) is strictly private.
   - Storage uses private buckets with short-lived pre-signed URLs ($\le 15\text{ minutes}$). Permanent public links are prohibited.

---

## 3. Subsystem Breakdown

### 3.1 CRELUNE Web (Management Workspace)
- **Technology Stack**: Next.js (App Router), React, TypeScript, Tailwind CSS, Radix UI headless accessible primitives.
- **Role**: Primary desktop command center for Windows 11 desktop browser (1080p+).
- **Core Modules**:
  1. *Dashboard*: Overview of upcoming birthdays, pending design flyers, active church programmes, and recent exports.
  2. *Members*: Church member directory, dates of birth, contact details, assigned photo assets.
  3. *Birthdays*: Calendar view, filterable by month, automatic reminder generation.
  4. *Programmes & Events*: Church services, conferences, and attached design requirements.
  5. *Design Management*: Job tracking from inception through draft, review, approval, and publication.
  6. *Template Catalog*: Registered templates, studio targets, layer field mappings.
  7. *Asset Library*: Church logos, branding graphics, high-resolution textures, member photos.
  8. *Notifications & Settings*: Operational preferences and desktop agent status.
- **Ergonomics**: High-density creative workspace with left sidebar, light-mode palette (`#6541A5` primary, `#A99AD1` lavender, `#F8F7FA` neutral background), zero decorative clutter.

### 3.2 CRELUNE Mobile (Native Companion)
- **Technology Stack**: React Native, Expo SDK, TypeScript.
- **Role**: Everyday mobile companion on iOS and Android for fast capture and reminders.
- **Strict Boundary**: **Zero WebViews.** Fully native UI components.
- **Core Capabilities**:
  - Upcoming birthday reminders and notifications.
  - Fast member photo capture via native camera (`expo-camera` / `expo-image-picker`).
  - Rapid member registration (< 30 seconds).
  - Quick design job progress check and mobile approval.
  - Native push notifications (`expo-notifications`).

### 3.3 CRELUNE Windows Creative Agent (Local Workstation Bridge)
- **Technology Stack**: Node.js / TypeScript Windows background service (or lightweight C# daemon).
- **Role**: Secure bridge connecting CRELUNE cloud/server backend to the local Windows 11 desktop and Affinity 3.3.
- **Security Posture**: Authenticates to backend via cryptographically hashed agent API tokens. Accepts only structured, validated job manifests. Executes zero arbitrary remote shell commands.
- **Affinity Automation Lifecycle**:
  ```text
  [Backend Job Manifest] 
          │
          ▼
  1. Agent downloads manifest & assets to local temp cache
  2. Agent duplicates registered Master Template -> Working Copy
  3. Agent launches/communicates with Affinity 3.3
  4. Agent executes verified Affinity JS Script (official SDK: sdk.affinity.studio/3.3.3/js/)
  5. Text node replacement & member photo placement
  6. Working copy saved; review graphic exported (PNG/JPEG)
  7. Founder visual inspection & creative fine-tuning in Affinity
  8. Final approval -> Agent uploads deliverable -> Marks COMPLETED
  ```

### 3.4 Shared Backend & API Services
- **Technology Stack**: Node.js, TypeScript, Next.js API Routes / Hono server handlers.
- **Data Access**: Prisma ORM with PostgreSQL.
- **Hosted Environment**: Neon Lakebase Postgres (AWS region: `us-east-2`), utilizing pooled connection strings for serverless application queries and unpooled direct strings for migrations.
- **Authentication**: Cryptographically signed cookie-based sessions (HMAC-SHA256, zero PII claims, `SESSION_TTL_SECONDS = 604800`, `ver` claim) with dual Node/`crypto.subtle.verify` Edge validation, database-backed active-owner & `sessionVersion` revocation checks, Origin/Referer CSRF validation on auth mutations, and durable PostgreSQL `(IP, account)` + `IP` throttling (`auth_throttles`) for Web; Bearer JWT tokens for Mobile; hashed API keys for Windows Creative Agent. Mandatory `SESSION_SECRET` ($\ge 32$ chars, fail-closed `503`).

---

## 4. Communication & Data Flow

```mermaid
sequenceDiagram
    autonumber
    actor Founder as Founder / User
    participant Web as CRELUNE Web
    participant API as CRELUNE Backend
    participant DB as Neon Postgres
    participant Agent as Windows Creative Agent
    participant Affinity as Affinity 3.3 Desktop

    Note over Founder,DB: Phase 1: Birthday Detection & Job Creation
    API->>DB: Query birthdays in next 14 days
    DB-->>API: Member record (John Doe, Oct 14, photo.jpg)
    API->>DB: Create BirthdayReminder & DesignJob (PENDING)
    Web->>API: Fetch pending design jobs
    API-->>Web: Display job on Dashboard

    Note over Founder,Affinity: Phase 2: Agent Dispatch & Automated Preparation
    Agent->>API: Poll queued jobs / Receive dispatch event
    API-->>Agent: Job Manifest (Template ID, Member Data, Asset Signed URLs)
    Agent->>Agent: Download photo.jpg & create Working Copy (job_123.afdesign)
    Agent->>Affinity: Invoke verified JS script on Working Copy
    Affinity->>Affinity: Replace layer text & place photo
    Affinity-->>Agent: Save working copy & export preview.png
    Agent->>API: Upload preview.png & update status (AWAITING_APPROVAL)

    Note over Founder,Affinity: Phase 3: Creative Control & Approval
    Founder->>Affinity: Inspects job_123.afdesign & adjusts framing/typography
    Founder->>Web: Clicks "Approve & Mark Ready"
    Web->>API: Update status (COMPLETED)
    API->>DB: Record export history & mark reminder fulfilled
```

---

## 5. Storage Architecture

| Resource Type | Storage Destination | Access Protocol | Retention Policy |
| :--- | :--- | :--- | :--- |
| **Member Photographs** | Private Object Storage Bucket (`/members/photos/`) | Pre-signed GET ($\le 15\text{ min}$) | Retained until member archived/deleted |
| **Master Templates** | Local Read-Only Directory + Storage (`/templates/master/`) | Read-only access | Permanent / Immutable |
| **Working Copies** | Local Workstation Scratch (`/workspaces/jobs/`) | Local filesystem read/write | Disposable after job export |
| **Exported Graphics** | Private Object Storage Bucket (`/exports/final/`) | Pre-signed GET | Permanent production record |
| **Logos & Church Assets** | Private Object Storage Bucket (`/assets/`) | Pre-signed GET / Cached | Active operational assets |

---

## 6. Technical Boundary Restrictions

1. **No Direct Browser Access to Filesystem**: Web browsers cannot read or write to Windows directories (`C:\`, `D:\`) or communicate with local Affinity processes directly.
2. **No Unauthenticated Public Endpoints**: All member records, photos, calendar feeds, and design assets require authenticated session credentials.
3. **No In-Place Template Mutations**: Automation scripts are physically isolated to working copy paths.
4. **No WebView Wrappers**: CRELUNE Mobile must run on native React Native components with native navigation stacks.

---

## 7. Stage 5.2 Template Backend Architecture

1. **Dedicated Private Creative Bucket (`crelune-dev-creative`)**:
   - Template masters (`TEMPLATE_MASTER`) and optional previews (`TEMPLATE_PREVIEW`) are stored in a dedicated private Neon Object Storage bucket separate from `crelune-dev-member-photos`, enforced by [`getCreativeObjectStorageConfig`](file:///d:/Projects/Crelune/apps/web/src/lib/storage/storage-config.ts) and [`NeonS3CreativeStorageProvider`](file:///d:/Projects/Crelune/apps/web/src/lib/storage/creative-storage.ts).
   - Object keys follow strict scoped prefixes (`{envPrefix}/organisations/{organisationId}/templates/{templateId}/...`) verified before signing, reading, or deletion.
2. **Authoritative Presigned PUT & Verification Lifecycle (Hardened Stage 5.2.1)**:
   - [`createTemplateUploadIntent`](file:///d:/Projects/Crelune/apps/web/src/lib/templates/template-service.ts) issues time-bounded (`<= 900s`) S3 presigned PUT URLs targeting non-versioned staging keys (`staging/masters/{uuid}.{ext}`, `staging/previews/{uuid}.{ext}`), keyed by idempotency key, and records `CreativeUploadIntent` (`PENDING`) without reserving a provisional `versionNumber`.
   - [`completeTemplateVersionUpload`](file:///d:/Projects/Crelune/apps/web/src/lib/templates/template-service.ts) downloads staged bytes under bounded stream limits (`getObjectBounded`), verifies exact `byteSize` and `sha256`, locks the parent `Template` (`FOR UPDATE`) to compute the sequential `versionNumber`, promotes verified bytes to canonical immutable keys (`versions/v{versionNumber}/{uuid}.{ext}`, `previews/v{versionNumber}/{uuid}.{ext}`), records `TemplateVersion`, and cleans up staging keys (with `CreativeStorageCleanup` fallback).
   - [`abandonUploadIntent`](file:///d:/Projects/Crelune/apps/web/src/lib/templates/template-service.ts) and [`cleanupPendingCreativeStorage`](file:///d:/Projects/Crelune/apps/web/src/lib/templates/template-service.ts) preserve `expiresAt` on abandoned intents, always enqueue `CreativeStorageCleanup`, defer final `'COMPLETED'` deletion until `expiresAt + CREATIVE_CLEANUP_EXPIRY_GRACE_MS` (`60s`), and refuse deletion of any key referenced by an active `TemplateVersion` or `ExportRecord` (`REJECTED`).
3. **Worker-Isolated Bounded PSD Inspection & Native Affinity Fallback (Hardened Stage 5.2.1)**:
   - PSD v1 (`8BPS`) masters are inspected read-only by [`WebtoonPsdLayerInspector`](file:///d:/Projects/Crelune/apps/web/src/lib/templates/psd-inspector.ts) inside an isolated Node `worker_threads` worker ([`psd-parse-worker.mjs`](file:///d:/Projects/Crelune/apps/web/src/lib/templates/psd-parse-worker.mjs)) with `env: {}`, V8 `resourceLimits` (`256 MB` old-gen heap, `64 MB` young-gen, `16 MB` code range), bounded worker output (`<= 1 MiB`), and real `worker.terminate()` wall-clock cancellation (`10s` timeout), always recording `extractedMetadataOnly: true` and `editabilityVerified: false` under strict node (`500`), depth (`16`), dimension (`30,000px`), and size (`100 MB`) bounds.
   - Native Affinity documents (`.af`, `.afdesign`, `.afphoto`, `.afpub`) bypass binary parsing and register with `inspectionStatus: 'MANUAL_REQUIRED'` for artist-verified field mapping.
4. **Versioning, Rollback, Mappings & Soft Archival**:
   - Templates support immutable version history, instant active-version rollback (`PATCH /api/templates/[id]`), version-scoped `TemplateFieldMapping` replacement (`PUT /api/templates/[id]/versions/[versionId]/mappings`), and soft archival/restore (`POST .../archive`, `POST .../restore`) without breaking linked `DesignJob` history.
