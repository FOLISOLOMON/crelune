/**
 * CRELUNE — Organisation-Scoped Design Management Service (Milestone 4)
 *
 * Manages DesignJob creation, optional Member & BirthdayPreparation linking,
 * controlled status transitions with immutable DesignJobHistory logs, and
 * non-inferred publication semantics.
 */

import { createHash } from 'node:crypto';
import { Prisma, prisma, type DesignJobStatus } from '@crelune/database';
import {
  ACTIVE_DESIGN_JOB_STATUSES,
  canTransitionDesignJobStatus,
  civilDateToUtcMidnight,
  formatCivilDateIso,
  getAllowedNextDesignJobStatuses,
  isMemberActive,
  normalizeMemberName,
  parseCivilDateIso,
  resolveCelebrationDateForYear,
  utcDateOnlyToCivilDate,
  type CreateDesignJobInput,
  type DesignCategory,
  type DesignJobDetail,
  type DesignJobHistoryEntry,
  type DesignJobListQuery,
  type DesignJobStatus as SharedDesignJobStatus,
  type DesignJobSummary,
  type DesignPriority,
  type MemberPaginationMeta,
  type TransitionDesignJobInput,
  type UpdateDesignJobInput,
} from '@crelune/shared';
import * as auditService from '@/lib/audit/audit-service';
import { loadOwnerBirthdayPreferences } from '@/lib/birthdays/birthday-preferences';
import { MemberNotFoundError } from '@/lib/members/member-service';

export interface DesignActorContext {
  userId: string;
  organisationId: string;
}

export class DesignJobNotFoundError extends Error {
  constructor() {
    super('Design job not found.');
    this.name = 'DesignJobNotFoundError';
  }
}

export class DesignJobValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DesignJobValidationError';
  }
}

export type DesignJobConflictCode =
  | 'DUPLICATE_BIRTHDAY_DESIGN_JOB'
  | 'BIRTHDAY_PREP_ALREADY_LINKED';

export class DesignJobConflictError extends Error {
  public readonly code: DesignJobConflictCode;

  constructor(
    message: string,
    code: DesignJobConflictCode = 'DUPLICATE_BIRTHDAY_DESIGN_JOB'
  ) {
    super(message);
    this.name = 'DesignJobConflictError';
    this.code = code;
  }
}

export class DesignJobTransitionError extends Error {
  public readonly currentStatus: SharedDesignJobStatus;
  public readonly attemptedStatus: SharedDesignJobStatus;

  constructor(
    currentStatus: SharedDesignJobStatus,
    attemptedStatus: SharedDesignJobStatus
  ) {
    const allowed = getAllowedNextDesignJobStatuses(currentStatus);
    const allowedText =
      allowed.length > 0 ? allowed.join(', ') : 'none (terminal status)';
    super(
      `Invalid status transition from ${currentStatus} to ${attemptedStatus}. Allowed transitions: ${allowedText}.`
    );
    this.name = 'DesignJobTransitionError';
    this.currentStatus = currentStatus;
    this.attemptedStatus = attemptedStatus;
  }
}

const DESIGN_JOB_SUMMARY_SELECT = {
  id: true,
  title: true,
  category: true,
  status: true,
  priority: true,
  memberId: true,
  birthdayTargetYear: true,
  targetPlatform: true,
  dimensions: true,
  dueDate: true,
  approvedAt: true,
  exportedAt: true,
  publishedAt: true,
  cancelledAt: true,
  createdAt: true,
  updatedAt: true,
  member: {
    select: {
      id: true,
      fullName: true,
      preferredName: true,
      photoStorageKey: true,
      photoUpdatedAt: true,
      archivedAt: true,
    },
  },
} satisfies Prisma.DesignJobSelect;

const DESIGN_JOB_DETAIL_SELECT = {
  ...DESIGN_JOB_SUMMARY_SELECT,
  requiredText: true,
  preferredTemplateNote: true,
  referenceNotes: true,
  notes: true,
  history: {
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    select: {
      id: true,
      previousStatus: true,
      newStatus: true,
      note: true,
      createdAt: true,
      changedByUser: {
        select: {
          firstName: true,
          lastName: true,
        },
      },
    },
  },
} satisfies Prisma.DesignJobSelect;

type DesignJobSummaryRow = Prisma.DesignJobGetPayload<{
  select: typeof DESIGN_JOB_SUMMARY_SELECT;
}>;
type DesignJobDetailRow = Prisma.DesignJobGetPayload<{
  select: typeof DESIGN_JOB_DETAIL_SELECT;
}>;

