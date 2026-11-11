/**
 * CRELUNE — Organisation-Scoped Member Directory Service
 *
 * Enforces owner organisation scoping, normalized duplicate detection,
 * concurrency-safe transaction locking on member creation, derived `archivedAt`
 * lifecycle rules, and atomic application-level audit logging.
 */

import { Prisma, prisma } from '@crelune/database';
import {
  isMemberActive,
  isMemberArchived,
  normalizeMemberName,
  normalizeMemberPhone,
  validateBirthdayTuple,
  type CreateMemberInput,
  type DuplicateCandidateSummary,
  type DuplicateMatchReason,
  type MemberDetail,
  type MemberDirectoryItem,
  type MemberListQuery,
  type MemberPaginationMeta,
  type UpdateMemberInput,
} from '@crelune/shared';
import * as auditService from '@/lib/audit/audit-service';

export interface MemberActorContext {
  userId: string;
  organisationId: string;
}

export class MemberDuplicateError extends Error {
  public readonly candidates: DuplicateCandidateSummary[];

  constructor(candidates: DuplicateCandidateSummary[]) {
    super('A potential duplicate member already exists in this organisation.');
    this.name = 'MemberDuplicateError';
    this.candidates = candidates;
  }
}

export class MemberNotFoundError extends Error {
  constructor() {
    super('Member not found.');
    this.name = 'MemberNotFoundError';
  }
}

export class MemberValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MemberValidationError';
  }
}

const MEMBER_LIST_SELECT = {
  id: true,
  fullName: true,
  preferredName: true,
  birthDay: true,
  birthMonth: true,
  birthYear: true,
  phone: true,
  email: true,
  photoStorageKey: true,
  photoUpdatedAt: true,
  archivedAt: true,
  createdAt: true,
  updatedAt: true,
} as const;

export const MEMBER_DETAIL_SELECT = {
  ...MEMBER_LIST_SELECT,
  notes: true,
} as const;

type MemberListRow = Prisma.MemberGetPayload<{ select: typeof MEMBER_LIST_SELECT }>;
export type MemberDetailRow = Prisma.MemberGetPayload<{ select: typeof MEMBER_DETAIL_SELECT }>;

