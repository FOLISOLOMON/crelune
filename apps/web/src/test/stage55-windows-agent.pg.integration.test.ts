import crypto from 'node:crypto';
import sharp from 'sharp';
import { prisma } from '@crelune/database';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  hashAgentSecret,
  verifyAgentBearerRequest,
} from '../lib/agents/agent-auth';
import {
  AGENT_DISPATCH_LEASE_MS,
  claimNextCreativeDispatch,
  completeAgentExportUpload,
  createAgentExportUploadIntent,
  CreativeAgentClaimError,
  CreativeAgentForbiddenError,
  recordAgentHeartbeat,
  registerCreativeAgent,
  renewAgentDispatchLease,
  revokeCreativeAgent,
  streamAgentDispatchAsset,
  streamAgentDispatchTemplateMaster,
  updateAgentDispatchStatus,
} from '../lib/agents/agent-service';
import { createDesignJob, getDesignJobById } from '../lib/designs/design-job-service';
import {
  createCreativeJobDispatch,
  getDesignJobPreparationSnapshot,
  JobPreparationConflictError,
  JobPreparationValidationError,
  recoverCreativeJobDispatch,
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

describe('Stage 5.5 + 5.5.1 Windows Creative Agent Claim Fencing, Lease Recovery, Concurrency & Working Asset Boundaries (Neon Dev)', () => {
  const runId = `s551_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
  const uploadedCreativeKeys: string[] = [];
  const storage = createCreativeObjectStorageProvider();

  let orgId = '';
  let userId = '';
  let memberId = '';
  let unreferencedMemberId = '';
  let templateId = '';
  let versionId = '';
  let unsupportedImgTemplateId = '';
  let unsupportedImgVersionId = '';
  let masterSha256 = '';
  let masterBytes: Uint8Array;
  let memberPhotoKey = '';
  const fakePhotoBytes = new Uint8Array([
    0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0xff, 0xd9,
  ]);

  // Read-only mock for member-photo storage so crelune-dev-member-photos is NEVER written to
  const readOnlyMemberPhotoProvider: ObjectStorageProvider = {
    envPrefix: 'development',
    async putPrivateObject() {
      throw new Error(
        'Member photo storage MUST NEVER be written by Stage 5.5.1 agent tests.'
      );
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
      throw new Error(
        'Member photo storage MUST NEVER be deleted by Stage 5.5.1 agent tests.'
      );
    },
  };

  beforeAll(async () => {
    assertSafeDevDatabaseEnvironment();
    assertSafeDevCreativeStorageEnvironment();
    expect(getObjectStorageConfig().bucket).toBe('crelune-dev-member-photos');
    expect(getCreativeObjectStorageConfig().bucket).toBe('crelune-dev-creative');

    const org = await prisma.organisation.create({
      data: { name: `Stage 5.5.1 Org ${runId}`, slug: `stage551-${runId}` },
    });
    orgId = org.id;

    const user = await prisma.user.create({
      data: {
        organisationId: orgId,
        email: `owner-s551-${runId}@crelune.test`,
        passwordHash: 'not-a-login-hash',
        firstName: 'Stage551',
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
        name: `Stage 5.5.1 Birthday Master ${runId}`,
        normalizedName: `stage 5.5.1 birthday master ${runId}`,
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
      objectId: `s551_v1_${runId}`,
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

    // Second template with unsupported custom IMAGE mapping to prove Finding D rejection
    const tpl2 = await prisma.template.create({
      data: {
        organisationId: orgId,
        name: `Stage 5.5.1 Unsupported Image Asset ${runId}`,
        normalizedName: `stage 5.5.1 unsupported image asset ${runId}`,
        category: 'EVENT_ANNOUNCEMENT',
        studioType: 'AFFINITY_DESIGNER',
        createdByUserId: userId,
      },
    });
    unsupportedImgTemplateId = tpl2.id;

    const masterKey2 = buildTemplateMasterObjectKey({
      envPrefix: storage.envPrefix,
      organisationId: orgId,
      templateId: unsupportedImgTemplateId,
      versionNumber: 1,
      extension: 'psd',
      objectId: `s551_v2_${runId}`,
    });

    const v2 = await prisma.templateVersion.create({
      data: {
        organisationId: orgId,
        templateId: unsupportedImgTemplateId,
        versionNumber: 1,
        format: 'PSD',
        storageBucket: storage.bucket,
        storageKey: masterKey2,
        originalFilename: 'unsupported_asset.psd',
        mimeType: 'image/vnd.adobe.photoshop',
        byteSize: masterBytes.byteLength,
        sha256: masterSha256,
        widthPx: 1080,
        heightPx: 1350,
        inspectionStatus: 'MANUAL_REQUIRED',
        uploadedByUserId: userId,
      },
    });
    unsupportedImgVersionId = v2.id;

    await prisma.template.update({
      where: { id: unsupportedImgTemplateId },
      data: { activeVersionId: unsupportedImgVersionId },
    });
    await prisma.templateFieldMapping.create({
      data: {
        organisationId: orgId,
        templateVersionId: unsupportedImgVersionId,
        fieldKey: 'custom.brand_logo',
        fieldType: 'IMAGE',
        targetLayerName: 'CHURCH_LOGO',
        isRequired: true,
      },
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

  type ClaimResult = Awaited<ReturnType<typeof claimNextCreativeDispatch>>;
  function requireClaimed(
    res: ClaimResult
  ): Exclude<ClaimResult, { dispatch: null }> {
    if (!res.dispatch) {
      throw new Error('Expected dispatch to be claimed, got null.');
    }
    return res;
  }

  let reg1!: Awaited<ReturnType<typeof registerCreativeAgent>>;
  let reg2!: Awaited<ReturnType<typeof registerCreativeAgent>>;
  let agent1!: {
    id: string;
    organisationId: string;
    name: string;
    machineLabel: string;
  };
  let agent2!: {
    id: string;
    organisationId: string;
    name: string;
    machineLabel: string;
  };
  let exportedJobId = '';
  let exportedDispatchId = '';
  let tokenAfterOpenState = '';
  const t0 = new Date('2026-11-23T10:00:00.000Z');
  const afterExpiry = (base: Date) =>
    new Date(base.getTime() + AGENT_DISPATCH_LEASE_MS + 5_000);
  const t1 = afterExpiry(t0);
  const t2 = afterExpiry(t1);
  const t3 = afterExpiry(t2);

  it('registers hashed-only agent tokens, authenticates Bearer headers, and blocks unsupported WORKING_ASSET image mappings at preparation', async () => {
    const actor = { userId, organisationId: orgId };

    // 1. Register agents -> verify SHA-256 hash-only storage & Bearer auth
    reg1 = await registerCreativeAgent(actor, {
      name: 'Studio Windows 11 #1',
      machineLabel: 'WIN11-STUDIO-1',
    });
    reg2 = await registerCreativeAgent(actor, {
      name: 'Studio Windows 11 #2',
      machineLabel: 'WIN11-STUDIO-2',
    });

    const dbAgent1 = await prisma.creativeAgent.findUniqueOrThrow({
      where: { id: reg1.agent.id },
    });
    expect(dbAgent1.tokenHash).not.toBe(reg1.oneTimeToken);
    expect(dbAgent1.tokenHash).toBe(hashAgentSecret(reg1.oneTimeToken));

    const auth1 = await verifyAgentBearerRequest(
      new Request('http://localhost:3000/api/agent/heartbeat', {
        method: 'POST',
        headers: { Authorization: `Bearer ${reg1.oneTimeToken}` },
      })
    );
    const auth2 = await verifyAgentBearerRequest(
      new Request('http://localhost:3000/api/agent/heartbeat', {
        method: 'POST',
        headers: { Authorization: `Bearer ${reg2.oneTimeToken}` },
      })
    );
    if (!auth1.ok || !auth2.ok) throw new Error('Expected active agent auth');
    agent1 = auth1.agent;
    agent2 = auth2.agent;

    await recordAgentHeartbeat(
      agent1,
      {
        agentVersion: '0.1.0',
        affinityVersion: '3.3.3.5004',
        supportedFormats: ['PSD', 'AF'],
        capabilities: {
          canPrepareWorkingCopy: true,
          canLaunchAllowlistedAffinity: true,
          canUploadVerifiedExports: true,
          mcpOptInConfigured: false,
        },
      },
      { now: () => t0 }
    );

    // 2. Finding D: Template requiring custom IMAGE working asset is explicitly rejected at manifest preparation
    const unsupportedJob = await createDesignJob(actor, {
      title: `Stage 5.5.1 Unsupported Working Asset ${runId}`,
      category: 'EVENT_ANNOUNCEMENT',
      priority: 'NORMAL',
      initialStatus: 'DRAFT',
      templateId: unsupportedImgTemplateId,
      templateVersionId: unsupportedImgVersionId,
    });
    const unsupportedPrep = await getDesignJobPreparationSnapshot(
      actor,
      unsupportedJob.id
    );
    expect(unsupportedPrep.ready).toBe(false);
    expect(
      unsupportedPrep.issues.some((i) => i.code === 'UNSUPPORTED_ASSET_KIND')
    ).toBe(true);
    await expect(
      createCreativeJobDispatch(actor, unsupportedJob.id, {
        designJobId: unsupportedJob.id,
        idempotencyKey: `s551_unsup_${runId}`,
        exportFormats: ['PNG'],
      })
    ).rejects.toThrow(JobPreparationValidationError);
  });

  it('enforces mandatory claim fencing, same-agent stale-worker fencing, and concurrent recovery across CLAIMED, DOWNLOADING_ASSETS, and OPENING_TEMPLATE', async () => {
    const actor = { userId, organisationId: orgId };

    // 3. Create valid pinned job & queue dispatch
    const job1 = await createDesignJob(actor, {
      title: `Stage 5.5.1 Recovery & Fencing Flyer ${runId}`,
      category: 'BIRTHDAY_FLYER',
      priority: 'HIGH',
      initialStatus: 'DRAFT',
      memberId,
      birthdayTargetYear: 2026,
      templateId,
      templateVersionId: versionId,
    });
    const queued1 = await createCreativeJobDispatch(actor, job1.id, {
      designJobId: job1.id,
      idempotencyKey: `s551_q1_${runId}`,
      exportFormats: ['PNG'],
    });
    const d1 = queued1.dispatch.id;
    exportedJobId = job1.id;
    exportedDispatchId = d1;

    // 4. Concurrent initial claim -> strictly 1 winner
    const [initClaim1, initClaim2] = await Promise.all([
      claimNextCreativeDispatch(agent1, { now: () => t0 }),
      claimNextCreativeDispatch(agent2, { now: () => t0 }),
    ]);
    expect(Boolean(initClaim1.dispatch) !== Boolean(initClaim2.dispatch)).toBe(
      true
    );
    const initialWinner = initClaim1.dispatch
      ? { claim: requireClaimed(initClaim1), agent: agent1 }
      : { claim: requireClaimed(initClaim2), agent: agent2 };
    const staleTokenClaimed = initialWinner.claim.claimToken;

    // Verify claim fencing: empty/malformed/wrong claim rejected across ALL dispatch operations
    const wrongClaim = `clm_${'9'.repeat(48)}`;
    await expect(
      updateAgentDispatchStatus(
        initialWinner.agent,
        d1,
        '',
        { status: 'DOWNLOADING_ASSETS' },
        { now: () => t0 }
      )
    ).rejects.toThrow(CreativeAgentClaimError);
    await expect(
      streamAgentDispatchTemplateMaster(initialWinner.agent, d1, wrongClaim, {
        creativeStorage: storage,
        now: () => t0,
      })
    ).rejects.toThrow(CreativeAgentClaimError);
    await expect(
      streamAgentDispatchAsset(initialWinner.agent, d1, memberId, wrongClaim, {
        memberPhotoStorage: readOnlyMemberPhotoProvider,
        now: () => t0,
      })
    ).rejects.toThrow(CreativeAgentClaimError);
    await expect(
      renewAgentDispatchLease(initialWinner.agent, d1, wrongClaim, {
        now: () => t0,
      })
    ).rejects.toThrow(CreativeAgentClaimError);
    await expect(
      createAgentExportUploadIntent(
        initialWinner.agent,
        d1,
        wrongClaim,
        {
          designJobId: job1.id,
          dispatchId: d1,
          format: 'PNG',
          originalFilename: 'x.png',
          mimeType: 'image/png',
          byteSize: 100,
          sha256: 'a'.repeat(64),
          idempotencyKey: `s551_bad_${runId}`,
        },
        { storage, now: () => t0 }
      )
    ).rejects.toThrow(CreativeAgentClaimError);

    // 5. Recovery #1 (Expired CLAIMED) + SAME-AGENT CONCURRENT STALE-WORKER FENCING!
    // Expired claim cannot act even BEFORE another worker recovers it
    await expect(
      updateAgentDispatchStatus(
        initialWinner.agent,
        d1,
        staleTokenClaimed,
        { status: 'DOWNLOADING_ASSETS' },
        { now: () => t1 }
      )
    ).rejects.toMatchObject({ code: 'DISPATCH_LEASE_EXPIRED' });

    // Same agent (second worker process) recovers expired CLAIMED -> rotates claimToken!
    const recoveredFromClaimed = requireClaimed(
      await claimNextCreativeDispatch(initialWinner.agent, { now: () => t1 })
    );
    expect(recoveredFromClaimed.dispatch.id).toBe(d1);
    expect(recoveredFromClaimed.recoveredFromStatus).toBe('CLAIMED');
    const tokenAfterClaimed = recoveredFromClaimed.claimToken;
    expect(tokenAfterClaimed).not.toBe(staleTokenClaimed);

    // Same-agent stale worker #1 using old claim token MUST be rejected everywhere!
    await expect(
      updateAgentDispatchStatus(
        initialWinner.agent,
        d1,
        staleTokenClaimed,
        { status: 'DOWNLOADING_ASSETS' },
        { now: () => t1 }
      )
    ).rejects.toMatchObject({ code: 'DISPATCH_CLAIM_MISMATCH' });
    await expect(
      streamAgentDispatchTemplateMaster(
        initialWinner.agent,
        d1,
        staleTokenClaimed,
        { creativeStorage: storage, now: () => t1 }
      )
    ).rejects.toMatchObject({ code: 'DISPATCH_CLAIM_MISMATCH' });

    // Correct current claim token succeeds across status, template & asset streaming
    await updateAgentDispatchStatus(
      initialWinner.agent,
      d1,
      tokenAfterClaimed,
      { status: 'DOWNLOADING_ASSETS' },
      { now: () => t1 }
    );
    const streamedMaster = await streamAgentDispatchTemplateMaster(
      initialWinner.agent,
      d1,
      tokenAfterClaimed,
      { creativeStorage: storage, now: () => t1 }
    );
    expect(streamedMaster.sha256).toBe(masterSha256);
    const streamedPhoto = await streamAgentDispatchAsset(
      initialWinner.agent,
      d1,
      memberId,
      tokenAfterClaimed,
      { memberPhotoStorage: readOnlyMemberPhotoProvider, now: () => t1 }
    );
    expect(streamedPhoto.byteSize).toBe(fakePhotoBytes.byteLength);
    // Unauthorised member photo remains inaccessible (403)
    await expect(
      streamAgentDispatchAsset(
        initialWinner.agent,
        d1,
        unreferencedMemberId,
        tokenAfterClaimed,
        { memberPhotoStorage: readOnlyMemberPhotoProvider, now: () => t1 }
      )
    ).rejects.toThrow(CreativeAgentForbiddenError);

    // 6. Recovery #2 (Expired DOWNLOADING_ASSETS) with CONCURRENT competing agents -> strictly 1 winner!
    const [recDl1, recDl2] = await Promise.all([
      claimNextCreativeDispatch(agent1, { now: () => t2 }),
      claimNextCreativeDispatch(agent2, { now: () => t2 }),
    ]);
    const dlWinners = [
      ...(recDl1.dispatch ? [{ claim: recDl1, agent: agent1 }] : []),
      ...(recDl2.dispatch ? [{ claim: recDl2, agent: agent2 }] : []),
    ];
    expect(dlWinners).toHaveLength(1);
    const dlWinner = dlWinners[0]!;
    expect(dlWinner.claim.recoveredFromStatus).toBe('DOWNLOADING_ASSETS');
    const tokenAfterDl = dlWinner.claim.claimToken!;

    // Advance to OPENING_TEMPLATE, then let lease expire -> Recovery #3 (Expired OPENING_TEMPLATE)
    await updateAgentDispatchStatus(
      dlWinner.agent,
      d1,
      tokenAfterDl,
      { status: 'DOWNLOADING_ASSETS' },
      { now: () => t2 }
    );
    await updateAgentDispatchStatus(
      dlWinner.agent,
      d1,
      tokenAfterDl,
      { status: 'OPENING_TEMPLATE' },
      { now: () => t2 }
    );

    const recOpen = requireClaimed(
      await claimNextCreativeDispatch(agent2, { now: () => t3 })
    );
    expect(recOpen.dispatch.id).toBe(d1);
    expect(recOpen.recoveredFromStatus).toBe('OPENING_TEMPLATE');
    tokenAfterOpenState = recOpen.claimToken;
  });

  it('preserves READY_FOR_ARTIST on lease expiry with owner intervention recovery, supports explicit lease renewal, recovers expired EXPORTING, and enforces export idempotency', async () => {
    const actor = { userId, organisationId: orgId };
    const d1 = exportedDispatchId;
    const job1Id = exportedJobId;
    const tokenAfterOpen = tokenAfterOpenState;

    // 7. Advance to READY_FOR_ARTIST -> verify lease renewal works -> then let lease expire!
    await updateAgentDispatchStatus(
      agent2,
      d1,
      tokenAfterOpen,
      { status: 'DOWNLOADING_ASSETS' },
      { now: () => t3 }
    );
    await updateAgentDispatchStatus(
      agent2,
      d1,
      tokenAfterOpen,
      { status: 'OPENING_TEMPLATE' },
      { now: () => t3 }
    );
    await updateAgentDispatchStatus(
      agent2,
      d1,
      tokenAfterOpen,
      { status: 'READY_FOR_ARTIST', executionMode: 'ASSISTED' },
      { now: () => t3 }
    );

    // Explicit lease renewal while unexpired extends lease cleanly
    const t3Mid = new Date(t3.getTime() + 5 * 60 * 1000);
    const renewed = await renewAgentDispatchLease(agent2, d1, tokenAfterOpen, {
      now: () => t3Mid,
    });
    expect(new Date(renewed.leaseExpiresAt).getTime()).toBe(
      t3Mid.getTime() + AGENT_DISPATCH_LEASE_MS
    );

    // Let READY_FOR_ARTIST lease expire -> MUST NOT be auto-recovered!
    const t4 = afterExpiry(t3Mid);
    const noAutoRecover = await claimNextCreativeDispatch(agent1, {
      now: () => t4,
    });
    expect(noAutoRecover.dispatch).toBeNull();

    // Surfaced clearly to owner as requiresOwnerIntervention: true
    const prepSnapshot = await getDesignJobPreparationSnapshot(actor, job1Id, {
      now: () => t4,
    });
    const d1Snap = prepSnapshot.dispatches.find((d) => d.id === d1);
    expect(d1Snap?.status).toBe('READY_FOR_ARTIST');
    expect(d1Snap?.requiresOwnerIntervention).toBe(true);
    expect(d1Snap?.interventionReason).toMatch(/lease expired/i);

    // Owner explicitly releases READY_FOR_ARTIST for recovery (preserving local work)
    const ownerReleased = await recoverCreativeJobDispatch(
      actor,
      job1Id,
      d1,
      {
        reason: 'Artist confirmed local edits saved; releasing for recovery.',
        confirmPreserveLocalWork: true,
      },
      { now: () => t4 }
    );
    expect(ownerReleased.status).toBe('QUEUED');
    expect(ownerReleased.assignedAgentId).toBeNull();

    // 8. Re-claim after owner release -> advance to EXPORTING -> expire -> Recovery #4 (Expired EXPORTING)
    const recAfterOwner = requireClaimed(
      await claimNextCreativeDispatch(agent1, { now: () => t4 })
    );
    expect(recAfterOwner.dispatch.id).toBe(d1);
    const tokExport = recAfterOwner.claimToken;
    await updateAgentDispatchStatus(
      agent1,
      d1,
      tokExport,
      { status: 'DOWNLOADING_ASSETS' },
      { now: () => t4 }
    );
    await updateAgentDispatchStatus(
      agent1,
      d1,
      tokExport,
      { status: 'OPENING_TEMPLATE' },
      { now: () => t4 }
    );
    await updateAgentDispatchStatus(
      agent1,
      d1,
      tokExport,
      { status: 'EXPORTING' },
      { now: () => t4 }
    );

    const t5 = afterExpiry(t4);
    const recFromExporting = requireClaimed(
      await claimNextCreativeDispatch(agent2, { now: () => t5 })
    );
    expect(recFromExporting.dispatch.id).toBe(d1);
    expect(recFromExporting.recoveredFromStatus).toBe('EXPORTING');
    const finalClaimToken = recFromExporting.claimToken;

    // 9. Upload verified PNG deliverable using valid claim token + prove idempotent retry & stale-token fencing
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
      agent2,
      d1,
      finalClaimToken,
      {
        designJobId: job1Id,
        dispatchId: d1,
        format: 'PNG',
        originalFilename: 'recovered_final.png',
        mimeType: 'image/png',
        byteSize: pngBuffer.byteLength,
        sha256: pngSha,
        idempotencyKey: `s551_exp_${runId}`,
      },
      { storage, now: () => t5 }
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

    // Stale claim token CANNOT complete export!
    await expect(
      completeAgentExportUpload(
        agent2,
        d1,
        tokExport,
        {
          designJobId: job1Id,
          dispatchId: d1,
          uploadIntentId: expIntent.intent.id,
          format: 'PNG',
          mimeType: 'image/png',
        },
        { storage, now: () => t5 }
      )
    ).rejects.toMatchObject({ code: 'DISPATCH_CLAIM_MISMATCH' });

    const registered = await completeAgentExportUpload(
      agent2,
      d1,
      finalClaimToken,
      {
        designJobId: job1Id,
        dispatchId: d1,
        uploadIntentId: expIntent.intent.id,
        format: 'PNG',
        mimeType: 'image/png',
      },
      { storage, now: () => t5 }
    );
    expect(registered.idempotentReplay).toBe(false);
    expect(registered.exportRecord.isApprovedForPublish).toBe(false);
    expect(registered.exportRecord.publishedAt).toBeNull();

    // Idempotent retry with EXACT same claimToken & uploadIntentId succeeds cleanly
    const replay = await completeAgentExportUpload(
      agent2,
      d1,
      finalClaimToken,
      {
        designJobId: job1Id,
        dispatchId: d1,
        uploadIntentId: expIntent.intent.id,
        format: 'PNG',
        mimeType: 'image/png',
      },
      { storage, now: () => t5 }
    );
    expect(replay.idempotentReplay).toBe(true);
    expect(replay.exportRecord.id).toBe(registered.exportRecord.id);

    // Terminal EXPORTED dispatch is NEVER re-claimed even far in the future
    const afterExportedClaim = await claimNextCreativeDispatch(agent1, {
      now: () => afterExpiry(t5),
    });
    expect(afterExportedClaim.dispatch).toBeNull();
    const job1After = await getDesignJobById(orgId, job1Id);
    expect(job1After.status).toBe('AWAITING_REVIEW');
    expect(job1After.status).not.toBe('PUBLISHED');
  });

  it('enforces safe revocation across OPENING_TEMPLATE and READY_FOR_ARTIST, prevents terminal recovery, and keeps audit logs secret-free', async () => {
    const actor = { userId, organisationId: orgId };
    const t5 = new Date('2026-11-23T12:00:00.000Z');

    // 10. Revocation policy across states:
    //     - Job 2 in OPENING_TEMPLATE -> auto-requeues to QUEUED
    //     - Job 3 in READY_FOR_ARTIST -> preserved in READY_FOR_ARTIST & flagged for owner intervention
    const job2 = await createDesignJob(actor, {
      title: `Stage 5.5.1 Revoke Opening ${runId}`,
      category: 'EVENT_ANNOUNCEMENT',
      priority: 'NORMAL',
      initialStatus: 'DRAFT',
      memberId,
      templateId,
      templateVersionId: versionId,
    });
    const q2 = await createCreativeJobDispatch(actor, job2.id, {
      designJobId: job2.id,
      idempotencyKey: `s551_q2_${runId}`,
      exportFormats: ['PNG'],
    });
    const c2 = requireClaimed(
      await claimNextCreativeDispatch(agent1, { now: () => t5 })
    );
    expect(c2.dispatch.id).toBe(q2.dispatch.id);
    await updateAgentDispatchStatus(
      agent1,
      q2.dispatch.id,
      c2.claimToken,
      { status: 'DOWNLOADING_ASSETS' },
      { now: () => t5 }
    );
    await updateAgentDispatchStatus(
      agent1,
      q2.dispatch.id,
      c2.claimToken,
      { status: 'OPENING_TEMPLATE' },
      { now: () => t5 }
    );

    const job3 = await createDesignJob(actor, {
      title: `Stage 5.5.1 Revoke Artist Ready ${runId}`,
      category: 'SERVICE_FLYER',
      priority: 'NORMAL',
      initialStatus: 'DRAFT',
      memberId,
      templateId,
      templateVersionId: versionId,
    });
    const q3 = await createCreativeJobDispatch(actor, job3.id, {
      designJobId: job3.id,
      idempotencyKey: `s551_q3_${runId}`,
      exportFormats: ['PNG'],
    });
    const c3 = requireClaimed(
      await claimNextCreativeDispatch(agent1, { now: () => t5 })
    );
    expect(c3.dispatch.id).toBe(q3.dispatch.id);
    await updateAgentDispatchStatus(
      agent1,
      q3.dispatch.id,
      c3.claimToken,
      { status: 'DOWNLOADING_ASSETS' },
      { now: () => t5 }
    );
    await updateAgentDispatchStatus(
      agent1,
      q3.dispatch.id,
      c3.claimToken,
      { status: 'OPENING_TEMPLATE' },
      { now: () => t5 }
    );
    await updateAgentDispatchStatus(
      agent1,
      q3.dispatch.id,
      c3.claimToken,
      { status: 'READY_FOR_ARTIST', executionMode: 'MANUAL' },
      { now: () => t5 }
    );

    // Revoke agent 1!
    const revoked1 = await revokeCreativeAgent(
      actor,
      reg1.agent.id,
      { reason: 'Compromised workstation test' },
      { now: () => t5 }
    );
    expect(revoked1.status).toBe('REVOKED');

    // Revoked agent Bearer immediately fails with 401
    const afterRevokeAuth = await verifyAgentBearerRequest(
      new Request('http://localhost:3000/api/agent/heartbeat', {
        method: 'POST',
        headers: { Authorization: `Bearer ${reg1.oneTimeToken}` },
      })
    );
    expect(afterRevokeAuth.ok).toBe(false);

    // Job 2 (OPENING_TEMPLATE) was safely requeued to QUEUED & can be claimed by agent 2
    const d2Row = await prisma.creativeJobDispatch.findUniqueOrThrow({
      where: { id: q2.dispatch.id },
    });
    expect(d2Row.status).toBe('QUEUED');
    expect(d2Row.assignedAgentId).toBeNull();
    expect(d2Row.claimTokenHash).toBeNull();

    // Job 3 (READY_FOR_ARTIST) was PRESERVED in READY_FOR_ARTIST, claim/lease cleared, intervention flagged!
    const d3Row = await prisma.creativeJobDispatch.findUniqueOrThrow({
      where: { id: q3.dispatch.id },
    });
    expect(d3Row.status).toBe('READY_FOR_ARTIST');
    expect(d3Row.claimTokenHash).toBeNull();
    expect(d3Row.leaseExpiresAt).toBeNull();
    expect(d3Row.errorCode).toBe('AGENT_REVOKED_INTERVENTION_REQUIRED');

    const job3Prep = await getDesignJobPreparationSnapshot(actor, job3.id, {
      now: () => t5,
    });
    expect(job3Prep.dispatches[0]?.requiresOwnerIntervention).toBe(true);

    // Agent 2 claims ONLY Job 2 (NOT Job 3!)
    const nextClaimA2 = await claimNextCreativeDispatch(agent2, {
      now: () => t5,
    });
    expect(nextClaimA2.dispatch?.id).toBe(q2.dispatch.id);
    const secondClaimA2 = await claimNextCreativeDispatch(agent2, {
      now: () => t5,
    });
    expect(secondClaimA2.dispatch).toBeNull();

    // Terminal recovery rejection check (cannot recover EXPORTED dispatch)
    await expect(
      recoverCreativeJobDispatch(actor, exportedJobId, exportedDispatchId, {
        reason: 'Attempt on exported dispatch',
        confirmPreserveLocalWork: true,
      })
    ).rejects.toThrow(JobPreparationConflictError);

    // Verify audit logs recorded recoveries, lease renewal, and intervention without leaking any claim token
    const auditRows = await prisma.auditLog.findMany({
      where: { organisationId: orgId },
      select: { action: true, metadata: true },
    });
    const actions = new Set(auditRows.map((r) => r.action));
    expect(actions.has('CREATIVE_DISPATCH_RECOVERED')).toBe(true);
    expect(actions.has('CREATIVE_DISPATCH_LEASE_RENEWED')).toBe(true);
    expect(actions.has('CREATIVE_DISPATCH_INTERVENTION_REQUIRED')).toBe(true);
    const serializedAudit = JSON.stringify(auditRows);
    expect(serializedAudit).not.toContain('clm_');
    expect(serializedAudit).not.toContain('cln_agent_');
  });
});
