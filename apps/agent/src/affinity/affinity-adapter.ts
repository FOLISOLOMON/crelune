/**
 * CRELUNE Windows Creative Agent — Safe Affinity Execution Adapter
 *
 * Grounded strictly in verified Stage 5.0 and live Affinity 3.3.3.5004 findings:
 * - Never invents Affinity SDK APIs or edits native Affinity binaries from Node.js.
 * - Never modifies global Affinity Scripting or MCP settings.
 * - Any MCP probe is strictly opt-in (`affinityMcpEnabled === true`) and restricted
 *   to local loopback (`127.0.0.1` / `localhost`).
 * - Requires explicit user approval before launching Affinity on a working copy.
 * - Launches ONLY the verified allowlisted `%LOCALAPPDATA%\Microsoft\WindowsApps\Affinity.exe`
 *   using `execFile(..., [workingCopyPath], { shell: false })`.
 * - Verifies original master SHA-256 BEFORE and AFTER every operation.
 * - Honestly records whether the operation was `MANUAL`, `ASSISTED`, or `AUTOMATED`.
 */

import { spawn } from 'node:child_process';
import path from 'node:path';
import type { CreativeExecutionMode, JobPrepManifest } from '@crelune/shared';
import { validateLoopbackMcpUrl } from '../config/agent-config.js';
import {
  appendWorkspaceEvent,
  verifyMasterTemplateIntegrity,
  type MaterializedJobWorkspace,
} from '../workspace/job-workspace.js';
import {
  detectInstalledAffinityEnvironment,
  type AffinityEnvironmentReport,
} from './affinity-detector.js';

export interface UserApprovalRequest {
  jobId: string;
  dispatchId: string;
  workingCopyPath: string;
  affinityVersion: string | null;
  actionDescription: string;
}

export type UserApprovalProvider = (
  request: UserApprovalRequest
) => Promise<boolean>;

export interface AffinityProcessLauncher {
  launchAllowlistedAffinity(
    executablePath: string,
    workingCopyPath: string
  ): Promise<{ launched: boolean; pid?: number }>;
}

export interface AffinityExecutionResult {
  executionMode: CreativeExecutionMode;
  launchedAffinity: boolean;
  userApproved: boolean;
  mcpAttempted: boolean;
  mcpReachable: boolean;
  masterVerifiedBefore: boolean;
  masterVerifiedAfter: boolean;
  notes: string[];
}

export function isAllowlistedAffinityExecutable(exePath: string): boolean {
  if (!exePath) return false;
  const normalized = path.normalize(exePath).toLowerCase();
  return (
    normalized.endsWith('\\microsoft\\windowsapps\\affinity.exe') ||
    normalized.endsWith('/microsoft/windowsapps/affinity.exe')
  );
}

export const defaultAffinityProcessLauncher: AffinityProcessLauncher = {
  async launchAllowlistedAffinity(
    executablePath: string,
    workingCopyPath: string
  ): Promise<{ launched: boolean; pid?: number }> {
    if (!isAllowlistedAffinityExecutable(executablePath)) {
      throw new Error(
        'Refusing to launch executable outside the allowlisted WindowsApps Affinity.exe path.'
      );
    }

    return new Promise((resolve, reject) => {
      const child = spawn(executablePath, [workingCopyPath], {
        shell: false,
        detached: true,
        stdio: 'ignore',
        windowsHide: false,
      });

      child.once('error', (err) => reject(err));
      child.once('spawn', () => {
        child.unref();
        resolve({ launched: true, pid: child.pid });
      });
    });
  },
};

