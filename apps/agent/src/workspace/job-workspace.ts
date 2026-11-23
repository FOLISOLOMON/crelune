/**
 * CRELUNE Windows Creative Agent — Isolated Per-Job Workspace Manager
 *
 * Materializes isolated job workspaces strictly inside:
 *   `<workspaceRoot>/jobs/<jobId>/{source,working,assets,exports,logs}/`
 *
 * Stage 5.5.2–5.5.4 Fail-Closed Atomic, Durable & Preservation-First Safety Invariants:
 * - New source masters (`source/`) and new working copies (`working/`) are created
 *   atomically via exclusive staged file creation (`open(..., 'wx', 0o600)` inside
 *   `working/tmp/`), mandatory durability sync (`handle.sync()`), safe handle close,
 *   and atomic hard-link publication (`fs.link()`).
 *   If another process creates the file first (`EEXIST`), the existing file is
 *   preserved untouched. If staging sync fails, the target is NEVER published.
 *   If the filesystem does not support atomic hard-link publication (`EXDEV`,
 *   `ENOTSUP`, `ENOSYS`, `EOPNOTSUPP`), creation FAILS CLOSED with a typed
 *   `AgentWorkspaceError` — NEVER falling back to direct creation (`open(targetPath,
 *   'wx')` + write) or unconditional `writeFile()`.
 * - Temporary staging cleanup (`safeUnlinkTempFile`) retries bounded transient
 *   Windows `EPERM`/`EBUSY`/`EACCES` locks, treats `ENOENT` as clean removal, and
 *   surfaces typed cleanup errors on retry exhaustion without losing primary errors
 *   or misleadingly reporting an already-published target as unpublished.
 * - Existing working copies are preserved even when their SHA-256 differs from the
 *   source master (legitimate artist edits are never treated as corrupted masters).
 * - Destructive replacement of an existing working copy is impossible through
 *   default preparation and requires the explicit `explicitWorkingCopyReplacementApproval`
 *   payload (`approvedByUser: true`, `confirmationToken: 'CONFIRM_REPLACE_WORKING_COPY'`,
 *   non-empty `reason`), writing via unique temp file + atomic rename.
 * - Manifest, preparation guide, and updated asset writes use unique per-operation
 *   temp files (`open(..., 'wx')`) + atomic `rename()` so concurrent writers never
 *   produce truncated or interleaved files.
 * - Existing files inside `exports/` are NEVER modified or deleted.
 * - Symlink and junction containment is enforced on every resolved path.
 */

import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  CREATIVE_BYTE_LIMITS,
  jobPrepManifestSchema,
  type CreativeExecutionMode,
  type JobPrepManifest,
} from '@crelune/shared';
import {
  AgentPathSecurityError,
  assertNotSymlinkIfExists,
  assertSafeAgentIdentifier,
  assertSafeBasename,
  assertSafeRelativeManifestPath,
  resolveStrictlyWithinRoot,
} from '../security/path-safety.js';
import { sanitizeLogMeta } from '../security/logger.js';

export type AgentWorkspaceErrorCode =
  | 'ATOMIC_PUBLICATION_UNSUPPORTED'
  | 'ATOMIC_PUBLICATION_FAILED'
  | 'STAGING_SYNC_FAILED'
  | 'STAGING_WRITE_FAILED'
  | 'STAGING_CLEANUP_FAILED'
  | 'STAGING_LINK_CLEANUP_FAILED_AFTER_PUBLICATION';

const UNSUPPORTED_ATOMIC_PUBLICATION_ERRNO_CODES = new Set([
  'EXDEV',
  'ENOTSUP',
  'ENOSYS',
  'EOPNOTSUPP',
]);

const TRANSIENT_FS_LOCK_ERRNO_CODES = new Set(['EPERM', 'EBUSY', 'EACCES']);
const DEFAULT_UNLINK_MAX_ATTEMPTS = 4;
const DEFAULT_RENAME_MAX_ATTEMPTS = 4;

export class AgentWorkspaceError extends Error {
  public readonly code: AgentWorkspaceErrorCode;
  public readonly targetPath: string;
  public readonly stagedPath?: string;
  public readonly errnoCode?: string;
  public readonly targetPublished: boolean;
  public readonly attempts?: number;
  public readonly closeError?: unknown;
  public readonly cleanupError?: unknown;

  constructor(params: {
    code: AgentWorkspaceErrorCode;
    message: string;
    targetPath: string;
    stagedPath?: string;
    errnoCode?: string;
    targetPublished?: boolean;
    attempts?: number;
    cause?: unknown;
    closeError?: unknown;
    cleanupError?: unknown;
  }) {
    super(
      params.message,
      params.cause !== undefined ? { cause: params.cause } : undefined
    );
    this.name = 'AgentWorkspaceError';
    this.code = params.code;
    this.targetPath = params.targetPath;
    this.stagedPath = params.stagedPath;
    this.errnoCode = params.errnoCode;
    this.targetPublished = params.targetPublished ?? false;
    this.attempts = params.attempts;
    this.closeError = params.closeError;
    this.cleanupError = params.cleanupError;
  }
}

export interface WorkspaceStagingFileHandle {
  writeFile(data: Uint8Array | string): Promise<void>;
  sync(): Promise<void>;
  close(): Promise<void>;
}

