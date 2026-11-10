# CRELUNE — Changelog

All notable changes to the CRELUNE platform will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