export function mapMemberDirectoryItem(row: MemberListRow): MemberDirectoryItem {
  return {
    id: row.id,
    fullName: row.fullName,
    preferredName: row.preferredName ?? null,
    birthDay: row.birthDay ?? null,
    birthMonth: row.birthMonth ?? null,
    birthYear: row.birthYear ?? null,
    phone: row.phone ?? null,
    email: row.email ?? null,
    hasPhoto: Boolean(row.photoStorageKey),
    photoUpdatedAt: row.photoUpdatedAt ? row.photoUpdatedAt.toISOString() : null,
    isActive: isMemberActive(row),
    archivedAt: row.archivedAt ? row.archivedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function mapMemberDetail(row: MemberDetailRow): MemberDetail {
  return {
    ...mapMemberDirectoryItem(row),
    notes: row.notes ?? null,
  };
}

export interface DuplicateCandidateRow {
  id: string;
  fullName: string;
  preferredName: string | null;
  normalizedName: string;
  normalizedPhone: string | null;
  birthMonth: number | null;
  birthDay: number | null;
  archivedAt: Date | null;
}

const DUPLICATE_PRIORITY: Record<DuplicateMatchReason, number> = {
  PHONE_AND_NAME: 0,
  PHONE: 1,
  NAME: 2,
};

/**
 * Classifies and prioritizes candidate duplicate matches using normalized phone
 * (strong signal) and normalized full name (possible duplicate). Includes archived
 * members so previously registered records do not silently disappear.
 */
export function classifyDuplicateCandidates(
  rows: DuplicateCandidateRow[],
  targetNormalizedPhone: string | null,
  targetNormalizedName: string
): DuplicateCandidateSummary[] {
  const summaries: DuplicateCandidateSummary[] = [];

  for (const row of rows) {
    const phoneMatch =
      Boolean(targetNormalizedPhone) &&
      Boolean(row.normalizedPhone) &&
      row.normalizedPhone === targetNormalizedPhone;
    const nameMatch = row.normalizedName === targetNormalizedName;

    if (!phoneMatch && !nameMatch) {
      continue;
    }

    const matchReason: DuplicateMatchReason =
      phoneMatch && nameMatch ? 'PHONE_AND_NAME' : phoneMatch ? 'PHONE' : 'NAME';

    summaries.push({
      id: row.id,
      fullName: row.fullName,
      preferredName: row.preferredName,
      birthMonth: row.birthMonth,
      birthDay: row.birthDay,
      isArchived: isMemberArchived(row),
      matchReason,
    });
  }

  return summaries.sort(
    (a, b) =>
      DUPLICATE_PRIORITY[a.matchReason] - DUPLICATE_PRIORITY[b.matchReason] ||
      Number(a.isArchived) - Number(b.isArchived)
  );
}

/**
 * Creates a member scoped strictly to `actor.organisationId`, guarding against
 * concurrent duplicate creation with an organisation-scoped PostgreSQL transaction
 * advisory lock and recording an atomic audit event.
 */
export async function createMember(
  actor: MemberActorContext,
  input: CreateMemberInput
): Promise<MemberDetail> {
  const normalizedName = normalizeMemberName(input.fullName);
  const normalizedPhone = normalizeMemberPhone(input.phone ?? null);

  return prisma.$transaction(async (tx) => {
    // Serialize duplicate-checked member creation per organisation across concurrent requests.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`member_create:${actor.organisationId}`}))`;

    const duplicateWhereOr: Prisma.MemberWhereInput[] = [{ normalizedName }];
    if (normalizedPhone) {
      duplicateWhereOr.push({ normalizedPhone });
    }

    const existingMatches = await tx.member.findMany({
      where: {
        organisationId: actor.organisationId,
        OR: duplicateWhereOr,
      },
      select: {
        id: true,
        fullName: true,
        preferredName: true,
        normalizedName: true,
        normalizedPhone: true,
        birthMonth: true,
        birthDay: true,
        archivedAt: true,
      },
      take: 10,
    });

    const candidates = classifyDuplicateCandidates(
      existingMatches,
      normalizedPhone,
      normalizedName
    );

    if (candidates.length > 0 && !input.confirmDuplicate) {
      throw new MemberDuplicateError(candidates);
    }

    const created = await tx.member.create({
      data: {
        organisationId: actor.organisationId,
        fullName: input.fullName,
        preferredName: input.preferredName ?? null,
        normalizedName,
        birthMonth: input.birthMonth ?? null,
        birthDay: input.birthDay ?? null,
        birthYear: input.birthYear ?? null,
        phone: input.phone ?? null,
        normalizedPhone,
        email: input.email ?? null,
        notes: input.notes ?? null,
      },
      select: MEMBER_DETAIL_SELECT,
    });

    await auditService.recordAuditEvent(tx, {
      organisationId: actor.organisationId,
      actorUserId: actor.userId,
      action: auditService.AUDIT_ACTIONS.MEMBER_CREATED,
      entityType: 'Member',
      entityId: created.id,
      metadata: {
        hasBirthday: created.birthMonth !== null && created.birthDay !== null,
        hasBirthYear: created.birthYear !== null,
        hasPhone: created.phone !== null,
        hasEmail: created.email !== null,
        hasNotes: created.notes !== null,
        duplicateConfirmed: Boolean(input.confirmDuplicate && candidates.length > 0),
      },
    });

    return mapMemberDetail(created);
  }, { maxWait: 10000, timeout: 15000 });
}

function buildMemberOrderBy(
  sort: MemberListQuery['sort']
): Prisma.MemberOrderByWithRelationInput[] {
  switch (sort) {
    case 'name_desc':
      return [{ normalizedName: 'desc' }, { id: 'asc' }];
    case 'birthday_asc':
      return [
        { birthMonth: { sort: 'asc', nulls: 'last' } },
        { birthDay: { sort: 'asc', nulls: 'last' } },
        { normalizedName: 'asc' },
        { id: 'asc' },
      ];
    case 'recent':
      return [{ createdAt: 'desc' }, { id: 'asc' }];
    case 'name_asc':
    default:
      return [{ normalizedName: 'asc' }, { id: 'asc' }];
  }
}

/**
 * Lists paginated members strictly scoped to `organisationId`.
 * Explicitly omits private member `notes` from directory list projections.
 */
export async function listMembers(
  organisationId: string,
  query: MemberListQuery
): Promise<{ members: MemberDirectoryItem[]; pagination: MemberPaginationMeta }> {
  const where: Prisma.MemberWhereInput = {
    organisationId,
  };

  if (query.status === 'active') {
    where.archivedAt = null;
  } else if (query.status === 'archived') {
    where.archivedAt = { not: null };
  }

  if (query.birthMonth !== undefined) {
    where.birthMonth = query.birthMonth;
  }

  if (query.q) {
    const normalizedSearch = normalizeMemberName(query.q);
    const phoneDigits = query.q.replace(/\D+/g, '');
    const searchOr: Prisma.MemberWhereInput[] = [
      { normalizedName: { contains: normalizedSearch } },
      { fullName: { contains: query.q, mode: 'insensitive' } },
      { preferredName: { contains: query.q, mode: 'insensitive' } },
    ];
    if (phoneDigits.length >= 3) {
      searchOr.push({ normalizedPhone: { contains: phoneDigits } });
    }
    where.AND = [{ OR: searchOr }];
  }

  const skip = (query.page - 1) * query.limit;
  const orderBy = buildMemberOrderBy(query.sort);

  const [total, rows] = await Promise.all([
    prisma.member.count({ where }),
    prisma.member.findMany({
      where,
      orderBy,
      skip,
      take: query.limit,
      select: MEMBER_LIST_SELECT,
    }),
  ]);

  const totalPages = total === 0 ? 0 : Math.ceil(total / query.limit);

  return {
    members: rows.map(mapMemberDirectoryItem),
    pagination: {
      page: query.page,
      limit: query.limit,
      total,
      totalPages,
      hasNextPage: query.page < totalPages,
      hasPreviousPage: query.page > 1 && total > 0,
    },
  };
}

/**
 * Retrieves a single member strictly scoped to `organisationId`.
 */
export async function getMemberById(
  organisationId: string,
  memberId: string
): Promise<MemberDetail> {
  const row = await prisma.member.findFirst({
    where: {
      id: memberId,
      organisationId,
    },
    select: MEMBER_DETAIL_SELECT,
  });

  if (!row) {
    throw new MemberNotFoundError();
  }

  return mapMemberDetail(row);
}

/**
 * Updates an organisation-scoped member record atomically with change-field audit metadata.
 * Re-validates the merged birthday tuple against existing database columns so partial
 * updates cannot persist an invalid or half-specified birthday.
 */
export async function updateMember(
  actor: MemberActorContext,
  memberId: string,
  input: UpdateMemberInput
): Promise<MemberDetail> {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.member.findFirst({
      where: {
        id: memberId,
        organisationId: actor.organisationId,
      },
    });

    if (!existing) {
      throw new MemberNotFoundError();
    }

    const nextBirthMonth =
      input.birthMonth !== undefined ? input.birthMonth : existing.birthMonth;
    const nextBirthDay =
      input.birthDay !== undefined ? input.birthDay : existing.birthDay;
    const nextBirthYear =
      input.birthYear !== undefined ? input.birthYear : existing.birthYear;

    const birthdayCheck = validateBirthdayTuple({
      birthMonth: nextBirthMonth,
      birthDay: nextBirthDay,
      birthYear: nextBirthYear,
    });
    if (!birthdayCheck.valid) {
      throw new MemberValidationError(birthdayCheck.reason);
    }

    const updateData: Prisma.MemberUpdateInput = {};
    const changedFields: string[] = [];

    if (input.fullName !== undefined && input.fullName !== existing.fullName) {
      updateData.fullName = input.fullName;
      updateData.normalizedName = normalizeMemberName(input.fullName);
      changedFields.push('fullName');
    }
    if (
      input.preferredName !== undefined &&
      input.preferredName !== existing.preferredName
    ) {
      updateData.preferredName = input.preferredName;
      changedFields.push('preferredName');
    }
    if (nextBirthMonth !== existing.birthMonth) {
      updateData.birthMonth = nextBirthMonth;
      changedFields.push('birthMonth');
    }
    if (nextBirthDay !== existing.birthDay) {
      updateData.birthDay = nextBirthDay;
      changedFields.push('birthDay');
    }
    if (nextBirthYear !== existing.birthYear) {
      updateData.birthYear = nextBirthYear;
      changedFields.push('birthYear');
    }
    if (input.phone !== undefined && input.phone !== existing.phone) {
      updateData.phone = input.phone;
      updateData.normalizedPhone = normalizeMemberPhone(input.phone);
      changedFields.push('phone');
    }
    if (input.email !== undefined && input.email !== existing.email) {
      updateData.email = input.email;
      changedFields.push('email');
    }
    if (input.notes !== undefined && input.notes !== existing.notes) {
      updateData.notes = input.notes;
      changedFields.push('notes');
    }

    if (changedFields.length === 0) {
      return mapMemberDetail(existing);
    }

    const updated = await tx.member.update({
      where: { id: existing.id },
      data: updateData,
      select: MEMBER_DETAIL_SELECT,
    });

    await auditService.recordAuditEvent(tx, {
      organisationId: actor.organisationId,
      actorUserId: actor.userId,
      action: auditService.AUDIT_ACTIONS.MEMBER_UPDATED,
      entityType: 'Member',
      entityId: updated.id,
      metadata: { changedFields },
    });

    return mapMemberDetail(updated);
  }, { maxWait: 10000, timeout: 15000 });
}

