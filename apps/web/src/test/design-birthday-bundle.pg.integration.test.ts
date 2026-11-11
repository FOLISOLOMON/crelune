import crypto from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { prisma, type LeapDayPolicy } from '@crelune/database';
import { addCalendarDays, getTodayCivilDate } from '@crelune/shared';
import { AUDIT_ACTIONS } from '@/lib/audit/audit-service';
import {
  getBirthdayOverview,
  updateBirthdayPreparationStatus,
  updateOwnerBirthdayPreferences,
} from '@/lib/birthdays/birthday-overview-service';
import { getDashboardSnapshot } from '@/lib/dashboard/dashboard-service';
import {
  createDesignJob,
  DesignJobNotFoundError,
  DesignJobTransitionError,
  DesignJobValidationError,
  getDesignJobById,
  listDesignJobs,
  transitionDesignJobStatus,
  updateDesignJob,
} from '@/lib/designs/design-job-service';
import { reconcileOrganisationBirthdaySchedules } from '@/lib/birthdays/birthday-schedule-service';
import { processDueBirthdayReminders } from '@/lib/birthdays/birthday-processor-service';
import { MemberValidationError } from '@/lib/members/member-service';
import { assertSafeDevDatabaseEnvironment } from './assert-dev-db';

describe('PostgreSQL Stage 3.6 & Milestone 4 Integration (Neon Development)', () => {
  const runId = crypto.randomBytes(6).toString('hex');
  const createdOrgIds = new Set<string>();

  async function createTestOrgAndOwner(
    suffix: string,
    preferences?: {
      timezone?: string;
      leapDayPolicy?: LeapDayPolicy;
      birthdayReminderDays?: number[];
    }
  ) {
    const org = await prisma.organisation.create({
      data: {
        name: `__pg_bundle_${runId}_${suffix}`,
        slug: `__pg-bundle-${runId}-${suffix}`,
      },
    });
    createdOrgIds.add(org.id);

    const user = await prisma.user.create({
      data: {
        organisationId: org.id,
        email: `__pg_bundle_${suffix}_${runId}@crelune.test`,
        passwordHash: 'not-a-real-hash',
        firstName: 'Bundle',
        lastName: suffix,
        role: 'OWNER',
      },
    });

    if (preferences) {
      await prisma.userPreference.create({
        data: {
          userId: user.id,
          timezone: preferences.timezone ?? 'Africa/Accra',
          leapDayPolicy: preferences.leapDayPolicy ?? 'FEB_28',
          birthdayReminderDays: preferences.birthdayReminderDays ?? [7, 3, 1, 0],
        },
      });
    }

    return {
      org,
      user,
      actor: { userId: user.id, organisationId: org.id },
    };
  }

  async function cleanupTestOrgs() {
    if (createdOrgIds.size === 0) return;
    const orgIds = Array.from(createdOrgIds);
    await prisma.designJobHistory.deleteMany({
      where: { organisationId: { in: orgIds } },
    });
    await prisma.birthdayPreparation.deleteMany({
      where: { organisationId: { in: orgIds } },
    });
    await prisma.designJob.deleteMany({
      where: { organisationId: { in: orgIds } },
    });
    await prisma.auditLog.deleteMany({
      where: { organisationId: { in: orgIds } },
    });
    await prisma.notification.deleteMany({
      where: { organisationId: { in: orgIds } },
    });
    await prisma.birthdayReminder.deleteMany({
      where: { organisationId: { in: orgIds } },
    });
    await prisma.member.deleteMany({
      where: { organisationId: { in: orgIds } },
    });
    await prisma.user.deleteMany({
      where: { organisationId: { in: orgIds } },
    });
    await prisma.organisation.deleteMany({
      where: { id: { in: orgIds } },
    });
    createdOrgIds.clear();
  }

  beforeAll(async () => {
    assertSafeDevDatabaseEnvironment(process.env);
  });

  afterEach(async () => {
    await cleanupTestOrgs();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('excludes archived members from BirthdayOverview, resolves leap-day policies, and prevents prep updates on archived members', async () => {
    const { actor } = await createTestOrgAndOwner('overview_leap', {
      timezone: 'Africa/Accra',
      leapDayPolicy: 'MAR_1',
      birthdayReminderDays: [7, 1, 0],
    });

    const activeLeapMember = await prisma.member.create({
      data: {
        organisationId: actor.organisationId,
        fullName: 'Esi Leapmember',
        normalizedName: 'esi leapmember',
        birthMonth: 2,
        birthDay: 29,
        birthYear: null,
      },
    });

    const archivedMember = await prisma.member.create({
      data: {
        organisationId: actor.organisationId,
        fullName: 'Archived Member',
        normalizedName: 'archived member',
        birthMonth: 3,
        birthDay: 2,
        archivedAt: new Date('2026-01-01T00:00:00.000Z'),
      },
    });

    const overview = await getBirthdayOverview(
      actor.organisationId,
      actor.userId,
      { month: 3, year: 2026, prepStatus: 'ALL' },
      { now: new Date('2026-02-26T10:00:00.000Z') }
    );

    expect(overview.counts.totalWithBirthday).toBe(1);
    expect(overview.monthEntries).toHaveLength(1);
    expect(overview.monthEntries[0]).toMatchObject({
      memberId: activeLeapMember.id,
      celebratedDateIso: '2026-03-01',
      isLeapDayAdjusted: true,
      birthYear: null,
      daysUntil: 3,
    });
    expect(
      overview.upcoming.find((item) => item.memberId === archivedMember.id)
    ).toBeUndefined();

    await expect(
      updateBirthdayPreparationStatus(actor, archivedMember.id, 2026, {
        status: 'PREPARATION_PENDING',
      })
    ).rejects.toThrow(MemberValidationError);
  });

  it('reconciles PENDING schedules on Birthday Preferences updates without overwriting SENT reminder history', async () => {
    const now = new Date();
    const todayAccra = getTodayCivilDate('Africa/Accra', now);
    const celebration = addCalendarDays(todayAccra, 7);

    const { actor } = await createTestOrgAndOwner('prefs_reconcile', {
      timezone: 'Africa/Accra',
      leapDayPolicy: 'FEB_28',
      birthdayReminderDays: [7, 3, 1],
    });

    const member = await prisma.member.create({
      data: {
        organisationId: actor.organisationId,
        fullName: 'Ama Schedule',
        normalizedName: 'ama schedule',
        birthMonth: celebration.month,
        birthDay: celebration.day,
      },
    });

    await reconcileOrganisationBirthdaySchedules(actor.organisationId, actor.userId, {
      now,
    });
    await processDueBirthdayReminders(actor.organisationId, actor.userId, {
      now,
    });

    const sentBefore = await prisma.birthdayReminder.findFirstOrThrow({
      where: {
        memberId: member.id,
        targetYear: celebration.year,
        leadDays: 7,
      },
    });
    expect(sentBefore.status).toBe('SENT');

    const updated = await updateOwnerBirthdayPreferences(actor, {
      timezone: 'Europe/London',
      leapDayPolicy: 'MAR_1',
      birthdayReminderDays: [7, 0],
    });

    expect(updated.preferences).toEqual({
      timezone: 'Europe/London',
      leapDayPolicy: 'MAR_1',
      birthdayReminderDays: [7, 0],
    });

    const allReminders = await prisma.birthdayReminder.findMany({
      where: { memberId: member.id, targetYear: celebration.year },
    });
    expect(allReminders.find((r) => r.leadDays === 7)?.status).toBe('SENT');
    expect(allReminders.find((r) => r.leadDays === 3)?.status).toBe('CANCELLED');
    expect(allReminders.find((r) => r.leadDays === 1)?.status).toBe('CANCELLED');
    expect(allReminders.find((r) => r.leadDays === 0)?.status).toBe('PENDING');

    const auditEntry = await prisma.auditLog.findFirst({
      where: {
        organisationId: actor.organisationId,
        action: AUDIT_ACTIONS.BIRTHDAY_PREFERENCES_UPDATED,
      },
    });
    expect(auditEntry).not.toBeNull();
  }, 60_000);

  it('manages full DesignJob lifecycle, links BirthdayPreparation, keeps EXPORTED distinct from PUBLISHED, and enforces org isolation', async () => {
    const { actor: actorA } = await createTestOrgAndOwner('design_a');
    const { actor: actorB } = await createTestOrgAndOwner('design_b');

    const member = await prisma.member.create({
      data: {
        organisationId: actorA.organisationId,
        fullName: 'Kofi Design',
        normalizedName: 'kofi design',
        birthMonth: 11,
        birthDay: 20,
      },
    });

    const created = await createDesignJob(actorA, {
      title: 'Kofi Birthday Flyer 2026',
      category: 'BIRTHDAY_FLYER',
      priority: 'HIGH',
      initialStatus: 'DRAFT',
      memberId: member.id,
      birthdayTargetYear: 2026,
      targetPlatform: 'Instagram',
      dimensions: '1080x1350',
      dueDate: '2026-11-18',
      requiredText: 'Happy Birthday Kofi',
    });

    expect(created.status).toBe('DRAFT');
    expect(created.history).toHaveLength(1);

    const linkedPrep = await prisma.birthdayPreparation.findUniqueOrThrow({
      where: {
        memberId_targetYear: {
          memberId: member.id,
          targetYear: 2026,
        },
      },
    });
    expect(linkedPrep.designJobId).toBe(created.id);
    expect(linkedPrep.status).toBe('PREPARATION_PENDING');

    const edited = await updateDesignJob(actorA, created.id, {
      dimensions: '1080x1920',
      notes: 'Updated to Story dimensions',
    });
    expect(edited.dimensions).toBe('1080x1920');

    // Disallowed jump DRAFT -> PUBLISHED fails cleanly
    await expect(
      transitionDesignJobStatus(actorA, created.id, {
        status: 'PUBLISHED',
      })
    ).rejects.toThrow(DesignJobTransitionError);

    await transitionDesignJobStatus(actorA, created.id, {
      status: 'IN_PROGRESS',
      note: 'Started layout in Affinity',
    });
    await transitionDesignJobStatus(actorA, created.id, {
      status: 'AWAITING_REVIEW',
    });
    await transitionDesignJobStatus(actorA, created.id, {
      status: 'APPROVED',
    });
    const exported = await transitionDesignJobStatus(actorA, created.id, {
      status: 'EXPORTED',
      note: 'Exported lossless PNG',
    });

    // EXPORTED never auto-publishes
    expect(exported.status).toBe('EXPORTED');
    expect(exported.exportedAt).not.toBeNull();
    expect(exported.publishedAt).toBeNull();

    const prepWhileExported = await prisma.birthdayPreparation.findUniqueOrThrow({
      where: { id: linkedPrep.id },
    });
    expect(prepWhileExported.status).toBe('AWAITING_APPROVAL');

    // Explicit publication transition
    const published = await transitionDesignJobStatus(actorA, created.id, {
      status: 'PUBLISHED',
      note: 'Posted on main feed',
    });
    expect(published.status).toBe('PUBLISHED');
    expect(published.publishedAt).not.toBeNull();
    expect(published.history.length).toBe(6);

    const prepAfterPublish = await prisma.birthdayPreparation.findUniqueOrThrow({
      where: { id: linkedPrep.id },
    });
    expect(prepAfterPublish.status).toBe('PUBLISHED');

    // Cross-organisation access rejected
    await expect(
      getDesignJobById(actorB.organisationId, created.id)
    ).rejects.toThrow(DesignJobNotFoundError);

    // Non-existent member or mismatched birthdayTargetYear rejected
    await expect(
      createDesignJob(actorA, {
        title: 'Bad Year Job',
        category: 'GENERAL_GRAPHIC_DESIGN',
        priority: 'NORMAL',
        initialStatus: 'DRAFT',
        memberId: member.id,
        birthdayTargetYear: null,
      })
    ).resolves.toBeDefined();

    const archivedTarget = await prisma.member.create({
      data: {
        organisationId: actorA.organisationId,
        fullName: 'Archived Target',
        normalizedName: 'archived target',
        archivedAt: new Date(),
      },
    });
    await expect(
      createDesignJob(actorA, {
        title: 'Archived Member Job',
        category: 'GENERAL_GRAPHIC_DESIGN',
        priority: 'NORMAL',
        initialStatus: 'DRAFT',
        memberId: archivedTarget.id,
      })
    ).rejects.toThrow(DesignJobValidationError);

    // Dashboard snapshot & list queries reflect live persisted records
    const snapshot = await getDashboardSnapshot(actorA.organisationId, actorA.userId);
    expect(snapshot.activeMembersCount).toBe(1);
    expect(snapshot.activeDesignJobsCount).toBe(1);

    const listAll = await listDesignJobs(actorA.organisationId, {
      status: 'all',
      category: 'ALL',
      priority: 'ALL',
      page: 1,
      limit: 25,
    });
    expect(listAll.pagination.total).toBe(2);
    expect(listAll.statusCounts.PUBLISHED).toBe(1);
    expect(listAll.statusCounts.DRAFT).toBe(1);
  }, 60_000);
});

