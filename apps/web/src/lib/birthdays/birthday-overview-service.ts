/**
 * CRELUNE — Birthday Calendar, Upcoming Windows, Preparation Lifecycle & Preferences Service
 *
 * Uses pure civil date logic from @crelune/shared to guarantee timezone-safe,
 * leap-day-policy-aware date calculations and excludes archived members from
 * active birthday queues.
 */

import { prisma, type LeapDayPolicy } from '@crelune/database';
import {
  civilDateToUtcMidnight,
  diffCalendarDays,
  getNextBirthdayOccurrence,
  getTodayCivilDate,
  normalizeMemberName,
  resolveCelebrationDateForYear,
  validateBirthdayTuple,
  validateReminderLeadDays,
  type BirthdayCalendarMemberItem,
  type BirthdayOverviewCounts,
  type BirthdayOverviewQuery,
  type BirthdayOverviewResponse,
  type BirthdayPreferencesUpdateInput,
  type BirthdayPrepStatus,
  type BirthdayPrepStatusUpdateInput,
  type BirthdaySyncSummary,
  type DesignJobStatus,
  type OwnerBirthdayPreferencesDto,
} from '@crelune/shared';
import * as auditService from '@/lib/audit/audit-service';
import {
  MemberNotFoundError,
  MemberValidationError,
} from '@/lib/members/member-service';
import { loadOwnerBirthdayPreferences } from './birthday-preferences';
import { reconcileOrganisationBirthdaySchedules } from './birthday-schedule-service';

export interface BirthdayActorContext {
  userId: string;
  organisationId: string;
}

export interface GetBirthdayOverviewOptions {
  now?: Date;
}

function buildCalendarItem(params: {
  member: {
    id: string;
    fullName: string;
    preferredName: string | null;
    birthDay: number;
    birthMonth: number;
    birthYear: number | null;
    photoStorageKey: string | null;
    photoUpdatedAt: Date | null;
  };
  targetYear: number;
  celebratedDateIso: string;
  celebratedMonth: number;
  celebratedDay: number;
  daysUntil: number;
  isLeapDayAdjusted: boolean;
  prep?: {
    id: string;
    status: string;
    notes: string | null;
    designJob: {
      id: string;
      title: string;
      status: string;
    } | null;
  };
}): BirthdayCalendarMemberItem {
  return {
    memberId: params.member.id,
    fullName: params.member.fullName,
    preferredName: params.member.preferredName ?? null,
    birthDay: params.member.birthDay,
    birthMonth: params.member.birthMonth,
    birthYear: params.member.birthYear ?? null,
    hasPhoto: Boolean(params.member.photoStorageKey),
    photoUpdatedAt: params.member.photoUpdatedAt
      ? params.member.photoUpdatedAt.toISOString()
      : null,
    targetYear: params.targetYear,
    celebratedDateIso: params.celebratedDateIso,
    celebratedMonth: params.celebratedMonth,
    celebratedDay: params.celebratedDay,
    daysUntil: params.daysUntil,
    isToday: params.daysUntil === 0,
    isLeapDayAdjusted: params.isLeapDayAdjusted,
    prepId: params.prep?.id ?? null,
    prepStatus: (params.prep?.status as BirthdayPrepStatus) ?? 'UPCOMING',
    prepNotes: params.prep?.notes ?? null,
    designJobId: params.prep?.designJob?.id ?? null,
    designJobTitle: params.prep?.designJob?.title ?? null,
    designJobStatus:
      (params.prep?.designJob?.status as DesignJobStatus | undefined) ?? null,
  };
}

/**
 * Returns upcoming birthday windows, monthly calendar entries, preparation states,
 * and active preferences strictly scoped to `organisationId`.
 */
