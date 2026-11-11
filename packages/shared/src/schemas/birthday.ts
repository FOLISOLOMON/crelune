/**
 * CRELUNE — Shared Birthday Engine & Notification API Contracts
 */

import { z } from 'zod';
import { memberIdParamSchema } from './member.js';

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

