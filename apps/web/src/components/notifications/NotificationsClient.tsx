'use client';

import React, { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  AlertCircle,
  ArrowRight,
  Bell,
  Check,
  CheckCheck,
  CheckCircle2,
  RefreshCw,
} from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  CardContent,
  EmptyState,
  Header,
} from '@crelune/ui';
import type {
  NotificationItem,
  NotificationListPaginationMeta,
  NotificationListResponse,
} from '@crelune/shared';
import {
  BirthdayApiError,
  fetchNotificationsRequest,
  markAllNotificationsReadRequest,
  markNotificationReadRequest,
  syncBirthdaysRequest,
} from '@/lib/birthdays/birthday-api-client';
import { formatMemberTimestamp } from '@/lib/members/member-form-utils';

export interface NotificationsClientProps {
  initialData: NotificationListResponse;
}

export function NotificationsClient({ initialData }: NotificationsClientProps) {
  const router = useRouter();
  const [notifications, setNotifications] = useState<NotificationItem[]>(
    initialData.notifications
  );
  const [unreadCount, setUnreadCount] = useState<number>(
    initialData.unreadCount
  );
  const [pagination, setPagination] = useState<NotificationListPaginationMeta>(
    initialData.pagination
  );

  const [unreadOnly, setUnreadOnly] = useState<boolean>(false);
  const [page, setPage] = useState<number>(1);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isSyncing, setIsSyncing] = useState<boolean>(false);
  const [isMarkingAll, setIsMarkingAll] = useState<boolean>(false);
  const [busyNotificationId, setBusyNotificationId] = useState<string | null>(
    null
  );
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [statusBanner, setStatusBanner] = useState<string | null>(null);

  const lastQueryKeyRef = useRef<string>(
    JSON.stringify({ unreadOnly: false, page: 1 })
  );
  const activeQueryKey = JSON.stringify({ unreadOnly, page });

  useEffect(() => {
    if (lastQueryKeyRef.current === activeQueryKey) {
      return;
    }

    const controller = new AbortController();
    setIsLoading(true);
    setErrorMessage(null);

    fetchNotificationsRequest(
      { unreadOnly, page, limit: pagination.limit },
      controller.signal
    )
      .then((res) => {
        lastQueryKeyRef.current = activeQueryKey;
        setNotifications(res.notifications);
        setUnreadCount(res.unreadCount);
        setPagination(res.pagination);
      })
      .catch((error) => {
        if ((error as { name?: string })?.name === 'AbortError') return;
        setErrorMessage(
          error instanceof BirthdayApiError
            ? error.message
            : 'Unable to load notifications.'
        );
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setIsLoading(false);
        }
      });

    return () => controller.abort();
  }, [activeQueryKey, page, pagination.limit, unreadOnly]);

  const reloadCurrent = async (
    nextUnreadOnly = unreadOnly,
    nextPage = page
  ) => {
    const res = await fetchNotificationsRequest({
      unreadOnly: nextUnreadOnly,
      page: nextPage,
      limit: pagination.limit,
    });
    lastQueryKeyRef.current = JSON.stringify({
      unreadOnly: nextUnreadOnly,
      page: nextPage,
    });
    setNotifications(res.notifications);
    setUnreadCount(res.unreadCount);
    setPagination(res.pagination);
  };

  const handleMarkRead = async (notificationId: string) => {
    setBusyNotificationId(notificationId);
    setErrorMessage(null);

    try {
      await markNotificationReadRequest(notificationId);
      await reloadCurrent();
      router.refresh();
    } catch (error) {
      setErrorMessage(
        error instanceof BirthdayApiError
          ? error.message
          : 'Unable to mark notification as read.'
      );
    } finally {
      setBusyNotificationId(null);
    }
  };

  const handleMarkAllRead = async () => {
    if (isMarkingAll || unreadCount === 0) return;
    setIsMarkingAll(true);
    setErrorMessage(null);

    try {
      const result = await markAllNotificationsReadRequest();
      await reloadCurrent();
      router.refresh();
      setStatusBanner(
        result.updatedCount > 0
          ? `Marked ${result.updatedCount} notification(s) as read.`
          : 'All notifications are already read.'
      );
    } catch (error) {
      setErrorMessage(
        error instanceof BirthdayApiError
          ? error.message
          : 'Unable to mark all notifications as read.'
      );
    } finally {
      setIsMarkingAll(false);
    }
  };

  const handleSyncNow = async () => {
    if (isSyncing) return;
    setIsSyncing(true);
    setErrorMessage(null);
    setStatusBanner(null);

    try {
      const summary = await syncBirthdaysRequest();
      await reloadCurrent(unreadOnly, 1);
      setPage(1);
      router.refresh();
      setStatusBanner(
        summary.notificationsCreated > 0
          ? `Generated ${summary.notificationsCreated} new due birthday notification(s).`
          : 'Reminder sync completed. No new due notifications right now.'
      );
    } catch (error) {
      setErrorMessage(
        error instanceof BirthdayApiError
          ? error.message
          : 'Failed to sync reminders.'
      );
    } finally {
      setIsSyncing(false);
    }
  };

  return (
    <div className="space-y-6">
      <Header
        title="Notifications"
        description="Birthday preparation alerts and workspace operational reminders."
        badge={
          <Badge variant={unreadCount > 0 ? 'primary' : 'default'} size="md">
            {unreadCount} Unread
          </Badge>
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              isLoading={isSyncing}
              disabled={isSyncing}
              onClick={handleSyncNow}
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Check Due Reminders
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              isLoading={isMarkingAll}
              disabled={unreadCount === 0 || isMarkingAll}
              onClick={handleMarkAllRead}
            >
              <CheckCheck className="h-3.5 w-3.5" />
              Mark All Read
            </Button>
          </div>
        }
      />

      {statusBanner && (
        <div
          role="status"
          className="flex items-center gap-2 rounded-lg border border-[#BBF7D0] bg-[#F0FDF4] px-4 py-3 text-xs font-medium text-[#166534]"
        >
          <CheckCircle2 className="h-4 w-4 shrink-0 text-[#16A34A]" />
          <span>{statusBanner}</span>
        </div>
      )}

      {errorMessage && (
        <div
          role="alert"
          className="flex items-center gap-2 rounded-lg border border-[#FECACA] bg-[#FEF2F2] px-4 py-3 text-xs text-[#991B1B]"
        >
          <AlertCircle className="h-4 w-4 shrink-0 text-[#DC2626]" />
          <span>{errorMessage}</span>
        </div>
      )}

      <div className="flex items-center justify-between">
        <div
          className="inline-flex rounded-lg border border-[#E8E5ED] bg-white p-0.5"
          role="group"
          aria-label="Notification filter"
        >
          <button
            type="button"
            aria-pressed={!unreadOnly}
            onClick={() => {
              setUnreadOnly(false);
              setPage(1);
            }}
            className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
              !unreadOnly
                ? 'bg-[#6541A5] text-white'
                : 'text-[#77727F] hover:text-[#24212B]'
            }`}
          >
            All Notifications
          </button>
          <button
            type="button"
            aria-pressed={unreadOnly}
            onClick={() => {
              setUnreadOnly(true);
              setPage(1);
            }}
            className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
              unreadOnly
                ? 'bg-[#6541A5] text-white'
                : 'text-[#77727F] hover:text-[#24212B]'
            }`}
          >
            Unread Only ({unreadCount})
          </button>
        </div>

        <span className="text-xs text-[#77727F]">
          {pagination.total} total notification(s)
        </span>
      </div>

      {isLoading ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-[#77727F]">
            Loading notifications...
          </CardContent>
        </Card>
      ) : notifications.length === 0 ? (
        <EmptyState
          icon={<Bell className="h-6 w-6" />}
          title={
            unreadOnly ? 'No Unread Notifications' : 'No Notifications Yet'
          }
          description={
            unreadOnly
              ? 'You are all caught up on unread reminders.'
              : 'Birthday reminder alerts and workspace updates will appear here when scheduled reminders become due.'
          }
        />
      ) : (
        <div className="space-y-3">
          {notifications.map((item) => (
            <Card
              key={item.id}
              padding="sm"
              className={
                item.isRead
                  ? 'border-[#E8E5ED] bg-white'
                  : 'border-[#A99AD1] bg-[#EFEBF8]/30'
              }
            >
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    {!item.isRead && (
                      <span
                        className="h-2 w-2 rounded-full bg-[#6541A5]"
                        aria-label="Unread notification"
                      />
                    )}
                    <h3 className="text-sm font-semibold text-[#24212B]">
                      {item.title}
                    </h3>
                    <Badge
                      variant={
                        item.type === 'BIRTHDAY_REMINDER' ? 'primary' : 'default'
                      }
                      size="sm"
                    >
                      {item.type === 'BIRTHDAY_REMINDER' ? 'Birthday' : 'System'}
                    </Badge>
                  </div>
                  <p className="text-xs text-[#24212B]/90 leading-relaxed">
                    {item.body}
                  </p>
                  <p className="text-[11px] text-[#77727F]">
                    {formatMemberTimestamp(item.createdAt)}
                  </p>
                </div>

                <div className="flex shrink-0 items-center gap-2">
                  {item.href && (
                    <Link
                      href={item.href}
                      className="inline-flex items-center gap-1 rounded-lg border border-[#E8E5ED] bg-white px-2.5 py-1.5 text-xs font-medium text-[#6541A5] hover:bg-[#F8F7FA]"
                    >
                      <span>View</span>
                      <ArrowRight className="h-3 w-3" />
                    </Link>
                  )}
                  {!item.isRead && (
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      isLoading={busyNotificationId === item.id}
                      disabled={busyNotificationId !== null}
                      onClick={() => handleMarkRead(item.id)}
                    >
                      <Check className="h-3.5 w-3.5" />
                      Mark Read
                    </Button>
                  )}
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {pagination.totalPages > 1 && (
        <div className="flex items-center justify-between text-xs text-[#77727F]">
          <span>
            Page {pagination.page} of {pagination.totalPages}
          </span>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!pagination.hasPreviousPage}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              Previous
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!pagination.hasNextPage}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

