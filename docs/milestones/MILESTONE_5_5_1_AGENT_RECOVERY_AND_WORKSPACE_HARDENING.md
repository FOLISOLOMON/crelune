# CRELUNE — Milestone 5, Stage 5.5.1: Creative Agent Recovery, Claim Fencing & Workspace Preservation

**Milestone:** 5 — Templates & Affinity Integration  
**Stage:** 5.5.1 — Corrective Hardening  
**Baseline Commit:** `9a8faaa6e076783b29adede8ac99493f21d302bd`  
**Status:** Completed & Verified against Neon `development` (`br-nameless-silence-bexjp44k`), `crelune-dev-creative`, Windows 11 DPAPI & Affinity `3.3.3.5004`  
**Date:** 2026-11-23

---

## 1. Finding A — Mandatory Dispatch Claim Fencing

- **Dedicated Fencing Header**: Exported `DISPATCH_CLAIM_HEADER = 'X-Crelune-Dispatch-Claim'` and `DISPATCH_CLAIM_TOKEN_REGEX = /^clm_[a-f0-9]{48}$/` in [`@crelune/shared`](file:///d:/Projects/Crelune/packages/shared/src/schemas/creative-agent.ts).
- **Mandatory Header Extraction ([`agent-auth.ts`](file:///d:/Projects/Crelune/apps/web/src/lib/agents/agent-auth.ts))**: `extractDispatchClaimToken(request)` validates presence, length, and hex format on every dispatch-scoped machine route (`status`, `lease`, `template`, `assets/[assetId]`, `exports/upload-intents`, `exports`). Missing or malformed headers return `403` (`DISPATCH_CLAIM_REQUIRED` / `DISPATCH_CLAIM_INVALID`) with `Cache-Control: private, no-store` and never echo token values.
- **Constant-Time Verification & Expiry Rejection ([`agent-service.ts`](file:///d:/Projects/Crelune/apps/web/src/lib/agents/agent-service.ts))**: `assertAgentOwnsActiveDispatch` makes `claimToken` mandatory, locks rows with `FOR UPDATE` on mutating paths, verifies agent assignment, hashes with SHA-256, compares against `claimTokenHash` via `crypto.timingSafeEqual`, and rejects expired leases (`DISPATCH_LEASE_EXPIRED`), mismatched/rotated claims (`DISPATCH_CLAIM_MISMATCH`), and terminal dispatches (`DISPATCH_TERMINAL`).
- **Same-Agent Concurrency Safety**: Claim rotation on lease recovery immediately fences stale worker processes even when running under the same `CreativeAgent` identity.
- **DPAPI-Protected Agent Claim Persistence ([`dpapi-store.ts`](file:///d:/Projects/Crelune/apps/agent/src/security/dpapi-store.ts), [`crelune-api-client.ts`](file:///d:/Projects/Crelune/apps/agent/src/api/crelune-api-client.ts))**: `CreluneAgentApiClient` sends `X-Crelune-Dispatch-Claim` on every dispatch-scoped request; `WindowsDpapiDispatchClaimStore` encrypts active claim tokens via Windows DPAPI (`CurrentUser`) under `configDir/claims/<dispatchId>.dpapi` so follow-up CLI commands (`renew-lease`, `submit-export`) never write plaintext claim tokens to disk, `manifest.json`, or logs.
- **Log & Audit Redaction**: [`audit-service.ts`](file:///d:/Projects/Crelune/apps/web/src/lib/audit/audit-service.ts) and [`logger.ts`](file:///d:/Projects/Crelune/apps/agent/src/security/logger.ts) strip `X-Crelune-Dispatch-Claim`, `claimToken`, and `clm_*` patterns from all diagnostics and audit records.

---

## 2. Finding B — Per-State Dispatch Lease Recovery & Revocation Policy

| Dispatch State | Lease Expiry Auto-Recovery | Agent Revocation Policy | Owner Intervention |
|---|---|---|---|
| `QUEUED` | Immediately claimable | Clears `assignedAgentId` so another active agent can claim | None |
| `CLAIMED` | **Auto-recovered** atomically (`FOR UPDATE SKIP LOCKED`), rotated `claimTokenHash`, `CREATIVE_DISPATCH_RECOVERED` audit | **Auto-requeued to `QUEUED`**, claim/lease cleared, `CREATIVE_DISPATCH_RECOVERED` audit | None |
| `DOWNLOADING_ASSETS` | **Auto-recovered** atomically (`FOR UPDATE SKIP LOCKED`), rotated `claimTokenHash`, `CREATIVE_DISPATCH_RECOVERED` audit | **Auto-requeued to `QUEUED`**, claim/lease cleared, `CREATIVE_DISPATCH_RECOVERED` audit | None |
| `OPENING_TEMPLATE` | **Auto-recovered** atomically (`FOR UPDATE SKIP LOCKED`), rotated `claimTokenHash`, local working copy preserved | **Auto-requeued to `QUEUED`**, claim/lease cleared, `CREATIVE_DISPATCH_RECOVERED` audit | None |
| `EXPORTING` | **Auto-recovered** atomically (`FOR UPDATE SKIP LOCKED`), rotated `claimTokenHash`, export idempotency preserved | **Auto-requeued to `QUEUED`**, claim/lease cleared, `CREATIVE_DISPATCH_RECOVERED` audit | None |
| `READY_FOR_ARTIST` | **Never auto-reclaimed** (protects active artist edits) | **Preserved in `READY_FOR_ARTIST`**; `claimTokenHash` & `leaseExpiresAt` cleared (`AGENT_REVOKED_INTERVENTION_REQUIRED`), `CREATIVE_DISPATCH_INTERVENTION_REQUIRED` audit | **Required & Visible**: surfaced in `DesignJobPreparationSnapshot` (`requiresOwnerIntervention: true`) and [`DesignJobPreparationPanel.tsx`](file:///d:/Projects/Crelune/apps/web/src/components/designs/DesignJobPreparationPanel.tsx) with explicit **Release & Requeue** (`POST /api/designs/[id]/dispatches/[dispatchId]/recover`), **Cancel**, or **Manual Export Upload** |
| `EXPORTED` / `FAILED` / `CANCELLED` | **Never requeued** (terminal) | Untouched (historical traceability preserved) | Owner may queue a new dispatch if needed |

- **Explicit Lease Renewal**: Added `POST /api/agent/dispatches/[dispatchId]/lease` (`renewAgentDispatchLease`) and CLI command `crelune-agent renew-lease --dispatch <id>`, requiring valid Bearer auth + mandatory `X-Crelune-Dispatch-Claim`, extending only a valid unexpired lease under `FOR UPDATE`, and recording `CREATIVE_DISPATCH_LEASE_RENEWED`.
- **Export Completion Idempotency**: `EXPORTED` dispatches clear `leaseExpiresAt` and block all active operations while retaining `claimTokenHash` solely so an idempotent retry of `completeAgentExportUpload` with the exact winning `claimToken` and `uploadIntentId` succeeds safely without duplicating `ExportRecord` rows.

---

## 3. Finding C — Preservation-First Local Workspaces

- Updated [`prepareIsolatedJobWorkspace`](file:///d:/Projects/Crelune/apps/agent/src/workspace/job-workspace.ts) to check whether `working/<target>` already exists before writing:
  - Existing working copies are **never overwritten** during retries or recovery — even when their SHA-256 differs from the source master (recognized as `PRESERVED_WITH_ARTIST_EDITS`, never treated as a corrupted master).
  - Source masters in `source/` are verified independently by SHA-256 and kept read-only.
  - Existing files inside `exports/` are never overwritten or deleted during preparation, recovery, or temp cleanup (`preservedExistingExports` reported cleanly).
  - Every preservation event is recorded in `logs/events.jsonl` (`EXISTING_WORKING_COPY_PRESERVED`).
  - Destructive working-copy replacement requires explicit caller opt-in (`explicitOverwriteWorkingCopy: true`).
- Enhanced [`inspectExistingWorkspaces`](file:///d:/Projects/Crelune/apps/agent/src/workspace/job-workspace.ts) to report `masterIntegrityOk`, `workingCopyFiles`, `workingCopyHasArtistEdits`, and `existingExportFiles` read-only.
- Hardened [`resolveStrictlyWithinRoot`](file:///d:/Projects/Crelune/apps/agent/src/security/path-safety.ts) with component-by-component `lstatSync` symlink/junction validation and `assertNotSymlinkIfExists` across workspace reads/writes.

---

## 4. Finding D — Explicit Working Asset Boundary

- Decision: **Explicit Rejection until Milestone 8 (Asset Library)**. Only `MEMBER_PHOTO` (`member.photo`) is supported for automated agent asset streaming in Milestone 5; `WORKING_ASSET` is explicitly rejected until a dedicated `Asset` model and Milestone 8 Asset Library are approved.
- Enforced at three layers:
  1. **Shared Contract ([`creative-agent.ts`](file:///d:/Projects/Crelune/packages/shared/src/schemas/creative-agent.ts))**: `assetReference.assetKind` restricted to `SUPPORTED_MANIFEST_ASSET_KINDS = ['MEMBER_PHOTO']`.
  2. **Manifest Preparation ([`job-preparation-service.ts`](file:///d:/Projects/Crelune/apps/web/src/lib/designs/job-preparation-service.ts))**: Non-`member.photo` `IMAGE` mappings produce `UNSUPPORTED_ASSET_KIND` blocking errors (when required) or warnings (when optional) instead of fabricating unsupported references.
  3. **Agent Asset Streaming ([`agent-service.ts`](file:///d:/Projects/Crelune/apps/web/src/lib/agents/agent-service.ts))**: Rejects any non-`MEMBER_PHOTO` asset kind with `CreativeAgentUnsupportedAssetError` (`400 UNSUPPORTED_ASSET_KIND`), keeping `crelune-dev-member-photos` strictly read-only.