async function setMemberArchiveState(
  actor: MemberActorContext,
  memberId: string,
  targetArchived: boolean
): Promise<{ member: MemberDetail; changed: boolean }> {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.member.findFirst({
      where: {
        id: memberId,
        organisationId: actor.organisationId,
      },
      select: MEMBER_DETAIL_SELECT,
    });

    if (!existing) {
      throw new MemberNotFoundError();
    }

    const currentlyArchived = isMemberArchived(existing);
    if (currentlyArchived === targetArchived) {
      return { member: mapMemberDetail(existing), changed: false };
    }

    const updated = await tx.member.update({
      where: { id: existing.id },
      data: {
        archivedAt: targetArchived ? new Date() : null,
      },
      select: MEMBER_DETAIL_SELECT,
    });

    await auditService.recordAuditEvent(tx, {
      organisationId: actor.organisationId,
      actorUserId: actor.userId,
      action: targetArchived
        ? auditService.AUDIT_ACTIONS.MEMBER_ARCHIVED
        : auditService.AUDIT_ACTIONS.MEMBER_RESTORED,
      entityType: 'Member',
      entityId: updated.id,
      metadata: {
        targetArchived,
      },
    });

    return { member: mapMemberDetail(updated), changed: true };
  }, { maxWait: 10000, timeout: 15000 });
}

/**
 * Archives an active member by setting `archivedAt` inside an audited transaction.
 */
export async function archiveMember(
  actor: MemberActorContext,
  memberId: string
): Promise<{ member: MemberDetail; changed: boolean }> {
  return setMemberArchiveState(actor, memberId, true);
}

/**
 * Restores an archived member by clearing `archivedAt` inside an audited transaction.
 */
export async function restoreMember(
  actor: MemberActorContext,
  memberId: string
): Promise<{ member: MemberDetail; changed: boolean }> {
  return setMemberArchiveState(actor, memberId, false);
}
