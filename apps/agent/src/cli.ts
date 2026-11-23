#!/usr/bin/env node
/**
 * CRELUNE Windows Creative Agent — Local CLI Entry Point
 *
 * Commands:
 *   crelune-agent pair --api-url <https://...>       Pair securely using Windows DPAPI
 *   crelune-agent doctor                             Check config, DPAPI, Affinity 3.3, and backend heartbeat
 *   crelune-agent process-once [--approve-open]      Claim and prepare one creative job
 *   crelune-agent run [--approve-open]               Start outbound heartbeat & polling loop
 *   crelune-agent submit-export --dispatch <id> --job <id> --file <name>
 *   crelune-agent unpair                             Remove encrypted local credentials
 */

import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import {
  AGENT_VERSION,
  loadAgentConfig,
  validateBackendApiBaseUrl,
} from './config/agent-config.js';
import { detectInstalledAffinityEnvironment } from './affinity/affinity-detector.js';
import { CreluneAgentApiClient } from './api/crelune-api-client.js';
import { WindowsCreativeAgentRuntime } from './runtime/agent-daemon.js';
import { WindowsDpapiCredentialStore } from './security/dpapi-store.js';
import { createConsoleAgentLogger } from './security/logger.js';

function getFlagValue(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  if (idx === -1 || idx + 1 >= args.length) return undefined;
  return args[idx + 1];
}

async function promptLine(question: string): Promise<string> {
  const rl = readline.createInterface({ input, output });
  try {
    return (await rl.question(question)).trim();
  } finally {
    rl.close();
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0] ?? 'help';
  const logger = createConsoleAgentLogger();
  const baseConfig = loadAgentConfig();
  const credStore = new WindowsDpapiCredentialStore(baseConfig.configDir);

  if (command === 'help' || command === '--help' || command === '-h') {
    console.log(`CRELUNE Windows Creative Agent v${AGENT_VERSION}

Commands:
  pair --api-url <url>                                  Encrypt and store one-time pairing token via Windows DPAPI
  doctor                                                Inspect Affinity 3.3, DPAPI store, and backend heartbeat
  process-once [--approve-open]                         Claim and prepare a single queued creative dispatch
  run [--approve-open]                                  Run outbound heartbeat and job polling loop
  renew-lease --dispatch <id>                           Extend the active lease for an in-progress artist session
  submit-export --dispatch <id> --job <id> --file <f>   Validate and upload export from workspaces/jobs/<id>/exports/
  unpair                                                Clear encrypted local agent credentials
`);
    return;
  }

  if (command === 'pair') {
    const rawUrl =
      getFlagValue(args, '--api-url') ??
      (await promptLine('CRELUNE API Base URL (e.g. https://app.crelune.local): '));
    const apiBaseUrl = validateBackendApiBaseUrl(rawUrl);

    // Never pass secrets via CLI flags (process list exposure); read via stdin prompt
    const token = await promptLine(
      'Paste one-time CRELUNE Agent Token (cln_agent_...): '
    );
    await credStore.save({ apiBaseUrl, bearerToken: token });
    console.log(
      `Agent credentials encrypted and saved via ${credStore.storageDescription}.`
    );
    return;
  }

  if (command === 'unpair') {
    await credStore.clear();
    console.log('Cleared local encrypted agent credentials.');
    return;
  }

  const creds = await credStore.load();
  const envReport = await detectInstalledAffinityEnvironment();

  if (command === 'doctor') {
    console.log(
      JSON.stringify(
        {
          agentVersion: AGENT_VERSION,
          paired: Boolean(creds),
          apiBaseUrl: creds?.apiBaseUrl ?? baseConfig.apiBaseUrl,
          credentialStore: credStore.storageDescription,
          workspaceRoot: baseConfig.workspaceRoot,
          mcpOptInEnabled: baseConfig.affinityMcpEnabled,
          affinity: envReport,
        },
        null,
        2
      )
    );
    if (creds) {
      const client = new CreluneAgentApiClient({
        apiBaseUrl: creds.apiBaseUrl,
        bearerToken: creds.bearerToken,
        timeoutMs: baseConfig.requestTimeoutMs,
      });
      const runtime = new WindowsCreativeAgentRuntime({
        config: loadAgentConfig({ apiBaseUrl: creds.apiBaseUrl }),
        client,
        logger,
      });
      await runtime.sendHealthHeartbeat();
      console.log('Backend heartbeat check: PASS');
    } else {
      console.log('Not paired yet. Run `crelune-agent pair --api-url <url>`.');
    }
    return;
  }

  if (!creds) {
    console.error(
      'Agent is not paired. Generate a one-time token in CRELUNE Settings and run `crelune-agent pair --api-url <url>`.'
    );
    process.exitCode = 1;
    return;
  }

  const config = loadAgentConfig({ apiBaseUrl: creds.apiBaseUrl });
  const client = new CreluneAgentApiClient({
    apiBaseUrl: creds.apiBaseUrl,
    bearerToken: creds.bearerToken,
    timeoutMs: config.requestTimeoutMs,
  });

  const approveFlag = args.includes('--approve-open');
  const approvalProvider = async (req: { actionDescription: string }) => {
    if (approveFlag) return true;
    if (!input.isTTY) return false;
    const answer = await promptLine(`${req.actionDescription} [y/N]: `);
    return answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes';
  };

  const runtime = new WindowsCreativeAgentRuntime({
    config,
    client,
    logger,
    requestUserApproval: approvalProvider,
  });

  if (command === 'process-once') {
    await runtime.sendHealthHeartbeat();
    const outcome = await runtime.processSingleClaimedJob();
    console.log(
      JSON.stringify(
        {
          claimed: outcome.claimed,
          dispatchId: outcome.dispatchId ?? null,
          designJobId: outcome.designJobId ?? null,
          executionMode: outcome.affinityResult?.executionMode ?? null,
          workingCopyStatus: outcome.workspace?.workingCopyStatus ?? null,
          preservedExistingWorkingCopy:
            outcome.preservedExistingWorkingCopy ?? false,
          workingCopyPath: outcome.workspace?.workingCopyPath ?? null,
          exportsDir: outcome.workspace?.exportsDir ?? null,
        },
        null,
        2
      )
    );
    return;
  }

  if (command === 'renew-lease') {
    const dispatchId = getFlagValue(args, '--dispatch');
    if (!dispatchId) {
      console.error('Usage: crelune-agent renew-lease --dispatch <dispatchId>');
      process.exitCode = 1;
      return;
    }
    const res = await runtime.renewActiveLease({ dispatchId });
    console.log(JSON.stringify(res, null, 2));
    return;
  }

  if (command === 'submit-export') {
    const dispatchId = getFlagValue(args, '--dispatch');
    const designJobId = getFlagValue(args, '--job');
    const exportFilename = getFlagValue(args, '--file');
    if (!dispatchId || !designJobId || !exportFilename) {
      console.error(
        'Usage: crelune-agent submit-export --dispatch <dispatchId> --job <designJobId> --file <filename>'
      );
      process.exitCode = 1;
      return;
    }
    const res = await runtime.submitVerifiedExport({
      dispatchId,
      designJobId,
      exportFilename,
    });
    console.log(JSON.stringify(res, null, 2));
    return;
  }

  if (command === 'run') {
    process.once('SIGINT', () => runtime.stop());
    process.once('SIGTERM', () => runtime.stop());
    await runtime.runLoop();
    return;
  }

  console.error(`Unknown command "${command}". Run \`crelune-agent help\`.`);
  process.exitCode = 1;
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : 'Agent terminated with error.');
  process.exitCode = 1;
});
