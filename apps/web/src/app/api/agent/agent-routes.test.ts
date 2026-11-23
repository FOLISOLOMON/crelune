import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextResponse } from 'next/server';
import { DISPATCH_CLAIM_HEADER } from '@crelune/shared';

const {
  mockPrisma,
  mockRequireOwnerApi,
  mockListAgents,
  mockRegisterAgent,
  mockRevokeAgent,
  mockHeartbeat,
  mockClaimNext,
  mockUpdateStatus,
  mockRenewLease,
  mockStreamTemplate,
  mockStreamAsset,
  mockCreateExportIntent,
  mockCompleteExport,
  mockRecoverDispatch,
} = vi.hoisted(() => ({
  mockPrisma: {
    creativeAgent: {
      findUnique: vi.fn(),
    },
  },
  mockRequireOwnerApi: vi.fn(),
  mockListAgents: vi.fn(),
  mockRegisterAgent: vi.fn(),
  mockRevokeAgent: vi.fn(),
  mockHeartbeat: vi.fn(),
  mockClaimNext: vi.fn(),
  mockUpdateStatus: vi.fn(),
  mockRenewLease: vi.fn(),
  mockStreamTemplate: vi.fn(),
  mockStreamAsset: vi.fn(),
  mockCreateExportIntent: vi.fn(),
  mockCompleteExport: vi.fn(),
  mockRecoverDispatch: vi.fn(),
}));

vi.mock('@crelune/database', () => ({
  prisma: mockPrisma,
}));

vi.mock('@/lib/auth/api-owner-guard', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth/api-owner-guard')>(
    '@/lib/auth/api-owner-guard'
  );
  return {
    ...actual,
    requireAuthenticatedOwnerApi: mockRequireOwnerApi,
  };
});

vi.mock('@/lib/agents/agent-service', async () => {
  const actual = await vi.importActual<typeof import('@/lib/agents/agent-service')>(
    '@/lib/agents/agent-service'
  );
  return {
    ...actual,
    listCreativeAgents: mockListAgents,
    registerCreativeAgent: mockRegisterAgent,
    revokeCreativeAgent: mockRevokeAgent,
    recordAgentHeartbeat: mockHeartbeat,
    claimNextCreativeDispatch: mockClaimNext,
    updateAgentDispatchStatus: mockUpdateStatus,
    renewAgentDispatchLease: mockRenewLease,
    streamAgentDispatchTemplateMaster: mockStreamTemplate,
    streamAgentDispatchAsset: mockStreamAsset,
    createAgentExportUploadIntent: mockCreateExportIntent,
    completeAgentExportUpload: mockCompleteExport,
  };
});

vi.mock('@/lib/designs/job-preparation-service', async () => {
  const actual = await vi.importActual<
    typeof import('@/lib/designs/job-preparation-service')
  >('@/lib/designs/job-preparation-service');
  return {
    ...actual,
    recoverCreativeJobDispatch: mockRecoverDispatch,
  };
});

import {
  generateCreativeAgentToken,
  generateDispatchClaimToken,
  verifyAgentBearerRequest,
} from '@/lib/agents/agent-auth';
import { POST as postHeartbeat } from './heartbeat/route';
import { POST as postClaim } from './jobs/claim/route';
import { POST as postStatus } from './dispatches/[dispatchId]/status/route';
import { POST as postLease } from './dispatches/[dispatchId]/lease/route';
import { GET as getTemplate } from './dispatches/[dispatchId]/template/route';
import { GET as getAsset } from './dispatches/[dispatchId]/assets/[assetId]/route';
import { POST as postExportIntent } from './dispatches/[dispatchId]/exports/upload-intents/route';
import { POST as postExportComplete } from './dispatches/[dispatchId]/exports/route';
import { GET as getAgents, POST as postAgents } from '../agents/route';
import { POST as postRevoke } from '../agents/[id]/revoke/route';
import { POST as postRecoverDispatch } from '../designs/[id]/dispatches/[dispatchId]/recover/route';

