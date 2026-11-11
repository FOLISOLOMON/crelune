/**
 * CRELUNE — Owner-Scoped In-App Notification Service
 *
 * Enforces server-side owner (`userId`) and `organisationId` isolation on all
 * list and read-state mutations without exposing sensitive member details.
 */

import { prisma, type Notification, type Prisma } from '@crelune/database';
import type {
  NotificationItem,
  NotificationListQuery,
  NotificationListResponse,
  NotificationType,
} from '@crelune/shared';
import * as auditService from '@/lib/audit/audit-service';

export interface NotificationActorContext {
  userId: string;
  organisationId: string;
}

export class NotificationNotFoundError extends Error {
  constructor() {
    super('Notification not found.');
    this.name = 'NotificationNotFoundError';
  }
}

export const NOTIFICATION_SELECT = {
  id: true,
  memberId: true,
  birthdayReminderId: true,
  type: true,
  title: true,
  body: true,
  href: true,
  readAt: true,
  createdAt: true,
} as const;

type SelectedNotification = Pick<
  Notification,
  | 'id'
  | 'memberId'
  | 'birthdayReminderId'
  | 'type'
  | 'title'
  | 'body'
  | 'href'
  | 'readAt'
  | 'createdAt'
>;

export function mapNotificationItem(row: SelectedNotification): NotificationItem {
  return {
    id: row.id,
    memberId: row.memberId ?? null,
    birthdayReminderId: row.birthdayReminderId ?? null,
    type: row.type as NotificationType,
    title: row.title,
    body: row.body,
    href: row.href ?? null,
    isRead: row.readAt !== null,
    readAt: row.readAt ? row.readAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * Lists paginated notifications scoped strictly to `actor.organisationId` and `actor.userId`.
 */
export async function listOwnerNotifications(
  actor: NotificationActorContext,
  query: NotificationListQuery
): Promise<NotificationListResponse> {
  const baseWhere: Prisma.NotificationWhereInput = {
    organisationId: actor.organisationId,
    userId: actor.userId,
  };

  const listWhere: Prisma.NotificationWhereInput = query.unreadOnly
    ? { ...baseWhere, readAt: null }
    : baseWhere;

  const skip = (query.page - 1) * query.limit;

  const [total, unreadCount, rows] = await Promise.all([
    prisma.notification.count({ where: listWhere }),
    prisma.notification.count({ where: { ...baseWhere, readAt: null } }),
    prisma.notification.findMany({
      where: listWhere,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip,
      take: query.limit,
      select: NOTIFICATION_SELECT,
    }),
  ]);

  const totalPages = total === 0 ? 0 : Math.ceil(total / query.limit);

  return {
    notifications: rows.map(mapNotificationItem),
    unreadCount,
    pagination: {
      page: query.page,
      limit: query.limit,
      total,
      totalPages,
      hasNextPage: query.page < totalPages,
      hasPreviousPage: query.page > 1 && total > 0,
    },
  };
}

/**
 * Marks a single owner notification as read cleanly without altering other users' records.
 */
export async function markNotificationAsRead(
  actor: NotificationActorContext,
  notificationId: string
): Promise<{ notification: NotificationItem; changed: boolean }> {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.notification.findFirst({
      where: {
        id: notificationId,
        organisationId: actor.organisationId,
        userId: actor.userId,
      },
      select: NOTIFICATION_SELECT,
    });

    if (!existing) {
      throw new NotificationNotFoundError();
    }

    if (existing.readAt !== null) {
      return {
        notification: mapNotificationItem(existing),
        changed: false,
      };
    }

    const updated = await tx.notification.update({
      where: { id: existing.id },
      data: { readAt: new Date() },
      select: NOTIFICATION_SELECT,
    });

    return {
      notification: mapNotificationItem(updated),
      changed: true,
    };
  });
}

/**
 * Marks all unread notifications belonging strictly to `actor.userId` within
 * `actor.organisationId` as read, auditing only when records are actually updated.
 */
export async function markAllNotificationsAsRead(
  actor: NotificationActorContext
): Promise<{ markedCount: number }> {
  return prisma.$transaction(async (tx) => {
    const result = await tx.notification.updateMany({
      where: {
        organisationId: actor.organisationId,
        userId: actor.userId,
        readAt: null,
      },
      data: {
        readAt: new Date(),
      },
    });

    if (result.count > 0) {
      await auditService.recordAuditEvent(tx, {
        organisationId: actor.organisationId,
        actorUserId: actor.userId,
        action: auditService.AUDIT_ACTIONS.NOTIFICATION_READ_ALL,
        entityType: 'Notification',
        entityId: actor.userId,
        metadata: { markedCount: result.count },
      });
    }

    return { markedCount: result.count };
  });
}

