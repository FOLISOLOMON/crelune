# CRELUNE — Milestone 5, Stage 5.5.3: Fail-Closed Workspace Creation Fallback

**Milestone:** 5 — Templates & Affinity Integration  
**Stage:** 5.5.3 — Local Workspace Atomicity Hardening  
**Baseline Commit:** `d4dc576a87b9924b432ce1491d3bb472f1ce304d`  
**Status:** Completed & Verified (`@crelune/agent` tests, monorepo type-check, lint, build & `doctor`)  
**Date:** 2026-11-23

---

## 1. Finding Closed

In Stage 5.5.2, `createFileExclusivelyAtomic()` in [`apps/agent/src/workspace/job-workspace.ts`](file:///d:/Projects/Crelune/apps/agent/src/workspace/job-workspace.ts) fell back to `fs.open(targetPath, 'wx')` followed by writing bytes when `fs.link()` failed with `EXDEV`, `ENOTSUP`, or `ENOSYS`. Although `'wx'` prevented overwriting an existing file, creating the target path before finishing the write made an incomplete target temporarily visible to concurrent preparations, which could encounter `EEXIST`, read partial bytes, and misclassify the working copy as `PRESERVED_WITH_ARTIST_EDITS`.

---

## 2. Correction Implemented

1. **Removed Unsafe Direct-Create Fallback (`createFileExclusivelyAtomic`)**:
   - Retains the atomic two-phase pipeline: stage 100% of bytes into a unique temp file inside `working/tmp/` (`open(..., 'wx', 0o600)` + `sync()` + `close()`), then publish atomically via `fs.link(stagedPath, targetPath)`.
   - Completely eliminates the `fs.open(targetPath, 'wx')` + write fallback; `targetPath` is never opened for direct writing under any failure path.
2. **Fail-Closed Typed Error (`AgentWorkspaceError`)**:
   - Exported `AgentWorkspaceError` (`code: 'ATOMIC_PUBLICATION_UNSUPPORTED' | 'ATOMIC_PUBLICATION_FAILED'`, `targetPath`, `errnoCode`, `cause`) from [`job-workspace.ts`](file:///d:/Projects/Crelune/apps/agent/src/workspace/job-workspace.ts) (re-exported via [`index.ts`](file:///d:/Projects/Crelune/apps/agent/src/index.ts)).
   - When hard-link (or atomic rename) publication fails with `EXDEV`, `ENOTSUP`, `ENOSYS`, or `EOPNOTSUPP`, throws `AgentWorkspaceError` (`code: 'ATOMIC_PUBLICATION_UNSUPPORTED'`) with an actionable message (free of local filesystem paths or secrets) instructing placement on a hard-link-capable local filesystem (such as NTFS). Any other non-`EEXIST` link error also fails closed (`code: 'ATOMIC_PUBLICATION_FAILED'`) without fallback.
3. **Guaranteed Staging Cleanup & Preservation**:
   - Both `stageUniqueTempFile()` (including `writeFile`/`close` failures) and `createFileExclusivelyAtomic()` (`finally` via `safeUnlinkTempFile()` with bounded Windows `EPERM`/`EBUSY` retries) delete temporary staging files on every success and failure path.
   - Existing working copies (including artist edits), source masters, and `exports/` remain untouched on hard-link failure.
   - Path-traversal, symlink, and Windows directory-junction checks (`assertNotSymlinkIfExists` / `AgentPathSecurityError`) remain enforced before staging and before atomic link/rename publication.

---

## 3. Verification Evidence

| Check | Command | Result |
|---|---|---|
| Agent tests (incl. unsupported hard-link, cleanup, preservation, explicit approval, NTFS hard links, concurrent staging barrier, live DPAPI & Affinity `3.3.3.5004`) | `npm test --workspace=@crelune/agent` | **PASS** — `1` file, `15/15` passed (`5.70s`) |
| Monorepo TypeScript check (5 workspaces) | `npm run type-check` | **PASS** — `0` errors |
| ESLint | `npm run lint` | **PASS** — `0` warnings, `0` errors |
| Production build (5 workspaces) | `npm run build` | **PASS** — `@crelune/agent`, Next.js `15.5.29` `@crelune/web`, `@crelune/database`, `@crelune/shared`, `@crelune/ui` |
| Agent CLI doctor smoke check | `node apps/agent/dist/cli.js doctor` | **PASS** — Affinity `3.3.3.5004`, WindowsApps alias, DPAPI store, `ScriptingEnabled=false`, `mcpServerEnabled=false` |
