/**
 * CRELUNE Windows Creative Agent — Windows DPAPI Encrypted Credential Storage
 *
 * Uses Windows Data Protection API (`System.Security.Cryptography.ProtectedData`,
 * `DataProtectionScope.CurrentUser`) to encrypt and decrypt the agent's Bearer token.
 * Plaintext secrets are NEVER written to disk or passed on command lines — payload
 * bytes flow solely over stdin/stdout to a fixed constant PowerShell snippet via
 * `execFile('powershell.exe', ..., { shell: false })`.
 */

import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { DISPATCH_CLAIM_TOKEN_REGEX } from '@crelune/shared';
import {
  assertSafeAgentIdentifier,
  resolveStrictlyWithinRoot,
} from './path-safety.js';

const DPAPI_CLAIM_ENVELOPE_SCHEMA = z.object({
  version: z.literal(1),
  scheme: z.literal('windows-dpapi-current-user'),
  dispatchId: z.string().min(1).max(80),
  updatedAt: z.string().datetime(),
  protectedClaimBase64: z.string().min(16),
});

export interface DispatchClaimStore {
  saveClaim(dispatchId: string, claimToken: string): Promise<void>;
  loadClaim(dispatchId: string): Promise<string | null>;
  clearClaim(dispatchId: string): Promise<void>;
}

const DPAPI_ENVELOPE_SCHEMA = z.object({
  version: z.literal(1),
  scheme: z.literal('windows-dpapi-current-user'),
  apiBaseUrl: z.string().url(),
  updatedAt: z.string().datetime(),
  protectedTokenBase64: z.string().min(16),
});

export interface StoredAgentCredentials {
  apiBaseUrl: string;
  bearerToken: string;
  updatedAt: string;
}

export interface AgentCredentialStore {
  save(creds: { apiBaseUrl: string; bearerToken: string }): Promise<void>;
  load(): Promise<StoredAgentCredentials | null>;
  clear(): Promise<void>;
  readonly storageDescription: string;
}

const DPAPI_PROTECT_SCRIPT = [
  '$ErrorActionPreference = "Stop"',
  'Add-Type -AssemblyName System.Security',
  '$b64 = [Console]::In.ReadToEnd().Trim()',
  'if ([string]::IsNullOrWhiteSpace($b64)) { throw "Empty DPAPI input" }',
  '$plain = [Convert]::FromBase64String($b64)',
  '$cipher = [System.Security.Cryptography.ProtectedData]::Protect($plain, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)',
  '[Console]::Out.Write([Convert]::ToBase64String($cipher))',
].join('; ');

const DPAPI_UNPROTECT_SCRIPT = [
  '$ErrorActionPreference = "Stop"',
  'Add-Type -AssemblyName System.Security',
  '$b64 = [Console]::In.ReadToEnd().Trim()',
  'if ([string]::IsNullOrWhiteSpace($b64)) { throw "Empty DPAPI ciphertext" }',
  '$cipher = [Convert]::FromBase64String($b64)',
  '$plain = [System.Security.Cryptography.ProtectedData]::Unprotect($cipher, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)',
  '[Console]::Out.Write([Convert]::ToBase64String($plain))',
].join('; ');

function runFixedPowerShellWithStdin(
  script: string,
  stdinPayload: string,
  timeoutMs: number = 15_000
): Promise<string> {
  if (process.platform !== 'win32') {
    return Promise.reject(
      new Error('Windows DPAPI credential protection is only available on Windows.')
    );
  }

  return new Promise((resolve, reject) => {
    const child = execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', script],
      {
        shell: false,
        windowsHide: true,
        timeout: timeoutMs,
        maxBuffer: 1024 * 1024,
      },
      (err, stdout, stderr) => {
        if (err) {
          reject(
            new Error(
              `Windows DPAPI operation failed: ${stderr?.trim() || err.message}`
            )
          );
          return;
        }
        resolve(stdout.trim());
      }
    );

    if (!child.stdin) {
      reject(new Error('Failed to open stdin pipe for Windows DPAPI helper.'));
      return;
    }
    child.stdin.write(stdinPayload, 'utf8');
    child.stdin.end();
  });
}

export async function dpapiProtectUtf8(plaintext: string): Promise<string> {
  const inputBase64 = Buffer.from(plaintext, 'utf8').toString('base64');
  return runFixedPowerShellWithStdin(DPAPI_PROTECT_SCRIPT, inputBase64);
}

export async function dpapiUnprotectUtf8(
  protectedBase64: string
): Promise<string> {
  const outputBase64 = await runFixedPowerShellWithStdin(
    DPAPI_UNPROTECT_SCRIPT,
    protectedBase64
  );
  return Buffer.from(outputBase64, 'base64').toString('utf8');
}

export class WindowsDpapiCredentialStore implements AgentCredentialStore {
  public readonly filePath: string;
  public readonly storageDescription: string;

  constructor(configDir: string) {
    this.filePath = path.join(path.resolve(configDir), 'agent-credentials.dpapi');
    this.storageDescription = `Windows DPAPI (CurrentUser) at ${this.filePath}`;
  }