export interface WorkspaceAtomicPublicationOps {
  /**
   * Optional override for `fs.open` used in deterministic staging write/sync/close tests.
   */
  openFile?: (
    filePath: string,
    flags: string,
    mode?: number
  ) => Promise<WorkspaceStagingFileHandle>;
  /**
   * Optional override for `fs.link` used in tests to deterministically simulate
   * filesystems without hard-link support (`EXDEV`, `ENOTSUP`, `ENOSYS`, `EOPNOTSUPP`).
   */
  linkFile?: (existingPath: string, newPath: string) => Promise<void>;
  /**
   * Optional override for `fs.rename` used in deterministic atomic-replace failure tests.
   */
  renameFile?: (oldPath: string, newPath: string) => Promise<void>;
  /**
   * Optional override for `fs.unlink` used in deterministic staging cleanup failure tests.
   */
  unlinkFile?: (filePath: string) => Promise<void>;
  /**
   * Optional override for bounded retry backoff sleeps in deterministic tests.
   */
  sleep?: (ms: number) => Promise<void>;
  /**
   * Optional hook invoked after staging 100% of bytes in `working/tmp/` and
   * immediately before atomic hard-link publication at `targetPath`.
   */
  beforeAtomicLink?: (params: {
    stagedPath: string;
    targetPath: string;
  }) => Promise<void>;
}

export type WorkingCopyPreparationStatus =
  | 'CREATED'
  | 'PRESERVED_UNCHANGED'
  | 'PRESERVED_WITH_ARTIST_EDITS'
  | 'REPLACED_BY_EXPLICIT_USER_ACTION';

export const WORKING_COPY_REPLACEMENT_CONFIRMATION_TOKEN =
  'CONFIRM_REPLACE_WORKING_COPY' as const;

export interface ExplicitWorkingCopyReplacementApproval {
  approvedByUser: true;
  confirmationToken: typeof WORKING_COPY_REPLACEMENT_CONFIRMATION_TOKEN;
  reason: string;
}

export interface MaterializedJobWorkspace {
  jobId: string;
  dispatchId: string;
  jobDir: string;
  sourceDir: string;
  workingDir: string;
  tempDir: string;
  assetsDir: string;
  exportsDir: string;
  logsDir: string;
  manifestPath: string;
  guidePath: string;
  eventLogPath: string;
  masterSourcePath: string;
  workingCopyPath: string;
  masterSha256: string;
  masterVerified: boolean;
  workingCopySha256: string;
  workingCopyStatus: WorkingCopyPreparationStatus;
  preservedExistingWorkingCopy: boolean;
  preservedExistingExports: string[];
  downloadedAssets: Array<{
    assetId: string;
    relativeFilename: string;
    localPath: string;
    sha256: string;
    byteSize: number;
  }>;
}

export interface WorkspaceEventRecord {
  timestamp: string;
  event: string;
  executionMode?: CreativeExecutionMode;
  details?: Record<string, unknown>;
}

export function computeSha256Hex(bytes: Uint8Array): string {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

export async function computeFileSha256Hex(filePath: string): Promise<string> {
  assertNotSymlinkIfExists(filePath);
  const bytes = await fs.readFile(filePath);
  return computeSha256Hex(bytes);
}

async function listRegularFilesSafe(dirPath: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name)
      .sort();
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') {
      return [];
    }
    throw err;
  }
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface TempCleanupResult {
  removed: true;
  alreadyMissing: boolean;
  attempts: number;
}

/**
 * Removes a temporary staging file with bounded retries for transient Windows
 * file locks (`EPERM`, `EBUSY`, `EACCES`). Treats `ENOENT` as successful cleanup.
 *
 * Stage 5.5.4: Never silently ignores cleanup failures after retry exhaustion.
 * Surfaces a typed `AgentWorkspaceError` distinguishing post-publication
 * staging-link cleanup failure (`targetPublished: true`) from pre-publication
 * or unused staging cleanup failure (`targetPublished: false`).
 */
export async function safeUnlinkTempFile(
  tempPath: string,
  ops?: Pick<WorkspaceAtomicPublicationOps, 'unlinkFile' | 'sleep'> & {
    targetPath?: string;
    targetPublished?: boolean;
  }
): Promise<TempCleanupResult> {
  const unlinkFn = ops?.unlinkFile ?? fs.unlink;
  const sleepFn = ops?.sleep ?? defaultSleep;

  let lastErr: unknown;
  let lastErrno: string | undefined;
  let attemptsExecuted = 0;

  for (let attempt = 1; attempt <= DEFAULT_UNLINK_MAX_ATTEMPTS; attempt++) {
    attemptsExecuted = attempt;
    try {
      await unlinkFn(tempPath);
      return { removed: true, alreadyMissing: false, attempts: attempt };
    } catch (err) {
      const code = (err as NodeJS.ErrnoException)?.code;
      if (code === 'ENOENT') {
        return { removed: true, alreadyMissing: true, attempts: attempt };
      }
      lastErr = err;
      lastErrno = code;
      if (
        code &&
        TRANSIENT_FS_LOCK_ERRNO_CODES.has(code) &&
        attempt < DEFAULT_UNLINK_MAX_ATTEMPTS
      ) {
        await sleepFn(20 * attempt);
        continue;
      }
      break;
    }
  }

  const targetPublished = ops?.targetPublished ?? false;
  throw new AgentWorkspaceError({
    code: targetPublished
      ? 'STAGING_LINK_CLEANUP_FAILED_AFTER_PUBLICATION'
      : 'STAGING_CLEANUP_FAILED',
    targetPath: ops?.targetPath ?? tempPath,
    stagedPath: tempPath,
    errnoCode: lastErrno,
    targetPublished,
    attempts: attemptsExecuted,
    cause: lastErr,
    cleanupError: lastErr,
    message: targetPublished
      ? `Target file was published atomically and remains intact, but removing the temporary staging hard link failed${lastErrno ? ` (${lastErrno})` : ''} after ${attemptsExecuted} attempt(s). A leftover staging hard link may remain in working/tmp until file locks clear.`
      : `Failed to remove temporary staging file${lastErrno ? ` (${lastErrno})` : ''} after ${attemptsExecuted} attempt(s). A leftover staging artifact may remain in working/tmp.`,
  });
}

