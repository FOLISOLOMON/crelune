import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import {
  DISPATCH_CLAIM_HEADER,
  type JobPrepManifest,
} from '@crelune/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  executeSafeAffinityHandoff,
  isAllowlistedAffinityExecutable,
} from './affinity/affinity-adapter.js';
import { detectInstalledAffinityEnvironment } from './affinity/affinity-detector.js';
import {
  AgentApiError,
  AgentAuthenticationRevokedError,
  CreluneAgentApiClient,
} from './api/crelune-api-client.js';
import {
  loadAgentConfig,
  validateBackendApiBaseUrl,
  validateLoopbackMcpUrl,
} from './config/agent-config.js';
import { validateLocalExportDeliverable } from './exports/export-validator.js';
import { WindowsCreativeAgentRuntime } from './runtime/agent-daemon.js';
import {
  MemoryCredentialStore,
  MemoryDispatchClaimStore,
  WindowsDpapiCredentialStore,
  WindowsDpapiDispatchClaimStore,
} from './security/dpapi-store.js';
import {
  createConsoleAgentLogger,
  redactSensitiveString,
  sanitizeLogMeta,
} from './security/logger.js';
import {
  AgentPathSecurityError,
  assertSafeAgentIdentifier,
  assertSafeBasename,
  assertSafeRelativeManifestPath,
  resolveStrictlyWithinRoot,
} from './security/path-safety.js';
import {
  AgentWorkspaceError,
  cleanupWorkspaceTempFiles,
  computeSha256Hex,
  inspectExistingWorkspaces,
  prepareIsolatedJobWorkspace,
  safeUnlinkTempFile,
  verifyMasterTemplateIntegrity,
  WORKING_COPY_REPLACEMENT_CONFIRMATION_TOKEN,
} from './workspace/job-workspace.js';

const tempDirsToClean: string[] = [];

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirsToClean.push(dir);
  return dir;
}

afterEach(async () => {
  while (tempDirsToClean.length > 0) {
    const dir = tempDirsToClean.pop()!;
    try {
      const walk = async (current: string) => {
        const entries = await fs.readdir(current, { withFileTypes: true });
        for (const entry of entries) {
          const full = path.join(current, entry.name);
          if (entry.isSymbolicLink()) {
            await fs.unlink(full).catch(() => { });
          } else if (entry.isDirectory()) {
            await walk(full);
          } else {
            await fs.chmod(full, 0o666).catch(() => { });
          }
        }
      };
      await walk(dir);
    } catch {
      // Ignore walk errors during teardown
    }
    await fs.rm(dir, { recursive: true, force: true }).catch(() => { });
  }
});

function createSyntheticPsdBytes(): Uint8Array {
  const buf = Buffer.alloc(32);
  buf.write('8BPS', 0, 'ascii');
  buf.writeUInt16BE(1, 4);
  buf.writeUInt16BE(3, 12);
  buf.writeUInt32BE(1350, 14);
  buf.writeUInt32BE(1080, 18);
  buf.writeUInt16BE(8, 22);
  buf.writeUInt16BE(3, 24);
  return new Uint8Array(buf);
}

function createMinimalValidPngBytes(widthPx: number, heightPx: number): Uint8Array {
  const buf = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buf, 0);
  buf.writeUInt32BE(13, 8);
  buf.write('IHDR', 12, 'ascii');
  buf.writeUInt32BE(widthPx, 16);
  buf.writeUInt32BE(heightPx, 20);
  buf[24] = 8;
  buf[25] = 2;
  return new Uint8Array(buf);
}

function createMinimalValidJpegBytes(widthPx: number, heightPx: number): Uint8Array {
  const buf = Buffer.from([
    0xff, 0xd8,
    0xff, 0xc0,
    0x00, 0x0b,
    0x08,
    (heightPx >> 8) & 0xff,
    heightPx & 0xff,
    (widthPx >> 8) & 0xff,
    widthPx & 0xff,
    0x03,
    0x01, 0x11, 0x00,
    0xff, 0xd9,
  ]);
  return new Uint8Array(buf);
}

function createMinimalValidPdfBytes(): Uint8Array {
  return new Uint8Array(
    Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n', 'ascii')
  );
}

function createValidManifest(params: {
  designJobId?: string;
  dispatchId?: string;
  templateSha256: string;
  assetSha256?: string;
}): JobPrepManifest {
  return {
    manifestVersion: 1,
    organisationId: 'org_stage55_01',
    designJobId: params.designJobId ?? 'job_stage55_01',
    dispatchId: params.dispatchId ?? 'dsp_stage55_01',
    designJobTitle: 'November Birthday Flyer — Kofi Mensah',
    templateId: 'tpl_stage55_01',
    templateName: 'Birthday Gold Frame',
    templateVersionId: 'tplv_stage55_01',
    templateVersionNumber: 1,
    templateFormat: 'PSD',
    templateStudioType: 'AFFINITY_DESIGNER',
    templateRelativeFilename: 'source/birthday_gold_frame.psd',
    templateSha256: params.templateSha256,
    preserveMasterImmutable: true,
    manualModeNotice:
      'Layer inspection and mapping require manual confirmation in Affinity.',
    fields: [
      {
        fieldKey: 'member.fullName',
        fieldType: 'TEXT',
        targetLayerName: 'MEMBER_NAME',
        layerPath: ['Header', 'MEMBER_NAME'],
        textValue: 'Kofi Mensah',
        assetReference: null,
      },
      ...(params.assetSha256
        ? [
          {
            fieldKey: 'member.photo',
            fieldType: 'IMAGE' as const,
            targetLayerName: 'MEMBER_PHOTO',
            layerPath: ['Portrait', 'MEMBER_PHOTO'],
            textValue: null,
            assetReference: {
              assetId: 'mem_kofi_01',
              assetKind: 'MEMBER_PHOTO' as const,
              suggestedRelativeFilename: 'assets/kofi_photo.jpg',
              expectedSha256: params.assetSha256,
            },
          },
        ]
        : []),
    ],
    outputSpec: {
      formats: ['PNG', 'PDF'],
      dimensions: '1080x1350',
      targetPlatform: 'Instagram',
    },
    publicationRule: 'EXPORT_DOES_NOT_PUBLISH',
    createdAt: new Date().toISOString(),
  };
}

describe('Windows Creative Agent — Security, Path Containment, Symlinks, Config & Logger', () => {
  it('blocks path traversal, absolute paths, drive letters, UNC paths, null bytes, and directory junction/symlink escapes', async () => {
    const root = await makeTempDir('crelune-path-');
    const outsideDir = await makeTempDir('crelune-outside-');
    await fs.writeFile(path.join(outsideDir, 'secret.txt'), 'do-not-touch');

    expect(() => assertSafeAgentIdentifier('../evil', 'jobId')).toThrow(
      AgentPathSecurityError
    );
    expect(() => assertSafeAgentIdentifier('job id with spaces', 'jobId')).toThrow(
      AgentPathSecurityError
    );
    expect(() => assertSafeBasename('../secret.png')).toThrow(AgentPathSecurityError);
    expect(() => assertSafeBasename('C:\\Windows\\cmd.exe')).toThrow(
      AgentPathSecurityError
    );
    expect(() => assertSafeRelativeManifestPath('/etc/passwd')).toThrow(
      AgentPathSecurityError
    );
    expect(() => assertSafeRelativeManifestPath('source/../../escape.psd')).toThrow(
      AgentPathSecurityError
    );
    expect(() => assertSafeRelativeManifestPath('D:\\templates\\evil.psd')).toThrow(
      AgentPathSecurityError
    );
    expect(() => resolveStrictlyWithinRoot(root, '..', 'outside.txt')).toThrow(
      AgentPathSecurityError
    );
    expect(() => resolveStrictlyWithinRoot(root, '\\\\server\\share\\x')).toThrow(
      AgentPathSecurityError
    );
    expect(() => resolveStrictlyWithinRoot(root, 'jobs', 'a\0b')).toThrow(
      AgentPathSecurityError
    );

    // Real junction (Windows) or symlink (POSIX) escape outside workspace root MUST fail closed
    const jobsDir = path.join(root, 'jobs', 'job_sym');
    await fs.mkdir(jobsDir, { recursive: true });
    const linkPath = path.join(jobsDir, 'working');
    await fs.symlink(
      outsideDir,
      linkPath,
      process.platform === 'win32' ? 'junction' : 'dir'
    );

    expect(() =>
      resolveStrictlyWithinRoot(root, 'jobs', 'job_sym', 'working', 'secret.txt')
    ).toThrow(AgentPathSecurityError);

    const safe = resolveStrictlyWithinRoot(
      root,
      'jobs',
      'job_123',
      'exports',
      'out.png'
    );
    expect(safe.startsWith(path.resolve(root))).toBe(true);
  });

  it('enforces HTTPS for remote backends, disables MCP by default, and restricts MCP to loopback', () => {
    expect(validateBackendApiBaseUrl('https://crelune.example.com/api')).toBe(
      'https://crelune.example.com'
    );
    expect(validateBackendApiBaseUrl('http://127.0.0.1:3000')).toBe(
      'http://127.0.0.1:3000'
    );
    expect(() => validateBackendApiBaseUrl('http://crelune.example.com')).toThrow(
      /HTTPS/i
    );
    expect(() =>
      validateBackendApiBaseUrl('https://user:pass@crelune.example.com')
    ).toThrow(/credentials/i);

    expect(validateLoopbackMcpUrl('http://127.0.0.1:33001/sse')).toBe(
      'http://127.0.0.1:33001/sse'
    );
    expect(() => validateLoopbackMcpUrl('http://192.168.1.50:33001/sse')).toThrow(
      /loopback/i
    );

    const defaults = loadAgentConfig({}, {});
    expect(defaults.affinityMcpEnabled).toBe(false);
    expect(defaults.allowInteractiveAffinityLaunch).toBe(true);
  });

  it('redacts bearer tokens, dispatch claim headers/tokens, presigned query signatures, and DB URLs in logs', () => {
    const sampleClaim = `clm_${'f'.repeat(48)}`;
    const raw = `Auth Bearer cln_agent_0123456789abcdef0123456789abcdef header X-Crelune-Dispatch-Claim: ${sampleClaim} url https://s3.test/k?X-Amz-Signature=deadbeef&X-Amz-Credential=AKIA123 db postgresql://user:secret@host/neondb`;
    const sanitized = redactSensitiveString(raw);
    expect(sanitized).not.toContain('cln_agent_0123456789abcdef');
    expect(sanitized).not.toContain(sampleClaim);
    expect(sanitized).not.toContain('deadbeef');
    expect(sanitized).not.toContain('AKIA123');
    expect(sanitized).not.toContain('user:secret');

    const cleanMeta = sanitizeLogMeta({
      dispatchId: 'dsp_1',
      bearerToken: 'cln_agent_secret_value_123456',
      'X-Crelune-Dispatch-Claim': sampleClaim,
      nested: { claimToken: sampleClaim },
    }) as Record<string, unknown>;
    expect(cleanMeta.dispatchId).toBe('dsp_1');
    expect(cleanMeta.bearerToken).toBe('[REDACTED]');
    expect(cleanMeta['X-Crelune-Dispatch-Claim']).toBe('[REDACTED]');
    expect((cleanMeta.nested as Record<string, unknown>).claimToken).toBe(
      '[REDACTED]'
    );
  });
});

