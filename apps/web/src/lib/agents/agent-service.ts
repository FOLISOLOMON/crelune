/**
 * CRELUNE — Windows Creative Agent Registration, Heartbeat, Job Claim, Lease Recovery & Asset Streaming Service
 *
 * Implements Stage 5.5 + 5.5.1 + 5.5.2 hardened backend operations:
 * - Canonical Deadlock-Free Lock Order across all database transactions:
 *     L0: `creative_agents` (`FOR UPDATE` on revocation; `FOR SHARE` on agent claim/status/lease/export)
 *     L1: `design_jobs` (`FOR UPDATE`, ordered by `id ASC` when multiple)
 *     L2: `creative_job_dispatches` (`FOR UPDATE`, ordered by `id ASC` when multiple)
 *     L3: `creative_upload_intents` (atomic conditional consumption)
 * - Mandatory `X-Crelune-Dispatch-Claim` fencing verified in constant time on EVERY dispatch-scoped machine operation
 *   AND independently re-verified inside the final atomic export-registration transaction (closing the TOCTOU window).
 * - Explicit per-state recovery policy on lease expiry & agent revocation (`READY_FOR_ARTIST` preserved for owner intervention).
 * - Strictly manifest-scoped read-only `MEMBER_PHOTO` streaming (`WORKING_ASSET` rejected until Milestone 8).
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
  generateDispatchClaimToken,
  hashAgentSecret,
  isValidDispatchClaimToken,
  type AuthenticatedCreativeAgent,
} from '@/lib/agents/agent-auth';
import {
  CreativeAgentAssetNotFoundError,
  CreativeAgentClaimError,
  CreativeAgentForbiddenError,
  CreativeAgentNotFoundError,
  CreativeAgentRevokedError,
  CreativeAgentUnsupportedAssetError,
  type CreativeAgentClaimErrorCode,
} from '@/lib/agents/agent-errors';
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

export {
  CreativeAgentAssetNotFoundError,
  CreativeAgentClaimError,
  CreativeAgentForbiddenError,
  CreativeAgentNotFoundError,
  CreativeAgentRevokedError,
  CreativeAgentUnsupportedAssetError,
  type CreativeAgentClaimErrorCode,
};

const AGENT_TX_OPTIONS = {
  maxWait: 10_000,
  timeout: 15_000,
} as const;

export const AGENT_DISPATCH_LEASE_MS = 15 * 60 * 1000; // 15 minutes

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

function mapDispatchRow(
  row: {
    id: string;
    designJobId: string;
    templateVersionId: string;
    assignedAgentId: string | null;
    manifestVersion: number;
    status: string;
    claimedAt: Date | null;
    leaseExpiresAt: Date | null;
    readyForArtistAt: Date | null;
    completedAt: Date | null;
    failedAt: Date | null;
    errorCode: string | null;
    errorMessage: string | null;
    createdAt: Date;
    updatedAt: Date;
  },
  now: Date = new Date()
): CreativeJobDispatchSummary {
  const status = row.status as CreativeDispatchStatus;
  let requiresOwnerIntervention = false;
  let interventionReason: string | null = null;

  if (status === 'READY_FOR_ARTIST') {
    if (row.errorCode === 'AGENT_REVOKED_INTERVENTION_REQUIRED') {
      requiresOwnerIntervention = true;
      interventionReason =
        row.errorMessage ??
        'Assigned agent was revoked while artist edits may be in progress. Review local work and either upload export manually, cancel, or explicitly release for recovery.';
    } else if (!row.leaseExpiresAt || row.leaseExpiresAt <= now) {
      requiresOwnerIntervention = true;
      interventionReason =
        'Artist workspace lease expired. Existing local edits are preserved and will not be overwritten automatically; upload export manually, cancel, or explicitly release for recovery.';
    }
  }

  return {
    id: row.id,
    designJobId: row.designJobId,
    templateVersionId: row.templateVersionId,
    assignedAgentId: row.assignedAgentId,
    manifestVersion: row.manifestVersion,
    status,
    claimedAt: row.claimedAt ? row.claimedAt.toISOString() : null,
    leaseExpiresAt: row.leaseExpiresAt ? row.leaseExpiresAt.toISOString() : null,
    readyForArtistAt: row.readyForArtistAt
      ? row.readyForArtistAt.toISOString()
      : null,
    completedAt: row.completedAt ? row.completedAt.toISOString() : null,
    failedAt: row.failedAt ? row.failedAt.toISOString() : null,
    errorCode: row.errorCode,
    errorMessage: row.errorMessage,
    requiresOwnerIntervention,
    interventionReason,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * L0 lock helper: acquires `FOR SHARE` on the agent row inside an active
 * transaction and fails closed with `CreativeAgentRevokedError` (401) if
 * the agent has been revoked concurrently.
 */
