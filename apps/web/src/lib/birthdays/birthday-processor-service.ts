/**
 * CRELUNE — Birthday Reminder Processing & Notification Persistence Service
 *
 * Atomically claims due reminders under PostgreSQL row locks, reconfirms active member,
 * birthday, preference parity, and celebration-date expiry before creating in-app
 * notifications inside a single database transaction.
 */

import { Prisma, prisma } from '@crelune/database';
import {
  addCalendarDays,
  civilDateToUtcMidnight,
  compareCivilDates,
  getTodayCivilDate,
  resolveCelebrationDateForYear,
  utcDateOnlyToCivilDate,
  validateBirthdayTuple,
  type CelebratedDateResolution,
} from '@crelune/shared';
import * as auditService from '@/lib/audit/audit-service';
import { loadOwnerBirthdayPreferences } from './birthday-preferences';

export const MAX_REMINDER_ATTEMPTS = 3;

const MONTH_ABBREVIATIONS = [
  '',
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

export interface ReminderProcessingResult {
  remindersDue: number;
  notificationsCreated: number;
  remindersSkipped: number;
  remindersFailed: number;
}

export interface ProcessRemindersOptions {
  now?: Date;
  persistNotification?: (
    tx: Prisma.TransactionClient,
    input: {
      organisationId: string;
      userId: string;
      memberId: string;
      birthdayReminderId: string;
      title: string;
      body: string;
      href: string;
    }
  ) => Promise<void>;
}

export class PermanentReminderProcessingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PermanentReminderProcessingError';
  }
}

/**
 * Formats a concise, privacy-safe error label for `BirthdayReminder.lastError`
 * containing only error class and optional Prisma error code (never URLs, credentials,
 * or member personal information).
 */
export function formatSafeReminderError(err: unknown): string {
  if (err && typeof err === 'object') {
    const code = 'code' in err ? String((err as { code?: unknown }).code) : '';
    const name = err instanceof Error && err.name ? err.name : 'ProcessingError';
    if (code && /^[A-Z0-9_]{2,16}$/i.test(code)) {
      return `${name}:${code}`.slice(0, 100);
    }
    return name.slice(0, 100);
  }
  return 'UnknownProcessingError';
}

function isUniqueConstraintError(err: unknown): boolean {
  return Boolean(
    err &&
      typeof err === 'object' &&
      'code' in err &&
      (err as { code?: unknown }).code === 'P2002'
  );
}

function isPermanentFailure(err: unknown): boolean {
  if (err instanceof PermanentReminderProcessingError) {
    return true;
  }
  if (err && typeof err === 'object' && 'code' in err) {
    const code = String((err as { code?: unknown }).code);
    // Foreign key violation or missing record cannot succeed on blind retry
    return code === 'P2003' || code === 'P2025';
  }
  return false;
}

export function buildBirthdayNotificationContent(
  member: { id: string; fullName: string; preferredName: string | null },
  leadDays: number,
  celebration: CelebratedDateResolution
): { title: string; body: string; href: string } {
  const displayName = member.preferredName?.trim() || member.fullName.trim();
  const monthLabel = MONTH_ABBREVIATIONS[celebration.date.month] ?? '';
  const dateLabel = `${celebration.date.day} ${monthLabel} ${celebration.date.year}`.trim();

  let title: string;
  let body: string;

  if (leadDays === 0) {
    title = `Birthday today: ${displayName}`;
    body = `${displayName}'s birthday celebration is today (${dateLabel}).`;
  } else if (leadDays === 1) {
    title = `Birthday tomorrow: ${displayName}`;
    body = `${displayName}'s birthday celebration is tomorrow (${dateLabel}).`;
  } else {
    title = `Upcoming birthday (${leadDays} days): ${displayName}`;
    body = `${displayName}'s birthday celebration is on ${dateLabel} (in ${leadDays} days).`;
  }

  if (celebration.observedDueToLeapPolicy) {
    body = `${body} Observed under your leap-day policy.`;
  }

  return {
    title,
    body,
    href: `/members/${member.id}`,
  };
}

/**
 * Processes due `PENDING` / retryable `FAILED` reminders for `organisationId`,
 * expiring stale reminders (`SKIPPED`), cancelling invalidated reminders (`CANCELLED`),
 * and creating deduplicated in-app notifications for `ownerUserId`.
 */
