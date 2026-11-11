/**
 * CRELUNE — Shared Birthday Engine & Notification API Contracts
 */

import { z } from 'zod';
import {
  SUPPORTED_LEAP_DAY_POLICIES,
  isValidIanaTimeZone,
  validateReminderLeadDays,
  type LeapDayPolicy,
} from '../domain/birthday-date.js';
import type { DesignJobStatus } from '../domain/design-job.js';
import { memberIdParamSchema } from './member.js';

export const BIRTHDAY_PREP_STATUSES = [
  'UPCOMING',
  'PREPARATION_PENDING',
  'DESIGN_IN_PROGRESS',
  'AWAITING_APPROVAL',
  'PUBLISHED',
  'SKIPPED',
] as const;

export type BirthdayPrepStatus = (typeof BIRTHDAY_PREP_STATUSES)[number];

export const BIRTHDAY_PREP_STATUS_LABELS: Record<BirthdayPrepStatus, string> = {
  UPCOMING: 'Upcoming',
  PREPARATION_PENDING: 'Preparation Pending',
  DESIGN_IN_PROGRESS: 'Design in Progress',
  AWAITING_APPROVAL: 'Awaiting Approval',
  PUBLISHED: 'Published',
  SKIPPED: 'Skipped',
};

export const NOTIFICATION_LIST_DEFAULT_LIMIT = 25;
export const NOTIFICATION_LIST_MAX_LIMIT = 100;

export type NotificationType = 'BIRTHDAY_REMINDER' | 'SYSTEM';

export interface NotificationItem {
  id: string;
  memberId: string | null;
  birthdayReminderId: string | null;
  type: NotificationType;
  title: string;
  body: string;
  href: string | null;
  isRead: boolean;
  readAt: string | null;
  createdAt: string;
}

export interface NotificationListPaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
}

export interface NotificationListResponse {
  notifications: NotificationItem[];
  unreadCount: number;
  pagination: NotificationListPaginationMeta;
}

export interface BirthdaySyncSummary {
  schedulesCreated: number;
  schedulesUpdated: number;
  schedulesCancelled: number;
  preparationsSynced: number;
  remindersDue: number;
  notificationsCreated: number;
  remindersSkipped: number;
  remindersFailed: number;
  unreadNotificationCount: number;
}

export const notificationIdParamSchema = memberIdParamSchema;

export const notificationListQuerySchema = z
  .object({
    unreadOnly: z
      .preprocess((val) => {
        if (val === undefined || val === null || val === '') return false;
        if (val === 'true' || val === true) return true;
        if (val === 'false' || val === false) return false;
        return val;
      }, z.boolean({ invalid_type_error: 'unreadOnly must be true or false' }))
      .default(false),
    page: z.preprocess(
      (val) => (val === '' || val === undefined || val === null ? 1 : Number(val)),
      z.number().int('Page must be an integer').min(1, 'Page must be at least 1')
    ),
    limit: z.preprocess(
      (val) =>
        val === '' || val === undefined || val === null
          ? NOTIFICATION_LIST_DEFAULT_LIMIT
          : Number(val),
      z
        .number()
        .int('Limit must be an integer')
        .min(1, 'Limit must be at least 1')
        .max(
          NOTIFICATION_LIST_MAX_LIMIT,
          `Limit must not exceed ${NOTIFICATION_LIST_MAX_LIMIT}`
        )
    ),
  })
  .strict();

export type NotificationListQuery = z.infer<typeof notificationListQuerySchema>;

export const birthdaySyncRequestSchema = z.object({}).strict();

export interface BirthdayCalendarMemberItem {
  memberId: string;
  fullName: string;
  preferredName: string | null;
  birthDay: number;
  birthMonth: number;
  birthYear: number | null;
  hasPhoto: boolean;
  photoUpdatedAt: string | null;
  targetYear: number;
  celebratedDateIso: string;
  celebratedMonth: number;
  celebratedDay: number;
  daysUntil: number;
  isToday: boolean;
  isLeapDayAdjusted: boolean;
  prepId: string | null;
  prepStatus: BirthdayPrepStatus;
  prepNotes: string | null;
  designJobId: string | null;
  designJobTitle: string | null;
  designJobStatus: DesignJobStatus | null;
}

export interface BirthdayOverviewCounts {
  totalWithBirthday: number;
  todayCount: number;
  weekCount: number;
  monthCount: number;
  upcomingCount: number;
  awaitingPrepCount: number;
}

export interface OwnerBirthdayPreferencesDto {
  timezone: string;
  leapDayPolicy: LeapDayPolicy;
  birthdayReminderDays: number[];
}

export interface BirthdayOverviewResponse {
  timezone: string;
  leapDayPolicy: LeapDayPolicy;
  todayIso: string;
  selectedMonth: number;
  selectedYear: number;
  preferences: OwnerBirthdayPreferencesDto;
  counts: BirthdayOverviewCounts;
  today: BirthdayCalendarMemberItem[];
  thisWeek: BirthdayCalendarMemberItem[];
  thisMonth: BirthdayCalendarMemberItem[];
  upcoming: BirthdayCalendarMemberItem[];
  monthEntries: BirthdayCalendarMemberItem[];
}

export const birthdayOverviewQuerySchema = z
  .object({
    month: z.preprocess(
      (val) =>
        val === '' || val === undefined || val === null
          ? undefined
          : Number(val),
      z.number().int().min(1).max(12).optional()
    ),
    year: z.preprocess(
      (val) =>
        val === '' || val === undefined || val === null
          ? undefined
          : Number(val),
      z.number().int().min(1900).max(2200).optional()
    ),
    q: z.preprocess(
      (val) => {
        if (typeof val !== 'string') return undefined;
        const trimmed = val.trim();
        return trimmed.length === 0 ? undefined : trimmed;
      },
      z.string().max(120, 'Search query is too long').optional()
    ),
    prepStatus: z.enum(['ALL', ...BIRTHDAY_PREP_STATUSES]).default('ALL'),
  })
  .strict();

export type BirthdayOverviewQuery = z.infer<typeof birthdayOverviewQuerySchema>;

export const birthdayPrepTargetYearParamSchema = z.preprocess(
  (val) => Number(val),
  z
    .number()
    .int('Target year must be an integer')
    .min(2000, 'Target year is invalid')
    .max(2200, 'Target year is invalid')
);

export const birthdayPrepStatusUpdateSchema = z
  .object({
    status: z.enum(BIRTHDAY_PREP_STATUSES),
    notes: z
      .preprocess((val) => {
        if (val === undefined) return undefined;
        if (val === null) return null;
        if (typeof val === 'string') {
          const trimmed = val.trim();
          return trimmed.length === 0 ? null : trimmed;
        }
        return val;
      }, z.string().max(1000, 'Notes must not exceed 1000 characters').nullable().optional()),
  })
  .strict();

export type BirthdayPrepStatusUpdateInput = z.infer<
  typeof birthdayPrepStatusUpdateSchema
>;

export const birthdayPreferencesUpdateSchema = z
  .object({
    timezone: z
      .string()
      .trim()
      .min(1, 'Timezone is required')
      .refine(isValidIanaTimeZone, 'Please choose a valid IANA timezone'),
    leapDayPolicy: z.enum(SUPPORTED_LEAP_DAY_POLICIES),
    birthdayReminderDays: z.array(z.number().int()).superRefine((list, ctx) => {
      const check = validateReminderLeadDays(list);
      if (!check.valid) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: check.reason,
        });
      }
    }),
  })
  .strict();

export type BirthdayPreferencesUpdateInput = z.infer<
  typeof birthdayPreferencesUpdateSchema
>;