export async function getBirthdayOverview(
  organisationId: string,
  ownerUserId: string,
  query: BirthdayOverviewQuery,
  options: GetBirthdayOverviewOptions = {}
): Promise<BirthdayOverviewResponse> {
  const now = options.now ?? new Date();
  const settings = await loadOwnerBirthdayPreferences(prisma, ownerUserId);
  const today = getTodayCivilDate(settings.timezone, now);

  const selectedMonth = query.month ?? today.month;
  const selectedYear = query.year ?? today.year;

  const activeMembers = await prisma.member.findMany({
    where: {
      organisationId,
      archivedAt: null,
      birthMonth: { not: null },
      birthDay: { not: null },
    },
    orderBy: [{ normalizedName: 'asc' }, { id: 'asc' }],
    select: {
      id: true,
      fullName: true,
      preferredName: true,
      birthDay: true,
      birthMonth: true,
      birthYear: true,
      photoStorageKey: true,
      photoUpdatedAt: true,
    },
  });

  const relevantYears = Array.from(
    new Set([today.year, today.year + 1, selectedYear])
  );

  const preparations = await prisma.birthdayPreparation.findMany({
    where: {
      organisationId,
      targetYear: { in: relevantYears },
    },
    select: {
      id: true,
      memberId: true,
      targetYear: true,
      status: true,
      notes: true,
      designJob: {
        select: {
          id: true,
          title: true,
          status: true,
        },
      },
    },
  });

  const prepMap = new Map<string, (typeof preparations)[number]>();
  for (const prep of preparations) {
    prepMap.set(`${prep.memberId}:${prep.targetYear}`, prep);
  }

  const normalizedSearch = query.q ? normalizeMemberName(query.q) : null;

  const matchesFilters = (item: BirthdayCalendarMemberItem): boolean => {
    if (normalizedSearch) {
      const nameMatch = normalizeMemberName(item.fullName).includes(normalizedSearch);
      const preferredMatch = item.preferredName
        ? normalizeMemberName(item.preferredName).includes(normalizedSearch)
        : false;
      if (!nameMatch && !preferredMatch) {
        return false;
      }
    }
    if (query.prepStatus !== 'ALL' && item.prepStatus !== query.prepStatus) {
      return false;
    }
    return true;
  };

  const todayList: BirthdayCalendarMemberItem[] = [];
  const thisWeekList: BirthdayCalendarMemberItem[] = [];
  const thisMonthList: BirthdayCalendarMemberItem[] = [];
  const upcomingList: BirthdayCalendarMemberItem[] = [];
  const monthEntries: BirthdayCalendarMemberItem[] = [];

  const counts: BirthdayOverviewCounts = {
    totalWithBirthday: 0,
    todayCount: 0,
    weekCount: 0,
    monthCount: 0,
    upcomingCount: 0,
    awaitingPrepCount: 0,
  };

  for (const rawMember of activeMembers) {
    if (rawMember.birthMonth === null || rawMember.birthDay === null) {
      continue;
    }

    const birthdayCheck = validateBirthdayTuple({
      birthMonth: rawMember.birthMonth,
      birthDay: rawMember.birthDay,
      birthYear: rawMember.birthYear,
    });
    if (!birthdayCheck.valid) {
      continue;
    }

    const member = {
      ...rawMember,
      birthMonth: rawMember.birthMonth,
      birthDay: rawMember.birthDay,
    };

    counts.totalWithBirthday += 1;

    const nextOccurrence = getNextBirthdayOccurrence(
      {
        birthMonth: member.birthMonth,
        birthDay: member.birthDay,
        birthYear: member.birthYear,
      },
      today,
      settings.leapDayPolicy
    );

    const nextPrep = prepMap.get(`${member.id}:${nextOccurrence.targetYear}`);
    const nextItem = buildCalendarItem({
      member,
      targetYear: nextOccurrence.targetYear,
      celebratedDateIso: nextOccurrence.celebrationIsoDate,
      celebratedMonth: nextOccurrence.celebrationDate.month,
      celebratedDay: nextOccurrence.celebrationDate.day,
      daysUntil: nextOccurrence.daysUntil,
      isLeapDayAdjusted: nextOccurrence.observedDueToLeapPolicy,
      prep: nextPrep,
    });

    if (nextItem.daysUntil === 0) {
      counts.todayCount += 1;
    }
    if (nextItem.daysUntil >= 0 && nextItem.daysUntil <= 7) {
      counts.weekCount += 1;
    }
    if (
      nextOccurrence.celebrationDate.year === today.year &&
      nextOccurrence.celebrationDate.month === today.month &&
      nextItem.daysUntil >= 0
    ) {
      counts.monthCount += 1;
    }
    if (nextItem.daysUntil >= 0 && nextItem.daysUntil <= 30) {
      counts.upcomingCount += 1;
      if (
        nextItem.prepStatus !== 'PUBLISHED' &&
        nextItem.prepStatus !== 'SKIPPED'
      ) {
        counts.awaitingPrepCount += 1;
      }
    }

    if (matchesFilters(nextItem)) {
      if (nextItem.daysUntil === 0) {
        todayList.push(nextItem);
      }
      if (nextItem.daysUntil >= 0 && nextItem.daysUntil <= 7) {
        thisWeekList.push(nextItem);
      }
      if (
        nextOccurrence.celebrationDate.year === today.year &&
        nextOccurrence.celebrationDate.month === today.month &&
        nextItem.daysUntil >= 0
      ) {
        thisMonthList.push(nextItem);
      }
      if (nextItem.daysUntil >= 0 && nextItem.daysUntil <= 30) {
        upcomingList.push(nextItem);
      }
    }

    // Monthly calendar resolves all birthdays celebrated in the viewed (selectedYear, selectedMonth)
    const monthResolution = resolveCelebrationDateForYear(
      member.birthMonth,
      member.birthDay,
      selectedYear,
      settings.leapDayPolicy
    );
    if (monthResolution.date.month === selectedMonth) {
      const selectedPrep = prepMap.get(`${member.id}:${selectedYear}`);
      const calendarItem = buildCalendarItem({
        member,
        targetYear: selectedYear,
        celebratedDateIso: monthResolution.isoDate,
        celebratedMonth: monthResolution.date.month,
        celebratedDay: monthResolution.date.day,
        daysUntil: diffCalendarDays(today, monthResolution.date),
        isLeapDayAdjusted: monthResolution.observedDueToLeapPolicy,
        prep: selectedPrep,
      });

      if (matchesFilters(calendarItem)) {
        monthEntries.push(calendarItem);
      }
    }
  }

  const sortUpcoming = (
    a: BirthdayCalendarMemberItem,
    b: BirthdayCalendarMemberItem
  ) => a.daysUntil - b.daysUntil || a.fullName.localeCompare(b.fullName);

  todayList.sort(sortUpcoming);
  thisWeekList.sort(sortUpcoming);
  thisMonthList.sort(sortUpcoming);
  upcomingList.sort(sortUpcoming);
  monthEntries.sort(
    (a, b) =>
      a.celebratedDay - b.celebratedDay || a.fullName.localeCompare(b.fullName)
  );

  const todayIso = `${String(today.year).padStart(4, '0')}-${String(
    today.month
  ).padStart(2, '0')}-${String(today.day).padStart(2, '0')}`;

  return {
    timezone: settings.timezone,
    leapDayPolicy: settings.leapDayPolicy,
    todayIso,
    selectedMonth,
    selectedYear,
    preferences: {
      timezone: settings.timezone,
      leapDayPolicy: settings.leapDayPolicy,
      birthdayReminderDays: settings.birthdayReminderDays,
    },
    counts,
    today: todayList,
    thisWeek: thisWeekList,
    thisMonth: thisMonthList,
    upcoming: upcomingList,
    monthEntries,
  };
}

