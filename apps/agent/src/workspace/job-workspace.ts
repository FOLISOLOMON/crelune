/**
 * CRELUNE Windows Creative Agent — Isolated Per-Job Workspace Manager
 *
 * Materializes isolated job workspaces strictly inside:
 *   `<workspaceRoot>/jobs/<jobId>/{source,working,assets,exports,logs}/`
 *
 * Stage 5.5.2 Atomic & Preservation-First Safety Invariants:
 * - New source masters (`source/`) and new working copies (`working/`) are created
 *   atomically via exclusive file creation (`open(..., 'wx')` + atomic `link()`).
 *   If another process creates the file first (`EEXIST`), the existing file is
 *   preserved untouched and NEVER overwritten by a fallback `writeFile()`.
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
  assertNotSymlinkIfExists,
  assertSafeAgentIdentifier,
  assertSafeBasename,
  assertSafeRelativeManifestPath,
  resolveStrictlyWithinRoot,
} from '../security/path-safety.js';
import { sanitizeLogMeta } from '../security/logger.js';

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

/**
 * Writes full content into a unique temporary file inside `tempDir` using
 * OS-atomic exclusive creation (`open(..., 'wx')`).
 */
async function stageUniqueTempFile(
  tempDir: string,
  bytes: Uint8Array | string
): Promise<string> {
  const uniqueName = `.stage_${process.pid}_${crypto.randomUUID()}.tmp`;
  const tempPath = resolveStrictlyWithinRoot(tempDir, uniqueName);
  const handle = await fs.open(tempPath, 'wx', 0o600);
  try {
    await handle.writeFile(bytes);
    await handle.sync().catch(() => {});
  } catch (err) {
    await handle.close().catch(() => {});
    await fs.unlink(tempPath).catch(() => {});
    throw err;
  }
  await handle.close();
  return tempPath;
}

/**
 * Atomically creates `targetPath` ONLY if it does not already exist.
 *
 * Strategy:
 * 1. Stages 100% of `bytes` to a unique temp file via `open(..., 'wx')` so no
 *    concurrent reader can observe a partially written target file.
 * 2. Publishes via `fs.link(stagedTemp, targetPath)`, which fails atomically with
 *    `EEXIST` on NTFS and POSIX when another process won or the file already exists.
 * 3. Only if the underlying filesystem rejects hard links (`EXDEV`/`ENOTSUP`),
 *    uses direct `fs.open(targetPath, 'wx')` — NEVER falling back to unconditional
 *    `writeFile()`.
 */
async function createFileExclusivelyAtomic(
  tempDir: string,
  targetPath: string,
  bytes: Uint8Array
): Promise<{ created: boolean }> {
  assertNotSymlinkIfExists(targetPath);
  const stagedPath = await stageUniqueTempFile(tempDir, bytes);
  try {
    try {
      await fs.link(stagedPath, targetPath);
      return { created: true };
    } catch (linkErr) {
      const code = (linkErr as NodeJS.ErrnoException)?.code;
      if (code === 'EEXIST') {
        return { created: false };
      }
      if (code === 'EXDEV' || code === 'ENOTSUP' || code === 'ENOSYS') {
        // Fallback strictly to exclusive 'wx' create (NEVER unconditional writeFile!)
        try {
          const handle = await fs.open(targetPath, 'wx');
          try {
            await handle.writeFile(bytes);
            await handle.sync().catch(() => {});
          } finally {
            await handle.close();
          }
          return { created: true };
        } catch (wxErr) {
          if ((wxErr as NodeJS.ErrnoException)?.code === 'EEXIST') {
            return { created: false };
          }
          throw wxErr;
        }
      }
      throw linkErr;
    }
  } finally {
    await fs.unlink(stagedPath).catch(() => {});
  }
}

/**
 * Atomically replaces a target file (`manifest.json`, `PREPARATION_GUIDE.txt`,
 * updated assets, or explicitly user-approved working copy replacement) using
 * unique staged `'wx'` file + `fs.rename()` so concurrent writers never interleave
 * or truncate the target.
 */
async function writeFileAtomicReplace(
  tempDir: string,
  targetPath: string,
  content: Uint8Array | string
): Promise<void> {
  assertNotSymlinkIfExists(targetPath);
  const stagedPath = await stageUniqueTempFile(tempDir, content);
  try {
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        await fs.rename(stagedPath, targetPath);
        return;
      } catch (err) {
        const code = (err as NodeJS.ErrnoException)?.code;
        if ((code === 'EPERM' || code === 'EBUSY' || code === 'EACCES') && attempt < 3) {
          await new Promise((r) => setTimeout(r, 25 * (attempt + 1)));
          continue;
        }
        throw err;
      }
    }
  } catch (err) {
    await fs.unlink(stagedPath).catch(() => {});
    throw err;
  }
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
    params.templateBytes
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

  // 2. Atomic exclusive creation for working copy (no check-then-write race!)
  const hasExplicitApproval = isValidWorkingCopyReplacementApproval(
    params.explicitWorkingCopyReplacementApproval
  );

  let workingCopyStatus: WorkingCopyPreparationStatus;
  let preservedExistingWorkingCopy = false;
  let workingCopySha256: string;

  const workingCreate = await createFileExclusivelyAtomic(
    tempDir,
    workingCopyPath,
    params.templateBytes
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
    await writeFileAtomicReplace(tempDir, workingCopyPath, params.templateBytes);
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
      asset.bytes
    );
    if (!assetCreate.created) {
      const existingAssetSha = await computeFileSha256Hex(localAssetPath);
      if (existingAssetSha !== assetSha) {
        await writeFileAtomicReplace(tempDir, localAssetPath, asset.bytes);
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
    JSON.stringify(manifest, null, 2)
  );
  await writeFileAtomicReplace(
    tempDir,
    guidePath,
    buildHumanPreparationGuide(
      manifest,
      `working/${workingLeafName}`,
      workingCopyStatus
    )
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
