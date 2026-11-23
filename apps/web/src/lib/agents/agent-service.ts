/**
 * CRELUNE — Windows Creative Agent Registration, Heartbeat, Job Claim & Asset Streaming Service
 *
 * Implements Stage 5.5 backend endpoints for:
 * - Owner agent registration (one-time secret generation, SHA-256 hash persistence) & instant revocation
 * - Outbound agent heartbeat & capability reporting
 * - Atomic `FOR UPDATE SKIP LOCKED` job dispatch claiming with lease expiration recovery
 * - Idempotent status reporting integrated cleanly with `DesignJob` transitions
 * - Authorised pinned template master streaming (`crelune-dev-creative`)
 * - Strictly manifest-scoped read-only member photo streaming (`crelune-dev-member-photos`)
 * - Verified export upload intent & deliverable completion (`EXPORTED` never auto-publishes)
 */

import crypto from 'node:crypto';
import { Prisma, prisma } from '@crelune/database';
import {
  CREATIVE_BYTE_LIMITS,
  canTransitionCreativeDispatchStatus,
  canTransitionDesignJobStatus,
  creativeJobManifestSchema,
  type CreateExportRecordInput,
  type CreateExportUploadIntentInput,
  type CreativeAgentHeartbeatInput,
  type CreativeAgentSummary,
  type CreativeDispatchStatus,
  type CreativeJobDispatchSummary,
  type CreativeUploadIntentSummary,
  type DesignJobStatus,
  type ExportRecordSummary,
  type JobPrepManifest,
  type PresignedUploadTarget,
  type RegisterCreativeAgentInput,
  type RevokeCreativeAgentInput,
  type UpdateCreativeDispatchStatusInput,
} from '@crelune/shared';
import * as auditService from '@/lib/audit/audit-service';
import {
  constantTimeEqualHex,
  generateCreativeAgentToken,
  hashAgentSecret,
  type AuthenticatedCreativeAgent,
} from '@/lib/agents/agent-auth';
import {
  completeExportDeliverableUpload,
  createExportDeliverableUploadIntent,
  DispatchNotFoundError,
  JobPreparationConflictError,
  type JobPreparationServiceDependencies,
} from '@/lib/designs/job-preparation-service';
import {
  createCreativeObjectStorageProvider,
  type CreativeObjectStorageProvider,
} from '@/lib/storage/creative-storage';
import {
  createObjectStorageProvider,
  type ObjectStorageProvider,
} from '@/lib/storage/object-storage';
import {
  assertKeyMatchesMemberScope,
  assertKeyMatchesTemplateMasterScope,
} from '@/lib/storage/storage-config';

const AGENT_TX_OPTIONS = {
  maxWait: 10_000,
  timeout: 15_000,
} as const;

export const AGENT_DISPATCH_LEASE_MS = 15 * 60 * 1000; // 15 minutes

export class CreativeAgentNotFoundError extends Error {
  constructor() {
    super('Creative agent not found.');
    this.name = 'CreativeAgentNotFoundError';
  }
}

export class CreativeAgentForbiddenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CreativeAgentForbiddenError';
  }
}

export class CreativeAgentAssetNotFoundError extends Error {
  constructor(message: string = 'Authorised asset not found for this dispatch.') {
    super(message);
    this.name = 'CreativeAgentAssetNotFoundError';
  }
}

export interface AgentServiceDependencies extends JobPreparationServiceDependencies {
  creativeStorage?: CreativeObjectStorageProvider;
  memberPhotoStorage?: ObjectStorageProvider;
}

const AGENT_SUMMARY_SELECT = {
  id: true,
  name: true,
  machineLabel: true,
  tokenPrefix: true,
  status: true,
  agentVersion: true,
  affinityVersion: true,
  lastHeartbeatAt: true,
  revokedAt: true,
  revocationReason: true,
  createdAt: true,
} satisfies Prisma.CreativeAgentSelect;

type SelectedAgentRow = Prisma.CreativeAgentGetPayload<{
  select: typeof AGENT_SUMMARY_SELECT;
}>;

