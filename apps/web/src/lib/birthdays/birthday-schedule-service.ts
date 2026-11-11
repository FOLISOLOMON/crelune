/**
 * CRELUNE — Birthday Reminder Schedule Reconciliation Service
 *
 * Uses pure civil date helpers from @crelune/shared and organisation-scoped
 * PostgreSQL advisory locks to materialize, update, reactivate, skip, or cancel
 * birthday preparations and reminder schedules cleanly without rewriting SENT history.
 */

import { prisma, type Prisma } from '@crelune/database';
import {
  buildBirthdayReminderIdempotencyKey,
  calculateBirthdayReminderDates,
  civilDateToUtcMidnight,
  compareCivilDates,
  formatCivilDateIso,
  getTodayCivilDate,
  resolveCelebrationDateForYear,
  utcDateOnlyToCivilDate,
  validateBirthdayTuple,
} from '@crelune/shared';
import { loadOwnerBirthdayPreferences } from './birthday-preferences';

export interface ScheduleReconciliationResult {
  schedulesCreated: number;
  schedulesUpdated: number;
  schedulesCancelled: number;
  preparationsSynced: number;
  remindersSkipped: number;
}

export interface ReconcileScheduleOptions {
  now?: Date;
}

interface DesiredReminderSpec {
  targetYear: number;
  leadDays: number;
  idempotencyKey: string;
  scheduledIsoDate: string;
  scheduledUtcDate: Date;
}

function makeReminderKey(targetYear: number, leadDays: number): string {
  return `${targetYear}:${leadDays}`;
}

/**
 * Reconciles `BirthdayPreparation` and `BirthdayReminder` rows for all members
 * in `organisationId` across `[today.year, today.year + 1]`.
 */
