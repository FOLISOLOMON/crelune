/**
 * CRELUNE Windows Creative Agent — Orchestration Runtime & Daemon
 *
 * Coordinates outbound heartbeats, safe job claiming with mandatory
 * `X-Crelune-Dispatch-Claim` fencing, preservation-first isolated workspace
 * materialization, approval-gated Affinity handoff (with manual fallback),
 * explicit lease renewal, verified export submission, graceful shutdown,
 * and restart recovery.
 */

import {
  jobPrepManifestSchema,
  type CreativeAgentHeartbeatInput,
  type CreativeDispatchStatus,
  type ExportRecordSummary,
} from '@crelune/shared';
import {
  AGENT_VERSION,
  type AgentRuntimeConfig,
} from '../config/agent-config.js';
import {
  executeSafeAffinityHandoff,
  type AffinityExecutionResult,
  type AffinityProcessLauncher,
  type UserApprovalProvider,
} from '../affinity/affinity-adapter.js';
import {
  detectInstalledAffinityEnvironment,
  type AffinityEnvironmentReport,
} from '../affinity/affinity-detector.js';
import {
  AgentAuthenticationRevokedError,
  CreluneAgentApiClient,
} from '../api/crelune-api-client.js';
import { validateLocalExportDeliverable } from '../exports/export-validator.js';
import {
  MemoryDispatchClaimStore,
  WindowsDpapiDispatchClaimStore,
  type DispatchClaimStore,
} from '../security/dpapi-store.js';
import {
  createConsoleAgentLogger,
  type AgentLogger,
} from '../security/logger.js';
import {
  appendWorkspaceEvent,
  cleanupWorkspaceTempFiles,
  inspectExistingWorkspaces,
  prepareIsolatedJobWorkspace,
  type MaterializedJobWorkspace,
} from '../workspace/job-workspace.js';

export interface ProcessedJobOutcome {
  claimed: boolean;
  dispatchId?: string;
  designJobId?: string;
  claimToken?: string;
  recoveredFromStatus?: CreativeDispatchStatus | null;
  preservedExistingWorkingCopy?: boolean;
  workspace?: MaterializedJobWorkspace;
  affinityResult?: AffinityExecutionResult;
}

export class WindowsCreativeAgentRuntime {
  private readonly config: AgentRuntimeConfig;
  private readonly client: CreluneAgentApiClient;
  private readonly claimStore: DispatchClaimStore;
  private readonly logger: AgentLogger;
  private readonly requestUserApproval: UserApprovalProvider;
  private readonly launcher?: AffinityProcessLauncher;
  private readonly detectAffinityFn: () => Promise<AffinityEnvironmentReport>;
  private stopped = false;

  constructor(options: {
    config: AgentRuntimeConfig;
    client: CreluneAgentApiClient;
    claimStore?: DispatchClaimStore;
    logger?: AgentLogger;
    requestUserApproval?: UserApprovalProvider;
    launcher?: AffinityProcessLauncher;
    detectAffinityFn?: () => Promise<AffinityEnvironmentReport>;
  }) {
    this.config = options.config;
    this.client = options.client;
    this.claimStore =
      options.claimStore ??
      (process.platform === 'win32'
        ? new WindowsDpapiDispatchClaimStore(options.config.configDir)
        : new MemoryDispatchClaimStore());
    this.logger = options.logger ?? createConsoleAgentLogger();
    // Safe default: never open/modify documents silently without explicit approval
    this.requestUserApproval =
      options.requestUserApproval ?? (async () => false);
    this.launcher = options.launcher;
    this.detectAffinityFn =
      options.detectAffinityFn ?? detectInstalledAffinityEnvironment;
  }

  public stop(): void {
    this.stopped = true;
    this.logger.info(
      'Shutdown requested; stopping Windows Creative Agent loop cleanly.'
    );
  }

  async sendHealthHeartbeat(): Promise<AffinityEnvironmentReport> {
    const envReport = await this.detectAffinityFn();
    const payload: CreativeAgentHeartbeatInput = {
      agentVersion: AGENT_VERSION,
      affinityVersion: envReport.version,
      supportedFormats: ['PSD', 'AF', 'AFPHOTO', 'AFDESIGN', 'AFPUB'],
      capabilities: {
        canPrepareWorkingCopy: true,
        canLaunchAllowlistedAffinity: Boolean(
          envReport.installed && envReport.executableAliasPath
        ),
        canUploadVerifiedExports: true,
        mcpOptInConfigured: this.config.affinityMcpEnabled,
      },
    };

    await this.client.sendHeartbeat(payload);
    this.logger.info('Agent heartbeat acknowledged by CRELUNE backend.', {
      agentVersion: AGENT_VERSION,
      affinityVersion: envReport.version,
      affinityInstalled: envReport.installed,
    });
    return envReport;
  }

