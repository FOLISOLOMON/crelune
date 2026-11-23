import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import type { JobPrepManifest } from '@crelune/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  executeSafeAffinityHandoff,
  isAllowlistedAffinityExecutable,
} from './affinity/affinity-adapter.js';
import { detectInstalledAffinityEnvironment } from './affinity/affinity-detector.js';
import {
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
  WindowsDpapiCredentialStore,
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
  cleanupWorkspaceTempFiles,
  computeSha256Hex,
  inspectExistingWorkspaces,
  prepareIsolatedJobWorkspace,
  verifyMasterTemplateIntegrity,
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
    // Make any read-only source files writable before cleanup on Windows
    try {
      const walk = async (current: string) => {
        const entries = await fs.readdir(current, { withFileTypes: true });
        for (const entry of entries) {
          const full = path.join(current, entry.name);
          if (entry.isDirectory()) {
            await walk(full);
          } else {
            await fs.chmod(full, 0o666).catch(() => {});
          }
        }
      };
      await walk(dir);
    } catch {
      // Ignore walk errors during teardown
    }
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
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
  // PNG 8-byte signature
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buf, 0);
  // IHDR length = 13
  buf.writeUInt32BE(13, 8);
  buf.write('IHDR', 12, 'ascii');
  buf.writeUInt32BE(widthPx, 16);
  buf.writeUInt32BE(heightPx, 20);
  buf[24] = 8; // bit depth
  buf[25] = 2; // RGB
  return new Uint8Array(buf);
}

