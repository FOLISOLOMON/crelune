import crypto from 'node:crypto';
import { describe, it, expect, beforeAll, afterEach, afterAll } from 'vitest';
import { prisma, type LeapDayPolicy } from '@crelune/database';
import { formatCivilDateIso, utcDateOnlyToCivilDate } from '@crelune/shared';
import { AUDIT_ACTIONS } from '@/lib/audit/audit-service';
import { InvalidBirthdayPreferencesError } from '@/lib/birthdays/birthday-preferences';
import {
  MAX_REMINDER_ATTEMPTS,
  PermanentReminderProcessingError,
  processDueBirthdayReminders,
} from '@/lib/birthdays/birthday-processor-service';
import { reconcileOrganisationBirthdaySchedules } from '@/lib/birthdays/birthday-schedule-service';
import {
  runOrganisationBirthdayCycle,
  runScheduledBirthdayRemindersForActiveOwners,
} from '@/lib/birthdays/birthday-engine-service';
import {
  NotificationNotFoundError,
  listOwnerNotifications,
  markAllNotificationsAsRead,
  markNotificationAsRead,
} from '@/lib/notifications/notification-service';
import {
  archiveMember,
  restoreMember,
  updateMember,
} from '@/lib/members/member-service';
import { assertSafeDevDatabaseEnvironment } from './assert-dev-db';