function preservePrimaryAndCleanupError(params: {
  primaryError: unknown;
  cleanupError: unknown;
  targetPath: string;
  stagedPath: string;
}): Error {
  const { primaryError, cleanupError, targetPath, stagedPath } = params;
  const cleanupErrno =
    cleanupError instanceof AgentWorkspaceError
      ? cleanupError.errnoCode
      : (cleanupError as NodeJS.ErrnoException)?.code;
  const cleanupNote = `Removing the temporary staging file also failed${cleanupErrno ? ` (${cleanupErrno})` : ''}; a leftover staging artifact may remain in working/tmp.`;

  if (primaryError instanceof AgentWorkspaceError) {
    return new AgentWorkspaceError({
      code: primaryError.code,
      targetPath: primaryError.targetPath,
      stagedPath: primaryError.stagedPath ?? stagedPath,
      errnoCode: primaryError.errnoCode,
      targetPublished: primaryError.targetPublished,
      attempts: primaryError.attempts,
      cause: primaryError.cause ?? primaryError,
      closeError: primaryError.closeError,
      cleanupError,
      message: `${primaryError.message} ${cleanupNote}`,
    });
  }

  if (primaryError instanceof AgentPathSecurityError) {
    const errWithCleanup = new AgentPathSecurityError(
      `${primaryError.message} ${cleanupNote}`
    ) as AgentPathSecurityError & {
      cause?: unknown;
      cleanupError?: unknown;
      stagedPath?: string;
    };
    errWithCleanup.cause = primaryError;
    errWithCleanup.cleanupError = cleanupError;
    errWithCleanup.stagedPath = stagedPath;
    return errWithCleanup;
  }

  const primaryErrno = (primaryError as NodeJS.ErrnoException)?.code;
  return new AgentWorkspaceError({
    code: 'ATOMIC_PUBLICATION_FAILED',
    targetPath,
    stagedPath,
    errnoCode: primaryErrno,
    targetPublished: false,
    cause: primaryError,
    cleanupError,
    message: `Atomic workspace operation failed${primaryErrno ? ` (${primaryErrno})` : ''}; target file was NOT published. ${cleanupNote}`,
  });
}

/**
 * Writes full content into a unique temporary file inside `tempDir` using
 * OS-atomic exclusive creation (`open(..., 'wx', 0o600)`), enforces durability
 * synchronization (`handle.sync()`), and closes the file handle before returning.
 *
 * Stage 5.5.4: Sync failures are treated as staging failures (never ignored and
 * never published). On any write, sync, or close error, closes the handle safely,
 * attempts staged-file cleanup, and preserves primary, close, and cleanup errors.
 */
async function stageUniqueTempFile(
  tempDir: string,
  targetPath: string,
  bytes: Uint8Array | string,
  ops?: WorkspaceAtomicPublicationOps
): Promise<string> {
  assertNotSymlinkIfExists(tempDir);
  const uniqueName = `.stage_${process.pid}_${crypto.randomUUID()}.tmp`;
  const tempPath = resolveStrictlyWithinRoot(tempDir, uniqueName);
  const openFn = ops?.openFile ?? fs.open;
  const handle = await openFn(tempPath, 'wx', 0o600);

  let phase: 'write' | 'sync' | 'close' = 'write';
  let closed = false;
  let primaryErr: unknown;

  try {
    phase = 'write';
    await handle.writeFile(bytes);

    phase = 'sync';
    await handle.sync();

    phase = 'close';
    await handle.close();
    closed = true;
    return tempPath;
  } catch (err) {
    primaryErr = err;
  }

  // Close safely if failure occurred before close() ran, without masking primaryErr
  let closeError: unknown;
  if (!closed && phase !== 'close') {
    try {
      await handle.close();
      closed = true;
    } catch (cErr) {
      closeError = cErr;
    }
  }

  // Attempt staged-file cleanup and preserve both primary error and cleanup failure
  let cleanupError: unknown;
  try {
    await safeUnlinkTempFile(tempPath, {
      unlinkFile: ops?.unlinkFile,
      sleep: ops?.sleep,
      targetPath,
      targetPublished: false,
    });
  } catch (uErr) {
    cleanupError = uErr;
  }

  const primaryErrno = (primaryErr as NodeJS.ErrnoException)?.code;
  const cleanupErrno =
    cleanupError instanceof AgentWorkspaceError
      ? cleanupError.errnoCode
      : (cleanupError as NodeJS.ErrnoException)?.code;
  const isSyncFailure = phase === 'sync';
  const baseMessage = isSyncFailure
    ? `Staging file durability synchronization failed${primaryErrno ? ` (${primaryErrno})` : ''}; target file was NOT published.`
    : `Staging file ${phase} failed${primaryErrno ? ` (${primaryErrno})` : ''}; target file was NOT published.`;

  const extraNotes: string[] = [];
  if (closeError) {
    const closeErrno = (closeError as NodeJS.ErrnoException)?.code;
    extraNotes.push(
      `Closing the staging handle also failed${closeErrno ? ` (${closeErrno})` : ''}.`
    );
  }
  if (cleanupError) {
    extraNotes.push(
      `Removing the temporary staging file also failed${cleanupErrno ? ` (${cleanupErrno})` : ''}; a leftover staging artifact may remain in working/tmp.`
    );
  }

  throw new AgentWorkspaceError({
    code: isSyncFailure ? 'STAGING_SYNC_FAILED' : 'STAGING_WRITE_FAILED',
    targetPath,
    stagedPath: tempPath,
    errnoCode: primaryErrno,
    targetPublished: false,
    cause: primaryErr,
    closeError,
    cleanupError,
    message:
      extraNotes.length > 0
        ? `${baseMessage} ${extraNotes.join(' ')}`
        : baseMessage,
  });
}

