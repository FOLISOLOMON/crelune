/**
 * CRELUNE — Unified Birthday Engine Orchestrator
 *
 * Shared by both owner-authenticated on-demand sync (`POST /api/birthdays/sync`)
 * and protected daily cron processing (`POST /api/cron/birthday-reminders`).
 */

import { prisma } from '@crelune/database';
import type { BirthdaySyncSummary } from '@crelune/shared';
import {
  processDueBirthdayReminders,
  type ProcessRemindersOptions,
} from './birthday-processor-service';
import { reconcileOrganisationBirthdaySchedules } from './birthday-schedule-service';

export interface RunBirthdayCycleOptions {
  now?: Date;
  persistNotification?: ProcessRemindersOptions['persistNotification'];
}

export interface CronBirthdayRunSummary {
  processedOrganisations: number;
  schedulesCreated: number;
  schedulesUpdated: number;
  schedulesCancelled: number;
  preparationsSynced: number;
  remindersDue: number;
  notificationsCreated: number;
  remindersSkipped: number;
  remindersFailed: number;
}

/**
 * Reconciles birthday reminder schedules and processes all due reminders
 * for a single owner/organisation cleanly.
 */
export async function runOrganisationBirthdayCycle(
  organisationId: string,
  ownerUserId: string,
  options: RunBirthdayCycleOptions = {}
): Promise<BirthdaySyncSummary> {
  const scheduleSummary = await reconcileOrganisationBirthdaySchedules(
    organisationId,
    ownerUserId,
    { now: options.now }
  );

  const processingSummary = await processDueBirthdayReminders(
    organisationId,
    ownerUserId,
    {
      now: options.now,
      persistNotification: options.persistNotification,
    }
  );

  const unreadNotificationCount = await prisma.notification.count({
    where: {
      organisationId,
      userId: ownerUserId,
      readAt: null,
    },
  });

  return {
    schedulesCreated: scheduleSummary.schedulesCreated,
    schedulesUpdated: scheduleSummary.schedulesUpdated,
    schedulesCancelled: scheduleSummary.schedulesCancelled,
    preparationsSynced: scheduleSummary.preparationsSynced,
    remindersDue: processingSummary.remindersDue,
    notificationsCreated: processingSummary.notificationsCreated,
    remindersSkipped:
      scheduleSummary.remindersSkipped + processingSummary.remindersSkipped,
    remindersFailed: processingSummary.remindersFailed,
    unreadNotificationCount,
  };
}

/**
 * Runs the birthday reminder cycle across active single-owner accounts.
 */
export async function runScheduledBirthdayRemindersForActiveOwners(
  options: RunBirthdayCycleOptions = {}
): Promise<CronBirthdayRunSummary> {
  const activeOwners = await prisma.user.findMany({
    where: {
      role: 'OWNER',
      isActive: true,
    },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      organisationId: true,
    },
  });

  const totals: CronBirthdayRunSummary = {
    processedOrganisations: 0,
    schedulesCreated: 0,
    schedulesUpdated: 0,
    schedulesCancelled: 0,
    preparationsSynced: 0,
    remindersDue: 0,
    notificationsCreated: 0,
    remindersSkipped: 0,
    remindersFailed: 0,
  };

  for (const owner of activeOwners) {
    const orgSummary = await runOrganisationBirthdayCycle(
      owner.organisationId,
      owner.id,
      options
    );
    totals.processedOrganisations += 1;
    totals.schedulesCreated += orgSummary.schedulesCreated;
    totals.schedulesUpdated += orgSummary.schedulesUpdated;
    totals.schedulesCancelled += orgSummary.schedulesCancelled;
    totals.preparationsSynced += orgSummary.preparationsSynced;
    totals.remindersDue += orgSummary.remindersDue;
    totals.notificationsCreated += orgSummary.notificationsCreated;
    totals.remindersSkipped += orgSummary.remindersSkipped;
    totals.remindersFailed += orgSummary.remindersFailed;
  }

  return totals;
}

