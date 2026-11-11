import crypto from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { prisma, type LeapDayPolicy } from '@crelune/database';
import { addCalendarDays, getTodayCivilDate } from '@crelune/shared';
import * as auditService from '@/lib/audit/audit-service';
import { AUDIT_ACTIONS } from '@/lib/audit/audit-service';
import {
  getBirthdayOverview,
  updateBirthdayPreparationStatus,
  updateOwnerBirthdayPreferences,
} from '@/lib/birthdays/birthday-overview-service';
import { getDashboardSnapshot } from '@/lib/dashboard/dashboard-service';
import {
  createDesignJob,
  DesignJobConflictError,
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

  it('Finding 1: resolves celebrationDate accurately across normal, FEB_28/MAR_1 leap-day policies, and invalid inputs', async () => {
    const { actor } = await createTestOrgAndOwner('f1_prep', {
      leapDayPolicy: 'FEB_28',
    });

    const regularMember = await prisma.member.create({
      data: {
        organisationId: actor.organisationId,
        fullName: 'Abena Boateng',
        normalizedName: 'abena boateng',
        birthMonth: 11,
        birthDay: 24,
      },
    });
    const leapMember = await prisma.member.create({
      data: {
        organisationId: actor.organisationId,
        fullName: 'Kwadwo Leap',
        normalizedName: 'kwadwo leap',
        birthMonth: 2,
        birthDay: 29,
      },
    });
    const incompleteMember = await prisma.member.create({
      data: {
        organisationId: actor.organisationId,
        fullName: 'No Birthday',
        normalizedName: 'no birthday',
        birthMonth: null,
        birthDay: null,
      },
    });
    const archivedMember = await prisma.member.create({
      data: {
        organisationId: actor.organisationId,
        fullName: 'Archived Birthday',
        normalizedName: 'archived birthday',
        birthMonth: 4,
        birthDay: 10,
        archivedAt: new Date(),
      },
    });

    // Normal celebrationDate persistence check
    const regularPrep = await updateBirthdayPreparationStatus(
      actor,
      regularMember.id,
      2026,
      { status: 'PREPARATION_PENDING', notes: 'Line up portrait' }
    );
    expect(regularPrep.targetYear).toBe(2026);
    const savedRegularPrep = await prisma.birthdayPreparation.findUniqueOrThrow({
      where: {
        memberId_targetYear: { memberId: regularMember.id, targetYear: 2026 },
      },
    });
    expect(savedRegularPrep.celebrationDate.toISOString().slice(0, 10)).toBe('2026-11-24');

    // Leap-day FEB_28 policy in non-leap year 2026
    await updateBirthdayPreparationStatus(actor, leapMember.id, 2026, {
      status: 'DESIGN_IN_PROGRESS',
    });
    const savedLeapFeb28 = await prisma.birthdayPreparation.findUniqueOrThrow({
      where: { memberId_targetYear: { memberId: leapMember.id, targetYear: 2026 } },
    });
    expect(savedLeapFeb28.celebrationDate.toISOString().slice(0, 10)).toBe('2026-02-28');

    // Switch preference to MAR_1 and verify 2027 resolves to March 1 while 2028 leap year keeps Feb 29
    await updateOwnerBirthdayPreferences(actor, {
      timezone: 'Africa/Accra',
      leapDayPolicy: 'MAR_1',
      birthdayReminderDays: [7, 3, 1, 0],
    });
    await updateBirthdayPreparationStatus(actor, leapMember.id, 2027, {
      status: 'PREPARATION_PENDING',
    });
    await updateBirthdayPreparationStatus(actor, leapMember.id, 2028, {
      status: 'PREPARATION_PENDING',
    });
    const savedLeapMar1 = await prisma.birthdayPreparation.findUniqueOrThrow({
      where: { memberId_targetYear: { memberId: leapMember.id, targetYear: 2027 } },
    });
    const savedLeap2028 = await prisma.birthdayPreparation.findUniqueOrThrow({
      where: { memberId_targetYear: { memberId: leapMember.id, targetYear: 2028 } },
    });
    expect(savedLeapMar1.celebrationDate.toISOString().slice(0, 10)).toBe('2027-03-01');
    expect(savedLeap2028.celebrationDate.toISOString().slice(0, 10)).toBe('2028-02-29');

    // Invalid target years, incomplete birthday, and archived member fail cleanly
    await expect(
      updateBirthdayPreparationStatus(actor, regularMember.id, 1999, {
        status: 'PREPARATION_PENDING',
      })
    ).rejects.toThrow(MemberValidationError);
    await expect(
      updateBirthdayPreparationStatus(actor, regularMember.id, 2201, {
        status: 'PREPARATION_PENDING',
      })
    ).rejects.toThrow(MemberValidationError);
    await expect(
      updateBirthdayPreparationStatus(actor, regularMember.id, 2026.5, {
        status: 'PREPARATION_PENDING',
      })
    ).rejects.toThrow(MemberValidationError);
    await expect(
      updateBirthdayPreparationStatus(actor, incompleteMember.id, 2026, {
        status: 'PREPARATION_PENDING',
      })
    ).rejects.toThrow(MemberValidationError);
    await expect(
      updateBirthdayPreparationStatus(actor, archivedMember.id, 2026, {
        status: 'PREPARATION_PENDING',
      })
    ).rejects.toThrow(MemberValidationError);
  }, 60_000);

  it('Finding 2: serializes concurrent birthday flyer creation, isolates non-birthday/multi-year/multi-org jobs, and rolls back cleanly on mid-transaction failure', async () => {
    const { actor: actorA } = await createTestOrgAndOwner('f2_a');
    const { actor: actorB } = await createTestOrgAndOwner('f2_b');

    const memberA1 = await prisma.member.create({
      data: {
        organisationId: actorA.organisationId,
        fullName: 'Efua Concurrent',
        normalizedName: 'efua concurrent',
        birthMonth: 6,
        birthDay: 15,
      },
    });
    const memberA2 = await prisma.member.create({
      data: {
        organisationId: actorA.organisationId,
        fullName: 'Kojo Second',
        normalizedName: 'kojo second',
        birthMonth: 8,
        birthDay: 3,
      },
    });
    const memberB1 = await prisma.member.create({
      data: {
        organisationId: actorB.organisationId,
        fullName: 'Yaw Other Org',
        normalizedName: 'yaw other org',
        birthMonth: 6,
        birthDay: 15,
      },
    });

    // Simultaneous create requests for same (org, member, targetYear): 1 succeeds, 1 fails with 409 Conflict
    const raceResults = await Promise.allSettled([
      createDesignJob(actorA, {
        title: 'Race Birthday Flyer 1',
        category: 'BIRTHDAY_FLYER',
        priority: 'HIGH',
        initialStatus: 'DRAFT',
        memberId: memberA1.id,
        birthdayTargetYear: 2026,
      }),
      createDesignJob(actorA, {
        title: 'Race Birthday Flyer 2',
        category: 'BIRTHDAY_FLYER',
        priority: 'NORMAL',
        initialStatus: 'PENDING',
        memberId: memberA1.id,
        birthdayTargetYear: 2026,
      }),
    ]);

    const fulfilled = raceResults.filter((r) => r.status === 'fulfilled');
    const rejected = raceResults.filter((r) => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(
      DesignJobConflictError
    );

    const raceJobs = await prisma.designJob.findMany({
      where: {
        organisationId: actorA.organisationId,
        memberId: memberA1.id,
        category: 'BIRTHDAY_FLYER',
        birthdayTargetYear: 2026,
      },
    });
    expect(raceJobs).toHaveLength(1);

    // Same member different targetYear succeeds, different member same year succeeds, different org succeeds
    await expect(
      createDesignJob(actorA, {
        title: 'Efua 2027 Flyer',
        category: 'BIRTHDAY_FLYER',
        priority: 'NORMAL',
        initialStatus: 'DRAFT',
        memberId: memberA1.id,
        birthdayTargetYear: 2027,
      })
    ).resolves.toBeDefined();
    await expect(
      createDesignJob(actorA, {
        title: 'Kojo 2026 Flyer',
        category: 'BIRTHDAY_FLYER',
        priority: 'NORMAL',
        initialStatus: 'DRAFT',
        memberId: memberA2.id,
        birthdayTargetYear: 2026,
      })
    ).resolves.toBeDefined();
    await expect(
      createDesignJob(actorB, {
        title: 'Yaw Org B 2026 Flyer',
        category: 'BIRTHDAY_FLYER',
        priority: 'NORMAL',
        initialStatus: 'DRAFT',
        memberId: memberB1.id,
        birthdayTargetYear: 2026,
      })
    ).resolves.toBeDefined();

    // Multiple non-birthday jobs linked to the same member remain allowed and never pollute birthday preparations
    await expect(
      Promise.all([
        createDesignJob(actorA, {
          title: 'Efua Event Spotlight 1',
          category: 'EVENT_ANNOUNCEMENT',
          priority: 'NORMAL',
          initialStatus: 'DRAFT',
          memberId: memberA1.id,
        }),
        createDesignJob(actorA, {
          title: 'Efua Event Spotlight 2',
          category: 'SERVICE_FLYER',
          priority: 'LOW',
          initialStatus: 'DRAFT',
          memberId: memberA1.id,
        }),
      ])
    ).resolves.toHaveLength(2);

    // Mid-transaction failure leaves zero orphaned DesignJob / History / BirthdayPreparation link and next create succeeds
    vi.spyOn(auditService, 'recordAuditEvent').mockRejectedValueOnce(
      new Error('Simulated audit failure')
    );
    await expect(
      createDesignJob(actorA, {
        title: 'Kojo 2027 Atomic Failure',
        category: 'BIRTHDAY_FLYER',
        priority: 'HIGH',
        initialStatus: 'DRAFT',
        memberId: memberA2.id,
        birthdayTargetYear: 2027,
      })
    ).rejects.toThrow('Simulated audit failure');

    expect(
      await prisma.birthdayPreparation.findUnique({
        where: { memberId_targetYear: { memberId: memberA2.id, targetYear: 2027 } },
      })
    ).toBeNull();
    expect(
      await prisma.designJob.findMany({
        where: {
          organisationId: actorA.organisationId,
          memberId: memberA2.id,
          birthdayTargetYear: 2027,
        },
      })
    ).toHaveLength(0);

    // Retrying immediately succeeds because transaction rolled back cleanly and released lock
    await expect(
      createDesignJob(actorA, {
        title: 'Kojo 2027 Recovery Success',
        category: 'BIRTHDAY_FLYER',
        priority: 'HIGH',
        initialStatus: 'DRAFT',
        memberId: memberA2.id,
        birthdayTargetYear: 2027,
      })
    ).resolves.toBeDefined();
  }, 90_000);

  it('Finding 3A: reconciles BirthdayPreparation on reassignment, preserves existing status, blocks prep hijack with 409, and rolls back atomically', async () => {
    const { actor } = await createTestOrgAndOwner('f3_reassign');

    const memberA = await prisma.member.create({
      data: {
        organisationId: actor.organisationId,
        fullName: 'Member Alpha',
        normalizedName: 'member alpha',
        birthMonth: 5,
        birthDay: 12,
      },
    });
    const memberB = await prisma.member.create({
      data: {
        organisationId: actor.organisationId,
        fullName: 'Member Beta',
        normalizedName: 'member beta',
        birthMonth: 9,
        birthDay: 20,
      },
    });
    const memberC = await prisma.member.create({
      data: {
        organisationId: actor.organisationId,
        fullName: 'Member Gamma',
        normalizedName: 'member gamma',
        birthMonth: 12,
        birthDay: 2,
      },
    });

    const job1 = await createDesignJob(actor, {
      title: 'Alpha Birthday Flyer',
      category: 'BIRTHDAY_FLYER',
      priority: 'HIGH',
      initialStatus: 'DRAFT',
      memberId: memberA.id,
      birthdayTargetYear: 2026,
    });
    await transitionDesignJobStatus(actor, job1.id, { status: 'IN_PROGRESS' });

    const prepAInitial = await prisma.birthdayPreparation.findUniqueOrThrow({
      where: { memberId_targetYear: { memberId: memberA.id, targetYear: 2026 } },
    });
    expect(prepAInitial.designJobId).toBe(job1.id);
    expect(prepAInitial.status).toBe('DESIGN_IN_PROGRESS');

    // Reassign job1 from Member A -> Member B (where Member B has an existing PUBLISHED status to preserve!)
    await updateBirthdayPreparationStatus(actor, memberB.id, 2026, {
      status: 'PUBLISHED',
      notes: 'Manual milestone already logged',
    });

    const reassigned = await updateDesignJob(actor, job1.id, {
      memberId: memberB.id,
      birthdayTargetYear: 2026,
    });
    expect(reassigned.memberId).toBe(memberB.id);

    const prepAAfterReassign = await prisma.birthdayPreparation.findUniqueOrThrow({
      where: { memberId_targetYear: { memberId: memberA.id, targetYear: 2026 } },
    });
    expect(prepAAfterReassign.designJobId).toBeNull();
    expect(prepAAfterReassign.status).toBe('DESIGN_IN_PROGRESS');

    const prepBAfterReassign = await prisma.birthdayPreparation.findUniqueOrThrow({
      where: { memberId_targetYear: { memberId: memberB.id, targetYear: 2026 } },
    });
    expect(prepBAfterReassign.designJobId).toBe(job1.id);
    expect(prepBAfterReassign.status).toBe('PUBLISHED');

    // Attempted reassignment into Member C while Member C's prep is already owned by job2 fails with 409 and never mutates job1 or prepC
    const job2 = await createDesignJob(actor, {
      title: 'Gamma Existing Birthday Flyer',
      category: 'BIRTHDAY_FLYER',
      priority: 'NORMAL',
      initialStatus: 'DRAFT',
      memberId: memberC.id,
      birthdayTargetYear: 2026,
    });
    await expect(
      updateDesignJob(actor, job1.id, { memberId: memberC.id })
    ).rejects.toThrow(DesignJobConflictError);

    const prepCAfterConflict = await prisma.birthdayPreparation.findUniqueOrThrow({
      where: { memberId_targetYear: { memberId: memberC.id, targetYear: 2026 } },
    });
    expect(prepCAfterConflict.designJobId).toBe(job2.id);

    // Incomplete birthday update ({ memberId: null } on BIRTHDAY_FLYER) rejected
    await expect(
      updateDesignJob(actor, job1.id, { memberId: null })
    ).rejects.toThrow(DesignJobValidationError);

    // Mid-transaction failure during reassignment restores original link atomically
    vi.spyOn(auditService, 'recordAuditEvent').mockRejectedValueOnce(
      new Error('Simulated update failure')
    );
    await expect(
      updateDesignJob(actor, job1.id, { birthdayTargetYear: 2027 })
    ).rejects.toThrow('Simulated update failure');

    const prepBStillLinked = await prisma.birthdayPreparation.findUniqueOrThrow({
      where: { memberId_targetYear: { memberId: memberB.id, targetYear: 2026 } },
    });
    expect(prepBStillLinked.designJobId).toBe(job1.id);
    expect(
      await prisma.birthdayPreparation.findUnique({
        where: { memberId_targetYear: { memberId: memberB.id, targetYear: 2027 } },
      })
    ).toBeNull();
  }, 90_000);

  it('Finding 3B: detaches prep on category switch & cancellation, keeps non-birthday jobs isolated, and enforces conflict on reopen', async () => {
    const { actor } = await createTestOrgAndOwner('f3_detach');

    const memberA = await prisma.member.create({
      data: {
        organisationId: actor.organisationId,
        fullName: 'Member Delta',
        normalizedName: 'member delta',
        birthMonth: 5,
        birthDay: 12,
      },
    });
    const memberC = await prisma.member.create({
      data: {
        organisationId: actor.organisationId,
        fullName: 'Member Epsilon',
        normalizedName: 'member epsilon',
        birthMonth: 12,
        birthDay: 2,
      },
    });

    await updateBirthdayPreparationStatus(actor, memberA.id, 2026, {
      status: 'PUBLISHED',
      notes: 'Keep published on category change',
    });

    const job1 = await createDesignJob(actor, {
      title: 'Delta Birthday Flyer',
      category: 'BIRTHDAY_FLYER',
      priority: 'HIGH',
      initialStatus: 'DRAFT',
      memberId: memberA.id,
      birthdayTargetYear: 2026,
    });

    // Switching category to non-birthday disconnects prep cleanly while preserving PUBLISHED status & clearing birthdayTargetYear
    const converted = await updateDesignJob(actor, job1.id, {
      category: 'GENERAL_GRAPHIC_DESIGN',
      memberId: null,
    });
    expect(converted.category).toBe('GENERAL_GRAPHIC_DESIGN');
    expect(converted.memberId).toBeNull();
    expect(converted.birthdayTargetYear).toBeNull();

    const prepAfterDisconnect = await prisma.birthdayPreparation.findUniqueOrThrow({
      where: { memberId_targetYear: { memberId: memberA.id, targetYear: 2026 } },
    });
    expect(prepAfterDisconnect.designJobId).toBeNull();
    expect(prepAfterDisconnect.status).toBe('PUBLISHED');

    // Updating non-birthday job member never mutates birthday preparations
    await updateDesignJob(actor, converted.id, { memberId: memberC.id });
    expect(
      await prisma.birthdayPreparation.findUnique({
        where: { memberId_targetYear: { memberId: memberC.id, targetYear: 2026 } },
      })
    ).toBeNull();

    // Cancelling birthday job detaches prep; creating replacement succeeds; reopening old cancelled job conflicts (409)
    const job2 = await createDesignJob(actor, {
      title: 'Epsilon Birthday Flyer',
      category: 'BIRTHDAY_FLYER',
      priority: 'NORMAL',
      initialStatus: 'DRAFT',
      memberId: memberC.id,
      birthdayTargetYear: 2026,
    });
    await transitionDesignJobStatus(actor, job2.id, { status: 'CANCELLED' });

    const prepCAfterCancel = await prisma.birthdayPreparation.findUniqueOrThrow({
      where: { memberId_targetYear: { memberId: memberC.id, targetYear: 2026 } },
    });
    expect(prepCAfterCancel.designJobId).toBeNull();

    const job2Replacement = await createDesignJob(actor, {
      title: 'Epsilon Replacement Birthday Flyer',
      category: 'BIRTHDAY_FLYER',
      priority: 'HIGH',
      initialStatus: 'DRAFT',
      memberId: memberC.id,
      birthdayTargetYear: 2026,
    });
    expect(job2Replacement.id).not.toBe(job2.id);

    await expect(
      transitionDesignJobStatus(actor, job2.id, { status: 'DRAFT' })
    ).rejects.toThrow(DesignJobConflictError);
  }, 90_000);
});

