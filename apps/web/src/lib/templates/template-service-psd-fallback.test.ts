import crypto from 'node:crypto';
import { Prisma } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CreativeObjectStorageProvider } from '@/lib/storage/creative-storage';

const {
  templateFindFirstMock,
  intentFindFirstMock,
  intentUpdateManyMock,
  cleanupUpsertMock,
  cleanupUpdateMock,
  versionFindFirstMock,
  transactionMock,
  recordAuditEventMock,
} = vi.hoisted(() => ({
  templateFindFirstMock: vi.fn(),
  intentFindFirstMock: vi.fn(),
  intentUpdateManyMock: vi.fn(),
  cleanupUpsertMock: vi.fn(),
  cleanupUpdateMock: vi.fn(),
  versionFindFirstMock: vi.fn(),
  transactionMock: vi.fn(),
  recordAuditEventMock: vi.fn(),
}));

vi.mock('@crelune/database', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@crelune/database')>();
  return {
    ...actual,
    prisma: {
      template: { findFirst: templateFindFirstMock },
      creativeUploadIntent: {
        findFirst: intentFindFirstMock,
        updateMany: intentUpdateManyMock,
      },
      creativeStorageCleanup: {
        upsert: cleanupUpsertMock,
        update: cleanupUpdateMock,
      },
      templateVersion: { findFirst: versionFindFirstMock },
      $transaction: transactionMock,
    },
  };
});

vi.mock('@/lib/audit/audit-service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/audit/audit-service')>();
  return {
    ...actual,
    recordAuditEvent: recordAuditEventMock,
  };
});

import {
  TemplateValidationError,
  completeTemplateVersionUpload,
} from './template-service';

function buildPsdHeaderBytes(params: {
  width: number;
  height: number;
  version?: number;
}): Uint8Array {
  const buf = new Uint8Array(64);
  const view = new DataView(buf.buffer);
  buf[0] = 0x38;
  buf[1] = 0x42;
  buf[2] = 0x50;
  buf[3] = 0x53;
  view.setUint16(4, params.version ?? 1, false);
  view.setUint16(12, 3, false);
  view.setUint32(14, params.height, false);
  view.setUint32(18, params.width, false);
  view.setUint16(22, 8, false);
  view.setUint16(24, 3, false);
  return buf;
}