function createMinimalValidJpegBytes(widthPx: number, heightPx: number): Uint8Array {
  const buf = Buffer.from([
    0xff, 0xd8, // SOI
    0xff, 0xc0, // SOF0
    0x00, 0x0b, // segment length 11
    0x08, // precision
    (heightPx >> 8) & 0xff,
    heightPx & 0xff,
    (widthPx >> 8) & 0xff,
    widthPx & 0xff,
    0x03, // components
    0x01, 0x11, 0x00,
    0xff, 0xd9, // EOI
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
    manualModeNotice: 'Layer inspection and mapping require manual confirmation in Affinity.',
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

describe('Windows Creative Agent — Security, Path Containment, Config & Logger', () => {
  it('blocks path traversal, absolute paths, drive letters, UNC paths, and null bytes', async () => {
    const root = await makeTempDir('crelune-path-');

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

    const safe = resolveStrictlyWithinRoot(root, 'jobs', 'job_123', 'exports', 'out.png');
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

  it('redacts bearer tokens, agent secrets, presigned query signatures, and DB URLs in logs', () => {
    const raw =
      'Auth Bearer cln_agent_0123456789abcdef0123456789abcdef url https://s3.test/k?X-Amz-Signature=deadbeef&X-Amz-Credential=AKIA123 db postgresql://user:secret@host/neondb';
    const sanitized = redactSensitiveString(raw);
    expect(sanitized).not.toContain('cln_agent_0123456789abcdef');
    expect(sanitized).not.toContain('deadbeef');
    expect(sanitized).not.toContain('AKIA123');
    expect(sanitized).not.toContain('user:secret');

    const cleanMeta = sanitizeLogMeta({
      dispatchId: 'dsp_1',
      bearerToken: 'cln_agent_secret_value_123456',
      nested: { claimToken: 'clm_secret_claim_token_999' },
    }) as Record<string, unknown>;
    expect(cleanMeta.dispatchId).toBe('dsp_1');
    expect(cleanMeta.bearerToken).toBe('[REDACTED]');
    expect((cleanMeta.nested as Record<string, unknown>).claimToken).toBe('[REDACTED]');
  });
});

describe('Windows Creative Agent — Real Windows DPAPI Credential Storage', () => {
  it.skipIf(process.platform !== 'win32')(
    'encrypts bearer token with CurrentUser DPAPI, never writes plaintext to disk, decrypts accurately, and clears cleanly',
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
      expect(loaded).not.toBeNull();
      expect(loaded?.apiBaseUrl).toBe('https://crelune.example.com');
      expect(loaded?.bearerToken).toBe(token);

      await store.clear();
      expect(await store.load()).toBeNull();
    }
  );

  it('supports MemoryCredentialStore for isolated non-disk tests', async () => {
    const store = new MemoryCredentialStore();
    await store.save({
      apiBaseUrl: 'http://127.0.0.1:3000',
      bearerToken: 'cln_agent_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
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
      // Must remain disabled unless explicitly enabled by the owner outside CRELUNE
      expect(report.scriptingEnabled).toBe(false);
      expect(report.mcpServerEnabled).toBe(false);
    }
  );
});

describe('Windows Creative Agent — Isolated Workspace, Affinity Handoff & Export Validator', () => {
  it('materializes read-only master, rejects SHA-256 tamper, preserves source/exports on temp cleanup, and recovers workspaces', async () => {
    const workspaceRoot = await makeTempDir('crelune-ws-');
    const psdBytes = createSyntheticPsdBytes();
    const psdSha = computeSha256Hex(psdBytes);
    const photoBytes = createMinimalValidJpegBytes(400, 400);
    const photoSha = computeSha256Hex(photoBytes);
    const manifest = createValidManifest({
      templateSha256: psdSha,
      assetSha256: photoSha,
    });

    // Tampered download must fail BEFORE writing workspace files
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

    const ws = await prepareIsolatedJobWorkspace({
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

    expect(ws.masterSourcePath).toContain(`${path.sep}source${path.sep}`);
    expect(ws.workingCopyPath).toContain(`${path.sep}working${path.sep}`);
    expect(ws.downloadedAssets).toHaveLength(1);
    const guideText = await fs.readFile(ws.guidePath, 'utf8');
    expect(guideText).toContain('Kofi Mensah');
    expect(guideText).toContain('NEVER modify files inside source/');

    // Create temporary scratch file + final export file
    const scratchPath = path.join(ws.tempDir, 'scratch.tmp');
    const exportPath = path.join(ws.exportsDir, 'final.png');
    await fs.writeFile(scratchPath, 'temp-data');
    await fs.writeFile(exportPath, createMinimalValidPngBytes(1080, 1350));

    const removed = await cleanupWorkspaceTempFiles(workspaceRoot, ws.jobId);
    expect(removed).toBe(1);

    // Source master & export deliverable MUST remain untouched
    await expect(fs.access(scratchPath)).rejects.toThrow();
    const masterCheck = await verifyMasterTemplateIntegrity({
      masterSourcePath: ws.masterSourcePath,
      expectedSha256: psdSha,
    });
    expect(masterCheck.ok).toBe(true);
    await expect(fs.access(exportPath)).resolves.toBeUndefined();

    // Restart recovery inspection reports intact workspace
    const recovered = await inspectExistingWorkspaces(workspaceRoot);
    expect(recovered).toHaveLength(1);
    expect(recovered[0]).toMatchObject({
      jobId: ws.jobId,
      dispatchId: ws.dispatchId,
      masterIntegrityOk: true,
    });
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

    // 1. Declined approval -> MANUAL mode, zero process launch
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
    expect(declined.masterVerifiedBefore).toBe(true);
    expect(declined.masterVerifiedAfter).toBe(true);
    expect(mockLaunch).not.toHaveBeenCalled();

    // 2. Approved launch + unreachable opt-in loopback MCP -> ASSISTED mode opening WORKING copy only
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
    expect(mockLaunch).not.toHaveBeenCalledWith(
      expect.anything(),
      ws.masterSourcePath
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
    expect(png.heightPx).toBe(1350);

    const jpg = await validateLocalExportDeliverable({
      workspaceRoot,
      jobId: ws.jobId,
      exportFilename: 'flyer.jpg',
    });
    expect(jpg.format).toBe('JPEG');
    expect(jpg.widthPx).toBe(800);
    expect(jpg.heightPx).toBe(600);

    const pdf = await validateLocalExportDeliverable({
      workspaceRoot,
      jobId: ws.jobId,
      exportFilename: 'print.pdf',
    });
    expect(pdf.format).toBe('PDF');

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

    // Tamper master -> export submission MUST refuse
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

describe('Windows Creative Agent — End-to-End Outbound Loopback Server & Revocation Handling', () => {
  it('completes heartbeat, claim, template/asset download, workspace prep, verified export upload, and halts cleanly on 401 revocation', async () => {
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

    let revoked = false;
    let claimedOnce = false;
    const statusEvents: string[] = [];
    const uploadedExport: { bytes: Buffer | null } = { bytes: null };

    const server = http.createServer(async (req, res) => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');

      // Presigned PUT target (no Bearer auth)
      if (req.method === 'PUT' && url.pathname === '/presigned-export') {
        const chunks: Buffer[] = [];
        for await (const chunk of req) chunks.push(Buffer.from(chunk));
        uploadedExport.bytes = Buffer.concat(chunks);
        res.writeHead(200);
        res.end();
        return;
      }

      // All /api/agent/* require valid active Bearer token
      if (revoked || req.headers.authorization !== `Bearer ${validToken}`) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Unauthorized: Agent revoked.' }));
        return;
      }

      const readJson = async () => {
        const chunks: Buffer[] = [];
        for await (const chunk of req) chunks.push(Buffer.from(chunk));
        return chunks.length > 0 ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
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
            claimToken: 'clm_1234567890abcdef1234567890abcdef',
            leaseExpiresAt: new Date(Date.now() + 900_000).toISOString(),
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
        url.pathname === `/api/agent/dispatches/${manifest.dispatchId}/assets/mem_kofi_01`
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
        url.pathname === `/api/agent/dispatches/${manifest.dispatchId}/exports/upload-intents`
      ) {
        const body = (await readJson()) as { byteSize: number; mimeType: string };
        const addr = server.address();
        const port = typeof addr === 'object' && addr ? addr.port : 0;
        res.writeHead(201, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            intent: {
              id: 'int_exp_1',
              purpose: 'EXPORT_DELIVERABLE',
              status: 'PENDING',
              expectedMimeType: body.mimeType,
              expectedByteSize: body.byteSize,
              expectedSha256: 'a'.repeat(64),
              expiresAt: new Date(Date.now() + 900_000).toISOString(),
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
              originalFilename: 'final.png',
              mimeType: 'image/png',
              byteSize: uploadedExport.bytes?.byteLength ?? 33,
              sha256: uploadedExport.bytes
                ? computeSha256Hex(uploadedExport.bytes)
                : '0'.repeat(64),
              widthPx: 1080,
              heightPx: 1350,
              isApprovedForPublish: false,
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
      const runtime = new WindowsCreativeAgentRuntime({
        config,
        client,
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

      await runtime.sendHealthHeartbeat();
      const outcome = await runtime.processSingleClaimedJob();
      expect(outcome.claimed).toBe(true);
      expect(outcome.affinityResult?.executionMode).toBe('MANUAL');
      expect(statusEvents).toEqual([
        'DOWNLOADING_ASSETS',
        'OPENING_TEMPLATE',
        'READY_FOR_ARTIST',
      ]);

      // Write valid export into workspace exports/ and submit
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

      const eventsText = await fs.readFile(outcome.workspace!.eventLogPath, 'utf8');
      expect(eventsText).toContain('WORKSPACE_PREPARED');
      expect(eventsText).toContain('AFFINITY_HANDOFF_COMPLETED');
      expect(eventsText).toContain('EXPORT_REGISTERED');

      // Revoke agent credentials -> runLoop must halt cleanly with AgentAuthenticationRevokedError
      revoked = true;
      await expect(runtime.runLoop()).rejects.toThrow(
        AgentAuthenticationRevokedError
      );
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