  async save(creds: {
    apiBaseUrl: string;
    bearerToken: string;
  }): Promise<void> {
    if (!creds.bearerToken.startsWith('cln_agent_')) {
      throw new Error(
        'Invalid agent bearer token format. Expected a token issued by CRELUNE Settings.'
      );
    }

    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    const protectedTokenBase64 = await dpapiProtectUtf8(creds.bearerToken);
    const envelope = DPAPI_ENVELOPE_SCHEMA.parse({
      version: 1,
      scheme: 'windows-dpapi-current-user',
      apiBaseUrl: creds.apiBaseUrl,
      updatedAt: new Date().toISOString(),
      protectedTokenBase64,
    });

    const tempPath = `${this.filePath}.tmp`;
    await fs.writeFile(tempPath, JSON.stringify(envelope, null, 2), {
      encoding: 'utf8',
      mode: 0o600,
    });
    await fs.rename(tempPath, this.filePath);
  }

  async load(): Promise<StoredAgentCredentials | null> {
    let raw: string;
    try {
      raw = await fs.readFile(this.filePath, 'utf8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') {
        return null;
      }
      throw err;
    }

    const parsed = DPAPI_ENVELOPE_SCHEMA.parse(JSON.parse(raw));
    const bearerToken = await dpapiUnprotectUtf8(parsed.protectedTokenBase64);
    return {
      apiBaseUrl: parsed.apiBaseUrl,
      bearerToken,
      updatedAt: parsed.updatedAt,
    };
  }

  async clear(): Promise<void> {
    await fs.rm(this.filePath, { force: true });
  }
}

export class MemoryCredentialStore implements AgentCredentialStore {
  public readonly storageDescription = 'In-Memory Test Store';
  private stored: StoredAgentCredentials | null = null;

  async save(creds: {
    apiBaseUrl: string;
    bearerToken: string;
  }): Promise<void> {
    this.stored = {
      apiBaseUrl: creds.apiBaseUrl,
      bearerToken: creds.bearerToken,
      updatedAt: new Date().toISOString(),
    };
  }

  async load(): Promise<StoredAgentCredentials | null> {
    return this.stored ? { ...this.stored } : null;
  }

  async clear(): Promise<void> {
    this.stored = null;
  }
}

export class WindowsDpapiDispatchClaimStore implements DispatchClaimStore {
  private readonly claimsDir: string;

  constructor(configDir: string) {
    this.claimsDir = path.join(path.resolve(configDir), 'claims');
  }

  private getClaimPath(dispatchId: string): string {
    const safeId = assertSafeAgentIdentifier(dispatchId, 'dispatchId');
    return resolveStrictlyWithinRoot(this.claimsDir, `${safeId}.dpapi`);
  }

  async saveClaim(dispatchId: string, claimToken: string): Promise<void> {
    if (!DISPATCH_CLAIM_TOKEN_REGEX.test(claimToken)) {
      throw new Error('Refusing to store malformed dispatch claim token.');
    }
    await fs.mkdir(this.claimsDir, { recursive: true });
    const filePath = this.getClaimPath(dispatchId);
    const protectedClaimBase64 = await dpapiProtectUtf8(claimToken);
    const envelope = DPAPI_CLAIM_ENVELOPE_SCHEMA.parse({
      version: 1,
      scheme: 'windows-dpapi-current-user',
      dispatchId,
      updatedAt: new Date().toISOString(),
      protectedClaimBase64,
    });
    const tempPath = `${filePath}.tmp`;
    await fs.writeFile(tempPath, JSON.stringify(envelope, null, 2), {
      encoding: 'utf8',
      mode: 0o600,
    });
    await fs.rename(tempPath, filePath);
  }

  async loadClaim(dispatchId: string): Promise<string | null> {
    const filePath = this.getClaimPath(dispatchId);
    let raw: string;
    try {
      raw = await fs.readFile(filePath, 'utf8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') {
        return null;
      }
      throw err;
    }
    const parsed = DPAPI_CLAIM_ENVELOPE_SCHEMA.parse(JSON.parse(raw));
    const claimToken = await dpapiUnprotectUtf8(parsed.protectedClaimBase64);
    if (!DISPATCH_CLAIM_TOKEN_REGEX.test(claimToken)) {
      return null;
    }
    return claimToken;
  }

  async clearClaim(dispatchId: string): Promise<void> {
    const filePath = this.getClaimPath(dispatchId);
    await fs.rm(filePath, { force: true });
  }
}

export class MemoryDispatchClaimStore implements DispatchClaimStore {
  private readonly claims = new Map<string, string>();

  async saveClaim(dispatchId: string, claimToken: string): Promise<void> {
    this.claims.set(dispatchId, claimToken);
  }

  async loadClaim(dispatchId: string): Promise<string | null> {
    return this.claims.get(dispatchId) ?? null;
  }

  async clearClaim(dispatchId: string): Promise<void> {
    this.claims.delete(dispatchId);
  }
}