/**
 * Manually updates a member's annual `BirthdayPreparation` workflow status.
 * Never infers `PUBLISHED` from design exports; status updates are explicit and audited.
 */
export async function updateBirthdayPreparationStatus(
  actor: BirthdayActorContext,
  memberId: string,
  targetYear: number,
  input: BirthdayPrepStatusUpdateInput
): Promise<{
  id: string;
  memberId: string;
  targetYear: number;
  status: BirthdayPrepStatus;
  notes: string | null;
  statusUpdatedAt: string;
}> {
  if (!Number.isInteger(targetYear) || targetYear < 2000 || targetYear > 2200) {
    throw new MemberValidationError('Birthday target year must be a whole number between 2000 and 2200.');
  }

  return prisma.$transaction(async (tx) => {
    const member = await tx.member.findFirst({
      where: {
        id: memberId,
        organisationId: actor.organisationId,
      },
      select: {
        id: true,
        birthMonth: true,
        birthDay: true,
        archivedAt: true,
      },
    });

    if (!member) {
      throw new MemberNotFoundError();
    }
    if (member.archivedAt !== null) {
      throw new MemberValidationError(
        'Restore archived member before updating birthday preparation status.'
      );
    }
    if (member.birthMonth === null || member.birthDay === null) {
      throw new MemberValidationError(
        'Cannot update birthday preparation status for a member without a recorded birthday.'
      );
    }

    const settings = await loadOwnerBirthdayPreferences(tx, actor.userId);
    const celebration = resolveCelebrationDateForYear(
      member.birthMonth,
      member.birthDay,
      targetYear,
      settings.leapDayPolicy
    );

    const existing = await tx.birthdayPreparation.findUnique({
      where: {
        memberId_targetYear: {
          memberId: member.id,
          targetYear,
        },
      },
      select: {
        id: true,
        status: true,
        notes: true,
      },
    });

    const nextNotes =
      input.notes !== undefined ? input.notes : (existing?.notes ?? null);

    const saved = await tx.birthdayPreparation.upsert({
      where: {
        memberId_targetYear: {
          memberId: member.id,
          targetYear,
        },
      },
      create: {
        organisationId: actor.organisationId,
        memberId: member.id,
        targetYear,
        celebrationDate: civilDateToUtcMidnight(celebration.date),
        status: input.status,
        notes: nextNotes,
        statusUpdatedAt: new Date(),
      },
      update: {
        status: input.status,
        notes: nextNotes,
        celebrationDate: civilDateToUtcMidnight(celebration.date),
        statusUpdatedAt: new Date(),
      },
      select: {
        id: true,
        memberId: true,
        targetYear: true,
        status: true,
        notes: true,
        statusUpdatedAt: true,
      },
    });

    await auditService.recordAuditEvent(tx, {
      organisationId: actor.organisationId,
      actorUserId: actor.userId,
      action: auditService.AUDIT_ACTIONS.BIRTHDAY_PREP_UPDATED,
      entityType: 'BirthdayPreparation',
      entityId: saved.id,
      metadata: {
        memberId: member.id,
        targetYear,
        previousStatus: existing?.status ?? null,
        newStatus: saved.status,
      },
    });

    return {
      id: saved.id,
      memberId: saved.memberId,
      targetYear: saved.targetYear,
      status: saved.status as BirthdayPrepStatus,
      notes: saved.notes ?? null,
      statusUpdatedAt: saved.statusUpdatedAt.toISOString(),
    };
  }, { maxWait: 10000, timeout: 15000 });
}

