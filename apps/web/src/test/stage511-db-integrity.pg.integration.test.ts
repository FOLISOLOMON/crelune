import crypto from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { prisma } from '@crelune/database';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildTemplateMasterObjectKey } from '../lib/storage/storage-config';
import { assertSafeDevDatabaseEnvironment } from './assert-dev-db';

function createDeferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

interface LockWaitEvidence {
  waiterPid: number;
  holderPid: number;
  waitEvent: string;
  blockingPids: number[];
  query: string;
}

async function waitForDesignJobsLockWait(
  observer: PrismaClient,
  params: {
    waiterPid: number;
    holderPid: number;
    expectedQueryFragment: string;
  },
  timeoutMs = 15_000
): Promise<LockWaitEvidence> {
  const { waiterPid, holderPid, expectedQueryFragment } = params;
  const deadline = Date.now() + timeoutMs;
  let lastSnapshot: unknown = null;

  while (Date.now() < deadline) {
    const rows = await observer.$queryRaw<
      Array<{
        pid: number;
        state: string | null;
        wait_event_type: string | null;
        wait_event: string | null;
        blocking_pids: number[] | null;
        query: string | null;
        holder_holds_design_jobs_lock: boolean;
      }>
    >`
      SELECT
        a.pid,
        a.state,
        a.wait_event_type,
        a.wait_event,
        pg_blocking_pids(a.pid) AS blocking_pids,
        a.query,
        EXISTS (
          SELECT 1
          FROM pg_locks hl
          JOIN pg_class hc ON hc.oid = hl.relation
          WHERE hl.pid = ${holderPid}::int
            AND hc.relname = 'design_jobs'
            AND hl.granted
        ) AS holder_holds_design_jobs_lock
      FROM pg_stat_activity a
      WHERE a.datname = current_database()
        AND a.pid = ${waiterPid}::int
    `;

    const row = rows[0];
    lastSnapshot = row ?? null;

    if (
      row &&
      row.state === 'active' &&
      row.wait_event_type === 'Lock' &&
      (row.wait_event === 'transactionid' || row.wait_event === 'tuple') &&
      Array.isArray(row.blocking_pids) &&
      row.blocking_pids.includes(holderPid) &&
      row.holder_holds_design_jobs_lock &&
      typeof row.query === 'string' &&
      row.query.includes(expectedQueryFragment)
    ) {
      return {
        waiterPid: Number(row.pid),
        holderPid,
        waitEvent: row.wait_event,
        blockingPids: row.blocking_pids.map(Number),
        query: row.query,
      };
    }

    await new Promise((r) => setTimeout(r, 40));
  }

  throw new Error(
    `Timed out waiting for waiterPid=${waiterPid} to block behind holderPid=${holderPid} on design_jobs lock. Last snapshot: ${JSON.stringify(lastSnapshot)}`
  );
}