  async recoverInterruptedWorkspaces(): Promise<number> {
    const existing = await inspectExistingWorkspaces(this.config.workspaceRoot);
    if (existing.length > 0) {
      this.logger.info('Inspected existing local job workspaces on startup.', {
        workspaceCount: existing.length,
        corruptedMasters: existing.filter((w) => !w.masterIntegrityOk).length,
        workspacesWithArtistEdits: existing.filter(
          (w) => w.workingCopyHasArtistEdits
        ).length,
      });
    }
    return existing.length;
  }

  async renewActiveLease(params: {
    dispatchId: string;
    claimToken?: string;
  }): Promise<{ leaseExpiresAt: string }> {
    const claimToken =
      params.claimToken ?? (await this.claimStore.loadClaim(params.dispatchId));
    if (!claimToken) {
      throw new Error(
        `No active encrypted dispatch claim token found for dispatch "${params.dispatchId}".`
      );
    }
    const res = await this.client.renewDispatchLease(
      params.dispatchId,
      claimToken
    );
    this.logger.info('Extended active creative job dispatch lease.', {
      dispatchId: params.dispatchId,
      leaseExpiresAt: res.leaseExpiresAt,
    });
    return { leaseExpiresAt: res.leaseExpiresAt };
  }

  async processSingleClaimedJob(): Promise<ProcessedJobOutcome> {
    const claim = await this.client.claimNextJob();
    if (!claim.dispatch) {
      return { claimed: false };
    }

    const dispatchId = claim.dispatch.id;
    const claimToken = claim.claimToken;
    const manifest = jobPrepManifestSchema.parse(claim.manifest);

    // Store active claim token encrypted (DPAPI on Windows) so follow-up CLI
    // commands (`renew-lease`, `submit-export`) can present the mandatory header
    // without ever storing plaintext tokens on disk or inside manifest.json.
    await this.claimStore.saveClaim(dispatchId, claimToken);

    this.logger.info('Claimed authorised creative job dispatch.', {
      dispatchId,
      designJobId: manifest.designJobId,
      templateId: manifest.templateId,
      templateVersionId: manifest.templateVersionId,
      recoveredFromStatus: claim.recoveredFromStatus ?? null,
    });

    try {
      await this.client.reportDispatchStatus(dispatchId, claimToken, {
        status: 'DOWNLOADING_ASSETS',
      });

      const masterDownload =
        await this.client.downloadDispatchTemplateMaster(dispatchId, claimToken);

      // Download ONLY manifest-authorised MEMBER_PHOTO assets using mandatory claim fencing
      const assetDownloads: Array<{
        assetId: string;
        relativeFilename: string;
        bytes: Uint8Array;
        expectedSha256?: string | null;
      }> = [];

      for (const field of manifest.fields) {
        if (!field.assetReference) continue;
        const downloaded = await this.client.downloadDispatchAsset(
          dispatchId,
          field.assetReference.assetId,
          claimToken
        );
        assetDownloads.push({
          assetId: field.assetReference.assetId,
          relativeFilename: field.assetReference.suggestedRelativeFilename,
          bytes: downloaded.bytes,
          expectedSha256:
            field.assetReference.expectedSha256 ?? downloaded.headerSha256,
        });
      }

      const workspace = await prepareIsolatedJobWorkspace({
        workspaceRoot: this.config.workspaceRoot,
        rawManifest: manifest,
        templateBytes: masterDownload.bytes,
        assets: assetDownloads,
      });

      await this.client.reportDispatchStatus(dispatchId, claimToken, {
        status: 'OPENING_TEMPLATE',
      });

      const envReport = await this.detectAffinityFn();
      const affinityResult = await executeSafeAffinityHandoff({
        workspace,
        manifest,
        envReport,
        allowInteractiveLaunch: this.config.allowInteractiveAffinityLaunch,
        mcpOptInEnabled: this.config.affinityMcpEnabled,
        mcpLoopbackUrl: this.config.affinityMcpUrl,
        requestUserApproval: this.requestUserApproval,
        launcher: this.launcher,
      });

      await this.client.reportDispatchStatus(dispatchId, claimToken, {
        status: 'READY_FOR_ARTIST',
        executionMode: affinityResult.executionMode,
      });

      // Safe cleanup of temporary scratch only (preserves source/, working/, and exports/)
      await cleanupWorkspaceTempFiles(this.config.workspaceRoot, workspace.jobId);

      this.logger.info('Job workspace ready for artist creative review/export.', {
        dispatchId,
        designJobId: workspace.jobId,
        executionMode: affinityResult.executionMode,
        workingCopyStatus: workspace.workingCopyStatus,
        preservedExistingWorkingCopy: workspace.preservedExistingWorkingCopy,
        launchedAffinity: affinityResult.launchedAffinity,
      });

      return {
        claimed: true,
        dispatchId,
        designJobId: workspace.jobId,
        claimToken,
        recoveredFromStatus: claim.recoveredFromStatus ?? null,
        preservedExistingWorkingCopy: workspace.preservedExistingWorkingCopy,
        workspace,
        affinityResult,
      };
    } catch (err) {
      const errorMessage =
        err instanceof Error
          ? err.message.slice(0, 400)
          : 'Unexpected agent error while preparing workspace.';
      this.logger.error('Failed to process creative dispatch.', {
        dispatchId,
        error: errorMessage,
      });

      await this.client
        .reportDispatchStatus(dispatchId, claimToken, {
          status: 'FAILED',
          errorCode: 'WORKSPACE_PREP_FAILED',
          errorMessage,
        })
        .catch(() => {});

      await this.claimStore.clearClaim(dispatchId).catch(() => {});
      throw err;
    }
  }

