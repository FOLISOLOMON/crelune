'use client';

import React, { useEffect, useId, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  AlertCircle,
  Cake,
  Calendar as CalendarIcon,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  Info,
  Palette,
  RefreshCw,
  Search,
  Sparkles,
  X,
} from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  EmptyState,
  Header,
} from '@crelune/ui';
import {
  BIRTHDAY_PREP_STATUSES,
  BIRTHDAY_PREP_STATUS_LABELS,
  DESIGN_JOB_STATUS_LABELS,
  type BirthdayCalendarMemberItem,
  type BirthdayOverviewResponse,
  type BirthdayPrepStatus,
  type DesignJobDetail,
} from '@crelune/shared';
import {
  BirthdayApiError,
  fetchBirthdayOverview,
  syncBirthdaysRequest,
  updateBirthdayPrepStatusRequest,
} from '@/lib/birthdays/birthday-api-client';
import {
  formatCivilIsoDisplay,
  getBirthdayPrepBadgeVariant,
  getDesignStatusBadgeVariant,
  type DesignJobFormValues,
} from '@/lib/designs/design-form-utils';
import { MemberAvatar } from '@/components/members/MemberAvatar';
import { DesignJobModal } from '@/components/designs/DesignJobModal';

export interface BirthdayOperationsClientProps {
  initialOverview: BirthdayOverviewResponse;
}

type OperationalWindowTab =
  | 'upcoming'
  | 'today'
  | 'week'
  | 'monthList'
  | 'calendar';
type PrepFilterValue = 'ALL' | BirthdayPrepStatus;

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

const WEEKDAY_HEADERS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function getDaysInCivilMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function getFirstWeekdayInCivilMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
}

function formatDaysUntilText(item: BirthdayCalendarMemberItem): string {
  if (item.daysUntil === 0) return 'Today';
  if (item.daysUntil === 1) return 'Tomorrow';
  if (item.daysUntil < 0) return `${Math.abs(item.daysUntil)}d ago`;
  return `In ${item.daysUntil} days`;
}

