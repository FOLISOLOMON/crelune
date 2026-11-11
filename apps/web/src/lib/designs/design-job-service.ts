/**
 * CRELUNE — Organisation-Scoped Design Management Service (Milestone 4)
 *
 * Manages DesignJob creation, optional Member & BirthdayPreparation linking,
 * controlled status transitions with immutable DesignJobHistory logs, and
 * non-inferred publication semantics.
 */

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

export async function createDesignJob(
  actor: DesignActorContext,
  input: CreateDesignJobInput
): Promise<DesignJobDetail> {
  return prisma.$transaction(async (tx) => {
    let linkedMember: {
      id: string;
      birthMonth: number | null;
      birthDay: number | null;
      archivedAt: Date | null;
    } | null = null;

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

    const created = await tx.designJob.create({
      data: {
        organisationId: actor.organisationId,
        memberId: linkedMember?.id ?? null,
        birthdayTargetYear: input.birthdayTargetYear ?? null,
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

    // If linked directly to a birthday cycle year, associate or create BirthdayPreparation cleanly.
    if (
      linkedMember &&
      input.birthdayTargetYear !== undefined &&
      input.birthdayTargetYear !== null &&
      linkedMember.birthMonth !== null &&
      linkedMember.birthDay !== null
    ) {
      const settings = await loadOwnerBirthdayPreferences(tx, actor.userId);
      const celebration = resolveCelebrationDateForYear(
        linkedMember.birthMonth,
        linkedMember.birthDay,
        input.birthdayTargetYear,
        settings.leapDayPolicy
      );

      const existingPrep = await tx.birthdayPreparation.findUnique({
        where: {
          memberId_targetYear: {
            memberId: linkedMember.id,
            targetYear: input.birthdayTargetYear,
          },
        },
        select: { id: true, status: true },
      });

      const nextPrepStatus =
        existingPrep?.status && existingPrep.status !== 'UPCOMING'
          ? existingPrep.status
          : 'PREPARATION_PENDING';

      await tx.birthdayPreparation.upsert({
        where: {
          memberId_targetYear: {
            memberId: linkedMember.id,
            targetYear: input.birthdayTargetYear,
          },
        },
        create: {
          organisationId: actor.organisationId,
          memberId: linkedMember.id,
          targetYear: input.birthdayTargetYear,
          celebrationDate: civilDateToUtcMidnight(celebration.date),
          status: nextPrepStatus,
          designJobId: created.id,
          statusUpdatedAt: new Date(),
        },
        update: {
          designJobId: created.id,
          status: nextPrepStatus,
          statusUpdatedAt: new Date(),
        },
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
    const existing = await tx.designJob.findFirst({
      where: {
        id: jobId,
        organisationId: actor.organisationId,
      },
      select: {
        id: true,
        memberId: true,
      },
    });

    if (!existing) {
      throw new DesignJobNotFoundError();
    }

    if (input.memberId !== undefined && input.memberId !== null) {
      const member = await tx.member.findFirst({
        where: {
          id: input.memberId,
          organisationId: actor.organisationId,
        },
        select: { id: true, archivedAt: true },
      });
      if (!member) {
        throw new MemberNotFoundError();
      }
      if (member.archivedAt !== null && input.memberId !== existing.memberId) {
        throw new DesignJobValidationError(
          'Restore archived member before linking them to this design job.'
        );
      }
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

    const updated = await tx.designJob.update({
      where: { id: existing.id },
      data: updateData,
      select: DESIGN_JOB_DETAIL_SELECT,
    });

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

    return mapDesignJobDetail(updated);
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

