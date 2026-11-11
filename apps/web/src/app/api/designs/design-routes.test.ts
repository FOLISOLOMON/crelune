import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextResponse } from 'next/server';

const {
  resolveAuthenticatedOwnerMock,
  validateRequestOriginMock,
  clearSessionCookieMock,
  listDesignJobsMock,
  createDesignJobMock,
  getDesignJobByIdMock,
  updateDesignJobMock,
  transitionDesignJobStatusMock,
} = vi.hoisted(() => ({
  resolveAuthenticatedOwnerMock: vi.fn(),
  validateRequestOriginMock: vi.fn(),
  clearSessionCookieMock: vi.fn(),
  listDesignJobsMock: vi.fn(),
  createDesignJobMock: vi.fn(),
  getDesignJobByIdMock: vi.fn(),
  updateDesignJobMock: vi.fn(),
  transitionDesignJobStatusMock: vi.fn(),
}));

vi.mock('@/lib/auth/owner-guard', () => ({
  resolveAuthenticatedOwner: resolveAuthenticatedOwnerMock,
}));

vi.mock('@/lib/auth/csrf', () => ({
  validateRequestOrigin: validateRequestOriginMock,
}));

vi.mock('@/lib/auth/session', () => ({
  clearSessionCookie: clearSessionCookieMock,
}));

vi.mock('@/lib/designs/design-job-service', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/lib/designs/design-job-service')>();
  return {
    ...actual,
    listDesignJobs: listDesignJobsMock,
    createDesignJob: createDesignJobMock,
    getDesignJobById: getDesignJobByIdMock,
    updateDesignJob: updateDesignJobMock,
    transitionDesignJobStatus: transitionDesignJobStatusMock,
  };
});

import {
  DesignJobConflictError,
  DesignJobNotFoundError,
  DesignJobTransitionError,
} from '@/lib/designs/design-job-service';
import { GET as listDesignsRoute, POST as createDesignRoute } from './route';
import { GET as getDesignRoute, PATCH as patchDesignRoute } from './[id]/route';
import { POST as transitionDesignRoute } from './[id]/transition/route';

const AUTHENTICATED_OWNER = {
  status: 'authenticated' as const,
  owner: {
    profile: {
      id: '11111111-1111-4111-8111-111111111111',
      organisationId: '22222222-2222-4222-8222-222222222222',
      organisationName: 'CRELUNE',
      email: 'owner@example.com',
      firstName: 'Workspace',
      lastName: 'Owner',
      role: 'OWNER',
    },
    preferences: null,
  },
};

const VALID_JOB_ID = '55555555-5555-4555-8555-555555555555';