export function mapDesignJobSummary(row: DesignJobSummaryRow): DesignJobSummary {
  return {
    id: row.id,
    title: row.title,
    category: row.category as DesignCategory,
    status: row.status as SharedDesignJobStatus,
    priority: row.priority as DesignPriority,
    memberId: row.memberId ?? null,
    member: row.member
      ? {
          id: row.member.id,
          fullName: row.member.fullName,
          preferredName: row.member.preferredName ?? null,
          hasPhoto: Boolean(row.member.photoStorageKey),
          photoUpdatedAt: row.member.photoUpdatedAt
            ? row.member.photoUpdatedAt.toISOString()
            : null,
          isActive: isMemberActive(row.member),
        }
      : null,
    birthdayTargetYear: row.birthdayTargetYear ?? null,
    targetPlatform: row.targetPlatform ?? null,
    dimensions: row.dimensions ?? null,
    dueDate: row.dueDate
      ? formatCivilDateIso(utcDateOnlyToCivilDate(row.dueDate))
      : null,
    approvedAt: row.approvedAt ? row.approvedAt.toISOString() : null,
    exportedAt: row.exportedAt ? row.exportedAt.toISOString() : null,
    publishedAt: row.publishedAt ? row.publishedAt.toISOString() : null,
    cancelledAt: row.cancelledAt ? row.cancelledAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function mapDesignJobDetail(row: DesignJobDetailRow): DesignJobDetail {
  const history: DesignJobHistoryEntry[] = row.history.map((entry) => ({
    id: entry.id,
    previousStatus: (entry.previousStatus as SharedDesignJobStatus) ?? null,
    newStatus: entry.newStatus as SharedDesignJobStatus,
    note: entry.note ?? null,
    changedByName: entry.changedByUser
      ? `${entry.changedByUser.firstName} ${entry.changedByUser.lastName}`.trim()
      : null,
    createdAt: entry.createdAt.toISOString(),
  }));

  return {
    ...mapDesignJobSummary(row),
    requiredText: row.requiredText ?? null,
    preferredTemplateNote: row.preferredTemplateNote ?? null,
    referenceNotes: row.referenceNotes ?? null,
    notes: row.notes ?? null,
    history,
  };
}

function parseDueDateValue(dueDate: string | null | undefined): Date | null | undefined {
  if (dueDate === undefined) return undefined;
  if (dueDate === null) return null;
  return civilDateToUtcMidnight(parseCivilDateIso(dueDate));
}

export async function listDesignJobs(
  organisationId: string,
  query: DesignJobListQuery
): Promise<{
  jobs: DesignJobSummary[];
  pagination: MemberPaginationMeta;
  statusCounts: Record<SharedDesignJobStatus, number>;
}> {
  const where: Prisma.DesignJobWhereInput = {
    organisationId,
  };

  if (query.status === 'active') {
    where.status = { in: [...ACTIVE_DESIGN_JOB_STATUSES] as DesignJobStatus[] };
  } else if (query.status !== 'all') {
    where.status = query.status as DesignJobStatus;
  }

  if (query.category !== 'ALL') {
    where.category = query.category;
  }
  if (query.priority !== 'ALL') {
    where.priority = query.priority;
  }
  if (query.memberId) {
    where.memberId = query.memberId;
  }
  if (query.q) {
    const normalized = normalizeMemberName(query.q);
    where.AND = [
      {
        OR: [
          { title: { contains: query.q, mode: 'insensitive' } },
          { targetPlatform: { contains: query.q, mode: 'insensitive' } },
          { member: { normalizedName: { contains: normalized } } },
        ],
      },
    ];
  }

  const skip = (query.page - 1) * query.limit;

  const [total, rows, groupedCounts] = await Promise.all([
    prisma.designJob.count({ where }),
    prisma.designJob.findMany({
      where,
      orderBy: [
        { dueDate: { sort: 'asc', nulls: 'last' } },
        { updatedAt: 'desc' },
        { id: 'asc' },
      ],
      skip,
      take: query.limit,
      select: DESIGN_JOB_SUMMARY_SELECT,
    }),
    prisma.designJob.groupBy({
      by: ['status'],
      where: { organisationId },
      _count: { _all: true },
    }),
  ]);

  const statusCounts: Record<SharedDesignJobStatus, number> = {
    DRAFT: 0,
    PENDING: 0,
    IN_PROGRESS: 0,
    AWAITING_REVIEW: 0,
    APPROVED: 0,
    EXPORTED: 0,
    PUBLISHED: 0,
    CANCELLED: 0,
  };
  for (const row of groupedCounts) {
    statusCounts[row.status as SharedDesignJobStatus] = row._count._all;
  }

  const totalPages = total === 0 ? 0 : Math.ceil(total / query.limit);

  return {
    jobs: rows.map(mapDesignJobSummary),
    pagination: {
      page: query.page,
      limit: query.limit,
      total,
      totalPages,
      hasNextPage: query.page < totalPages,
      hasPreviousPage: query.page > 1 && total > 0,
    },
    statusCounts,
  };
}

export async function getDesignJobById(
  organisationId: string,
  jobId: string
): Promise<DesignJobDetail> {
  const row = await prisma.designJob.findFirst({
    where: {
      id: jobId,
      organisationId,
    },
    select: DESIGN_JOB_DETAIL_SELECT,
  });

  if (!row) {
    throw new DesignJobNotFoundError();
  }

  return mapDesignJobDetail(row);
}

export interface BirthdayDesignJobLockTuple {
  organisationId: string;
  memberId: string;
  targetYear: number;
}

interface MemberBirthdayValidationRow {
  id: string;
  birthMonth: number | null;
  birthDay: number | null;
  archivedAt: Date | null;
}

type ActiveBirthdayMember = {
  id: string;
  birthMonth: number;
  birthDay: number;
  archivedAt: Date | null;
};

/**
 * Derive two deterministic signed 32-bit advisory lock keys from SHA-256 of the
 * canonical tuple so PostgreSQL `pg_advisory_xact_lock(int4, int4)` isolates
 * concurrent birthday design job operations by (organisationId, memberId, targetYear).
 */
export function deriveBirthdayDesignJobLockKeys(
  tuple: BirthdayDesignJobLockTuple
): [number, number] {
  const canonical = JSON.stringify([
    'crelune:birthday-design-job:v1',
    tuple.organisationId,
    tuple.memberId,
    tuple.targetYear,
  ]);
  const digest = createHash('sha256').update(canonical).digest();
  return [digest.readInt32BE(0), digest.readInt32BE(4)];
}

async function acquireBirthdayDesignJobLocks(
  tx: Prisma.TransactionClient,
  tuples: BirthdayDesignJobLockTuple[]
): Promise<void> {
  if (tuples.length === 0) return;

  const uniqueKeys = new Map<string, [number, number]>();
  for (const tuple of tuples) {
    const keys = deriveBirthdayDesignJobLockKeys(tuple);
    uniqueKeys.set(`${keys[0]}:${keys[1]}`, keys);
  }

  // Acquire locks in sorted key order to prevent AB-BA deadlocks across reassignments.
  const ordered = Array.from(uniqueKeys.values()).sort((a, b) =>
    a[0] !== b[0] ? a[0] - b[0] : a[1] - b[1]
  );

  for (const [key1, key2] of ordered) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(CAST(${key1} AS integer), CAST(${key2} AS integer))`;
  }
}

function assertValidBirthdayTargetYear(targetYear: number | null | undefined): number {
  if (
    targetYear === null ||
    targetYear === undefined ||
    !Number.isInteger(targetYear) ||
    targetYear < 2000 ||
    targetYear > 2200
  ) {
    throw new DesignJobValidationError(
      'A valid birthday target year (2000-2200) is required for birthday flyer jobs.'
    );
  }
  return targetYear;
}

function assertCompleteMemberBirthday(
  member: MemberBirthdayValidationRow
): ActiveBirthdayMember {
  if (member.birthMonth === null || member.birthDay === null) {
    throw new DesignJobValidationError(
      'Linked member must have a complete recorded birthday month and day for birthday flyer jobs.'
    );
  }
  return {
    id: member.id,
    birthMonth: member.birthMonth,
    birthDay: member.birthDay,
    archivedAt: member.archivedAt,
  };
}

function derivePrepStatusFromJobStatus(
  jobStatus: SharedDesignJobStatus
):
  | 'PREPARATION_PENDING'
  | 'DESIGN_IN_PROGRESS'
  | 'AWAITING_APPROVAL'
  | 'PUBLISHED' {
  if (jobStatus === 'IN_PROGRESS') {
    return 'DESIGN_IN_PROGRESS';
  }
  if (
    jobStatus === 'AWAITING_REVIEW' ||
    jobStatus === 'APPROVED' ||
    jobStatus === 'EXPORTED'
  ) {
    return 'AWAITING_APPROVAL';
  }
  if (jobStatus === 'PUBLISHED') {
    return 'PUBLISHED';
  }
  return 'PREPARATION_PENDING';
}

async function assertNoBirthdayJobOrPrepConflict(
  tx: Prisma.TransactionClient,
  tuple: BirthdayDesignJobLockTuple,
  excludeJobId?: string
): Promise<void> {
  const activeConflict = await tx.designJob.findFirst({
    where: {
      organisationId: tuple.organisationId,
      category: 'BIRTHDAY_FLYER',
      memberId: tuple.memberId,
      birthdayTargetYear: tuple.targetYear,
      status: { not: 'CANCELLED' },
      ...(excludeJobId ? { id: { not: excludeJobId } } : {}),
    },
    select: { id: true },
  });

  if (activeConflict) {
    throw new DesignJobConflictError(
      `An active birthday design job already exists for this member in ${tuple.targetYear}.`,
      'DUPLICATE_BIRTHDAY_DESIGN_JOB'
    );
  }

  const existingPrep = await tx.birthdayPreparation.findUnique({
    where: {
      memberId_targetYear: {
        memberId: tuple.memberId,
        targetYear: tuple.targetYear,
      },
    },
    select: { designJobId: true },
  });

  if (
    existingPrep &&
    existingPrep.designJobId !== null &&
    existingPrep.designJobId !== excludeJobId
  ) {
    throw new DesignJobConflictError(
      `Birthday preparation for ${tuple.targetYear} is already linked to another design job.`,
      'BIRTHDAY_PREP_ALREADY_LINKED'
    );
  }
}

async function detachBirthdayPreparationsForJob(
  tx: Prisma.TransactionClient,
  organisationId: string,
  jobId: string,
  preserveTarget?: { memberId: string; targetYear: number }
): Promise<void> {
  await tx.birthdayPreparation.updateMany({
    where: {
      organisationId,
      designJobId: jobId,
      ...(preserveTarget
        ? {
            NOT: {
              memberId: preserveTarget.memberId,
              targetYear: preserveTarget.targetYear,
            },
          }
        : {}),
    },
    data: {
      designJobId: null,
    },
  });
}

async function linkBirthdayPreparationToJob(
  tx: Prisma.TransactionClient,
  params: {
    actor: DesignActorContext;
    jobId: string;
    jobStatus: SharedDesignJobStatus;
    member: ActiveBirthdayMember;
    targetYear: number;
  }
): Promise<void> {
  const settings = await loadOwnerBirthdayPreferences(tx, params.actor.userId);
  const celebration = resolveCelebrationDateForYear(
    params.member.birthMonth,
    params.member.birthDay,
    params.targetYear,
    settings.leapDayPolicy
  );

  const existingPrep = await tx.birthdayPreparation.findUnique({
    where: {
      memberId_targetYear: {
        memberId: params.member.id,
        targetYear: params.targetYear,
      },
    },
    select: { id: true, status: true, designJobId: true },
  });

  if (
    existingPrep &&
    existingPrep.designJobId !== null &&
    existingPrep.designJobId !== params.jobId
  ) {
    throw new DesignJobConflictError(
      `Birthday preparation for ${params.targetYear} is already linked to another design job.`,
      'BIRTHDAY_PREP_ALREADY_LINKED'
    );
  }

  // Preserve PUBLISHED, SKIPPED, and any non-UPCOMING workflow status when attaching.
  const nextPrepStatus =
    existingPrep?.status && existingPrep.status !== 'UPCOMING'
      ? existingPrep.status
      : derivePrepStatusFromJobStatus(params.jobStatus);

  const celebrationDate = civilDateToUtcMidnight(celebration.date);

  if (!existingPrep) {
    await tx.birthdayPreparation.create({
      data: {
        organisationId: params.actor.organisationId,
        memberId: params.member.id,
        targetYear: params.targetYear,
        celebrationDate,
        status: nextPrepStatus,
        designJobId: params.jobId,
        statusUpdatedAt: new Date(),
      },
    });
    return;
  }

  await tx.birthdayPreparation.update({
    where: { id: existingPrep.id },
    data: {
      designJobId: params.jobId,
      celebrationDate,
      ...(existingPrep.status !== nextPrepStatus
        ? { status: nextPrepStatus, statusUpdatedAt: new Date() }
        : {}),
    },
  });
}

export async function createDesignJob(
  actor: DesignActorContext,
  input: CreateDesignJobInput
): Promise<DesignJobDetail> {
  return prisma.$transaction(async (tx) => {
    const isBirthdayJob = input.category === 'BIRTHDAY_FLYER';
    let targetYear: number | null = null;

    if (isBirthdayJob) {
      if (!input.memberId) {
        throw new DesignJobValidationError(
          'A linked member is required for birthday flyer jobs.'
        );
      }
      targetYear = assertValidBirthdayTargetYear(input.birthdayTargetYear);
    } else if (
      input.birthdayTargetYear !== undefined &&
      input.birthdayTargetYear !== null
    ) {
      throw new DesignJobValidationError(
        'Birthday target year is only allowed for birthday flyer jobs.'
      );
    }

    let linkedMember: MemberBirthdayValidationRow | null = null;

    if (input.memberId) {
      linkedMember = await tx.member.findFirst({
        where: {
          id: input.memberId,
          organisationId: actor.organisationId,
        },
        select: {
          id: true,
          birthMonth: true,
          birthDay: true,
          archivedAt: true,
        },
      });
      if (!linkedMember) {
        throw new MemberNotFoundError();
      }
      if (linkedMember.archivedAt !== null) {
        throw new DesignJobValidationError(
          'Restore archived member before creating a new design job for them.'
        );
      }
    }

    let activeBirthdayMember: ActiveBirthdayMember | null = null;
    if (isBirthdayJob && linkedMember && targetYear !== null) {
      activeBirthdayMember = assertCompleteMemberBirthday(linkedMember);
      const tuple: BirthdayDesignJobLockTuple = {
        organisationId: actor.organisationId,
        memberId: activeBirthdayMember.id,
        targetYear,
      };
      await acquireBirthdayDesignJobLocks(tx, [tuple]);
      await assertNoBirthdayJobOrPrepConflict(tx, tuple);
    }

    const created = await tx.designJob.create({
      data: {
        organisationId: actor.organisationId,
        memberId: linkedMember?.id ?? null,
        birthdayTargetYear: isBirthdayJob ? targetYear : null,
        title: input.title,
        category: input.category,
        status: input.initialStatus,
        priority: input.priority,
        requiredText: input.requiredText ?? null,
        dimensions: input.dimensions ?? null,
        targetPlatform: input.targetPlatform ?? null,
        preferredTemplateNote: input.preferredTemplateNote ?? null,
        referenceNotes: input.referenceNotes ?? null,
        notes: input.notes ?? null,
        dueDate: parseDueDateValue(input.dueDate) ?? null,
      },
      select: { id: true, status: true, title: true },
    });

    await tx.designJobHistory.create({
      data: {
        organisationId: actor.organisationId,
        designJobId: created.id,
        previousStatus: null,
        newStatus: created.status,
        note: 'Design job created.',
        changedByUserId: actor.userId,
      },
    });

    if (isBirthdayJob && activeBirthdayMember && targetYear !== null) {
      await linkBirthdayPreparationToJob(tx, {
        actor,
        jobId: created.id,
        jobStatus: created.status as SharedDesignJobStatus,
        member: activeBirthdayMember,
        targetYear,
      });
    }

    await auditService.recordAuditEvent(tx, {
      organisationId: actor.organisationId,
      actorUserId: actor.userId,
      action: auditService.AUDIT_ACTIONS.DESIGN_JOB_CREATED,
      entityType: 'DesignJob',
      entityId: created.id,
      metadata: {
        category: input.category,
        priority: input.priority,
        initialStatus: created.status,
        hasMemberLink: Boolean(linkedMember),
      },
    });

    const fullRow = await tx.designJob.findUniqueOrThrow({
      where: { id: created.id },
      select: DESIGN_JOB_DETAIL_SELECT,
    });
    return mapDesignJobDetail(fullRow);
  }, { maxWait: 10000, timeout: 15000 });
}

export async function updateDesignJob(
  actor: DesignActorContext,
  jobId: string,
  input: UpdateDesignJobInput
): Promise<DesignJobDetail> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT id FROM design_jobs WHERE id = ${jobId} AND organisation_id = ${actor.organisationId} FOR UPDATE`;

    const existing = await tx.designJob.findFirst({
      where: {
        id: jobId,
        organisationId: actor.organisationId,
      },
      select: {
        id: true,
        category: true,
        status: true,
        memberId: true,
        birthdayTargetYear: true,
      },
    });

    if (!existing) {
      throw new DesignJobNotFoundError();
    }

    const nextCategory = (input.category ?? existing.category) as DesignCategory;
    const isNextBirthdayJob = nextCategory === 'BIRTHDAY_FLYER';
    const nextMemberId =
      input.memberId !== undefined ? input.memberId : existing.memberId;

    let nextTargetYear: number | null;
    if (isNextBirthdayJob) {
      if (!nextMemberId) {
        throw new DesignJobValidationError(
          'A linked member is required for birthday flyer jobs.'
        );
      }
      const rawYear =
        input.birthdayTargetYear !== undefined
          ? input.birthdayTargetYear
          : existing.birthdayTargetYear;
      nextTargetYear = assertValidBirthdayTargetYear(rawYear);
    } else {
      if (
        input.birthdayTargetYear !== undefined &&
        input.birthdayTargetYear !== null
      ) {
        throw new DesignJobValidationError(
          'Birthday target year is only allowed for birthday flyer jobs.'
        );
      }
      nextTargetYear = null;
    }

    let nextMemberRow: MemberBirthdayValidationRow | null = null;
    if (nextMemberId !== null) {
      nextMemberRow = await tx.member.findFirst({
        where: {
          id: nextMemberId,
          organisationId: actor.organisationId,
        },
        select: {
          id: true,
          birthMonth: true,
          birthDay: true,
          archivedAt: true,
        },
      });
      if (!nextMemberRow) {
        throw new MemberNotFoundError();
      }
      if (
        nextMemberRow.archivedAt !== null &&
        (nextMemberId !== existing.memberId ||
          (isNextBirthdayJob && existing.category !== 'BIRTHDAY_FLYER'))
      ) {
        throw new DesignJobValidationError(
          'Restore archived member before linking them to this design job.'
        );
      }
    }

    const activeBirthdayMember =
      isNextBirthdayJob && nextMemberRow
        ? assertCompleteMemberBirthday(nextMemberRow)
        : null;

    const wasActiveBirthdayJob =
      existing.category === 'BIRTHDAY_FLYER' &&
      existing.status !== 'CANCELLED' &&
      existing.memberId !== null &&
      existing.birthdayTargetYear !== null;

    const willBeActiveBirthdayJob =
      isNextBirthdayJob &&
      existing.status !== 'CANCELLED' &&
      activeBirthdayMember !== null &&
      nextTargetYear !== null;

    const oldTuple: BirthdayDesignJobLockTuple | null = wasActiveBirthdayJob
      ? {
          organisationId: actor.organisationId,
          memberId: existing.memberId!,
          targetYear: existing.birthdayTargetYear!,
        }
      : null;

    const newTuple: BirthdayDesignJobLockTuple | null = willBeActiveBirthdayJob
      ? {
          organisationId: actor.organisationId,
          memberId: activeBirthdayMember!.id,
          targetYear: nextTargetYear!,
        }
      : null;

    const tupleChanged =
      oldTuple?.memberId !== newTuple?.memberId ||
      oldTuple?.targetYear !== newTuple?.targetYear;

    const locksToAcquire: BirthdayDesignJobLockTuple[] = [];
    if (oldTuple) locksToAcquire.push(oldTuple);
    if (newTuple) locksToAcquire.push(newTuple);
    await acquireBirthdayDesignJobLocks(tx, locksToAcquire);

    if (newTuple && tupleChanged) {
      await assertNoBirthdayJobOrPrepConflict(tx, newTuple, existing.id);
    }

    const updateData: Prisma.DesignJobUpdateInput = {};
    const changedFields: string[] = [];

    if (input.title !== undefined) {
      updateData.title = input.title;
      changedFields.push('title');
    }
    if (input.category !== undefined) {
      updateData.category = input.category;
      changedFields.push('category');
    }
    if (input.priority !== undefined) {
      updateData.priority = input.priority;
      changedFields.push('priority');
    }
    if (input.memberId !== undefined) {
      updateData.member =
        input.memberId === null
          ? { disconnect: true }
          : { connect: { id: input.memberId } };
      changedFields.push('memberId');
    }
    if (nextTargetYear !== existing.birthdayTargetYear) {
      updateData.birthdayTargetYear = nextTargetYear;
      changedFields.push('birthdayTargetYear');
    }
    if (input.requiredText !== undefined) {
      updateData.requiredText = input.requiredText;
      changedFields.push('requiredText');
    }
    if (input.dimensions !== undefined) {
      updateData.dimensions = input.dimensions;
      changedFields.push('dimensions');
    }
    if (input.targetPlatform !== undefined) {
      updateData.targetPlatform = input.targetPlatform;
      changedFields.push('targetPlatform');
    }
    if (input.preferredTemplateNote !== undefined) {
      updateData.preferredTemplateNote = input.preferredTemplateNote;
      changedFields.push('preferredTemplateNote');
    }
    if (input.referenceNotes !== undefined) {
      updateData.referenceNotes = input.referenceNotes;
      changedFields.push('referenceNotes');
    }
    if (input.notes !== undefined) {
      updateData.notes = input.notes;
      changedFields.push('notes');
    }
    if (input.dueDate !== undefined) {
      updateData.dueDate = parseDueDateValue(input.dueDate);
      changedFields.push('dueDate');
    }

    if (
      (oldTuple && tupleChanged) ||
      (!isNextBirthdayJob && existing.category === 'BIRTHDAY_FLYER')
    ) {
      await detachBirthdayPreparationsForJob(
        tx,
        actor.organisationId,
        existing.id,
        newTuple
          ? { memberId: newTuple.memberId, targetYear: newTuple.targetYear }
          : undefined
      );
    }

    await tx.designJob.update({
      where: { id: existing.id },
      data: updateData,
      select: { id: true },
    });

    if (willBeActiveBirthdayJob && activeBirthdayMember && nextTargetYear !== null && tupleChanged) {
      await linkBirthdayPreparationToJob(tx, {
        actor,
        jobId: existing.id,
        jobStatus: existing.status as SharedDesignJobStatus,
        member: activeBirthdayMember,
        targetYear: nextTargetYear,
      });
    }

    await auditService.recordAuditEvent(tx, {
      organisationId: actor.organisationId,
      actorUserId: actor.userId,
      action: auditService.AUDIT_ACTIONS.DESIGN_JOB_UPDATED,
      entityType: 'DesignJob',
      entityId: existing.id,
      metadata: {
        changedFields,
      },
    });

    const refreshed = await tx.designJob.findUniqueOrThrow({
      where: { id: existing.id },
      select: DESIGN_JOB_DETAIL_SELECT,
    });

    return mapDesignJobDetail(refreshed);
  }, { maxWait: 10000, timeout: 15000 });
}

