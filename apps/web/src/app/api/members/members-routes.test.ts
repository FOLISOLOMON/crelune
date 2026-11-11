import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { OwnerAuthState } from '@/lib/auth/owner-guard';

const mockState = vi.hoisted(() => ({
  authResult: { status: 'unauthenticated', owner: null } as OwnerAuthState,
  clearCookieCalls: 0,
  members: new Map<
    string,
    {
      id: string;
      organisationId: string;
      fullName: string;
      preferredName: string | null;
      normalizedName: string;
      birthDay: number | null;
      birthMonth: number | null;
      birthYear: number | null;
      phone: string | null;
      normalizedPhone: string | null;
      email: string | null;
      notes: string | null;
      photoStorageKey: string | null;
      photoUpdatedAt: Date | null;
      archivedAt: Date | null;
      createdAt: Date;
      updatedAt: Date;
    }
  >(),
  auditLogs: [] as Array<Record<string, unknown>>,
  forceDbFailure: false,
  idSeq: 0,
}));

vi.mock('@/lib/auth/owner-guard', () => ({
  resolveAuthenticatedOwner: vi.fn(async () => mockState.authResult),
}));

vi.mock('@/lib/auth/session', () => ({
  clearSessionCookie: vi.fn(async () => {
    mockState.clearCookieCalls += 1;
  }),
}));

vi.mock('@crelune/database', () => {
  function filterWhere(where: Record<string, unknown> | undefined) {
    return Array.from(mockState.members.values()).filter((m) => {
      if (!where) return true;
      if (where.id && m.id !== where.id) return false;
      if (where.organisationId && m.organisationId !== where.organisationId) return false;
      if (where.archivedAt === null && m.archivedAt !== null) return false;
      if (
        where.archivedAt &&
        typeof where.archivedAt === 'object' &&
        'not' in where.archivedAt &&
        m.archivedAt === null
      ) {
        return false;
      }
      if (typeof where.birthMonth === 'number' && m.birthMonth !== where.birthMonth) {
        return false;
      }
      if (Array.isArray(where.OR)) {
        const matched = where.OR.some((clause: Record<string, unknown>) => {
          if (clause.normalizedName && m.normalizedName === clause.normalizedName) {
            return true;
          }
          if (clause.normalizedPhone && m.normalizedPhone === clause.normalizedPhone) {
            return true;
          }
          return false;
        });
        if (!matched) return false;
      }
      return true;
    });
  }

  const txClient = {
    $queryRaw: vi.fn(async () => [{ locked: '' }]),
    member: {
      findMany: vi.fn(async ({ where }: { where?: Record<string, unknown> }) => {
        if (mockState.forceDbFailure) {
          throw new Error(
            'postgresql://neondb_owner:secret_leak@ep-bad.neon.tech/neondb connection failed'
          );
        }
        return filterWhere(where);
      }),
      findFirst: vi.fn(async ({ where }: { where?: Record<string, unknown> }) => {
        return filterWhere(where)[0] ?? null;
      }),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        mockState.idSeq += 1;
        const now = new Date();
        const record = {
          id: `mem_${mockState.idSeq}`,
          organisationId: String(data.organisationId),
          fullName: String(data.fullName),
          preferredName: (data.preferredName as string | null) ?? null,
          normalizedName: String(data.normalizedName),
          birthDay: (data.birthDay as number | null) ?? null,
          birthMonth: (data.birthMonth as number | null) ?? null,
          birthYear: (data.birthYear as number | null) ?? null,
          phone: (data.phone as string | null) ?? null,
          normalizedPhone: (data.normalizedPhone as string | null) ?? null,
          email: (data.email as string | null) ?? null,
          notes: (data.notes as string | null) ?? null,
          photoStorageKey: null,
          photoUpdatedAt: null,
          archivedAt: null,
          createdAt: now,
          updatedAt: now,
        };
        mockState.members.set(record.id, record);
        return record;
      }),
      update: vi.fn(
        async ({
          where,
          data,
        }: {
          where: { id: string };
          data: Record<string, unknown>;
        }) => {
          const existing = mockState.members.get(where.id);
          if (!existing) throw new Error('Not found');
          const updated = { ...existing, ...data, updatedAt: new Date() };
          mockState.members.set(where.id, updated);
          return updated;
        }
      ),
    },
    auditLog: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const entry = { id: `aud_${mockState.auditLogs.length + 1}`, ...data };
        mockState.auditLogs.push(entry);
        return entry;
      }),
    },
  };

  return {
    Prisma: {},
    prisma: {
      member: {
        count: vi.fn(async ({ where }: { where?: Record<string, unknown> }) => {
          if (mockState.forceDbFailure) {
            throw new Error(
              'postgresql://neondb_owner:secret_leak@ep-bad.neon.tech/neondb connection failed'
            );
          }
          return filterWhere(where).length;
        }),
        findMany: vi.fn(async ({ where }: { where?: Record<string, unknown> }) =>
          filterWhere(where)
        ),
        findFirst: txClient.member.findFirst,
      },
      $transaction: vi.fn(async (cb: (tx: typeof txClient) => Promise<unknown>) =>
        cb(txClient)
      ),
    },
  };
});