/**
 * Updates owner timezone, leap-day policy, and reminder intervals, records an audit event,
 * and reconciles existing PENDING schedules safely without altering SENT reminder history.
 */
export async function updateOwnerBirthdayPreferences(
  actor: BirthdayActorContext,
  input: BirthdayPreferencesUpdateInput
): Promise<{
  preferences: OwnerBirthdayPreferencesDto;
  reconciliation: BirthdaySyncSummary;
}> {
  const leadDaysCheck = validateReminderLeadDays(input.birthdayReminderDays);
  if (!leadDaysCheck.valid) {
    throw new MemberValidationError(leadDaysCheck.reason);
  }

  const normalizedLeadDays = leadDaysCheck.leadDays;
  const maxLeadDay =
    normalizedLeadDays.length > 0 ? Math.max(...normalizedLeadDays) : 0;

  const updatedPrefs = await prisma.$transaction(async (tx) => {
    const saved = await tx.userPreference.upsert({
      where: { userId: actor.userId },
      create: {
        userId: actor.userId,
        timezone: input.timezone,
        leapDayPolicy: input.leapDayPolicy as LeapDayPolicy,
        birthdayReminderDays: normalizedLeadDays,
        leadTimeDaysBirthday: maxLeadDay,
      },
      update: {
        timezone: input.timezone,
        leapDayPolicy: input.leapDayPolicy as LeapDayPolicy,
        birthdayReminderDays: normalizedLeadDays,
        leadTimeDaysBirthday: maxLeadDay,
      },
      select: {
        id: true,
        timezone: true,
        leapDayPolicy: true,
        birthdayReminderDays: true,
      },
    });

    await auditService.recordAuditEvent(tx, {
      organisationId: actor.organisationId,
      actorUserId: actor.userId,
      action: auditService.AUDIT_ACTIONS.BIRTHDAY_PREFERENCES_UPDATED,
      entityType: 'UserPreference',
      entityId: saved.id,
      metadata: {
        timezone: saved.timezone,
        leapDayPolicy: saved.leapDayPolicy,
        birthdayReminderDays: saved.birthdayReminderDays,
      },
    });

    return saved;
  }, { maxWait: 10000, timeout: 15000 });

  const scheduleSummary = await reconcileOrganisationBirthdaySchedules(
    actor.organisationId,
    actor.userId
  );

  const unreadNotificationCount = await prisma.notification.count({
    where: {
      organisationId: actor.organisationId,
      userId: actor.userId,
      readAt: null,
    },
  });

  return {
    preferences: {
      timezone: updatedPrefs.timezone,
      leapDayPolicy: updatedPrefs.leapDayPolicy,
      birthdayReminderDays: [...updatedPrefs.birthdayReminderDays],
    },
    reconciliation: {
      schedulesCreated: scheduleSummary.schedulesCreated,
      schedulesUpdated: scheduleSummary.schedulesUpdated,
      schedulesCancelled: scheduleSummary.schedulesCancelled,
      preparationsSynced: scheduleSummary.preparationsSynced,
      remindersDue: 0,
      notificationsCreated: 0,
      remindersSkipped: scheduleSummary.remindersSkipped,
      remindersFailed: 0,
      unreadNotificationCount,
    },
  };
}

