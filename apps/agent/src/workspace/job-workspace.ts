/**
 * CRELUNE Windows Creative Agent — Isolated Per-Job Workspace Manager
 *
 * Materializes isolated job workspaces strictly inside:
 *   `<workspaceRoot>/jobs/<jobId>/{source,working,assets,exports,logs}/`
 *
 * Safety invariants:
 * - Original template master is saved into `source/`, verified by SHA-256, marked
 *   read-only, and NEVER overwritten.
 * - Working edits happen exclusively on a byte-for-byte copy inside `working/`.
 * - `verifyMasterUnchanged()` checks SHA-256 before and after every creative action.
 * - Temporary scratch cleanup ONLY deletes `working/tmp/` and NEVER touches
 *   `source/` masters or `exports/` deliverables.
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
  assertSafeAgentIdentifier,
  assertSafeBasename,
  assertSafeRelativeManifestPath,
  resolveStrictlyWithinRoot,
} from '../security/path-safety.js';
import { sanitizeLogMeta } from '../security/logger.js';

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
  const bytes = await fs.readFile(filePath);
  return computeSha256Hex(bytes);
}

function buildHumanPreparationGuide(
  manifest: JobPrepManifest,
  workingCopyRelative: string
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
    `Working Copy:      ${workingCopyRelative}`,
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
        ? `ASSET -> ${f.assetReference.suggestedRelativeFilename}`
        : f.textValue ?? '(Unresolved)';
      lines.push(`  - ${f.fieldKey} -> Layer "${f.targetLayerName}"${pathStr}: ${val}`);
    }
  }

  lines.push(
    '',
    'Instructions:',
    '-------------',
    '1. NEVER modify files inside source/. Always edit ONLY the copy in working/.',
    '2. Export final PNG, JPEG, or PDF deliverables into exports/.',
    '3. Run `crelune-agent submit-export` or upload from CRELUNE Web to verify and attach deliverables.',
    '4. Publication remains an explicit owner confirmation in CRELUNE Web.'
  );

  return lines.join('\n') + '\n';
}

export async function appendWorkspaceEvent(
  eventLogPath: string,
  record: Omit<WorkspaceEventRecord, 'timestamp'>
): Promise<void> {
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
  }

  const templateRelSegments = assertSafeRelativeManifestPath(
    manifest.templateRelativeFilename
  );
  const templateLeafName = assertSafeBasename(
    templateRelSegments[templateRelSegments.length - 1]!,
    'template filename'
  );

  const masterSourcePath = resolveStrictlyWithinRoot(sourceDir, templateLeafName);
  const dotIdx = templateLeafName.lastIndexOf('.');
  const workingBase =
    dotIdx > 0 ? templateLeafName.slice(0, dotIdx) : templateLeafName;
  const workingExt = dotIdx > 0 ? templateLeafName.slice(dotIdx) : '';
  const workingLeafName = assertSafeBasename(
    `${workingBase}_${safeDispatchId}_working${workingExt}`,
    'working filename'
  );
  const workingCopyPath = resolveStrictlyWithinRoot(workingDir, workingLeafName);

  // If original master already exists in source/, verify it matches rather than overwriting!
  let sourceAlreadyExists = false;
  try {
    await fs.access(masterSourcePath);
    sourceAlreadyExists = true;
  } catch {
    sourceAlreadyExists = false;
  }

  if (sourceAlreadyExists) {
    const existingSha = await computeFileSha256Hex(masterSourcePath);
    if (existingSha !== manifest.templateSha256) {
      throw new Error(
        'Existing source master file in workspace does not match manifest SHA-256. Refusing to overwrite original.'
      );
    }
  } else {
    await fs.writeFile(masterSourcePath, params.templateBytes);
    // Mark source master read-only on disk to prevent accidental overwrite
    await fs.chmod(masterSourcePath, 0o444).catch(() => {});
  }

  // Create fresh disposable working copy in working/
  await fs.writeFile(workingCopyPath, params.templateBytes);
  const workingSha = await computeFileSha256Hex(workingCopyPath);
  if (workingSha !== manifest.templateSha256) {
    throw new Error('Working copy SHA-256 verification failed immediately after copy.');
  }

  // Write only manifest-authorised assets into assets/
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
    await fs.writeFile(localAssetPath, asset.bytes);

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

  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
  await fs.writeFile(
    guidePath,
    buildHumanPreparationGuide(manifest, `working/${workingLeafName}`),
    'utf8'
  );

  await appendWorkspaceEvent(eventLogPath, {
    event: 'WORKSPACE_PREPARED',
    details: {
      designJobId: safeJobId,
      dispatchId: safeDispatchId,
      masterSha256: actualMasterSha,
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
    downloadedAssets,
  };
}

export async function verifyMasterTemplateIntegrity(params: {
  masterSourcePath: string;
  expectedSha256: string;
}): Promise<{ ok: true; actualSha256: string } | { ok: false; actualSha256: string | null }> {
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
 * NEVER deletes `source/` originals or `exports/` deliverables.
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
      await fs.rm(target, { recursive: true, force: true });
      removed += 1;
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
}

/**
 * Inspects local `workspaces/jobs/*` directories on startup so interrupted jobs
 * can be safely recovered and verified without losing artist work.
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

      summaries.push({
        jobId,
        dispatchId: manifest.dispatchId,
        manifestPath,
        masterIntegrityOk: integrity.ok,
      });
    } catch {
      // Ignore non-workspace directories safely
    }
  }

  return summaries;
}