import * as membersCollectionRoute from './route';
import * as memberDetailRoute from './[id]/route';
import * as memberArchiveRoute from './[id]/archive/route';
import * as memberRestoreRoute from './[id]/restore/route';

function setOwner(orgId: string = 'org_owner_a', userId: string = 'usr_owner_a') {
  mockState.authResult = {
    status: 'authenticated',
    owner: {
      session: {
        sub: userId,
        role: 'OWNER',
        org: orgId,
        ver: 1,
        iat: Math.floor(Date.now() / 1000) - 10,
        exp: Math.floor(Date.now() / 1000) + 3600,
      },
      profile: {
        id: userId,
        firstName: 'Owner',
        lastName: 'User',
        email: 'owner@crelune.test',
        role: 'OWNER',
        organisationId: orgId,
        organisationName: 'CRELUNE Test',
        timezone: 'Africa/Accra',
      },
      preferences: null,
    },
  };
}

function makeJsonRequest(
  url: string,
  method: string,
  body?: unknown,
  headers: Record<string, string> = {}
) {
  return new Request(url, {
    method,
    headers: {
      host: 'localhost:3000',
      origin: 'http://localhost:3000',
      'content-type': 'application/json',
      ...headers,
    },
    ...(body !== undefined
      ? { body: typeof body === 'string' ? body : JSON.stringify(body) }
      : {}),
  });
}