async function lockAndVerifyActiveAgentShare(
  tx: Prisma.TransactionClient,
  agent: AuthenticatedCreativeAgent
): Promise<void> {
  const rows = await tx.$queryRaw<
    Array<{ id: string; status: string; revoked_at: Date | null }>
  >`
    SELECT id, status, revoked_at
    FROM creative_agents
    WHERE id = ${agent.id}
      AND organisation_id = ${agent.organisationId}
    FOR SHARE
  `;
  const row = rows[0];
  if (!row || row.status !== 'ACTIVE' || row.revoked_at !== null) {
    throw new CreativeAgentRevokedError();
  }
}

async function lookupDispatchParentJobId(
  organisationId: string,
  dispatchId: string
): Promise<string> {
  const row = await prisma.creativeJobDispatch.findFirst({
    where: { id: dispatchId, organisationId },
    select: { designJobId: true },
  });
  if (!row) {
    throw new DispatchNotFoundError();
  }
  return row.designJobId;
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
  input: RevokeCreativeAgentInput,
  deps: AgentServiceDependencies = {}
): Promise<CreativeAgentSummary> {
  const now = (deps.now ?? (() => new Date()))();

  return prisma.$transaction(async (tx) => {
    // Canonical lock order: L0 (creative_agents FOR UPDATE) -> L1 (design_jobs) -> L2 (creative_job_dispatches)
    const lockedAgentRows = await tx.$queryRaw<
      Array<{ id: string; status: string }>
    >`
      SELECT id, status
      FROM creative_agents
      WHERE id = ${agentId}
        AND organisation_id = ${actor.organisationId}
      FOR UPDATE
    `;
    const existing = lockedAgentRows[0];
    if (!existing) {
      throw new CreativeAgentNotFoundError();
    }

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

    // L1: Lock affected parent design_jobs in deterministic ascending ID order BEFORE locking dispatches
    // so the Stage 5.1.2 BEFORE UPDATE OF status trigger on creative_job_dispatches never inverts lock order.
    await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id
      FROM design_jobs
      WHERE organisation_id = ${actor.organisationId}
        AND id IN (
          SELECT DISTINCT design_job_id
          FROM creative_job_dispatches
          WHERE organisation_id = ${actor.organisationId}
            AND assigned_agent_id = ${existing.id}
            AND status IN ('QUEUED', 'CLAIMED', 'DOWNLOADING_ASSETS', 'OPENING_TEMPLATE', 'EXPORTING', 'READY_FOR_ARTIST')
        )
      ORDER BY id ASC
      FOR UPDATE
    `;

    // L2: Lock all active dispatches currently assigned to this revoked agent in ascending ID order
    const activeDispatches = await tx.$queryRaw<
      Array<{ id: string; design_job_id: string; status: string }>
    >`
      SELECT id, design_job_id, status
      FROM creative_job_dispatches
      WHERE organisation_id = ${actor.organisationId}
        AND assigned_agent_id = ${existing.id}
        AND status IN ('QUEUED', 'CLAIMED', 'DOWNLOADING_ASSETS', 'OPENING_TEMPLATE', 'EXPORTING', 'READY_FOR_ARTIST')
      ORDER BY id ASC
      FOR UPDATE
    `;

    let requeuedCount = 0;
    let interventionCount = 0;

    for (const disp of activeDispatches) {
      if (disp.status === 'READY_FOR_ARTIST') {
        // NEVER silently destroy or reassign artist work in READY_FOR_ARTIST!
        await tx.creativeJobDispatch.update({
          where: { id: disp.id },
          data: {
            claimTokenHash: null,
            leaseExpiresAt: null,
            errorCode: 'AGENT_REVOKED_INTERVENTION_REQUIRED',
            errorMessage:
              'Assigned agent was revoked while artist edits may be in progress. Review local work and either upload export manually, cancel, or explicitly release for recovery.',
          },
        });
        await auditService.recordAuditEvent(tx, {
          organisationId: actor.organisationId,
          actorUserId: actor.userId,
          action: auditService.AUDIT_ACTIONS.CREATIVE_DISPATCH_INTERVENTION_REQUIRED,
          entityType: 'CreativeJobDispatch',
          entityId: disp.id,
          metadata: {
            designJobId: disp.design_job_id,
            revokedAgentId: existing.id,
            preservedStatus: 'READY_FOR_ARTIST',
          },
        });
        interventionCount += 1;
      } else if (disp.status === 'QUEUED') {
        await tx.creativeJobDispatch.update({
          where: { id: disp.id },
          data: {
            assignedAgentId: null,
            claimTokenHash: null,
            leaseExpiresAt: null,
          },
        });
      } else {
        // Auto-recoverable processing states: CLAIMED, DOWNLOADING_ASSETS, OPENING_TEMPLATE, EXPORTING
        await tx.creativeJobDispatch.update({
          where: { id: disp.id },
          data: {
            status: 'QUEUED',
            assignedAgentId: null,
            claimTokenHash: null,
            leaseExpiresAt: null,
            errorCode: null,
            errorMessage: null,
          },
        });
        await auditService.recordAuditEvent(tx, {
          organisationId: actor.organisationId,
          actorUserId: actor.userId,
          action: auditService.AUDIT_ACTIONS.CREATIVE_DISPATCH_RECOVERED,
          entityType: 'CreativeJobDispatch',
          entityId: disp.id,
          metadata: {
            designJobId: disp.design_job_id,
            previousStatus: disp.status,
            previousAgentId: existing.id,
            recoveryType: 'AGENT_REVOCATION_REQUEUE',
          },
        });
        requeuedCount += 1;
      }
    }

    await auditService.recordAuditEvent(tx, {
      organisationId: actor.organisationId,
      actorUserId: actor.userId,
      action: auditService.AUDIT_ACTIONS.CREATIVE_AGENT_REVOKED,
      entityType: 'CreativeAgent',
      entityId: existing.id,
      metadata: {
        previousStatus: existing.status,
        requeuedDispatches: requeuedCount,
        interventionRequiredDispatches: interventionCount,
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

/**
 * Atomically claims the next QUEUED dispatch OR recovers an expired dispatch in
 * an auto-recoverable processing state (`CLAIMED`, `DOWNLOADING_ASSETS`,
 * `OPENING_TEMPLATE`, `EXPORTING`) using canonical lock order:
 * L0 (`creative_agents FOR SHARE`) -> L1+L2 (`FOR UPDATE OF j, d SKIP LOCKED`).
 */
export async function claimNextCreativeDispatch(
  agent: AuthenticatedCreativeAgent,
  deps: AgentServiceDependencies = {}
): Promise<
  | {
      dispatch: CreativeJobDispatchSummary;
      manifest: JobPrepManifest;
      claimToken: string;
      leaseExpiresAt: string;
      recoveredFromStatus: CreativeDispatchStatus | null;
    }
  | { dispatch: null }
> {
  const now = (deps.now ?? (() => new Date()))();
  const leaseExpiresAt = new Date(now.getTime() + AGENT_DISPATCH_LEASE_MS);
  const { claimToken, claimTokenHash } = generateDispatchClaimToken();

  return prisma.$transaction(async (tx) => {
    // L0: Verify agent is still ACTIVE under FOR SHARE
    await lockAndVerifyActiveAgentShare(tx, agent);

    // L1 + L2: Non-blocking SKIP LOCKED on parent design_jobs (j) and candidate dispatch (d)
    const candidates = await tx.$queryRaw<
      Array<{ id: string; status: string; assigned_agent_id: string | null }>
    >`
      SELECT d.id, d.status, d.assigned_agent_id
      FROM creative_job_dispatches d
      JOIN design_jobs j
        ON j.id = d.design_job_id
       AND j.organisation_id = d.organisation_id
      WHERE d.organisation_id = ${agent.organisationId}
        AND (
          (d.status = 'QUEUED' AND (d.assigned_agent_id IS NULL OR d.assigned_agent_id = ${agent.id}))
          OR (
            d.status IN ('CLAIMED', 'DOWNLOADING_ASSETS', 'OPENING_TEMPLATE', 'EXPORTING')
            AND d.lease_expires_at IS NOT NULL
            AND d.lease_expires_at <= ${now}
          )
        )
      ORDER BY d.created_at ASC
      FOR UPDATE OF j, d SKIP LOCKED
      LIMIT 1
    `;

    const candidate = candidates[0];
    if (!candidate) {
      return { dispatch: null };
    }

    const wasExpiredRecovery = candidate.status !== 'QUEUED';
    const claimed = await tx.creativeJobDispatch.update({
      where: { id: candidate.id },
      data: {
        status: 'CLAIMED',
        assignedAgentId: agent.id,
        claimTokenHash,
        claimedAt: now,
        leaseExpiresAt,
        errorCode: null,
        errorMessage: null,
      },
    });

    const manifest = creativeJobManifestSchema.parse(claimed.manifestJson);

    if (wasExpiredRecovery) {
      await auditService.recordAuditEvent(tx, {
        organisationId: agent.organisationId,
        actorUserId: null,
        action: auditService.AUDIT_ACTIONS.CREATIVE_DISPATCH_RECOVERED,
        entityType: 'CreativeJobDispatch',
        entityId: claimed.id,
        metadata: {
          designJobId: claimed.designJobId,
          previousStatus: candidate.status,
          previousAgentId: candidate.assigned_agent_id,
          recoveredByAgentId: agent.id,
          recoveryType: 'LEASE_EXPIRY',
        },
      });
    }

    await auditService.recordAuditEvent(tx, {
      organisationId: agent.organisationId,
      actorUserId: null,
      action: auditService.AUDIT_ACTIONS.CREATIVE_DISPATCH_CLAIMED,
      entityType: 'CreativeJobDispatch',
      entityId: claimed.id,
      metadata: {
        designJobId: claimed.designJobId,
        agentId: agent.id,
        recoveredFromLeaseExpiry: wasExpiredRecovery,
      },
    });

    return {
      dispatch: mapDispatchRow(claimed, now),
      manifest,
      claimToken,
      leaseExpiresAt: leaseExpiresAt.toISOString(),
      recoveredFromStatus: wasExpiredRecovery
        ? (candidate.status as CreativeDispatchStatus)
        : null,
    };
  }, AGENT_TX_OPTIONS);
}

/**
 * Mandatory dispatch claim fencing check enforced on EVERY dispatch-scoped
 * machine operation. Validates token format, ownership, constant-time SHA-256
 * hash equality against `claimTokenHash`, non-terminal status, and unexpired lease.
 */
async function assertAgentOwnsActiveDispatch(
  tx: Prisma.TransactionClient | typeof prisma,
  agent: AuthenticatedCreativeAgent,
  dispatchId: string,
  claimToken: string,
  now: Date
) {
  if (!claimToken || !isValidDispatchClaimToken(claimToken)) {
    throw new CreativeAgentClaimError(
      'Missing or malformed dispatch claim token.',
      'DISPATCH_CLAIM_INVALID'
    );
  }

  const dispatch = await tx.creativeJobDispatch.findFirst({
    where: {
      id: dispatchId,
      organisationId: agent.organisationId,
    },
  });
  if (!dispatch) {
    throw new DispatchNotFoundError();
  }

  if (
    dispatch.status === 'EXPORTED' ||
    dispatch.status === 'CANCELLED' ||
    dispatch.status === 'FAILED'
  ) {
    throw new JobPreparationConflictError(
      `Cannot operate on a ${dispatch.status} dispatch.`,
      'DISPATCH_TERMINAL'
    );
  }

  if (dispatch.assignedAgentId !== agent.id || dispatch.status === 'QUEUED') {
    throw new CreativeAgentClaimError(
      'Creative job dispatch is not actively assigned to this agent.',
      'DISPATCH_NOT_ASSIGNED'
    );
  }

  if (
    !dispatch.claimTokenHash ||
    !constantTimeEqualHex(hashAgentSecret(claimToken), dispatch.claimTokenHash)
  ) {
    throw new CreativeAgentClaimError(
      'Creative job dispatch claim token is stale or does not match the current lease.',
      'DISPATCH_CLAIM_MISMATCH'
    );
  }

  if (!dispatch.leaseExpiresAt || dispatch.leaseExpiresAt <= now) {
    throw new CreativeAgentClaimError(
      'Creative job dispatch lease has expired. Renew or re-claim before continuing.',
      'DISPATCH_LEASE_EXPIRED'
    );
  }

  return dispatch;
}

/**
 * Explicit lease renewal endpoint for long-running active creative work
 * (including `READY_FOR_ARTIST` artist sessions).
 * Canonical lock order: L0 (`creative_agents FOR SHARE`) -> L1 (`design_jobs FOR UPDATE`) -> L2 (`creative_job_dispatches FOR UPDATE`).
 */
export async function renewAgentDispatchLease(
  agent: AuthenticatedCreativeAgent,
  dispatchId: string,
  claimToken: string,
  deps: AgentServiceDependencies = {}
): Promise<{ dispatch: CreativeJobDispatchSummary; leaseExpiresAt: string }> {
  if (!claimToken || !isValidDispatchClaimToken(claimToken)) {
    throw new CreativeAgentClaimError(
      'Missing or malformed dispatch claim token.',
      'DISPATCH_CLAIM_INVALID'
    );
  }

  const designJobId = await lookupDispatchParentJobId(
    agent.organisationId,
    dispatchId
  );

  return prisma.$transaction(async (tx) => {
    // Canonical lock order: L0 -> L1 -> L2
    await lockAndVerifyActiveAgentShare(tx, agent);

    await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM design_jobs
      WHERE id = ${designJobId} AND organisation_id = ${agent.organisationId}
      FOR UPDATE
    `;

    await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM creative_job_dispatches
      WHERE id = ${dispatchId} AND organisation_id = ${agent.organisationId}
      FOR UPDATE
    `;

    const now = (deps.now ?? (() => new Date()))();
    const nextLease = new Date(now.getTime() + AGENT_DISPATCH_LEASE_MS);

    const dispatch = await assertAgentOwnsActiveDispatch(
      tx,
      agent,
      dispatchId,
      claimToken,
      now
    );

    const updated = await tx.creativeJobDispatch.update({
      where: { id: dispatch.id },
      data: {
        leaseExpiresAt: nextLease,
      },
    });

    await auditService.recordAuditEvent(tx, {
      organisationId: agent.organisationId,
      actorUserId: null,
      action: auditService.AUDIT_ACTIONS.CREATIVE_DISPATCH_LEASE_RENEWED,
      entityType: 'CreativeJobDispatch',
      entityId: dispatch.id,
      metadata: {
        designJobId: dispatch.designJobId,
        agentId: agent.id,
        status: dispatch.status,
      },
    });

    return {
      dispatch: mapDispatchRow(updated, now),
      leaseExpiresAt: nextLease.toISOString(),
    };
  }, AGENT_TX_OPTIONS);
}

export async function updateAgentDispatchStatus(
  agent: AuthenticatedCreativeAgent,
  dispatchId: string,
  claimToken: string,
  input: UpdateCreativeDispatchStatusInput,
  deps: AgentServiceDependencies = {}
): Promise<{ dispatch: CreativeJobDispatchSummary; idempotentReplay: boolean }> {
  if (!claimToken || !isValidDispatchClaimToken(claimToken)) {
    throw new CreativeAgentClaimError(
      'Missing or malformed dispatch claim token.',
      'DISPATCH_CLAIM_INVALID'
    );
  }
  if (input.claimToken && input.claimToken !== claimToken) {
    throw new CreativeAgentClaimError(
      'Body claim token does not match dispatch claim header.',
      'DISPATCH_CLAIM_MISMATCH'
    );
  }

  const designJobId = await lookupDispatchParentJobId(
    agent.organisationId,
    dispatchId
  );

  return prisma.$transaction(async (tx) => {
    // Canonical lock order: L0 -> L1 -> L2
    await lockAndVerifyActiveAgentShare(tx, agent);

    await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM design_jobs
      WHERE id = ${designJobId} AND organisation_id = ${agent.organisationId}
      FOR UPDATE
    `;

    await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM creative_job_dispatches
      WHERE id = ${dispatchId} AND organisation_id = ${agent.organisationId}
      FOR UPDATE
    `;

    const now = (deps.now ?? (() => new Date()))();
    const nextLease = new Date(now.getTime() + AGENT_DISPATCH_LEASE_MS);

    const dispatch = await assertAgentOwnsActiveDispatch(
      tx,
      agent,
      dispatchId,
      claimToken,
      now
    );

    const currentStatus = dispatch.status as CreativeDispatchStatus;
    if (currentStatus === input.status) {
      return {
        dispatch: mapDispatchRow(dispatch, now),
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

    // Advance DesignJob PENDING -> IN_PROGRESS only once when agent begins workspace preparation
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
      dispatch: mapDispatchRow(updated, now),
      idempotentReplay: false,
    };
  }, AGENT_TX_OPTIONS);
}

export async function streamAgentDispatchTemplateMaster(
  agent: AuthenticatedCreativeAgent,
  dispatchId: string,
  claimToken: string,
  deps: AgentServiceDependencies = {}
): Promise<{
  body: Uint8Array;
  mimeType: string;
  byteSize: number;
  sha256: string;
  filename: string;
}> {
  const now = (deps.now ?? (() => new Date()))();
  const creativeStorage =
    deps.creativeStorage ?? deps.storage ?? createCreativeObjectStorageProvider();

  const dispatch = await assertAgentOwnsActiveDispatch(
    prisma,
    agent,
    dispatchId,
    claimToken,
    now
  );

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
  claimToken: string,
  deps: AgentServiceDependencies = {}
): Promise<{
  body: Uint8Array;
  mimeType: string;
  byteSize: number;
  sha256: string;
}> {
  const now = (deps.now ?? (() => new Date()))();
  const dispatch = await assertAgentOwnsActiveDispatch(
    prisma,
    agent,
    dispatchId,
    claimToken,
    now
  );

  const manifest = creativeJobManifestSchema.parse(dispatch.manifestJson);
  const matchingField = manifest.fields.find(
    (f) => f.assetReference && f.assetReference.assetId === assetId
  );
  if (!matchingField || !matchingField.assetReference) {
    throw new CreativeAgentForbiddenError(
      'Requested asset is not authorised in this job manifest.'
    );
  }

  if (matchingField.assetReference.assetKind !== 'MEMBER_PHOTO') {
    throw new CreativeAgentUnsupportedAssetError();
  }

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

export async function createAgentExportUploadIntent(
  agent: AuthenticatedCreativeAgent,
  dispatchId: string,
  claimToken: string,
  input: CreateExportUploadIntentInput,
  deps: AgentServiceDependencies = {}
): Promise<{
  intent: CreativeUploadIntentSummary;
  upload: PresignedUploadTarget;
}> {
  if (!claimToken || !isValidDispatchClaimToken(claimToken)) {
    throw new CreativeAgentClaimError(
      'Missing or malformed dispatch claim token.',
      'DISPATCH_CLAIM_INVALID'
    );
  }

  const designJobId = await lookupDispatchParentJobId(
    agent.organisationId,
    dispatchId
  );

  const dispatch = await prisma.$transaction(async (tx) => {
    // Canonical lock order: L0 -> L1 -> L2
    await lockAndVerifyActiveAgentShare(tx, agent);

    await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM design_jobs
      WHERE id = ${designJobId} AND organisation_id = ${agent.organisationId}
      FOR UPDATE
    `;

    await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM creative_job_dispatches
      WHERE id = ${dispatchId} AND organisation_id = ${agent.organisationId}
      FOR UPDATE
    `;

    const now = (deps.now ?? (() => new Date()))();
    return assertAgentOwnsActiveDispatch(tx, agent, dispatchId, claimToken, now);
  }, AGENT_TX_OPTIONS);

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

/**
 * Completes an agent export upload.
 *
 * Performs a lightweight non-mutating preflight to avoid downloading storage
 * objects for obviously unauthorized callers, then delegates to
 * `completeExportDeliverableUpload()` with full `claimContext`.
 *
 * Authoritative security enforcement occurs INSIDE the final database
 * transaction of `completeExportDeliverableUpload()` under `L0 -> L1 -> L2 -> L3`
 * row locks, closing the TOCTOU window between object validation and commit.
 */
export async function completeAgentExportUpload(
  agent: AuthenticatedCreativeAgent,
  dispatchId: string,
  claimToken: string,
  input: CreateExportRecordInput,
  deps: AgentServiceDependencies = {}
): Promise<{ exportRecord: ExportRecordSummary; idempotentReplay: boolean }> {
  const preflightNow = (deps.now ?? (() => new Date()))();

  if (!claimToken || !isValidDispatchClaimToken(claimToken)) {
    throw new CreativeAgentClaimError(
      'Missing or malformed dispatch claim token.',
      'DISPATCH_CLAIM_INVALID'
    );
  }

  // Lightweight preflight only (never relied upon as final authorization)
  const dispatch = await prisma.creativeJobDispatch.findFirst({
    where: { id: dispatchId, organisationId: agent.organisationId },
    select: {
      id: true,
      designJobId: true,
      assignedAgentId: true,
      status: true,
      claimTokenHash: true,
      leaseExpiresAt: true,
    },
  });
  if (!dispatch) {
    throw new DispatchNotFoundError();
  }
  if (dispatch.assignedAgentId !== agent.id) {
    throw new CreativeAgentClaimError(
      'Creative job dispatch is not actively assigned to this agent.',
      'DISPATCH_NOT_ASSIGNED'
    );
  }
  if (
    !dispatch.claimTokenHash ||
    !constantTimeEqualHex(hashAgentSecret(claimToken), dispatch.claimTokenHash)
  ) {
    throw new CreativeAgentClaimError(
      'Creative job dispatch claim token is stale or does not match the current lease.',
      'DISPATCH_CLAIM_MISMATCH'
    );
  }
  if (
    dispatch.status !== 'EXPORTED' &&
    (!dispatch.leaseExpiresAt || dispatch.leaseExpiresAt <= preflightNow)
  ) {
    throw new CreativeAgentClaimError(
      'Creative job dispatch lease has expired. Renew or re-claim before continuing.',
      'DISPATCH_LEASE_EXPIRED'
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
    {
      ...deps,
      claimContext: {
        agentId: agent.id,
        dispatchId: dispatch.id,
        claimToken,
      },
    }
  );
}
