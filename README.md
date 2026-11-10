# CRELUNE

> **Create. Organise. Bring ideas to life.**

CRELUNE (*kreh-LOON*) is a personal creative and media operations platform designed to help an individual manage creative responsibilities, church media activities, member records, birthdays, events, design jobs, creative templates, and production workflows from a single, unified workspace.

---

## 1. Product Overview

The founder performs creative and media responsibilities within a church environment, including:
- Designing birthday flyers and programme materials.
- Managing announcements and church creative resources.
- Remembering important member dates and anniversaries.
- Tracking design jobs from inception to publication.
- Automating repetitive template preparation while keeping final creative control.

CRELUNE eliminates forgotten responsibilities, scattered information, and manual coordination by turning incoming information into actionable creative jobs and exported creative output.

---

## 2. Platform Architecture & Status Classification

To maintain architectural integrity, CRELUNE strictly distinguishes between confirmed product requirements, existing infrastructure, proposed architectures, and unresolved decisions:

### 2.1 Confirmed Project Requirements (Product Master Specification)
- **Single-Owner Focus**: Built initially for one owner and system administrator. No premature multi-tenant SaaS features, invitations, or enterprise RBAC.
- **Three-Platform Model**:
  - *CRELUNE Web*: The central desktop workspace for managing members, viewing calendars, cataloging templates, and tracking design production.
  - *CRELUNE Mobile*: A dedicated native-feeling companion application (strictly zero WebViews) for everyday capture, birthday notifications, and rapid member photo entry.
  - *CRELUNE Windows Creative Agent*: A local Windows desktop bridge connecting the cloud backend to the founder's Affinity 3.3 creative environment.
- **Creative Control**: Automation assists with data gathering and preparation; the founder retains complete creative control and final approval over all artwork.
- **Document Safety**: Master Affinity (`.afdesign`, `.aftemplate`) and Photoshop (`.psd`) templates must never be overwritten.
- **Privacy & Security**: Church members' birthdays, phone numbers, and photographs are private community data. Permanent public links and unauthenticated member directories are strictly prohibited.

### 2.2 Existing Infrastructure (Repository State)
- **Workstation Environment**: Windows 11 with Node.js (`v24.21.0`), npm (`11.19.0`), and Serif Affinity 3.3 installed.
- **Monorepo Structure**: Root `package.json` with native npm workspaces (`apps/*`, `packages/*`), including `@crelune/shared` and `@crelune/ui`.
- **Development Database**: Neon Lakebase Postgres instance initialized and linked for development via `.env.local`.
- **Governance & Skills**: Master operating rules in `.agents/AGENTS.md` and 9 specialized AI skills in `.agents/skills/`.

### 2.3 Proposed Technical Architecture (Starting Baseline)
- **Web**: Next.js (App Router), React, TypeScript, Tailwind CSS, and Radix UI accessible primitives.
- **Mobile**: React Native, Expo SDK, and TypeScript.
- **Shared Backend & APIs**: TypeScript API routes and domain services using Prisma ORM with PostgreSQL.
- **Windows Creative Agent**: Dedicated background process bridging local Affinity 3.3 automation without browser security bypasses.

### 2.4 Unresolved Implementation Decisions (Awaiting Milestone Evaluation)
- **Affinity 3.3 Automation IPC Mechanism**: Whether the Windows Creative Agent communicates via CLI script execution, developer SDK ports, or UI automation will be empirically determined through testing in **Milestone 1**.
- **Private Object Storage Provider**: Selection between Cloudflare R2, AWS S3, or Neon Object Storage will be evaluated based on cost and egress fees in **Milestone 3 & 8**.
- **Mobile Push Notification Service**: Selection between Expo Push Notification Service and direct Firebase Cloud Messaging (FCM) will be finalized in **Milestone 6**.
- **Production Hosting Platform**: Final production hosting provider will be confirmed during release planning in **Milestone 9**.

---

## 3. Specialist AI Skill System

Development is governed by 9 specialized Google Antigravity Agent Skills in [`.agents/skills/`](./.agents/skills/):

| Skill | Focus Area |
| :--- | :--- |
| [`crelune-product-architect`](./.agents/skills/crelune-product-architect/SKILL.md) | Milestone progression, system boundaries, and ADR governance. |
| [`crelune-ui-ux`](./.agents/skills/crelune-ui-ux/SKILL.md) | Visual tokens, anti-clutter enforcement, layout ergonomics. |
| [`crelune-frontend`](./.agents/skills/crelune-frontend/SKILL.md) | Next.js App Router, React, strict TypeScript, responsive layouts. |
| [`crelune-backend`](./.agents/skills/crelune-backend/SKILL.md) | API design, service layers, job orchestration, signed URLs. |
| [`crelune-database`](./.agents/skills/crelune-database/SKILL.md) | PostgreSQL, Prisma migrations, non-destructive safety, indexes. |
| [`crelune-mobile`](./.agents/skills/crelune-mobile/SKILL.md) | React Native + Expo native companion app, camera capture. |
| [`crelune-affinity-integration`](./.agents/skills/crelune-affinity-integration/SKILL.md) | Windows Agent, Affinity 3.3 JS scripting, template protection. |
| [`crelune-security`](./.agents/skills/crelune-security/SKILL.md) | Authentication, PII & photo privacy, signed storage URLs. |
| [`crelune-qa`](./.agents/skills/crelune-qa/SKILL.md) | Testing pyramid, workflow verification, regression prevention. |

Project operating rules are maintained in [`.agents/AGENTS.md`](./.agents/AGENTS.md).

---

## 4. Development Documentation (Scheduled Milestone 0 Deliverables)

Authoritative specifications are maintained in [`docs/`](./docs/):

- [`docs/PRODUCT_MASTER_SPECIFICATION.md`](./docs/PRODUCT_MASTER_SPECIFICATION.md): **[Authoritative Requirement]** Product master specification.
- [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md): *[Milestone 0 Deliverable]* Cross-platform technical architecture and subsystem boundaries.
- [`docs/DATABASE_DESIGN.md`](./docs/DATABASE_DESIGN.md): *[Milestone 0 Deliverable]* Relational schema, Prisma models, indexing, and migration rules.
- [`docs/DESIGN_SYSTEM.md`](./docs/DESIGN_SYSTEM.md): *[Milestone 0 Deliverable]* Visual design tokens, color palette, typography, and UI guidelines.
- [`docs/SECURITY.md`](./docs/SECURITY.md): *[Milestone 0 Deliverable]* Threat modeling, authentication, PII photo protection, and input safety.
- [`docs/DEVELOPMENT_ROADMAP.md`](./docs/DEVELOPMENT_ROADMAP.md): *[Milestone 0 Deliverable]* Milestone 0 through Milestone 9 roadmap and deliverables.
- [`docs/TECHNICAL_DECISIONS.md`](./docs/TECHNICAL_DECISIONS.md): *[Milestone 0 Deliverable]* Architectural Decision Records (ADRs).
- [`docs/TESTING_STRATEGY.md`](./docs/TESTING_STRATEGY.md): *[Milestone 0 Deliverable]* Testing tiers, verification protocols, and acceptance criteria.
- [`docs/CHANGELOG.md`](./docs/CHANGELOG.md): *[Milestone 0 Deliverable]* Historical record of changes and milestone milestones.

---

## 5. Current Project Status

- **Current Phase**: **Milestone 0 — Product Foundation**
- **Skill System**: Fully validated and active in Antigravity.
- **Repository Baseline**: Initialized with clean Git safety protocols.
- **Feature Code**: **Deferred.** Zero application feature code will be created until Milestone 0 foundation and review are fully complete.