describe('Milestone 4 Design Job API Routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveAuthenticatedOwnerMock.mockResolvedValue(AUTHENTICATED_OWNER);
    validateRequestOriginMock.mockReturnValue({ allowed: true });
    expect(NextResponse).toBeDefined();
  });

  it('requires authentication on GET /api/designs and enforces CSRF on POST /api/designs', async () => {
    resolveAuthenticatedOwnerMock.mockResolvedValueOnce({ status: 'unauthenticated' });
    const unauthRes = await listDesignsRoute(
      new Request('http://localhost:3000/api/designs')
    );
    expect(unauthRes.status).toBe(401);

    validateRequestOriginMock.mockReturnValueOnce({
      allowed: false,
      reason: 'Invalid Origin',
    });
    const csrfRes = await createDesignRoute(
      new Request('http://localhost:3000/api/designs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'Sunday Service Flyer' }),
      })
    );
    expect(csrfRes.status).toBe(403);
  });

  it('creates a design job with validated payload and returns 201', async () => {
    createDesignJobMock.mockResolvedValue({
      id: VALID_JOB_ID,
      title: 'Sunday Service Flyer',
      category: 'SERVICE_FLYER',
      status: 'PENDING',
      priority: 'HIGH',
      memberId: null,
      member: null,
      birthdayTargetYear: null,
      targetPlatform: 'Instagram',
      dimensions: '1080x1350',
      dueDate: '2026-11-22',
      approvedAt: null,
      exportedAt: null,
      publishedAt: null,
      cancelledAt: null,
      createdAt: '2026-11-11T10:00:00.000Z',
      updatedAt: '2026-11-11T10:00:00.000Z',
      requiredText: null,
      preferredTemplateNote: null,
      referenceNotes: null,
      notes: null,
      history: [],
    });

    const res = await createDesignRoute(
      new Request('http://localhost:3000/api/designs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: 'Sunday Service Flyer',
          category: 'SERVICE_FLYER',
          priority: 'HIGH',
          initialStatus: 'PENDING',
          targetPlatform: 'Instagram',
          dimensions: '1080x1350',
          dueDate: '2026-11-22',
        }),
      })
    );

    expect(res.status).toBe(201);
    expect(createDesignJobMock).toHaveBeenCalledTimes(1);
  });

  it('returns 404 when a design job does not belong to the owner workspace', async () => {
    getDesignJobByIdMock.mockRejectedValue(new DesignJobNotFoundError());
    const res = await getDesignRoute(
      new Request(`http://localhost:3000/api/designs/${VALID_JOB_ID}`),
      { params: Promise.resolve({ id: VALID_JOB_ID }) }
    );
    expect(res.status).toBe(404);
  });

  it('maps disallowed status transitions to HTTP 409 Conflict', async () => {
    transitionDesignJobStatusMock.mockRejectedValue(
      new DesignJobTransitionError('APPROVED', 'PUBLISHED')
    );

    const res = await transitionDesignRoute(
      new Request(`http://localhost:3000/api/designs/${VALID_JOB_ID}/transition`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'PUBLISHED' }),
      }),
      { params: Promise.resolve({ id: VALID_JOB_ID }) }
    );

    expect(res.status).toBe(409);
  });

  it('updates design metadata cleanly on PATCH /api/designs/[id]', async () => {
    updateDesignJobMock.mockResolvedValue({
      id: VALID_JOB_ID,
      title: 'Updated Flyer Brief',
    });

    const res = await patchDesignRoute(
      new Request(`http://localhost:3000/api/designs/${VALID_JOB_ID}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'Updated Flyer Brief' }),
      }),
      { params: Promise.resolve({ id: VALID_JOB_ID }) }
    );

    expect(res.status).toBe(200);
    expect(updateDesignJobMock).toHaveBeenCalledWith(
      {
        userId: AUTHENTICATED_OWNER.owner.profile.id,
        organisationId: AUTHENTICATED_OWNER.owner.profile.organisationId,
      },
      VALID_JOB_ID,
      { title: 'Updated Flyer Brief' }
    );
  });

  it('rejects incomplete BIRTHDAY_FLYER creation payloads with 400 and maps duplicate conflict to 409', async () => {
    const missingYearRes = await createDesignRoute(
      new Request('http://localhost:3000/api/designs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: 'Incomplete Birthday Flyer',
          category: 'BIRTHDAY_FLYER',
          memberId: '33333333-3333-4333-8333-333333333333',
        }),
      })
    );
    expect(missingYearRes.status).toBe(400);
    expect(createDesignJobMock).not.toHaveBeenCalled();

    createDesignJobMock.mockRejectedValueOnce(
      new DesignJobConflictError(
        'An active birthday design job already exists for this member in 2026.',
        'DUPLICATE_BIRTHDAY_DESIGN_JOB'
      )
    );

    const conflictRes = await createDesignRoute(
      new Request('http://localhost:3000/api/designs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: 'Duplicate Birthday Flyer',
          category: 'BIRTHDAY_FLYER',
          memberId: '33333333-3333-4333-8333-333333333333',
          birthdayTargetYear: 2026,
        }),
      })
    );
    expect(conflictRes.status).toBe(409);
    const conflictJson = await conflictRes.json();
    expect(conflictJson.code).toBe('DUPLICATE_BIRTHDAY_DESIGN_JOB');
  });

  it('maps prep ownership conflicts on PATCH /api/designs/[id] to 409', async () => {
    updateDesignJobMock.mockRejectedValueOnce(
      new DesignJobConflictError(
        'Birthday preparation for 2026 is already linked to another design job.',
        'BIRTHDAY_PREP_ALREADY_LINKED'
      )
    );

    const res = await patchDesignRoute(
      new Request(`http://localhost:3000/api/designs/${VALID_JOB_ID}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          memberId: '44444444-4444-4444-8444-444444444444',
          birthdayTargetYear: 2026,
        }),
      }),
      { params: Promise.resolve({ id: VALID_JOB_ID }) }
    );

    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.code).toBe('BIRTHDAY_PREP_ALREADY_LINKED');
  });
});
