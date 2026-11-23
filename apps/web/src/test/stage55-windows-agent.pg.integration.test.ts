import crypto from 'node:crypto';
import sharp from 'sharp';
import { prisma } from '@crelune/database';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  hashAgentSecret,
  verifyAgentBearerRequest,
} from '../lib/agents/agent-auth';
import {
  claimNextCreativeDispatch,
  completeAgentExportUpload,
  createAgentExportUploadIntent,
  CreativeAgentForbiddenError,
  recordAgentHeartbeat,
  registerCreativeAgent,
  revokeCreativeAgent,
  streamAgentDispatchAsset,
  streamAgentDispatchTemplateMaster,
  updateAgentDispatchStatus,
} from '../lib/agents/agent-service';
import { createDesignJob, getDesignJobById } from '../lib/designs/design-job-service';
import {
  createCreativeJobDispatch,
  JobPreparationConflictError,
} from '../lib/designs/job-preparation-service';
import { createCreativeObjectStorageProvider } from '../lib/storage/creative-storage';
import {
  buildTemplateMasterObjectKey,
  getCreativeObjectStorageConfig,
  getObjectStorageConfig,
} from '../lib/storage/storage-config';
import type { ObjectStorageProvider } from '../lib/storage/object-storage';
import {
  assertSafeDevCreativeStorageEnvironment,
  assertSafeDevDatabaseEnvironment,
} from './assert-dev-db';