/**
 * Atomically creates `targetPath` ONLY if it does not already exist.
 *
 * Fail-closed durable publication strategy (Stages 5.5.3–5.5.4):
 * 1. Stages 100% of `bytes` to a unique temp file inside `tempDir` via
 *    `open(..., 'wx', 0o600)`, enforces `handle.sync()`, and closes it so no
 *    concurrent reader can ever observe a partially written or unsynced file at
 *    `targetPath`.
 * 2. Publishes via atomic hard link `fs.link(stagedTemp, targetPath)`, which
 *    fails atomically with `EEXIST` on NTFS and POSIX when another process won
 *    or the file already exists.
 * 3. NEVER falls back to direct `fs.open(targetPath, 'wx')` + write or
 *    `writeFile(targetPath, ...)`. If the filesystem rejects hard links
 *    (`EXDEV`, `ENOTSUP`, `ENOSYS`, `EOPNOTSUPP`), fails closed with a typed
 *    `AgentWorkspaceError` (`code: 'ATOMIC_PUBLICATION_UNSUPPORTED'`).
 * 4. Surfaces cleanup failures explicitly:
 *    - If publication succeeded (`created: true`) and staging-link removal fails,
 *      throws `STAGING_LINK_CLEANUP_FAILED_AFTER_PUBLICATION` with `targetPublished: true`.
 *    - If target already existed (`EEXIST`) and unused staging removal fails,
 *      throws `STAGING_CLEANUP_FAILED` with `targetPublished: false`.
 *    - If publication failed and cleanup also fails, preserves BOTH errors.
 */
async function createFileExclusivelyAtomic(
  tempDir: string,
  targetPath: string,
  bytes: Uint8Array,
  ops?: WorkspaceAtomicPublicationOps
): Promise<{ created: boolean }> {
  assertNotSymlinkIfExists(targetPath);
  const stagedPath = await stageUniqueTempFile(tempDir, targetPath, bytes, ops);

  let created = false;
  let primaryError: unknown;

  try {
    if (ops?.beforeAtomicLink) {
      await ops.beforeAtomicLink({ stagedPath, targetPath });
    }
    assertNotSymlinkIfExists(targetPath);
    const linkFn = ops?.linkFile ?? fs.link;
    try {
      await linkFn(stagedPath, targetPath);
      created = true;
    } catch (linkErr) {
      if (
        linkErr instanceof AgentWorkspaceError ||
        linkErr instanceof AgentPathSecurityError
      ) {
        primaryError = linkErr;
      } else {
        const code = (linkErr as NodeJS.ErrnoException)?.code;
        if (code === 'EEXIST') {
          created = false;
        } else if (code && UNSUPPORTED_ATOMIC_PUBLICATION_ERRNO_CODES.has(code)) {
          primaryError = new AgentWorkspaceError({
            code: 'ATOMIC_PUBLICATION_UNSUPPORTED',
            targetPath,
            stagedPath,
            errnoCode: code,
            targetPublished: false,
            cause: linkErr,
            message: `Workspace filesystem does not support atomic hard-link publication (${code}). Refusing unsafe direct-write fallback to prevent publishing partially written creative files; move the CRELUNE workspace onto a local filesystem that supports hard links (such as NTFS).`,
          });
        } else {
          primaryError = new AgentWorkspaceError({
            code: 'ATOMIC_PUBLICATION_FAILED',
            targetPath,
            stagedPath,
            errnoCode: code,
            targetPublished: false,
            cause: linkErr,
            message: `Atomic hard-link publication failed${code ? ` (${code})` : ''}. Refusing unsafe direct-write fallback to prevent publishing partially written creative files.`,
          });
        }
      }
    }
  } catch (err) {
    primaryError = err;
  }

  if (primaryError !== undefined) {
    try {
      await safeUnlinkTempFile(stagedPath, {
        unlinkFile: ops?.unlinkFile,
        sleep: ops?.sleep,
        targetPath,
        targetPublished: false,
      });
    } catch (cleanupError) {
      throw preservePrimaryAndCleanupError({
        primaryError,
        cleanupError,
        targetPath,
        stagedPath,
      });
    }
    throw primaryError;
  }

  // Publication either succeeded (`created === true`) or target already existed (`EEXIST`).
  // Clean up the staging hard link / unused temp file and surface any retry-exhausted failure!
  await safeUnlinkTempFile(stagedPath, {
    unlinkFile: ops?.unlinkFile,
    sleep: ops?.sleep,
    targetPath,
    targetPublished: created,
  });

  return { created };
}

/**
 * Atomically replaces a target file (`manifest.json`, `PREPARATION_GUIDE.txt`,
 * updated assets, or explicitly user-approved working copy replacement) using
 * unique staged `'wx'` file (with mandatory `sync()`) + `fs.rename()` so
 * concurrent writers never interleave or truncate the target.
 */