export async function reconcileOrganisationBirthdaySchedules(
  organisationId: string,
  ownerUserId: string,
  options: ReconcileScheduleOptions = {}
): Promise<ScheduleReconciliationResult> {
  const now = options.now ?? new Date();

  return prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`bday_sync:${organisationId}`}))`;

      const settings = await loadOwnerBirthdayPreferences(tx, ownerUserId);
      const today = getTodayCivilDate(settings.timezone, now);
      const targetYears = [today.year, today.year + 1] as const;

      const members = await tx.member.findMany({
        where: { organisationId },
        select: {
          id: true,
          organisationId: true,
          birthDay: true,
          birthMonth: true,
          birthYear: true,
          archivedAt: true,
        },
      });
      const existingPreparations = await tx.birthdayPreparation.findMany({
        where: {
          organisationId,
          targetYear: { in: [...targetYears] },
        },
        select: {
          id: true,
          memberId: true,
          targetYear: true,
          celebrationDate: true,
        },
      });
      const existingReminders = await tx.birthdayReminder.findMany({
        where: { organisationId },
        select: {
          id: true,
          memberId: true,
          targetYear: true,
          leadDays: true,
          scheduledForDate: true,
          status: true,
          notification: { select: { id: true } },
        },
      });

      const prepCreates: Prisma.BirthdayPreparationCreateManyInput[] = [];
      const reminderCreates: Prisma.BirthdayReminderCreateManyInput[] = [];
      const skipIds: string[] = [];
      const cancelIds: string[] = [];

    const prepByMemberYear = new Map<
      string,
      (typeof existingPreparations)[number]
    >();
    for (const prep of existingPreparations) {
      prepByMemberYear.set(`${prep.memberId}:${prep.targetYear}`, prep);
    }

    const remindersByMember = new Map<
      string,
      Array<(typeof existingReminders)[number]>
    >();
    for (const rem of existingReminders) {
      const list = remindersByMember.get(rem.memberId) ?? [];
      list.push(rem);
      remindersByMember.set(rem.memberId, list);
    }

    const counts: ScheduleReconciliationResult = {
      schedulesCreated: 0,
      schedulesUpdated: 0,
      schedulesCancelled: 0,
      preparationsSynced: 0,
      remindersSkipped: 0,
    };

    for (const member of members) {
      const memberReminders = remindersByMember.get(member.id) ?? [];
      const birthdayCheck = validateBirthdayTuple(
        {
          birthMonth: member.birthMonth,
          birthDay: member.birthDay,
          birthYear: member.birthYear,
        },
        { maxBirthYear: today.year }
      );

      // Archived members or members without a complete valid birthday must have
      // pending/failed reminders cancelled without deleting SENT/SKIPPED history.
      if (member.archivedAt !== null || !birthdayCheck.valid || !birthdayCheck.hasBirthday) {
        for (const rem of memberReminders) {
          if (rem.status === 'PENDING' || rem.status === 'FAILED') {
            cancelIds.push(rem.id);
          }
        }
        continue;
      }

      const { birthMonth, birthDay } = birthdayCheck;
      const desiredByKey = new Map<string, DesiredReminderSpec>();
      const existingByKey = new Map<string, (typeof existingReminders)[number]>();
      for (const rem of memberReminders) {
        existingByKey.set(makeReminderKey(rem.targetYear, rem.leadDays), rem);
      }

      for (const targetYear of targetYears) {
        const celebration = resolveCelebrationDateForYear(
          birthMonth,
          birthDay,
          targetYear,
          settings.leapDayPolicy
        );

        const existingPrep = prepByMemberYear.get(`${member.id}:${targetYear}`);
        const celebrationNotPassed = compareCivilDates(celebration.date, today) >= 0;

        if (celebrationNotPassed) {
          const celebrationUtc = civilDateToUtcMidnight(celebration.date);
          if (!existingPrep) {
            prepCreates.push({
              organisationId,
              memberId: member.id,
              targetYear,
              celebrationDate: celebrationUtc,
            });
          } else {
            const existingPrepIso = formatCivilDateIso(
              utcDateOnlyToCivilDate(existingPrep.celebrationDate)
            );
            if (existingPrepIso !== celebration.isoDate) {
              await tx.birthdayPreparation.update({
                where: { id: existingPrep.id },
                data: { celebrationDate: celebrationUtc },
              });
              counts.preparationsSynced += 1;
            }
          }

          const scheduledItems = calculateBirthdayReminderDates(
            { birthMonth, birthDay },
            targetYear,
            settings.birthdayReminderDays,
            settings.leapDayPolicy
          );

          for (const item of scheduledItems) {
            desiredByKey.set(makeReminderKey(targetYear, item.leadDays), {
              targetYear,
              leadDays: item.leadDays,
              idempotencyKey: buildBirthdayReminderIdempotencyKey(
                member.id,
                targetYear,
                item.leadDays
              ),
              scheduledIsoDate: item.scheduledIsoDate,
              scheduledUtcDate: civilDateToUtcMidnight(item.scheduledDate),
            });
          }
        } else if (existingPrep) {
          const existingPrepIso = formatCivilDateIso(
            utcDateOnlyToCivilDate(existingPrep.celebrationDate)
          );
          if (existingPrepIso !== celebration.isoDate) {
            await tx.birthdayPreparation.update({
              where: { id: existingPrep.id },
              data: { celebrationDate: civilDateToUtcMidnight(celebration.date) },
            });
            counts.preparationsSynced += 1;
          }
        }
      }

      // Materialize / update desired schedules without rewriting SENT history
      for (const [key, desired] of desiredByKey.entries()) {
        const existing = existingByKey.get(key);
        if (!existing) {
          reminderCreates.push({
            organisationId,
            memberId: member.id,
            targetYear: desired.targetYear,
            leadDays: desired.leadDays,
            scheduledForDate: desired.scheduledUtcDate,
            status: 'PENDING',
            idempotencyKey: desired.idempotencyKey,
            attemptCount: 0,
          });
          continue;
        }

        // Never modify SENT reminders or rows that already emitted a Notification
        if (existing.status === 'SENT' || existing.notification !== null) {
          continue;
        }

        const existingScheduledIso = formatCivilDateIso(
          utcDateOnlyToCivilDate(existing.scheduledForDate)
        );

        if (existing.status === 'PENDING') {
          if (existingScheduledIso !== desired.scheduledIsoDate) {
            await tx.birthdayReminder.update({
              where: { id: existing.id },
              data: {
                scheduledForDate: desired.scheduledUtcDate,
                lastError: null,
              },
            });
            counts.schedulesUpdated += 1;
          }
          continue;
        }

        if (existing.status === 'CANCELLED') {
          await tx.birthdayReminder.update({
            where: { id: existing.id },
            data: {
              scheduledForDate: desired.scheduledUtcDate,
              status: 'PENDING',
              attemptCount: 0,
              lastError: null,
            },
          });
          counts.schedulesCreated += 1;
          continue;
        }

        // Existing SKIPPED or FAILED reminder: only re-arm if birthday/leap-policy edit shifted its date
        if (existingScheduledIso !== desired.scheduledIsoDate) {
          await tx.birthdayReminder.update({
            where: { id: existing.id },
            data: {
              scheduledForDate: desired.scheduledUtcDate,
              status: 'PENDING',
              attemptCount: 0,
              lastError: null,
            },
          });
          counts.schedulesUpdated += 1;
        }
      }

      // Transition obsolete PENDING / FAILED reminders to SKIPPED (expired) or CANCELLED (policy change)
      for (const [key, rem] of existingByKey.entries()) {
        if (rem.status !== 'PENDING' && rem.status !== 'FAILED') {
          continue;
        }
        if (desiredByKey.has(key)) {
          continue;
        }

        const celebrationForRemYear = resolveCelebrationDateForYear(
          birthMonth,
          birthDay,
          rem.targetYear,
          settings.leapDayPolicy
        );

        if (compareCivilDates(celebrationForRemYear.date, today) < 0) {
          skipIds.push(rem.id);
        } else {
          cancelIds.push(rem.id);
        }
      }
    }

    if (prepCreates.length > 0) {
      const prepRes = await tx.birthdayPreparation.createMany({
        data: prepCreates,
        skipDuplicates: true,
      });
      counts.preparationsSynced += prepRes.count;
    }

    if (reminderCreates.length > 0) {
      const remRes = await tx.birthdayReminder.createMany({
        data: reminderCreates,
        skipDuplicates: true,
      });
      counts.schedulesCreated += remRes.count;
    }

    if (skipIds.length > 0) {
      const skipRes = await tx.birthdayReminder.updateMany({
        where: {
          id: { in: skipIds },
          status: { in: ['PENDING', 'FAILED'] },
        },
        data: {
          status: 'SKIPPED',
          lastError: null,
        },
      });
      counts.remindersSkipped += skipRes.count;
    }

    if (cancelIds.length > 0) {
      const cancelRes = await tx.birthdayReminder.updateMany({
        where: {
          id: { in: cancelIds },
          status: { in: ['PENDING', 'FAILED'] },
        },
        data: {
          status: 'CANCELLED',
          lastError: null,
        },
      });
      counts.schedulesCancelled += cancelRes.count;
    }

    return counts;
    },
    { maxWait: 15_000, timeout: 30_000 }
  );
}