function mapAgentSummary(row: SelectedAgentRow): CreativeAgentSummary {
  return {
    id: row.id,
    name: row.name,
    machineLabel: row.machineLabel,
    tokenPrefix: row.tokenPrefix,
    status: row.status,
    agentVersion: row.agentVersion ?? null,
    affinityVersion: row.affinityVersion ?? null,
    lastHeartbeatAt: row.lastHeartbeatAt
      ? row.lastHeartbeatAt.toISOString()
      : null,
    revokedAt: row.revokedAt ? row.revokedAt.toISOString() : null,
    revocationReason: row.revocationReason ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

function mapDispatchRow(row: {
  id: string;
  designJobId: string;
  templateVersionId: string;
  assignedAgentId: string | null;
  manifestVersion: number;
  status: string;
  claimedAt: Date | null;
  readyForArtistAt: Date | null;
  completedAt: Date | null;
  failedAt: Date | null;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: Date;
  updatedAt: Date;
}): CreativeJobDispatchSummary {
  return {
    id: row.id,
    designJobId: row.designJobId,
    templateVersionId: row.templateVersionId,
    assignedAgentId: row.assignedAgentId,
    manifestVersion: row.manifestVersion,
    status: row.status as CreativeDispatchStatus,
    claimedAt: row.claimedAt ? row.claimedAt.toISOString() : null,
    readyForArtistAt: row.readyForArtistAt
      ? row.readyForArtistAt.toISOString()
      : null,
    completedAt: row.completedAt ? row.completedAt.toISOString() : null,
    failedAt: row.failedAt ? row.failedAt.toISOString() : null,
    errorCode: row.errorCode,
    errorMessage: row.errorMessage,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

// =============================================================================
// OWNER MANAGEMENT OPERATIONS
// =============================================================================

export async function listCreativeAgents(
  organisationId: string
): Promise<CreativeAgentSummary[]> {
  const rows = await prisma.creativeAgent.findMany({
    where: { organisationId },
    orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
    select: AGENT_SUMMARY_SELECT,
  });
  return rows.map(mapAgentSummary);
}

export async function registerCreativeAgent(
  actor: { userId: string; organisationId: string },
  input: RegisterCreativeAgentInput
): Promise<{ agent: CreativeAgentSummary; oneTimeToken: string }> {
  const { rawToken, tokenHash, tokenPrefix } = generateCreativeAgentToken();

  const created = await prisma.$transaction(async (tx) => {
    const row = await tx.creativeAgent.create({
      data: {
        organisationId: actor.organisationId,
        registeredByUserId: actor.userId,
        name: input.name,
        machineLabel: input.machineLabel,
        tokenHash,
        tokenPrefix,
        status: 'ACTIVE',
      },
      select: AGENT_SUMMARY_SELECT,
    });

    await auditService.recordAuditEvent(tx, {
      organisationId: actor.organisationId,
      actorUserId: actor.userId,
      action: auditService.AUDIT_ACTIONS.CREATIVE_AGENT_REGISTERED,
      entityType: 'CreativeAgent',
      entityId: row.id,
      metadata: {
        machineLabel: input.machineLabel,
        tokenPrefix,
      },
    });

    return row;
  }, AGENT_TX_OPTIONS);

  return {
    agent: mapAgentSummary(created),
    oneTimeToken: rawToken,
  };
}

export async function revokeCreativeAgent(
  actor: { userId: string; organisationId: string },
  agentId: string,
  input: RevokeCreativeAgentInput
): Promise<CreativeAgentSummary> {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.creativeAgent.findFirst({
      where: { id: agentId, organisationId: actor.organisationId },
      select: { id: true, status: true },
    });
    if (!existing) {
      throw new CreativeAgentNotFoundError();
    }

    const now = new Date();
    const updated = await tx.creativeAgent.update({
      where: { id: existing.id },
      data: {
        status: 'REVOKED',
        revokedAt: now,
        revokedByUserId: actor.userId,
        revocationReason: input.reason,
      },
      select: AGENT_SUMMARY_SELECT,
    });

    // Release any uncompleted claimed dispatches held by this revoked agent back to QUEUED
    await tx.creativeJobDispatch.updateMany({
      where: {
        organisationId: actor.organisationId,
        assignedAgentId: existing.id,
        status: { in: ['CLAIMED', 'DOWNLOADING_ASSETS'] },
      },
      data: {
        status: 'QUEUED',
        assignedAgentId: null,
        claimTokenHash: null,
        leaseExpiresAt: null,
      },
    });

    await auditService.recordAuditEvent(tx, {
      organisationId: actor.organisationId,
      actorUserId: actor.userId,
      action: auditService.AUDIT_ACTIONS.CREATIVE_AGENT_REVOKED,
      entityType: 'CreativeAgent',
      entityId: existing.id,
      metadata: {
        previousStatus: existing.status,
      },
    });

    return mapAgentSummary(updated);
  }, AGENT_TX_OPTIONS);
}

// =============================================================================
// OUTBOUND MACHINE AGENT OPERATIONS
// =============================================================================

export async function recordAgentHeartbeat(
  agent: AuthenticatedCreativeAgent,
  input: CreativeAgentHeartbeatInput,
  deps: AgentServiceDependencies = {}
): Promise<CreativeAgentSummary> {
  const now = (deps.now ?? (() => new Date()))();
  const updated = await prisma.creativeAgent.update({
    where: { id: agent.id },
    data: {
      agentVersion: input.agentVersion,
      affinityVersion: input.affinityVersion ?? null,
      capabilitiesJson: {
        supportedFormats: input.supportedFormats,
        ...input.capabilities,
      } as Prisma.InputJsonValue,
      lastHeartbeatAt: now,
    },
    select: AGENT_SUMMARY_SELECT,
  });

  return mapAgentSummary(updated);
}

export async function claimNextCreativeDispatch(
  agent: AuthenticatedCreativeAgent,
  deps: AgentServiceDependencies = {}
): Promise<
  | {
      dispatch: CreativeJobDispatchSummary;
      manifest: JobPrepManifest;
      claimToken: string;
      leaseExpiresAt: string;
    }
  | { dispatch: null }
> {
  const now = (deps.now ?? (() => new Date()))();
  const leaseExpiresAt = new Date(now.getTime() + AGENT_DISPATCH_LEASE_MS);
  const claimToken = `clm_${crypto.randomBytes(24).toString('hex')}`;
  const claimTokenHash = hashAgentSecret(claimToken);

  return prisma.$transaction(async (tx) => {
    const candidates = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id
      FROM creative_job_dispatches
      WHERE organisation_id = ${agent.organisationId}
        AND (
          (status = 'QUEUED' AND (assigned_agent_id IS NULL OR assigned_agent_id = ${agent.id}))
          OR (status = 'CLAIMED' AND lease_expires_at IS NOT NULL AND lease_expires_at <= ${now})
        )
      ORDER BY created_at ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    `;

    const candidate = candidates[0];
    if (!candidate) {
      return { dispatch: null };
    }

    const claimed = await tx.creativeJobDispatch.update({
      where: { id: candidate.id },
      data: {
        status: 'CLAIMED',
        assignedAgentId: agent.id,
        claimTokenHash,
        claimedAt: now,
        leaseExpiresAt,
      },
    });

    const manifest = creativeJobManifestSchema.parse(claimed.manifestJson);

    await auditService.recordAuditEvent(tx, {
      organisationId: agent.organisationId,
      actorUserId: null,
      action: auditService.AUDIT_ACTIONS.CREATIVE_DISPATCH_CLAIMED,
      entityType: 'CreativeJobDispatch',
      entityId: claimed.id,
      metadata: {
        designJobId: claimed.designJobId,
        agentId: agent.id,
      },
    });

    return {
      dispatch: mapDispatchRow(claimed),
      manifest,
      claimToken,
      leaseExpiresAt: leaseExpiresAt.toISOString(),
    };
  }, AGENT_TX_OPTIONS);
}

async function assertAgentOwnsActiveDispatch(
  tx: Prisma.TransactionClient | typeof prisma,
  agent: AuthenticatedCreativeAgent,
  dispatchId: string,
  claimToken?: string
) {
  const dispatch = await tx.creativeJobDispatch.findFirst({
    where: {
      id: dispatchId,
      organisationId: agent.organisationId,
    },
  });
  if (!dispatch) {
    throw new DispatchNotFoundError();
  }
  if (dispatch.assignedAgentId !== agent.id) {
    throw new CreativeAgentForbiddenError(
      'Creative job dispatch is not assigned to this agent.'
    );
  }
  if (
    dispatch.claimTokenHash &&
    claimToken &&
    !constantTimeEqualHex(hashAgentSecret(claimToken), dispatch.claimTokenHash)
  ) {
    throw new CreativeAgentForbiddenError(
      'Creative job dispatch claim token mismatch.'
    );
  }
  return dispatch;
}

export async function updateAgentDispatchStatus(
  agent: AuthenticatedCreativeAgent,
  dispatchId: string,
  input: UpdateCreativeDispatchStatusInput,
  deps: AgentServiceDependencies = {}
): Promise<{ dispatch: CreativeJobDispatchSummary; idempotentReplay: boolean }> {
  const now = (deps.now ?? (() => new Date()))();
  const nextLease = new Date(now.getTime() + AGENT_DISPATCH_LEASE_MS);

  return prisma.$transaction(async (tx) => {
    const dispatch = await assertAgentOwnsActiveDispatch(
      tx,
      agent,
      dispatchId,
      input.claimToken
    );

    const currentStatus = dispatch.status as CreativeDispatchStatus;
    if (currentStatus === input.status) {
      return {
        dispatch: mapDispatchRow(dispatch),
        idempotentReplay: true,
      };
    }

    if (!canTransitionCreativeDispatchStatus(currentStatus, input.status)) {
      throw new JobPreparationConflictError(
        `Cannot transition dispatch from ${currentStatus} to ${input.status}.`,
        'INVALID_DISPATCH_TRANSITION'
      );
    }

    const updateData: Prisma.CreativeJobDispatchUpdateInput = {
      status: input.status,
    };

    if (
      input.status === 'DOWNLOADING_ASSETS' ||
      input.status === 'OPENING_TEMPLATE' ||
      input.status === 'READY_FOR_ARTIST' ||
      input.status === 'EXPORTING'
    ) {
      updateData.leaseExpiresAt = nextLease;
    }
    if (input.status === 'READY_FOR_ARTIST') {
      updateData.readyForArtistAt = dispatch.readyForArtistAt ?? now;
    }
    if (input.status === 'EXPORTED') {
      updateData.completedAt = now;
      updateData.leaseExpiresAt = null;
    }
    if (input.status === 'FAILED') {
      updateData.failedAt = now;
      updateData.errorCode = input.errorCode ?? 'AGENT_PROCESSING_FAILED';
      updateData.errorMessage = input.errorMessage ?? 'Agent reported job failure.';
      updateData.claimTokenHash = null;
      updateData.leaseExpiresAt = null;
    }
    if (input.status === 'CANCELLED') {
      updateData.claimTokenHash = null;
      updateData.leaseExpiresAt = null;
      updateData.errorCode = input.errorCode ?? 'AGENT_CANCELLED';
      updateData.errorMessage = input.errorMessage ?? null;
    }

    const updated = await tx.creativeJobDispatch.update({
      where: { id: dispatch.id },
      data: updateData,
    });

    // Advance DesignJob PENDING -> IN_PROGRESS when the agent begins workspace preparation
    if (
      input.status === 'DOWNLOADING_ASSETS' ||
      input.status === 'OPENING_TEMPLATE' ||
      input.status === 'READY_FOR_ARTIST'
    ) {
      const parentJob = await tx.designJob.findFirst({
        where: { id: dispatch.designJobId, organisationId: agent.organisationId },
        select: { id: true, status: true },
      });
      if (
        parentJob &&
        parentJob.status === 'PENDING' &&
        canTransitionDesignJobStatus(
          parentJob.status as DesignJobStatus,
          'IN_PROGRESS'
        )
      ) {
        await tx.designJob.update({
          where: { id: parentJob.id },
          data: { status: 'IN_PROGRESS' },
        });
        await tx.designJobHistory.create({
          data: {
            organisationId: agent.organisationId,
            designJobId: parentJob.id,
            previousStatus: 'PENDING',
            newStatus: 'IN_PROGRESS',
            note: `Windows Creative Agent "${agent.name}" prepared isolated workspace (mode: ${input.executionMode ?? 'ASSISTED'}).`,
            changedByUserId: null,
          },
        });
      }
    }

    await auditService.recordAuditEvent(tx, {
      organisationId: agent.organisationId,
      actorUserId: null,
      action: auditService.AUDIT_ACTIONS.CREATIVE_DISPATCH_STATUS_CHANGED,
      entityType: 'CreativeJobDispatch',
      entityId: dispatch.id,
      metadata: {
        designJobId: dispatch.designJobId,
        agentId: agent.id,
        previousStatus: currentStatus,
        newStatus: input.status,
        executionMode: input.executionMode ?? 'ASSISTED',
      },
    });

    return {
      dispatch: mapDispatchRow(updated),
      idempotentReplay: false,
    };
  }, AGENT_TX_OPTIONS);
}

export async function streamAgentDispatchTemplateMaster(
  agent: AuthenticatedCreativeAgent,
  dispatchId: string,
  deps: AgentServiceDependencies = {}
): Promise<{
  body: Uint8Array;
  mimeType: string;
  byteSize: number;
  sha256: string;
  filename: string;
}> {
  const creativeStorage =
    deps.creativeStorage ?? deps.storage ?? createCreativeObjectStorageProvider();

  const dispatch = await assertAgentOwnsActiveDispatch(prisma, agent, dispatchId);
  if (dispatch.status === 'CANCELLED' || dispatch.status === 'FAILED') {
    throw new JobPreparationConflictError(
      `Cannot download template master for a ${dispatch.status} dispatch.`,
      'DISPATCH_TERMINAL'
    );
  }

  const version = await prisma.templateVersion.findFirst({
    where: {
      id: dispatch.templateVersionId,
      organisationId: agent.organisationId,
    },
    select: {
      id: true,
      templateId: true,
      versionNumber: true,
      format: true,
      storageBucket: true,
      storageKey: true,
      originalFilename: true,
      mimeType: true,
      sha256: true,
    },
  });
  if (!version) {
    throw new CreativeAgentAssetNotFoundError('Pinned template version not found.');
  }
  if (version.storageBucket !== creativeStorage.bucket) {
    throw new CreativeAgentForbiddenError('Storage bucket configuration mismatch.');
  }

  assertKeyMatchesTemplateMasterScope(version.storageKey, {
    envPrefix: creativeStorage.envPrefix,
    organisationId: agent.organisationId,
    templateId: version.templateId,
    versionNumber: version.versionNumber,
  });

  const obj = await creativeStorage.getObjectBounded(
    version.storageKey,
    CREATIVE_BYTE_LIMITS.TEMPLATE_MASTER_MAX_BYTES
  );
  const actualSha = crypto.createHash('sha256').update(obj.body).digest('hex');
  if (actualSha !== version.sha256) {
    throw new Error('Template master SHA-256 integrity verification failed.');
  }

  return {
    body: obj.body,
    mimeType: version.mimeType,
    byteSize: obj.body.byteLength,
    sha256: actualSha,
    filename: version.originalFilename,
  };
}

export async function streamAgentDispatchAsset(
  agent: AuthenticatedCreativeAgent,
  dispatchId: string,
  assetId: string,
  deps: AgentServiceDependencies = {}
): Promise<{
  body: Uint8Array;
  mimeType: string;
  byteSize: number;
  sha256: string;
}> {
  const dispatch = await assertAgentOwnsActiveDispatch(prisma, agent, dispatchId);
  if (dispatch.status === 'CANCELLED' || dispatch.status === 'FAILED') {
    throw new JobPreparationConflictError(
      `Cannot download assets for a ${dispatch.status} dispatch.`,
      'DISPATCH_TERMINAL'
    );
  }

  const manifest = creativeJobManifestSchema.parse(dispatch.manifestJson);
  const matchingField = manifest.fields.find(
    (f) => f.assetReference && f.assetReference.assetId === assetId
  );
  if (!matchingField || !matchingField.assetReference) {
    throw new CreativeAgentForbiddenError(
      'Requested asset is not authorised in this job manifest.'
    );
  }

  if (matchingField.assetReference.assetKind === 'MEMBER_PHOTO') {
    const memberPhotoStorage =
      deps.memberPhotoStorage ?? createObjectStorageProvider();
    const member = await prisma.member.findFirst({
      where: {
        id: assetId,
        organisationId: agent.organisationId,
      },
      select: {
        id: true,
        photoStorageKey: true,
        photoMimeType: true,
      },
    });
    if (!member || !member.photoStorageKey || !member.photoMimeType) {
      throw new CreativeAgentAssetNotFoundError('Linked member photograph not found.');
    }

    assertKeyMatchesMemberScope(member.photoStorageKey, {
      envPrefix: memberPhotoStorage.envPrefix,
      organisationId: agent.organisationId,
      memberId: member.id,
    });

    // Strictly READ-ONLY access to member-photo storage for the authorised job
    const obj = await memberPhotoStorage.getObject(member.photoStorageKey);
    const sha256 = crypto.createHash('sha256').update(obj.body).digest('hex');
    return {
      body: obj.body,
      mimeType: member.photoMimeType,
      byteSize: obj.body.byteLength,
      sha256,
    };
  }

  throw new CreativeAgentAssetNotFoundError('Unsupported asset kind.');
}

export async function createAgentExportUploadIntent(
  agent: AuthenticatedCreativeAgent,
  dispatchId: string,
  input: CreateExportUploadIntentInput,
  deps: AgentServiceDependencies = {}
): Promise<{
  intent: CreativeUploadIntentSummary;
  upload: PresignedUploadTarget;
}> {
  const dispatch = await assertAgentOwnsActiveDispatch(prisma, agent, dispatchId);
  if (dispatch.status === 'CANCELLED' || dispatch.status === 'FAILED') {
    throw new JobPreparationConflictError(
      `Cannot upload exports for a ${dispatch.status} dispatch.`,
      'DISPATCH_TERMINAL'
    );
  }

  return createExportDeliverableUploadIntent(
    {
      organisationId: agent.organisationId,
      agentId: agent.id,
    },
    {
      ...input,
      designJobId: dispatch.designJobId,
      dispatchId: dispatch.id,
    },
    deps
  );
}

export async function completeAgentExportUpload(
  agent: AuthenticatedCreativeAgent,
  dispatchId: string,
  input: CreateExportRecordInput,
  deps: AgentServiceDependencies = {}
): Promise<{ exportRecord: ExportRecordSummary; idempotentReplay: boolean }> {
  const dispatch = await assertAgentOwnsActiveDispatch(prisma, agent, dispatchId);
  if (dispatch.status === 'CANCELLED' || dispatch.status === 'FAILED') {
    throw new JobPreparationConflictError(
      `Cannot register exports for a ${dispatch.status} dispatch.`,
      'DISPATCH_TERMINAL'
    );
  }

  return completeExportDeliverableUpload(
    {
      organisationId: agent.organisationId,
      agentId: agent.id,
    },
    {
      ...input,
      designJobId: dispatch.designJobId,
      dispatchId: dispatch.id,
    },
    deps
  );
}