async function writeFileAtomicReplace(
  tempDir: string,
  targetPath: string,
  content: Uint8Array | string,
  ops?: WorkspaceAtomicPublicationOps
): Promise<void> {
  assertNotSymlinkIfExists(targetPath);
  const stagedPath = await stageUniqueTempFile(tempDir, targetPath, content, ops);
  const renameFn = ops?.renameFile ?? fs.rename;
  const sleepFn = ops?.sleep ?? defaultSleep;

  let primaryError: unknown;

  for (let attempt = 1; attempt <= DEFAULT_RENAME_MAX_ATTEMPTS; attempt++) {
    try {
      assertNotSymlinkIfExists(targetPath);
      await renameFn(stagedPath, targetPath);
      return;
    } catch (err) {
      if (
        err instanceof AgentWorkspaceError ||
        err instanceof AgentPathSecurityError
      ) {
        primaryError = err;
        break;
      }
      const code = (err as NodeJS.ErrnoException)?.code;
      if (code && UNSUPPORTED_ATOMIC_PUBLICATION_ERRNO_CODES.has(code)) {
        primaryError = new AgentWorkspaceError({
          code: 'ATOMIC_PUBLICATION_UNSUPPORTED',
          targetPath,
          stagedPath,
          errnoCode: code,
          targetPublished: false,
          cause: err,
          message: `Workspace filesystem does not support atomic rename publication (${code}). Refusing unsafe direct-write replacement to protect creative workspace files.`,
        });
        break;
      }
      if (
        code &&
        TRANSIENT_FS_LOCK_ERRNO_CODES.has(code) &&
        attempt < DEFAULT_RENAME_MAX_ATTEMPTS
      ) {
        await sleepFn(25 * attempt);
        continue;
      }
      primaryError = new AgentWorkspaceError({
        code: 'ATOMIC_PUBLICATION_FAILED',
        targetPath,
        stagedPath,
        errnoCode: code,
        targetPublished: false,
        attempts: attempt,
        cause: err,
        message: `Atomic rename publication failed${code ? ` (${code})` : ''} after ${attempt} attempt(s). Refusing unsafe direct-write replacement.`,
      });
      break;
    }
  }

  try {
    await safeUnlinkTempFile(stagedPath, {
      unlinkFile: ops?.unlinkFile,
      sleep: ops?.sleep,
      targetPath,
      targetPublished: false,
    });
  } catch (cleanupError) {
    throw preservePrimaryAndCleanupError({
      primaryError,
      cleanupError,
      targetPath,
      stagedPath,
    });
  }

  throw primaryError;
}

function isValidWorkingCopyReplacementApproval(
  approval?: ExplicitWorkingCopyReplacementApproval
): approval is ExplicitWorkingCopyReplacementApproval {
  return Boolean(
    approval &&
      approval.approvedByUser === true &&
      approval.confirmationToken === WORKING_COPY_REPLACEMENT_CONFIRMATION_TOKEN &&
      typeof approval.reason === 'string' &&
      approval.reason.trim().length >= 4
  );
}

function buildHumanPreparationGuide(
  manifest: JobPrepManifest,
  workingCopyRelative: string,
  workingCopyStatus: WorkingCopyPreparationStatus
): string {
  const lines: string[] = [
    'CRELUNE — Creative Job Preparation Guide',
    '========================================',
    `Design Job ID:     ${manifest.designJobId}`,
    `Dispatch ID:       ${manifest.dispatchId}`,
    `Title:             ${manifest.designJobTitle ?? manifest.designJobId}`,
    `Template:          ${manifest.templateName ?? manifest.templateId} (v${manifest.templateVersionNumber ?? '?'})`,
    `Format / Studio:   ${manifest.templateFormat} / ${manifest.templateStudioType}`,
    `Master SHA-256:    ${manifest.templateSha256}`,
    `Working Copy:      ${workingCopyRelative} (${workingCopyStatus})`,
    `Output Formats:    ${manifest.outputSpec.formats.join(', ')}`,
    `Dimensions:        ${manifest.outputSpec.dimensions ?? 'Per template canvas'}`,
    `Target Platform:   ${manifest.outputSpec.targetPlatform ?? 'General'}`,
    `Publication Rule:  ${manifest.publicationRule} (Exporting NEVER auto-publishes)`,
    '',
    'Mapped Layer Values:',
    '--------------------',
  ];

  if (manifest.fields.length === 0) {
    lines.push('  (No automated field mappings defined for this template version.)');
  } else {
    for (const f of manifest.fields) {
      const pathStr =
        f.layerPath && f.layerPath.length > 0 ? ` [${f.layerPath.join(' / ')}]` : '';
      const val = f.assetReference
        ? `ASSET (${f.assetReference.assetKind}) -> ${f.assetReference.suggestedRelativeFilename}`
        : f.textValue ?? '(Unresolved)';
      lines.push(`  - ${f.fieldKey} -> Layer "${f.targetLayerName}"${pathStr}: ${val}`);
    }
  }

  lines.push(
    '',
    'Instructions:',
    '-------------',
    '1. NEVER modify files inside source/. Always edit ONLY the copy in working/.',
    '2. Existing working copies are preserved atomically on retry/recovery and never overwritten without explicit confirmation.',
    '3. Export final PNG, JPEG, or PDF deliverables into exports/.',
    '4. Run `crelune-agent submit-export` or upload from CRELUNE Web to verify and attach deliverables.',
    '5. Publication remains an explicit owner confirmation in CRELUNE Web.'
  );

  return lines.join('\n') + '\n';
}

