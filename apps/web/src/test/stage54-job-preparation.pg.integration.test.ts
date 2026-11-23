import crypto from 'node:crypto';
import sharp from 'sharp';
import { prisma } from '@crelune/database';
import { containsForbiddenManifestSecret } from '@crelune/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createDesignJob,
  DesignJobConflictError,
  getDesignJobById,
  transitionDesignJobStatus,
  updateDesignJob,
} from '../lib/designs/design-job-service';
import {
  cancelCreativeJobDispatch,
  completeExportDeliverableUpload,
  createCreativeJobDispatch,
  createExportDeliverableUploadIntent,
  getDesignJobPreparationSnapshot,
  getPinnedTemplateMasterForDesignJob,
  JobPreparationConflictError,
  JobPreparationValidationError,
  setExportPublishApproval,
} from '../lib/designs/job-preparation-service';
import { createCreativeObjectStorageProvider } from '../lib/storage/creative-storage';
import {
  buildTemplateMasterObjectKey,
  getCreativeObjectStorageConfig,
  getObjectStorageConfig,
} from '../lib/storage/storage-config';
import {
  assertSafeDevCreativeStorageEnvironment,
  assertSafeDevDatabaseEnvironment,
} from './assert-dev-db';

describe('Stage 5.4 Creative Job Preparation, Version Pinning, Manifest & Exports Integration (Neon Dev)', () => {
  const runId = `s54_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
  const uploadedCreativeKeys: string[] = [];
  let orgId = '';
  let userId = '';
  let memberWithPhotoId = '';
  let memberWithoutPhotoId = '';
  let templateId = '';
  let version1Id = '';
  let version2Id = '';
  let v1Sha256 = '';
  let v1Bytes: Uint8Array;
  const storage = createCreativeObjectStorageProvider();

  beforeAll(async () => {
    assertSafeDevDatabaseEnvironment();
    assertSafeDevCreativeStorageEnvironment();
    expect(getObjectStorageConfig().bucket).toBe('crelune-dev-member-photos');
    expect(getCreativeObjectStorageConfig().bucket).toBe('crelune-dev-creative');

    const org = await prisma.organisation.create({
      data: { name: `Stage 5.4 Org ${runId}`, slug: `stage54-${runId}` },
    });
    orgId = org.id;

    const user = await prisma.user.create({
      data: {
        organisationId: orgId,
        email: `owner-s54-${runId}@crelune.test`,
        passwordHash: 'not-a-login-hash',
        firstName: 'Stage54',
        lastName: 'Owner',
      },
    });
    userId = user.id;

    const memberWithPhoto = await prisma.member.create({
      data: {
        organisationId: orgId,
        fullName: 'Kofi Mensah',
        preferredName: 'Kofi',
        normalizedName: 'kofi mensah',
        birthMonth: 11,
        birthDay: 23,
        birthYear: null,
        photoStorageKey: `development/organisations/${orgId}/members/dummy/photos/sample.jpg`,
        photoMimeType: 'image/jpeg',
        photoByteSize: 1024,
        photoUpdatedAt: new Date(),
      },
    });
    memberWithPhotoId = memberWithPhoto.id;

    const memberWithoutPhoto = await prisma.member.create({
      data: {
        organisationId: orgId,
        fullName: 'Esi Owusu',
        normalizedName: 'esi owusu',
        birthMonth: 5,
        birthDay: 14,
        birthYear: null,
      },
    });
    memberWithoutPhotoId = memberWithoutPhoto.id;

    const tpl = await prisma.template.create({
      data: {
        organisationId: orgId,
        name: `Birthday Gold Frame ${runId}`,
        normalizedName: `birthday gold frame ${runId}`,
        category: 'BIRTHDAY_FLYER',
        studioType: 'AFFINITY_DESIGNER',
        createdByUserId: userId,
      },
    });
    templateId = tpl.id;

    // Upload real synthetic PSD header bytes for version 1 to crelune-dev-creative
    const psdBuf = Buffer.alloc(32);
    psdBuf.write('8BPS', 0, 'ascii');
    psdBuf.writeUInt16BE(1, 4);
    psdBuf.writeUInt16BE(3, 12);
    psdBuf.writeUInt32BE(1350, 14);
    psdBuf.writeUInt32BE(1080, 18);
    psdBuf.writeUInt16BE(8, 22);
    psdBuf.writeUInt16BE(3, 24);
    v1Bytes = new Uint8Array(psdBuf);
    v1Sha256 = crypto.createHash('sha256').update(v1Bytes).digest('hex');

    const v1Key = buildTemplateMasterObjectKey({
      envPrefix: 'development',
      organisationId: orgId,
      templateId,
      versionNumber: 1,
      extension: 'psd',
      objectId: `s54_v1_${runId}`,
    });
    await storage.putPrivateObject({
      key: v1Key,
      body: v1Bytes,
      contentType: 'image/vnd.adobe.photoshop',
    });
    uploadedCreativeKeys.push(v1Key);

    const v1 = await prisma.templateVersion.create({
      data: {
        organisationId: orgId,
        templateId,
        versionNumber: 1,
        format: 'PSD',
        storageBucket: storage.bucket,
        storageKey: v1Key,
        originalFilename: 'birthday-gold-v1.psd',
        mimeType: 'image/vnd.adobe.photoshop',
        byteSize: v1Bytes.byteLength,
        sha256: v1Sha256,
        widthPx: 1080,
        heightPx: 1350,
        inspectionStatus: 'MANUAL_REQUIRED',
        inspectionSummary: 'Manual inspection required in Affinity.',
        uploadedByUserId: userId,
      },
    });
    version1Id = v1.id;

    await prisma.templateFieldMapping.createMany({
      data: [
        {
          organisationId: orgId,
          templateVersionId: v1.id,
          fieldKey: 'member.fullName',
          fieldType: 'TEXT',
          targetLayerName: 'Celebrant_Name',
          isRequired: true,
        },
        {
          organisationId: orgId,
          templateVersionId: v1.id,
          fieldKey: 'member.birthdayDisplay',
          fieldType: 'DATE',
          targetLayerName: 'Birthday_Date',
          isRequired: true,
        },
        {
          organisationId: orgId,
          templateVersionId: v1.id,
          fieldKey: 'member.photo',
          fieldType: 'IMAGE',
          targetLayerName: 'Portrait_Frame',
          isRequired: true,
        },
        {
          organisationId: orgId,
          templateVersionId: v1.id,
          fieldKey: 'custom.blessing',
          fieldType: 'TEXT',
          targetLayerName: 'Blessing_Text',
          isRequired: false,
          defaultValue: 'God bless your new year!',
        },
      ],
    });

    const v2Key = buildTemplateMasterObjectKey({
      envPrefix: 'development',
      organisationId: orgId,
      templateId,
      versionNumber: 2,
      extension: 'afdesign',
      objectId: `s54_v2_${runId}`,
    });
    const v2Sha = crypto.createHash('sha256').update(`v2-${runId}`).digest('hex');
    const v2 = await prisma.templateVersion.create({
      data: {
        organisationId: orgId,
        templateId,
        versionNumber: 2,
        format: 'AFDESIGN',
        storageBucket: storage.bucket,
        storageKey: v2Key,
        originalFilename: 'birthday-gold-v2.afdesign',
        mimeType: 'application/octet-stream',
        byteSize: 2048,
        sha256: v2Sha,
        inspectionStatus: 'MANUAL_REQUIRED',
        uploadedByUserId: userId,
      },
    });
    version2Id = v2.id;

    // Activate v1 initially so creating a job pins v1
    await prisma.template.update({
      where: { id: templateId },
      data: { activeVersionId: version1Id },
    });
  });

  afterAll(async () => {
    const exports = await prisma.exportRecord.findMany({
      where: { organisationId: orgId },
      select: { storageKey: true },
    });
    for (const exp of exports) {
      uploadedCreativeKeys.push(exp.storageKey);
    }

    for (const key of uploadedCreativeKeys) {
      await storage.deleteObject(key).catch(() => undefined);
    }

    if (orgId) {
      await prisma.exportRecord.deleteMany({ where: { organisationId: orgId } });
      await prisma.creativeJobDispatch.deleteMany({ where: { organisationId: orgId } });
      await prisma.templateFieldMapping.deleteMany({ where: { organisationId: orgId } });
      await prisma.designJobHistory.deleteMany({ where: { organisationId: orgId } });
      await prisma.birthdayPreparation.deleteMany({ where: { organisationId: orgId } });
      await prisma.designJob.deleteMany({ where: { organisationId: orgId } });
      await prisma.template.updateMany({
        where: { organisationId: orgId },
        data: { activeVersionId: null },
      });
      await prisma.templateVersion.deleteMany({ where: { organisationId: orgId } });
      await prisma.template.deleteMany({ where: { organisationId: orgId } });
      await prisma.creativeUploadIntent.deleteMany({ where: { organisationId: orgId } });
      await prisma.creativeStorageCleanup.deleteMany({ where: { organisationId: orgId } });
      await prisma.auditLog.deleteMany({ where: { organisationId: orgId } });
      await prisma.member.deleteMany({ where: { organisationId: orgId } });
      await prisma.user.deleteMany({ where: { organisationId: orgId } });
      await prisma.organisation.deleteMany({ where: { id: orgId } });
    }
  });

  it('pins exact template version without silent substitution, rejects missing required assets, prepares idempotent dispatches, and keeps EXPORTED separate from PUBLISHED', async () => {
    const actor = { userId, organisationId: orgId };

    // 1. Job for member WITHOUT photo -> blocked cleanly without fabricating asset
    const missingAssetJob = await createDesignJob(actor, {
      title: `Esi Birthday Flyer ${runId}`,
      category: 'BIRTHDAY_FLYER',
      priority: 'NORMAL',
      initialStatus: 'DRAFT',
      memberId: memberWithoutPhotoId,
      birthdayTargetYear: 2026,
      templateId,
    });
    expect(missingAssetJob.templateId).toBe(templateId);
    expect(missingAssetJob.templateVersionId).toBe(version1Id);

    const missingPrep = await getDesignJobPreparationSnapshot(
      actor,
      missingAssetJob.id
    );
    expect(missingPrep.ready).toBe(false);
    expect(
      missingPrep.issues.some((i) => i.code === 'MISSING_REQUIRED_ASSET')
    ).toBe(true);

    await expect(
      createCreativeJobDispatch(actor, missingAssetJob.id, {
        designJobId: missingAssetJob.id,
        templateVersionId: version1Id,
        idempotencyKey: `disp_missing_${runId}`,
        exportFormats: ['PNG'],
      })
    ).rejects.toThrow(JobPreparationValidationError);

    // 2. Job for member WITH photo -> pinned to v1, then template activeVersion moves to v2
    const job = await createDesignJob(actor, {
      title: `Kofi Birthday Flyer ${runId}`,
      category: 'BIRTHDAY_FLYER',
      priority: 'HIGH',
      initialStatus: 'DRAFT',
      memberId: memberWithPhotoId,
      birthdayTargetYear: 2026,
      templateId,
      requiredText: 'Happy Birthday Kofi!',
      targetPlatform: 'Instagram',
    });
    expect(job.templateVersionId).toBe(version1Id);

    // Activate v2 on template -> job MUST remain strictly pinned to v1!
    await prisma.template.update({
      where: { id: templateId },
      data: { activeVersionId: version2Id },
    });

    const prepSnapshot = await getDesignJobPreparationSnapshot(actor, job.id);
    expect(prepSnapshot.ready).toBe(true);
    expect(prepSnapshot.binding?.templateVersionId).toBe(version1Id);
    expect(prepSnapshot.binding?.isPinnedToOlderVersion).toBe(true);
    expect(prepSnapshot.manifestPreview).not.toBeNull();
    expect(
      containsForbiddenManifestSecret(prepSnapshot.manifestPreview)
    ).toBe(false);

    // Unknown birth year is NEVER fabricated in birthdayDisplay
    const bdayField = prepSnapshot.manifestPreview!.fields.find(
      (f) => f.fieldKey === 'member.birthdayDisplay'
    );
    expect(bdayField?.textValue).toBe('23 November');

    // Attempting to prepare with v2 while pinned to v1 MUST fail with 409 Conflict
    await expect(
      createCreativeJobDispatch(actor, job.id, {
        designJobId: job.id,
        templateVersionId: version2Id,
        idempotencyKey: `disp_mismatch_${runId}`,
        exportFormats: ['PNG'],
      })
    ).rejects.toThrow(JobPreparationConflictError);

    // Prepare dispatch pinned to v1 -> transitions DRAFT -> PENDING cleanly
    const idempKey = `disp_ready_${runId}`;
    const prepared = await createCreativeJobDispatch(actor, job.id, {
      designJobId: job.id,
      templateVersionId: version1Id,
      idempotencyKey: idempKey,
      exportFormats: ['PNG'],
    });
    expect(prepared.idempotentReplay).toBe(false);
    expect(prepared.dispatch.status).toBe('QUEUED');
    expect(prepared.manifest.templateVersionId).toBe(version1Id);
    expect(prepared.manifest.publicationRule).toBe('EXPORT_DOES_NOT_PUBLISH');

    // Idempotent replay with same key returns same dispatch
    const replay = await createCreativeJobDispatch(actor, job.id, {
      designJobId: job.id,
      templateVersionId: version1Id,
      idempotencyKey: idempKey,
      exportFormats: ['PNG'],
    });
    expect(replay.idempotentReplay).toBe(true);
    expect(replay.dispatch.id).toBe(prepared.dispatch.id);

    // Duplicate active dispatch with a NEW key is rejected with 409 Conflict
    await expect(
      createCreativeJobDispatch(actor, job.id, {
        designJobId: job.id,
        templateVersionId: version1Id,
        idempotencyKey: `disp_dup_${runId}`,
        exportFormats: ['PNG'],
      })
    ).rejects.toThrow(JobPreparationConflictError);

    // Trying to change template binding while active dispatch exists is rejected with 409 Conflict
    await expect(
      updateDesignJob(actor, job.id, {
        templateId,
        templateVersionId: version2Id,
      })
    ).rejects.toThrow(DesignJobConflictError);

    // Job transitioned DRAFT -> PENDING automatically
    const afterPrepJob = await getDesignJobById(orgId, job.id);
    expect(afterPrepJob.status).toBe('PENDING');

    // Manual fallback master download verifies SHA-256 cleanly
    const downloadedMaster = await getPinnedTemplateMasterForDesignJob(
      orgId,
      job.id
    );
    expect(downloadedMaster.sha256).toBe(v1Sha256);
    expect(downloadedMaster.byteSize).toBe(v1Bytes.byteLength);

    // Cancel active dispatch cleanly
    const cancelled = await cancelCreativeJobDispatch(
      actor,
      job.id,
      prepared.dispatch.id,
      'Switching to manual export test'
    );
    expect(cancelled.status).toBe('CANCELLED');

    // Move job through IN_PROGRESS -> AWAITING_REVIEW -> APPROVED, upload verified PNG export
    await transitionDesignJobStatus(actor, job.id, { status: 'IN_PROGRESS' });
    await transitionDesignJobStatus(actor, job.id, {
      status: 'AWAITING_REVIEW',
    });
    await transitionDesignJobStatus(actor, job.id, { status: 'APPROVED' });

    const pngBuf = await sharp({
      create: {
        width: 120,
        height: 150,
        channels: 4,
        background: { r: 101, g: 65, b: 165, alpha: 1 },
      },
    })
      .png()
      .toBuffer();
    const pngSha = crypto.createHash('sha256').update(pngBuf).digest('hex');

    const expIntent = await createExportDeliverableUploadIntent(actor, {
      designJobId: job.id,
      format: 'PNG',
      originalFilename: 'kofi-birthday-final.png',
      mimeType: 'image/png',
      byteSize: pngBuf.byteLength,
      sha256: pngSha,
      idempotencyKey: `exp_intent_${runId}`,
    });

    const putRes = await fetch(expIntent.upload.url, {
      method: 'PUT',
      headers: expIntent.upload.requiredHeaders,
      body: pngBuf,
    });
    expect(putRes.ok).toBe(true);

    const expDone = await completeExportDeliverableUpload(actor, {
      designJobId: job.id,
      uploadIntentId: expIntent.intent.id,
      format: 'PNG',
      mimeType: 'image/png',
    });
    expect(expDone.exportRecord.sha256).toBe(pngSha);
    expect(expDone.exportRecord.widthPx).toBe(120);
    expect(expDone.exportRecord.heightPx).toBe(150);
    expect(expDone.exportRecord.isApprovedForPublish).toBe(false);
    expect(expDone.exportRecord.publishedAt).toBeNull();

    // Job advanced APPROVED -> EXPORTED, NEVER PUBLISHED
    const exportedJob = await getDesignJobById(orgId, job.id);
    expect(exportedJob.status).toBe('EXPORTED');
    expect(exportedJob.publishedAt).toBeNull();

    // Owner explicit approval toggle does not auto-publish job
    const approvedExp = await setExportPublishApproval(
      actor,
      job.id,
      expDone.exportRecord.id,
      { isApprovedForPublish: true }
    );
    expect(approvedExp.isApprovedForPublish).toBe(true);
    expect(approvedExp.publishedAt).toBeNull();
  });
});
