import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextResponse } from 'next/server';

const {
  mockPrisma,
  mockRequireOwnerApi,
  mockListAgents,
  mockRegisterAgent,
  mockRevokeAgent,
  mockHeartbeat,
  mockClaimNext,
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
  };
});

import {
  generateCreativeAgentToken,
  verifyAgentBearerRequest,
} from '@/lib/agents/agent-auth';
import { POST as postHeartbeat } from './heartbeat/route';
import { POST as postClaim } from './jobs/claim/route';
import { GET as getAgents, POST as postAgents } from '../agents/route';
import { POST as postRevoke } from '../agents/[id]/revoke/route';

describe('Stage 5.5 Creative Agent Auth & Route Security', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects missing, malformed, query-string, unknown, and revoked Bearer credentials with 401 and private no-store', async () => {
    const { rawToken, tokenHash } = generateCreativeAgentToken();

    // Missing Authorization header
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

    // Query-string token attempt MUST fail closed
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

    // Wrong prefix / malformed token
    const badPrefixRes = await verifyAgentBearerRequest(
      new Request('http://localhost:3000/api/agent/heartbeat', {
        method: 'POST',
        headers: { Authorization: 'Bearer not_an_agent_token_12345678901234567890' },
      })
    );
    expect(badPrefixRes.ok).toBe(false);

    // Revoked agent record in DB
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

    // Active agent succeeds
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

  it('enforces owner authentication and CSRF on /api/agents registration and revocation', async () => {
    // Unauthenticated GET -> 401
    mockRequireOwnerApi.mockResolvedValueOnce({
      ok: false,
      response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    });
    const unauthGet = await getAgents(
      new Request('http://localhost:3000/api/agents', { method: 'GET' })
    );
    expect(unauthGet.status).toBe(401);

    // Authenticated POST registration enforces verifyCsrf: true and returns 201
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
    const regJson = (await regRes.json()) as { oneTimeToken: string };
    expect(regJson.oneTimeToken.startsWith('cln_agent_')).toBe(true);

    // Revoke route enforces verifyCsrf: true
    mockRequireOwnerApi.mockResolvedValueOnce({
      ok: true,
      owner: { profile: { id: 'usr_1', organisationId: 'org_1' } },
    });
    mockRevokeAgent.mockResolvedValueOnce({
      id: 'agt_1',
      status: 'REVOKED',
    });
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
  });
});
