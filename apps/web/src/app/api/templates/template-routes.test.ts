import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextResponse } from 'next/server';

const {
  resolveAuthenticatedOwnerMock,
  validateRequestOriginMock,
  clearSessionCookieMock,
  consumeUploadIntentRateLimitMock,
  createTemplateMock,
  listTemplatesMock,
  getTemplateDetailMock,
  updateTemplateMock,
  archiveTemplateMock,
  restoreTemplateMock,
  createTemplateUploadIntentMock,
  completeTemplateVersionUploadMock,
  getTemplateVersionDetailMock,
  getTemplateVersionPreviewMock,
  upsertTemplateFieldMappingsMock,
  abandonUploadIntentMock,
} = vi.hoisted(() => ({
  resolveAuthenticatedOwnerMock: vi.fn(),
  validateRequestOriginMock: vi.fn(),
  clearSessionCookieMock: vi.fn(),
  consumeUploadIntentRateLimitMock: vi.fn(),
  createTemplateMock: vi.fn(),
  listTemplatesMock: vi.fn(),
  getTemplateDetailMock: vi.fn(),
  updateTemplateMock: vi.fn(),
  archiveTemplateMock: vi.fn(),
  restoreTemplateMock: vi.fn(),
  createTemplateUploadIntentMock: vi.fn(),
  completeTemplateVersionUploadMock: vi.fn(),
  getTemplateVersionDetailMock: vi.fn(),
  getTemplateVersionPreviewMock: vi.fn(),
  upsertTemplateFieldMappingsMock: vi.fn(),
  abandonUploadIntentMock: vi.fn(),
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

vi.mock('@/lib/auth/rate-limit', () => ({
  consumeUploadIntentRateLimit: consumeUploadIntentRateLimitMock,
}));

vi.mock('@/lib/templates/template-service', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/lib/templates/template-service')>();
  return {
    ...actual,
    createTemplate: createTemplateMock,
    listTemplates: listTemplatesMock,
    getTemplateDetail: getTemplateDetailMock,
    updateTemplate: updateTemplateMock,
    archiveTemplate: archiveTemplateMock,
    restoreTemplate: restoreTemplateMock,
    createTemplateUploadIntent: createTemplateUploadIntentMock,
    completeTemplateVersionUpload: completeTemplateVersionUploadMock,
    getTemplateVersionDetail: getTemplateVersionDetailMock,
    getTemplateVersionPreview: getTemplateVersionPreviewMock,
    upsertTemplateFieldMappings: upsertTemplateFieldMappingsMock,
    abandonUploadIntent: abandonUploadIntentMock,
  };
});

import {
  TemplateConflictError,
  TemplateNotFoundError,
  UploadIntentConflictError,
  UploadIntentExpiredError,
} from '@/lib/templates/template-service';
import { GET as listTemplatesRoute, POST as createTemplateRoute } from './route';
import { GET as getTemplateRoute, PATCH as patchTemplateRoute } from './[id]/route';
import { POST as archiveTemplateRoute } from './[id]/archive/route';
import { POST as restoreTemplateRoute } from './[id]/restore/route';
import { POST as createUploadIntentRoute } from './[id]/upload-intents/route';
import { POST as completeVersionRoute } from './[id]/versions/route';
import { GET as getVersionDetailRoute } from './[id]/versions/[versionId]/route';
import { GET as getVersionPreviewRoute } from './[id]/versions/[versionId]/preview/route';
import { PUT as putMappingsRoute } from './[id]/versions/[versionId]/mappings/route';
import { POST as abandonIntentRoute } from './upload-intents/[intentId]/abandon/route';

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

const VALID_TEMPLATE_ID = '55555555-5555-4555-8555-555555555555';
const VALID_VERSION_ID = '66666666-6666-4666-8666-666666666666';
const VALID_INTENT_ID = '77777777-7777-4777-8777-777777777777';
const VALID_SHA256 = 'a'.repeat(64);

describe('Milestone 5 Stage 5.2 Template API Routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveAuthenticatedOwnerMock.mockResolvedValue(AUTHENTICATED_OWNER);
    validateRequestOriginMock.mockReturnValue({ allowed: true });
    consumeUploadIntentRateLimitMock.mockResolvedValue({
      allowed: true,
      blockedUntil: null,
    });
    expect(NextResponse).toBeDefined();
  });

  it('requires authentication on GET /api/templates and CSRF on POST /api/templates', async () => {
    resolveAuthenticatedOwnerMock.mockResolvedValueOnce({ status: 'unauthenticated' });
    const unauthRes = await listTemplatesRoute(
      new Request('http://localhost:3000/api/templates')
    );
    expect(unauthRes.status).toBe(401);

    validateRequestOriginMock.mockReturnValueOnce({
      allowed: false,
      reason: 'Origin mismatch',
    });
    const csrfRes = await createTemplateRoute(
      new Request('http://localhost:3000/api/templates', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: 'Birthday Flyer',
          studioType: 'DESIGNER',
        }),
      })
    );
    expect(csrfRes.status).toBe(403);
    expect(createTemplateMock).not.toHaveBeenCalled();
  });

  it('validates route IDs and Zod payloads before reaching service layer', async () => {
    const badIdRes = await getTemplateRoute(
      new Request('http://localhost:3000/api/templates/bad%20id'),
      { params: Promise.resolve({ id: 'bad id' }) }
    );
    expect(badIdRes.status).toBe(400);

    const badBodyRes = await createTemplateRoute(
      new Request('http://localhost:3000/api/templates', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: 'C:\\Users\\evil\\template.psd',
          studioType: 'DESIGNER',
        }),
      })
    );
    expect(badBodyRes.status).toBe(400);
    expect(createTemplateMock).not.toHaveBeenCalled();
  });

  it('enforces upload-intent rate limiting (429) and rejects mismatched templateId', async () => {
    consumeUploadIntentRateLimitMock.mockResolvedValueOnce({
      allowed: false,
      blockedUntil: new Date('2026-11-12T10:15:00.000Z'),
    });

    const limitedRes = await createUploadIntentRoute(
      new Request(`http://localhost:3000/api/templates/${VALID_TEMPLATE_ID}/upload-intents`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          kind: 'TEMPLATE_MASTER',
          format: 'PSD',
          originalFilename: 'birthday-master.psd',
          mimeType: 'image/vnd.adobe.photoshop',
          byteSize: 1024,
          sha256: VALID_SHA256,
          idempotencyKey: 'intent_key_123456',
        }),
      }),
      { params: Promise.resolve({ id: VALID_TEMPLATE_ID }) }
    );
    expect(limitedRes.status).toBe(429);
    expect(createTemplateUploadIntentMock).not.toHaveBeenCalled();

    const mismatchRes = await createUploadIntentRoute(
      new Request(`http://localhost:3000/api/templates/${VALID_TEMPLATE_ID}/upload-intents`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          kind: 'TEMPLATE_MASTER',
          templateId: VALID_VERSION_ID,
          format: 'PSD',
          originalFilename: 'birthday-master.psd',
          mimeType: 'image/vnd.adobe.photoshop',
          byteSize: 1024,
          sha256: VALID_SHA256,
          idempotencyKey: 'intent_key_123456',
        }),
      }),
      { params: Promise.resolve({ id: VALID_TEMPLATE_ID }) }
    );
    expect(mismatchRes.status).toBe(400);
    expect(createTemplateUploadIntentMock).not.toHaveBeenCalled();
  });

  it('maps domain errors cleanly and never leaks secrets or storage internals on 500', async () => {
    getTemplateDetailMock.mockRejectedValueOnce(new TemplateNotFoundError());
    const notFoundRes = await getTemplateRoute(
      new Request(`http://localhost:3000/api/templates/${VALID_TEMPLATE_ID}`),
      { params: Promise.resolve({ id: VALID_TEMPLATE_ID }) }
    );
    expect(notFoundRes.status).toBe(404);

    archiveTemplateMock.mockRejectedValueOnce(
      new TemplateConflictError('Template already archived.')
    );
    const conflictRes = await archiveTemplateRoute(
      new Request(`http://localhost:3000/api/templates/${VALID_TEMPLATE_ID}/archive`, {
        method: 'POST',
      }),
      { params: Promise.resolve({ id: VALID_TEMPLATE_ID }) }
    );
    expect(conflictRes.status).toBe(409);

    completeTemplateVersionUploadMock.mockRejectedValueOnce(
      new UploadIntentExpiredError()
    );
    const expiredRes = await completeVersionRoute(
      new Request(`http://localhost:3000/api/templates/${VALID_TEMPLATE_ID}/versions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          uploadIntentId: VALID_INTENT_ID,
          activateImmediately: true,
        }),
      }),
      { params: Promise.resolve({ id: VALID_TEMPLATE_ID }) }
    );
    expect(expiredRes.status).toBe(410);

    abandonUploadIntentMock.mockRejectedValueOnce(
      new UploadIntentConflictError('Cannot abandon verified intent.')
    );
    const abandonConflictRes = await abandonIntentRoute(
      new Request(
        `http://localhost:3000/api/templates/upload-intents/${VALID_INTENT_ID}/abandon`,
        { method: 'POST' }
      ),
      { params: Promise.resolve({ intentId: VALID_INTENT_ID }) }
    );
    expect(abandonConflictRes.status).toBe(409);

    restoreTemplateMock.mockRejectedValueOnce(
      new Error(
        'S3 failure AWS_SECRET_ACCESS_KEY=supersecret development/templates/org/key.psd'
      )
    );
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const serverErrRes = await restoreTemplateRoute(
      new Request(`http://localhost:3000/api/templates/${VALID_TEMPLATE_ID}/restore`, {
        method: 'POST',
      }),
      { params: Promise.resolve({ id: VALID_TEMPLATE_ID }) }
    );
    errSpy.mockRestore();

    expect(serverErrRes.status).toBe(500);
    const errText = await serverErrRes.text();
    expect(errText).not.toContain('supersecret');
    expect(errText).not.toContain('development/templates');
  });

  it('serves private preview bytes with no-store and nosniff headers and forwards version/mapping calls', async () => {
    const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    getTemplateVersionPreviewMock.mockResolvedValueOnce({
      body: pngBytes,
      mimeType: 'image/png',
      byteSize: pngBytes.byteLength,
    });

    const previewRes = await getVersionPreviewRoute(
      new Request(
        `http://localhost:3000/api/templates/${VALID_TEMPLATE_ID}/versions/${VALID_VERSION_ID}/preview`
      ),
      {
        params: Promise.resolve({
          id: VALID_TEMPLATE_ID,
          versionId: VALID_VERSION_ID,
        }),
      }
    );

    expect(previewRes.status).toBe(200);
    expect(previewRes.headers.get('Content-Type')).toBe('image/png');
    expect(previewRes.headers.get('Cache-Control')).toBe('private, no-store');
    expect(previewRes.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(previewRes.headers.get('X-Robots-Tag')).toBe('noindex, nofollow, noarchive');
    expect(new Uint8Array(await previewRes.arrayBuffer())).toEqual(pngBytes);

    getTemplateVersionDetailMock.mockResolvedValueOnce({ id: VALID_VERSION_ID });
    const detailRes = await getVersionDetailRoute(
      new Request(
        `http://localhost:3000/api/templates/${VALID_TEMPLATE_ID}/versions/${VALID_VERSION_ID}`
      ),
      {
        params: Promise.resolve({
          id: VALID_TEMPLATE_ID,
          versionId: VALID_VERSION_ID,
        }),
      }
    );
    expect(detailRes.status).toBe(200);

    upsertTemplateFieldMappingsMock.mockResolvedValueOnce([]);
    const mappingRes = await putMappingsRoute(
      new Request(
        `http://localhost:3000/api/templates/${VALID_TEMPLATE_ID}/versions/${VALID_VERSION_ID}/mappings`,
        {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            mappings: [
              {
                fieldKey: 'member.fullName',
                fieldType: 'TEXT',
                targetLayerName: 'Celebrant Name',
                isRequired: true,
              },
            ],
          }),
        }
      ),
      {
        params: Promise.resolve({
          id: VALID_TEMPLATE_ID,
          versionId: VALID_VERSION_ID,
        }),
      }
    );
    expect(mappingRes.status).toBe(200);
    expect(upsertTemplateFieldMappingsMock).toHaveBeenCalledTimes(1);

    updateTemplateMock.mockResolvedValueOnce({ id: VALID_TEMPLATE_ID });
    const patchRes = await patchTemplateRoute(
      new Request(`http://localhost:3000/api/templates/${VALID_TEMPLATE_ID}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ description: 'Updated description' }),
      }),
      { params: Promise.resolve({ id: VALID_TEMPLATE_ID }) }
    );
    expect(patchRes.status).toBe(200);
  });
});