export async function appendWorkspaceEvent(
  eventLogPath: string,
  record: Omit<WorkspaceEventRecord, 'timestamp'>
): Promise<void> {
  assertNotSymlinkIfExists(eventLogPath);
  const line = JSON.stringify({
    timestamp: new Date().toISOString(),
    event: record.event,
    ...(record.executionMode ? { executionMode: record.executionMode } : {}),
    ...(record.details
      ? { details: sanitizeLogMeta(record.details) }
      : {}),
  });
  await fs.appendFile(eventLogPath, `${line}\n`, 'utf8');
}

export async function prepareIsolatedJobWorkspace(params: {
  workspaceRoot: string;
  rawManifest: unknown;
  templateBytes: Uint8Array;
  assets: Array<{
    assetId: string;
    relativeFilename: string;
    bytes: Uint8Array;
    expectedSha256?: string | null;
  }>;
  /**
   * Designated explicit user-approval gate required for any destructive
   * replacement of an existing working copy. Omitted in all normal & recovery flows.
   */
  explicitWorkingCopyReplacementApproval?: ExplicitWorkingCopyReplacementApproval;
  /**
   * Optional atomic publication overrides/hooks for deterministic testing.
   */
  atomicPublicationOps?: WorkspaceAtomicPublicationOps;
}): Promise<MaterializedJobWorkspace> {
  const manifest = jobPrepManifestSchema.parse(params.rawManifest);
  const safeJobId = assertSafeAgentIdentifier(manifest.designJobId, 'designJobId');
  const safeDispatchId = assertSafeAgentIdentifier(
    manifest.dispatchId,
    'dispatchId'
  );

  // Verify master template size & SHA-256 BEFORE touching workspace disk
  if (
    params.templateBytes.byteLength === 0 ||
    params.templateBytes.byteLength > CREATIVE_BYTE_LIMITS.TEMPLATE_MASTER_MAX_BYTES
  ) {
    throw new Error(
      `Downloaded template master byte size (${params.templateBytes.byteLength}) is out of permitted bounds.`
    );
  }
  const actualMasterSha = computeSha256Hex(params.templateBytes);
  if (actualMasterSha !== manifest.templateSha256) {
    throw new Error(
      `Template master SHA-256 mismatch! Expected ${manifest.templateSha256}, got ${actualMasterSha}.`
    );
  }

  const normalizedWorkspaceRoot = path.resolve(params.workspaceRoot);
  await fs.mkdir(normalizedWorkspaceRoot, { recursive: true });

  const jobDir = resolveStrictlyWithinRoot(
    normalizedWorkspaceRoot,
    'jobs',
    safeJobId
  );
  const sourceDir = resolveStrictlyWithinRoot(jobDir, 'source');
  const workingDir = resolveStrictlyWithinRoot(jobDir, 'working');
  const tempDir = resolveStrictlyWithinRoot(workingDir, 'tmp');
  const assetsDir = resolveStrictlyWithinRoot(jobDir, 'assets');
  const exportsDir = resolveStrictlyWithinRoot(jobDir, 'exports');
  const logsDir = resolveStrictlyWithinRoot(jobDir, 'logs');

  for (const dir of [
    jobDir,
    sourceDir,
    workingDir,
    tempDir,
    assetsDir,
    exportsDir,
    logsDir,
  ]) {
    await fs.mkdir(dir, { recursive: true });
    assertNotSymlinkIfExists(dir);
  }

  // Record existing exports BEFORE touching anything — NEVER overwrite or delete exports
  const preservedExistingExports = await listRegularFilesSafe(exportsDir);

  const templateRelSegments = assertSafeRelativeManifestPath(
    manifest.templateRelativeFilename
  );
  const templateLeafName = assertSafeBasename(
    templateRelSegments[templateRelSegments.length - 1]!,
    'template filename'
  );

  const masterSourcePath = resolveStrictlyWithinRoot(sourceDir, templateLeafName);
  assertNotSymlinkIfExists(masterSourcePath);

  const dotIdx = templateLeafName.lastIndexOf('.');
  const workingBase =
    dotIdx > 0 ? templateLeafName.slice(0, dotIdx) : templateLeafName;
  const workingExt = dotIdx > 0 ? templateLeafName.slice(dotIdx) : '';
  const workingLeafName = assertSafeBasename(
    `${workingBase}_${safeDispatchId}_working${workingExt}`,
    'working filename'
  );
  const workingCopyPath = resolveStrictlyWithinRoot(workingDir, workingLeafName);
  assertNotSymlinkIfExists(workingCopyPath);

  // 1. Atomic exclusive creation for source master (EEXIST -> preserve & verify SHA-256!)
  const masterCreate = await createFileExclusivelyAtomic(
    tempDir,
    masterSourcePath,
    params.templateBytes,
    params.atomicPublicationOps
  );
  if (masterCreate.created) {
    // Mark newly created source master read-only on disk to prevent accidental overwrite
    await fs.chmod(masterSourcePath, 0o444).catch(() => {});
  }

  // Independent source master verification (refuses corrupted existing master; NEVER overwrites!)
  const masterIntegrity = await verifyMasterTemplateIntegrity({
    masterSourcePath,
    expectedSha256: manifest.templateSha256,
  });
  if (!masterIntegrity.ok) {
    throw new Error(
      'Existing source master file in workspace does not match manifest SHA-256. Refusing to overwrite original.'
    );
  }

  // 2. Atomic exclusive creation for working copy (fail-closed if atomic link unsupported)
  const hasExplicitApproval = isValidWorkingCopyReplacementApproval(
    params.explicitWorkingCopyReplacementApproval
  );

  let workingCopyStatus: WorkingCopyPreparationStatus;
  let preservedExistingWorkingCopy = false;
  let workingCopySha256: string;

  const workingCreate = await createFileExclusivelyAtomic(
    tempDir,
    workingCopyPath,
    params.templateBytes,
    params.atomicPublicationOps
  );

  if (workingCreate.created) {
    workingCopySha256 = await computeFileSha256Hex(workingCopyPath);
    if (workingCopySha256 !== manifest.templateSha256) {
      throw new Error(
        'Working copy SHA-256 verification failed immediately after atomic creation.'
      );
    }
    workingCopyStatus = 'CREATED';
    preservedExistingWorkingCopy = false;
  } else if (hasExplicitApproval) {
    // Explicit user-approved destructive replacement via atomic staged rename
    await writeFileAtomicReplace(
      tempDir,
      workingCopyPath,
      params.templateBytes,
      params.atomicPublicationOps
    );
    workingCopySha256 = await computeFileSha256Hex(workingCopyPath);
    if (workingCopySha256 !== manifest.templateSha256) {
      throw new Error(
        'Working copy SHA-256 verification failed immediately after approved replacement.'
      );
    }
    workingCopyStatus = 'REPLACED_BY_EXPLICIT_USER_ACTION';
    preservedExistingWorkingCopy = false;
  } else {
    // EEXIST without explicit user approval -> ALWAYS preserve existing working copy!
    // Never fall back to unconditional writeFile().
    assertNotSymlinkIfExists(workingCopyPath);
    workingCopySha256 = await computeFileSha256Hex(workingCopyPath);
    preservedExistingWorkingCopy = true;
    workingCopyStatus =
      workingCopySha256 === manifest.templateSha256
        ? 'PRESERVED_UNCHANGED'
        : 'PRESERVED_WITH_ARTIST_EDITS';
  }

  // 3. Atomic exclusive / staged replacement for manifest-authorised assets
  const downloadedAssets: MaterializedJobWorkspace['downloadedAssets'] = [];
  for (const asset of params.assets) {
    if (
      asset.bytes.byteLength === 0 ||
      asset.bytes.byteLength > CREATIVE_BYTE_LIMITS.WORKING_ASSET_MAX_BYTES
    ) {
      throw new Error(
        `Asset "${asset.assetId}" byte size (${asset.bytes.byteLength}) exceeds limit.`
      );
    }
    const assetSha = computeSha256Hex(asset.bytes);
    if (asset.expectedSha256 && assetSha !== asset.expectedSha256.toLowerCase()) {
      throw new Error(
        `Asset "${asset.assetId}" SHA-256 mismatch! Expected ${asset.expectedSha256}, got ${assetSha}.`
      );
    }

    const assetRelSegments = assertSafeRelativeManifestPath(asset.relativeFilename);
    const assetLeaf = assertSafeBasename(
      assetRelSegments[assetRelSegments.length - 1]!,
      'asset filename'
    );
    const localAssetPath = resolveStrictlyWithinRoot(assetsDir, assetLeaf);
    assertNotSymlinkIfExists(localAssetPath);

    const assetCreate = await createFileExclusivelyAtomic(
      tempDir,
      localAssetPath,
      asset.bytes,
      params.atomicPublicationOps
    );
    if (!assetCreate.created) {
      const existingAssetSha = await computeFileSha256Hex(localAssetPath);
      if (existingAssetSha !== assetSha) {
        await writeFileAtomicReplace(
          tempDir,
          localAssetPath,
          asset.bytes,
          params.atomicPublicationOps
        );
      }
    }

    downloadedAssets.push({
      assetId: asset.assetId,
      relativeFilename: asset.relativeFilename,
      localPath: localAssetPath,
      sha256: assetSha,
      byteSize: asset.bytes.byteLength,
    });
  }

  const manifestPath = resolveStrictlyWithinRoot(jobDir, 'manifest.json');
  const guidePath = resolveStrictlyWithinRoot(jobDir, 'PREPARATION_GUIDE.txt');
  const eventLogPath = resolveStrictlyWithinRoot(logsDir, 'events.jsonl');
  assertNotSymlinkIfExists(manifestPath);
  assertNotSymlinkIfExists(guidePath);
  assertNotSymlinkIfExists(eventLogPath);

  // Atomic staged replace for metadata files prevents truncated/interleaved reads under concurrency
  await writeFileAtomicReplace(
    tempDir,
    manifestPath,
    JSON.stringify(manifest, null, 2),
    params.atomicPublicationOps
  );
  await writeFileAtomicReplace(
    tempDir,
    guidePath,
    buildHumanPreparationGuide(
      manifest,
      `working/${workingLeafName}`,
      workingCopyStatus
    ),
    params.atomicPublicationOps
  );

  if (preservedExistingWorkingCopy) {
    await appendWorkspaceEvent(eventLogPath, {
      event: 'EXISTING_WORKING_COPY_PRESERVED',
      details: {
        designJobId: safeJobId,
        dispatchId: safeDispatchId,
        workingCopyStatus,
        masterSha256Unchanged: true,
        artistEditsDetected: workingCopyStatus === 'PRESERVED_WITH_ARTIST_EDITS',
        preservedExportCount: preservedExistingExports.length,
      },
    });
  } else if (workingCopyStatus === 'REPLACED_BY_EXPLICIT_USER_ACTION') {
    await appendWorkspaceEvent(eventLogPath, {
      event: 'WORKING_COPY_EXPLICITLY_REPLACED',
      details: {
        designJobId: safeJobId,
        dispatchId: safeDispatchId,
        reason: params.explicitWorkingCopyReplacementApproval?.reason ?? '',
        masterSha256Unchanged: true,
      },
    });
  }

  await appendWorkspaceEvent(eventLogPath, {
    event: 'WORKSPACE_PREPARED',
    details: {
      designJobId: safeJobId,
      dispatchId: safeDispatchId,
      masterSha256: actualMasterSha,
      workingCopyStatus,
      preservedExistingWorkingCopy,
      preservedExportCount: preservedExistingExports.length,
      assetCount: downloadedAssets.length,
    },
  });

  return {
    jobId: safeJobId,
    dispatchId: safeDispatchId,
    jobDir,
    sourceDir,
    workingDir,
    tempDir,
    assetsDir,
    exportsDir,
    logsDir,
    manifestPath,
    guidePath,
    eventLogPath,
    masterSourcePath,
    workingCopyPath,
    masterSha256: actualMasterSha,
    masterVerified: true,
    workingCopySha256,
    workingCopyStatus,
    preservedExistingWorkingCopy,
    preservedExistingExports,
    downloadedAssets,
  };
}