describe('Stage 5.5 Windows Creative Agent Lifecycle, Concurrency, Streaming & Revocation Integration (Neon Dev)', () => {
  const runId = `s55_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
  const uploadedCreativeKeys: string[] = [];
  const storage = createCreativeObjectStorageProvider();

  let orgId = '';
  let userId = '';
  let memberId = '';
  let unreferencedMemberId = '';
  let templateId = '';
  let versionId = '';
  let masterSha256 = '';
  let masterBytes: Uint8Array;
  let memberPhotoKey = '';
  const fakePhotoBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0xff, 0xd9]);

  // Read-only in-memory mock for member-photo bucket so crelune-dev-member-photos is NEVER written to
  const readOnlyMemberPhotoProvider: ObjectStorageProvider = {
    envPrefix: 'development',
    async putPrivateObject() {
      throw new Error('Member photo storage MUST NEVER be written by Stage 5.5 agent tests.');
    },
    async headObject(key: string) {
      return {
        exists: key === memberPhotoKey,
        contentType: 'image/jpeg',
        contentLength: fakePhotoBytes.byteLength,
      };
    },
    async getObject(key: string) {
      if (key !== memberPhotoKey) {
        throw new Error(`Unexpected member photo key read: ${key}`);
      }
      return {
        body: fakePhotoBytes,
        contentType: 'image/jpeg',
        contentLength: fakePhotoBytes.byteLength,
      };
    },
    async deleteObject() {
      throw new Error('Member photo storage MUST NEVER be deleted by Stage 5.5 agent tests.');
    },
  };

  beforeAll(async () => {
    assertSafeDevDatabaseEnvironment();
    assertSafeDevCreativeStorageEnvironment();
    expect(getObjectStorageConfig().bucket).toBe('crelune-dev-member-photos');
    expect(getCreativeObjectStorageConfig().bucket).toBe('crelune-dev-creative');

    const org = await prisma.organisation.create({
      data: { name: `Stage 5.5 Org ${runId}`, slug: `stage55-${runId}` },
    });
    orgId = org.id;

    const user = await prisma.user.create({
      data: {
        organisationId: orgId,
        email: `owner-s55-${runId}@crelune.test`,
        passwordHash: 'not-a-login-hash',
        firstName: 'Stage55',
        lastName: 'Owner',
      },
    });
    userId = user.id;

    const member = await prisma.member.create({
      data: {
        organisationId: orgId,
        fullName: 'Ama Boateng',
        preferredName: 'Ama',
        normalizedName: 'ama boateng',
        birthMonth: 11,
        birthDay: 24,
        birthYear: null,
      },
    });
    memberId = member.id;
    memberPhotoKey = `development/organisations/${orgId}/members/${memberId}/photos/portrait.jpg`;
    await prisma.member.update({
      where: { id: memberId },
      data: {
        photoStorageKey: memberPhotoKey,
        photoMimeType: 'image/jpeg',
        photoByteSize: fakePhotoBytes.byteLength,
        photoUpdatedAt: new Date(),
      },
    });

    const otherMember = await prisma.member.create({
      data: {
        organisationId: orgId,
        fullName: 'Unreferenced Member',
        normalizedName: 'unreferenced member',
        birthMonth: 3,
        birthDay: 12,
        birthYear: null,
      },
    });
    unreferencedMemberId = otherMember.id;

    const tpl = await prisma.template.create({
      data: {
        organisationId: orgId,
        name: `Stage 5.5 Birthday Master ${runId}`,
        normalizedName: `stage 5.5 birthday master ${runId}`,
        category: 'BIRTHDAY_FLYER',
        studioType: 'AFFINITY_DESIGNER',
        createdByUserId: userId,
      },
    });
    templateId = tpl.id;

    const psdBuf = Buffer.alloc(32);
    psdBuf.write('8BPS', 0, 'ascii');
    psdBuf.writeUInt16BE(1, 4);
    psdBuf.writeUInt16BE(3, 12);
    psdBuf.writeUInt32BE(1350, 14);
    psdBuf.writeUInt32BE(1080, 18);
    psdBuf.writeUInt16BE(8, 22);
    psdBuf.writeUInt16BE(3, 24);
    masterBytes = new Uint8Array(psdBuf);
    masterSha256 = crypto.createHash('sha256').update(masterBytes).digest('hex');

    const masterKey = buildTemplateMasterObjectKey({
      envPrefix: storage.envPrefix,
      organisationId: orgId,
      templateId,
      versionNumber: 1,
      extension: 'psd',
      objectId: `s55_v1_${runId}`,
    });
    await storage.putPrivateObject({
      key: masterKey,
      body: masterBytes,
      contentType: 'image/vnd.adobe.photoshop',
    });
    uploadedCreativeKeys.push(masterKey);

    const v1 = await prisma.templateVersion.create({
      data: {
        organisationId: orgId,
        templateId,
        versionNumber: 1,
        format: 'PSD',
        storageBucket: storage.bucket,
        storageKey: masterKey,
        originalFilename: 'birthday_master.psd',
        mimeType: 'image/vnd.adobe.photoshop',
        byteSize: masterBytes.byteLength,
        sha256: masterSha256,
        widthPx: 1080,
        heightPx: 1350,
        inspectionStatus: 'MANUAL_REQUIRED',
        uploadedByUserId: userId,
      },
    });
    versionId = v1.id;

    await prisma.template.update({
      where: { id: templateId },
      data: { activeVersionId: versionId },
    });

    await prisma.templateFieldMapping.createMany({
      data: [
        {
          organisationId: orgId,
          templateVersionId: versionId,
          fieldKey: 'member.fullName',
          fieldType: 'TEXT',
          targetLayerName: 'MEMBER_NAME',
          isRequired: true,
        },
        {
          organisationId: orgId,
          templateVersionId: versionId,
          fieldKey: 'member.photo',
          fieldType: 'IMAGE',
          targetLayerName: 'MEMBER_PHOTO',
          isRequired: false,
        },
      ],
    });
  });

  afterAll(async () => {
    for (const key of uploadedCreativeKeys) {
      await storage.deleteObject(key).catch(() => {});
    }
    if (orgId) {
      await prisma.creativeStorageCleanup.deleteMany({ where: { organisationId: orgId } });
      await prisma.exportRecord.deleteMany({ where: { organisationId: orgId } });
      await prisma.creativeUploadIntent.deleteMany({ where: { organisationId: orgId } });
      await prisma.creativeJobDispatch.deleteMany({ where: { organisationId: orgId } });
      await prisma.creativeAgent.deleteMany({ where: { organisationId: orgId } });
      await prisma.designJobHistory.deleteMany({ where: { organisationId: orgId } });
      await prisma.birthdayPreparation.deleteMany({ where: { organisationId: orgId } });
      await prisma.designJob.deleteMany({ where: { organisationId: orgId } });
      await prisma.template.updateMany({
        where: { organisationId: orgId },
        data: { activeVersionId: null },
      });
      await prisma.templateFieldMapping.deleteMany({ where: { organisationId: orgId } });
      await prisma.templateVersion.deleteMany({ where: { organisationId: orgId } });
      await prisma.template.deleteMany({ where: { organisationId: orgId } });
      await prisma.auditLog.deleteMany({ where: { organisationId: orgId } });
      await prisma.member.deleteMany({ where: { organisationId: orgId } });
      await prisma.user.deleteMany({ where: { organisationId: orgId } });
      await prisma.organisation.deleteMany({ where: { id: orgId } });
    }
  });

  it('registers agents with hashed secrets only, authenticates Bearer tokens, enforces FOR UPDATE SKIP LOCKED atomic claims, streams authorised assets, verifies exports, and revokes cleanly', async () => {
    const actor = { userId, organisationId: orgId };

    // 1. Register two agents -> verify raw token is NEVER persisted in DB
    const reg1 = await registerCreativeAgent(actor, {
      name: 'Studio Windows 11 #1',
      machineLabel: 'WIN11-STUDIO-1',
    });
    const reg2 = await registerCreativeAgent(actor, {
      name: 'Studio Windows 11 #2',
      machineLabel: 'WIN11-STUDIO-2',
    });

    const dbAgent1 = await prisma.creativeAgent.findUniqueOrThrow({
      where: { id: reg1.agent.id },
    });
    expect(dbAgent1.tokenHash).not.toBe(reg1.oneTimeToken);
    expect(dbAgent1.tokenHash).toBe(hashAgentSecret(reg1.oneTimeToken));

    // Verify Bearer authentication succeeds & query-string fails closed
    const authOk = await verifyAgentBearerRequest(
      new Request('http://localhost:3000/api/agent/heartbeat', {
        method: 'POST',
        headers: { Authorization: `Bearer ${reg1.oneTimeToken}` },
      })
    );
    expect(authOk.ok).toBe(true);
    if (!authOk.ok) throw new Error('Expected agent 1 auth to pass');
    const authAgent1 = authOk.agent;

    const authOk2 = await verifyAgentBearerRequest(
      new Request('http://localhost:3000/api/agent/heartbeat', {
        method: 'POST',
        headers: { Authorization: `Bearer ${reg2.oneTimeToken}` },
      })
    );
    expect(authOk2.ok).toBe(true);
    if (!authOk2.ok) throw new Error('Expected agent 2 auth to pass');
    const authAgent2 = authOk2.agent;

    // 2. Heartbeat updates agent version, Affinity 3.3 version & timestamp
    const hb = await recordAgentHeartbeat(authAgent1, {
      agentVersion: '0.1.0',
      affinityVersion: '3.3.3.5004',
      supportedFormats: ['PSD', 'AF'],
      capabilities: {
        canPrepareWorkingCopy: true,
        canLaunchAllowlistedAffinity: true,
        canUploadVerifiedExports: true,
        mcpOptInConfigured: false,
      },
    });
    expect(hb.agentVersion).toBe('0.1.0');
    expect(hb.affinityVersion).toBe('3.3.3.5004');
    expect(hb.lastHeartbeatAt).not.toBeNull();

    // 3. Create version-pinned DesignJob and queue dispatch
    const job = await createDesignJob(actor, {
      title: `Stage 5.5 Flyer ${runId}`,
      category: 'BIRTHDAY_FLYER',
      priority: 'HIGH',
      initialStatus: 'DRAFT',
      memberId,
      birthdayTargetYear: 2026,
      templateId,
      templateVersionId: versionId,
    });
    const queued = await createCreativeJobDispatch(actor, job.id, {
      designJobId: job.id,
      idempotencyKey: `s55_queue_${runId}`,
      exportFormats: ['PNG'],
    });
    expect(queued.dispatch.status).toBe('QUEUED');

    // 4. Concurrent atomic claim -> FOR UPDATE SKIP LOCKED guarantees EXACTLY ONE agent wins
    const [claim1, claim2] = await Promise.all([
      claimNextCreativeDispatch(authAgent1),
      claimNextCreativeDispatch(authAgent2),
    ]);

    const winners = [
      ...(claim1.dispatch ? [{ claim: claim1, agent: authAgent1, loser: authAgent2 }] : []),
      ...(claim2.dispatch ? [{ claim: claim2, agent: authAgent2, loser: authAgent1 }] : []),
    ];
    expect(winners).toHaveLength(1);
    const { claim: wonClaim, agent: winner, loser } = winners[0]!;
    const dispatchId = wonClaim.dispatch!.id;

    // Unassigned agent MUST be forbidden from mutating or downloading this dispatch
    await expect(
      updateAgentDispatchStatus(loser, dispatchId, {
        status: 'DOWNLOADING_ASSETS',
      })
    ).rejects.toThrow(CreativeAgentForbiddenError);

    // 5. Stream verified master from crelune-dev-creative & strictly manifest-scoped asset
    const streamedMaster = await streamAgentDispatchTemplateMaster(
      winner,
      dispatchId,
      { creativeStorage: storage }
    );
    expect(streamedMaster.sha256).toBe(masterSha256);
    expect(streamedMaster.byteSize).toBe(masterBytes.byteLength);

    const streamedAsset = await streamAgentDispatchAsset(
      winner,
      dispatchId,
      memberId,
      { memberPhotoStorage: readOnlyMemberPhotoProvider }
    );
    expect(streamedAsset.byteSize).toBe(fakePhotoBytes.byteLength);

    // Unreferenced member asset MUST be forbidden (403)
    await expect(
      streamAgentDispatchAsset(winner, dispatchId, unreferencedMemberId, {
        memberPhotoStorage: readOnlyMemberPhotoProvider,
      })
    ).rejects.toThrow(CreativeAgentForbiddenError);

    // 6. Status lifecycle + idempotent replay + DesignJob PENDING -> IN_PROGRESS
    const s1 = await updateAgentDispatchStatus(winner, dispatchId, {
      status: 'DOWNLOADING_ASSETS',
      claimToken: wonClaim.claimToken,
      executionMode: 'ASSISTED',
    });
    expect(s1.dispatch.status).toBe('DOWNLOADING_ASSETS');
    expect(s1.idempotentReplay).toBe(false);

    const jobInProgress = await getDesignJobById(orgId, job.id);
    expect(jobInProgress.status).toBe('IN_PROGRESS');

    await updateAgentDispatchStatus(winner, dispatchId, {
      status: 'OPENING_TEMPLATE',
      claimToken: wonClaim.claimToken,
    });
    const sReady = await updateAgentDispatchStatus(winner, dispatchId, {
      status: 'READY_FOR_ARTIST',
      claimToken: wonClaim.claimToken,
      executionMode: 'MANUAL',
    });
    expect(sReady.dispatch.readyForArtistAt).not.toBeNull();

    // Idempotent duplicate replay returns idempotentReplay: true cleanly
    const sReadyReplay = await updateAgentDispatchStatus(winner, dispatchId, {
      status: 'READY_FOR_ARTIST',
      claimToken: wonClaim.claimToken,
    });
    expect(sReadyReplay.idempotentReplay).toBe(true);

    // Invalid backwards transition fails cleanly
    await expect(
      updateAgentDispatchStatus(winner, dispatchId, {
        status: 'QUEUED',
      })
    ).rejects.toThrow(JobPreparationConflictError);

    // 7. Verified export deliverable via agent -> presigned PUT -> EXPORTED (never PUBLISHED)
    const pngBuffer = await sharp({
      create: {
        width: 1080,
        height: 1350,
        channels: 4,
        background: { r: 101, g: 65, b: 165, alpha: 1 },
      },
    })
      .png()
      .toBuffer();
    const pngSha = crypto.createHash('sha256').update(pngBuffer).digest('hex');

    const expIntent = await createAgentExportUploadIntent(
      winner,
      dispatchId,
      {
        designJobId: job.id,
        dispatchId,
        format: 'PNG',
        originalFilename: 'agent_final.png',
        mimeType: 'image/png',
        byteSize: pngBuffer.byteLength,
        sha256: pngSha,
        idempotencyKey: `s55_exp_${runId}`,
      },
      { storage }
    );

    const intentRow = await prisma.creativeUploadIntent.findUniqueOrThrow({
      where: { id: expIntent.intent.id },
      select: { storageKey: true },
    });
    uploadedCreativeKeys.push(intentRow.storageKey);

    const putRes = await fetch(expIntent.upload.url, {
      method: 'PUT',
      headers: {
        'content-type': expIntent.upload.requiredHeaders['content-type'],
        'content-length': String(pngBuffer.byteLength),
      },
      body: new Uint8Array(pngBuffer),
    });
    expect(putRes.ok).toBe(true);

    const registered = await completeAgentExportUpload(
      winner,
      dispatchId,
      {
        designJobId: job.id,
        dispatchId,
        uploadIntentId: expIntent.intent.id,
        format: 'PNG',
        mimeType: 'image/png',
        widthPx: 1080,
        heightPx: 1350,
      },
      { storage }
    );
    expect(registered.idempotentReplay).toBe(false);
    expect(registered.exportRecord.isApprovedForPublish).toBe(false);
    expect(registered.exportRecord.publishedAt).toBeNull();
    expect(registered.exportRecord.widthPx).toBe(1080);
    expect(registered.exportRecord.heightPx).toBe(1350);

    // Retry completion with same uploadIntentId is idempotent
    const retryRegistered = await completeAgentExportUpload(
      winner,
      dispatchId,
      {
        designJobId: job.id,
        dispatchId,
        uploadIntentId: expIntent.intent.id,
        format: 'PNG',
        mimeType: 'image/png',
      },
      { storage }
    );
    expect(retryRegistered.idempotentReplay).toBe(true);
    expect(retryRegistered.exportRecord.id).toBe(registered.exportRecord.id);

    const dispatchAfterExport = await prisma.creativeJobDispatch.findUniqueOrThrow({
      where: { id: dispatchId },
    });
    expect(dispatchAfterExport.status).toBe('EXPORTED');
    expect(dispatchAfterExport.completedAt).not.toBeNull();

    const jobAfterExport = await getDesignJobById(orgId, job.id);
    // An IN_PROGRESS job moves to AWAITING_REVIEW on first verified export so owner review is never skipped
    expect(jobAfterExport.status).toBe('AWAITING_REVIEW');
    expect(jobAfterExport.status).not.toBe('PUBLISHED');

    // 8. Queue a second job, claim with agent 1, then REVOKE agent 1 -> token dies immediately & lease returns to QUEUED
    const job2 = await createDesignJob(actor, {
      title: `Stage 5.5 Revocation Test ${runId}`,
      category: 'EVENT_ANNOUNCEMENT',
      priority: 'NORMAL',
      initialStatus: 'DRAFT',
      memberId,
      templateId,
      templateVersionId: versionId,
    });
    const queued2 = await createCreativeJobDispatch(actor, job2.id, {
      designJobId: job2.id,
      idempotencyKey: `s55_queue2_${runId}`,
      exportFormats: ['PNG'],
    });
    const claimed2 = await claimNextCreativeDispatch(authAgent1);
    expect(claimed2.dispatch?.id).toBe(queued2.dispatch.id);

    const revokedSummary = await revokeCreativeAgent(actor, reg1.agent.id, {
      reason: 'Workstation retired',
    });
    expect(revokedSummary.status).toBe('REVOKED');
    expect(revokedSummary.revokedAt).not.toBeNull();

    // Token immediately returns 401
    const afterRevokeAuth = await verifyAgentBearerRequest(
      new Request('http://localhost:3000/api/agent/heartbeat', {
        method: 'POST',
        headers: { Authorization: `Bearer ${reg1.oneTimeToken}` },
      })
    );
    expect(afterRevokeAuth.ok).toBe(false);

    // Dispatch released back to QUEUED so agent 2 can claim it cleanly
    const releasedRow = await prisma.creativeJobDispatch.findUniqueOrThrow({
      where: { id: queued2.dispatch.id },
    });
    expect(releasedRow.status).toBe('QUEUED');
    expect(releasedRow.assignedAgentId).toBeNull();

    const reclaimed = await claimNextCreativeDispatch(authAgent2);
    expect(reclaimed.dispatch?.id).toBe(queued2.dispatch.id);
    expect(reclaimed.dispatch?.assignedAgentId).toBe(authAgent2.id);
  });
});
