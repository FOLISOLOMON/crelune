import crypto from 'node:crypto';
import sharp from 'sharp';
import { prisma } from '@crelune/database';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createCreativeObjectStorageProvider } from '../lib/storage/creative-storage';
import {
  abandonUploadIntent,
  archiveTemplate,
  completeTemplateVersionUpload,
  createTemplate,
  createTemplateUploadIntent,
  getTemplateDetail,
  getTemplateVersionDetail,
  getTemplateVersionPreview,
  listTemplates,
  restoreTemplate,
  TemplateConflictError,
  TemplateNotFoundError,
  TemplateValidationError,
  TemplateVersionNotFoundError,
  updateTemplate,
  UploadIntentConflictError,
  UploadIntentNotFoundError,
  upsertTemplateFieldMappings,
} from '../lib/templates/template-service';
import { assertSafeDevDatabaseEnvironment } from './assert-dev-db';

function sha256Hex(bytes: Uint8Array): string {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function writePascalStringPadded4(name: string): Uint8Array {
  const nameBytes = new TextEncoder().encode(name.slice(0, 255));
  const rawLen = 1 + nameBytes.length;
  const paddedLen = Math.ceil(rawLen / 4) * 4;
  const buf = new Uint8Array(paddedLen);
  buf[0] = nameBytes.length;
  buf.set(nameBytes, 1);
  return buf;
}

function buildMinimalValidPsd(width = 1080, height = 1080): Uint8Array {
  const header = new Uint8Array(26);
  const hv = new DataView(header.buffer);
  header.set([0x38, 0x42, 0x50, 0x53], 0); // "8BPS"
  hv.setUint16(4, 1, false);
  hv.setUint16(12, 4, false);
  hv.setUint32(14, height, false);
  hv.setUint32(18, width, false);
  hv.setUint16(22, 8, false);
  hv.setUint16(24, 3, false);

  const emptySections = new Uint8Array(8);
  const pascalName = writePascalStringPadded4('Celebrant Name');
  const extraDataLen = 4 + 4 + pascalName.byteLength;
  const recordLen = 16 + 2 + 4 * 6 + 12 + 4 + extraDataLen;
  const rec = new Uint8Array(recordLen);
  const rv = new DataView(rec.buffer);
  let offset = 16;
  rv.setUint16(offset, 4, false);
  offset += 2;
  for (const cid of [-1, 0, 1, 2]) {
    rv.setInt16(offset, cid, false);
    offset += 2;
    rv.setUint32(offset, 2, false);
    offset += 4;
  }
  rec.set([0x38, 0x42, 0x49, 0x4d, 0x6e, 0x6f, 0x72, 0x6d], offset);
  offset += 8;
  rec[offset++] = 255;
  rec[offset++] = 0;
  rec[offset++] = 0;
  rec[offset++] = 0;
  rv.setUint32(offset, extraDataLen, false);
  offset += 12; // extraDataLen + mask(0) + blending(0)
  rec.set(pascalName, offset);

  const channelDataSize = 4 * 2;
  const layerInfoPayloadLen = 2 + recordLen + channelDataSize;
  const layerInfoPaddedLen = Math.ceil(layerInfoPayloadLen / 4) * 4;
  const layerAndMaskLen = 4 + layerInfoPaddedLen + 4;

  const layerSection = new Uint8Array(4 + layerAndMaskLen);
  const lsv = new DataView(layerSection.buffer);
  lsv.setUint32(0, layerAndMaskLen, false);
  lsv.setUint32(4, layerInfoPaddedLen, false);
  lsv.setInt16(8, 1, false);
  layerSection.set(rec, 10);

  const imageData = new Uint8Array(2);
  const total = new Uint8Array(
    header.byteLength +
      emptySections.byteLength +
      layerSection.byteLength +
      imageData.byteLength
  );
  let cursor = 0;
  total.set(header, cursor);
  cursor += header.byteLength;
  total.set(emptySections, cursor);
  cursor += emptySections.byteLength;
  total.set(layerSection, cursor);
  cursor += layerSection.byteLength;
  total.set(imageData, cursor);
  return total;
}

describe('Milestone 5 Stage 5.2 Template Backend (PostgreSQL + Neon Object Storage)', () => {
  const orgAId = crypto.randomUUID();
  const userAId = crypto.randomUUID();
  const orgBId = crypto.randomUUID();
  const userBId = crypto.randomUUID();

  beforeAll(async () => {
    assertSafeDevDatabaseEnvironment();

    await prisma.organisation.createMany({
      data: [
        {
          id: orgAId,
          slug: `stage52-org-a-${orgAId.slice(0, 8)}`,
          name: `Stage52 Org A ${orgAId.slice(0, 8)}`,
        },
        {
          id: orgBId,
          slug: `stage52-org-b-${orgBId.slice(0, 8)}`,
          name: `Stage52 Org B ${orgBId.slice(0, 8)}`,
        },
      ],
    });

    await prisma.user.createMany({
      data: [
        {
          id: userAId,
          organisationId: orgAId,
          email: `stage52-a-${userAId.slice(0, 8)}@example.test`,
          passwordHash: 'not-a-real-hash-stage52',
          firstName: 'Owner',
          lastName: 'Alpha',
          role: 'OWNER',
        },
        {
          id: userBId,
          organisationId: orgBId,
          email: `stage52-b-${userBId.slice(0, 8)}@example.test`,
          passwordHash: 'not-a-real-hash-stage52',
          firstName: 'Owner',
          lastName: 'Beta',
          role: 'OWNER',
        },
      ],
    });
  });

  afterAll(async () => {
    const orgIds = [orgAId, orgBId];
    const storage = createCreativeObjectStorageProvider();

    const intents = await prisma.creativeUploadIntent.findMany({
      where: { organisationId: { in: orgIds } },
      select: { storageKey: true },
    });
    for (const row of intents) {
      try {
        await storage.deleteObject(row.storageKey);
      } catch {
        // Best-effort cleanup of test objects
      }
    }

    await prisma.auditLog.deleteMany({ where: { organisationId: { in: orgIds } } });
    await prisma.creativeStorageCleanup.deleteMany({
      where: { organisationId: { in: orgIds } },
    });
    await prisma.designJob.deleteMany({ where: { organisationId: { in: orgIds } } });
    await prisma.templateFieldMapping.deleteMany({
      where: { organisationId: { in: orgIds } },
    });
    await prisma.template.updateMany({
      where: { organisationId: { in: orgIds } },
      data: { activeVersionId: null },
    });
    await prisma.templateVersion.deleteMany({
      where: { organisationId: { in: orgIds } },
    });
    await prisma.creativeUploadIntent.deleteMany({
      where: { organisationId: { in: orgIds } },
    });
    await prisma.template.deleteMany({ where: { organisationId: { in: orgIds } } });
    await prisma.user.deleteMany({ where: { organisationId: { in: orgIds } } });
    await prisma.organisation.deleteMany({ where: { id: { in: orgIds } } });

    const remainingOrgs = await prisma.organisation.count({
      where: { id: { in: orgIds } },
    });
    expect(remainingOrgs).toBe(0);
  });

  it('completes real presigned PUT upload for PSD + PNG preview, inspects layers safely, handles native Affinity fallback, rollback, and isolation', async () => {
    const actorA = { userId: userAId, organisationId: orgAId };
    const actorB = { userId: userBId, organisationId: orgBId };
    const storage = createCreativeObjectStorageProvider();

    // 1. Create template
    const created = await createTemplate(actorA, {
      name: 'Sunday Birthday Flyer',
      category: 'BIRTHDAY_FLYER',
      studioType: 'AFFINITY_DESIGNER',
      description: 'Stage 5.2 integration template',
    });
    expect(created.name).toBe('Sunday Birthday Flyer');
    expect(created.activeVersion).toBeNull();

    // 2. Presigned PUT intent + idempotency
    const psdBytes = buildMinimalValidPsd(1200, 1500);
    const psdSha = sha256Hex(psdBytes);
    const pngBytes = new Uint8Array(
      await sharp({
        create: {
          width: 32,
          height: 32,
          channels: 3,
          background: { r: 101, g: 65, b: 165 },
        },
      })
        .png()
        .toBuffer()
    );
    const pngSha = sha256Hex(pngBytes);

    const masterIntent1 = await createTemplateUploadIntent(actorA, {
      kind: 'TEMPLATE_MASTER',
      templateId: created.id,
      format: 'PSD',
      originalFilename: 'sunday-birthday.psd',
      mimeType: 'image/vnd.adobe.photoshop',
      byteSize: psdBytes.byteLength,
      sha256: psdSha,
      idempotencyKey: 'stage52_master_v1_key_001',
    });

    const masterIntentReplay = await createTemplateUploadIntent(actorA, {
      kind: 'TEMPLATE_MASTER',
      templateId: created.id,
      format: 'PSD',
      originalFilename: 'sunday-birthday.psd',
      mimeType: 'image/vnd.adobe.photoshop',
      byteSize: psdBytes.byteLength,
      sha256: psdSha,
      idempotencyKey: 'stage52_master_v1_key_001',
    });
    expect(masterIntentReplay.intent.id).toBe(masterIntent1.intent.id);

    const previewIntent = await createTemplateUploadIntent(actorA, {
      kind: 'TEMPLATE_PREVIEW',
      templateId: created.id,
      originalFilename: 'sunday-preview.png',
      mimeType: 'image/png',
      byteSize: pngBytes.byteLength,
      sha256: pngSha,
      idempotencyKey: 'stage52_preview_v1_key_001',
    });

    // 3. Actual HTTP PUT directly to Neon Object Storage presigned URLs
    const masterPut = await fetch(masterIntent1.upload.url, {
      method: 'PUT',
      headers: masterIntent1.upload.requiredHeaders,
      body: Buffer.from(psdBytes),
    });
    expect(masterPut.ok).toBe(true);

    const previewPut = await fetch(previewIntent.upload.url, {
      method: 'PUT',
      headers: previewIntent.upload.requiredHeaders,
      body: Buffer.from(pngBytes),
    });
    expect(previewPut.ok).toBe(true);

    // 4. Complete version v1
    const v1Res = await completeTemplateVersionUpload(actorA, created.id, {
      uploadIntentId: masterIntent1.intent.id,
      previewUploadIntentId: previewIntent.intent.id,
      activateImmediately: true,
    });
    const v1 = v1Res.version;
    expect(v1.versionNumber).toBe(1);
    expect(v1.inspectionStatus).toBe('INSPECTED');
    expect(v1.widthPx).toBe(1200);
    expect(v1.heightPx).toBe(1500);
    expect(v1.byteSize).toBe(psdBytes.byteLength);
    expect(v1.sha256).toBe(psdSha);
    expect(v1.hasPreview).toBe(true);
    expect(v1.detectedLayers?.editabilityVerified).toBe(false);
    expect(v1.detectedLayers?.extractedMetadataOnly).toBe(true);
    expect(v1.detectedLayers?.layers.some((l) => l.name === 'Celebrant Name')).toBe(
      true
    );

    // Preview binary download matches
    const downloadedPreview = await getTemplateVersionPreview(
      orgAId,
      created.id,
      v1.id
    );
    expect(downloadedPreview.mimeType).toBe('image/png');
    expect(Buffer.from(downloadedPreview.body)).toEqual(Buffer.from(pngBytes));

    // Replay of already-VERIFIED intent fails 409
    await expect(
      completeTemplateVersionUpload(actorA, created.id, {
        uploadIntentId: masterIntent1.intent.id,
        activateImmediately: true,
      })
    ).rejects.toBeInstanceOf(UploadIntentConflictError);

    // 5. Upsert field mappings on v1
    const mappings = await upsertTemplateFieldMappings(actorA, created.id, {
      templateVersionId: v1.id,
      mappings: [
        {
          fieldKey: 'member.fullName',
          fieldType: 'TEXT',
          targetLayerName: 'Celebrant Name',
          isRequired: true,
        },
      ],
    });
    expect(mappings).toHaveLength(1);
    expect(mappings[0]?.fieldKey).toBe('member.fullName');

    // 6. Cross-org IDOR isolation checks
    await expect(getTemplateDetail(orgBId, created.id)).rejects.toBeInstanceOf(
      TemplateNotFoundError
    );
    await expect(
      getTemplateVersionDetail(orgBId, created.id, v1.id)
    ).rejects.toBeInstanceOf(TemplateVersionNotFoundError);
    await expect(
      getTemplateVersionPreview(orgBId, created.id, v1.id)
    ).rejects.toBeInstanceOf(TemplateVersionNotFoundError);
    await expect(
      upsertTemplateFieldMappings(actorB, created.id, {
        templateVersionId: v1.id,
        mappings: [],
      })
    ).rejects.toBeInstanceOf(TemplateVersionNotFoundError);
    await expect(archiveTemplate(actorB, created.id)).rejects.toBeInstanceOf(
      TemplateNotFoundError
    );

    // 7. Native Affinity (.afdesign) v2 registration & rollback to v1
    const afBytes = new Uint8Array([0x00, 0xff, 0x41, 0x46, 0x33, 0x33, 0x01, 0x02]);
    const afSha = sha256Hex(afBytes);
    const afIntent = await createTemplateUploadIntent(actorA, {
      kind: 'TEMPLATE_MASTER',
      templateId: created.id,
      format: 'AFDESIGN',
      originalFilename: 'sunday-birthday.afdesign',
      mimeType: 'application/octet-stream',
      byteSize: afBytes.byteLength,
      sha256: afSha,
      idempotencyKey: 'stage52_master_v2_afdesign_001',
    });

    const afPut = await fetch(afIntent.upload.url, {
      method: 'PUT',
      headers: afIntent.upload.requiredHeaders,
      body: Buffer.from(afBytes),
    });
    expect(afPut.ok).toBe(true);

    const v2Res = await completeTemplateVersionUpload(actorA, created.id, {
      uploadIntentId: afIntent.intent.id,
      widthPx: 1080,
      heightPx: 1350,
      activateImmediately: true,
    });
    const v2 = v2Res.version;
    expect(v2.versionNumber).toBe(2);
    expect(v2.inspectionStatus).toBe('MANUAL_REQUIRED');
    expect(v2.detectedLayers).toBeNull();
    expect(v2.widthPx).toBe(1080);
    expect(v2.heightPx).toBe(1350);

    // Rollback to v1
    const rolledBack = await updateTemplate(actorA, created.id, {
      activeVersionId: v1.id,
    });
    expect(rolledBack.activeVersion?.id).toBe(v1.id);
    expect(rolledBack.versions).toHaveLength(2);

    // 8. Checksum mismatch triggers rejection + immediate cleanup in crelune-dev-creative
    const badBytes = new Uint8Array([1, 2, 3, 4, 5, 6]);
    const declaredWrongSha = '0'.repeat(64);
    const badIntent = await createTemplateUploadIntent(actorA, {
      kind: 'TEMPLATE_MASTER',
      templateId: created.id,
      format: 'AF',
      originalFilename: 'tampered.af',
      mimeType: 'application/octet-stream',
      byteSize: badBytes.byteLength,
      sha256: declaredWrongSha,
      idempotencyKey: 'stage52_bad_checksum_001',
    });

    const badPut = await fetch(badIntent.upload.url, {
      method: 'PUT',
      headers: badIntent.upload.requiredHeaders,
      body: Buffer.from(badBytes),
    });
    expect(badPut.ok).toBe(true);

    await expect(
      completeTemplateVersionUpload(actorA, created.id, {
        uploadIntentId: badIntent.intent.id,
        activateImmediately: false,
      })
    ).rejects.toBeInstanceOf(TemplateValidationError);

    const badIntentRow = await prisma.creativeUploadIntent.findUnique({
      where: { id: badIntent.intent.id },
    });
    expect(badIntentRow?.status).toBe('REJECTED');

    const cleanupRow = await prisma.creativeStorageCleanup.findFirst({
      where: {
        organisationId: orgAId,
        objectKey: badIntentRow!.storageKey,
      },
    });
    expect(cleanupRow?.status).toBe('COMPLETED');
    const headAfterCleanup = await storage.headObject(badIntentRow!.storageKey);
    expect(headAfterCleanup.exists).toBe(false);

    // 9. Abandon intent lifecycle
    const abandonable = await createTemplateUploadIntent(actorA, {
      kind: 'TEMPLATE_MASTER',
      templateId: created.id,
      format: 'AF',
      originalFilename: 'abandoned.af',
      mimeType: 'application/octet-stream',
      byteSize: 128,
      sha256: 'b'.repeat(64),
      idempotencyKey: 'stage52_abandon_001',
    });
    await expect(
      abandonUploadIntent(actorB, abandonable.intent.id)
    ).rejects.toBeInstanceOf(UploadIntentNotFoundError);
    const abandoned = await abandonUploadIntent(actorA, abandonable.intent.id);
    expect(abandoned.status).toBe('ABANDONED');
    await expect(
      completeTemplateVersionUpload(actorA, created.id, {
        uploadIntentId: abandonable.intent.id,
        activateImmediately: false,
      })
    ).rejects.toBeInstanceOf(UploadIntentConflictError);

    // 10. Soft archive preserves linked DesignJob & blocks uploads until restored
    const linkedJob = await prisma.designJob.create({
      data: {
        organisationId: orgAId,
        title: 'Linked Birthday Job',
        category: 'BIRTHDAY_FLYER',
        status: 'PENDING',
        templateId: created.id,
        templateVersionId: v1.id,
      },
    });

    const archived = await archiveTemplate(actorA, created.id);
    expect(archived.isActive).toBe(false);
    expect(archived.archivedAt).not.toBeNull();

    const listWithoutArchived = await listTemplates(orgAId, {
      q: '',
      category: 'ALL',
      studioType: 'ALL',
      includeArchived: false,
      page: 1,
      pageSize: 24,
    });
    expect(listWithoutArchived.items.some((t) => t.id === created.id)).toBe(false);

    await expect(
      createTemplateUploadIntent(actorA, {
        kind: 'TEMPLATE_MASTER',
        templateId: created.id,
        format: 'AF',
        originalFilename: 'blocked.af',
        mimeType: 'application/octet-stream',
        byteSize: 64,
        sha256: 'c'.repeat(64),
        idempotencyKey: 'stage52_archived_block_001',
      })
    ).rejects.toBeInstanceOf(TemplateConflictError);

    const jobStillLinked = await prisma.designJob.findUnique({
      where: { id: linkedJob.id },
    });
    expect(jobStillLinked?.templateVersionId).toBe(v1.id);

    const restored = await restoreTemplate(actorA, created.id);
    expect(restored.isActive).toBe(true);
    expect(restored.archivedAt).toBeNull();

    // 11. Audit logs contain zero storage keys or signed URLs
    const masterRow = await prisma.creativeUploadIntent.findUniqueOrThrow({
      where: { id: masterIntent1.intent.id },
      select: { storageKey: true },
    });
    const audits = await prisma.auditLog.findMany({
      where: { organisationId: orgAId },
    });
    expect(audits.length).toBeGreaterThanOrEqual(5);
    const serializedAudits = JSON.stringify(audits);
    expect(serializedAudits).not.toContain(masterRow.storageKey);
    expect(serializedAudits).not.toContain('X-Amz-Signature');
  });

  it('allocates distinct sequential version numbers under concurrent version completions', async () => {
    const actorA = { userId: userAId, organisationId: orgAId };
    const template = await createTemplate(actorA, {
      name: 'Concurrent Version Template',
      category: 'EVENT_ANNOUNCEMENT',
      studioType: 'AFFINITY_DESIGNER',
    });

    const bytes1 = new Uint8Array([0x01, 0x02, 0x03, 0x04, 0x05]);
    const bytes2 = new Uint8Array([0x06, 0x07, 0x08, 0x09, 0x0a]);

    const [intent1, intent2] = await Promise.all([
      createTemplateUploadIntent(actorA, {
        kind: 'TEMPLATE_MASTER',
        templateId: template.id,
        format: 'AF',
        originalFilename: 'concurrent-1.af',
        mimeType: 'application/octet-stream',
        byteSize: bytes1.byteLength,
        sha256: sha256Hex(bytes1),
        idempotencyKey: 'stage52_concurrent_1_001',
      }),
      createTemplateUploadIntent(actorA, {
        kind: 'TEMPLATE_MASTER',
        templateId: template.id,
        format: 'AF',
        originalFilename: 'concurrent-2.af',
        mimeType: 'application/octet-stream',
        byteSize: bytes2.byteLength,
        sha256: sha256Hex(bytes2),
        idempotencyKey: 'stage52_concurrent_2_001',
      }),
    ]);

    await Promise.all([
      fetch(intent1.upload.url, {
        method: 'PUT',
        headers: intent1.upload.requiredHeaders,
        body: Buffer.from(bytes1),
      }),
      fetch(intent2.upload.url, {
        method: 'PUT',
        headers: intent2.upload.requiredHeaders,
        body: Buffer.from(bytes2),
      }),
    ]);

    const [vA, vB] = await Promise.all([
      completeTemplateVersionUpload(actorA, template.id, {
        uploadIntentId: intent1.intent.id,
        activateImmediately: false,
      }),
      completeTemplateVersionUpload(actorA, template.id, {
        uploadIntentId: intent2.intent.id,
        activateImmediately: false,
      }),
    ]);

    expect(new Set([vA.version.versionNumber, vB.version.versionNumber])).toEqual(
      new Set([1, 2])
    );
  });
});