export async function probeOptInLoopbackMcp(
  mcpUrl: string,
  timeoutMs: number = 2500
): Promise<{ reachable: boolean; note: string }> {
  const validatedUrl = validateLoopbackMcpUrl(mcpUrl);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(validatedUrl, {
      method: 'GET',
      signal: controller.signal,
    });
    return {
      reachable: res.ok,
      note: res.ok
        ? `Opt-in local loopback MCP endpoint responded HTTP ${res.status}.`
        : `Opt-in local loopback MCP endpoint returned HTTP ${res.status}; falling back to assisted/manual workflow.`,
    };
  } catch {
    return {
      reachable: false,
      note: 'Opt-in local loopback MCP endpoint is not listening; falling back to assisted/manual workflow.',
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function executeSafeAffinityHandoff(params: {
  workspace: MaterializedJobWorkspace;
  manifest: JobPrepManifest;
  envReport?: AffinityEnvironmentReport;
  allowInteractiveLaunch: boolean;
  mcpOptInEnabled: boolean;
  mcpLoopbackUrl: string;
  requestUserApproval: UserApprovalProvider;
  launcher?: AffinityProcessLauncher;
}): Promise<AffinityExecutionResult> {
  const notes: string[] = [];
  const envReport =
    params.envReport ?? (await detectInstalledAffinityEnvironment());

  // 1. Verify original master SHA-256 BEFORE any creative step
  const preCheck = await verifyMasterTemplateIntegrity({
    masterSourcePath: params.workspace.masterSourcePath,
    expectedSha256: params.manifest.templateSha256,
  });
  if (!preCheck.ok) {
    throw new Error(
      'Pre-execution master template SHA-256 verification failed. Aborting before opening Affinity.'
    );
  }

  // 2. Opt-in local loopback MCP check (never auto-enabled; never claims unsupported automation)
  let mcpAttempted = false;
  let mcpReachable = false;
  if (params.mcpOptInEnabled) {
    mcpAttempted = true;
    const probe = await probeOptInLoopbackMcp(params.mcpLoopbackUrl);
    mcpReachable = probe.reachable;
    notes.push(probe.note);
    if (mcpReachable) {
      notes.push(
        'Note: Automated document mutation via MCP remains gated behind empirical per-template verification; operating in assisted artist-review handoff.'
      );
    }
  } else {
    notes.push(
      'Affinity MCP bridge is disabled by default (opt-in only). Using safe working-copy handoff.'
    );
  }

  // 3. Explicit user approval before launching Affinity on the working copy
  let userApproved = false;
  let launchedAffinity = false;
  let executionMode: CreativeExecutionMode = 'MANUAL';

  if (
    params.allowInteractiveLaunch &&
    envReport.installed &&
    envReport.executableAliasPath
  ) {
    userApproved = await params.requestUserApproval({
      jobId: params.workspace.jobId,
      dispatchId: params.workspace.dispatchId,
      workingCopyPath: params.workspace.workingCopyPath,
      affinityVersion: envReport.version,
      actionDescription: `Open isolated working copy "${path.basename(params.workspace.workingCopyPath)}" in Affinity ${envReport.version ?? '3.3'}? Original master stays read-only.`,
    });

    if (userApproved) {
      const launcher = params.launcher ?? defaultAffinityProcessLauncher;
      const launchRes = await launcher.launchAllowlistedAffinity(
        envReport.executableAliasPath,
        params.workspace.workingCopyPath
      );
      launchedAffinity = launchRes.launched;
      if (launchedAffinity) {
        executionMode = 'ASSISTED';
        notes.push(
          `Launched Affinity (${envReport.version ?? 'installed'}) on isolated working copy (PID: ${launchRes.pid ?? 'unknown'}). Artist retains full creative control and export approval.`
        );
      }
    } else {
      notes.push(
        'User declined automatic Affinity launch; workspace remains ready for manual opening.'
      );
    }
  } else {
    notes.push(
      'Affinity executable launch unavailable or disabled; operating in MANUAL workspace fallback mode.'
    );
  }

  // 4. Verify original master SHA-256 AFTER handoff
  const postCheck = await verifyMasterTemplateIntegrity({
    masterSourcePath: params.workspace.masterSourcePath,
    expectedSha256: params.manifest.templateSha256,
  });
  if (!postCheck.ok) {
    throw new Error(
      'CRITICAL: Original master template SHA-256 changed after Affinity handoff!'
    );
  }

  await appendWorkspaceEvent(params.workspace.eventLogPath, {
    event: 'AFFINITY_HANDOFF_COMPLETED',
    executionMode,
    details: {
      launchedAffinity,
      userApproved,
      mcpAttempted,
      mcpReachable,
      masterSha256Unchanged: postCheck.ok,
      affinityVersion: envReport.version,
    },
  });

  return {
    executionMode,
    launchedAffinity,
    userApproved,
    mcpAttempted,
    mcpReachable,
    masterVerifiedBefore: preCheck.ok,
    masterVerifiedAfter: postCheck.ok,
    notes,
  };
}