export function BirthdayOperationsClient({
  initialOverview,
}: BirthdayOperationsClientProps) {
  const router = useRouter();
  const searchInputId = useId();
  const prepSelectId = useId();

  const [overview, setOverview] =
    useState<BirthdayOverviewResponse>(initialOverview);
  const [selectedMonth, setSelectedMonth] = useState(
    initialOverview.selectedMonth
  );
  const [selectedYear, setSelectedYear] = useState(
    initialOverview.selectedYear
  );
  const [activeTab, setActiveTab] =
    useState<OperationalWindowTab>('upcoming');
  const [searchInput, setSearchInput] = useState('');
  const [appliedQuery, setAppliedQuery] = useState('');
  const [prepFilter, setPrepFilter] = useState<PrepFilterValue>('ALL');

  const [isLoading, setIsLoading] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [busyPrepMemberKey, setBusyPrepMemberKey] = useState<string | null>(
    null
  );
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [statusBanner, setStatusBanner] = useState<string | null>(null);

  const [flyerTarget, setFlyerTarget] =
    useState<BirthdayCalendarMemberItem | null>(null);

  const lastQueryKeyRef = useRef<string>(
    JSON.stringify({
      month: initialOverview.selectedMonth,
      year: initialOverview.selectedYear,
      q: '',
      prepStatus: 'ALL',
    })
  );

  const activeQueryKey = JSON.stringify({
    month: selectedMonth,
    year: selectedYear,
    q: appliedQuery,
    prepStatus: prepFilter,
  });

  useEffect(() => {
    if (lastQueryKeyRef.current === activeQueryKey) {
      return;
    }

    const controller = new AbortController();
    setIsLoading(true);
    setErrorMessage(null);

    fetchBirthdayOverview(
      {
        month: selectedMonth,
        year: selectedYear,
        q: appliedQuery || undefined,
        prepStatus: prepFilter,
      },
      controller.signal
    )
      .then((res) => {
        lastQueryKeyRef.current = activeQueryKey;
        setOverview(res);
      })
      .catch((error) => {
        if ((error as { name?: string })?.name === 'AbortError') return;
        setErrorMessage(
          error instanceof BirthdayApiError
            ? error.message
            : 'Unable to load birthday overview.'
        );
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setIsLoading(false);
        }
      });

    return () => controller.abort();
  }, [activeQueryKey, appliedQuery, prepFilter, selectedMonth, selectedYear]);

  const reloadOverview = async () => {
    const fresh = await fetchBirthdayOverview({
      month: selectedMonth,
      year: selectedYear,
      q: appliedQuery || undefined,
      prepStatus: prepFilter,
    });
    lastQueryKeyRef.current = JSON.stringify({
      month: selectedMonth,
      year: selectedYear,
      q: appliedQuery,
      prepStatus: prepFilter,
    });
    setOverview(fresh);
  };

  const handleSyncReminders = async () => {
    if (isSyncing) return;
    setIsSyncing(true);
    setErrorMessage(null);
    setStatusBanner(null);

    try {
      const summary = await syncBirthdaysRequest();
      await reloadOverview();
      router.refresh();
      setStatusBanner(
        `Reminder sync complete: ${summary.schedulesCreated} schedule(s) created, ${summary.notificationsCreated} due notification(s) generated.`
      );
    } catch (error) {
      setErrorMessage(
        error instanceof BirthdayApiError
          ? error.message
          : 'Failed to synchronize birthday reminders.'
      );
    } finally {
      setIsSyncing(false);
    }
  };

  const handlePrepStatusChange = async (
    item: BirthdayCalendarMemberItem,
    nextStatus: BirthdayPrepStatus
  ) => {
    const key = `${item.memberId}:${item.targetYear}`;
    setBusyPrepMemberKey(key);
    setErrorMessage(null);
    setStatusBanner(null);

    try {
      await updateBirthdayPrepStatusRequest(item.memberId, item.targetYear, {
        status: nextStatus,
      });
      await reloadOverview();
      setStatusBanner(
        `Updated ${item.fullName}'s ${item.targetYear} birthday prep to ${BIRTHDAY_PREP_STATUS_LABELS[nextStatus]}.`
      );
    } catch (error) {
      setErrorMessage(
        error instanceof BirthdayApiError
          ? error.message
          : 'Unable to update preparation status.'
      );
    } finally {
      setBusyPrepMemberKey(null);
    }
  };

  const handleFlyerCreated = async (createdJob: DesignJobDetail) => {
    setFlyerTarget(null);
    setStatusBanner(
      `Started "${createdJob.title}" and linked it to this birthday preparation record.`
    );
    try {
      await reloadOverview();
    } catch {
      // Reload failure will surface on next query if transient
    }
  };

  const shiftMonth = (delta: number) => {
    let nextMonth = selectedMonth + delta;
    let nextYear = selectedYear;
    if (nextMonth < 1) {
      nextMonth = 12;
      nextYear -= 1;
    } else if (nextMonth > 12) {
      nextMonth = 1;
      nextYear += 1;
    }
    setSelectedMonth(nextMonth);
    setSelectedYear(nextYear);
  };

  const tabItems: Record<
    Exclude<OperationalWindowTab, 'calendar'>,
    BirthdayCalendarMemberItem[]
  > = {
    upcoming: overview.upcoming,
    today: overview.today,
    week: overview.thisWeek,
    monthList: overview.monthEntries,
  };

  const visibleList =
    activeTab === 'calendar' ? overview.monthEntries : tabItems[activeTab];

  const daysInMonth = getDaysInCivilMonth(selectedYear, selectedMonth);
  const firstWeekday = getFirstWeekdayInCivilMonth(selectedYear, selectedMonth);
  const entriesByDay = new Map<number, BirthdayCalendarMemberItem[]>();
  for (const item of overview.monthEntries) {
    const bucket = entriesByDay.get(item.celebratedDay) ?? [];
    bucket.push(item);
    entriesByDay.set(item.celebratedDay, bucket);
  }

  const flyerPrefill: Partial<DesignJobFormValues> | undefined = flyerTarget
    ? {
        title: `${flyerTarget.fullName} Birthday Flyer ${flyerTarget.targetYear}`,
        category: 'BIRTHDAY_FLYER',
        priority: flyerTarget.daysUntil <= 3 ? 'HIGH' : 'NORMAL',
        initialStatus: 'PENDING',
        memberId: flyerTarget.memberId,
        birthdayTargetYear: String(flyerTarget.targetYear),
        dueDate: flyerTarget.celebratedDateIso,
        requiredText: `Happy Birthday ${flyerTarget.preferredName || flyerTarget.fullName}`,
      }
    : undefined;

  return (
    <div className="space-y-6">
      <Header
        title="Birthday Operations"
        description={`Track member birthdays, preparation stages, and flyer workflows (${overview.timezone}).`}
        badge={
          <Badge variant="primary" size="md">
            {overview.counts.totalWithBirthday} Tracked
          </Badge>
        }
        actions={
          <Button
            type="button"
            variant="secondary"
            isLoading={isSyncing}
            disabled={isSyncing}
            onClick={handleSyncReminders}
          >
            <RefreshCw className="h-4 w-4" />
            Sync Reminders Now
          </Button>
        }
      />

      {/* Explicit Scheduler Honesty Disclosure */}
      <div className="flex items-start gap-2.5 rounded-xl border border-[#D3CAEC] bg-[#EFEBF8]/50 px-4 py-3 text-xs text-[#24212B]">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-[#6541A5]" />
        <div>
          <span className="font-medium">
            Timezone: {overview.timezone} · Leap-Day Policy:{' '}
            {overview.leapDayPolicy === 'MAR_1'
              ? 'Celebrate Feb 29 on March 1 in non-leap years'
              : 'Celebrate Feb 29 on February 28 in non-leap years'}
            .
          </span>{' '}
          <span className="text-[#77727F]">
            Automated reminder delivery requires an external cron trigger to POST
            to the protected cron endpoint. Use Sync Reminders Now above whenever
            you want immediate reminder evaluation.
          </span>
        </div>
      </div>

      {statusBanner && (
        <div
          role="status"
          className="flex items-center justify-between gap-2 rounded-lg border border-[#BBF7D0] bg-[#F0FDF4] px-4 py-3 text-xs font-medium text-[#166534]"
        >
          <span className="inline-flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-[#16A34A]" />
            {statusBanner}
          </span>
          <button
            type="button"
            aria-label="Dismiss banner"
            onClick={() => setStatusBanner(null)}
            className="hover:opacity-75"
          >
            <X className="h-4 w-4" />
          </button>
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

      {/* Window KPI Strip */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {[
          { label: 'Today', value: overview.counts.todayCount, tab: 'today' as const },
          { label: 'Next 7 Days', value: overview.counts.weekCount, tab: 'week' as const },
          {
            label: `${MONTH_NAMES[selectedMonth - 1]}`,
            value: overview.counts.monthCount,
            tab: 'calendar' as const,
          },
          {
            label: 'Next 30 Days',
            value: overview.counts.upcomingCount,
            tab: 'upcoming' as const,
          },
          {
            label: 'Awaiting Prep',
            value: overview.counts.awaitingPrepCount,
            tab: 'upcoming' as const,
          },
        ].map((metric) => (
          <button
            key={metric.label}
            type="button"
            onClick={() => setActiveTab(metric.tab)}
            className="rounded-xl border border-[#E8E5ED] bg-white p-3.5 text-left transition-colors hover:border-[#A99AD1]"
          >
            <p className="text-xs font-medium text-[#77727F]">{metric.label}</p>
            <p className="mt-1.5 text-2xl font-bold text-[#24212B]">
              {metric.value}
            </p>
          </button>
        ))}
      </div>

      {/* Tabs & Filters */}
      <Card padding="sm">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div
            className="flex flex-wrap gap-1.5"
            role="tablist"
            aria-label="Birthday operational windows"
          >
            {(
              [
                { id: 'upcoming', label: `Upcoming (${overview.upcoming.length})` },
                { id: 'today', label: `Today (${overview.today.length})` },
                { id: 'week', label: `This Week (${overview.thisWeek.length})` },
                {
                  id: 'monthList',
                  label: `${MONTH_NAMES[selectedMonth - 1]} List (${overview.monthEntries.length})`,
                },
                { id: 'calendar', label: 'Monthly Calendar' },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={activeTab === tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                  activeTab === tab.id
                    ? 'bg-[#6541A5] text-white'
                    : 'bg-[#F8F7FA] text-[#77727F] hover:text-[#24212B]'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              setAppliedQuery(searchInput.trim());
            }}
            className="flex flex-wrap items-center gap-2"
          >
            <div className="relative">
              <label htmlFor={searchInputId} className="sr-only">
                Search birthday members
              </label>
              <Search className="pointer-events-none absolute left-2.5 top-2 h-3.5 w-3.5 text-[#77727F]" />
              <input
                id={searchInputId}
                type="search"
                placeholder="Filter by member name..."
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                className="h-8 rounded-lg border border-[#E8E5ED] bg-white pl-8 pr-7 text-xs text-[#24212B] placeholder:text-[#9B96A4] focus:border-[#6541A5] focus:outline-none"
              />
              {searchInput && (
                <button
                  type="button"
                  aria-label="Clear birthday filter"
                  onClick={() => {
                    setSearchInput('');
                    setAppliedQuery('');
                  }}
                  className="absolute right-2 top-2 text-[#77727F]"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>

            <div>
              <label htmlFor={prepSelectId} className="sr-only">
                Preparation status filter
              </label>
              <select
                id={prepSelectId}
                value={prepFilter}
                onChange={(e) =>
                  setPrepFilter(e.target.value as PrepFilterValue)
                }
                className="h-8 rounded-lg border border-[#E8E5ED] bg-white px-2.5 text-xs text-[#24212B]"
              >
                <option value="ALL">All Prep Stages</option>
                {BIRTHDAY_PREP_STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {BIRTHDAY_PREP_STATUS_LABELS[status]}
                  </option>
                ))}
              </select>
            </div>
          </form>
        </div>
      </Card>

      {/* Month Navigator (Shown on Month List and Monthly Calendar) */}
      {(activeTab === 'calendar' || activeTab === 'monthList') && (
        <div className="flex items-center justify-between rounded-xl border border-[#E8E5ED] bg-white px-4 py-3">
          <Button
            type="button"
            variant="outline"
            size="sm"
            aria-label="Previous month"
            onClick={() => shiftMonth(-1)}
          >
            <ChevronLeft className="h-4 w-4" />
            Previous
          </Button>
          <div className="flex items-center gap-2 text-sm font-semibold text-[#24212B]">
            <CalendarIcon className="h-4 w-4 text-[#6541A5]" />
            <span>
              {MONTH_NAMES[selectedMonth - 1]} {selectedYear}
            </span>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            aria-label="Next month"
            onClick={() => shiftMonth(1)}
          >
            Next
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      )}

      {/* Main Content */}
      {isLoading ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-[#77727F]">
            Refreshing birthday schedule...
          </CardContent>
        </Card>
      ) : activeTab === 'calendar' ? (
        <Card padding="sm">
          <CardHeader className="border-none pb-2">
            <CardTitle className="text-sm">
              {MONTH_NAMES[selectedMonth - 1]} {selectedYear} Celebration Calendar
            </CardTitle>
            <CardDescription>
              Dates reflect owner timezone ({overview.timezone}) and leap-day policy.
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-2">
            <div className="grid grid-cols-7 gap-1.5 text-center text-[11px] font-semibold uppercase tracking-wide text-[#77727F]">
              {WEEKDAY_HEADERS.map((wd) => (
                <div key={wd} className="py-1">
                  {wd}
                </div>
              ))}
            </div>
            <div className="mt-1 grid grid-cols-7 gap-1.5">
              {Array.from({ length: firstWeekday }).map((_, idx) => (
                <div
                  key={`empty-${idx}`}
                  className="min-h-24 rounded-lg border border-[#E8E5ED]/50 bg-[#F8F7FA]/40"
                />
              ))}
              {Array.from({ length: daysInMonth }, (_, i) => i + 1).map(
                (dayNumber) => {
                  const dayEntries = entriesByDay.get(dayNumber) ?? [];
                  const isoForCell = `${selectedYear}-${String(selectedMonth).padStart(2, '0')}-${String(dayNumber).padStart(2, '0')}`;
                  const isTodayCell = isoForCell === overview.todayIso;
                  return (
                    <div
                      key={dayNumber}
                      className={`min-h-24 rounded-lg border p-1.5 ${
                        isTodayCell
                          ? 'border-[#6541A5] bg-[#EFEBF8]/40'
                          : 'border-[#E8E5ED] bg-white'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span
                          className={`text-xs font-semibold ${
                            isTodayCell ? 'text-[#6541A5]' : 'text-[#24212B]'
                          }`}
                        >
                          {dayNumber}
                        </span>
                        {dayEntries.length > 0 && (
                          <span className="rounded-full bg-[#EFEBF8] px-1.5 py-0.5 text-[10px] font-semibold text-[#6541A5]">
                            {dayEntries.length}
                          </span>
                        )}
                      </div>
                      <div className="mt-1 space-y-1">
                        {dayEntries.map((entry) => (
                          <Link
                            key={entry.memberId}
                            href={`/members/${entry.memberId}`}
                            className="block truncate rounded bg-[#F8F7FA] px-1.5 py-1 text-[11px] font-medium text-[#24212B] hover:bg-[#EFEBF8] hover:text-[#6541A5]"
                            title={`${entry.fullName} (${BIRTHDAY_PREP_STATUS_LABELS[entry.prepStatus]})`}
                          >
                            {entry.preferredName || entry.fullName}
                            {entry.isLeapDayAdjusted ? ' (Leap)' : ''}
                          </Link>
                        ))}
                      </div>
                    </div>
                  );
                }
              )}
            </div>
          </CardContent>
        </Card>
      ) : visibleList.length === 0 ? (
        <EmptyState
          icon={<Cake className="h-6 w-6" />}
          title="No Birthdays in This View"
          description={
            overview.counts.totalWithBirthday === 0
              ? 'Add member birthdays in the Member Directory to populate reminders and celebration prep schedules.'
              : 'No active members match this window or filter.'
          }
          actionText={
            overview.counts.totalWithBirthday === 0
              ? 'Open Members Directory'
              : undefined
          }
          onAction={
            overview.counts.totalWithBirthday === 0
              ? () => router.push('/members')
              : undefined
          }
        />
      ) : (
        <div className="space-y-3">
          {visibleList.map((item) => {
            const busyKey = `${item.memberId}:${item.targetYear}`;
            const isUpdatingThisPrep = busyPrepMemberKey === busyKey;
            const ageTurning =
              item.birthYear !== null
                ? item.targetYear - item.birthYear
                : null;

            return (
              <Card key={`${item.memberId}-${item.targetYear}`} padding="sm">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                  <div className="flex items-start gap-3">
                    <MemberAvatar
                      memberId={item.memberId}
                      fullName={item.fullName}
                      hasPhoto={item.hasPhoto}
                      photoUpdatedAt={item.photoUpdatedAt}
                      size="md"
                    />
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <Link
                          href={`/members/${item.memberId}`}
                          className="text-sm font-semibold text-[#24212B] hover:text-[#6541A5]"
                        >
                          {item.fullName}
                        </Link>
                        <Badge
                          variant={item.isToday ? 'primary' : 'default'}
                          size="sm"
                        >
                          {formatDaysUntilText(item)}
                        </Badge>
                        {item.isLeapDayAdjusted && (
                          <Badge variant="warning" size="sm">
                            Leap-day adjusted
                          </Badge>
                        )}
                      </div>
                      <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-[#77727F]">
                        <span className="inline-flex items-center gap-1">
                          <Clock className="h-3.5 w-3.5" />
                          Celebrated {formatCivilIsoDisplay(item.celebratedDateIso)}
                        </span>
                        {ageTurning !== null ? (
                          <span>· Turning {ageTurning}</span>
                        ) : (
                          <span>· Birth year not recorded</span>
                        )}
                      </p>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-3">
                    <div className="flex items-center gap-2">
                      <Badge
                        variant={getBirthdayPrepBadgeVariant(item.prepStatus)}
                        size="sm"
                      >
                        {BIRTHDAY_PREP_STATUS_LABELS[item.prepStatus]}
                      </Badge>
                      <select
                        aria-label={`Preparation status for ${item.fullName}`}
                        value={item.prepStatus}
                        disabled={isUpdatingThisPrep}
                        onChange={(e) =>
                          handlePrepStatusChange(
                            item,
                            e.target.value as BirthdayPrepStatus
                          )
                        }
                        className="h-8 rounded-lg border border-[#E8E5ED] bg-white px-2 text-xs text-[#24212B] focus:border-[#6541A5] focus:outline-none"
                      >
                        {BIRTHDAY_PREP_STATUSES.map((status) => (
                          <option key={status} value={status}>
                            {BIRTHDAY_PREP_STATUS_LABELS[status]}
                          </option>
                        ))}
                      </select>
                    </div>

                    {item.designJobId ? (
                      <Link
                        href={`/designs/${item.designJobId}`}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-[#D3CAEC] bg-[#EFEBF8] px-3 py-1.5 text-xs font-medium text-[#6541A5] hover:bg-[#EAE3F7]"
                      >
                        <Palette className="h-3.5 w-3.5" />
                        <span>
                          Flyer:{' '}
                          {item.designJobStatus
                            ? DESIGN_JOB_STATUS_LABELS[item.designJobStatus]
                            : 'Linked'}
                        </span>
                        {item.designJobStatus && (
                          <Badge
                            variant={getDesignStatusBadgeVariant(
                              item.designJobStatus
                            )}
                            size="sm"
                          >
                            Open
                          </Badge>
                        )}
                      </Link>
                    ) : (
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        onClick={() => setFlyerTarget(item)}
                      >
                        <Sparkles className="h-3.5 w-3.5" />
                        Start Birthday Flyer
                      </Button>
                    )}
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <DesignJobModal
        isOpen={Boolean(flyerTarget)}
        onClose={() => setFlyerTarget(null)}
        onCreated={handleFlyerCreated}
        initialPrefill={flyerPrefill}
        lockedMemberLabel={flyerTarget?.fullName ?? null}
      />
    </div>
  );
}