  async submitVerifiedExport(params: {
    dispatchId: string;
    designJobId: string;
    exportFilename: string;
    claimToken?: string;
    masterSourcePath?: string;
    expectedMasterSha256?: string;
    eventLogPath?: string;
    idempotencyKey?: string;
  }): Promise<{ exportRecord: ExportRecordSummary; idempotentReplay: boolean }> {
    const claimToken =
      params.claimToken ?? (await this.claimStore.loadClaim(params.dispatchId));
    if (!claimToken) {
      throw new Error(
        `No active dispatch claim token found for dispatch "${params.dispatchId}". Cannot submit export without valid claim fencing.`
      );
    }

    const validated = await validateLocalExportDeliverable({
      workspaceRoot: this.config.workspaceRoot,
      jobId: params.designJobId,
      exportFilename: params.exportFilename,
      masterSourcePath: params.masterSourcePath,
      expectedMasterSha256: params.expectedMasterSha256,
    });

    const idempotencyKey =
      params.idempotencyKey ??
      `agent_exp_${params.dispatchId}_${validated.sha256.slice(0, 16)}`;

    await this.client
      .reportDispatchStatus(params.dispatchId, claimToken, {
        status: 'EXPORTING',
      })
      .catch(() => {});

    const intentRes = await this.client.createExportUploadIntent(
      params.dispatchId,
      claimToken,
      {
        designJobId: params.designJobId,
        dispatchId: params.dispatchId,
        format: validated.format,
        originalFilename: validated.filename,
        mimeType: validated.mimeType,
        byteSize: validated.byteSize,
        sha256: validated.sha256,
        idempotencyKey,
      }
    );

    await this.client.uploadBytesToPresignedTarget(
      intentRes.upload,
      validated.bytes
    );

    const registered = await this.client.completeExportUpload(
      params.dispatchId,
      claimToken,
      {
        designJobId: params.designJobId,
        dispatchId: params.dispatchId,
        uploadIntentId: intentRes.intent.id,
        format: validated.format,
        mimeType: validated.mimeType,
        widthPx: validated.widthPx,
        heightPx: validated.heightPx,
      }
    );

    await this.claimStore.clearClaim(params.dispatchId).catch(() => {});

    if (params.eventLogPath) {
      await appendWorkspaceEvent(params.eventLogPath, {
        event: 'EXPORT_REGISTERED',
        details: {
          exportRecordId: registered.exportRecord.id,
          format: validated.format,
          sha256: validated.sha256,
          idempotentReplay: registered.idempotentReplay,
        },
      });
    }

    this.logger.info(
      'Verified export registered with CRELUNE (publication remains explicit owner action).',
      {
        dispatchId: params.dispatchId,
        exportRecordId: registered.exportRecord.id,
        format: validated.format,
      }
    );

    return registered;
  }

  async runLoop(): Promise<void> {
    this.stopped = false;
    await this.recoverInterruptedWorkspaces();

    let lastHeartbeatAt = 0;
    while (!this.stopped) {
      const now = Date.now();
      try {
        if (now - lastHeartbeatAt >= this.config.heartbeatIntervalMs) {
          await this.sendHealthHeartbeat();
          lastHeartbeatAt = Date.now();
        }
        await this.processSingleClaimedJob();
      } catch (err) {
        if (err instanceof AgentAuthenticationRevokedError) {
          this.logger.error(
            'Agent credentials were revoked or rejected (401). Halting daemon cleanly; re-pair via `crelune-agent pair`.'
          );
          this.stopped = true;
          throw err;
        }
        this.logger.warn('Transient error in agent poll iteration; will retry.', {
          error: err instanceof Error ? err.message : 'Unknown error',
        });
      }

      if (!this.stopped) {
        await new Promise((resolve) =>
          setTimeout(resolve, this.config.pollIntervalMs)
        );
      }
    }
  }
}