function sha256Hex(bytes: Uint8Array): string {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function createMemoryStorage(
  initialObjects: Record<string, { body: Uint8Array; contentType: string }>
): CreativeObjectStorageProvider {
  const store = new Map(Object.entries(initialObjects));
  return {
    bucket: 'crelune-dev-creative',
    envPrefix: 'development',
    createPresignedPutUrl: vi.fn(),
    headObject: vi.fn(async (key: string) => {
      const hit = store.get(key);
      return hit
        ? { exists: true, contentLength: hit.body.byteLength, contentType: hit.contentType }
        : { exists: false };
    }),
    getObjectBounded: vi.fn(async (key: string) => {
      const hit = store.get(key);
      if (!hit) {
        throw new Error(`Missing object: ${key}`);
      }
      return { body: hit.body, contentType: hit.contentType, contentLength: hit.body.byteLength };
    }),
    putPrivateObject: vi.fn(async ({ key, body, contentType }) => {
      store.set(key, { body: new Uint8Array(body), contentType });
    }),
    deleteObject: vi.fn(async (key: string) => {
      store.delete(key);
    }),
  };
}

describe('completeTemplateVersionUpload — Stage 5.2.2 Safe PSD Fallback', () => {
  const actor = {
    userId: '11111111-1111-4111-8111-111111111111',
    organisationId: '22222222-2222-4222-8222-222222222222',
  };
  const templateId = '33333333-3333-4333-8333-333333333333';
  const intentId = '44444444-4444-4444-8444-444444444444';
  const stagingKey = `development/organisations/${actor.organisationId}/templates/${templateId}/staging/masters/test-psd.psd`;
  const now = new Date('2026-11-12T13:00:00.000Z');
  const expiresAt = new Date('2026-11-12T13:15:00.000Z');

  beforeEach(() => {
    vi.clearAllMocks();
    cleanupUpsertMock.mockResolvedValue({ id: 'cleanup-1', attempts: 0 });
    cleanupUpdateMock.mockResolvedValue({});
    intentUpdateManyMock.mockResolvedValue({ count: 1 });
  });

  it('registers a valid PSD with MANUAL_REQUIRED, null detectedLayersJson, editabilityVerified=false, and preserves owner-supplied dimensions', async () => {
    const psdBytes = buildPsdHeaderBytes({ width: 1080, height: 1350 });
    const psdSha = sha256Hex(psdBytes);
    const storage = createMemoryStorage({
      [stagingKey]: { body: psdBytes, contentType: 'image/vnd.adobe.photoshop' },
    });

    templateFindFirstMock
      .mockResolvedValueOnce({ id: templateId, isActive: true, archivedAt: null })
      .mockResolvedValueOnce({
        id: templateId,
        name: 'Flyer',
        category: 'BIRTHDAY_FLYER',
        studioType: 'AFFINITY_DESIGNER',
        description: null,
        isActive: true,
        archivedAt: null,
        activeVersionId: 'ver-1',
        createdAt: now,
        updatedAt: now,
        versions: [
          {
            id: 'ver-1',
            templateId,
            versionNumber: 1,
            format: 'PSD',
            originalFilename: 'test-psd.psd',
            mimeType: 'image/vnd.adobe.photoshop',
            byteSize: psdBytes.byteLength,
            sha256: psdSha,
            widthPx: 1440,
            heightPx: 1800,
            previewStorageKey: null,
            inspectionStatus: 'MANUAL_REQUIRED',
            inspectionSummary:
              'PSD header validated; automatic layer inspection is disabled for safety. Complete layer inspection and field mapping manually in Affinity.',
            inspectedAt: null,
            createdAt: now,
          },
        ],
      });

    intentFindFirstMock.mockResolvedValue({
      id: intentId,
      organisationId: actor.organisationId,
      kind: 'TEMPLATE_MASTER',
      status: 'PENDING',
      storageBucket: 'crelune-dev-creative',
      storageKey: stagingKey,
      expectedMimeType: 'image/vnd.adobe.photoshop',
      expectedByteSize: psdBytes.byteLength,
      expectedSha256: psdSha,
      maxAllowedBytes: 100 * 1024 * 1024,
      expiresAt,
    });

    let capturedCreateData: Record<string, unknown> | undefined;
    transactionMock.mockImplementation(async (fn: (tx: unknown) => Promise<string>) => {
      const tx = {
        $queryRaw: vi.fn(async () => [{ id: templateId, is_active: true, archived_at: null }]),
        creativeUploadIntent: { updateMany: vi.fn(async () => ({ count: 1 })) },
        templateVersion: {
          findFirst: vi.fn(async () => null),
          create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
            capturedCreateData = data;
            return { id: 'ver-1' };
          }),
        },
        template: { update: vi.fn(async () => ({})) },
      };
      return fn(tx);
    });

    versionFindFirstMock.mockResolvedValue({
      id: 'ver-1',
      templateId,
      versionNumber: 1,
      format: 'PSD',
      originalFilename: 'test-psd.psd',
      mimeType: 'image/vnd.adobe.photoshop',
      byteSize: psdBytes.byteLength,
      sha256: psdSha,
      widthPx: 1440,
      heightPx: 1800,
      previewStorageKey: null,
      inspectionStatus: 'MANUAL_REQUIRED',
      inspectionSummary:
        'PSD header validated; automatic layer inspection is disabled for safety. Complete layer inspection and field mapping manually in Affinity.',
      inspectedAt: null,
      detectedLayersJson: null,
      createdAt: now,
      fieldMappings: [],
    });

    const result = await completeTemplateVersionUpload(
      actor,
      templateId,
      {
        uploadIntentId: intentId,
        widthPx: 1440,
        heightPx: 1800,
        activateImmediately: true,
      },
      { storage, now: () => now }
    );

    expect(result.inspection).toBeNull();
    expect(result.editabilityVerified).toBe(false);
    expect(result.version.inspectionStatus).toBe('MANUAL_REQUIRED');
    expect(result.version.detectedLayers).toBeNull();
    expect(result.version.widthPx).toBe(1440);
    expect(result.version.heightPx).toBe(1800);
    expect(result.version.inspectionSummary).toContain('manually in Affinity');
    expect(capturedCreateData?.inspectionStatus).toBe('MANUAL_REQUIRED');
    expect(capturedCreateData?.detectedLayersJson).toBe(Prisma.JsonNull);
    expect(capturedCreateData?.inspectedAt).toBeNull();
  });

  it.each([
    {
      label: 'invalid PSD header',
      bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47, ...new Array(32).fill(0)]),
    },
    {
      label: 'unsupported PSB v2 version',
      bytes: buildPsdHeaderBytes({ width: 800, height: 800, version: 2 }),
    },
    {
      label: 'invalid PSD dimensions',
      bytes: buildPsdHeaderBytes({ width: 0, height: 800, version: 1 }),
    },
  ])('rejects $label safely and cleans up staged object', async ({ bytes }) => {
    const sha = sha256Hex(bytes);
    const storage = createMemoryStorage({
      [stagingKey]: { body: bytes, contentType: 'image/vnd.adobe.photoshop' },
    });

    templateFindFirstMock.mockResolvedValue({
      id: templateId,
      isActive: true,
      archivedAt: null,
    });
    intentFindFirstMock.mockResolvedValue({
      id: intentId,
      organisationId: actor.organisationId,
      kind: 'TEMPLATE_MASTER',
      status: 'PENDING',
      storageBucket: 'crelune-dev-creative',
      storageKey: stagingKey,
      expectedMimeType: 'image/vnd.adobe.photoshop',
      expectedByteSize: bytes.byteLength,
      expectedSha256: sha,
      maxAllowedBytes: 100 * 1024 * 1024,
      expiresAt,
    });

    await expect(
      completeTemplateVersionUpload(
        actor,
        templateId,
        { uploadIntentId: intentId, activateImmediately: false },
        { storage, now: () => now }
      )
    ).rejects.toMatchObject({
      name: 'TemplateValidationError',
      code: 'INVALID_PSD_FILE',
    } satisfies Partial<TemplateValidationError>);

    expect(storage.deleteObject).toHaveBeenCalledWith(stagingKey);
    expect(transactionMock).not.toHaveBeenCalled();
  });
});