export async function verifyMasterTemplateIntegrity(params: {
  masterSourcePath: string;
  expectedSha256: string;
}): Promise<
  { ok: true; actualSha256: string } | { ok: false; actualSha256: string | null }
> {
  try {
    const actualSha256 = await computeFileSha256Hex(params.masterSourcePath);
    if (actualSha256 === params.expectedSha256.toLowerCase()) {
      return { ok: true, actualSha256 };
    }
    return { ok: false, actualSha256 };
  } catch {
    return { ok: false, actualSha256: null };
  }
}

/**
 * Cleans ONLY disposable temporary files inside `working/tmp/`.
 * NEVER deletes `source/` originals, `working/` documents, or `exports/` deliverables.
 */
export async function cleanupWorkspaceTempFiles(
  workspaceRoot: string,
  jobId: string
): Promise<number> {
  const safeJobId = assertSafeAgentIdentifier(jobId, 'jobId');
  const jobDir = resolveStrictlyWithinRoot(
    path.resolve(workspaceRoot),
    'jobs',
    safeJobId
  );
  const tempDir = resolveStrictlyWithinRoot(jobDir, 'working', 'tmp');

  let removed = 0;
  try {
    const entries = await fs.readdir(tempDir);
    for (const entry of entries) {
      const target = resolveStrictlyWithinRoot(tempDir, entry);
      try {
        await fs.rm(target, { recursive: true, force: true });
        removed += 1;
      } catch (rmErr) {
        if ((rmErr as NodeJS.ErrnoException)?.code !== 'ENOENT') {
          throw rmErr;
        }
      }
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code !== 'ENOENT') {
      throw err;
    }
  }
  return removed;
}