describe('PostgreSQL Stage 3.4 Birthday Engine, Reminder Processing & Notifications Integration (Neon Development)', () => {
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
        name: `__pg_m3_4_org_${runId}_${suffix}`,
        slug: `__pg-m3-4-${runId}-${suffix}`,
      },
    });
    createdOrgIds.add(org.id);

    const user = await prisma.user.create({
      data: {
        organisationId: org.id,
        email: `__pg_m3_4_${suffix}_${runId}@crelune.test`,
        passwordHash: 'not-a-real-hash',
        firstName: 'Owner',
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

  async function insertMemberFixture(
    organisationId: string,
    data: {
      fullName: string;
      preferredName?: string | null;
      birthMonth?: number | null;
      birthDay?: number | null;
      birthYear?: number | null;
      email?: string | null;
      phone?: string | null;
      notes?: string | null;
      photoStorageKey?: string | null;
      archivedAt?: Date | null;
    }
  ) {
    return prisma.member.create({
      data: {
        organisationId,
        fullName: data.fullName,
        normalizedName: data.fullName.trim().toLowerCase(),
        preferredName: data.preferredName ?? null,
        birthMonth: data.birthMonth ?? null,
        birthDay: data.birthDay ?? null,
        birthYear: data.birthYear ?? null,
        email: data.email ?? null,
        phone: data.phone ?? null,
        notes: data.notes ?? null,
        photoStorageKey: data.photoStorageKey ?? null,
        archivedAt: data.archivedAt ?? null,
      },
    });
  }

  async function cleanupTestOrgs() {
    if (createdOrgIds.size === 0) return;
    const orgIds = Array.from(createdOrgIds);
    await prisma.$transaction([
      prisma.auditLog.deleteMany({ where: { organisationId: { in: orgIds } } }),
      prisma.notification.deleteMany({ where: { organisationId: { in: orgIds } } }),
      prisma.birthdayReminder.deleteMany({ where: { organisationId: { in: orgIds } } }),
      prisma.birthdayPreparation.deleteMany({ where: { organisationId: { in: orgIds } } }),
      prisma.member.deleteMany({ where: { organisationId: { in: orgIds } } }),
      prisma.user.deleteMany({ where: { organisationId: { in: orgIds } } }),
      prisma.organisation.deleteMany({ where: { id: { in: orgIds } } }),
    ]);
    createdOrgIds.clear();
  }

  beforeAll(async () => {
    assertSafeDevDatabaseEnvironment(process.env);
    const rows = await prisma.$queryRaw<Array<{ db: string }>>`SELECT current_database() AS db`;
    if (rows[0]?.db !== 'neondb') {
      throw new Error(`Unexpected database "${rows[0]?.db}" for integration test.`);
    }
  }, 30_000);

  afterEach(async () => {
    await cleanupTestOrgs();
  });

  afterAll(async () => {
    await cleanupTestOrgs();
    await prisma.$disconnect();
  });

  it('generates schedules across Dec->Jan year boundary, handles unknown birthYear, and skips archived/no-birthday members', async () => {
    const nowAccraDec26 = new Date('2026-12-26T22:00:00.000Z');
    const { actor } = await createTestOrgAndOwner('gen_dec_jan', {
      timezone: 'Africa/Accra',
      leapDayPolicy: 'FEB_28',
      birthdayReminderDays: [7, 0],
    });

    const janMember = await insertMemberFixture(actor.organisationId, {
      fullName: 'Kofi Jan',
      birthMonth: 1,
      birthDay: 2,
      birthYear: null,
    });
    const noBirthday = await insertMemberFixture(actor.organisationId, {
      fullName: 'No Birthday',
    });
    const archivedMember = await insertMemberFixture(actor.organisationId, {
      fullName: 'Archived Member',
      birthMonth: 12,
      birthDay: 28,
      archivedAt: new Date('2026-01-01T00:00:00.000Z'),
    });

    const summary = await runOrganisationBirthdayCycle(actor.organisationId, actor.userId, {
      now: nowAccraDec26,
    });

    expect(summary.remindersDue).toBe(1);
    expect(summary.notificationsCreated).toBe(1);
    expect(summary.unreadNotificationCount).toBe(1);

    const jan2027SevenDay = await prisma.birthdayReminder.findFirstOrThrow({
      where: {
        memberId: janMember.id,
        targetYear: 2027,
        leadDays: 7,
      },
      include: { notification: true },
    });
    expect(formatCivilDateIso(utcDateOnlyToCivilDate(jan2027SevenDay.scheduledForDate))).toBe(
      '2026-12-26'
    );
    expect(jan2027SevenDay.status).toBe('SENT');
    expect(jan2027SevenDay.notification?.href).toBe(`/members/${janMember.id}`);

    const inactiveReminders = await prisma.birthdayReminder.count({
      where: {
        organisationId: actor.organisationId,
        memberId: { in: [noBirthday.id, archivedMember.id] },
      },
    });
    expect(inactiveReminders).toBe(0);
  });

  it('applies FEB_28 vs MAR_1 leap-day policies and rejects invalid configured timezones', async () => {
    const now = new Date('2026-12-26T22:00:00.000Z');
    const { actor } = await createTestOrgAndOwner('leap_and_invalid_tz', {
      timezone: 'Africa/Accra',
      leapDayPolicy: 'FEB_28',
      birthdayReminderDays: [7, 0],
    });

    const leapMember = await insertMemberFixture(actor.organisationId, {
      fullName: 'Abena Leap',
      birthMonth: 2,
      birthDay: 29,
      birthYear: 1996,
    });

    await reconcileOrganisationBirthdaySchedules(actor.organisationId, actor.userId, { now });
    const febPrep2027 = await prisma.birthdayPreparation.findFirstOrThrow({
      where: { organisationId: actor.organisationId, memberId: leapMember.id, targetYear: 2027 },
    });
    expect(formatCivilDateIso(utcDateOnlyToCivilDate(febPrep2027.celebrationDate))).toBe(
      '2027-02-28'
    );

    await prisma.userPreference.update({
      where: { userId: actor.userId },
      data: { leapDayPolicy: 'MAR_1' },
    });
    await reconcileOrganisationBirthdaySchedules(actor.organisationId, actor.userId, { now });
    const marPrep2027 = await prisma.birthdayPreparation.findFirstOrThrow({
      where: { organisationId: actor.organisationId, memberId: leapMember.id, targetYear: 2027 },
    });
    expect(formatCivilDateIso(utcDateOnlyToCivilDate(marPrep2027.celebrationDate))).toBe(
      '2027-03-01'
    );

    await prisma.userPreference.update({
      where: { userId: actor.userId },
      data: { timezone: 'UTC+2' },
    });
    await expect(
      runOrganisationBirthdayCycle(actor.organisationId, actor.userId, { now })
    ).rejects.toThrow(InvalidBirthdayPreferencesError);
  });

  it('respects IANA timezone boundaries for due-date triggers', async () => {
    const instant = new Date('2026-05-09T23:30:00.000Z');

    const accra = await createTestOrgAndOwner('tz_accra', {
      timezone: 'Africa/Accra',
      birthdayReminderDays: [0],
    });
    const tokyo = await createTestOrgAndOwner('tz_tokyo', {
      timezone: 'Asia/Tokyo',
      birthdayReminderDays: [0],
    });

    await insertMemberFixture(accra.actor.organisationId, {
      fullName: 'Accra Person',
      birthMonth: 5,
      birthDay: 10,
    });
    await insertMemberFixture(tokyo.actor.organisationId, {
      fullName: 'Tokyo Person',
      birthMonth: 5,
      birthDay: 10,
    });

    const accraRun = await runOrganisationBirthdayCycle(
      accra.actor.organisationId,
      accra.actor.userId,
      { now: instant }
    );
    const tokyoRun = await runOrganisationBirthdayCycle(
      tokyo.actor.organisationId,
      tokyo.actor.userId,
      { now: instant }
    );

    expect(accraRun.notificationsCreated).toBe(0);
    expect(tokyoRun.notificationsCreated).toBe(1);
  });

  it('prevents duplicate schedules and notifications under repeated and concurrent sync runs', async () => {
    const now = new Date('2026-06-01T10:00:00.000Z');
    const { actor } = await createTestOrgAndOwner('concurrent_idempotent', {
      timezone: 'Africa/Accra',
      birthdayReminderDays: [3, 0],
    });

    const member = await insertMemberFixture(actor.organisationId, {
      fullName: 'Yaw Concurrent',
      birthMonth: 6,
      birthDay: 4,
    });

    await Promise.all([
      runOrganisationBirthdayCycle(actor.organisationId, actor.userId, { now }),
      runOrganisationBirthdayCycle(actor.organisationId, actor.userId, { now }),
      runOrganisationBirthdayCycle(actor.organisationId, actor.userId, { now }),
    ]);

    const secondPass = await runOrganisationBirthdayCycle(actor.organisationId, actor.userId, {
      now,
    });
    expect(secondPass.notificationsCreated).toBe(0);

    const [reminders, notifications, preps] = await Promise.all([
      prisma.birthdayReminder.findMany({
        where: { organisationId: actor.organisationId, memberId: member.id },
      }),
      prisma.notification.findMany({
        where: { organisationId: actor.organisationId, memberId: member.id },
      }),
      prisma.birthdayPreparation.findMany({
        where: { organisationId: actor.organisationId, memberId: member.id },
      }),
    ]);

    expect(reminders).toHaveLength(4);
    expect(preps).toHaveLength(2);
    expect(notifications).toHaveLength(1);
  });

  it('reconciles preference interval edits without duplicating or rewriting SENT history', async () => {
    const now = new Date('2026-07-01T09:00:00.000Z');
    const { actor } = await createTestOrgAndOwner('pref_edits', {
      timezone: 'Africa/Accra',
      birthdayReminderDays: [7, 3, 1, 0],
    });

    const member = await insertMemberFixture(actor.organisationId, {
      fullName: 'Esi Prefs',
      birthMonth: 7,
      birthDay: 8,
    });

    const firstRun = await runOrganisationBirthdayCycle(actor.organisationId, actor.userId, {
      now,
    });
    expect(firstRun.notificationsCreated).toBe(1);

    const sentReminder = await prisma.birthdayReminder.findFirstOrThrow({
      where: { memberId: member.id, targetYear: 2026, leadDays: 7 },
    });
    expect(sentReminder.status).toBe('SENT');

    await prisma.userPreference.update({
      where: { userId: actor.userId },
      data: { birthdayReminderDays: [3, 0] },
    });
    await reconcileOrganisationBirthdaySchedules(actor.organisationId, actor.userId, { now });

    expect(
      (await prisma.birthdayReminder.findUniqueOrThrow({ where: { id: sentReminder.id } })).status
    ).toBe('SENT');
    const oneDay2026 = await prisma.birthdayReminder.findFirstOrThrow({
      where: { memberId: member.id, targetYear: 2026, leadDays: 1 },
    });
    expect(oneDay2026.status).toBe('CANCELLED');

    await prisma.userPreference.update({
      where: { userId: actor.userId },
      data: { birthdayReminderDays: [7, 3, 1, 0] },
    });
    await reconcileOrganisationBirthdaySchedules(actor.organisationId, actor.userId, { now });

    expect(
      (await prisma.birthdayReminder.findUniqueOrThrow({ where: { id: oneDay2026.id } })).status
    ).toBe('PENDING');
    expect(
      await prisma.notification.count({
        where: { organisationId: actor.organisationId, memberId: member.id },
      })
    ).toBe(1);
  });

  it('reconciles birthday edits and birthday removal without rewriting SENT history', async () => {
    const now = new Date('2026-07-01T09:00:00.000Z');
    const { actor } = await createTestOrgAndOwner('bday_edits', {
      timezone: 'Africa/Accra',
      birthdayReminderDays: [7, 3],
    });

    const member = await insertMemberFixture(actor.organisationId, {
      fullName: 'Esi Birthdate',
      birthMonth: 7,
      birthDay: 8,
    });

    await runOrganisationBirthdayCycle(actor.organisationId, actor.userId, { now });
    const sentReminder = await prisma.birthdayReminder.findFirstOrThrow({
      where: { memberId: member.id, targetYear: 2026, leadDays: 7 },
    });
    expect(sentReminder.status).toBe('SENT');

    await updateMember(actor, member.id, { birthMonth: 7, birthDay: 20 });
    await reconcileOrganisationBirthdaySchedules(actor.organisationId, actor.userId, { now });

    const threeDayUpdated = await prisma.birthdayReminder.findFirstOrThrow({
      where: { memberId: member.id, targetYear: 2026, leadDays: 3 },
    });
    expect(formatCivilDateIso(utcDateOnlyToCivilDate(threeDayUpdated.scheduledForDate))).toBe(
      '2026-07-17'
    );
    expect(
      (await prisma.birthdayReminder.findUniqueOrThrow({ where: { id: sentReminder.id } })).status
    ).toBe('SENT');

    await updateMember(actor, member.id, { birthMonth: null, birthDay: null, birthYear: null });
    await reconcileOrganisationBirthdaySchedules(actor.organisationId, actor.userId, { now });
    expect(
      (await prisma.birthdayReminder.findUniqueOrThrow({ where: { id: threeDayUpdated.id } })).status
    ).toBe('CANCELLED');
    expect(
      (await prisma.birthdayReminder.findUniqueOrThrow({ where: { id: sentReminder.id } })).status
    ).toBe('SENT');
  });

  it('cancels pending schedules on archive and reactivates on restore without deleting SENT history', async () => {
    const now = new Date('2026-07-01T09:00:00.000Z');
    const { actor } = await createTestOrgAndOwner('archive_restore', {
      timezone: 'Africa/Accra',
      birthdayReminderDays: [7, 1],
    });

    const member = await insertMemberFixture(actor.organisationId, {
      fullName: 'Kojo Restore',
      birthMonth: 7,
      birthDay: 8,
    });

    await runOrganisationBirthdayCycle(actor.organisationId, actor.userId, { now });

    await archiveMember(actor, member.id);
    await reconcileOrganisationBirthdaySchedules(actor.organisationId, actor.userId, { now });

    const afterArchive = await prisma.birthdayReminder.findMany({
      where: { memberId: member.id, targetYear: 2026 },
    });
    expect(afterArchive.find((r) => r.leadDays === 7)?.status).toBe('SENT');
    expect(afterArchive.find((r) => r.leadDays === 1)?.status).toBe('CANCELLED');

    await restoreMember(actor, member.id);
    await reconcileOrganisationBirthdaySchedules(actor.organisationId, actor.userId, { now });

    const afterRestore = await prisma.birthdayReminder.findFirstOrThrow({
      where: { memberId: member.id, targetYear: 2026, leadDays: 1 },
    });
    expect(afterRestore.status).toBe('PENDING');
  });

  it('delivers delayed reminders before the birthday, skips expired reminders after the birthday, and keeps PII out of notifications', async () => {
    const { actor } = await createTestOrgAndOwner('delayed_vs_expired', {
      timezone: 'Africa/Accra',
      birthdayReminderDays: [7, 0],
    });

    const member = await insertMemberFixture(actor.organisationId, {
      fullName: 'Private Member',
      preferredName: 'Nana',
      birthMonth: 8,
      birthDay: 15,
      birthYear: 1991,
      email: 'secret-email@example.com',
      phone: '+233201234567',
      notes: 'Confidential allergic reaction note',
      photoStorageKey: 'orgs/secret/photo.jpg',
    });

    await reconcileOrganisationBirthdaySchedules(actor.organisationId, actor.userId, {
      now: new Date('2026-08-01T10:00:00.000Z'),
    });

    const delayedRun = await processDueBirthdayReminders(actor.organisationId, actor.userId, {
      now: new Date('2026-08-12T10:00:00.000Z'),
    });
    expect(delayedRun.notificationsCreated).toBe(1);
    expect(delayedRun.remindersSkipped).toBe(0);

    const notification = await prisma.notification.findFirstOrThrow({
      where: { organisationId: actor.organisationId, memberId: member.id },
    });
    expect(notification.title).toContain('Nana');
    const serialized = `${notification.title} ${notification.body} ${notification.href}`;
    expect(serialized).not.toContain('secret-email@example.com');
    expect(serialized).not.toContain('+233201234567');
    expect(serialized).not.toContain('Confidential');
    expect(serialized).not.toContain('1991');
    expect(serialized).not.toContain('photo.jpg');

    const expiredRun = await processDueBirthdayReminders(actor.organisationId, actor.userId, {
      now: new Date('2026-08-16T10:00:00.000Z'),
    });
    expect(expiredRun.remindersSkipped).toBe(1);
    expect(expiredRun.notificationsCreated).toBe(0);

    const zeroDay2026 = await prisma.birthdayReminder.findFirstOrThrow({
      where: { memberId: member.id, targetYear: 2026, leadDays: 0 },
    });
    expect(zeroDay2026.status).toBe('SKIPPED');
  });

  it('rolls back failed notification persistence cleanly and recovers on retry', async () => {
    const now = new Date('2026-09-03T10:00:00.000Z');
    const { actor } = await createTestOrgAndOwner('retry_recover', {
      timezone: 'Africa/Accra',
      birthdayReminderDays: [0],
    });

    const member = await insertMemberFixture(actor.organisationId, {
      fullName: 'Retry Member',
      birthMonth: 9,
      birthDay: 3,
      notes: 'Do not leak this secret note',
    });

    await reconcileOrganisationBirthdaySchedules(actor.organisationId, actor.userId, { now });

    const failOnce = await processDueBirthdayReminders(actor.organisationId, actor.userId, {
      now,
      persistNotification: async () => {
        const err = new Error(
          'Simulated transient failure with secret https://db.internal'
        ) as Error & { code?: string };
        err.code = 'ETIMEDOUT';
        throw err;
      },
    });
    expect(failOnce.remindersFailed).toBe(1);
    expect(failOnce.notificationsCreated).toBe(0);

    const afterAttempt1 = await prisma.birthdayReminder.findFirstOrThrow({
      where: { memberId: member.id, targetYear: 2026, leadDays: 0 },
    });
    expect(afterAttempt1.status).toBe('FAILED');
    expect(afterAttempt1.attemptCount).toBe(1);
    expect(afterAttempt1.lastError).toBe('Error:ETIMEDOUT');
    expect(afterAttempt1.lastError).not.toContain('https://');
    expect(await prisma.notification.count({ where: { organisationId: actor.organisationId } })).toBe(
      0
    );

    const retrySuccess = await processDueBirthdayReminders(actor.organisationId, actor.userId, {
      now,
    });
    expect(retrySuccess.notificationsCreated).toBe(1);
    expect(retrySuccess.remindersFailed).toBe(0);

    const afterSuccess = await prisma.birthdayReminder.findUniqueOrThrow({
      where: { id: afterAttempt1.id },
    });
    expect(afterSuccess.status).toBe('SENT');
    expect(afterSuccess.lastError).toBeNull();
    expect(afterSuccess.sentAt).not.toBeNull();
  });

  it('caps bounded retries at MAX_REMINDER_ATTEMPTS and writes sanitized audit log', async () => {
    const now = new Date('2026-09-03T10:00:00.000Z');
    const { actor } = await createTestOrgAndOwner('retry_cap_audit', {
      timezone: 'Africa/Accra',
      birthdayReminderDays: [0],
    });

    const exhaustedMember = await insertMemberFixture(actor.organisationId, {
      fullName: 'Exhausted Member',
      birthMonth: 9,
      birthDay: 3,
      notes: 'Secret exhausted note',
    });
    await reconcileOrganisationBirthdaySchedules(actor.organisationId, actor.userId, { now });

    for (let i = 0; i < MAX_REMINDER_ATTEMPTS; i += 1) {
      const res = await processDueBirthdayReminders(actor.organisationId, actor.userId, {
        now,
        persistNotification: async () => {
          throw new Error('Transient DB write failure');
        },
      });
      expect(res.remindersFailed).toBe(1);
    }

    const exhaustedRow = await prisma.birthdayReminder.findFirstOrThrow({
      where: { memberId: exhaustedMember.id, targetYear: 2026, leadDays: 0 },
    });
    expect(exhaustedRow.status).toBe('FAILED');
    expect(exhaustedRow.attemptCount).toBe(MAX_REMINDER_ATTEMPTS);

    const postExhaustRun = await processDueBirthdayReminders(actor.organisationId, actor.userId, {
      now,
    });
    expect(postExhaustRun.remindersDue).toBe(0);

    const failureAudits = await prisma.auditLog.findMany({
      where: {
        organisationId: actor.organisationId,
        action: AUDIT_ACTIONS.BIRTHDAY_REMINDER_FAILED,
      },
    });
    expect(failureAudits).toHaveLength(1);
    expect(JSON.stringify(failureAudits)).not.toContain('Secret exhausted note');
  });

  it('marks permanent reminder failures at retry cap immediately and audits cleanly', async () => {
    const now = new Date('2026-09-03T10:00:00.000Z');
    const { actor } = await createTestOrgAndOwner('perm_fail_audit', {
      timezone: 'Africa/Accra',
      birthdayReminderDays: [0],
    });

    const permMember = await insertMemberFixture(actor.organisationId, {
      fullName: 'Permanent Error Member',
      birthMonth: 9,
      birthDay: 3,
    });
    await reconcileOrganisationBirthdaySchedules(actor.organisationId, actor.userId, { now });

    const permRun = await processDueBirthdayReminders(actor.organisationId, actor.userId, {
      now,
      persistNotification: async () => {
        throw new PermanentReminderProcessingError('Permanent constraint error');
      },
    });
    expect(permRun.remindersFailed).toBe(1);

    const permRow = await prisma.birthdayReminder.findFirstOrThrow({
      where: { memberId: permMember.id, targetYear: 2026, leadDays: 0 },
    });
    expect(permRow.attemptCount).toBe(MAX_REMINDER_ATTEMPTS);

    const failureAudits = await prisma.auditLog.findMany({
      where: {
        organisationId: actor.organisationId,
        action: AUDIT_ACTIONS.BIRTHDAY_REMINDER_FAILED,
      },
    });
    expect(failureAudits).toHaveLength(1);
  });

  it('runs scheduled cron birthday cycle across active owners cleanly', async () => {
    const now = new Date('2026-10-12T08:00:00.000Z');
    const orgA = await createTestOrgAndOwner('cron_a', {
      timezone: 'Africa/Accra',
      birthdayReminderDays: [0],
    });
    const orgB = await createTestOrgAndOwner('cron_b', {
      timezone: 'Africa/Accra',
      birthdayReminderDays: [0],
    });

    await prisma.member.createMany({
      data: [
        {
          organisationId: orgA.actor.organisationId,
          fullName: 'Cron Owner A Member',
          normalizedName: 'cron owner a member',
          birthMonth: 10,
          birthDay: 12,
        },
        {
          organisationId: orgB.actor.organisationId,
          fullName: 'Cron Owner B Member',
          normalizedName: 'cron owner b member',
          birthMonth: 10,
          birthDay: 12,
        },
      ],
    });

    const cronSummary = await runScheduledBirthdayRemindersForActiveOwners({ now });
    expect(cronSummary.processedOrganisations).toBeGreaterThanOrEqual(2);
    expect(cronSummary.notificationsCreated).toBeGreaterThanOrEqual(2);
  });

  it('enforces owner/org notification isolation, pagination, unread filtering, and read/read-all semantics', async () => {
    const orgA = await createTestOrgAndOwner('notif_iso_a');
    const orgB = await createTestOrgAndOwner('notif_iso_b');

    await prisma.notification.createMany({
      data: [
        {
          organisationId: orgA.actor.organisationId,
          userId: orgA.actor.userId,
          type: 'BIRTHDAY_REMINDER',
          title: 'Owner A Notification 1',
          body: 'Birthday 1',
          href: '/members/1',
        },
        {
          organisationId: orgA.actor.organisationId,
          userId: orgA.actor.userId,
          type: 'BIRTHDAY_REMINDER',
          title: 'Owner A Notification 2',
          body: 'Birthday 2',
          href: '/members/2',
        },
        {
          organisationId: orgB.actor.organisationId,
          userId: orgB.actor.userId,
          type: 'BIRTHDAY_REMINDER',
          title: 'Owner B Notification',
          body: 'Birthday B',
          href: '/members/3',
        },
      ],
    });

    const listA = await listOwnerNotifications(orgA.actor, {
      unreadOnly: false,
      page: 1,
      limit: 1,
    });
    expect(listA.notifications).toHaveLength(1);
    expect(listA.pagination.total).toBe(2);
    expect(listA.unreadCount).toBe(2);

    const listB = await listOwnerNotifications(orgB.actor, {
      unreadOnly: false,
      page: 1,
      limit: 20,
    });
    expect(listB.notifications).toHaveLength(1);
    const orgBNotifId = listB.notifications[0].id;

    await expect(markNotificationAsRead(orgA.actor, orgBNotifId)).rejects.toThrow(
      NotificationNotFoundError
    );

    const firstANotifId = listA.notifications[0].id;
    const marked = await markNotificationAsRead(orgA.actor, firstANotifId);
    expect(marked.changed).toBe(true);
    expect(marked.notification.isRead).toBe(true);
    expect((await markNotificationAsRead(orgA.actor, firstANotifId)).changed).toBe(false);

    const readAllRes = await markAllNotificationsAsRead(orgA.actor);
    expect(readAllRes.markedCount).toBe(1);
    expect(
      (await listOwnerNotifications(orgA.actor, { unreadOnly: true, page: 1, limit: 20 }))
        .unreadCount
    ).toBe(0);
    expect(
      (await listOwnerNotifications(orgB.actor, { unreadOnly: true, page: 1, limit: 20 }))
        .unreadCount
    ).toBe(1);

    const readAllAudits = await prisma.auditLog.findMany({
      where: {
        organisationId: orgA.actor.organisationId,
        action: AUDIT_ACTIONS.NOTIFICATION_READ_ALL,
      },
    });
    expect(readAllAudits).toHaveLength(1);
  });

  it('counts concurrent transient failures atomically without lost updates, enforces retry cap 3, and records a single terminal audit event', async () => {
    const now = new Date('2026-09-03T10:00:00.000Z');
    const { actor } = await createTestOrgAndOwner('concurrent_retry_acc', {
      timezone: 'Africa/Accra',
      birthdayReminderDays: [0],
    });

    const member = await insertMemberFixture(actor.organisationId, {
      fullName: 'Concurrent Retry Member',
      birthMonth: 9,
      birthDay: 3,
      notes: 'Confidential concurrency test note',
    });

    const reminder = await prisma.birthdayReminder.create({
      data: {
        organisationId: actor.organisationId,
        memberId: member.id,
        targetYear: 2026,
        leadDays: 0,
        scheduledForDate: new Date('2026-09-03T00:00:00.000Z'),
        status: 'PENDING',
        idempotencyKey: `concurrent_retry_${runId}_${member.id}`,
        attemptCount: 0,
      },
    });

    const transientFail = async () => {
      const err = new Error('Simulated concurrent DB transient failure') as Error & { code?: string };
      err.code = 'ETIMEDOUT';
      throw err;
    };

    // Steps 2-5: Two concurrent transient failures on attemptCount=0 must store attemptCount=2, not 1
    await Promise.all([
      processDueBirthdayReminders(actor.organisationId, actor.userId, {
        now,
        persistNotification: transientFail,
      }),
      processDueBirthdayReminders(actor.organisationId, actor.userId, {
        now,
        persistNotification: transientFail,
      }),
    ]);

    const afterTwoConcurrentFailures = await prisma.birthdayReminder.findUniqueOrThrow({
      where: { id: reminder.id },
    });
    expect(afterTwoConcurrentFailures.attemptCount).toBe(2);
    expect(afterTwoConcurrentFailures.attemptCount).toBeLessThan(MAX_REMINDER_ATTEMPTS);
    expect(afterTwoConcurrentFailures.status).toBe('FAILED');
    expect(afterTwoConcurrentFailures.lastError).toBe('Error:ETIMEDOUT');
    expect(
      await prisma.auditLog.count({
        where: {
          organisationId: actor.organisationId,
          action: AUDIT_ACTIONS.BIRTHDAY_REMINDER_FAILED,
        },
      })
    ).toBe(0);

    // Steps 6-8: Concurrent failures at boundary (attemptCount=2) must cap strictly at 3 and emit 1 audit
    await Promise.all([
      processDueBirthdayReminders(actor.organisationId, actor.userId, {
        now,
        persistNotification: transientFail,
      }),
      processDueBirthdayReminders(actor.organisationId, actor.userId, {
        now,
        persistNotification: transientFail,
      }),
    ]);

    const afterBoundaryRace = await prisma.birthdayReminder.findUniqueOrThrow({
      where: { id: reminder.id },
    });
    expect(afterBoundaryRace.attemptCount).toBe(MAX_REMINDER_ATTEMPTS);
    expect(afterBoundaryRace.status).toBe('FAILED');

    const auditsAtCap = await prisma.auditLog.findMany({
      where: {
        organisationId: actor.organisationId,
        action: AUDIT_ACTIONS.BIRTHDAY_REMINDER_FAILED,
        entityId: reminder.id,
      },
    });
    expect(auditsAtCap).toHaveLength(1);
    expect(JSON.stringify(auditsAtCap)).not.toContain('Confidential concurrency test note');

    // Step 9: Subsequent processing run cannot exceed cap or duplicate audit
    const extraRun = await processDueBirthdayReminders(actor.organisationId, actor.userId, {
      now,
      persistNotification: transientFail,
    });
    expect(extraRun.remindersDue).toBe(0);
    expect(extraRun.remindersFailed).toBe(0);

    const afterExtraRun = await prisma.birthdayReminder.findUniqueOrThrow({
      where: { id: reminder.id },
    });
    expect(afterExtraRun.attemptCount).toBe(MAX_REMINDER_ATTEMPTS);
    expect(
      await prisma.auditLog.count({
        where: {
          organisationId: actor.organisationId,
          action: AUDIT_ACTIONS.BIRTHDAY_REMINDER_FAILED,
          entityId: reminder.id,
        },
      })
    ).toBe(1);
  });

  it('prevents a concurrently successful reminder or terminal status from reverting to FAILED', async () => {
    const now = new Date('2026-09-03T10:00:00.000Z');
    const { actor } = await createTestOrgAndOwner('concurrent_sent_guard', {
      timezone: 'Africa/Accra',
      birthdayReminderDays: [0],
    });

    const member = await insertMemberFixture(actor.organisationId, {
      fullName: 'Concurrent Success Member',
      birthMonth: 9,
      birthDay: 3,
    });

    const reminder = await prisma.birthdayReminder.create({
      data: {
        organisationId: actor.organisationId,
        memberId: member.id,
        targetYear: 2026,
        leadDays: 0,
        scheduledForDate: new Date('2026-09-03T00:00:00.000Z'),
        status: 'PENDING',
        idempotencyKey: `concurrent_sent_${runId}_${member.id}`,
        attemptCount: 0,
      },
    });

    // Race a failing worker and a succeeding worker on the same due reminder
    await Promise.all([
      processDueBirthdayReminders(actor.organisationId, actor.userId, { now }),
      processDueBirthdayReminders(actor.organisationId, actor.userId, {
        now,
        persistNotification: async () => {
          throw new Error('Late failing attempt must not revert SENT');
        },
      }),
    ]);

    const finalRow = await prisma.birthdayReminder.findUniqueOrThrow({
      where: { id: reminder.id },
    });
    expect(finalRow.status).toBe('SENT');
    expect(finalRow.lastError).toBeNull();
    expect(finalRow.sentAt).not.toBeNull();
    expect(
      await prisma.notification.count({
        where: { organisationId: actor.organisationId, birthdayReminderId: reminder.id },
      })
    ).toBe(1);

    // Explicitly verify a post-SENT failing run leaves SENT untouched
    const postSentFail = await processDueBirthdayReminders(actor.organisationId, actor.userId, {
      now,
      persistNotification: async () => {
        throw new Error('Post-SENT failure');
      },
    });
    expect(postSentFail.remindersFailed).toBe(0);
    expect((await prisma.birthdayReminder.findUniqueOrThrow({ where: { id: reminder.id } })).status).toBe(
      'SENT'
    );
  });
});