describe('PostgreSQL Stage 5.1.1 Integrity Hardening: Organisation Isolation, Version Consistency & Immutability (Neon Dev)', () => {
  const runId = `s511_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
  const createdOrgIds: string[] = [];

  let orgAId = '';
  let orgBId = '';
  let userAId = '';
  let userBId = '';
  let agentAId = '';
  let agentBId = '';
  let templateA1Id = '';
  let templateA2Id = '';
  let templateB1Id = '';
  let versionA1v1Id = '';
  let versionA1v2Id = '';
  let versionA2v1Id = '';
  let versionB1v1Id = '';
  let intentA1Id = '';
  let intentB1Id = '';
  let unusedIntentBId = '';
  let jobA1Id = '';
  let jobA2Id = '';
  let jobB1Id = '';
  let dispatchA1Id = '';
  let dispatchB1Id = '';

  const sha = (label: string) =>
    crypto.createHash('sha256').update(`${label}-${runId}`).digest('hex');

  beforeAll(async () => {
    assertSafeDevDatabaseEnvironment();

    const orgA = await prisma.organisation.create({
      data: { name: `Stage511 Org A ${runId}`, slug: `s511-a-${runId}` },
    });
    orgAId = orgA.id;
    createdOrgIds.push(orgAId);

    const orgB = await prisma.organisation.create({
      data: { name: `Stage511 Org B ${runId}`, slug: `s511-b-${runId}` },
    });
    orgBId = orgB.id;
    createdOrgIds.push(orgBId);

    const userA = await prisma.user.create({
      data: {
        organisationId: orgAId,
        email: `owner-a-${runId}@crelune.test`,
        passwordHash: 'not-a-login-hash',
        firstName: 'Owner',
        lastName: 'Alpha',
      },
    });
    userAId = userA.id;

    const userB = await prisma.user.create({
      data: {
        organisationId: orgBId,
        email: `owner-b-${runId}@crelune.test`,
        passwordHash: 'not-a-login-hash',
        firstName: 'Owner',
        lastName: 'Beta',
      },
    });
    userBId = userB.id;

    const agentA = await prisma.creativeAgent.create({
      data: {
        organisationId: orgAId,
        registeredByUserId: userAId,
        name: 'Agent Alpha',
        machineLabel: 'WIN-ALPHA-01',
        tokenHash: sha('agent-token-a'),
        tokenPrefix: 'cag_test_a',
      },
    });
    agentAId = agentA.id;

    const agentB = await prisma.creativeAgent.create({
      data: {
        organisationId: orgBId,
        registeredByUserId: userBId,
        name: 'Agent Beta',
        machineLabel: 'WIN-BETA-01',
        tokenHash: sha('agent-token-b'),
        tokenPrefix: 'cag_test_b',
      },
    });
    agentBId = agentB.id;

    const templateA1 = await prisma.template.create({
      data: {
        organisationId: orgAId,
        name: `Template A1 ${runId}`,
        normalizedName: `template a1 ${runId}`,
        category: 'BIRTHDAY_FLYER',
        studioType: 'AFFINITY_STUDIO',
        createdByUserId: userAId,
      },
    });
    templateA1Id = templateA1.id;

    const templateA2 = await prisma.template.create({
      data: {
        organisationId: orgAId,
        name: `Template A2 ${runId}`,
        normalizedName: `template a2 ${runId}`,
        category: 'EVENT_ANNOUNCEMENT',
        studioType: 'AFFINITY_PHOTO',
        createdByUserId: userAId,
      },
    });
    templateA2Id = templateA2.id;

    const templateB1 = await prisma.template.create({
      data: {
        organisationId: orgBId,
        name: `Template B1 ${runId}`,
        normalizedName: `template b1 ${runId}`,
        category: 'BIRTHDAY_FLYER',
        studioType: 'AFFINITY_STUDIO',
        createdByUserId: userBId,
      },
    });
    templateB1Id = templateB1.id;

    const keyA1v1 = buildTemplateMasterObjectKey({
      envPrefix: 'development',
      organisationId: orgAId,
      templateId: templateA1Id,
      versionNumber: 1,
      extension: 'psd',
      objectId: `a1v1_${runId}`,
    });
    const intentA1 = await prisma.creativeUploadIntent.create({
      data: {
        organisationId: orgAId,
        requestedByUserId: userAId,
        kind: 'TEMPLATE_MASTER',
        idempotencyKey: `intent_a1_${runId}`,
        storageBucket: 'crelune-dev-creative',
        storageKey: keyA1v1,
        expectedMimeType: 'image/vnd.adobe.photoshop',
        expectedByteSize: 1024,
        expectedSha256: sha('file-a1v1'),
        maxAllowedBytes: 100 * 1024 * 1024,
        status: 'VERIFIED',
        verifiedByteSize: 1024,
        verifiedSha256: sha('file-a1v1'),
        expiresAt: new Date(Date.now() + 900_000),
        verifiedAt: new Date(),
      },
    });
    intentA1Id = intentA1.id;

    const keyB1v1 = buildTemplateMasterObjectKey({
      envPrefix: 'development',
      organisationId: orgBId,
      templateId: templateB1Id,
      versionNumber: 1,
      extension: 'psd',
      objectId: `b1v1_${runId}`,
    });
    const intentB1 = await prisma.creativeUploadIntent.create({
      data: {
        organisationId: orgBId,
        requestedByUserId: userBId,
        kind: 'TEMPLATE_MASTER',
        idempotencyKey: `intent_b1_${runId}`,
        storageBucket: 'crelune-dev-creative',
        storageKey: keyB1v1,
        expectedMimeType: 'image/vnd.adobe.photoshop',
        expectedByteSize: 1024,
        expectedSha256: sha('file-b1v1'),
        maxAllowedBytes: 100 * 1024 * 1024,
        status: 'VERIFIED',
        verifiedByteSize: 1024,
        verifiedSha256: sha('file-b1v1'),
        expiresAt: new Date(Date.now() + 900_000),
        verifiedAt: new Date(),
      },
    });
    intentB1Id = intentB1.id;

    const vA1v1 = await prisma.templateVersion.create({
      data: {
        organisationId: orgAId,
        templateId: templateA1Id,
        versionNumber: 1,
        format: 'PSD',
        storageBucket: 'crelune-dev-creative',
        storageKey: keyA1v1,
        originalFilename: 'a1-v1.psd',
        mimeType: 'image/vnd.adobe.photoshop',
        byteSize: 1024,
        sha256: sha('file-a1v1'),
        uploadedByUserId: userAId,
        uploadIntentId: intentA1Id,
      },
    });
    versionA1v1Id = vA1v1.id;

    const vA1v2 = await prisma.templateVersion.create({
      data: {
        organisationId: orgAId,
        templateId: templateA1Id,
        versionNumber: 2,
        format: 'AF',
        storageBucket: 'crelune-dev-creative',
        storageKey: buildTemplateMasterObjectKey({
          envPrefix: 'development',
          organisationId: orgAId,
          templateId: templateA1Id,
          versionNumber: 2,
          extension: 'af',
          objectId: `a1v2_${runId}`,
        }),
        originalFilename: 'a1-v2.af',
        mimeType: 'application/octet-stream',
        byteSize: 2048,
        sha256: sha('file-a1v2'),
        uploadedByUserId: userAId,
      },
    });
    versionA1v2Id = vA1v2.id;

    const vA2v1 = await prisma.templateVersion.create({
      data: {
        organisationId: orgAId,
        templateId: templateA2Id,
        versionNumber: 1,
        format: 'PSD',
        storageBucket: 'crelune-dev-creative',
        storageKey: buildTemplateMasterObjectKey({
          envPrefix: 'development',
          organisationId: orgAId,
          templateId: templateA2Id,
          versionNumber: 1,
          extension: 'psd',
          objectId: `a2v1_${runId}`,
        }),
        originalFilename: 'a2-v1.psd',
        mimeType: 'image/vnd.adobe.photoshop',
        byteSize: 1500,
        sha256: sha('file-a2v1'),
        uploadedByUserId: userAId,
      },
    });
    versionA2v1Id = vA2v1.id;

    const vB1v1 = await prisma.templateVersion.create({
      data: {
        organisationId: orgBId,
        templateId: templateB1Id,
        versionNumber: 1,
        format: 'PSD',
        storageBucket: 'crelune-dev-creative',
        storageKey: keyB1v1,
        originalFilename: 'b1-v1.psd',
        mimeType: 'image/vnd.adobe.photoshop',
        byteSize: 1024,
        sha256: sha('file-b1v1'),
        uploadedByUserId: userBId,
        uploadIntentId: intentB1Id,
      },
    });
    versionB1v1Id = vB1v1.id;

    const jobA1 = await prisma.designJob.create({
      data: {
        organisationId: orgAId,
        title: `Job A1 ${runId}`,
        category: 'EVENT_ANNOUNCEMENT',
        templateId: templateA1Id,
        templateVersionId: versionA1v1Id,
      },
    });
    jobA1Id = jobA1.id;

    const jobA2 = await prisma.designJob.create({
      data: {
        organisationId: orgAId,
        title: `Job A2 TemplateOnly ${runId}`,
        category: 'EVENT_ANNOUNCEMENT',
        templateId: templateA1Id,
        templateVersionId: null,
      },
    });
    jobA2Id = jobA2.id;

    const jobB1 = await prisma.designJob.create({
      data: {
        organisationId: orgBId,
        title: `Job B1 ${runId}`,
        category: 'EVENT_ANNOUNCEMENT',
        templateId: templateB1Id,
        templateVersionId: versionB1v1Id,
      },
    });
    jobB1Id = jobB1.id;

    const dispA1 = await prisma.creativeJobDispatch.create({
      data: {
        organisationId: orgAId,
        designJobId: jobA1Id,
        templateVersionId: versionA1v1Id,
        assignedAgentId: agentAId,
        requestedByUserId: userAId,
        idempotencyKey: `disp_a1_${runId}`,
        manifestVersion: 1,
        manifestJson: { manifestVersion: 1 },
      },
    });
    dispatchA1Id = dispA1.id;

    const dispB1 = await prisma.creativeJobDispatch.create({
      data: {
        organisationId: orgBId,
        designJobId: jobB1Id,
        templateVersionId: versionB1v1Id,
        assignedAgentId: agentBId,
        requestedByUserId: userBId,
        idempotencyKey: `disp_b1_${runId}`,
        manifestVersion: 1,
        manifestJson: { manifestVersion: 1 },
      },
    });
    dispatchB1Id = dispB1.id;
  });

  afterAll(async () => {
    if (createdOrgIds.length === 0) return;
    await prisma.exportRecord.deleteMany({ where: { organisationId: { in: createdOrgIds } } });
    await prisma.creativeJobDispatch.deleteMany({ where: { organisationId: { in: createdOrgIds } } });
    await prisma.templateFieldMapping.deleteMany({ where: { organisationId: { in: createdOrgIds } } });
    await prisma.designJobHistory.deleteMany({ where: { organisationId: { in: createdOrgIds } } });
    await prisma.designJob.deleteMany({ where: { organisationId: { in: createdOrgIds } } });
    await prisma.template.updateMany({
      where: { organisationId: { in: createdOrgIds } },
      data: { activeVersionId: null },
    });
    await prisma.templateVersion.deleteMany({ where: { organisationId: { in: createdOrgIds } } });
    await prisma.template.deleteMany({ where: { organisationId: { in: createdOrgIds } } });
    await prisma.creativeUploadIntent.deleteMany({ where: { organisationId: { in: createdOrgIds } } });
    await prisma.creativeAgent.deleteMany({ where: { organisationId: { in: createdOrgIds } } });
    await prisma.creativeStorageCleanup.deleteMany({ where: { organisationId: { in: createdOrgIds } } });
    await prisma.auditLog.deleteMany({ where: { organisationId: { in: createdOrgIds } } });
    await prisma.user.deleteMany({ where: { organisationId: { in: createdOrgIds } } });
    await prisma.organisation.deleteMany({ where: { id: { in: createdOrgIds } } });
  });

  it('rejects all cross-organisation relationships across Template, TemplateVersion, TemplateFieldMapping, Agents, Users & UploadIntents', async () => {
    // 1. Cross-org Template -> createdByUser
    await expect(
      prisma.template.create({
        data: {
          organisationId: orgAId,
          name: `Cross User Tpl ${runId}`,
          normalizedName: `cross user tpl ${runId}`,
          studioType: 'AFFINITY_STUDIO',
          createdByUserId: userBId,
        },
      })
    ).rejects.toThrow();

    // 2. Cross-org TemplateVersion -> Template
    await expect(
      prisma.templateVersion.create({
        data: {
          organisationId: orgAId,
          templateId: templateB1Id,
          versionNumber: 99,
          format: 'PSD',
          storageBucket: 'crelune-dev-creative',
          storageKey: `development/organisations/${orgAId}/templates/cross_${runId}.psd`,
          originalFilename: 'cross.psd',
          mimeType: 'image/vnd.adobe.photoshop',
          byteSize: 100,
          sha256: sha('cross-tv-tpl'),
          uploadedByUserId: userAId,
        },
      })
    ).rejects.toThrow();

    // 3. Cross-org TemplateVersion -> uploadedByUser
    await expect(
      prisma.templateVersion.create({
        data: {
          organisationId: orgAId,
          templateId: templateA1Id,
          versionNumber: 98,
          format: 'PSD',
          storageBucket: 'crelune-dev-creative',
          storageKey: `development/organisations/${orgAId}/templates/cross_u_${runId}.psd`,
          originalFilename: 'cross-u.psd',
          mimeType: 'image/vnd.adobe.photoshop',
          byteSize: 100,
          sha256: sha('cross-tv-user'),
          uploadedByUserId: userBId,
        },
      })
    ).rejects.toThrow();

    // 4. Cross-org TemplateVersion -> uploadIntent
    const unusedIntentB = await prisma.creativeUploadIntent.create({
      data: {
        organisationId: orgBId,
        requestedByUserId: userBId,
        kind: 'TEMPLATE_MASTER',
        idempotencyKey: `intent_b_unused_${runId}`,
        storageBucket: 'crelune-dev-creative',
        storageKey: `development/organisations/${orgBId}/templates/unused_${runId}.psd`,
        expectedMimeType: 'image/vnd.adobe.photoshop',
        expectedByteSize: 100,
        maxAllowedBytes: 1000,
        status: 'VERIFIED',
        expiresAt: new Date(Date.now() + 900_000),
      },
    });
    unusedIntentBId = unusedIntentB.id;
    await expect(
      prisma.templateVersion.create({
        data: {
          organisationId: orgAId,
          templateId: templateA1Id,
          versionNumber: 97,
          format: 'PSD',
          storageBucket: 'crelune-dev-creative',
          storageKey: `development/organisations/${orgAId}/templates/cross_int_${runId}.psd`,
          originalFilename: 'cross-int.psd',
          mimeType: 'image/vnd.adobe.photoshop',
          byteSize: 100,
          sha256: sha('cross-tv-intent'),
          uploadedByUserId: userAId,
          uploadIntentId: unusedIntentB.id,
        },
      })
    ).rejects.toThrow();

    // 5. Cross-org TemplateFieldMapping -> TemplateVersion
    await expect(
      prisma.templateFieldMapping.create({
        data: {
          organisationId: orgAId,
          templateVersionId: versionB1v1Id,
          fieldKey: 'member.fullName',
          fieldType: 'TEXT',
          targetLayerName: 'Name',
        },
      })
    ).rejects.toThrow();

    // 6. Cross-org CreativeUploadIntent -> User and -> CreativeAgent
    await expect(
      prisma.creativeUploadIntent.create({
        data: {
          organisationId: orgAId,
          requestedByUserId: userBId,
          kind: 'EXPORT_DELIVERABLE',
          idempotencyKey: `cross_int_user_${runId}`,
          storageBucket: 'crelune-dev-creative',
          storageKey: `development/organisations/${orgAId}/exports/cross_u_${runId}.png`,
          expectedMimeType: 'image/png',
          expectedByteSize: 100,
          maxAllowedBytes: 1000,
          expiresAt: new Date(Date.now() + 900_000),
        },
      })
    ).rejects.toThrow();

    await expect(
      prisma.creativeUploadIntent.create({
        data: {
          organisationId: orgAId,
          agentId: agentBId,
          kind: 'EXPORT_DELIVERABLE',
          idempotencyKey: `cross_int_agent_${runId}`,
          storageBucket: 'crelune-dev-creative',
          storageKey: `development/organisations/${orgAId}/exports/cross_a_${runId}.png`,
          expectedMimeType: 'image/png',
          expectedByteSize: 100,
          maxAllowedBytes: 1000,
          expiresAt: new Date(Date.now() + 900_000),
        },
      })
    ).rejects.toThrow();

    // 7. Cross-org CreativeAgent -> registeredByUser and -> revokedByUser
    await expect(
      prisma.creativeAgent.create({
        data: {
          organisationId: orgAId,
          registeredByUserId: userBId,
          name: 'Cross Agent',
          machineLabel: 'WIN-CROSS',
          tokenHash: sha('cross-agent-reg'),
          tokenPrefix: 'cag_cross',
        },
      })
    ).rejects.toThrow();

    await expect(
      prisma.creativeAgent.update({
        where: { id: agentAId },
        data: {
          status: 'REVOKED',
          revokedAt: new Date(),
          revokedByUserId: userBId,
          revocationReason: 'Cross org attempt',
        },
      })
    ).rejects.toThrow();
  });

  it('enforces Template.activeVersionId, DesignJob, CreativeJobDispatch & ExportRecord cross-org and version consistency', async () => {
    // Template activating a version belonging to another template (same org) -> REJECT
    await expect(
      prisma.template.update({
        where: { id: templateA1Id },
        data: { activeVersionId: versionA2v1Id },
      })
    ).rejects.toThrow();

    // Template activating a version belonging to another organisation -> REJECT
    await expect(
      prisma.template.update({
        where: { id: templateA1Id },
        data: { activeVersionId: versionB1v1Id },
      })
    ).rejects.toThrow();

    // DesignJob -> cross-org Template -> REJECT
    await expect(
      prisma.designJob.create({
        data: {
          organisationId: orgAId,
          title: `Cross Job Tpl ${runId}`,
          templateId: templateB1Id,
        },
      })
    ).rejects.toThrow();

    // DesignJob -> cross-org TemplateVersion -> REJECT
    await expect(
      prisma.designJob.create({
        data: {
          organisationId: orgAId,
          title: `Cross Job Ver ${runId}`,
          templateId: templateA1Id,
          templateVersionId: versionB1v1Id,
        },
      })
    ).rejects.toThrow();

    // DesignJob selecting T1 and version of T2 (same org) -> REJECT
    await expect(
      prisma.designJob.create({
        data: {
          organisationId: orgAId,
          title: `Mismatch Job Tpl Ver ${runId}`,
          templateId: templateA1Id,
          templateVersionId: versionA2v1Id,
        },
      })
    ).rejects.toThrow();

    // DesignJob setting templateVersionId without templateId (MATCH SIMPLE NULL bypass check) -> REJECT
    await expect(
      prisma.designJob.create({
        data: {
          organisationId: orgAId,
          title: `Orphan Version Job ${runId}`,
          templateId: null,
          templateVersionId: versionA1v1Id,
        },
      })
    ).rejects.toThrow(/template_version_id cannot be set without template_id/i);

    // Valid nullable permutations: both null OR templateId set with templateVersionId=null
    const plainJob = await prisma.designJob.create({
      data: {
        organisationId: orgAId,
        title: `Plain Null Job ${runId}`,
        templateId: null,
        templateVersionId: null,
      },
    });
    expect(plainJob.templateId).toBeNull();

    // CreativeJobDispatch cross-org references (job, version, agent, user) -> ALL REJECT
    await expect(
      prisma.creativeJobDispatch.create({
        data: {
          organisationId: orgAId,
          designJobId: jobB1Id,
          templateVersionId: versionA1v1Id,
          requestedByUserId: userAId,
          idempotencyKey: `cross_disp_job_${runId}`,
          manifestJson: { manifestVersion: 1 },
        },
      })
    ).rejects.toThrow();

    await expect(
      prisma.creativeJobDispatch.create({
        data: {
          organisationId: orgAId,
          designJobId: jobA1Id,
          templateVersionId: versionB1v1Id,
          requestedByUserId: userAId,
          idempotencyKey: `cross_disp_ver_${runId}`,
          manifestJson: { manifestVersion: 1 },
        },
      })
    ).rejects.toThrow();

    await expect(
      prisma.creativeJobDispatch.create({
        data: {
          organisationId: orgAId,
          designJobId: jobA1Id,
          templateVersionId: versionA1v1Id,
          assignedAgentId: agentBId,
          requestedByUserId: userAId,
          idempotencyKey: `cross_disp_agent_${runId}`,
          manifestJson: { manifestVersion: 1 },
        },
      })
    ).rejects.toThrow();

    await expect(
      prisma.creativeJobDispatch.create({
        data: {
          organisationId: orgAId,
          designJobId: jobA1Id,
          templateVersionId: versionA1v1Id,
          requestedByUserId: userBId,
          idempotencyKey: `cross_disp_user_${runId}`,
          manifestJson: { manifestVersion: 1 },
        },
      })
    ).rejects.toThrow();

    // CreativeJobDispatch inconsistent with DesignJob.templateId (jobA2 selected T1, version null -> T2 version rejected!)
    await expect(
      prisma.creativeJobDispatch.create({
        data: {
          organisationId: orgAId,
          designJobId: jobA2Id,
          templateVersionId: versionA2v1Id,
          requestedByUserId: userAId,
          idempotencyKey: `mismatch_disp_tpl_${runId}`,
          manifestJson: { manifestVersion: 1 },
        },
      })
    ).rejects.toThrow(/expected DesignJob template/i);

    // CreativeJobDispatch inconsistent with pinned DesignJob.templateVersionId (jobA1 pinned v1 -> v2 rejected!)
    await expect(
      prisma.creativeJobDispatch.create({
        data: {
          organisationId: orgAId,
          designJobId: jobA1Id,
          templateVersionId: versionA1v2Id,
          requestedByUserId: userAId,
          idempotencyKey: `mismatch_disp_pin_${runId}`,
          manifestJson: { manifestVersion: 1 },
        },
      })
    ).rejects.toThrow(/conflicts with pinned DesignJob\.template_version_id/i);

    // DesignJob cannot switch template away while an active (QUEUED) dispatch references v1
    await expect(
      prisma.designJob.update({
        where: { id: jobA1Id },
        data: { templateId: templateA2Id, templateVersionId: versionA2v1Id },
      })
    ).rejects.toThrow(/conflicts with active CreativeJobDispatch/i);

    // Dispatch selecting another version of DesignJob's template when templateVersionId is null succeeds cleanly
    const dispA2 = await prisma.creativeJobDispatch.create({
      data: {
        organisationId: orgAId,
        designJobId: jobA2Id,
        templateVersionId: versionA1v2Id,
        assignedAgentId: agentAId,
        requestedByUserId: userAId,
        idempotencyKey: `valid_disp_a2_${runId}`,
        manifestVersion: 1,
        manifestJson: { manifestVersion: 1 },
      },
    });
    expect(dispA2.templateVersionId).toBe(versionA1v2Id);

    // ExportRecord cross-org & cross-job dispatch references -> ALL REJECT
    await expect(
      prisma.exportRecord.create({
        data: {
          organisationId: orgAId,
          designJobId: jobB1Id,
          format: 'PNG',
          storageBucket: 'crelune-dev-creative',
          storageKey: `development/organisations/${orgAId}/exports/cross_job_${runId}.png`,
          mimeType: 'image/png',
          byteSize: 2048,
          sha256: sha('exp-cross-job'),
        },
      })
    ).rejects.toThrow();

    await expect(
      prisma.exportRecord.create({
        data: {
          organisationId: orgAId,
          designJobId: jobA1Id,
          dispatchId: dispatchB1Id,
          format: 'PNG',
          storageBucket: 'crelune-dev-creative',
          storageKey: `development/organisations/${orgAId}/exports/cross_disp_${runId}.png`,
          mimeType: 'image/png',
          byteSize: 2048,
          sha256: sha('exp-cross-disp'),
        },
      })
    ).rejects.toThrow();

    // Same-org dispatchId belonging to a DIFFERENT DesignJob (dispA2 belongs to jobA2, not jobA1) -> REJECT
    await expect(
      prisma.exportRecord.create({
        data: {
          organisationId: orgAId,
          designJobId: jobA1Id,
          dispatchId: dispA2.id,
          format: 'PNG',
          storageBucket: 'crelune-dev-creative',
          storageKey: `development/organisations/${orgAId}/exports/wrong_job_disp_${runId}.png`,
          mimeType: 'image/png',
          byteSize: 2048,
          sha256: sha('exp-wrong-job-disp'),
        },
      })
    ).rejects.toThrow();

    await expect(
      prisma.exportRecord.create({
        data: {
          organisationId: orgAId,
          designJobId: jobA1Id,
          uploadedByAgentId: agentBId,
          format: 'PNG',
          storageBucket: 'crelune-dev-creative',
          storageKey: `development/organisations/${orgAId}/exports/cross_ag_${runId}.png`,
          mimeType: 'image/png',
          byteSize: 2048,
          sha256: sha('exp-cross-ag'),
        },
      })
    ).rejects.toThrow();

    await expect(
      prisma.exportRecord.create({
        data: {
          organisationId: orgAId,
          designJobId: jobA1Id,
          uploadedByUserId: userBId,
          format: 'PNG',
          storageBucket: 'crelune-dev-creative',
          storageKey: `development/organisations/${orgAId}/exports/cross_up_${runId}.png`,
          mimeType: 'image/png',
          byteSize: 2048,
          sha256: sha('exp-cross-up'),
        },
      })
    ).rejects.toThrow();

    await expect(
      prisma.exportRecord.create({
        data: {
          organisationId: orgAId,
          designJobId: jobA1Id,
          ownerApprovedByUserId: userBId,
          isApprovedForPublish: true,
          ownerApprovedAt: new Date(),
          format: 'PNG',
          storageBucket: 'crelune-dev-creative',
          storageKey: `development/organisations/${orgAId}/exports/cross_ap_${runId}.png`,
          mimeType: 'image/png',
          byteSize: 2048,
          sha256: sha('exp-cross-ap'),
        },
      })
    ).rejects.toThrow();

    await expect(
      prisma.exportRecord.create({
        data: {
          organisationId: orgAId,
          designJobId: jobA1Id,
          uploadIntentId: unusedIntentBId,
          format: 'PNG',
          storageBucket: 'crelune-dev-creative',
          storageKey: `development/organisations/${orgAId}/exports/cross_int_${runId}.png`,
          mimeType: 'image/png',
          byteSize: 2048,
          sha256: sha('exp-cross-int'),
        },
      })
    ).rejects.toThrow();

    // Valid same-org ExportRecord persists cleanly with non-published defaults
    const validExport = await prisma.exportRecord.create({
      data: {
        organisationId: orgAId,
        designJobId: jobA1Id,
        dispatchId: dispatchA1Id,
        uploadedByAgentId: agentAId,
        uploadedByUserId: userAId,
        format: 'PNG',
        storageBucket: 'crelune-dev-creative',
        storageKey: `development/organisations/${orgAId}/exports/valid_${runId}.png`,
        mimeType: 'image/png',
        byteSize: 4096,
        sha256: sha('exp-valid'),
      },
    });
    expect(validExport.isApprovedForPublish).toBe(false);
    expect(validExport.publishedAt).toBeNull();
  });

  it('enforces TemplateVersion immutability via PG trigger, allows inspection updates, protects in-use deletion, and preserves rollback/archive', async () => {
    // Reject changes to immutable file identity & integrity fields
    await expect(
      prisma.$executeRaw`UPDATE template_versions SET template_id = ${templateA2Id} WHERE id = ${versionA1v1Id}`
    ).rejects.toThrow(/immutable field .*template_id/i);

    await expect(
      prisma.templateVersion.update({
        where: { id: versionA1v1Id },
        data: { versionNumber: 99 },
      })
    ).rejects.toThrow(/immutable field .*version_number/i);

    await expect(
      prisma.templateVersion.update({
        where: { id: versionA1v1Id },
        data: { format: 'AF' },
      })
    ).rejects.toThrow(/immutable field .*format/i);

    await expect(
      prisma.templateVersion.update({
        where: { id: versionA1v1Id },
        data: { storageBucket: 'other-bucket' },
      })
    ).rejects.toThrow(/immutable field .*storage_bucket/i);

    await expect(
      prisma.templateVersion.update({
        where: { id: versionA1v1Id },
        data: { storageKey: 'tampered/key.psd' },
      })
    ).rejects.toThrow(/immutable field .*storage_key/i);

    await expect(
      prisma.templateVersion.update({
        where: { id: versionA1v1Id },
        data: { originalFilename: 'tampered.psd' },
      })
    ).rejects.toThrow(/immutable field .*original_filename/i);

    await expect(
      prisma.templateVersion.update({
        where: { id: versionA1v1Id },
        data: { mimeType: 'application/octet-stream' },
      })
    ).rejects.toThrow(/immutable field .*mime_type/i);

    await expect(
      prisma.templateVersion.update({
        where: { id: versionA1v1Id },
        data: { byteSize: 999999 },
      })
    ).rejects.toThrow(/immutable field .*byte_size/i);

    await expect(
      prisma.templateVersion.update({
        where: { id: versionA1v1Id },
        data: { sha256: sha('tampered-hash') },
      })
    ).rejects.toThrow(/immutable field .*sha256/i);

    await expect(
      prisma.$executeRaw`UPDATE template_versions SET upload_intent_id = NULL WHERE id = ${versionA1v1Id}`
    ).rejects.toThrow(/immutable field .*upload_intent_id/i);

    // Permit controlled inspection metadata updates
    const inspected = await prisma.templateVersion.update({
      where: { id: versionA1v1Id },
      data: {
        inspectionStatus: 'INSPECTED',
        inspectionSummary: 'Verified 2 mappable layers cleanly.',
        detectedLayersJson: [
          { id: 'layer-1', name: 'Member Name', kind: 'TEXT', visible: true },
          { id: 'layer-2', name: 'Portrait Frame', kind: 'IMAGE', visible: true },
        ],
        inspectedAt: new Date(),
        widthPx: 1080,
        heightPx: 1350,
      },
    });
    expect(inspected.inspectionStatus).toBe('INSPECTED');
    expect(inspected.widthPx).toBe(1080);

    // Preserve intended rollback (v1 -> v2 -> v1) and archive behaviour on Template
    const activatedV2 = await prisma.template.update({
      where: { id: templateA1Id },
      data: { activeVersionId: versionA1v2Id },
    });
    expect(activatedV2.activeVersionId).toBe(versionA1v2Id);

    const rolledBackV1 = await prisma.template.update({
      where: { id: templateA1Id },
      data: { activeVersionId: versionA1v1Id },
    });
    expect(rolledBackV1.activeVersionId).toBe(versionA1v1Id);

    const archived = await prisma.template.update({
      where: { id: templateA1Id },
      data: { isActive: false, archivedAt: new Date() },
    });
    expect(archived.isActive).toBe(false);
    expect(archived.archivedAt).not.toBeNull();

    // Prevent deleting a TemplateVersion still referenced by DesignJob / CreativeJobDispatch / activeVersion
    await expect(
      prisma.templateVersion.delete({ where: { id: versionA1v1Id } })
    ).rejects.toThrow();
    await expect(
      prisma.templateVersion.delete({ where: { id: versionA1v2Id } })
    ).rejects.toThrow();
  });

  it('Scenario A: serializes concurrent DesignJob template update behind in-flight CreativeJobDispatch insert and rejects mismatch', async () => {
    const connUrl = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
    const client1 = new PrismaClient({ datasources: { db: { url: connUrl } } });
    const client2 = new PrismaClient({ datasources: { db: { url: connUrl } } });

    const concJob = await prisma.designJob.create({
      data: {
        organisationId: orgAId,
        title: `Concurrency Scenario A ${runId}`,
        category: 'EVENT_ANNOUNCEMENT',
        templateId: templateA1Id,
        templateVersionId: versionA1v1Id,
      },
    });

    const dispatchInserted = createDeferred<number>();
    const waiterPidReady = createDeferred<number>();
    const allowDispatchCommit = createDeferred();
    let updateSettled = false;

    try {
      const tx1Promise = client1.$transaction(
        async (tx1) => {
          await tx1.$executeRawUnsafe(`SET LOCAL lock_timeout = '15s'`);
          const [{ pid: holderPid }] = await tx1.$queryRaw<Array<{ pid: number }>>`
            SELECT pg_backend_pid() AS pid
          `;
          const created = await tx1.creativeJobDispatch.create({
            data: {
              organisationId: orgAId,
              designJobId: concJob.id,
              templateVersionId: versionA1v1Id,
              requestedByUserId: userAId,
              idempotencyKey: `conc_a_disp_${runId}`,
              manifestJson: { manifestVersion: 1 },
            },
          });
          dispatchInserted.resolve(Number(holderPid));
          await allowDispatchCommit.promise;
          return created;
        },
        { maxWait: 15_000, timeout: 30_000 }
      );

      const holderPid = await dispatchInserted.promise;

      const tx2Promise = client2
        .$transaction(
          async (tx2) => {
            await tx2.$executeRawUnsafe(`SET LOCAL lock_timeout = '15s'`);
            const [{ pid: waiterPid }] = await tx2.$queryRaw<Array<{ pid: number }>>`
              SELECT pg_backend_pid() AS pid
            `;
            waiterPidReady.resolve(Number(waiterPid));
            return tx2.designJob.update({
              where: { id: concJob.id },
              data: {
                templateId: templateA2Id,
                templateVersionId: versionA2v1Id,
              },
            });
          },
          { maxWait: 15_000, timeout: 30_000 }
        )
        .finally(() => {
          updateSettled = true;
        });

      const tx2Rejection = expect(tx2Promise).rejects.toThrow(
        /conflicts with active CreativeJobDispatch/i
      );
      const waiterPid = await waiterPidReady.promise;
      expect(waiterPid).not.toBe(holderPid);

      // Deterministic verification: tx2's exact backend PID must be blocked by tx1's PID on design_jobs lock
      const lockEvidence = await waitForDesignJobsLockWait(
        prisma,
        { waiterPid, holderPid, expectedQueryFragment: 'design_jobs' },
        15_000
      );
      expect(lockEvidence.waiterPid).toBe(waiterPid);
      expect(lockEvidence.blockingPids).toContain(holderPid);
      expect(updateSettled).toBe(false);
      console.info(
        `[Scenario A] Verified lock wait: waiterPid=${lockEvidence.waiterPid} blocked by holderPid=${lockEvidence.holderPid} waitEvent=${lockEvidence.waitEvent}`
      );

      // Release tx1 so it commits the dispatch; tx2 then wakes up, sees committed dispatch, and must reject
      allowDispatchCommit.resolve();

      const [committedDispatch] = await Promise.all([tx1Promise, tx2Rejection]);
      expect(committedDispatch.templateVersionId).toBe(versionA1v1Id);

      // Verify committed DB state is strictly consistent
      const persistedJob = await prisma.designJob.findUniqueOrThrow({
        where: { id: concJob.id },
      });
      expect(persistedJob.templateId).toBe(templateA1Id);
      expect(persistedJob.templateVersionId).toBe(versionA1v1Id);

      const persistedDispatches = await prisma.creativeJobDispatch.findMany({
        where: { designJobId: concJob.id },
      });
      expect(persistedDispatches).toHaveLength(1);
      expect(persistedDispatches[0]?.templateVersionId).toBe(versionA1v1Id);

      // Preserve cancelled-dispatch handling: cancelling unlocks template change
      await prisma.creativeJobDispatch.update({
        where: { id: committedDispatch.id },
        data: { status: 'CANCELLED' },
      });
      const switchedAfterCancel = await prisma.designJob.update({
        where: { id: concJob.id },
        data: { templateId: templateA2Id, templateVersionId: versionA2v1Id },
      });
      expect(switchedAfterCancel.templateId).toBe(templateA2Id);
      expect(switchedAfterCancel.templateVersionId).toBe(versionA2v1Id);
    } finally {
      allowDispatchCommit.resolve();
      await Promise.allSettled([client1.$disconnect(), client2.$disconnect()]);
    }
  });

  it('Scenario B: blocks concurrent CreativeJobDispatch behind in-flight DesignJob template update and validates committed parent state', async () => {
    const connUrl = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
    const client1 = new PrismaClient({ datasources: { db: { url: connUrl } } });
    const client2 = new PrismaClient({ datasources: { db: { url: connUrl } } });

    const concJob = await prisma.designJob.create({
      data: {
        organisationId: orgAId,
        title: `Concurrency Scenario B ${runId}`,
        category: 'EVENT_ANNOUNCEMENT',
        templateId: templateA1Id,
        templateVersionId: versionA1v1Id,
      },
    });

    const templateUpdated = createDeferred<number>();
    const waiterPidReady = createDeferred<number>();
    const allowTemplateCommit = createDeferred();
    let dispatchSettled = false;

    try {
      const tx1Promise = client1.$transaction(
        async (tx1) => {
          await tx1.$executeRawUnsafe(`SET LOCAL lock_timeout = '15s'`);
          const [{ pid: holderPid }] = await tx1.$queryRaw<Array<{ pid: number }>>`
            SELECT pg_backend_pid() AS pid
          `;
          const updated = await tx1.designJob.update({
            where: { id: concJob.id },
            data: {
              templateId: templateA2Id,
              templateVersionId: versionA2v1Id,
            },
          });
          templateUpdated.resolve(Number(holderPid));
          await allowTemplateCommit.promise;
          return updated;
        },
        { maxWait: 15_000, timeout: 30_000 }
      );

      const holderPid = await templateUpdated.promise;

      const tx2Promise = client2
        .$transaction(
          async (tx2) => {
            await tx2.$executeRawUnsafe(`SET LOCAL lock_timeout = '15s'`);
            const [{ pid: waiterPid }] = await tx2.$queryRaw<Array<{ pid: number }>>`
              SELECT pg_backend_pid() AS pid
            `;
            waiterPidReady.resolve(Number(waiterPid));
            return tx2.creativeJobDispatch.create({
              data: {
                organisationId: orgAId,
                designJobId: concJob.id,
                // Deliberately references the PREVIOUS template version (T1 v1)
                templateVersionId: versionA1v1Id,
                requestedByUserId: userAId,
                idempotencyKey: `conc_b_disp_${runId}`,
                manifestJson: { manifestVersion: 1 },
              },
            });
          },
          { maxWait: 15_000, timeout: 30_000 }
        )
        .finally(() => {
          dispatchSettled = true;
        });

      const tx2Rejection = expect(tx2Promise).rejects.toThrow(/expected DesignJob template/i);
      const waiterPid = await waiterPidReady.promise;
      expect(waiterPid).not.toBe(holderPid);

      // Deterministic verification: tx2's exact backend PID must be blocked by tx1's PID on design_jobs lock
      const lockEvidence = await waitForDesignJobsLockWait(
        prisma,
        { waiterPid, holderPid, expectedQueryFragment: 'creative_job_dispatches' },
        15_000
      );
      expect(lockEvidence.waiterPid).toBe(waiterPid);
      expect(lockEvidence.blockingPids).toContain(holderPid);
      expect(dispatchSettled).toBe(false);
      console.info(
        `[Scenario B] Verified lock wait: waiterPid=${lockEvidence.waiterPid} blocked by holderPid=${lockEvidence.holderPid} waitEvent=${lockEvidence.waitEvent}`
      );

      // Commit tx1 (T2/v2); tx2 then wakes up, re-reads committed parent T2/v2, and must reject T1/v1 dispatch
      allowTemplateCommit.resolve();

      const [committedJob] = await Promise.all([tx1Promise, tx2Rejection]);
      expect(committedJob.templateId).toBe(templateA2Id);
      expect(committedJob.templateVersionId).toBe(versionA2v1Id);

      // Verify committed DB state is strictly consistent: T2/v2 with zero stale dispatches
      const persistedJob = await prisma.designJob.findUniqueOrThrow({
        where: { id: concJob.id },
      });
      expect(persistedJob.templateId).toBe(templateA2Id);
      expect(persistedJob.templateVersionId).toBe(versionA2v1Id);

      const persistedDispatches = await prisma.creativeJobDispatch.findMany({
        where: { designJobId: concJob.id },
      });
      expect(persistedDispatches).toHaveLength(0);

      // And a subsequent dispatch matching the newly committed T2/v2 succeeds cleanly
      const validDispatch = await prisma.creativeJobDispatch.create({
        data: {
          organisationId: orgAId,
          designJobId: concJob.id,
          templateVersionId: versionA2v1Id,
          requestedByUserId: userAId,
          idempotencyKey: `conc_b_valid_${runId}`,
          manifestJson: { manifestVersion: 1 },
        },
      });
      expect(validDispatch.templateVersionId).toBe(versionA2v1Id);
    } finally {
      allowTemplateCommit.resolve();
      await Promise.allSettled([client1.$disconnect(), client2.$disconnect()]);
    }
  });
});
