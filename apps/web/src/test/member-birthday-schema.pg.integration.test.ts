import crypto from 'node:crypto';
import { describe, it, expect, beforeAll, afterEach, afterAll } from 'vitest';
import { Prisma, prisma } from '@crelune/database';
import {
  buildBirthdayReminderIdempotencyKey,
  calculateBirthdayReminderDates,
  civilDateToUtcMidnight,
  DEFAULT_REMINDER_LEAD_DAYS,
  isMemberActive,
  isMemberArchived,
  normalizeMemberName,
  normalizeMemberPhone,
  utcDateOnlyToCivilDate,
} from '@crelune/shared';
import { assertSafeDevDatabaseEnvironment } from './assert-dev-db';

describe('PostgreSQL Stage 3.1 Member & Birthday Schema Integration (Neon Development)', () => {
  const runId = crypto.randomBytes(6).toString('hex');
  const createdOrgIds = new Set<string>();

  async function createIsolatedTestOrg(suffix: string) {
    const org = await prisma.organisation.create({
      data: {
        name: `__pg_m3_1_org_${runId}_${suffix}`,
        slug: `__pg-m3-1-${runId}-${suffix}`,
      },
    });
    createdOrgIds.add(org.id);
    return org;
  }

  async function cleanupTestOrgs() {
    if (createdOrgIds.size === 0) return;
    const orgIds = Array.from(createdOrgIds);
    // Delete children before organisations (Organisation uses onDelete: Restrict)
    await prisma.auditLog.deleteMany({ where: { organisationId: { in: orgIds } } });
    await prisma.notification.deleteMany({ where: { organisationId: { in: orgIds } } });
    await prisma.birthdayReminder.deleteMany({ where: { organisationId: { in: orgIds } } });
    await prisma.birthdayPreparation.deleteMany({ where: { organisationId: { in: orgIds } } });
    await prisma.member.deleteMany({ where: { organisationId: { in: orgIds } } });
    await prisma.user.deleteMany({ where: { organisationId: { in: orgIds } } });
    await prisma.organisation.deleteMany({ where: { id: { in: orgIds } } });
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

  it('preserves existing owner data, applies UserPreference defaults, and omits is_active on members', async () => {
    const columns = await prisma.$queryRaw<Array<{ column_name: string; data_type: string }>>`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'members'
    `;
    const colNames = new Set(columns.map((c) => c.column_name));
    expect(colNames.has('archived_at')).toBe(true);
    expect(colNames.has('is_active')).toBe(false);
    expect(colNames.has('full_name')).toBe(true);
    expect(colNames.has('preferred_name')).toBe(true);
    expect(colNames.has('birth_year')).toBe(true);

    const existingOwner = await prisma.user.findFirst({
      where: { role: 'OWNER', isActive: true },
      include: { preferences: true },
    });
    expect(existingOwner).not.toBeNull();
    expect(existingOwner!.preferences).not.toBeNull();
    expect(existingOwner!.preferences!.timezone).toBe('Africa/Accra');
    expect(existingOwner!.preferences!.birthdayReminderDays).toEqual([7, 3, 1, 0]);
    expect(existingOwner!.preferences!.leapDayPolicy).toBe('FEB_28');
  });

  it('derives active vs archived members from archivedAt IS NULL and supports unknown birthYear', async () => {
    const org = await createIsolatedTestOrg('archival');

    const activeMember = await prisma.member.create({
      data: {
        organisationId: org.id,
        fullName: 'Sister Ama Mensah',
        preferredName: 'Sis. Ama',
        normalizedName: normalizeMemberName('Sister Ama Mensah'),
        birthMonth: 2,
        birthDay: 29,
        birthYear: null,
        phone: '+233 24 000 0001',
        normalizedPhone: normalizeMemberPhone('+233 24 000 0001'),
      },
    });

    const archivedMember = await prisma.member.create({
      data: {
        organisationId: org.id,
        fullName: 'Brother Kofi Boateng',
        normalizedName: normalizeMemberName('Brother Kofi Boateng'),
        birthMonth: null,
        birthDay: null,
        birthYear: null,
        archivedAt: new Date(),
      },
    });

    expect(isMemberActive(activeMember)).toBe(true);
    expect(isMemberArchived(archivedMember)).toBe(true);
    expect(activeMember.birthYear).toBeNull();

    const activeRows = await prisma.member.findMany({
      where: { organisationId: org.id, archivedAt: null },
    });
    const archivedRows = await prisma.member.findMany({
      where: { organisationId: org.id, archivedAt: { not: null } },
    });

    expect(activeRows.map((m) => m.id)).toEqual([activeMember.id]);
    expect(archivedRows.map((m) => m.id)).toEqual([archivedMember.id]);
  });

  it('enforces unique constraints on BirthdayPreparation, BirthdayReminder, and Notification and persists date-only fields', async () => {
    const org = await createIsolatedTestOrg('constraints');

    const ownerUser = await prisma.user.create({
      data: {
        organisationId: org.id,
        email: `__pg_m3_1_owner_${runId}@crelune.test`,
        passwordHash: 'not-a-real-hash',
        firstName: 'Test',
        lastName: 'Owner',
        role: 'OWNER',
      },
    });

    const member = await prisma.member.create({
      data: {
        organisationId: org.id,
        fullName: 'Kwame Nkrumah-Test',
        normalizedName: normalizeMemberName('Kwame Nkrumah-Test'),
        birthMonth: 2,
        birthDay: 29,
        birthYear: null,
      },
    });

    const scheduled = calculateBirthdayReminderDates(
      { birthMonth: 2, birthDay: 29 },
      2026,
      DEFAULT_REMINDER_LEAD_DAYS,
      'FEB_28'
    );
    const celebrationUtc = civilDateToUtcMidnight(scheduled[0]!.celebrationDate);

    // 1. BirthdayPreparation uniqueness per (memberId, targetYear)
    const prep = await prisma.birthdayPreparation.create({
      data: {
        organisationId: org.id,
        memberId: member.id,
        targetYear: 2026,
        celebrationDate: celebrationUtc,
      },
    });
    expect(utcDateOnlyToCivilDate(prep.celebrationDate)).toEqual({
      year: 2026,
      month: 2,
      day: 28,
    });

    await expect(
      prisma.birthdayPreparation.create({
        data: {
          organisationId: org.id,
          memberId: member.id,
          targetYear: 2026,
          celebrationDate: celebrationUtc,
        },
      })
    ).rejects.toMatchObject({ code: 'P2002' });

    // 2. BirthdayReminder uniqueness per (memberId, targetYear, leadDays) and idempotencyKey
    const sevenDaySchedule = scheduled.find((s) => s.leadDays === 7)!;
    const sevenDayReminder = await prisma.birthdayReminder.create({
      data: {
        organisationId: org.id,
        memberId: member.id,
        targetYear: 2026,
        leadDays: 7,
        scheduledForDate: civilDateToUtcMidnight(sevenDaySchedule.scheduledDate),
        idempotencyKey: buildBirthdayReminderIdempotencyKey(member.id, 2026, 7),
      },
    });

    expect(utcDateOnlyToCivilDate(sevenDayReminder.scheduledForDate)).toEqual({
      year: 2026,
      month: 2,
      day: 21,
    });

    // Reject duplicate (memberId, targetYear, leadDays) even with distinct idempotencyKey
    await expect(
      prisma.birthdayReminder.create({
        data: {
          organisationId: org.id,
          memberId: member.id,
          targetYear: 2026,
          leadDays: 7,
          scheduledForDate: civilDateToUtcMidnight(sevenDaySchedule.scheduledDate),
          idempotencyKey: `distinct-${sevenDayReminder.idempotencyKey}`,
        },
      })
    ).rejects.toMatchObject({ code: 'P2002' });

    // Reject duplicate idempotencyKey even with distinct leadDays
    await expect(
      prisma.birthdayReminder.create({
        data: {
          organisationId: org.id,
          memberId: member.id,
          targetYear: 2026,
          leadDays: 3,
          scheduledForDate: civilDateToUtcMidnight(sevenDaySchedule.scheduledDate),
          idempotencyKey: sevenDayReminder.idempotencyKey,
        },
      })
    ).rejects.toMatchObject({ code: 'P2002' });

    // 3. Notification uniqueness per birthdayReminderId + AuditLog persistence
    const notif = await prisma.notification.create({
      data: {
        organisationId: org.id,
        userId: ownerUser.id,
        memberId: member.id,
        birthdayReminderId: sevenDayReminder.id,
        title: 'Upcoming Birthday Reminder',
        body: 'Birthday preparation scheduled in 7 days.',
      },
    });
    expect(notif.birthdayReminderId).toBe(sevenDayReminder.id);

    await expect(
      prisma.notification.create({
        data: {
          organisationId: org.id,
          userId: ownerUser.id,
          memberId: member.id,
          birthdayReminderId: sevenDayReminder.id,
          title: 'Duplicate Notification',
          body: 'Should be rejected by unique birthdayReminderId.',
        },
      })
    ).rejects.toMatchObject({ code: 'P2002' });

    const audit = await prisma.auditLog.create({
      data: {
        organisationId: org.id,
        actorUserId: ownerUser.id,
        action: 'MEMBER_SCHEMA_FIXTURE_VERIFIED',
        entityType: 'Member',
        entityId: member.id,
        metadata: { changedFields: ['birthMonth', 'birthDay'] } as Prisma.InputJsonValue,
      },
    });
    expect(audit.action).toBe('MEMBER_SCHEMA_FIXTURE_VERIFIED');
  });
});