export interface RecoverableWorkspaceSummary {
  jobId: string;
  dispatchId: string;
  manifestPath: string;
  masterIntegrityOk: boolean;
  workingCopyFiles: string[];
  workingCopyHasArtistEdits: boolean;
  existingExportFiles: string[];
}

/**
 * Read-only inspection of local `workspaces/jobs/*` directories on startup so
 * interrupted jobs can be safely recovered and verified without ever overwriting
 * artist working copies or existing exports.
 */
export async function inspectExistingWorkspaces(
  workspaceRoot: string
): Promise<RecoverableWorkspaceSummary[]> {
  const jobsRoot = path.join(path.resolve(workspaceRoot), 'jobs');
  let entries: string[];
  try {
    entries = await fs.readdir(jobsRoot);
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') {
      return [];
    }
    throw err;
  }

  const summaries: RecoverableWorkspaceSummary[] = [];
  for (const jobId of entries) {
    try {
      assertSafeAgentIdentifier(jobId, 'jobId');
      const jobDir = resolveStrictlyWithinRoot(jobsRoot, jobId);
      const manifestPath = resolveStrictlyWithinRoot(jobDir, 'manifest.json');
      assertNotSymlinkIfExists(manifestPath);
      const raw = await fs.readFile(manifestPath, 'utf8');
      const manifest = jobPrepManifestSchema.parse(JSON.parse(raw));
      const segments = assertSafeRelativeManifestPath(
        manifest.templateRelativeFilename
      );
      const leaf = assertSafeBasename(segments[segments.length - 1]!);
      const masterPath = resolveStrictlyWithinRoot(jobDir, 'source', leaf);
      const integrity = await verifyMasterTemplateIntegrity({
        masterSourcePath: masterPath,
        expectedSha256: manifest.templateSha256,
      });

      const workingDir = resolveStrictlyWithinRoot(jobDir, 'working');
      const exportsDir = resolveStrictlyWithinRoot(jobDir, 'exports');
      const workingCopyFiles = await listRegularFilesSafe(workingDir);
      const existingExportFiles = await listRegularFilesSafe(exportsDir);

      let workingCopyHasArtistEdits = false;
      for (const wf of workingCopyFiles) {
        const wfPath = resolveStrictlyWithinRoot(workingDir, wf);
        const wfSha = await computeFileSha256Hex(wfPath);
        if (wfSha !== manifest.templateSha256.toLowerCase()) {
          workingCopyHasArtistEdits = true;
          break;
        }
      }

      summaries.push({
        jobId,
        dispatchId: manifest.dispatchId,
        manifestPath,
        masterIntegrityOk: integrity.ok,
        workingCopyFiles,
        workingCopyHasArtistEdits,
        existingExportFiles,
      });
    } catch {
      // Ignore non-workspace directories safely
    }
  }

  return summaries;
}