describe('Windows Creative Agent — Real Windows DPAPI Credential & Claim Storage', () => {
  it.skipIf(process.platform !== 'win32')(
    'encrypts bearer token and dispatch claim token with CurrentUser DPAPI, never writes plaintext to disk, decrypts accurately, and clears cleanly',
    async () => {
      const configDir = await makeTempDir('crelune-dpapi-');
      const store = new WindowsDpapiCredentialStore(configDir);
      const token = `cln_agent_${crypto.randomBytes(32).toString('hex')}`;

      expect(await store.load()).toBeNull();
      await store.save({
        apiBaseUrl: 'https://crelune.example.com',
        bearerToken: token,
      });

      const onDisk = await fs.readFile(store.filePath, 'utf8');
      expect(onDisk).not.toContain(token);
      expect(onDisk).not.toContain('cln_agent_');
      expect(onDisk).toContain('"scheme": "windows-dpapi-current-user"');

      const loaded = await store.load();
      expect(loaded?.bearerToken).toBe(token);
      await store.clear();
      expect(await store.load()).toBeNull();

      // Per-dispatch claim fencing token DPAPI round-trip
      const claimStore = new WindowsDpapiDispatchClaimStore(configDir);
      const claimToken = `clm_${crypto.randomBytes(24).toString('hex')}`;
      await claimStore.saveClaim('dsp_dpapi_1', claimToken);
      const claimFile = path.join(configDir, 'claims', 'dsp_dpapi_1.dpapi');
      const rawClaimFile = await fs.readFile(claimFile, 'utf8');
      expect(rawClaimFile).not.toContain(claimToken);
      expect(rawClaimFile).not.toContain('clm_');
      expect(await claimStore.loadClaim('dsp_dpapi_1')).toBe(claimToken);
      await claimStore.clearClaim('dsp_dpapi_1');
      expect(await claimStore.loadClaim('dsp_dpapi_1')).toBeNull();
    }
  );

  it('supports MemoryCredentialStore for isolated non-disk tests', async () => {
    const store = new MemoryCredentialStore();
    await store.save({
      apiBaseUrl: 'http://127.0.0.1:3000',
      bearerToken:
        'cln_agent_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    });
    const loaded = await store.load();
    expect(loaded?.apiBaseUrl).toBe('http://127.0.0.1:3000');
    await store.clear();
    expect(await store.load()).toBeNull();
  });
});

describe('Windows Creative Agent — Live Affinity 3.3 Detection (Read-Only)', () => {
  it.skipIf(process.platform !== 'win32')(
    'detects installed Affinity MSIX version and verifies global Scripting/MCP settings stay disabled/untouched',
    async () => {
      const report = await detectInstalledAffinityEnvironment();
      expect(report.platform).toBe('win32');
      expect(report.installed).toBe(true);
      expect(report.aliasExists).toBe(true);
      expect(report.executableAliasPath?.toLowerCase()).toMatch(
        /\\microsoft\\windowsapps\\affinity\.exe$/
      );
      expect(report.version).toMatch(/^3\.3\./);
      expect(report.scriptingEnabled).toBe(false);
      expect(report.mcpServerEnabled).toBe(false);
    }
  );
});

describe('Windows Creative Agent — Workspace Preservation, Working Assets, Affinity Handoff & Export Validator', () => {
  it('preserves artist-edited working copies and existing exports on retry/recovery without treating modified working copies as corrupted masters', async () => {
    const workspaceRoot = await makeTempDir('crelune-preserve-');
    const psdBytes = createSyntheticPsdBytes();
    const psdSha = computeSha256Hex(psdBytes);
    const photoBytes = createMinimalValidJpegBytes(400, 400);
    const photoSha = computeSha256Hex(photoBytes);
    const manifest = createValidManifest({
      templateSha256: psdSha,
      assetSha256: photoSha,
    });

    // 1. First preparation creates source master and fresh working copy
    const first = await prepareIsolatedJobWorkspace({
      workspaceRoot,
      rawManifest: manifest,
      templateBytes: psdBytes,
      assets: [
        {
          assetId: 'mem_kofi_01',
          relativeFilename: 'assets/kofi_photo.jpg',
          bytes: photoBytes,
          expectedSha256: photoSha,
        },
      ],
    });
    expect(first.workingCopyStatus).toBe('CREATED');
    expect(first.preservedExistingWorkingCopy).toBe(false);
    expect(first.masterVerified).toBe(true);

    // Simulate artist editing working copy and saving an existing export proof
    const artistEditedBytes = Buffer.concat([
      Buffer.from(psdBytes),
      Buffer.from('ARTIST_CREATIVE_EDITS_V1'),
    ]);
    await fs.writeFile(first.workingCopyPath, artistEditedBytes);
    const artistEditedSha = computeSha256Hex(artistEditedBytes);

    const existingExportBytes = createMinimalValidPngBytes(1080, 1350);
    const existingExportPath = path.join(first.exportsDir, 'artist-proof.png');
    await fs.writeFile(existingExportPath, existingExportBytes);

    // 2. Second preparation (retry / recovery!) MUST preserve artist edits & existing exports!
    const recovered = await prepareIsolatedJobWorkspace({
      workspaceRoot,
      rawManifest: manifest,
      templateBytes: psdBytes,
      assets: [
        {
          assetId: 'mem_kofi_01',
          relativeFilename: 'assets/kofi_photo.jpg',
          bytes: photoBytes,
          expectedSha256: photoSha,
        },
      ],
    });
    expect(recovered.workingCopyStatus).toBe('PRESERVED_WITH_ARTIST_EDITS');
    expect(recovered.preservedExistingWorkingCopy).toBe(true);
    expect(recovered.masterVerified).toBe(true);
    expect(recovered.workingCopySha256).toBe(artistEditedSha);
    expect(recovered.preservedExistingExports).toEqual(['artist-proof.png']);

    // Verify artist working copy bytes were NOT overwritten
    const diskWorkingBytes = await fs.readFile(recovered.workingCopyPath);
    expect(Buffer.compare(diskWorkingBytes, artistEditedBytes)).toBe(0);

    // Verify source master hash remained 100% unchanged
    const masterCheck = await verifyMasterTemplateIntegrity({
      masterSourcePath: recovered.masterSourcePath,
      expectedSha256: psdSha,
    });
    expect(masterCheck.ok).toBe(true);

    // Verify existing export was NOT modified or deleted
    const diskExportBytes = await fs.readFile(existingExportPath);
    expect(Buffer.compare(diskExportBytes, Buffer.from(existingExportBytes))).toBe(0);

    // Verify preservation was logged in events.jsonl
    const eventsLog = await fs.readFile(recovered.eventLogPath, 'utf8');
    expect(eventsLog).toContain('EXISTING_WORKING_COPY_PRESERVED');

    // 3. Startup crash recovery MUST report master intact AND artist edits detected (never corrupted master!)
    const inspected = await inspectExistingWorkspaces(workspaceRoot);
    expect(inspected).toHaveLength(1);
    expect(inspected[0]).toMatchObject({
      jobId: first.jobId,
      dispatchId: first.dispatchId,
      masterIntegrityOk: true,
      workingCopyHasArtistEdits: true,
      existingExportFiles: ['artist-proof.png'],
    });

    // 4. Temp cleanup deletes ONLY working/tmp/ and preserves source/, working/, and exports/
    const scratchPath = path.join(recovered.tempDir, 'scratch.tmp');
    await fs.writeFile(scratchPath, 'temp-data');
    expect(await cleanupWorkspaceTempFiles(workspaceRoot, first.jobId)).toBe(1);
    await expect(fs.access(scratchPath)).rejects.toThrow();
    expect(
      Buffer.compare(await fs.readFile(recovered.workingCopyPath), artistEditedBytes)
    ).toBe(0);
    await expect(fs.access(existingExportPath)).resolves.toBeUndefined();

    // 5. Explicit overwrite is IMPOSSIBLE without designated user approval path
    const unapprovedAttempt = await prepareIsolatedJobWorkspace({
      workspaceRoot,
      rawManifest: manifest,
      templateBytes: psdBytes,
      assets: [],
      explicitWorkingCopyReplacementApproval: {
        approvedByUser: true,
        confirmationToken: WORKING_COPY_REPLACEMENT_CONFIRMATION_TOKEN,
        reason: 'no', // Too short -> rejected!
      },
    });
    expect(unapprovedAttempt.workingCopyStatus).toBe(
      'PRESERVED_WITH_ARTIST_EDITS'
    );
    expect(unapprovedAttempt.workingCopySha256).toBe(artistEditedSha);

    // Valid designated approval path replaces working copy cleanly and logs event
    const explicitlyReplaced = await prepareIsolatedJobWorkspace({
      workspaceRoot,
      rawManifest: manifest,
      templateBytes: psdBytes,
      assets: [],
      explicitWorkingCopyReplacementApproval: {
        approvedByUser: true,
        confirmationToken: WORKING_COPY_REPLACEMENT_CONFIRMATION_TOKEN,
        reason: 'Artist explicitly confirmed resetting working copy to master.',
      },
    });
    expect(explicitlyReplaced.workingCopyStatus).toBe(
      'REPLACED_BY_EXPLICIT_USER_ACTION'
    );
    expect(explicitlyReplaced.workingCopySha256).toBe(psdSha);
    expect(await fs.readFile(explicitlyReplaced.eventLogPath, 'utf8')).toContain(
      'WORKING_COPY_EXPLICITLY_REPLACED'
    );
  });

  it('uses atomic exclusive creation so concurrent preparations never overwrite a working copy, artist edits, source master, or existing exports', async () => {
    const workspaceRoot = await makeTempDir('crelune-concurrent-ws-');
    const psdBytes = createSyntheticPsdBytes();
    const psdSha = computeSha256Hex(psdBytes);
    const manifest = createValidManifest({
      designJobId: 'job_race_01',
      dispatchId: 'dsp_race_01',
      templateSha256: psdSha,
    });

    // 1. Two concurrent initial preparations race on a brand-new workspace
    const [resA, resB] = await Promise.all([
      prepareIsolatedJobWorkspace({
        workspaceRoot,
        rawManifest: manifest,
        templateBytes: psdBytes,
        assets: [],
      }),
      prepareIsolatedJobWorkspace({
        workspaceRoot,
        rawManifest: manifest,
        templateBytes: psdBytes,
        assets: [],
      }),
    ]);

    const statuses = [resA.workingCopyStatus, resB.workingCopyStatus].sort();
    expect(statuses).toEqual(['CREATED', 'PRESERVED_UNCHANGED']);
    expect(resA.masterVerified && resB.masterVerified).toBe(true);
    // Manifest JSON remains valid and non-truncated under concurrent writes
    const parsedManifest = JSON.parse(await fs.readFile(resA.manifestPath, 'utf8'));
    expect(parsedManifest.designJobId).toBe('job_race_01');

    // 2. Artist edits working copy + creates existing export; 4 concurrent retries MUST preserve both!
    const artistBytes = Buffer.concat([
      Buffer.from(psdBytes),
      Buffer.from('CONCURRENT_ARTIST_EDITS_SAFE'),
    ]);
    await fs.writeFile(resA.workingCopyPath, artistBytes);
    const artistSha = computeSha256Hex(artistBytes);

    const exportBytes = createMinimalValidPngBytes(1080, 1350);
    const existingExportPath = path.join(resA.exportsDir, 'existing-final.png');
    await fs.writeFile(existingExportPath, exportBytes);

    const concurrentRetries = await Promise.all([
      prepareIsolatedJobWorkspace({
        workspaceRoot,
        rawManifest: manifest,
        templateBytes: psdBytes,
        assets: [],
      }),
      prepareIsolatedJobWorkspace({
        workspaceRoot,
        rawManifest: manifest,
        templateBytes: psdBytes,
        assets: [],
      }),
      prepareIsolatedJobWorkspace({
        workspaceRoot,
        rawManifest: manifest,
        templateBytes: psdBytes,
        assets: [],
      }),
      prepareIsolatedJobWorkspace({
        workspaceRoot,
        rawManifest: manifest,
        templateBytes: psdBytes,
        assets: [],
      }),
    ]);

    for (const outcome of concurrentRetries) {
      expect(outcome.workingCopyStatus).toBe('PRESERVED_WITH_ARTIST_EDITS');
      expect(outcome.preservedExistingWorkingCopy).toBe(true);
      expect(outcome.workingCopySha256).toBe(artistSha);
      expect(outcome.masterVerified).toBe(true);
      expect(outcome.preservedExistingExports).toEqual(['existing-final.png']);
    }

    expect(
      Buffer.compare(await fs.readFile(resA.workingCopyPath), artistBytes)
    ).toBe(0);
    expect(
      (
        await verifyMasterTemplateIntegrity({
          masterSourcePath: resA.masterSourcePath,
          expectedSha256: psdSha,
        })
      ).ok
    ).toBe(true);
    expect(
      Buffer.compare(
        await fs.readFile(existingExportPath),
        Buffer.from(exportBytes)
      )
    ).toBe(0);
  });

  it('fails closed with AgentWorkspaceError when hard links are unsupported, never publishes partial target files, and cleans up staged temp files', async () => {
    const psdBytes = createSyntheticPsdBytes();
    const psdSha = computeSha256Hex(psdBytes);
    const photoBytes = createMinimalValidJpegBytes(400, 400);
    const photoSha = computeSha256Hex(photoBytes);

    for (const errnoCode of ['EXDEV', 'ENOTSUP', 'ENOSYS', 'EOPNOTSUPP'] as const) {
      const workspaceRoot = await makeTempDir(`crelune-nolink-${errnoCode.toLowerCase()}-`);
      const manifest = createValidManifest({
        designJobId: `job_nolink_${errnoCode.toLowerCase()}`,
        dispatchId: `dsp_nolink_${errnoCode.toLowerCase()}`,
        templateSha256: psdSha,
        assetSha256: photoSha,
      });

      const openSpy = vi.spyOn(fs, 'open');
      const writeFileSpy = vi.spyOn(fs, 'writeFile');

      try {
        let caught: unknown;
        try {
          await prepareIsolatedJobWorkspace({
            workspaceRoot,
            rawManifest: manifest,
            templateBytes: psdBytes,
            assets: [
              {
                assetId: 'mem_kofi_01',
                relativeFilename: 'assets/kofi_photo.jpg',
                bytes: photoBytes,
                expectedSha256: photoSha,
              },
            ],
            atomicPublicationOps: {
              linkFile: async () => {
                const err = new Error(
                  `Simulated unsupported hard link (${errnoCode})`
                ) as NodeJS.ErrnoException;
                err.code = errnoCode;
                throw err;
              },
            },
          });
        } catch (err) {
          caught = err;
        }

        expect(caught).toBeInstanceOf(AgentWorkspaceError);
        const wsErr = caught as AgentWorkspaceError;
        expect(wsErr.code).toBe('ATOMIC_PUBLICATION_UNSUPPORTED');
        expect(wsErr.errnoCode).toBe(errnoCode);
        expect(wsErr.message).toContain(errnoCode);
        // Must never leak local absolute filesystem paths into diagnostic message
        expect(wsErr.message).not.toContain(workspaceRoot);

        // Verify ZERO direct open/writeFile fallback at target paths (only staging in working/tmp/)
        for (const call of openSpy.mock.calls) {
          const openedPath = String(call[0]);
          expect(openedPath).toContain(`${path.sep}working${path.sep}tmp${path.sep}`);
        }
        expect(writeFileSpy).not.toHaveBeenCalled();

        // Verify NO partially written target became visible and working/tmp/ is clean
        const jobDir = path.join(workspaceRoot, 'jobs', manifest.designJobId);
        expect(await fs.readdir(path.join(jobDir, 'source'))).toEqual([]);
        expect(await fs.readdir(path.join(jobDir, 'working'))).toEqual(['tmp']);
        expect(await fs.readdir(path.join(jobDir, 'working', 'tmp'))).toEqual([]);
        expect(await fs.readdir(path.join(jobDir, 'assets'))).toEqual([]);
      } finally {
        openSpy.mockRestore();
        writeFileSpy.mockRestore();
      }
    }

    // Also verify failing ONLY on working copy publication (after master links on real NTFS)
    const partialRoot = await makeTempDir('crelune-nolink-working-');
    const partialManifest = createValidManifest({
      designJobId: 'job_nolink_working',
      dispatchId: 'dsp_nolink_working',
      templateSha256: psdSha,
    });
    const partialJobDir = path.join(partialRoot, 'jobs', partialManifest.designJobId);
    const expectedWorkingDir = path.join(partialJobDir, 'working');

    let workingErr: unknown;
    try {
      await prepareIsolatedJobWorkspace({
        workspaceRoot: partialRoot,
        rawManifest: partialManifest,
        templateBytes: psdBytes,
        assets: [],
        atomicPublicationOps: {
          linkFile: async (existingPath, newPath) => {
            if (newPath.startsWith(expectedWorkingDir)) {
              const err = new Error('Simulated ENOTSUP on working dir') as NodeJS.ErrnoException;
              err.code = 'ENOTSUP';
              throw err;
            }
            await fs.link(existingPath, newPath);
          },
        },
      });
    } catch (err) {
      workingErr = err;
    }

    expect(workingErr).toBeInstanceOf(AgentWorkspaceError);
    expect((workingErr as AgentWorkspaceError).code).toBe(
      'ATOMIC_PUBLICATION_UNSUPPORTED'
    );
    expect(await fs.readdir(path.join(partialJobDir, 'source'))).toEqual([
      'birthday_gold_frame.psd',
    ]);
    expect(await fs.readdir(expectedWorkingDir)).toEqual(['tmp']);
    expect(await fs.readdir(path.join(expectedWorkingDir, 'tmp'))).toEqual([]);

    // Unexpected link error (e.g. EACCES) also fails closed without fallback and cleans staging
    const eaccesRoot = await makeTempDir('crelune-link-eacces-');
    const eaccesManifest = createValidManifest({
      designJobId: 'job_link_eacces',
      dispatchId: 'dsp_link_eacces',
      templateSha256: psdSha,
    });
    let eaccesErr: unknown;
    try {
      await prepareIsolatedJobWorkspace({
        workspaceRoot: eaccesRoot,
        rawManifest: eaccesManifest,
        templateBytes: psdBytes,
        assets: [],
        atomicPublicationOps: {
          linkFile: async () => {
            const err = new Error('Simulated EACCES') as NodeJS.ErrnoException;
            err.code = 'EACCES';
            throw err;
          },
        },
      });
    } catch (err) {
      eaccesErr = err;
    }
    expect(eaccesErr).toBeInstanceOf(AgentWorkspaceError);
    expect((eaccesErr as AgentWorkspaceError).code).toBe(
      'ATOMIC_PUBLICATION_FAILED'
    );
    expect(
      await fs.readdir(
        path.join(eaccesRoot, 'jobs', eaccesManifest.designJobId, 'source')
      )
    ).toEqual([]);
    expect(
      await fs.readdir(
        path.join(eaccesRoot, 'jobs', eaccesManifest.designJobId, 'working', 'tmp')
      )
    ).toEqual([]);
  });

  it('preserves existing working copies, source masters, exports, and symlink protections on hard-link failure while keeping NTFS hard links and explicit replacement working', async () => {
    const workspaceRoot = await makeTempDir('crelune-preserve-nolink-');
    const psdBytes = createSyntheticPsdBytes();
    const psdSha = computeSha256Hex(psdBytes);
    const manifest = createValidManifest({
      designJobId: 'job_preserve_nolink',
      dispatchId: 'dsp_preserve_nolink',
      templateSha256: psdSha,
    });

    // 1. Normal Windows NTFS hard-link creation succeeds and leaves working/tmp clean
    const created = await prepareIsolatedJobWorkspace({
      workspaceRoot,
      rawManifest: manifest,
      templateBytes: psdBytes,
      assets: [],
    });
    expect(created.workingCopyStatus).toBe('CREATED');
    expect(created.masterVerified).toBe(true);
    expect(await fs.readdir(created.tempDir)).toEqual([]);
    const workingStat = await fs.stat(created.workingCopyPath);
    expect(workingStat.nlink).toBe(1);

    // 2. Artist edits working copy and creates an export
    const artistBytes = Buffer.concat([
      Buffer.from(psdBytes),
      Buffer.from('ARTIST_WORK_MUST_SURVIVE_ENOTSUP'),
    ]);
    await fs.writeFile(created.workingCopyPath, artistBytes);
    const artistSha = computeSha256Hex(artistBytes);

    const exportBytes = createMinimalValidPngBytes(1080, 1350);
    const existingExportPath = path.join(created.exportsDir, 'artist-final.png');
    await fs.writeFile(existingExportPath, exportBytes);

    // 3. Hard-link failure on master OR working copy fails closed while preserving all user files
    await expect(
      prepareIsolatedJobWorkspace({
        workspaceRoot,
        rawManifest: manifest,
        templateBytes: psdBytes,
        assets: [],
        atomicPublicationOps: {
          linkFile: async () => {
            const err = new Error('Simulated ENOTSUP') as NodeJS.ErrnoException;
            err.code = 'ENOTSUP';
            throw err;
          },
        },
      })
    ).rejects.toMatchObject({
      name: 'AgentWorkspaceError',
      code: 'ATOMIC_PUBLICATION_UNSUPPORTED',
      errnoCode: 'ENOTSUP',
    });

    await expect(
      prepareIsolatedJobWorkspace({
        workspaceRoot,
        rawManifest: manifest,
        templateBytes: psdBytes,
        assets: [],
        atomicPublicationOps: {
          linkFile: async (existingPath, newPath) => {
            if (newPath === created.workingCopyPath) {
              const err = new Error('Simulated EXDEV') as NodeJS.ErrnoException;
              err.code = 'EXDEV';
              throw err;
            }
            await fs.link(existingPath, newPath);
          },
        },
      })
    ).rejects.toMatchObject({
      name: 'AgentWorkspaceError',
      code: 'ATOMIC_PUBLICATION_UNSUPPORTED',
      errnoCode: 'EXDEV',
    });

    // Existing working copy, source master, and export are 100% untouched; tmp is clean
    expect(
      Buffer.compare(await fs.readFile(created.workingCopyPath), artistBytes)
    ).toBe(0);
    expect(
      (
        await verifyMasterTemplateIntegrity({
          masterSourcePath: created.masterSourcePath,
          expectedSha256: psdSha,
        })
      ).ok
    ).toBe(true);
    expect(
      Buffer.compare(
        await fs.readFile(existingExportPath),
        Buffer.from(exportBytes)
      )
    ).toBe(0);
    expect(await fs.readdir(created.tempDir)).toEqual([]);

    // 4. Even with explicit replacement approval, unsupported hard links fail closed without modifying disk
    await expect(
      prepareIsolatedJobWorkspace({
        workspaceRoot,
        rawManifest: manifest,
        templateBytes: psdBytes,
        assets: [],
        explicitWorkingCopyReplacementApproval: {
          approvedByUser: true,
          confirmationToken: WORKING_COPY_REPLACEMENT_CONFIRMATION_TOKEN,
          reason: 'Artist requested clean reset from master.',
        },
        atomicPublicationOps: {
          linkFile: async () => {
            const err = new Error('Simulated ENOSYS') as NodeJS.ErrnoException;
            err.code = 'ENOSYS';
            throw err;
          },
        },
      })
    ).rejects.toMatchObject({
      name: 'AgentWorkspaceError',
      code: 'ATOMIC_PUBLICATION_UNSUPPORTED',
      errnoCode: 'ENOSYS',
    });
    expect(
      Buffer.compare(await fs.readFile(created.workingCopyPath), artistBytes)
    ).toBe(0);
    expect(await fs.readdir(created.tempDir)).toEqual([]);

    // 5. Explicit replacement approval on normal NTFS continues to work cleanly
    const replaced = await prepareIsolatedJobWorkspace({
      workspaceRoot,
      rawManifest: manifest,
      templateBytes: psdBytes,
      assets: [],
      explicitWorkingCopyReplacementApproval: {
        approvedByUser: true,
        confirmationToken: WORKING_COPY_REPLACEMENT_CONFIRMATION_TOKEN,
        reason: 'Artist requested clean reset from master.',
      },
    });
    expect(replaced.workingCopyStatus).toBe('REPLACED_BY_EXPLICIT_USER_ACTION');
    expect(replaced.workingCopySha256).toBe(psdSha);
    expect(replaced.workingCopySha256).not.toBe(artistSha);
    expect(await fs.readdir(created.tempDir)).toEqual([]);
    expect(await fs.readFile(replaced.eventLogPath, 'utf8')).toContain(
      'WORKING_COPY_EXPLICITLY_REPLACED'
    );

    // 6. Symlink/junction escapes remain rejected with AgentPathSecurityError
    const symlinkRoot = await makeTempDir('crelune-symlink-guard-');
    const outsideDir = await makeTempDir('crelune-symlink-outside-');
    const symJobDir = path.join(symlinkRoot, 'jobs', 'job_sym_guard');
    await fs.mkdir(symJobDir, { recursive: true });
    await fs.symlink(
      outsideDir,
      path.join(symJobDir, 'working'),
      process.platform === 'win32' ? 'junction' : 'dir'
    );
    await expect(
      prepareIsolatedJobWorkspace({
        workspaceRoot: symlinkRoot,
        rawManifest: createValidManifest({
          designJobId: 'job_sym_guard',
          dispatchId: 'dsp_sym_guard',
          templateSha256: psdSha,
        }),
        templateBytes: psdBytes,
        assets: [],
      })
    ).rejects.toThrow(AgentPathSecurityError);
  });

  it('prevents concurrent preparations from ever seeing incomplete files or misclassifying them as artist edits', async () => {
    const psdBytes = createSyntheticPsdBytes();
    const psdSha = computeSha256Hex(psdBytes);

    // Scenario A: Concurrent preparations on unsupported hard-link filesystem both fail closed
    const failRoot = await makeTempDir('crelune-concurrent-nolink-');
    const failManifest = createValidManifest({
      designJobId: 'job_concurrent_nolink',
      dispatchId: 'dsp_concurrent_nolink',
      templateSha256: psdSha,
    });
    const failResults = await Promise.allSettled([
      prepareIsolatedJobWorkspace({
        workspaceRoot: failRoot,
        rawManifest: failManifest,
        templateBytes: psdBytes,
        assets: [],
        atomicPublicationOps: {
          linkFile: async () => {
            const err = new Error('Simulated ENOTSUP') as NodeJS.ErrnoException;
            err.code = 'ENOTSUP';
            throw err;
          },
        },
      }),
      prepareIsolatedJobWorkspace({
        workspaceRoot: failRoot,
        rawManifest: failManifest,
        templateBytes: psdBytes,
        assets: [],
        atomicPublicationOps: {
          linkFile: async () => {
            const err = new Error('Simulated ENOTSUP') as NodeJS.ErrnoException;
            err.code = 'ENOTSUP';
            throw err;
          },
        },
      }),
    ]);

    for (const outcome of failResults) {
      expect(outcome.status).toBe('rejected');
      if (outcome.status === 'rejected') {
        expect(outcome.reason).toBeInstanceOf(AgentWorkspaceError);
        expect((outcome.reason as AgentWorkspaceError).code).toBe(
          'ATOMIC_PUBLICATION_UNSUPPORTED'
        );
      }
    }
    const failJobDir = path.join(failRoot, 'jobs', failManifest.designJobId);
    expect(await fs.readdir(path.join(failJobDir, 'source'))).toEqual([]);
    expect(await fs.readdir(path.join(failJobDir, 'working'))).toEqual(['tmp']);
    expect(await fs.readdir(path.join(failJobDir, 'working', 'tmp'))).toEqual([]);

    // Scenario B: Deterministic staging barrier on real NTFS — Worker A stages working copy
    // and pauses BEFORE atomic hard-link while Worker B races concurrently.
    const barrierRoot = await makeTempDir('crelune-concurrent-barrier-');
    const barrierManifest = createValidManifest({
      designJobId: 'job_concurrent_barrier',
      dispatchId: 'dsp_concurrent_barrier',
      templateSha256: psdSha,
    });
    const expectedWorkingPath = path.join(
      barrierRoot,
      'jobs',
      barrierManifest.designJobId,
      'working',
      'birthday_gold_frame_dsp_concurrent_barrier_working.psd'
    );

    let markWorkerAStaged!: () => void;
    const workerAStaged = new Promise<void>((resolve) => {
      markWorkerAStaged = resolve;
    });
    let releaseWorkerA!: () => void;
    const workerAReleased = new Promise<void>((resolve) => {
      releaseWorkerA = resolve;
    });

    const workerAPromise = prepareIsolatedJobWorkspace({
      workspaceRoot: barrierRoot,
      rawManifest: barrierManifest,
      templateBytes: psdBytes,
      assets: [],
      atomicPublicationOps: {
        beforeAtomicLink: async ({ targetPath }) => {
          if (targetPath === expectedWorkingPath) {
            markWorkerAStaged();
            await workerAReleased;
          }
        },
      },
    });

    // Wait until Worker A has staged 100% of bytes in working/tmp/ but NOT linked yet
    await workerAStaged;
    // Target working copy MUST NOT be visible while Worker A is still staged
    await expect(fs.access(expectedWorkingPath)).rejects.toMatchObject({
      code: 'ENOENT',
    });

    // Worker B runs concurrently and atomically publishes via real NTFS hard link
    const workerBResult = await prepareIsolatedJobWorkspace({
      workspaceRoot: barrierRoot,
      rawManifest: barrierManifest,
      templateBytes: psdBytes,
      assets: [],
    });
    expect(workerBResult.workingCopyStatus).toBe('CREATED');
    expect(workerBResult.workingCopySha256).toBe(psdSha);

    // Release Worker A -> encounters EEXIST on atomic hard link, sees complete published file,
    // and classifies strictly as PRESERVED_UNCHANGED (NEVER PRESERVED_WITH_ARTIST_EDITS!)
    releaseWorkerA();
    const workerAResult = await workerAPromise;
    expect(workerAResult.workingCopyStatus).toBe('PRESERVED_UNCHANGED');
    expect(workerAResult.workingCopySha256).toBe(psdSha);
    expect(await fs.readdir(workerBResult.tempDir)).toEqual([]);
  });

  it('handles temporary staging cleanup deterministically: success, ENOENT, transient retries, retry exhaustion, and post-publication link cleanup failure', async () => {
    const tempDir = await makeTempDir('crelune-cleanup-unit-');
    const noSleep = async () => {};

    // 1. Successful temporary-file cleanup
    const file1 = path.join(tempDir, '.stage_success.tmp');
    await fs.writeFile(file1, 'staged-bytes');
    const res1 = await safeUnlinkTempFile(file1, { sleep: noSleep });
    expect(res1).toEqual({ removed: true, alreadyMissing: false, attempts: 1 });
    await expect(fs.access(file1)).rejects.toMatchObject({ code: 'ENOENT' });

    // 2. ENOENT treated as successful cleanup
    const missingFile = path.join(tempDir, '.stage_missing.tmp');
    const res2 = await safeUnlinkTempFile(missingFile, { sleep: noSleep });
    expect(res2).toEqual({ removed: true, alreadyMissing: true, attempts: 1 });

    // 3. Transient Windows EBUSY / EPERM / EACCES retries followed by successful cleanup
    const file3 = path.join(tempDir, '.stage_transient.tmp');
    await fs.writeFile(file3, 'staged-bytes');
    const sleepCalls: number[] = [];
    const transientCodes = ['EBUSY', 'EPERM', 'EACCES'] as const;
    let transientIdx = 0;
    const res3 = await safeUnlinkTempFile(file3, {
      sleep: async (ms) => {
        sleepCalls.push(ms);
      },
      unlinkFile: async (p) => {
        if (transientIdx < transientCodes.length) {
          const code = transientCodes[transientIdx++]!;
          const err = new Error(`Transient ${code}`) as NodeJS.ErrnoException;
          err.code = code;
          throw err;
        }
        await fs.unlink(p);
      },
    });
    expect(res3).toEqual({ removed: true, alreadyMissing: false, attempts: 4 });
    expect(sleepCalls).toEqual([20, 40, 60]);
    await expect(fs.access(file3)).rejects.toMatchObject({ code: 'ENOENT' });

    // 4a. Persistent EBUSY after all retries surfaces typed STAGING_CLEANUP_FAILED
    const file4 = path.join(tempDir, '.stage_locked.tmp');
    await fs.writeFile(file4, 'still-locked');
    const retrySleeps: number[] = [];
    let exhaustedErr: unknown;
    try {
      await safeUnlinkTempFile(file4, {
        sleep: async (ms) => {
          retrySleeps.push(ms);
        },
        unlinkFile: async () => {
          const err = new Error('Persistent EBUSY') as NodeJS.ErrnoException;
          err.code = 'EBUSY';
          throw err;
        },
      });
    } catch (err) {
      exhaustedErr = err;
    }
    expect(exhaustedErr).toBeInstanceOf(AgentWorkspaceError);
    const cleanupWsErr = exhaustedErr as AgentWorkspaceError;
    expect(cleanupWsErr.code).toBe('STAGING_CLEANUP_FAILED');
    expect(cleanupWsErr.errnoCode).toBe('EBUSY');
    expect(cleanupWsErr.attempts).toBe(4);
    expect(cleanupWsErr.targetPublished).toBe(false);
    expect(cleanupWsErr.stagedPath).toBe(file4);
    expect(cleanupWsErr.cleanupError).toBeDefined();
    expect(cleanupWsErr.message).not.toContain(tempDir);
    expect(retrySleeps).toEqual([20, 40, 60]);
    // Staged file genuinely remained on disk (never falsely reported clean)
    await expect(fs.access(file4)).resolves.toBeUndefined();
    await fs.unlink(file4);

    // 4b. Non-transient error (EIO) fails immediately on attempt 1 without pointless retries
    let nonTransientAttempts = 0;
    await expect(
      safeUnlinkTempFile(path.join(tempDir, '.stage_eio.tmp'), {
        sleep: noSleep,
        unlinkFile: async () => {
          nonTransientAttempts += 1;
          const err = new Error('Disk EIO') as NodeJS.ErrnoException;
          err.code = 'EIO';
          throw err;
        },
      })
    ).rejects.toMatchObject({
      name: 'AgentWorkspaceError',
      code: 'STAGING_CLEANUP_FAILED',
      errnoCode: 'EIO',
      attempts: 1,
      targetPublished: false,
    });
    expect(nonTransientAttempts).toBe(1);

    // 7. Hard-link publication succeeds, then staging-link cleanup persistently fails:
    // MUST throw STAGING_LINK_CLEANUP_FAILED_AFTER_PUBLICATION with targetPublished: true
    // and MUST NOT misleadingly claim the target was not published!
    const pubRoot = await makeTempDir('crelune-postpub-cleanup-');
    const psdBytes = createSyntheticPsdBytes();
    const psdSha = computeSha256Hex(psdBytes);
    const pubManifest = createValidManifest({
      designJobId: 'job_postpub_cleanup',
      dispatchId: 'dsp_postpub_cleanup',
      templateSha256: psdSha,
    });
    const pubJobDir = path.join(pubRoot, 'jobs', pubManifest.designJobId);
    const expectedMasterPath = path.join(pubJobDir, 'source', 'birthday_gold_frame.psd');
    const expectedWorkingPath = path.join(
      pubJobDir,
      'working',
      'birthday_gold_frame_dsp_postpub_cleanup_working.psd'
    );

    let workingStagedPath: string | null = null;
    let postPubErr: unknown;
    try {
      await prepareIsolatedJobWorkspace({
        workspaceRoot: pubRoot,
        rawManifest: pubManifest,
        templateBytes: psdBytes,
        assets: [],
        atomicPublicationOps: {
          sleep: noSleep,
          beforeAtomicLink: async ({ stagedPath, targetPath }) => {
            if (targetPath === expectedWorkingPath) {
              workingStagedPath = stagedPath;
            }
          },
          unlinkFile: async (p) => {
            if (workingStagedPath && p === workingStagedPath) {
              const err = new Error('AV scanner lock EBUSY') as NodeJS.ErrnoException;
              err.code = 'EBUSY';
              throw err;
            }
            await fs.unlink(p);
          },
        },
      });
    } catch (err) {
      postPubErr = err;
    }

    expect(postPubErr).toBeInstanceOf(AgentWorkspaceError);
    const postPubWsErr = postPubErr as AgentWorkspaceError;
    expect(postPubWsErr.code).toBe('STAGING_LINK_CLEANUP_FAILED_AFTER_PUBLICATION');
    expect(postPubWsErr.targetPublished).toBe(true);
    expect(postPubWsErr.targetPath).toBe(expectedWorkingPath);
    expect(postPubWsErr.stagedPath).toBe(workingStagedPath);
    expect(postPubWsErr.errnoCode).toBe('EBUSY');
    expect(postPubWsErr.attempts).toBe(4);
    expect(postPubWsErr.cleanupError).toBeDefined();
    expect(postPubWsErr.message).toMatch(/published atomically/i);
    expect(postPubWsErr.message).not.toContain(pubRoot);

    // Verify published target AND master genuinely exist intact on disk with exact SHA-256
    expect(
      (
        await verifyMasterTemplateIntegrity({
          masterSourcePath: expectedMasterPath,
          expectedSha256: psdSha,
        })
      ).ok
    ).toBe(true);
    expect(computeSha256Hex(await fs.readFile(expectedWorkingPath))).toBe(psdSha);
    // Staging hard link genuinely remained in working/tmp/ (link count === 2) until cleaned
    expect((await fs.stat(expectedWorkingPath)).nlink).toBe(2);
    expect(await fs.readdir(path.join(pubJobDir, 'working', 'tmp'))).toHaveLength(1);
    expect(await cleanupWorkspaceTempFiles(pubRoot, pubManifest.designJobId)).toBe(1);
    expect(await fs.readdir(path.join(pubJobDir, 'working', 'tmp'))).toEqual([]);
    expect((await fs.stat(expectedWorkingPath)).nlink).toBe(1);
  });

  it('aborts staging on sync or close failure, never publishes target, preserves both primary and cleanup errors, and protects existing creative files', async () => {
    const noSleep = async () => {};
    const psdBytes = createSyntheticPsdBytes();
    const psdSha = computeSha256Hex(psdBytes);
    const photoBytes = createMinimalValidJpegBytes(320, 320);
    const photoSha = computeSha256Hex(photoBytes);

    // 5 & 9. Sync failure before publication -> handle closed, temp deleted, fs.link NEVER called, no target published
    const syncRoot = await makeTempDir('crelune-sync-fail-');
    const syncManifest = createValidManifest({
      designJobId: 'job_sync_fail',
      dispatchId: 'dsp_sync_fail',
      templateSha256: psdSha,
    });
    const linkSpy = vi.fn(async (a: string, b: string) => fs.link(a, b));
    let syncHandleClosed = false;

    let syncErr: unknown;
    try {
      await prepareIsolatedJobWorkspace({
        workspaceRoot: syncRoot,
        rawManifest: syncManifest,
        templateBytes: psdBytes,
        assets: [],
        atomicPublicationOps: {
          sleep: noSleep,
          linkFile: linkSpy,
          openFile: async (p, flags, mode) => {
            const real = await fs.open(p, flags, mode);
            return {
              writeFile: (data) => real.writeFile(data),
              sync: async () => {
                const err = new Error('Simulated fsync EIO') as NodeJS.ErrnoException;
                err.code = 'EIO';
                throw err;
              },
              close: async () => {
                syncHandleClosed = true;
                await real.close();
              },
            };
          },
        },
      });
    } catch (err) {
      syncErr = err;
    }

    expect(syncErr).toBeInstanceOf(AgentWorkspaceError);
    const syncWsErr = syncErr as AgentWorkspaceError;
    expect(syncWsErr.code).toBe('STAGING_SYNC_FAILED');
    expect(syncWsErr.errnoCode).toBe('EIO');
    expect(syncWsErr.targetPublished).toBe(false);
    expect(syncWsErr.cause).toBeInstanceOf(Error);
    expect(syncWsErr.cleanupError).toBeUndefined();
    expect(syncHandleClosed).toBe(true);
    expect(linkSpy).not.toHaveBeenCalled();

    const syncJobDir = path.join(syncRoot, 'jobs', syncManifest.designJobId);
    expect(await fs.readdir(path.join(syncJobDir, 'source'))).toEqual([]);
    expect(await fs.readdir(path.join(syncJobDir, 'working'))).toEqual(['tmp']);
    expect(await fs.readdir(path.join(syncJobDir, 'working', 'tmp'))).toEqual([]);

    // 5b. Sync failure + cleanup failure simultaneously -> preserves BOTH sync cause AND cleanupError!
    const bothRoot = await makeTempDir('crelune-sync-cleanup-both-');
    const bothManifest = createValidManifest({
      designJobId: 'job_sync_and_cleanup_fail',
      dispatchId: 'dsp_sync_and_cleanup_fail',
      templateSha256: psdSha,
    });
    const syncOrigErr = Object.assign(new Error('Original sync EIO'), {
      code: 'EIO',
    });
    const unlinkOrigErr = Object.assign(new Error('Persistent unlink EPERM'), {
      code: 'EPERM',
    });
    const linkSpy2 = vi.fn(async (a: string, b: string) => fs.link(a, b));

    let bothErr: unknown;
    try {
      await prepareIsolatedJobWorkspace({
        workspaceRoot: bothRoot,
        rawManifest: bothManifest,
        templateBytes: psdBytes,
        assets: [],
        atomicPublicationOps: {
          sleep: noSleep,
          linkFile: linkSpy2,
          openFile: async (p, flags, mode) => {
            const real = await fs.open(p, flags, mode);
            return {
              writeFile: (data) => real.writeFile(data),
              sync: async () => {
                throw syncOrigErr;
              },
              close: () => real.close(),
            };
          },
          unlinkFile: async () => {
            throw unlinkOrigErr;
          },
        },
      });
    } catch (err) {
      bothErr = err;
    }

    expect(bothErr).toBeInstanceOf(AgentWorkspaceError);
    const bothWsErr = bothErr as AgentWorkspaceError;
    expect(bothWsErr.code).toBe('STAGING_SYNC_FAILED');
    expect(bothWsErr.errnoCode).toBe('EIO');
    expect(bothWsErr.targetPublished).toBe(false);
    expect(bothWsErr.cause).toBe(syncOrigErr);
    expect(bothWsErr.cleanupError).toBeInstanceOf(AgentWorkspaceError);
    expect((bothWsErr.cleanupError as AgentWorkspaceError).code).toBe(
      'STAGING_CLEANUP_FAILED'
    );
    expect((bothWsErr.cleanupError as AgentWorkspaceError).cause).toBe(unlinkOrigErr);
    expect(bothWsErr.message).toMatch(/synchronization failed \(EIO\)/i);
    expect(bothWsErr.message).toMatch(/staging file also failed \(EPERM\)/i);
    expect(linkSpy2).not.toHaveBeenCalled();
    expect(
      await fs.readdir(
        path.join(bothRoot, 'jobs', bothManifest.designJobId, 'source')
      )
    ).toEqual([]);

    // 6a. Close failure after write + sync -> cleans up temp file, never double-closes, never links
    const closeRoot = await makeTempDir('crelune-close-fail-');
    const closeManifest = createValidManifest({
      designJobId: 'job_close_fail',
      dispatchId: 'dsp_close_fail',
      templateSha256: psdSha,
    });
    let closeCalls = 0;
    const closeOrigErr = Object.assign(new Error('Simulated close EIO'), {
      code: 'EIO',
    });
    const linkSpy3 = vi.fn(async (a: string, b: string) => fs.link(a, b));

    let closeErr: unknown;
    try {
      await prepareIsolatedJobWorkspace({
        workspaceRoot: closeRoot,
        rawManifest: closeManifest,
        templateBytes: psdBytes,
        assets: [],
        atomicPublicationOps: {
          sleep: noSleep,
          linkFile: linkSpy3,
          openFile: async (p, flags, mode) => {
            const real = await fs.open(p, flags, mode);
            return {
              writeFile: (data) => real.writeFile(data),
              sync: () => real.sync(),
              close: async () => {
                closeCalls += 1;
                await real.close();
                throw closeOrigErr;
              },
            };
          },
        },
      });
    } catch (err) {
      closeErr = err;
    }

    expect(closeErr).toBeInstanceOf(AgentWorkspaceError);
    const closeWsErr = closeErr as AgentWorkspaceError;
    expect(closeWsErr.code).toBe('STAGING_WRITE_FAILED');
    expect(closeWsErr.targetPublished).toBe(false);
    expect(closeWsErr.cause).toBe(closeOrigErr);
    expect(closeCalls).toBe(1);
    expect(linkSpy3).not.toHaveBeenCalled();
    const closeJobDir = path.join(closeRoot, 'jobs', closeManifest.designJobId);
    expect(await fs.readdir(path.join(closeJobDir, 'source'))).toEqual([]);
    expect(await fs.readdir(path.join(closeJobDir, 'working', 'tmp'))).toEqual([]);

    // 6b. Write failure + close failure + cleanup failure preserves all three errors
    const tripleRoot = await makeTempDir('crelune-triple-fail-');
    const tripleManifest = createValidManifest({
      designJobId: 'job_triple_fail',
      dispatchId: 'dsp_triple_fail',
      templateSha256: psdSha,
    });
    const writeFailErr = Object.assign(new Error('ENOSPC'), { code: 'ENOSPC' });
    const closeFailErr = Object.assign(new Error('EBADF'), { code: 'EBADF' });
    const unlinkFailErr = Object.assign(new Error('EACCES'), { code: 'EACCES' });

    let tripleErr: unknown;
    try {
      await prepareIsolatedJobWorkspace({
        workspaceRoot: tripleRoot,
        rawManifest: tripleManifest,
        templateBytes: psdBytes,
        assets: [],
        atomicPublicationOps: {
          sleep: noSleep,
          openFile: async (p, flags, mode) => {
            const real = await fs.open(p, flags, mode);
            return {
              writeFile: async () => {
                throw writeFailErr;
              },
              sync: () => real.sync(),
              close: async () => {
                await real.close();
                throw closeFailErr;
              },
            };
          },
          unlinkFile: async () => {
            throw unlinkFailErr;
          },
        },
      });
    } catch (err) {
      tripleErr = err;
    }

    expect(tripleErr).toBeInstanceOf(AgentWorkspaceError);
    const tripleWsErr = tripleErr as AgentWorkspaceError;
    expect(tripleWsErr.code).toBe('STAGING_WRITE_FAILED');
    expect(tripleWsErr.cause).toBe(writeFailErr);
    expect(tripleWsErr.closeError).toBe(closeFailErr);
    expect(tripleWsErr.cleanupError).toBeInstanceOf(AgentWorkspaceError);
    expect((tripleWsErr.cleanupError as AgentWorkspaceError).cause).toBe(
      unlinkFailErr
    );

    // 8 & 9b. Existing working copies (artist edits), source masters, and exports survive
    // sync failures and atomic-rename + cleanup failures across explicit replacement, assets,
    // manifest.json, and PREPARATION_GUIDE.txt!
    const preserveRoot = await makeTempDir('crelune-durability-preserve-');
    const preserveManifest = createValidManifest({
      designJobId: 'job_durability_preserve',
      dispatchId: 'dsp_durability_preserve',
      templateSha256: psdSha,
      assetSha256: photoSha,
    });
    const initial = await prepareIsolatedJobWorkspace({
      workspaceRoot: preserveRoot,
      rawManifest: preserveManifest,
      templateBytes: psdBytes,
      assets: [
        {
          assetId: 'mem_kofi_01',
          relativeFilename: 'assets/kofi_photo.jpg',
          bytes: photoBytes,
          expectedSha256: photoSha,
        },
      ],
    });

    const artistEditedBytes = Buffer.concat([
      Buffer.from(psdBytes),
      Buffer.from('ARTIST_EDITS_PROTECTED_ON_SYNC_AND_CLEANUP_FAIL'),
    ]);
    await fs.writeFile(initial.workingCopyPath, artistEditedBytes);
    const exportBytes = createMinimalValidPngBytes(1080, 1350);
    const existingExportPath = path.join(initial.exportsDir, 'keep-export.png');
    await fs.writeFile(existingExportPath, exportBytes);
    const originalManifestText = await fs.readFile(initial.manifestPath, 'utf8');

    // 8a. Sync failure during explicit working-copy replacement (3rd stage: master, working EEXIST, then replace!)
    let openCount = 0;
    const renameSpy = vi.fn(async (a: string, b: string) => fs.rename(a, b));
    await expect(
      prepareIsolatedJobWorkspace({
        workspaceRoot: preserveRoot,
        rawManifest: preserveManifest,
        templateBytes: psdBytes,
        assets: [],
        explicitWorkingCopyReplacementApproval: {
          approvedByUser: true,
          confirmationToken: WORKING_COPY_REPLACEMENT_CONFIRMATION_TOKEN,
          reason: 'Artist requested replacement test.',
        },
        atomicPublicationOps: {
          sleep: noSleep,
          renameFile: renameSpy,
          openFile: async (p, flags, mode) => {
            openCount += 1;
            const real = await fs.open(p, flags, mode);
            const failThisSync = openCount === 3;
            return {
              writeFile: (data) => real.writeFile(data),
              sync: async () => {
                if (failThisSync) {
                  const err = new Error('Replace sync EIO') as NodeJS.ErrnoException;
                  err.code = 'EIO';
                  throw err;
                }
                await real.sync();
              },
              close: () => real.close(),
            };
          },
        },
      })
    ).rejects.toMatchObject({
      name: 'AgentWorkspaceError',
      code: 'STAGING_SYNC_FAILED',
      errnoCode: 'EIO',
      targetPublished: false,
    });
    expect(renameSpy).not.toHaveBeenCalled();

    // 8b. Atomic rename failure + cleanup failure on manifest.json preserves BOTH errors!
    const manifestRenameErr = Object.assign(new Error('Rename EPERM'), {
      code: 'EPERM',
    });
    const manifestUnlinkErr = Object.assign(new Error('Cleanup EBUSY'), {
      code: 'EBUSY',
    });
    let manifestStagedPath: string | null = null;
    let manifestCombinedErr: unknown;
    try {
      await prepareIsolatedJobWorkspace({
        workspaceRoot: preserveRoot,
        rawManifest: preserveManifest,
        templateBytes: psdBytes,
        assets: [],
        atomicPublicationOps: {
          sleep: noSleep,
          renameFile: async (oldPath, newPath) => {
            if (newPath === initial.manifestPath) {
              manifestStagedPath = oldPath;
              throw manifestRenameErr;
            }
            await fs.rename(oldPath, newPath);
          },
          unlinkFile: async (p) => {
            if (manifestStagedPath && p === manifestStagedPath) {
              throw manifestUnlinkErr;
            }
            await fs.unlink(p);
          },
        },
      });
    } catch (err) {
      manifestCombinedErr = err;
    }
    expect(manifestCombinedErr).toBeInstanceOf(AgentWorkspaceError);
    const manifestWsErr = manifestCombinedErr as AgentWorkspaceError;
    expect(manifestWsErr.code).toBe('ATOMIC_PUBLICATION_FAILED');
    expect(manifestWsErr.cause).toBe(manifestRenameErr);
    expect(manifestWsErr.cleanupError).toBeInstanceOf(AgentWorkspaceError);
    expect((manifestWsErr.cleanupError as AgentWorkspaceError).cause).toBe(
      manifestUnlinkErr
    );
    expect(await cleanupWorkspaceTempFiles(preserveRoot, initial.jobId)).toBe(1);

    // 8c. Existing target (EEXIST) + cleanup failure surfaces STAGING_CLEANUP_FAILED without touching existing files
    await expect(
      prepareIsolatedJobWorkspace({
        workspaceRoot: preserveRoot,
        rawManifest: preserveManifest,
        templateBytes: psdBytes,
        assets: [],
        atomicPublicationOps: {
          sleep: noSleep,
          unlinkFile: async () => {
            const err = new Error('Locked EBUSY') as NodeJS.ErrnoException;
            err.code = 'EBUSY';
            throw err;
          },
        },
      })
    ).rejects.toMatchObject({
      name: 'AgentWorkspaceError',
      code: 'STAGING_CLEANUP_FAILED',
      errnoCode: 'EBUSY',
      targetPublished: false,
    });
    expect(await cleanupWorkspaceTempFiles(preserveRoot, initial.jobId)).toBe(1);

    // Existing working copy (artist edits), source master, export, and manifest remain 100% intact!
    expect(
      Buffer.compare(await fs.readFile(initial.workingCopyPath), artistEditedBytes)
    ).toBe(0);
    expect(
      (
        await verifyMasterTemplateIntegrity({
          masterSourcePath: initial.masterSourcePath,
          expectedSha256: psdSha,
        })
      ).ok
    ).toBe(true);
    expect(
      Buffer.compare(
        await fs.readFile(existingExportPath),
        Buffer.from(exportBytes)
      )
    ).toBe(0);
    expect(await fs.readFile(initial.manifestPath, 'utf8')).toBe(
      originalManifestText
    );
    expect(await fs.readdir(initial.tempDir)).toEqual([]);

    // 10. Concurrent preparation where one worker fails sync while another succeeds via real NTFS hard link
    const concRoot = await makeTempDir('crelune-concurrent-sync-race-');
    const concManifest = createValidManifest({
      designJobId: 'job_conc_sync_race',
      dispatchId: 'dsp_conc_sync_race',
      templateSha256: psdSha,
    });
    const [failingOutcome, healthyOutcome] = await Promise.allSettled([
      prepareIsolatedJobWorkspace({
        workspaceRoot: concRoot,
        rawManifest: concManifest,
        templateBytes: psdBytes,
        assets: [],
        atomicPublicationOps: {
          sleep: noSleep,
          openFile: async (p, flags, mode) => {
            const real = await fs.open(p, flags, mode);
            return {
              writeFile: (data) => real.writeFile(data),
              sync: async () => {
                const err = new Error('Simulated concurrent sync EIO') as NodeJS.ErrnoException;
                err.code = 'EIO';
                throw err;
              },
              close: () => real.close(),
            };
          },
        },
      }),
      prepareIsolatedJobWorkspace({
        workspaceRoot: concRoot,
        rawManifest: concManifest,
        templateBytes: psdBytes,
        assets: [],
      }),
    ]);

    expect(failingOutcome.status).toBe('rejected');
    if (failingOutcome.status === 'rejected') {
      expect(failingOutcome.reason).toBeInstanceOf(AgentWorkspaceError);
      expect((failingOutcome.reason as AgentWorkspaceError).code).toBe(
        'STAGING_SYNC_FAILED'
      );
    }
    expect(healthyOutcome.status).toBe('fulfilled');
    if (healthyOutcome.status === 'fulfilled') {
      expect(healthyOutcome.value.workingCopyStatus).toBe('CREATED');
      expect(healthyOutcome.value.workingCopySha256).toBe(psdSha);
      expect(healthyOutcome.value.masterVerified).toBe(true);
      expect(await fs.readdir(healthyOutcome.value.tempDir)).toEqual([]);
    }
  });

  it('rejects tampered template downloads and unsupported WORKING_ASSET manifests before touching disk', async () => {
    const workspaceRoot = await makeTempDir('crelune-reject-');
    const psdBytes = createSyntheticPsdBytes();
    const psdSha = computeSha256Hex(psdBytes);
    const manifest = createValidManifest({ templateSha256: psdSha });

    const badBytes = new Uint8Array(psdBytes);
    badBytes[10] ^= 0xff;
    await expect(
      prepareIsolatedJobWorkspace({
        workspaceRoot,
        rawManifest: manifest,
        templateBytes: badBytes,
        assets: [],
      })
    ).rejects.toThrow(/SHA-256 mismatch/i);

    // Unsupported WORKING_ASSET kind MUST be rejected at schema parse before touching workspace
    const unsupportedManifest = {
      ...manifest,
      fields: [
        {
          fieldKey: 'custom.brand_logo',
          fieldType: 'IMAGE',
          targetLayerName: 'LOGO',
          layerPath: null,
          textValue: null,
          assetReference: {
            assetKind: 'WORKING_ASSET',
            assetId: 'asset_123',
            expectedSha256: null,
            suggestedRelativeFilename: 'assets/logo.png',
          },
        },
      ],
    };
    await expect(
      prepareIsolatedJobWorkspace({
        workspaceRoot,
        rawManifest: unsupportedManifest,
        templateBytes: psdBytes,
        assets: [],
      })
    ).rejects.toThrow();
  });

  it('gates Affinity launch behind explicit approval, allowlists executable path, and supports opt-in MCP fallback', async () => {
    expect(
      isAllowlistedAffinityExecutable(
        'C:\\Users\\Alice\\AppData\\Local\\Microsoft\\WindowsApps\\Affinity.exe'
      )
    ).toBe(true);
    expect(isAllowlistedAffinityExecutable('C:\\Windows\\System32\\cmd.exe')).toBe(
      false
    );
    expect(isAllowlistedAffinityExecutable('C:\\Temp\\Affinity.exe')).toBe(false);

    const workspaceRoot = await makeTempDir('crelune-handoff-');
    const psdBytes = createSyntheticPsdBytes();
    const psdSha = computeSha256Hex(psdBytes);
    const manifest = createValidManifest({ templateSha256: psdSha });
    const ws = await prepareIsolatedJobWorkspace({
      workspaceRoot,
      rawManifest: manifest,
      templateBytes: psdBytes,
      assets: [],
    });

    const fakeEnv = {
      platform: 'win32' as const,
      installed: true,
      packageName: 'Canva.Affinity',
      version: '3.3.3.5004',
      executableAliasPath:
        'C:\\Users\\Owner\\AppData\\Local\\Microsoft\\WindowsApps\\Affinity.exe',
      aliasExists: true,
      scriptingEnabled: false,
      mcpServerEnabled: false,
      notes: [],
    };
    const mockLaunch = vi.fn().mockResolvedValue({ launched: true, pid: 4242 });

    const declined = await executeSafeAffinityHandoff({
      workspace: ws,
      manifest,
      envReport: fakeEnv,
      allowInteractiveLaunch: true,
      mcpOptInEnabled: false,
      mcpLoopbackUrl: 'http://127.0.0.1:33001/sse',
      requestUserApproval: async () => false,
      launcher: { launchAllowlistedAffinity: mockLaunch },
    });
    expect(declined.executionMode).toBe('MANUAL');
    expect(declined.launchedAffinity).toBe(false);
    expect(mockLaunch).not.toHaveBeenCalled();

    const approved = await executeSafeAffinityHandoff({
      workspace: ws,
      manifest,
      envReport: fakeEnv,
      allowInteractiveLaunch: true,
      mcpOptInEnabled: true,
      mcpLoopbackUrl: 'http://127.0.0.1:1/sse',
      requestUserApproval: async () => true,
      launcher: { launchAllowlistedAffinity: mockLaunch },
    });
    expect(approved.executionMode).toBe('ASSISTED');
    expect(approved.launchedAffinity).toBe(true);
    expect(approved.mcpAttempted).toBe(true);
    expect(approved.mcpReachable).toBe(false);
    expect(mockLaunch).toHaveBeenCalledWith(
      fakeEnv.executableAliasPath,
      ws.workingCopyPath
    );
  });

  it('validates PNG, JPEG, and PDF exports strictly inside exports/ and blocks spoofed files or tampered masters', async () => {
    const workspaceRoot = await makeTempDir('crelune-export-');
    const psdBytes = createSyntheticPsdBytes();
    const psdSha = computeSha256Hex(psdBytes);
    const manifest = createValidManifest({ templateSha256: psdSha });
    const ws = await prepareIsolatedJobWorkspace({
      workspaceRoot,
      rawManifest: manifest,
      templateBytes: psdBytes,
      assets: [],
    });

    await fs.writeFile(
      path.join(ws.exportsDir, 'flyer.png'),
      createMinimalValidPngBytes(1080, 1350)
    );
    await fs.writeFile(
      path.join(ws.exportsDir, 'flyer.jpg'),
      createMinimalValidJpegBytes(800, 600)
    );
    await fs.writeFile(
      path.join(ws.exportsDir, 'print.pdf'),
      createMinimalValidPdfBytes()
    );
    await fs.writeFile(
      path.join(ws.exportsDir, 'spoofed.png'),
      Buffer.from('MZ\x90\x00not-a-png-executable')
    );
    await fs.writeFile(path.join(ws.exportsDir, 'script.exe'), Buffer.from('MZ'));

    const png = await validateLocalExportDeliverable({
      workspaceRoot,
      jobId: ws.jobId,
      exportFilename: 'flyer.png',
      masterSourcePath: ws.masterSourcePath,
      expectedMasterSha256: psdSha,
    });
    expect(png.format).toBe('PNG');
    expect(png.widthPx).toBe(1080);

    expect(
      (
        await validateLocalExportDeliverable({
          workspaceRoot,
          jobId: ws.jobId,
          exportFilename: 'flyer.jpg',
        })
      ).format
    ).toBe('JPEG');

    expect(
      (
        await validateLocalExportDeliverable({
          workspaceRoot,
          jobId: ws.jobId,
          exportFilename: 'print.pdf',
        })
      ).format
    ).toBe('PDF');

    await expect(
      validateLocalExportDeliverable({
        workspaceRoot,
        jobId: ws.jobId,
        exportFilename: 'spoofed.png',
      })
    ).rejects.toThrow(/valid PNG signature/i);

    await expect(
      validateLocalExportDeliverable({
        workspaceRoot,
        jobId: ws.jobId,
        exportFilename: 'script.exe',
      })
    ).rejects.toThrow(/Unsupported export extension/i);

    await expect(
      validateLocalExportDeliverable({
        workspaceRoot,
        jobId: ws.jobId,
        exportFilename: '../manifest.json',
      })
    ).rejects.toThrow(AgentPathSecurityError);

    await fs.chmod(ws.masterSourcePath, 0o666);
    await fs.writeFile(ws.masterSourcePath, Buffer.from('corrupted-master'));
    await expect(
      validateLocalExportDeliverable({
        workspaceRoot,
        jobId: ws.jobId,
        exportFilename: 'flyer.png',
        masterSourcePath: ws.masterSourcePath,
        expectedMasterSha256: psdSha,
      })
    ).rejects.toThrow(/Master template integrity check failed/i);
  });
});

describe('Windows Creative Agent — End-to-End Claim Fencing, Lease Renewal, Export & Revocation', () => {
  it('sends mandatory X-Crelune-Dispatch-Claim header on every dispatch request, renews lease, submits verified export, and halts cleanly on 401 revocation', async () => {
    const workspaceRoot = await makeTempDir('crelune-e2e-');
    const psdBytes = createSyntheticPsdBytes();
    const psdSha = computeSha256Hex(psdBytes);
    const photoBytes = createMinimalValidJpegBytes(320, 320);
    const photoSha = computeSha256Hex(photoBytes);
    const manifest = createValidManifest({
      templateSha256: psdSha,
      assetSha256: photoSha,
    });
    const validToken = `cln_agent_${'a'.repeat(64)}`;
    const activeClaimToken = `clm_${'c'.repeat(48)}`;

    let revoked = false;
    let claimedOnce = false;
    let leaseRenewCount = 0;
    const statusEvents: string[] = [];
    const uploadedExport: { bytes: Buffer | null } = { bytes: null };

    const server = http.createServer(async (req, res) => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');

      if (req.method === 'PUT' && url.pathname === '/presigned-export') {
        const chunks: Buffer[] = [];
        for await (const chunk of req) chunks.push(Buffer.from(chunk));
        uploadedExport.bytes = Buffer.concat(chunks);
        res.writeHead(200);
        res.end();
        return;
      }

      if (revoked || req.headers.authorization !== `Bearer ${validToken}`) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Unauthorized: Agent revoked.' }));
        return;
      }

      const readJson = async () => {
        const chunks: Buffer[] = [];
        for await (const chunk of req) chunks.push(Buffer.from(chunk));
        return chunks.length > 0
          ? JSON.parse(Buffer.concat(chunks).toString('utf8'))
          : {};
      };

      if (req.method === 'POST' && url.pathname === '/api/agent/heartbeat') {
        await readJson();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            agent: {
              id: 'agt_1',
              name: 'Test Workstation',
              machineLabel: 'WIN11',
              tokenPrefix: validToken.slice(0, 18),
              status: 'ACTIVE',
              agentVersion: '0.1.0',
              affinityVersion: '3.3.3.5004',
              lastHeartbeatAt: new Date().toISOString(),
              revokedAt: null,
              revocationReason: null,
              createdAt: new Date().toISOString(),
            },
            serverTime: new Date().toISOString(),
          })
        );
        return;
      }

      if (req.method === 'POST' && url.pathname === '/api/agent/jobs/claim') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        if (claimedOnce) {
          res.end(JSON.stringify({ dispatch: null }));
          return;
        }
        claimedOnce = true;
        res.end(
          JSON.stringify({
            dispatch: {
              id: manifest.dispatchId,
              designJobId: manifest.designJobId,
              templateVersionId: manifest.templateVersionId,
              assignedAgentId: 'agt_1',
              manifestVersion: 1,
              status: 'CLAIMED',
              claimedAt: new Date().toISOString(),
              readyForArtistAt: null,
              completedAt: null,
              failedAt: null,
              errorCode: null,
              errorMessage: null,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            },
            manifest,
            claimToken: activeClaimToken,
            leaseExpiresAt: new Date(Date.now() + 900_000).toISOString(),
            recoveredFromStatus: null,
          })
        );
        return;
      }

      // EVERY dispatch-scoped route enforces mandatory X-Crelune-Dispatch-Claim header!
      const claimHeader = req.headers[DISPATCH_CLAIM_HEADER.toLowerCase()];
      if (claimHeader !== activeClaimToken) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            error: 'Forbidden: Invalid or missing dispatch claim header.',
            code: 'DISPATCH_CLAIM_MISMATCH',
          })
        );
        return;
      }

      if (
        req.method === 'POST' &&
        url.pathname === `/api/agent/dispatches/${manifest.dispatchId}/lease`
      ) {
        leaseRenewCount += 1;
        const nextLease = new Date(Date.now() + 900_000).toISOString();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            dispatch: {
              id: manifest.dispatchId,
              designJobId: manifest.designJobId,
              templateVersionId: manifest.templateVersionId,
              assignedAgentId: 'agt_1',
              manifestVersion: 1,
              status: 'READY_FOR_ARTIST',
              claimedAt: new Date().toISOString(),
              leaseExpiresAt: nextLease,
              readyForArtistAt: new Date().toISOString(),
              completedAt: null,
              failedAt: null,
              errorCode: null,
              errorMessage: null,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            },
            leaseExpiresAt: nextLease,
          })
        );
        return;
      }

      if (
        req.method === 'POST' &&
        url.pathname === `/api/agent/dispatches/${manifest.dispatchId}/status`
      ) {
        const body = (await readJson()) as { status: string };
        statusEvents.push(body.status);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            dispatch: {
              id: manifest.dispatchId,
              designJobId: manifest.designJobId,
              templateVersionId: manifest.templateVersionId,
              assignedAgentId: 'agt_1',
              manifestVersion: 1,
              status: body.status,
              claimedAt: new Date().toISOString(),
              readyForArtistAt: null,
              completedAt: null,
              failedAt: null,
              errorCode: null,
              errorMessage: null,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            },
            idempotentReplay: false,
          })
        );
        return;
      }

      if (
        req.method === 'GET' &&
        url.pathname === `/api/agent/dispatches/${manifest.dispatchId}/template`
      ) {
        res.writeHead(200, {
          'Content-Type': 'image/vnd.adobe.photoshop',
          'X-Content-SHA256': psdSha,
        });
        res.end(Buffer.from(psdBytes));
        return;
      }

      if (
        req.method === 'GET' &&
        url.pathname ===
        `/api/agent/dispatches/${manifest.dispatchId}/assets/mem_kofi_01`
      ) {
        res.writeHead(200, {
          'Content-Type': 'image/jpeg',
          'X-Content-SHA256': photoSha,
        });
        res.end(Buffer.from(photoBytes));
        return;
      }

      if (
        req.method === 'POST' &&
        url.pathname ===
        `/api/agent/dispatches/${manifest.dispatchId}/exports/upload-intents`
      ) {
        const body = (await readJson()) as { byteSize: number; mimeType: string };
        const addr = server.address();
        const port = typeof addr === 'object' && addr ? addr.port : 0;
        res.writeHead(201, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            intent: {
              id: 'int_exp_1',
              kind: 'EXPORT_DELIVERABLE',
              status: 'PENDING',
              expectedMimeType: body.mimeType,
              expectedByteSize: body.byteSize,
              maxAllowedBytes: 50 * 1024 * 1024,
              expiresAt: new Date(Date.now() + 900_000).toISOString(),
              verifiedAt: null,
            },
            upload: {
              url: `http://127.0.0.1:${port}/presigned-export`,
              method: 'PUT',
              expiresAt: new Date(Date.now() + 900_000).toISOString(),
              requiredHeaders: {
                'content-type': body.mimeType,
                'content-length': String(body.byteSize),
              },
            },
          })
        );
        return;
      }

      if (
        req.method === 'POST' &&
        url.pathname === `/api/agent/dispatches/${manifest.dispatchId}/exports`
      ) {
        await readJson();
        res.writeHead(201, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            exportRecord: {
              id: 'exp_1',
              designJobId: manifest.designJobId,
              dispatchId: manifest.dispatchId,
              format: 'PNG',
              mimeType: 'image/png',
              byteSize: uploadedExport.bytes?.byteLength ?? 33,
              sha256: uploadedExport.bytes
                ? computeSha256Hex(uploadedExport.bytes)
                : '0'.repeat(64),
              widthPx: 1080,
              heightPx: 1350,
              resolutionDpi: null,
              isApprovedForPublish: false,
              ownerApprovedAt: null,
              publishedAt: null,
              createdAt: new Date().toISOString(),
            },
            idempotentReplay: false,
          })
        );
        return;
      }

      res.writeHead(404);
      res.end();
    });

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const addr = server.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;

    try {
      const apiBaseUrl = `http://127.0.0.1:${port}`;
      const config = loadAgentConfig({
        apiBaseUrl,
        workspaceRoot,
        pollIntervalMs: 1000,
        heartbeatIntervalMs: 5000,
        allowInteractiveAffinityLaunch: false,
      });
      const client = new CreluneAgentApiClient({
        apiBaseUrl,
        bearerToken: validToken,
        maxRetries: 0,
      });
      const claimStore = new MemoryDispatchClaimStore();
      const runtime = new WindowsCreativeAgentRuntime({
        config,
        client,
        claimStore,
        logger: createConsoleAgentLogger(true),
        requestUserApproval: async () => false,
        detectAffinityFn: async () => ({
          platform: 'win32',
          installed: true,
          packageName: 'Canva.Affinity',
          version: '3.3.3.5004',
          executableAliasPath: null,
          aliasExists: false,
          scriptingEnabled: false,
          mcpServerEnabled: false,
          notes: [],
        }),
      });

      // Stale/wrong claim token rejected by client or server with 403
      await expect(
        client.renewDispatchLease(manifest.dispatchId, 'invalid-token')
      ).rejects.toThrow(AgentApiError);
      await expect(
        client.renewDispatchLease(manifest.dispatchId, `clm_${'0'.repeat(48)}`)
      ).rejects.toThrow(AgentApiError);

      await runtime.sendHealthHeartbeat();
      const outcome = await runtime.processSingleClaimedJob();
      expect(outcome.claimed).toBe(true);
      expect(outcome.claimToken).toBe(activeClaimToken);
      expect(statusEvents).toEqual([
        'DOWNLOADING_ASSETS',
        'OPENING_TEMPLATE',
        'READY_FOR_ARTIST',
      ]);

      // Renew active lease using stored claim token
      const renewed = await runtime.renewActiveLease({
        dispatchId: manifest.dispatchId,
      });
      expect(renewed.leaseExpiresAt).toBeTruthy();
      expect(leaseRenewCount).toBe(1);

      // Submit verified export using stored claim token
      const pngBytes = createMinimalValidPngBytes(1080, 1350);
      await fs.writeFile(
        path.join(outcome.workspace!.exportsDir, 'final.png'),
        pngBytes
      );
      const exportResult = await runtime.submitVerifiedExport({
        dispatchId: manifest.dispatchId,
        designJobId: manifest.designJobId,
        exportFilename: 'final.png',
        masterSourcePath: outcome.workspace!.masterSourcePath,
        expectedMasterSha256: psdSha,
        eventLogPath: outcome.workspace!.eventLogPath,
      });

      expect(exportResult.exportRecord.isApprovedForPublish).toBe(false);
      expect(exportResult.exportRecord.publishedAt).toBeNull();
      expect(uploadedExport.bytes?.byteLength).toBe(pngBytes.byteLength);
      // Claim cleared cleanly from store after export registration
      expect(await claimStore.loadClaim(manifest.dispatchId)).toBeNull();

      // Revoke agent credentials -> runLoop halts cleanly on 401
      revoked = true;
      await expect(runtime.runLoop()).rejects.toThrow(
        AgentAuthenticationRevokedError
      );
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