export async function processDueBirthdayReminders(
  organisationId: string,
  ownerUserId: string,
  options: ProcessRemindersOptions = {}
): Promise<ReminderProcessingResult> {
  const now = options.now ?? new Date();
  const settings = await loadOwnerBirthdayPreferences(prisma, ownerUserId);

  const ownerAccount = await prisma.user.findFirst({
    where: {
      id: ownerUserId,
      organisationId,
      role: 'OWNER',
      isActive: true,
    },
    select: { id: true },
  });

  if (!ownerAccount) {
    throw new PermanentReminderProcessingError('Active organisation owner account not found.');
  }

  const today = getTodayCivilDate(settings.timezone, now);
  const todayUtc = civilDateToUtcMidnight(today);

  const dueCandidates = await prisma.birthdayReminder.findMany({
    where: {
      organisationId,
      status: { in: ['PENDING', 'FAILED'] },
      attemptCount: { lt: MAX_REMINDER_ATTEMPTS },
      scheduledForDate: { lte: todayUtc },
    },
    orderBy: [{ scheduledForDate: 'asc' }, { leadDays: 'desc' }, { id: 'asc' }],
    select: { id: true },
  });

  const result: ReminderProcessingResult = {
    remindersDue: 0,
    notificationsCreated: 0,
    remindersSkipped: 0,
    remindersFailed: 0,
  };

  for (const candidate of dueCandidates) {
    try {
      const outcome = await prisma.$transaction(
        async (tx) => {
        // Row-level lock serializes concurrent cron/on-demand processing of the same reminder
        await tx.$queryRaw`SELECT id FROM birthday_reminders WHERE id = ${candidate.id} AND organisation_id = ${organisationId} FOR UPDATE`;

        const current = await tx.birthdayReminder.findFirst({
          where: { id: candidate.id, organisationId },
          include: {
            member: {
              select: {
                id: true,
                organisationId: true,
                fullName: true,
                preferredName: true,
                birthDay: true,
                birthMonth: true,
                birthYear: true,
                archivedAt: true,
              },
            },
            notification: { select: { id: true } },
          },
        });

        if (!current) {
          return 'noop' as const;
        }

        if (
          current.status === 'SENT' ||
          current.status === 'SKIPPED' ||
          current.status === 'CANCELLED' ||
          current.notification !== null ||
          current.attemptCount >= MAX_REMINDER_ATTEMPTS
        ) {
          return 'noop' as const;
        }

        const birthdayCheck = validateBirthdayTuple(
          {
            birthMonth: current.member.birthMonth,
            birthDay: current.member.birthDay,
            birthYear: current.member.birthYear,
          },
          { maxBirthYear: today.year }
        );

        // Reconfirm active status and valid birthday before any delivery
        if (
          current.member.archivedAt !== null ||
          current.member.organisationId !== organisationId ||
          !birthdayCheck.valid ||
          !birthdayCheck.hasBirthday
        ) {
          await tx.birthdayReminder.update({
            where: { id: current.id },
            data: { status: 'CANCELLED', lastError: null },
          });
          return 'cancelled' as const;
        }

        const celebration = resolveCelebrationDateForYear(
          birthdayCheck.birthMonth,
          birthdayCheck.birthDay,
          current.targetYear,
          settings.leapDayPolicy
        );

        // Expired reminder cutoff: never deliver stale notifications after the celebration date
        if (compareCivilDates(celebration.date, today) < 0) {
          await tx.birthdayReminder.update({
            where: { id: current.id },
            data: { status: 'SKIPPED', lastError: null },
          });
          return 'skipped' as const;
        }

        const storedScheduled = utcDateOnlyToCivilDate(current.scheduledForDate);
        const expectedScheduled = addCalendarDays(celebration.date, -current.leadDays);

        // Reconfirm preference interval and birthday schedule parity
        if (
          !settings.birthdayReminderDays.includes(current.leadDays) ||
          compareCivilDates(expectedScheduled, storedScheduled) !== 0
        ) {
          await tx.birthdayReminder.update({
            where: { id: current.id },
            data: { status: 'CANCELLED', lastError: null },
          });
          return 'cancelled' as const;
        }

        if (compareCivilDates(storedScheduled, today) > 0) {
          return 'noop' as const;
        }

        const content = buildBirthdayNotificationContent(
          current.member,
          current.leadDays,
          celebration
        );

        const notificationPayload = {
          organisationId,
          userId: ownerUserId,
          memberId: current.member.id,
          birthdayReminderId: current.id,
          title: content.title,
          body: content.body,
          href: content.href,
        };

        // Persist notification BEFORE transitioning BirthdayReminder to SENT
        if (options.persistNotification) {
          await options.persistNotification(tx, notificationPayload);
        } else {
          await tx.notification.create({
            data: {
              ...notificationPayload,
              type: 'BIRTHDAY_REMINDER',
            },
          });
        }

        await tx.birthdayReminder.update({
          where: { id: current.id },
          data: {
            status: 'SENT',
            sentAt: now,
            attemptCount: current.attemptCount + 1,
            lastError: null,
          },
        });

        return 'sent' as const;
        },
        { maxWait: 15_000, timeout: 25_000 }
      );

      if (outcome === 'sent') {
        result.remindersDue += 1;
        result.notificationsCreated += 1;
      } else if (outcome === 'skipped') {
        result.remindersSkipped += 1;
      }
    } catch (err) {
      // Unique conflict on birthday_reminder_id means notification already exists -> reconcile safely
      if (isUniqueConstraintError(err)) {
        const existingNotification = await prisma.notification.findUnique({
          where: { birthdayReminderId: candidate.id },
          select: { id: true, createdAt: true },
        });
        if (existingNotification) {
          await prisma.birthdayReminder.updateMany({
            where: {
              id: candidate.id,
              organisationId,
              status: { in: ['PENDING', 'FAILED'] },
            },
            data: {
              status: 'SENT',
              sentAt: existingNotification.createdAt,
              lastError: null,
            },
          });
          continue;
        }
      }

      const safeError = formatSafeReminderError(err);
      const permanent = isPermanentFailure(err);

      const recordedFailure = await prisma.$transaction(
        async (errTx) => {
          // Lock the reminder row so concurrent failures increment atomically without lost updates
          await errTx.$queryRaw`SELECT id FROM birthday_reminders WHERE id = ${candidate.id} AND organisation_id = ${organisationId} FOR UPDATE`;

          const currentRow = await errTx.birthdayReminder.findFirst({
            where: { id: candidate.id, organisationId },
            select: { id: true, status: true, attemptCount: true },
          });

          if (
            !currentRow ||
            (currentRow.status !== 'PENDING' && currentRow.status !== 'FAILED') ||
            currentRow.attemptCount >= MAX_REMINDER_ATTEMPTS
          ) {
            return false;
          }

          const updated = await errTx.birthdayReminder.updateMany({
            where: {
              id: candidate.id,
              organisationId,
              status: { in: ['PENDING', 'FAILED'] },
              attemptCount: { lt: MAX_REMINDER_ATTEMPTS },
            },
            data: permanent
              ? {
                  status: 'FAILED',
                  attemptCount: MAX_REMINDER_ATTEMPTS,
                  lastError: safeError,
                }
              : {
                  status: 'FAILED',
                  attemptCount: { increment: 1 },
                  lastError: safeError,
                },
          });

          if (updated.count === 0) {
            return false;
          }

          const afterUpdate = await errTx.birthdayReminder.findFirst({
            where: { id: candidate.id, organisationId },
            select: { status: true, attemptCount: true },
          });

          if (
            afterUpdate &&
            afterUpdate.status === 'FAILED' &&
            afterUpdate.attemptCount >= MAX_REMINDER_ATTEMPTS
          ) {
            await auditService.recordAuditEvent(errTx, {
              organisationId,
              actorUserId: ownerUserId,
              action: auditService.AUDIT_ACTIONS.BIRTHDAY_REMINDER_FAILED,
              entityType: 'BirthdayReminder',
              entityId: candidate.id,
              metadata: {
                attemptCount: afterUpdate.attemptCount,
                errorCode: safeError,
                permanent,
              },
            });
          }

          return true;
        },
        { maxWait: 15_000, timeout: 25_000 }
      );

      if (recordedFailure) {
        result.remindersDue += 1;
        result.remindersFailed += 1;
      }
    }
  }

  return result;
}