describe('Member Directory API Routes — Security, Validation & Contracts', () => {
  beforeEach(() => {
    mockState.members.clear();
    mockState.auditLogs = [];
    mockState.clearCookieCalls = 0;
    mockState.forceDbFailure = false;
    mockState.idSeq = 0;
    mockState.authResult = { status: 'unauthenticated', owner: null };
  });

  it('rejects unauthenticated and revoked/invalid requests with 401 across all member endpoints', async () => {
    const reqGet = new Request('http://localhost:3000/api/members');
    const reqPost = makeJsonRequest('http://localhost:3000/api/members', 'POST', {
      fullName: 'Test Member',
    });
    const reqPatch = makeJsonRequest(
      'http://localhost:3000/api/members/mem_1',
      'PATCH',
      { fullName: 'Updated' }
    );
    const reqArchive = makeJsonRequest(
      'http://localhost:3000/api/members/mem_1/archive',
      'POST'
    );
    const reqRestore = makeJsonRequest(
      'http://localhost:3000/api/members/mem_1/restore',
      'POST'
    );

    const responses = await Promise.all([
      membersCollectionRoute.GET(reqGet),
      membersCollectionRoute.POST(reqPost),
      memberDetailRoute.GET(reqGet, { params: Promise.resolve({ id: 'mem_1' }) }),
      memberDetailRoute.PATCH(reqPatch, { params: Promise.resolve({ id: 'mem_1' }) }),
      memberArchiveRoute.POST(reqArchive, { params: Promise.resolve({ id: 'mem_1' }) }),
      memberRestoreRoute.POST(reqRestore, { params: Promise.resolve({ id: 'mem_1' }) }),
    ]);

    for (const res of responses) {
      expect(res.status).toBe(401);
    }

    // Revoked / non-owner session clears session cookie and returns 401
    mockState.authResult = { status: 'revoked', owner: null };
    const revokedRes = await membersCollectionRoute.GET(reqGet);
    expect(revokedRes.status).toBe(401);
    expect(mockState.clearCookieCalls).toBe(1);
  });

  it('rejects cross-site mutating requests without valid Origin/Referer with 403', async () => {
    setOwner('org_a');
    const crossSiteReq = makeJsonRequest(
      'http://localhost:3000/api/members',
      'POST',
      { fullName: 'Ama Mensah' },
      { origin: 'https://evil.example.com' }
    );
    const res = await membersCollectionRoute.POST(crossSiteReq);
    expect(res.status).toBe(403);
  });

  it('rejects client-supplied organisationId, unexpected protected fields, invalid birthdays, and malformed JSON', async () => {
    setOwner('org_a');

    // Client-supplied organisationId on POST
    const orgInjectionRes = await membersCollectionRoute.POST(
      makeJsonRequest('http://localhost:3000/api/members', 'POST', {
        fullName: 'Ama Mensah',
        organisationId: 'org_b',
      })
    );
    expect(orgInjectionRes.status).toBe(400);

    // Client-supplied organisationId on GET query
    const queryOrgRes = await membersCollectionRoute.GET(
      new Request('http://localhost:3000/api/members?organisationId=org_b')
    );
    expect(queryOrgRes.status).toBe(400);

    // Unexpected / protected field on PATCH
    const patchProtectedRes = await memberDetailRoute.PATCH(
      makeJsonRequest('http://localhost:3000/api/members/mem_1', 'PATCH', {
        archivedAt: new Date().toISOString(),
      }),
      { params: Promise.resolve({ id: 'mem_1' }) }
    );
    expect(patchProtectedRes.status).toBe(400);

    // Invalid birthday tuple (Feb 30)
    const badBirthdayRes = await membersCollectionRoute.POST(
      makeJsonRequest('http://localhost:3000/api/members', 'POST', {
        fullName: 'Ama Mensah',
        birthMonth: 2,
        birthDay: 30,
      })
    );
    expect(badBirthdayRes.status).toBe(400);

    // Malformed JSON
    const malformedJsonRes = await membersCollectionRoute.POST(
      makeJsonRequest('http://localhost:3000/api/members', 'POST', '{bad-json')
    );
    expect(malformedJsonRes.status).toBe(400);
  });

  it('enforces strict organisation isolation on reads, updates, archiving, and restoring without leaking ownership', async () => {
    setOwner('org_a', 'usr_a');
    const createRes = await membersCollectionRoute.POST(
      makeJsonRequest('http://localhost:3000/api/members', 'POST', {
        fullName: 'Ama Mensah',
        birthMonth: 2,
        birthDay: 29,
        notes: 'Private Org A note',
      })
    );
    expect(createRes.status).toBe(201);
    const createdBody = await createRes.json();
    const memberId = createdBody.member.id as string;

    // Switch session to different organisation
    setOwner('org_b', 'usr_b');

    const getRes = await memberDetailRoute.GET(
      new Request(`http://localhost:3000/api/members/${memberId}`),
      { params: Promise.resolve({ id: memberId }) }
    );
    expect(getRes.status).toBe(404);
    expect((await getRes.json()).error).toBe('Member not found');

    const patchRes = await memberDetailRoute.PATCH(
      makeJsonRequest(`http://localhost:3000/api/members/${memberId}`, 'PATCH', {
        fullName: 'Hijacked',
      }),
      { params: Promise.resolve({ id: memberId }) }
    );
    expect(patchRes.status).toBe(404);

    const archiveRes = await memberArchiveRoute.POST(
      makeJsonRequest(
        `http://localhost:3000/api/members/${memberId}/archive`,
        'POST'
      ),
      { params: Promise.resolve({ id: memberId }) }
    );
    expect(archiveRes.status).toBe(404);

    const restoreRes = await memberRestoreRoute.POST(
      makeJsonRequest(
        `http://localhost:3000/api/members/${memberId}/restore`,
        'POST'
      ),
      { params: Promise.resolve({ id: memberId }) }
    );
    expect(restoreRes.status).toBe(404);
  });

  it('does not leak database connection strings or stack traces on unexpected internal failures and exposes no audit DELETE/PATCH handler', async () => {
    setOwner('org_a');
    mockState.forceDbFailure = true;

    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await membersCollectionRoute.GET(
      new Request('http://localhost:3000/api/members')
    );
    consoleErrorSpy.mockRestore();

    expect(res.status).toBe(500);
    const bodyText = await res.text();
    expect(bodyText).not.toContain('postgresql://');
    expect(bodyText).not.toContain('secret_leak');
    expect(bodyText).not.toContain('ep-bad');
    expect(JSON.parse(bodyText)).toEqual({
      error: 'An unexpected server error occurred.',
    });

    // Ensure member routes do not expose DELETE handler
    expect('DELETE' in memberDetailRoute).toBe(false);
  });
});