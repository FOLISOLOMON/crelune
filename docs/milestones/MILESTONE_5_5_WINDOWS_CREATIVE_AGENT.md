# CRELUNE — Milestone 5, Stage 5.5: Windows Creative Agent

**Milestone:** 5 — Templates & Affinity Integration  
**Stage:** 5.5 — Windows Creative Agent  
**Status:** Completed (Verified against Neon `development`, `crelune-dev-creative`, Windows 11 DPAPI & Affinity `3.3.3.5004`)  
**Date:** 2026-11-23

---

## 1. Scope Delivered

Stage 5.5 delivers the local Windows Creative Agent (`@crelune/agent` under `apps/agent`) and the corresponding CRELUNE Web backend registration, revocation, heartbeat, atomic job-claiming, authorised asset streaming, and export-upload APIs.

### Backend (`apps/web`)
- **Machine Bearer Authentication ([`agent-auth.ts`](file:///d:/Projects/Crelune/apps/web/src/lib/agents/agent-auth.ts))**:
  - Generates per-machine `cln_agent_<64-hex>` tokens, stores only SHA-256 `tokenHash` and safe display `tokenPrefix`, compares hashes in constant time (`crypto.timingSafeEqual`), rejects query-string tokens and revoked/unknown agents with `401` (`Cache-Control: private, no-store`).
- **Agent Service ([`agent-service.ts`](file:///d:/Projects/Crelune/apps/web/src/lib/agents/agent-service.ts))**:
  - Owner operations: `listCreativeAgents`, `registerCreativeAgent` (one-time secret display + audit event), `revokeCreativeAgent` (instant revocation + automatic release of `CLAIMED`/`DOWNLOADING_ASSETS` dispatches back to `QUEUED` + audit event).
  - Outbound machine operations: `recordAgentHeartbeat`, atomic `FOR UPDATE SKIP LOCKED` `claimNextCreativeDispatch` with 15-minute lease recovery, idempotent `updateAgentDispatchStatus` (advancing `DesignJob` `PENDING -> IN_PROGRESS`), SHA-256-verified `streamAgentDispatchTemplateMaster` from `crelune-dev-creative`, strictly manifest-scoped read-only `streamAgentDispatchAsset`, and `createAgentExportUploadIntent` / `completeAgentExportUpload`.
- **Middleware Allowlist ([`middleware.ts`](file:///d:/Projects/Crelune/apps/web/src/middleware.ts))**:
  - Exempts ONLY the exact 7 `/api/agent/*` machine path+method combinations from browser cookie redirects so route handlers verify Bearer tokens directly while keeping `/api/agents/**` strictly behind owner session + CSRF checks.
- **API Endpoints**:
  - Owner: `GET/POST /api/agents`, `POST /api/agents/[id]/revoke`
  - Agent Bearer: `POST /api/agent/heartbeat`, `POST /api/agent/jobs/claim`, `POST /api/agent/dispatches/[dispatchId]/status`, `GET /api/agent/dispatches/[dispatchId]/template`, `GET /api/agent/dispatches/[dispatchId]/assets/[assetId]`, `POST /api/agent/dispatches/[dispatchId]/exports/upload-intents`, `POST /api/agent/dispatches/[dispatchId]/exports`.
- **Settings UI ([`CreativeAgentsCard.tsx`](file:///d:/Projects/Crelune/apps/web/src/components/settings/CreativeAgentsCard.tsx))**:
  - Added to [`/settings`](file:///d:/Projects/Crelune/apps/web/src/app/(dashboard)/settings/page.tsx) for registering Windows machines, revealing the one-time pairing token with copy/dismiss controls, inspecting live heartbeat & Affinity version status, and revoking compromised or retired machines.

### Standalone Windows Creative Agent (`apps/agent` / `@crelune/agent`)
- **Encrypted Credential Storage ([`dpapi-store.ts`](file:///d:/Projects/Crelune/apps/agent/src/security/dpapi-store.ts))**:
  - Encrypts the Bearer token using Windows Data Protection API (`System.Security.Cryptography.ProtectedData`, `DataProtectionScope.CurrentUser`) via fixed stdin-piped PowerShell invocation (`execFile(..., { shell: false })`). Plaintext secrets never touch disk or process command lines.
- **Strict Workspace Containment ([`path-safety.ts`](file:///d:/Projects/Crelune/apps/agent/src/security/path-safety.ts), [`job-workspace.ts`](file:///d:/Projects/Crelune/apps/agent/src/workspace/job-workspace.ts))**:
  - Isolates every job inside `<workspaceRoot>/jobs/<jobId>/{source,working,assets,exports,logs}/`.
  - Rejects traversal (`..`), absolute paths, Windows drive letters, UNC paths, null bytes, and symlink/junction escapes.
  - Verifies master SHA-256 before writing, marks `source/` master read-only, creates a disposable copy in `working/`, writes `manifest.json`, `PREPARATION_GUIDE.txt`, and append-only `logs/events.jsonl`.
  - Temporary cleanup deletes only `working/tmp/` and never deletes `source/` masters or `exports/` deliverables.
- **Live Affinity 3.3 Detection & Truthful Handoff ([`affinity-detector.ts`](file:///d:/Projects/Crelune/apps/agent/src/affinity/affinity-detector.ts), [`affinity-adapter.ts`](file:///d:/Projects/Crelune/apps/agent/src/affinity/affinity-adapter.ts))**:
  - Live workstation audit on 2026-11-23 confirmed installed MSIX package **`Canva.Affinity_3.3.3.5004_x64__8a0j1tnjnt4a4`**, App Execution Alias `%LOCALAPPDATA%\Microsoft\WindowsApps\Affinity.exe` present, and both `ScriptingPreferences.xml` (`ScriptingEnabled=False`) and `MCPPreferences.xml` (`EnableMCPServer=False`) disabled by default.
  - Agent never alters global Affinity preferences, never invents Affinity scripting APIs, and never parses or edits native Affinity binaries in Node.js.
  - Launching allowlisted `Affinity.exe` requires explicit interactive user approval (`shell: false`), opens ONLY the isolated `working/` copy, verifies `source/` master SHA-256 before and after, and truthfully records `MANUAL` vs `ASSISTED` mode.
  - Optional Affinity MCP probe is disabled by default (`affinityMcpEnabled: false`), strictly loopback-only (`127.0.0.1` / `localhost`), and degrades gracefully to `ASSISTED`/`MANUAL` handoff.
- **Export Verification & Daemon CLI ([`export-validator.ts`](file:///d:/Projects/Crelune/apps/agent/src/exports/export-validator.ts), [`agent-daemon.ts`](file:///d:/Projects/Crelune/apps/agent/src/runtime/agent-daemon.ts), [`cli.ts`](file:///d:/Projects/Crelune/apps/agent/src/cli.ts))**:
  - Validates PNG (`89 50 4E 47` + IHDR), JPEG (`FF D8 FF` + SOF), and PDF (`%PDF-` + `%%EOF`) strictly inside `exports/`, enforces the 50 MB cap, re-verifies `source/` master SHA-256, and uploads via short-lived presigned PUT.
  - CLI commands: `pair`, `doctor`, `once`, `run`, `submit-export`, `unpair`, `help`.
  - Halts cleanly on `401` credential revocation and inspects existing workspaces on startup for crash recovery.

---

## 2. Explicit Boundaries & Honest Limitations

- **No Automatic Layer Editing / Headless Export Claimed**: Because Affinity `3.3.3.5004` keeps Scripting and MCP disabled by default and has no verified headless CLI layer-substitution SDK, the Windows Creative Agent prepares verified isolated workspaces, optionally launches Affinity on the working copy after explicit artist approval (`ASSISTED`), or operates in standalone `MANUAL` fallback mode.
- **Export != Publication**: Exports uploaded by the agent always register with `isApprovedForPublish: false` and `publishedAt: null`, completing the `CreativeJobDispatch` as `EXPORTED` and advancing `DesignJob` `IN_PROGRESS -> AWAITING_REVIEW` (or `APPROVED -> EXPORTED`, never `PUBLISHED`).
- **Member Photo Isolation**: Agent access to member photos is strictly read-only and scoped solely to `assetId` entries declared in the claimed dispatch's `manifestJson`.
