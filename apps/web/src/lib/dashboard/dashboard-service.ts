/**
 * CRELUNE — Owner Dashboard Aggregation Service
 *
 * Supplies live organisation-scoped counts and upcoming birthday / design job /
 * notification summaries for the Dashboard without altering scheduled reminder state
 * implicitly during page render.
 */

import { checkDatabaseConnection, prisma } from '@crelune/database';
import type {
  BirthdayCalendarMemberItem,
  BirthdayOverviewCounts,
  DesignJobSummary,
  NotificationItem,
} from '@crelune/shared';
import { getBirthdayOverview } from '@/lib/birthdays/birthday-overview-service';
import { listDesignJobs } from '@/lib/designs/design-job-service';
import { listOwnerNotifications } from '@/lib/notifications/notification-service';

export interface DashboardSnapshot {
  activeMembersCount: number;
  birthdayCounts: BirthdayOverviewCounts;
  upcomingBirthdays: BirthdayCalendarMemberItem[];
  unreadNotificationsCount: number;
  recentNotifications: NotificationItem[];
  activeDesignJobsCount: number;
  awaitingReviewCount: number;
  recentDesignJobs: DesignJobSummary[];
  dbHealth: {
    connected: boolean;
    latencyMs?: number;
  };
}

export async function getDashboardSnapshot(
  organisationId: string,
  ownerUserId: string
): Promise<DashboardSnapshot> {
  const [
    activeMembersCount,
    birthdayOverview,
    notificationData,
    designData,
    dbHealth,
  ] = await Promise.all([
    prisma.member.count({
      where: {
        organisationId,
        archivedAt: null,
      },
    }),
    getBirthdayOverview(organisationId, ownerUserId, {
      prepStatus: 'ALL',
    }),
    listOwnerNotifications(
      { userId: ownerUserId, organisationId },
      { unreadOnly: false, page: 1, limit: 4 }
    ),
    listDesignJobs(organisationId, {
      status: 'active',
      category: 'ALL',
      priority: 'ALL',
      page: 1,
      limit: 5,
    }),
    checkDatabaseConnection(),
  ]);

  return {
    activeMembersCount,
    birthdayCounts: birthdayOverview.counts,
    upcomingBirthdays: birthdayOverview.upcoming.slice(0, 5),
    unreadNotificationsCount: notificationData.unreadCount,
    recentNotifications: notificationData.notifications,
    activeDesignJobsCount: designData.pagination.total,
    awaitingReviewCount: designData.statusCounts.AWAITING_REVIEW,
    recentDesignJobs: designData.jobs,
    dbHealth,
  };
}