describe('Stage 5.5 + 5.5.1 Creative Agent Auth, Claim Fencing & Route Security', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects missing, malformed, query-string, unknown, and revoked Bearer credentials with 401 and private no-store', async () => {
    const { rawToken, tokenHash } = generateCreativeAgentToken();

    const missingRes = await verifyAgentBearerRequest(
      new Request('http://localhost:3000/api/agent/heartbeat', { method: 'POST' })
    );
    expect(missingRes.ok).toBe(false);
    if (!missingRes.ok) {
      expect(missingRes.response.status).toBe(401);
      expect(missingRes.response.headers.get('cache-control')).toBe(
        'private, no-store'
      );
    }

    const queryRes = await verifyAgentBearerRequest(
      new Request(`http://localhost:3000/api/agent/heartbeat?token=${rawToken}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${rawToken}` },
      })
    );
    expect(queryRes.ok).toBe(false);
    if (!queryRes.ok) {
      expect(queryRes.response.status).toBe(401);
    }
    expect(mockPrisma.creativeAgent.findUnique).not.toHaveBeenCalled();

    const badPrefixRes = await verifyAgentBearerRequest(
      new Request('http://localhost:3000/api/agent/heartbeat', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer not_an_agent_token_12345678901234567890',
        },
      })
    );
    expect(badPrefixRes.ok).toBe(false);

    mockPrisma.creativeAgent.findUnique.mockResolvedValueOnce({
      id: 'agt_revoked',
      organisationId: 'org_1',
      name: 'Old Laptop',
      machineLabel: 'WIN-OLD',
      tokenHash,
      status: 'REVOKED',
      revokedAt: new Date(),
    });
    const revokedRes = await verifyAgentBearerRequest(
      new Request('http://localhost:3000/api/agent/heartbeat', {
        method: 'POST',
        headers: { Authorization: `Bearer ${rawToken}` },
      })
    );
    expect(revokedRes.ok).toBe(false);
    if (!revokedRes.ok) {
      expect(revokedRes.response.status).toBe(401);
    }

    mockPrisma.creativeAgent.findUnique.mockResolvedValueOnce({
      id: 'agt_active',
      organisationId: 'org_1',
      name: 'Studio Desktop',
      machineLabel: 'WIN11-STUDIO',
      tokenHash,
      status: 'ACTIVE',
      revokedAt: null,
    });
    const okRes = await verifyAgentBearerRequest(
      new Request('http://localhost:3000/api/agent/heartbeat', {
        method: 'POST',
        headers: { Authorization: `Bearer ${rawToken}` },
      })
    );
    expect(okRes.ok).toBe(true);
    if (okRes.ok) {
      expect(okRes.agent.id).toBe('agt_active');
      expect(okRes.agent.organisationId).toBe('org_1');
    }
  });

  it('rejects unauthenticated requests to /api/agent/heartbeat and /api/agent/jobs/claim', async () => {
    const hbRes = await postHeartbeat(
      new Request('http://localhost:3000/api/agent/heartbeat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentVersion: '0.1.0' }),
      })
    );
    expect(hbRes.status).toBe(401);

    const claimRes = await postClaim(
      new Request('http://localhost:3000/api/agent/jobs/claim', {
        method: 'POST',
      })
    );
    expect(claimRes.status).toBe(401);
  });

  it('enforces mandatory X-Crelune-Dispatch-Claim header across ALL 6 dispatch-scoped machine routes', async () => {
    const { rawToken, tokenHash } = generateCreativeAgentToken();
    const { claimToken } = generateDispatchClaimToken();
    const activeRecord = {
      id: 'agt_active',
      organisationId: 'org_1',
      name: 'Studio Desktop',
      machineLabel: 'WIN11-STUDIO',
      tokenHash,
      status: 'ACTIVE',
      revokedAt: null,
    };
    mockPrisma.creativeAgent.findUnique.mockResolvedValue(activeRecord);

    const authOnly = { Authorization: `Bearer ${rawToken}` };
    const malformedClaim = 'clm_bad_token_should_not_echo';

    // 1. Missing claim header -> 403 across all 6 endpoints without invoking services
    const missingResponses = await Promise.all([
      postStatus(
        new Request('http://localhost:3000/api/agent/dispatches/dsp_1/status', {
          method: 'POST',
          headers: { ...authOnly, 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'DOWNLOADING_ASSETS' }),
        }),
        { params: Promise.resolve({ dispatchId: 'dsp_1' }) }
      ),
      postLease(
        new Request('http://localhost:3000/api/agent/dispatches/dsp_1/lease', {
          method: 'POST',
          headers: authOnly,
        }),
        { params: Promise.resolve({ dispatchId: 'dsp_1' }) }
      ),
      getTemplate(
        new Request('http://localhost:3000/api/agent/dispatches/dsp_1/template', {
          method: 'GET',
          headers: authOnly,
        }),
        { params: Promise.resolve({ dispatchId: 'dsp_1' }) }
      ),
      getAsset(
        new Request(
          'http://localhost:3000/api/agent/dispatches/dsp_1/assets/mem_1',
          { method: 'GET', headers: authOnly }
        ),
        { params: Promise.resolve({ dispatchId: 'dsp_1', assetId: 'mem_1' }) }
      ),
      postExportIntent(
        new Request(
          'http://localhost:3000/api/agent/dispatches/dsp_1/exports/upload-intents',
          {
            method: 'POST',
            headers: { ...authOnly, 'Content-Type': 'application/json' },
            body: JSON.stringify({}),
          }
        ),
        { params: Promise.resolve({ dispatchId: 'dsp_1' }) }
      ),
      postExportComplete(
        new Request('http://localhost:3000/api/agent/dispatches/dsp_1/exports', {
          method: 'POST',
          headers: { ...authOnly, 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        }),
        { params: Promise.resolve({ dispatchId: 'dsp_1' }) }
      ),
    ]);

    for (const res of missingResponses) {
      expect(res.status).toBe(403);
      expect(res.headers.get('cache-control')).toBe('private, no-store');
      const json = (await res.json()) as { code?: string };
      expect(json.code).toBe('DISPATCH_CLAIM_REQUIRED');
    }

    // 2. Malformed claim header -> 403 and raw value is NEVER echoed
    const malformedRes = await postLease(
      new Request('http://localhost:3000/api/agent/dispatches/dsp_1/lease', {
        method: 'POST',
        headers: { ...authOnly, [DISPATCH_CLAIM_HEADER]: malformedClaim },
      }),
      { params: Promise.resolve({ dispatchId: 'dsp_1' }) }
    );
    expect(malformedRes.status).toBe(403);
    const malformedText = await malformedRes.text();
    expect(malformedText).not.toContain(malformedClaim);
    expect(mockUpdateStatus).not.toHaveBeenCalled();
    expect(mockRenewLease).not.toHaveBeenCalled();
    expect(mockStreamTemplate).not.toHaveBeenCalled();
    expect(mockStreamAsset).not.toHaveBeenCalled();
    expect(mockCreateExportIntent).not.toHaveBeenCalled();
    expect(mockCompleteExport).not.toHaveBeenCalled();

    // 3. Valid header passes exact claimToken into service
    mockRenewLease.mockResolvedValueOnce({
      dispatch: { id: 'dsp_1', status: 'READY_FOR_ARTIST' },
      leaseExpiresAt: new Date(Date.now() + 900_000).toISOString(),
    });
    const okLease = await postLease(
      new Request('http://localhost:3000/api/agent/dispatches/dsp_1/lease', {
        method: 'POST',
        headers: { ...authOnly, [DISPATCH_CLAIM_HEADER]: claimToken },
      }),
      { params: Promise.resolve({ dispatchId: 'dsp_1' }) }
    );
    expect(okLease.status).toBe(200);
    expect(mockRenewLease).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'agt_active' }),
      'dsp_1',
      claimToken
    );
  });

  it('enforces owner authentication and CSRF on /api/agents and owner dispatch recovery routes', async () => {
    mockRequireOwnerApi.mockResolvedValueOnce({
      ok: false,
      response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    });
    const unauthGet = await getAgents(
      new Request('http://localhost:3000/api/agents', { method: 'GET' })
    );
    expect(unauthGet.status).toBe(401);

    mockRequireOwnerApi.mockResolvedValueOnce({
      ok: true,
      owner: { profile: { id: 'usr_1', organisationId: 'org_1' } },
    });
    mockRegisterAgent.mockResolvedValueOnce({
      agent: {
        id: 'agt_1',
        name: 'Studio Workstation',
        machineLabel: 'DESKTOP-MAIN',
        tokenPrefix: 'cln_agent_12345678',
        status: 'ACTIVE',
        agentVersion: null,
        affinityVersion: null,
        lastHeartbeatAt: null,
        revokedAt: null,
        revocationReason: null,
        createdAt: new Date().toISOString(),
      },
      oneTimeToken: `cln_agent_${'b'.repeat(64)}`,
    });

    const regRes = await postAgents(
      new Request('http://localhost:3000/api/agents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Studio Workstation',
          machineLabel: 'DESKTOP-MAIN',
        }),
      })
    );
    expect(regRes.status).toBe(201);
    expect(mockRequireOwnerApi).toHaveBeenLastCalledWith(expect.any(Request), {
      verifyCsrf: true,
    });

    mockRequireOwnerApi.mockResolvedValueOnce({
      ok: true,
      owner: { profile: { id: 'usr_1', organisationId: 'org_1' } },
    });
    mockRevokeAgent.mockResolvedValueOnce({ id: 'agt_1', status: 'REVOKED' });
    const revRes = await postRevoke(
      new Request('http://localhost:3000/api/agents/agt_1/revoke', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'Rotating machine token' }),
      }),
      { params: Promise.resolve({ id: 'agt_1' }) }
    );
    expect(revRes.status).toBe(200);
    expect(mockRequireOwnerApi).toHaveBeenLastCalledWith(expect.any(Request), {
      verifyCsrf: true,
    });

    // Owner explicit READY_FOR_ARTIST recovery requires CSRF + confirmPreserveLocalWork: true
    mockRequireOwnerApi.mockResolvedValueOnce({
      ok: true,
      owner: { profile: { id: 'usr_1', organisationId: 'org_1' } },
    });
    const invalidRecover = await postRecoverDispatch(
      new Request('http://localhost:3000/api/designs/job_1/dispatches/dsp_1/recover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reason: 'Releasing dispatch',
          confirmPreserveLocalWork: false,
        }),
      }),
      { params: Promise.resolve({ id: 'job_1', dispatchId: 'dsp_1' }) }
    );
    expect(invalidRecover.status).toBe(400);

    mockRequireOwnerApi.mockResolvedValueOnce({
      ok: true,
      owner: { profile: { id: 'usr_1', organisationId: 'org_1' } },
    });
    mockRecoverDispatch.mockResolvedValueOnce({ id: 'dsp_1', status: 'QUEUED' });
    const validRecover = await postRecoverDispatch(
      new Request('http://localhost:3000/api/designs/job_1/dispatches/dsp_1/recover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reason: 'Releasing stranded READY_FOR_ARTIST dispatch',
          confirmPreserveLocalWork: true,
        }),
      }),
      { params: Promise.resolve({ id: 'job_1', dispatchId: 'dsp_1' }) }
    );
    expect(validRecover.status).toBe(200);
    expect(mockRequireOwnerApi).toHaveBeenLastCalledWith(expect.any(Request), {
      verifyCsrf: true,
    });
  });
});
