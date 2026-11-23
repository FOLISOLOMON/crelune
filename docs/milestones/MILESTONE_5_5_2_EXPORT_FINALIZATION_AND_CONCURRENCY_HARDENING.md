# CRELUNE — Milestone 5, Stage 5.5.2: Export Finalization Fencing & Concurrency Hardening

**Milestone:** 5 — Templates & Affinity Integration  
**Stage:** 5.5.2 — Concurrency & Data-Integrity Hardening  
**Baseline Commit:** `b63886654f74485c536001ce42e7c20ed9ea293d`  
**Status:** Completed & Verified against Neon `development` (`br-nameless-silence-bexjp44k`), `crelune-dev-creative`, Windows 11 DPAPI & Affinity `3.3.3.5004`  
**Date:** 2026-11-23

---

## 1. Finding A — Atomic Export Finalization Claim Revalidation & Global Lock Order

### Root Cause Closed
Previously, `completeAgentExportUpload()` verified claim ownership in a preflight transaction before calling `completeExportDeliverableUpload()`, leaving a TOCTOU window during off-transaction S3 object retrieval and binary validation where a lease could expire, rotate to another worker, or have its agent revoked before the final database transaction committed the `ExportRecord` and marked the dispatch `EXPORTED`.

### Solution
- **Canonical Deadlock-Free Lock Order (Strict DAG)**: Enforced consistently across `revokeCreativeAgent`, `claimNextCreativeDispatch`, `updateAgentDispatchStatus`, `renewAgentDispatchLease`, `createAgentExportUploadIntent`, `completeExportDeliverableUpload`, `recoverCreativeJobDispatch`, and `cancelCreativeJobDispatch`:
  1. **L0 — `creative_agents`**: `FOR UPDATE` on revocation; `FOR SHARE` on agent claim, status, lease renewal, upload intent, and export finalization.
  2. **L1 — `design_jobs`**: `FOR UPDATE` (ordered by `id ASC` when multiple rows are locked), matching the Stage 5.1.2 `BEFORE UPDATE OF status` trigger on `creative_job_dispatches` so trigger locks never invert row-lock order.
  3. **L2 — `creative_job_dispatches`**: `FOR UPDATE` (or `FOR UPDATE OF j, d SKIP LOCKED` in `claimNextCreativeDispatch`).
  4. **L3 — `creative_upload_intents`**: atomic conditional `PENDING -> VERIFIED` update.
- **Final Transactional Verification ([`job-preparation-service.ts`](file:///d:/Projects/Crelune/apps/web/src/lib/designs/job-preparation-service.ts))**:
  - S3 download, byte-size/SHA-256 verification, and `sharp`/PDF binary validation remain strictly **outside** the database transaction.
  - Inside the final atomic transaction (`L0 -> L1 -> L2 -> L3`), `completeExportDeliverableUpload()` independently revalidates:
    1. Agent is still `ACTIVE` with `revoked_at IS NULL` under `L0 FOR SHARE` (`CreativeAgentRevokedError` -> `401`).
    2. Parent `DesignJob` and target `CreativeJobDispatch` match `organisationId` and `designJobId` under `L1 -> L2 FOR UPDATE`.
    3. Dispatch is still assigned to `agentId`, `claimTokenHash` exists, and `claimToken` matches `claimTokenHash` in constant time (`crypto.timingSafeEqual`).
    4. Dispatch is in an exportable state (`CLAIMED`, `DOWNLOADING_ASSETS`, `OPENING_TEMPLATE`, `READY_FOR_ARTIST`, `EXPORTING`) and `leaseExpiresAt > finalNow` — OR exact winning-claim idempotent replay when already `EXPORTED` with matching `claimTokenHash` and matching existing `ExportRecord(uploadIntentId, dispatchId, uploadedByAgentId)`.
  - Duplicate concurrent export finalizations serialize on `L1 -> L2` and create **strictly ONE** `ExportRecord` (winner returns `idempotentReplay: false`, concurrent duplicate returns `idempotentReplay: true`).

---

## 2. Finding B — Concurrency-Safe Owner Recovery

Hardened [`recoverCreativeJobDispatch()`](file:///d:/Projects/Crelune/apps/web/src/lib/designs/job-preparation-service.ts):
1. Acquires `L1 (design_jobs FOR UPDATE)` followed by `L2 (creative_job_dispatches FOR UPDATE)` and re-reads the dispatch row with `assignedAgent` strictly AFTER acquiring locks.
2. Enforces explicit eligibility rules:
   - Terminal states (`EXPORTED`, `FAILED`, `CANCELLED`) -> `409 INVALID_DISPATCH_TRANSITION`.
   - Already `QUEUED` -> `409 DISPATCH_NOT_ELIGIBLE_FOR_RECOVERY` (ensuring strictly ONE concurrent owner recovery wins).
   - Active valid agent lease (`leaseExpiresAt > now` and agent not revoked) -> `409 DISPATCH_ACTIVE_LEASE_PROTECTED` (owner recovery can never silently interrupt an active agent lease).
   - Non-`READY_FOR_ARTIST` processing states (`CLAIMED`, `DOWNLOADING_ASSETS`, `OPENING_TEMPLATE`, `EXPORTING`) -> `409 DISPATCH_NOT_ELIGIBLE_FOR_RECOVERY` (auto-recovered by agents on expiry).
   - Eligible ONLY when `status === 'READY_FOR_ARTIST'` AND (`agentIsRevoked` OR lease expired) AND `confirmPreserveLocalWork === true`.
3. Atomically clears `assignedAgentId`, `claimTokenHash`, `leaseExpiresAt`, `readyForArtistAt`, `errorCode`, `errorMessage`, sets `status = 'QUEUED'`, and records `CREATIVE_DISPATCH_RECOVERED` in the same transaction.
4. Concurrent `renewAgentDispatchLease` vs `recoverCreativeJobDispatch` serialize cleanly on `L1 -> L2` with zero deadlocks and deterministic ownership.

---

## 3. Finding C — Atomic Exclusive Local Workspace Creation

Hardened [`prepareIsolatedJobWorkspace()`](file:///d:/Projects/Crelune/apps/agent/src/workspace/job-workspace.ts):
- Replaced check-then-write patterns for both `source/` masters and `working/` copies with `createFileExclusivelyAtomic()`:
  1. Stages 100% of bytes into a unique per-operation temp file inside `working/tmp/` via `fs.open(..., 'wx')`.
  2. Publishes atomically via `fs.link(stagedTemp, targetPath)` (atomic NTFS/POSIX kernel creation failing with `EEXIST` without ever exposing partial writes; `EXDEV`/`ENOTSUP` falls back strictly to `fs.open(targetPath, 'wx')`, NEVER unconditional `writeFile()`).
  3. On `EEXIST`, preserves the existing working copy untouched even when its hash differs from the master (`PRESERVED_WITH_ARTIST_EDITS`), while verifying the `source/` master independently.
- Upgraded `manifest.json`, `PREPARATION_GUIDE.txt`, and updated assets to `writeFileAtomicReplace()` (unique `'wx'` temp file + `fs.rename()`), preventing concurrent truncation or interleaving.
- Restricted destructive working-copy replacement to the designated explicit approval payload (`explicitWorkingCopyReplacementApproval: { approvedByUser: true, confirmationToken: 'CONFIRM_REPLACE_WORKING_COPY', reason }`), logging `WORKING_COPY_EXPLICITLY_REPLACED`.
- Preserved existing `exports/` and all path-traversal, symlink, and Windows directory-junction containment checks.
