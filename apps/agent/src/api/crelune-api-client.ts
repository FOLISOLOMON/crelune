/**
 * CRELUNE Windows Creative Agent — Outbound Authenticated HTTPS API Client
 *
 * Communicates strictly outbound with CRELUNE backend endpoints using per-machine
 * Bearer credentials. Handles transient retries with exponential backoff and
 * stops cleanly on `401` / `403` authentication revocation without leaking tokens.
 */

import type {
  CreateExportRecordInput,
  CreateExportUploadIntentInput,
  CreativeAgentHeartbeatInput,
  CreativeAgentSummary,
  CreativeJobDispatchSummary,
  CreativeUploadIntentSummary,
  ExportRecordSummary,
  JobPrepManifest,
  PresignedUploadTarget,
  UpdateCreativeDispatchStatusInput,
} from '@crelune/shared';
import { validateBackendApiBaseUrl } from '../config/agent-config.js';
import { redactSensitiveString } from '../security/logger.js';

export class AgentAuthenticationRevokedError extends Error {
  constructor(message = 'Creative agent credentials are invalid, expired, or revoked.') {
    super(message);
    this.name = 'AgentAuthenticationRevokedError';
  }
}

export class AgentApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string
  ) {
    super(redactSensitiveString(message));
    this.name = 'AgentApiError';
  }
}

export type ClaimDispatchResponse =
  | {
      dispatch: CreativeJobDispatchSummary;
      manifest: JobPrepManifest;
      claimToken: string;
      leaseExpiresAt: string;
    }
  | { dispatch: null };

export class CreluneAgentApiClient {
  private readonly baseUrl: string;
  private readonly bearerToken: string;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: {
    apiBaseUrl: string;
    bearerToken: string;
    timeoutMs?: number;
    maxRetries?: number;
    fetchImpl?: typeof fetch;
  }) {
    this.baseUrl = validateBackendApiBaseUrl(options.apiBaseUrl);
    this.bearerToken = options.bearerToken;
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.maxRetries = options.maxRetries ?? 2;
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
  }

  private async fetchWithRetry(
    url: string,
    init: RequestInit,
    includeAuth = true
  ): Promise<Response> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        const headers = new Headers(init.headers);
        if (includeAuth) {
          headers.set('Authorization', `Bearer ${this.bearerToken}`);
        }
        const res = await this.fetchImpl(url, {
          ...init,
          headers,
          signal: controller.signal,
        });
        clearTimeout(timer);

        if (includeAuth && (res.status === 401 || res.status === 403)) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          if (res.status === 401) {
            throw new AgentAuthenticationRevokedError(body.error);
          }
          throw new AgentApiError(
            body.error ?? 'Forbidden by CRELUNE backend.',
            403
          );
        }

        if (res.status >= 500 && attempt < this.maxRetries) {
          await new Promise((r) => setTimeout(r, 250 * (attempt + 1)));
          continue;
        }

        return res;
      } catch (err) {
        clearTimeout(timer);
        if (
          err instanceof AgentAuthenticationRevokedError ||
          err instanceof AgentApiError
        ) {
          throw err;
        }
        lastError = err;
        if (attempt < this.maxRetries) {
          await new Promise((r) => setTimeout(r, 250 * (attempt + 1)));
        }
      }
    }

    throw new AgentApiError(
      lastError instanceof Error
        ? `Network error contacting CRELUNE backend: ${lastError.message}`
        : 'Network error contacting CRELUNE backend.',
      0
    );
  }

  private async requestJson<T>(
    path: string,
    init: RequestInit
  ): Promise<T> {
    const res = await this.fetchWithRetry(`${this.baseUrl}${path}`, init, true);
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      throw new AgentApiError(
        typeof body.error === 'string'
          ? body.error
          : `CRELUNE API returned HTTP ${res.status}`,
        res.status,
        typeof body.code === 'string' ? body.code : undefined
      );
    }
    return body as T;
  }

  async sendHeartbeat(
    payload: CreativeAgentHeartbeatInput
  ): Promise<{ agent: CreativeAgentSummary; serverTime: string }> {
    return this.requestJson('/api/agent/heartbeat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  }

  async claimNextJob(): Promise<ClaimDispatchResponse> {
    return this.requestJson('/api/agent/jobs/claim', {
      method: 'POST',
    });
  }

  async reportDispatchStatus(
    dispatchId: string,
    payload: UpdateCreativeDispatchStatusInput
  ): Promise<{ dispatch: CreativeJobDispatchSummary; idempotentReplay: boolean }> {
    return this.requestJson(
      `/api/agent/dispatches/${encodeURIComponent(dispatchId)}/status`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }
    );
  }

  async downloadDispatchTemplateMaster(dispatchId: string): Promise<{
    bytes: Uint8Array;
    headerSha256: string | null;
  }> {
    const res = await this.fetchWithRetry(
      `${this.baseUrl}/api/agent/dispatches/${encodeURIComponent(dispatchId)}/template`,
      { method: 'GET' },
      true
    );
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      throw new AgentApiError(
        body.error ?? `Template download failed (HTTP ${res.status})`,
        res.status
      );
    }
    const bytes = new Uint8Array(await res.arrayBuffer());
    return {
      bytes,
      headerSha256: res.headers.get('x-content-sha256'),
    };
  }

  async downloadDispatchAsset(
    dispatchId: string,
    assetId: string
  ): Promise<{
    bytes: Uint8Array;
    headerSha256: string | null;
  }> {
    const res = await this.fetchWithRetry(
      `${this.baseUrl}/api/agent/dispatches/${encodeURIComponent(
        dispatchId
      )}/assets/${encodeURIComponent(assetId)}`,
      { method: 'GET' },
      true
    );
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      throw new AgentApiError(
        body.error ?? `Asset download failed (HTTP ${res.status})`,
        res.status
      );
    }
    const bytes = new Uint8Array(await res.arrayBuffer());
    return {
      bytes,
      headerSha256: res.headers.get('x-content-sha256'),
    };
  }

  async createExportUploadIntent(
    dispatchId: string,
    payload: CreateExportUploadIntentInput
  ): Promise<{
    intent: CreativeUploadIntentSummary;
    upload: PresignedUploadTarget;
  }> {
    return this.requestJson(
      `/api/agent/dispatches/${encodeURIComponent(
        dispatchId
      )}/exports/upload-intents`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }
    );
  }

  async uploadBytesToPresignedTarget(
    target: PresignedUploadTarget,
    bytes: Uint8Array
  ): Promise<void> {
    const res = await this.fetchWithRetry(
      target.url,
      {
        method: target.method,
        headers: {
          'content-type': target.requiredHeaders['content-type'],
          'content-length': String(bytes.byteLength),
        },
        body: Buffer.from(bytes),
      },
      false
    );
    if (!res.ok) {
      throw new AgentApiError(
        `Presigned export upload failed (HTTP ${res.status}).`,
        res.status
      );
    }
  }

  async completeExportUpload(
    dispatchId: string,
    payload: CreateExportRecordInput
  ): Promise<{ exportRecord: ExportRecordSummary; idempotentReplay: boolean }> {
    return this.requestJson(
      `/api/agent/dispatches/${encodeURIComponent(dispatchId)}/exports`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }
    );
  }
}
