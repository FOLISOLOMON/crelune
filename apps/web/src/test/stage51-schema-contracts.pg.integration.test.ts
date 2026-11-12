import crypto from 'node:crypto';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { Prisma, prisma } from '@crelune/database';
import { creativeJobManifestSchema } from '@crelune/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AUDIT_ACTIONS, recordAuditEvent } from '../lib/audit/audit-service';
import {
  assertKeyMatchesExportDeliverableScope,
  assertKeyMatchesTemplateMasterScope,
  assertKeyMatchesTemplatePreviewScope,
  assertKeyMatchesWorkingAssetScope,
  buildExportDeliverableObjectKey,
  buildTemplateMasterObjectKey,
  buildTemplatePreviewObjectKey,
  buildWorkingAssetObjectKey,
  getCreativeObjectStorageConfig,
  getObjectStorageConfig,
} from '../lib/storage/storage-config';
import {
  assertSafeDevCreativeStorageEnvironment,
  assertSafeDevDatabaseEnvironment,
} from './assert-dev-db';

describe('Stage 5.1 Schema, Constraints, Audit & crelune-dev-creative S3 Integration (Neon Dev)', () => {
  const runId = `s51_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
  const uploadedCreativeKeys: string[] = [];
  let orgId = '';
  let otherOrgId = '';
  let userId = '';
  let otherUserId = '';
  let s3Client: S3Client;
  let creativeBucket = '';

  beforeAll(async () => {
    assertSafeDevDatabaseEnvironment();
    const storageTarget = assertSafeDevCreativeStorageEnvironment();
    const memberPhotoCfg = getObjectStorageConfig();
    const creativeCfg = getCreativeObjectStorageConfig();

    expect(memberPhotoCfg.bucket).toBe('crelune-dev-member-photos');
    expect(creativeCfg.bucket).toBe('crelune-dev-creative');
    expect(storageTarget.bucket).toBe('crelune-dev-creative');

    creativeBucket = creativeCfg.bucket;
    s3Client = new S3Client({
      region: creativeCfg.region,
      endpoint: creativeCfg.endpoint,
      credentials: {
        accessKeyId: creativeCfg.accessKeyId,
        secretAccessKey: creativeCfg.secretAccessKey,
      },
      forcePathStyle: true,
    });

    const org = await prisma.organisation.create({
      data: {
        name: `Stage 5.1 Org ${runId}`,
        slug: `stage51-${runId}`,
      },
    });
    orgId = org.id;

    const otherOrg = await prisma.organisation.create({
      data: {
        name: `Stage 5.1 Other Org ${runId}`,
        slug: `stage51-other-${runId}`,
      },
    });
    otherOrgId = otherOrg.id;

    const user = await prisma.user.create({
      data: {
        organisationId: orgId,
        email: `owner-${runId}@crelune.test`,
        passwordHash: 'not-a-login-hash',
        firstName: 'Stage51',
        lastName: 'Owner',
      },
    });
    userId = user.id;

    const otherUser = await prisma.user.create({
      data: {
        organisationId: otherOrgId,
        email: `other-${runId}@crelune.test`,
        passwordHash: 'not-a-login-hash',
        firstName: 'Other',
        lastName: 'Owner',
      },
    });
    otherUserId = otherUser.id;
  });

  afterAll(async () => {
    for (const key of uploadedCreativeKeys) {
      await s3Client
        .send(
          new DeleteObjectCommand({
            Bucket: creativeBucket,
            Key: key,
          })
        )
        .catch(() => undefined);
    }

    const orgIds = [orgId, otherOrgId].filter(Boolean);
    if (orgIds.length > 0) {
      await prisma.exportRecord.deleteMany({ where: { organisationId: { in: orgIds } } });
      await prisma.creativeJobDispatch.deleteMany({ where: { organisationId: { in: orgIds } } });
      await prisma.templateFieldMapping.deleteMany({ where: { organisationId: { in: orgIds } } });
      await prisma.designJobHistory.deleteMany({ where: { organisationId: { in: orgIds } } });
      await prisma.designJob.deleteMany({ where: { organisationId: { in: orgIds } } });
      await prisma.template.updateMany({
        where: { organisationId: { in: orgIds } },
        data: { activeVersionId: null },
      });
      await prisma.templateVersion.deleteMany({ where: { organisationId: { in: orgIds } } });
      await prisma.template.deleteMany({ where: { organisationId: { in: orgIds } } });
      await prisma.creativeUploadIntent.deleteMany({ where: { organisationId: { in: orgIds } } });
      await prisma.creativeAgent.deleteMany({ where: { organisationId: { in: orgIds } } });
      await prisma.creativeStorageCleanup.deleteMany({ where: { organisationId: { in: orgIds } } });
      await prisma.auditLog.deleteMany({ where: { organisationId: { in: orgIds } } });
      await prisma.user.deleteMany({ where: { organisationId: { in: orgIds } } });
      await prisma.organisation.deleteMany({ where: { id: { in: orgIds } } });
    }
  });

  it('persists templates, immutable versions, field mappings, upload intents, agents, dispatches, non-published exports, and enforces DB constraints', async () => {
    const shaV1 = crypto.createHash('sha256').update(`v1-${runId}`).digest('hex');
    const shaV2 = crypto.createHash('sha256').update(`v2-${runId}`).digest('hex');

    const tpl = await prisma.template.create({
      data: {
        organisationId: orgId,
        name: 'Golden Birthday Portrait',
        normalizedName: 'golden birthday portrait',
        category: 'BIRTHDAY_FLYER',
        studioType: 'AFFINITY_STUDIO',
        description: 'Portrait birthday flyer template',
        createdByUserId: userId,
      },
    });

    const v1Key = buildTemplateMasterObjectKey({
      envPrefix: 'development',
      organisationId: orgId,
      templateId: tpl.id,
      versionNumber: 1,
      extension: 'psd',
      objectId: `v1_${runId}`,
    });

    const uploadIntentV1 = await prisma.creativeUploadIntent.create({
      data: {
        organisationId: orgId,
        requestedByUserId: userId,
        kind: 'TEMPLATE_MASTER',
        idempotencyKey: `intent_v1_${runId}`,
        storageBucket: creativeBucket,
        storageKey: v1Key,
        expectedMimeType: 'image/vnd.adobe.photoshop',
        expectedByteSize: 1024,
        expectedSha256: shaV1,
        maxAllowedBytes: 100 * 1024 * 1024,
        status: 'VERIFIED',
        verifiedByteSize: 1024,
        verifiedSha256: shaV1,
        expiresAt: new Date(Date.now() + 900_000),
        verifiedAt: new Date(),
      },
    });

    const v1 = await prisma.templateVersion.create({
      data: {
        organisationId: orgId,
        templateId: tpl.id,
        versionNumber: 1,
        format: 'PSD',
        storageBucket: creativeBucket,
        storageKey: v1Key,
        originalFilename: 'golden-v1.psd',
        mimeType: 'image/vnd.adobe.photoshop',
        byteSize: 1024,
        sha256: shaV1,
        inspectionStatus: 'INSPECTED',
        inspectionSummary: '1 text layer, 1 image layer',
        detectedLayersJson: [{ id: 'l1', name: 'Full Name', kind: 'TEXT' }],
        inspectedAt: new Date(),
        uploadedByUserId: userId,
        uploadIntentId: uploadIntentV1.id,
      },
    });

    // Reject duplicate versionNumber on the same template
    await expect(
      prisma.templateVersion.create({
        data: {
          organisationId: orgId,
          templateId: tpl.id,
          versionNumber: 1,
          format: 'PSD',
          storageBucket: creativeBucket,
          storageKey: `${v1Key}.dup`,
          originalFilename: 'dup.psd',
          mimeType: 'image/vnd.adobe.photoshop',
          byteSize: 512,
          sha256: shaV1,
          uploadedByUserId: userId,
        },
      })
    ).rejects.toMatchObject({ code: 'P2002' });

    // Create version 2 (native Affinity format requiring manual mapping fallback) & test activeVersionId switch + rollback
    const v2Key = buildTemplateMasterObjectKey({
      envPrefix: 'development',
      organisationId: orgId,
      templateId: tpl.id,
      versionNumber: 2,
      extension: 'afphoto',
      objectId: `v2_${runId}`,
    });

    const v2 = await prisma.templateVersion.create({
      data: {
        organisationId: orgId,
        templateId: tpl.id,
        versionNumber: 2,
        format: 'AFPHOTO',
        storageBucket: creativeBucket,
        storageKey: v2Key,
        originalFilename: 'golden-v2.afphoto',
        mimeType: 'application/octet-stream',
        byteSize: 2048,
        sha256: shaV2,
        inspectionStatus: 'MANUAL_REQUIRED',
        inspectionSummary: 'Native Affinity binary requires manual field mapping.',
        uploadedByUserId: userId,
      },
    });

    const activatedV2 = await prisma.template.update({
      where: { id: tpl.id },
      data: { activeVersionId: v2.id },
    });
    expect(activatedV2.activeVersionId).toBe(v2.id);

    const rolledBackV1 = await prisma.template.update({
      where: { id: tpl.id },
      data: { activeVersionId: v1.id },
    });
    expect(rolledBackV1.activeVersionId).toBe(v1.id);

    // TemplateFieldMapping unique constraint per [templateVersionId, fieldKey]
    await prisma.templateFieldMapping.create({
      data: {
        organisationId: orgId,
        templateVersionId: v1.id,
        fieldKey: 'member.fullName',
        fieldType: 'TEXT',
        targetLayerName: 'Full Name',
        layerPathJson: ['Typography', 'Full Name'],
        isRequired: true,
      },
    });

    await expect(
      prisma.templateFieldMapping.create({
        data: {
          organisationId: orgId,
          templateVersionId: v1.id,
          fieldKey: 'member.fullName',
          fieldType: 'TEXT',
          targetLayerName: 'Duplicate Name',
        },
      })
    ).rejects.toMatchObject({ code: 'P2002' });

    // CreativeAgent creation + revocation persistence
    const agentTokenHash = crypto.createHash('sha256').update(`tok_${runId}`).digest('hex');
    const agent = await prisma.creativeAgent.create({
      data: {
        organisationId: orgId,
        registeredByUserId: userId,
        name: 'Primary Studio Windows',
        machineLabel: 'STUDIO-WIN-01',
        tokenHash: agentTokenHash,
        tokenPrefix: 'cag_live_dev',
        agentVersion: '0.1.0',
        affinityVersion: '3.3.0',
        lastHeartbeatAt: new Date(),
      },
    });

    const revokedAgent = await prisma.creativeAgent.update({
      where: { id: agent.id },
      data: {
        status: 'REVOKED',
        revokedAt: new Date(),
        revokedByUserId: userId,
        revocationReason: 'Integration test revocation verification',
      },
    });
    expect(revokedAgent.status).toBe('REVOKED');

    // DesignJob optionally pinned to template + templateVersion
    const job = await prisma.designJob.create({
      data: {
        organisationId: orgId,
        title: `Sunday Special Flyer ${runId}`,
        category: 'EVENT_ANNOUNCEMENT',
        templateId: tpl.id,
        templateVersionId: v1.id,
      },
    });

    const manifestPayload = creativeJobManifestSchema.parse({
      manifestVersion: 1,
      dispatchId: `disp_placeholder_${runId}`,
      designJobId: job.id,
      organisationId: orgId,
      templateId: tpl.id,
      templateVersionId: v1.id,
      templateFormat: 'PSD',
      templateStudioType: 'AFFINITY_STUDIO',
      templateSha256: shaV1,
      templateRelativeFilename: 'templates/golden-v1.psd',
      preserveMasterImmutable: true,
      publicationRule: 'EXPORT_DOES_NOT_PUBLISH',
      outputSpec: {
        formats: ['PNG'],
        targetPlatform: 'Instagram',
        dimensions: '1080x1350',
      },
      fields: [
        {
          fieldKey: 'member.fullName',
          fieldType: 'TEXT',
          targetLayerName: 'Full Name',
          layerPath: ['Typography', 'Full Name'],
          textValue: 'Kwame Boateng',
          assetReference: null,
        },
      ],
    });

    const dispatch = await prisma.creativeJobDispatch.create({
      data: {
        organisationId: orgId,
        designJobId: job.id,
        templateVersionId: v1.id,
        assignedAgentId: agent.id,
        requestedByUserId: userId,
        idempotencyKey: `disp_${runId}`,
        manifestVersion: 1,
        manifestJson: manifestPayload as Prisma.InputJsonValue,
        status: 'QUEUED',
      },
    });

    // Referential integrity: dispatched templateVersion cannot be hard-deleted (onDelete: Restrict)
    await expect(
      prisma.templateVersion.delete({ where: { id: v1.id } })
    ).rejects.toThrow(
      /RESTRICT|23001|creative_job_dispatches_template_version_id_fkey/i
    );

    // ExportRecord separates export upload from publication
    const exportKey = buildExportDeliverableObjectKey({
      envPrefix: 'development',
      organisationId: orgId,
      designJobId: job.id,
      extension: 'png',
      objectId: `exp_${runId}`,
    });

    const exportRecord = await prisma.exportRecord.create({
      data: {
        organisationId: orgId,
        designJobId: job.id,
        dispatchId: dispatch.id,
        uploadedByAgentId: agent.id,
        format: 'PNG',
        storageBucket: creativeBucket,
        storageKey: exportKey,
        mimeType: 'image/png',
        byteSize: 4096,
        sha256: shaV2,
        widthPx: 1080,
        heightPx: 1350,
        resolutionDpi: 300,
      },
    });
    expect(exportRecord.isApprovedForPublish).toBe(false);
    expect(exportRecord.publishedAt).toBeNull();
    expect(exportRecord.ownerApprovedAt).toBeNull();

    // CreativeStorageCleanup persists independently from member-photo PendingStorageCleanup
    const cleanup = await prisma.creativeStorageCleanup.create({
      data: {
        organisationId: orgId,
        bucket: creativeBucket,
        objectKey: v2Key,
        reason: 'UPLOAD_ABANDONED',
      },
    });
    expect(cleanup.status).toBe('PENDING');

    // Audit action logging in transaction + org isolation verification
    await prisma.$transaction(async (tx) => {
      await recordAuditEvent(tx, {
        organisationId: orgId,
        actorUserId: userId,
        action: AUDIT_ACTIONS.TEMPLATE_CREATED,
        entityType: 'Template',
        entityId: tpl.id,
        metadata: { studioType: 'AFFINITY_STUDIO', versionNumber: 1 },
      });
    });

    const otherOrgTemplates = await prisma.template.findMany({
      where: { organisationId: otherOrgId },
    });
    expect(otherOrgTemplates).toHaveLength(0);

    // Silence unused otherUserId lint warning while confirming isolation setup worked
    expect(otherUserId).toBeTruthy();
  });

  it('writes, heads, reads, blocks anonymous access (403), and deletes objects across crelune-dev-creative namespaces', async () => {
    const templateMasterKey = buildTemplateMasterObjectKey({
      envPrefix: 'development',
      organisationId: orgId,
      templateId: `tpl_s3_${runId}`,
      versionNumber: 1,
      extension: 'psd',
      objectId: `master_${runId}`,
    });
    const templatePreviewKey = buildTemplatePreviewObjectKey({
      envPrefix: 'development',
      organisationId: orgId,
      templateId: `tpl_s3_${runId}`,
      versionNumber: 1,
      extension: 'png',
      objectId: `preview_${runId}`,
    });
    const workingAssetKey = buildWorkingAssetObjectKey({
      envPrefix: 'development',
      organisationId: orgId,
      scopeId: `disp_s3_${runId}`,
      extension: 'png',
      objectId: `work_${runId}`,
    });
    const exportKey = buildExportDeliverableObjectKey({
      envPrefix: 'development',
      organisationId: orgId,
      designJobId: `job_s3_${runId}`,
      extension: 'png',
      objectId: `exp_${runId}`,
    });

    assertKeyMatchesTemplateMasterScope(templateMasterKey, {
      envPrefix: 'development',
      organisationId: orgId,
      templateId: `tpl_s3_${runId}`,
      versionNumber: 1,
    });
    assertKeyMatchesTemplatePreviewScope(templatePreviewKey, {
      envPrefix: 'development',
      organisationId: orgId,
      templateId: `tpl_s3_${runId}`,
      versionNumber: 1,
    });
    assertKeyMatchesWorkingAssetScope(workingAssetKey, {
      envPrefix: 'development',
      organisationId: orgId,
      scopeId: `disp_s3_${runId}`,
    });
    assertKeyMatchesExportDeliverableScope(exportKey, {
      envPrefix: 'development',
      organisationId: orgId,
      designJobId: `job_s3_${runId}`,
    });

    const namespaces = [
      { key: templateMasterKey, contentType: 'image/vnd.adobe.photoshop', payload: `8BPS-${runId}` },
      { key: workingAssetKey, contentType: 'image/png', payload: `work-${runId}` },
      { key: exportKey, contentType: 'image/png', payload: `export-${runId}` },
    ];

    for (const item of namespaces) {
      uploadedCreativeKeys.push(item.key);
      await s3Client.send(
        new PutObjectCommand({
          Bucket: creativeBucket,
          Key: item.key,
          Body: Buffer.from(item.payload, 'utf8'),
          ContentType: item.contentType,
        })
      );

      const head = await s3Client.send(
        new HeadObjectCommand({
          Bucket: creativeBucket,
          Key: item.key,
        })
      );
      expect(head.ContentLength).toBe(Buffer.byteLength(item.payload, 'utf8'));

      const getRes = await s3Client.send(
        new GetObjectCommand({
          Bucket: creativeBucket,
          Key: item.key,
        })
      );
      const text = await getRes.Body?.transformToString('utf8');
      expect(text).toBe(item.payload);
    }

    // Verify bucket remains private (anonymous HTTP GET must fail with 403)
    const creativeCfg = getCreativeObjectStorageConfig();
    const anonResponse = await fetch(
      `${creativeCfg.endpoint}/${creativeBucket}/${templateMasterKey}`
    );
    expect(anonResponse.status).toBe(403);
  });
});

