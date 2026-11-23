import crypto from 'node:crypto';
import sharp from 'sharp';
import { prisma } from '@crelune/database';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { verifyAgentBearerRequest } from '../lib/agents/agent-auth';
import {
  AGENT_DISPATCH_LEASE_MS,
  claimNextCreativeDispatch,
  completeAgentExportUpload,
  createAgentExportUploadIntent,
  CreativeAgentRevokedError,
  registerCreativeAgent,
  renewAgentDispatchLease,
  revokeCreativeAgent,
  updateAgentDispatchStatus,
} from '../lib/agents/agent-service';
import { createDesignJob } from '../lib/designs/design-job-service';
import {
  createCreativeJobDispatch,
  JobPreparationConflictError,
  recoverCreativeJobDispatch,
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

describe('Stage 5.5.2 Export Finalization Fencing & Owner Recovery Concurrency Hardening (Neon Dev)', () => {
  const runId = `s552_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
  const uploadedCreativeKeys: string[] = [];
  const storage = createCreativeObjectStorageProvider();

  let orgId = '';
  let userId = '';
  let memberId = '';
  let templateId = '';
  let versionId = '';
  let pngBuffer: Buffer;
  let pngSha256 = '';

  type ClaimResult = Awaited<ReturnType<typeof claimNextCreativeDispatch>>;
  function requireClaimed(
    res: ClaimResult
  ): Exclude<ClaimResult, { dispatch: null }> {
    if (!res.dispatch) {
      throw new Error('Expected dispatch claim to succeed.');
    }
    return res;
  }

  async function uploadExportForAgent(params: {
    agent: {
      id: string;
      organisationId: string;
      name: string;
      machineLabel: string;
    };
    jobId: string;
    dispatchId: string;
    claimToken: string;
    keySuffix: string;
    now: Date;
  }) {
    const intentRes = await createAgentExportUploadIntent(
      params.agent,
      params.dispatchId,
      params.claimToken,
      {
        designJobId: params.jobId,
        dispatchId: params.dispatchId,
        format: 'PNG',
        originalFilename: `export_${params.keySuffix}.png`,
        mimeType: 'image/png',
        byteSize: pngBuffer.byteLength,
        sha256: pngSha256,
        idempotencyKey: `s552_int_${runId}_${params.keySuffix}`,
      },
      { storage, now: () => params.now }
    );
    const intentRow = await prisma.creativeUploadIntent.findUniqueOrThrow({
      where: { id: intentRes.intent.id },
      select: { storageKey: true },
    });
    uploadedCreativeKeys.push(intentRow.storageKey);

    const putRes = await fetch(intentRes.upload.url, {
      method: 'PUT',
      headers: {
        'content-type': intentRes.upload.requiredHeaders['content-type'],
        'content-length': String(pngBuffer.byteLength),
      },
      body: new Uint8Array(pngBuffer),
    });
    expect(putRes.ok).toBe(true);
    return intentRes.intent.id;
  }

  beforeAll(async () => {
    assertSafeDevDatabaseEnvironment();
    assertSafeDevCreativeStorageEnvironment();
    expect(getObjectStorageConfig().bucket).toBe('crelune-dev-member-photos');
    expect(getCreativeObjectStorageConfig().bucket).toBe('crelune-dev-creative');

    const org = await prisma.organisation.create({
      data: { name: `Stage 5.5.2 Org ${runId}`, slug: `stage552-${runId}` },
    });
    orgId = org.id;

    const user = await prisma.user.create({
      data: {
        organisationId: orgId,
        email: `owner-s552-${runId}@crelune.test`,
        passwordHash: 'not-a-login-hash',
        firstName: 'Stage552',
        lastName: 'Owner',
      },
    });
    userId = user.id;

    const member = await prisma.member.create({
      data: {
        organisationId: orgId,
        fullName: 'Kwame Nkrumah',
        preferredName: 'Kwame',
        normalizedName: 'kwame nkrumah',
        birthMonth: 9,
        birthDay: 21,
        birthYear: null,
      },
    });
    memberId = member.id;

    const tpl = await prisma.template.create({
      data: {
        organisationId: orgId,
        name: `Stage 5.5.2 Master ${runId}`,
        normalizedName: `stage 5.5.2 master ${runId}`,
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
    const masterBytes = new Uint8Array(psdBuf);
    const masterSha = crypto.createHash('sha256').update(masterBytes).digest('hex');

    const masterKey = buildTemplateMasterObjectKey({
      envPrefix: storage.envPrefix,
      organisationId: orgId,
      templateId,
      versionNumber: 1,
      extension: 'psd',
      objectId: `s552_v1_${runId}`,
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
        originalFilename: 's552_master.psd',
        mimeType: 'image/vnd.adobe.photoshop',
        byteSize: masterBytes.byteLength,
        sha256: masterSha,
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

    pngBuffer = await sharp({
      create: {
        width: 1080,
        height: 1350,
        channels: 4,
        background: { r: 101, g: 65, b: 165, alpha: 1 },
      },
    })
      .png()
      .toBuffer();
    pngSha256 = crypto.createHash('sha256').update(pngBuffer).digest('hex');
  });

  afterAll(async () => {
    for (const key of uploadedCreativeKeys) {
      await storage.deleteObject(key).catch(() => {});
    }
    if (orgId) {
      await prisma.creativeStorageCleanup.deleteMany({
        where: { organisationId: orgId },
      });
      await prisma.exportRecord.deleteMany({ where: { organisationId: orgId } });
      await prisma.creativeUploadIntent.deleteMany({
        where: { organisationId: orgId },
      });
      await prisma.creativeJobDispatch.deleteMany({
        where: { organisationId: orgId },
      });
      await prisma.creativeAgent.deleteMany({ where: { organisationId: orgId } });
      await prisma.designJobHistory.deleteMany({ where: { organisationId: orgId } });
      await prisma.birthdayPreparation.deleteMany({
        where: { organisationId: orgId },
      });
      await prisma.designJob.deleteMany({ where: { organisationId: orgId } });
      await prisma.template.updateMany({
        where: { organisationId: orgId },
        data: { activeVersionId: null },
      });
      await prisma.templateFieldMapping.deleteMany({
        where: { organisationId: orgId },
      });
      await prisma.templateVersion.deleteMany({ where: { organisationId: orgId } });
      await prisma.template.deleteMany({ where: { organisationId: orgId } });
      await prisma.auditLog.deleteMany({ where: { organisationId: orgId } });
      await prisma.member.deleteMany({ where: { organisationId: orgId } });
      await prisma.user.deleteMany({ where: { organisationId: orgId } });
      await prisma.organisation.deleteMany({ where: { id: orgId } });
    }
  });

  async function registerActiveAgent(label: string) {
    const reg = await registerCreativeAgent(
      { userId, organisationId: orgId },
      { name: `Agent ${label}`, machineLabel: `WIN11-${label}` }
    );
    const auth = await verifyAgentBearerRequest(
      new Request('http://localhost:3000/api/agent/heartbeat', {
        method: 'POST',
        headers: { Authorization: `Bearer ${reg.oneTimeToken}` },
      })
    );
    if (!auth.ok) throw new Error(`Failed auth for ${label}`);
    return { reg, agent: auth.agent };
  }

  it('blocks export finalization when claim expires, rotates to another agent, or agent is revoked between preflight and final DB transaction', async () => {
    const actor = { userId, organisationId: orgId };
    const { agent: agentA } = await registerActiveAgent('RACE-A');
    const { agent: agentB } = await registerActiveAgent('RACE-B');
    const { reg: regRevoke, agent: agentRevoke } =
      await registerActiveAgent('RACE-REV');

    const t0 = new Date('2026-11-23T14:00:00.000Z');
    const tExpired = new Date(t0.getTime() + AGENT_DISPATCH_LEASE_MS + 5_000);

    // --- Race 1: Claim expires AFTER S3/binary verification, BEFORE final DB transaction ---
    const jobExpire = await createDesignJob(actor, {
      title: `S552 Lease Expiry Finalization ${runId}`,
      category: 'EVENT_ANNOUNCEMENT',
      priority: 'NORMAL',
      initialStatus: 'DRAFT',
      templateId,
      templateVersionId: versionId,
    });
    const qExp = await createCreativeJobDispatch(actor, jobExpire.id, {
      designJobId: jobExpire.id,
      idempotencyKey: `s552_q_exp_${runId}`,
      exportFormats: ['PNG'],
    });
    const cExp = requireClaimed(
      await claimNextCreativeDispatch(agentA, { now: () => t0 })
    );
    const expIntentId = await uploadExportForAgent({
      agent: agentA,
      jobId: jobExpire.id,
      dispatchId: qExp.dispatch.id,
      claimToken: cExp.claimToken,
      keySuffix: 'lease_exp',
      now: t0,
    });

    // Advance simulated clock right at beforeFinalTransaction!
    let currentClock = t0;
    await expect(
      completeAgentExportUpload(
        agentA,
        qExp.dispatch.id,
        cExp.claimToken,
        {
          designJobId: jobExpire.id,
          dispatchId: qExp.dispatch.id,
          uploadIntentId: expIntentId,
          format: 'PNG',
          mimeType: 'image/png',
        },
        {
          storage,
          now: () => currentClock,
          beforeFinalTransaction: async () => {
            currentClock = tExpired;
          },
        }
      )
    ).rejects.toMatchObject({ code: 'DISPATCH_LEASE_EXPIRED' });

    // Confirm ZERO ExportRecord created and dispatch NOT marked EXPORTED!
    expect(
      await prisma.exportRecord.count({ where: { designJobId: jobExpire.id } })
    ).toBe(0);
    const dExpAfter = await prisma.creativeJobDispatch.findUniqueOrThrow({
      where: { id: qExp.dispatch.id },
    });
    expect(dExpAfter.status).toBe('CLAIMED');

    // --- Race 2: Coordinated two-transaction claim rotation by Agent B BEFORE Agent A's final tx ---
    let claimClock = t0;
    let agentBClaimToken = '';
    await expect(
      completeAgentExportUpload(
        agentA,
        qExp.dispatch.id,
        cExp.claimToken,
        {
          designJobId: jobExpire.id,
          dispatchId: qExp.dispatch.id,
          uploadIntentId: expIntentId,
          format: 'PNG',
          mimeType: 'image/png',
        },
        {
          storage,
          now: () => claimClock,
          beforeFinalTransaction: async () => {
            // While Agent A is paused right before its final tx, Agent B atomically recovers the expired dispatch in Postgres!
            claimClock = tExpired;
            const rotated = requireClaimed(
              await claimNextCreativeDispatch(agentB, { now: () => tExpired })
            );
            expect(rotated.dispatch.id).toBe(qExp.dispatch.id);
            agentBClaimToken = rotated.claimToken;
          },
        }
      )
    ).rejects.toMatchObject({ code: 'DISPATCH_NOT_ASSIGNED' });

    // Agent A created ZERO exports and did NOT overwrite Agent B's ownership
    expect(
      await prisma.exportRecord.count({ where: { designJobId: jobExpire.id } })
    ).toBe(0);
    const dRotated = await prisma.creativeJobDispatch.findUniqueOrThrow({
      where: { id: qExp.dispatch.id },
    });
    expect(dRotated.assignedAgentId).toBe(agentB.id);
    expect(dRotated.status).toBe('CLAIMED');

    // Now winning Agent B uploads & finalizes its own export cleanly, and exact replay succeeds!
    const agentBIntentId = await uploadExportForAgent({
      agent: agentB,
      jobId: jobExpire.id,
      dispatchId: qExp.dispatch.id,
      claimToken: agentBClaimToken,
      keySuffix: 'agent_b_win',
      now: tExpired,
    });
    const bFinal = await completeAgentExportUpload(
      agentB,
      qExp.dispatch.id,
      agentBClaimToken,
      {
        designJobId: jobExpire.id,
        dispatchId: qExp.dispatch.id,
        uploadIntentId: agentBIntentId,
        format: 'PNG',
        mimeType: 'image/png',
      },
      { storage, now: () => tExpired }
    );
    expect(bFinal.idempotentReplay).toBe(false);
    expect(bFinal.exportRecord.isApprovedForPublish).toBe(false);

    // Exact winning-claim idempotent replay still works
    const bReplay = await completeAgentExportUpload(
      agentB,
      qExp.dispatch.id,
      agentBClaimToken,
      {
        designJobId: jobExpire.id,
        dispatchId: qExp.dispatch.id,
        uploadIntentId: agentBIntentId,
        format: 'PNG',
        mimeType: 'image/png',
      },
      { storage, now: () => tExpired }
    );
    expect(bReplay.idempotentReplay).toBe(true);
    expect(bReplay.exportRecord.id).toBe(bFinal.exportRecord.id);
    expect(
      await prisma.exportRecord.count({ where: { designJobId: jobExpire.id } })
    ).toBe(1);

    // --- Race 3: Agent revoked AFTER preflight & S3 validation, BEFORE final DB transaction ---
    const jobRev = await createDesignJob(actor, {
      title: `S552 Revoke Mid-Finalization ${runId}`,
      category: 'SERVICE_FLYER',
      priority: 'NORMAL',
      initialStatus: 'DRAFT',
      templateId,
      templateVersionId: versionId,
    });
    const qRev = await createCreativeJobDispatch(actor, jobRev.id, {
      designJobId: jobRev.id,
      idempotencyKey: `s552_q_rev_${runId}`,
      exportFormats: ['PNG'],
    });
    const cRev = requireClaimed(
      await claimNextCreativeDispatch(agentRevoke, { now: () => t0 })
    );
    const revIntentId = await uploadExportForAgent({
      agent: agentRevoke,
      jobId: jobRev.id,
      dispatchId: qRev.dispatch.id,
      claimToken: cRev.claimToken,
      keySuffix: 'mid_revoke',
      now: t0,
    });

    await expect(
      completeAgentExportUpload(
        agentRevoke,
        qRev.dispatch.id,
        cRev.claimToken,
        {
          designJobId: jobRev.id,
          dispatchId: qRev.dispatch.id,
          uploadIntentId: revIntentId,
          format: 'PNG',
          mimeType: 'image/png',
        },
        {
          storage,
          now: () => t0,
          beforeFinalTransaction: async () => {
            await revokeCreativeAgent(
              actor,
              regRevoke.agent.id,
              { reason: 'Revoked mid-finalization race test' },
              { now: () => t0 }
            );
          },
        }
      )
    ).rejects.toThrow(CreativeAgentRevokedError);

    // Zero ExportRecord created & dispatch safely requeued by revocation!
    expect(
      await prisma.exportRecord.count({ where: { designJobId: jobRev.id } })
    ).toBe(0);
    const dRevAfter = await prisma.creativeJobDispatch.findUniqueOrThrow({
      where: { id: qRev.dispatch.id },
    });
    expect(dRevAfter.status).toBe('QUEUED');
    expect(dRevAfter.assignedAgentId).toBeNull();
  });

  it('creates strictly ONE ExportRecord under duplicate concurrent export finalization', async () => {
    const actor = { userId, organisationId: orgId };
    const { agent } = await registerActiveAgent('DUP-EXP');
    const t0 = new Date('2026-11-23T15:00:00.000Z');

    const jobDup = await createDesignJob(actor, {
      title: `S552 Concurrent Duplicate Export ${runId}`,
      category: 'SOCIAL_MEDIA_GRAPHIC',
      priority: 'HIGH',
      initialStatus: 'DRAFT',
      templateId,
      templateVersionId: versionId,
    });
    const qDup = await createCreativeJobDispatch(actor, jobDup.id, {
      designJobId: jobDup.id,
      idempotencyKey: `s552_q_dup_${runId}`,
      exportFormats: ['PNG'],
    });
    // Claim specifically this queued job (queue may have jobRev from test 1 -> cancel jobRev first or assign agent!)
    await prisma.creativeJobDispatch.update({
      where: { id: qDup.dispatch.id },
      data: { assignedAgentId: agent.id },
    });
    // Ensure agent only picks up its own dispatch by cancelling any leftover QUEUED dispatches from prior test
    await prisma.creativeJobDispatch.updateMany({
      where: {
        organisationId: orgId,
        status: 'QUEUED',
        id: { not: qDup.dispatch.id },
      },
      data: { status: 'CANCELLED' },
    });

    const claimed = requireClaimed(
      await claimNextCreativeDispatch(agent, { now: () => t0 })
    );
    expect(claimed.dispatch.id).toBe(qDup.dispatch.id);

    const intentId = await uploadExportForAgent({
      agent,
      jobId: jobDup.id,
      dispatchId: qDup.dispatch.id,
      claimToken: claimed.claimToken,
      keySuffix: 'dup_conc',
      now: t0,
    });

    // Coordinate both concurrent finalizations to enter the final DB tx at the exact same instant!
    let arrived = 0;
    let releaseBarrier!: () => void;
    const barrier = new Promise<void>((resolve) => {
      releaseBarrier = resolve;
    });
    const waitAtBarrier = async () => {
      arrived += 1;
      if (arrived === 2) {
        releaseBarrier();
      }
      await barrier;
    };

    const [fin1, fin2] = await Promise.all([
      completeAgentExportUpload(
        agent,
        qDup.dispatch.id,
        claimed.claimToken,
        {
          designJobId: jobDup.id,
          dispatchId: qDup.dispatch.id,
          uploadIntentId: intentId,
          format: 'PNG',
          mimeType: 'image/png',
        },
        { storage, now: () => t0, beforeFinalTransaction: waitAtBarrier }
      ),
      completeAgentExportUpload(
        agent,
        qDup.dispatch.id,
        claimed.claimToken,
        {
          designJobId: jobDup.id,
          dispatchId: qDup.dispatch.id,
          uploadIntentId: intentId,
          format: 'PNG',
          mimeType: 'image/png',
        },
        { storage, now: () => t0, beforeFinalTransaction: waitAtBarrier }
      ),
    ]);

    expect(fin1.exportRecord.id).toBe(fin2.exportRecord.id);
    expect(
      [fin1.idempotentReplay, fin2.idempotentReplay].sort()
    ).toEqual([false, true]);
    expect(
      await prisma.exportRecord.count({ where: { designJobId: jobDup.id } })
    ).toBe(1);
  });

  it('protects active valid leases from owner recovery, enforces deterministic concurrent renewal vs recovery, and allows strictly one concurrent recovery winner', async () => {
    const actor = { userId, organisationId: orgId };
    const { agent } = await registerActiveAgent('REC-RACE');
    const t0 = new Date('2026-11-23T16:00:00.000Z');
    const tStillValid = new Date(t0.getTime() + 5 * 60 * 1000);
    const tExpired = new Date(t0.getTime() + AGENT_DISPATCH_LEASE_MS + 10_000);

    const jobRec = await createDesignJob(actor, {
      title: `S552 Owner Recovery Race ${runId}`,
      category: 'BIRTHDAY_FLYER',
      priority: 'HIGH',
      initialStatus: 'DRAFT',
      memberId,
      birthdayTargetYear: 2027,
      templateId,
      templateVersionId: versionId,
    });
    const qRec = await createCreativeJobDispatch(actor, jobRec.id, {
      designJobId: jobRec.id,
      idempotencyKey: `s552_q_rec_${runId}`,
      exportFormats: ['PNG'],
    });

    const claimed = requireClaimed(
      await claimNextCreativeDispatch(agent, { now: () => t0 })
    );
    expect(claimed.dispatch.id).toBe(qRec.dispatch.id);

    // 1. Active valid lease in CLAIMED cannot be silently interrupted by owner recovery
    await expect(
      recoverCreativeJobDispatch(
        actor,
        jobRec.id,
        qRec.dispatch.id,
        {
          reason: 'Should fail on active CLAIMED lease',
          confirmPreserveLocalWork: true,
        },
        { now: () => tStillValid }
      )
    ).rejects.toMatchObject({ code: 'DISPATCH_ACTIVE_LEASE_PROTECTED' });

    // 2. Expired non-READY_FOR_ARTIST state (OPENING_TEMPLATE) is NOT eligible for owner recovery
    await updateAgentDispatchStatus(
      agent,
      qRec.dispatch.id,
      claimed.claimToken,
      { status: 'DOWNLOADING_ASSETS' },
      { now: () => t0 }
    );
    await updateAgentDispatchStatus(
      agent,
      qRec.dispatch.id,
      claimed.claimToken,
      { status: 'OPENING_TEMPLATE' },
      { now: () => t0 }
    );
    await expect(
      recoverCreativeJobDispatch(
        actor,
        jobRec.id,
        qRec.dispatch.id,
        {
          reason: 'Should fail on non-READY_FOR_ARTIST expired dispatch',
          confirmPreserveLocalWork: true,
        },
        { now: () => tExpired }
      )
    ).rejects.toMatchObject({ code: 'DISPATCH_NOT_ELIGIBLE_FOR_RECOVERY' });

    // 3. Advance to READY_FOR_ARTIST with valid lease -> active lease STILL protected!
    await updateAgentDispatchStatus(
      agent,
      qRec.dispatch.id,
      claimed.claimToken,
      { status: 'READY_FOR_ARTIST', executionMode: 'ASSISTED' },
      { now: () => t0 }
    );

    // Concurrent lease renewal vs owner recovery while lease is valid -> deterministic: renewal succeeds, recovery rejected!
    const [renewValid, recoverValid] = await Promise.allSettled([
      renewAgentDispatchLease(agent, qRec.dispatch.id, claimed.claimToken, {
        now: () => tStillValid,
      }),
      recoverCreativeJobDispatch(
        actor,
        jobRec.id,
        qRec.dispatch.id,
        {
          reason: 'Racing against active valid lease renewal',
          confirmPreserveLocalWork: true,
        },
        { now: () => tStillValid }
      ),
    ]);
    expect(renewValid.status).toBe('fulfilled');
    expect(recoverValid.status).toBe('rejected');
    if (recoverValid.status === 'rejected') {
      expect(recoverValid.reason).toBeInstanceOf(JobPreparationConflictError);
      expect((recoverValid.reason as JobPreparationConflictError).code).toBe(
        'DISPATCH_ACTIVE_LEASE_PROTECTED'
      );
    }

    // 4. After renewed lease expires: concurrent lease renewal vs TWO concurrent owner recoveries!
    const tAfterRenewedExpiry = new Date(
      tStillValid.getTime() + AGENT_DISPATCH_LEASE_MS + 10_000
    );
    const [r1, r2, staleRenew] = await Promise.allSettled([
      recoverCreativeJobDispatch(
        actor,
        jobRec.id,
        qRec.dispatch.id,
        {
          reason: 'Concurrent owner recovery #1 after expiry',
          confirmPreserveLocalWork: true,
        },
        { now: () => tAfterRenewedExpiry }
      ),
      recoverCreativeJobDispatch(
        actor,
        jobRec.id,
        qRec.dispatch.id,
        {
          reason: 'Concurrent owner recovery #2 after expiry',
          confirmPreserveLocalWork: true,
        },
        { now: () => tAfterRenewedExpiry }
      ),
      renewAgentDispatchLease(agent, qRec.dispatch.id, claimed.claimToken, {
        now: () => tAfterRenewedExpiry,
      }),
    ]);

    // Strictly ONE concurrent owner recovery wins; second recovery & stale renewal BOTH fail cleanly!
    const recoveryOutcomes = [r1, r2];
    expect(
      recoveryOutcomes.filter((o) => o.status === 'fulfilled')
    ).toHaveLength(1);
    expect(
      recoveryOutcomes.filter((o) => o.status === 'rejected')
    ).toHaveLength(1);
    expect(staleRenew.status).toBe('rejected');

    const finalDisp = await prisma.creativeJobDispatch.findUniqueOrThrow({
      where: { id: qRec.dispatch.id },
    });
    expect(finalDisp.status).toBe('QUEUED');
    expect(finalDisp.assignedAgentId).toBeNull();
    expect(finalDisp.claimTokenHash).toBeNull();
    expect(finalDisp.leaseExpiresAt).toBeNull();

    // Verify strictly ONE OWNER_EXPLICIT_REQUEUE audit record written for this dispatch
    const recoveryAudits = await prisma.auditLog.findMany({
      where: {
        organisationId: orgId,
        entityId: qRec.dispatch.id,
        action: 'CREATIVE_DISPATCH_RECOVERED',
      },
    });
    expect(recoveryAudits).toHaveLength(1);
  });
});
