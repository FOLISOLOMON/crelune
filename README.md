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

## 2. Platform Architecture

CRELUNE is structured as a three-tier client ecosystem powered by a unified shared backend:

```text
CRELUNE Web (Next.js Desktop Workspace)
       │
CRELUNE Mobile (React Native + Expo Companion)
       │
CRELUNE Windows Creative Agent (Affinity 3.3 Bridge)
       │
       ▼
 Shared Backend (Node.js / Next.js Server API)
       │
 ┌─────┴────────────────────────┐
 │                              │
 ▼                              ▼
Lakebase Postgres (Neon)    Private Object Storage
```

1. **CRELUNE Web**: The primary desktop command center for managing members, viewing calendars, cataloging templates, and tracking design production.
2. **CRELUNE Mobile**: Native companion app for everyday convenience — birthday alerts, quick member capture with photos, and design progress review. (Zero WebViews).
3. **CRELUNE Windows Creative Agent**: Local Windows 11 desktop daemon coordinating safe automated preparation and exports in Serif Affinity 3.3 without risking master templates.
4. **Shared Backend & Database**: Canonical PostgreSQL schema managed via Prisma ORM and hosted on Neon Lakebase Postgres.

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

## 4. Development Documentation

Comprehensive architectural and engineering documents are maintained in [`docs/`](./docs/):

- [`docs/PRODUCT_MASTER_SPECIFICATION.md`](./docs/PRODUCT_MASTER_SPECIFICATION.md): Authoritative product master specification.
- [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md): Cross-platform technical architecture and subsystem boundaries.
- [`docs/DATABASE_DESIGN.md`](./docs/DATABASE_DESIGN.md): Relational schema, Prisma models, indexing, and migration rules.
- [`docs/DESIGN_SYSTEM.md`](./docs/DESIGN_SYSTEM.md): Visual design tokens, color palette, typography, and UI guidelines.
- [`docs/SECURITY.md`](./docs/SECURITY.md): Threat modeling, authentication, PII photo protection, and input safety.
- [`docs/DEVELOPMENT_ROADMAP.md`](./docs/DEVELOPMENT_ROADMAP.md): Milestone 0 through Milestone 9 roadmap and deliverables.
- [`docs/TECHNICAL_DECISIONS.md`](./docs/TECHNICAL_DECISIONS.md): Architectural Decision Records (ADRs).
- [`docs/TESTING_STRATEGY.md`](./docs/TESTING_STRATEGY.md): Testing tiers, verification protocols, and acceptance criteria.
- [`docs/CHANGELOG.md`](./docs/CHANGELOG.md): Historical record of changes and milestone milestones.

---

## 5. Environment & Prerequisites

- **OS**: Windows 11 (required for Windows Creative Agent & Affinity integration)
- **Runtime**: Node.js `v20+` (current workstation: `v24.21.0`)
- **Package Manager**: npm `10+` (workspaces enabled)
- **Creative Software**: Serif Affinity 3.3 suite (Designer, Photo, Publisher)
- **Database**: PostgreSQL / Neon Lakebase Postgres (configured in `.env.local`)

---

## 6. Current Status

- **Phase**: **Milestone 0 — Product Foundation**
- **Core Skill System**: Established and validated.
- **Neon Cloud Postgres**: Initialized and connected (`.env.local`).
- **Feature Code**: Deferred until Milestone 0 documentation and validation are complete.

