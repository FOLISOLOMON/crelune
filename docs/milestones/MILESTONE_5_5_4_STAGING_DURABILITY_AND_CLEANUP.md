# CRELUNE — Milestone 5, Stage 5.5.4: Staging Durability & Cleanup Failure Handling

**Milestone:** 5 — Templates & Affinity Integration  
**Stage:** 5.5.4 — Staging Durability & Cleanup Error Surfacing  
**Baseline Commit:** `e5b2f9989bfd3bb640a23866bf616669444b8cef`  
**Status:** Completed & Verified (`@crelune/agent` tests, monorepo type-check, lint, build & `doctor`)  
**Date:** 2026-11-23

---

## 1. Findings Closed

Two silent error-handling gaps remained in [`apps/agent/src/workspace/job-workspace.ts`](file:///d:/Projects/Crelune/apps/agent/src/workspace/job-workspace.ts) after Stage 5.5.3:
1. `safeUnlinkTempFile()` silently returned after exhausting retries on transient Windows file locks (`EPERM`, `EBUSY`, `EACCES`) or other unlink errors, allowing operations to report success even when a temporary staging file remained inside `working/tmp/`.
2. `stageUniqueTempFile()` swallowed durability synchronization failures (`handle.sync().catch(() => {})`) and handle close failures on error paths, allowing unsynced files to be published and hiding secondary cleanup errors.

---

## 2. Corrections Implemented

1. **Explicit Cleanup Failure Surfacing (`safeUnlinkTempFile`)**:
   - Retains bounded retries (up to `4` attempts with linear backoff `20ms`, `40ms`, `60ms`) for transient Windows lock errors (`EPERM`, `EBUSY`, `EACCES`), fails immediately after `1` attempt on non-transient errors (e.g. `EIO`, `EROFS`), and treats `ENOENT` as clean removal (`{ removed: true, alreadyMissing: true, attempts }`).
   - On retry exhaustion or non-transient failure, throws a typed `AgentWorkspaceError` containing `code`, `errnoCode`, `targetPath`, `stagedPath`, `targetPublished`, `attempts`, `cause`, and `cleanupError` (keeping `message` free of secrets and absolute workstation paths).
   - **Post-publication distinction:** When atomic hard-link publication already succeeded (`created === true`) and removal of the temporary staging hard link fails, throws `AgentWorkspaceError` with `code: 'STAGING_LINK_CLEANUP_FAILED_AFTER_PUBLICATION'` and `targetPublished: true`, explicitly stating that the published target remains intact rather than misleadingly claiming publication failed. When an existing target was preserved (`EEXIST`) and removing the unused staging file fails, throws `STAGING_CLEANUP_FAILED` (`targetPublished: false`).
2. **Mandatory Staging Durability Sync & Non-Lossy Error Preservation (`stageUniqueTempFile`)**:
   - Removed `.catch(() => {})` on `handle.sync()`. A sync failure immediately aborts staging, never publishes the staged file, safely closes the open file handle (without double-closing if `close()` itself failed), attempts staged-file cleanup via `safeUnlinkTempFile()`, and throws `AgentWorkspaceError` (`code: 'STAGING_SYNC_FAILED'`, `targetPublished: false`) preserving the original `cause`, any `closeError`, and any `cleanupError` without losing any error.
   - Write and close failures follow the same fail-closed path (`code: 'STAGING_WRITE_FAILED'`, `targetPublished: false`), preserving `cause`, `closeError`, and `cleanupError`.
3. **Full Audit Across All Workspace Write & Replacement Paths**:
   - Wired `WorkspaceAtomicPublicationOps` (`openFile`, `linkFile`, `renameFile`, `unlinkFile`, `sleep`, `beforeAtomicLink`) consistently across `stageUniqueTempFile()`, `createFileExclusivelyAtomic()`, and `writeFileAtomicReplace()`, covering source masters, working copies, explicit working-copy replacement, asset staging/updates, `manifest.json`, and `PREPARATION_GUIDE.txt`.
   - Replaced bare `finally` cleanup in `createFileExclusivelyAtomic()` and `writeFileAtomicReplace()` with `preservePrimaryAndCleanupError()` so secondary cleanup errors never overwrite primary publication or `AgentPathSecurityError` failures, and vice versa.
   - Preserved zero direct-write fallbacks, existing working copies, source masters, exports, and symlink/junction containment.

---

## 3. Actual Guarantees & Honest Limitations

- **Verified guarantees:**
  - Unsynced or partially written staging files are never linked or renamed to any final workspace target.
  - Failed staging writes, syncs, closes, atomic links, atomic renames, and retry-exhausted temporary-file deletions are surfaced explicitly via typed errors without losing primary, close, or cleanup diagnostics.
  - Post-publication staging-link cleanup failures explicitly set `targetPublished: true` (`STAGING_LINK_CLEANUP_FAILED_AFTER_PUBLICATION`) so callers know the published target is intact.
  - Existing working copies (including artist edits), source masters, and `exports/` are never overwritten or deleted when staging, sync, rename, or cleanup fails.
- **OS-level limitations:**
  - Temporary file deletion cannot be guaranteed if the operating system, filesystem permissions, or an external process (such as antivirus real-time scanning) persistently refuses `unlink()` past retry exhaustion; in that case the leftover staging artifact remains in `working/tmp/` until locks clear and the agent surfaces `STAGING_CLEANUP_FAILED` or `STAGING_LINK_CLEANUP_FAILED_AFTER_PUBLICATION` instead of falsely reporting clean completion.
  - File data durability relies on `handle.sync()` (`FlushFileBuffers` on Windows); portable directory-entry `fsync` is not available uniformly across Windows NTFS handles.

---

## 4. Verification Results

| Check | Exact Command | Result |
|---|---|---|
| Agent unit, durability, cleanup, concurrency, live DPAPI & Affinity tests | `npm test --workspace=@crelune/agent` | **PASS** — `1` file, `17/17` passed (`4.23s` tests, `5.42s` total) |
| Monorepo TypeScript type-check (5 workspaces) | `npm run type-check` | **PASS** — `0` errors |
| ESLint | `npm run lint` | **PASS** — `0` warnings, `0` errors |
| Production build (5 workspaces) | `npm run build` | **PASS** — `@crelune/agent`, Next.js `15.5.29` `@crelune/web`, `@crelune/database`, `@crelune/shared`, `@crelune/ui` |
| Agent CLI doctor smoke check | `node apps/agent/dist/cli.js doctor` | **PASS** — Affinity `3.3.3.5004`, WindowsApps alias, DPAPI store, `ScriptingEnabled=false`, `mcpServerEnabled=false` |

No database or object storage writes occurred; Neon `development` (`br-nameless-silence-bexjp44k`), Neon `production` (`br-withered-moon-be8coj8h`), and `crelune-dev-member-photos` remain untouched.