export async function transitionDesignJobStatus(
  actor: DesignActorContext,
  jobId: string,
  input: TransitionDesignJobInput
): Promise<DesignJobDetail> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT id FROM design_jobs WHERE id = ${jobId} AND organisation_id = ${actor.organisationId} FOR UPDATE`;

    const existing = await tx.designJob.findFirst({
      where: {
        id: jobId,
        organisationId: actor.organisationId,
      },
      select: {
        id: true,
        category: true,
        status: true,
        memberId: true,
        birthdayTargetYear: true,
        approvedAt: true,
        exportedAt: true,
        publishedAt: true,
      },
    });

    if (!existing) {
      throw new DesignJobNotFoundError();
    }

    const currentStatus = existing.status as SharedDesignJobStatus;
    if (!canTransitionDesignJobStatus(currentStatus, input.status)) {
      throw new DesignJobTransitionError(currentStatus, input.status);
    }

    const isBirthdayJob = existing.category === 'BIRTHDAY_FLYER';
    const hasBirthdayTuple =
      isBirthdayJob &&
      existing.memberId !== null &&
      existing.birthdayTargetYear !== null;

    if (hasBirthdayTuple && (input.status === 'CANCELLED' || currentStatus === 'CANCELLED')) {
      await acquireBirthdayDesignJobLocks(tx, [
        {
          organisationId: actor.organisationId,
          memberId: existing.memberId!,
          targetYear: existing.birthdayTargetYear!,
        },
      ]);
    }

    let restoredBirthdayMember: ActiveBirthdayMember | null = null;
    if (currentStatus === 'CANCELLED' && input.status === 'DRAFT' && isBirthdayJob) {
      if (!existing.memberId) {
        throw new DesignJobValidationError(
          'A linked member is required before reopening a birthday flyer job.'
        );
      }
      const targetYear = assertValidBirthdayTargetYear(existing.birthdayTargetYear);
      const memberRow = await tx.member.findFirst({
        where: {
          id: existing.memberId,
          organisationId: actor.organisationId,
        },
        select: {
          id: true,
          birthMonth: true,
          birthDay: true,
          archivedAt: true,
        },
      });
      if (!memberRow) {
        throw new MemberNotFoundError();
      }
      if (memberRow.archivedAt !== null) {
        throw new DesignJobValidationError(
          'Restore archived member before reopening their birthday design job.'
        );
      }
      restoredBirthdayMember = assertCompleteMemberBirthday(memberRow);
      await assertNoBirthdayJobOrPrepConflict(
        tx,
        {
          organisationId: actor.organisationId,
          memberId: restoredBirthdayMember.id,
          targetYear,
        },
        existing.id
      );
    }

    const now = new Date();
    const updateData: Prisma.DesignJobUpdateInput = {
      status: input.status,
    };

    if (input.status === 'APPROVED') {
      updateData.approvedAt = existing.approvedAt ?? now;
    } else if (input.status === 'EXPORTED') {
      updateData.exportedAt = existing.exportedAt ?? now;
      // Publication must NEVER be inferred automatically from export completion.
    } else if (input.status === 'PUBLISHED') {
      updateData.publishedAt = now;
    } else if (input.status === 'CANCELLED') {
      updateData.cancelledAt = now;
    } else if (input.status === 'DRAFT' && currentStatus === 'CANCELLED') {
      updateData.cancelledAt = null;
    }

    await tx.designJob.update({
      where: { id: existing.id },
      data: updateData,
    });

    await tx.designJobHistory.create({
      data: {
        organisationId: actor.organisationId,
        designJobId: existing.id,
        previousStatus: existing.status,
        newStatus: input.status,
        note: input.note ?? null,
        changedByUserId: actor.userId,
      },
    });

    if (input.status === 'CANCELLED') {
      await detachBirthdayPreparationsForJob(
        tx,
        actor.organisationId,
        existing.id
      );
    } else if (
      currentStatus === 'CANCELLED' &&
      input.status === 'DRAFT' &&
      isBirthdayJob &&
      restoredBirthdayMember &&
      existing.birthdayTargetYear !== null
    ) {
      await linkBirthdayPreparationToJob(tx, {
        actor,
        jobId: existing.id,
        jobStatus: 'DRAFT',
        member: restoredBirthdayMember,
        targetYear: existing.birthdayTargetYear,
      });
    } else {
      // Keep linked BirthdayPreparation aligned responsibly without auto-publishing on EXPORTED.
      const linkedPreps = await tx.birthdayPreparation.findMany({
        where: {
          organisationId: actor.organisationId,
          designJobId: existing.id,
        },
        select: { id: true, status: true },
      });

      for (const prep of linkedPreps) {
        let targetPrepStatus:
          | 'PREPARATION_PENDING'
          | 'DESIGN_IN_PROGRESS'
          | 'AWAITING_APPROVAL'
          | 'PUBLISHED'
          | null = null;

        if (input.status === 'IN_PROGRESS' && prep.status !== 'PUBLISHED' && prep.status !== 'SKIPPED') {
          targetPrepStatus = 'DESIGN_IN_PROGRESS';
        } else if (
          (input.status === 'AWAITING_REVIEW' ||
            input.status === 'APPROVED' ||
            input.status === 'EXPORTED') &&
          prep.status !== 'PUBLISHED' &&
          prep.status !== 'SKIPPED'
        ) {
          targetPrepStatus = 'AWAITING_APPROVAL';
        } else if (input.status === 'PUBLISHED') {
          targetPrepStatus = 'PUBLISHED';
        }

        if (targetPrepStatus && targetPrepStatus !== prep.status) {
          await tx.birthdayPreparation.update({
            where: { id: prep.id },
            data: {
              status: targetPrepStatus,
              statusUpdatedAt: now,
            },
          });
        }
      }
    }

    await auditService.recordAuditEvent(tx, {
      organisationId: actor.organisationId,
      actorUserId: actor.userId,
      action: auditService.AUDIT_ACTIONS.DESIGN_JOB_STATUS_CHANGED,
      entityType: 'DesignJob',
      entityId: existing.id,
      metadata: {
        previousStatus: existing.status,
        newStatus: input.status,
      },
    });

    const refreshed = await tx.designJob.findUniqueOrThrow({
      where: { id: existing.id },
      select: DESIGN_JOB_DETAIL_SELECT,
    });

    return mapDesignJobDetail(refreshed);
  }, { maxWait: 10000, timeout: 15000 });
}

