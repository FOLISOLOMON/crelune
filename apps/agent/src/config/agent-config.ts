/**
 * CRELUNE Windows Creative Agent — Configuration & Security Defaults
 *
 * Enforces HTTPS for remote backends, loopback-only opt-in for Affinity MCP
 * (disabled by default), and explicit workspace directory containment.
 */

import os from 'node:os';
import path from 'node:path';
import { z } from 'zod';

export const AGENT_VERSION = '0.1.0';

export function isLoopbackHostname(hostname: string): boolean {
  const lower = hostname.toLowerCase();
  return lower === '127.0.0.1' || lower === 'localhost' || lower === '::1';
}

export function validateBackendApiBaseUrl(rawUrl: string): string {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    throw new Error(`Invalid CRELUNE_API_BASE_URL: "${rawUrl}"`);
  }

  if (parsed.username || parsed.password) {
    throw new Error('CRELUNE_API_BASE_URL must not contain embedded credentials.');
  }

  if (parsed.protocol === 'https:') {
    return parsed.origin;
  }

  if (parsed.protocol === 'http:' && isLoopbackHostname(parsed.hostname)) {
    return parsed.origin;
  }

  throw new Error(
    'CRELUNE_API_BASE_URL must use HTTPS (HTTP is permitted only for local loopback development).'
  );
}

export function validateLoopbackMcpUrl(rawUrl: string): string {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    throw new Error(`Invalid CRELUNE_AFFINITY_MCP_URL: "${rawUrl}"`);
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Affinity MCP URL must use http or https.');
  }
  if (!isLoopbackHostname(parsed.hostname)) {
    throw new Error(
      'Affinity MCP bridge is strictly restricted to local loopback addresses (127.0.0.1 / localhost).'
    );
  }
  if (parsed.username || parsed.password) {
    throw new Error('Affinity MCP URL must not contain embedded credentials.');
  }

  return parsed.toString();
}

const agentConfigSchema = z.object({
  apiBaseUrl: z.string().transform(validateBackendApiBaseUrl),
  configDir: z.string().min(1),
  workspaceRoot: z.string().min(1),
  pollIntervalMs: z.number().int().min(1000).max(300_000).default(15_000),
  heartbeatIntervalMs: z.number().int().min(5000).max(600_000).default(60_000),
  requestTimeoutMs: z.number().int().min(2000).max(120_000).default(30_000),
  affinityMcpEnabled: z.boolean().default(false),
  affinityMcpUrl: z
    .string()
    .transform(validateLoopbackMcpUrl)
    .default('http://127.0.0.1:33001/sse'),
  allowInteractiveAffinityLaunch: z.boolean().default(true),
});

export type AgentRuntimeConfig = z.infer<typeof agentConfigSchema>;

export function getDefaultAgentDataRoot(): string {
  if (process.platform === 'win32' && process.env.LOCALAPPDATA) {
    return path.join(process.env.LOCALAPPDATA, 'CRELUNE', 'Agent');
  }
  return path.join(os.homedir(), '.crelune-agent');
}

export function loadAgentConfig(
  overrides: Partial<{
    apiBaseUrl: string;
    configDir: string;
    workspaceRoot: string;
    pollIntervalMs: number;
    heartbeatIntervalMs: number;
    requestTimeoutMs: number;
    affinityMcpEnabled: boolean;
    affinityMcpUrl: string;
    allowInteractiveAffinityLaunch: boolean;
  }> = {},
  env: Record<string, string | undefined> = process.env
): AgentRuntimeConfig {
  const defaultRoot = getDefaultAgentDataRoot();
  const rawApiBaseUrl =
    overrides.apiBaseUrl ??
    env.CRELUNE_API_BASE_URL ??
    'http://127.0.0.1:3000';

  const rawMcpEnabled =
    overrides.affinityMcpEnabled ??
    (env.CRELUNE_AFFINITY_MCP_ENABLED?.toLowerCase() === 'true');

  return agentConfigSchema.parse({
    apiBaseUrl: rawApiBaseUrl,
    configDir:
      overrides.configDir ??
      env.CRELUNE_AGENT_CONFIG_DIR ??
      path.join(defaultRoot, 'config'),
    workspaceRoot:
      overrides.workspaceRoot ??
      env.CRELUNE_WORKSPACE_ROOT ??
      path.join(defaultRoot, 'workspaces'),
    pollIntervalMs:
      overrides.pollIntervalMs ??
      (env.CRELUNE_POLL_INTERVAL_MS
        ? Number.parseInt(env.CRELUNE_POLL_INTERVAL_MS, 10)
        : 15_000),
    heartbeatIntervalMs:
      overrides.heartbeatIntervalMs ??
      (env.CRELUNE_HEARTBEAT_INTERVAL_MS
        ? Number.parseInt(env.CRELUNE_HEARTBEAT_INTERVAL_MS, 10)
        : 60_000),
    requestTimeoutMs:
      overrides.requestTimeoutMs ??
      (env.CRELUNE_REQUEST_TIMEOUT_MS
        ? Number.parseInt(env.CRELUNE_REQUEST_TIMEOUT_MS, 10)
        : 30_000),
    affinityMcpEnabled: rawMcpEnabled,
    affinityMcpUrl:
      overrides.affinityMcpUrl ??
      env.CRELUNE_AFFINITY_MCP_URL ??
      'http://127.0.0.1:33001/sse',
    allowInteractiveAffinityLaunch:
      overrides.allowInteractiveAffinityLaunch ??
      env.CRELUNE_ALLOW_AFFINITY_LAUNCH?.toLowerCase() !== 'false',
  });
}
