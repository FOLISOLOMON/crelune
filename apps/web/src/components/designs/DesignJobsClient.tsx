'use client';

import React, { useEffect, useId, useRef, useState } from 'react';
import Link from 'next/link';
import {
  AlertCircle,
  ArrowRight,
  Calendar,
  CheckCircle2,
  Columns3,
  LayoutList,
  Palette,
  Plus,
  Search,
  X,
} from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  CardContent,
  EmptyState,
  Header,
} from '@crelune/ui';
import {
  DESIGN_CATEGORIES,
  DESIGN_CATEGORY_LABELS,
  DESIGN_JOB_STATUSES,
  DESIGN_JOB_STATUS_LABELS,
  DESIGN_PRIORITIES,
  DESIGN_PRIORITY_LABELS,
  type DesignCategory,
  type DesignJobDetail,
  type DesignJobListQuery,
  type DesignJobStatus,
  type DesignJobSummary,
  type DesignPriority,
  type MemberPaginationMeta,
} from '@crelune/shared';
import {
  DesignApiError,
  fetchDesignJobsRequest,
} from '@/lib/designs/design-api-client';
import {
  formatCivilIsoDisplay,
  getDesignPriorityBadgeVariant,
  getDesignStatusBadgeVariant,
} from '@/lib/designs/design-form-utils';
import { MemberAvatar } from '@/components/members/MemberAvatar';
import {
  DesignJobModal,
  type DesignMemberOption,
} from './DesignJobModal';

export interface DesignJobsClientProps {
  initialJobs: DesignJobSummary[];
  initialPagination: MemberPaginationMeta;
  initialStatusCounts: Record<DesignJobStatus, number>;
  memberOptions: DesignMemberOption[];
}

type StatusFilterValue = 'active' | 'all' | DesignJobStatus;
type CategoryFilterValue = 'ALL' | DesignCategory;
type PriorityFilterValue = 'ALL' | DesignPriority;
type ViewMode = 'table' | 'board';

const BOARD_STATUS_COLUMNS: readonly DesignJobStatus[] = [
  'DRAFT',
  'PENDING',
  'IN_PROGRESS',
  'AWAITING_REVIEW',
  'APPROVED',
  'EXPORTED',
  'PUBLISHED',
  'CANCELLED',
];

function buildFilterKey(params: {
  q: string;
  status: StatusFilterValue;
  category: CategoryFilterValue;
  priority: PriorityFilterValue;
  page: number;
}): string {
  return JSON.stringify(params);
}

export function DesignJobsClient({
  initialJobs,
  initialPagination,
  initialStatusCounts,
  memberOptions,
}: DesignJobsClientProps) {
  const searchInputId = useId();
  const statusSelectId = useId();
  const categorySelectId = useId();
  const prioritySelectId = useId();

  const [jobs, setJobs] = useState<DesignJobSummary[]>(initialJobs);
  const [pagination, setPagination] =
    useState<MemberPaginationMeta>(initialPagination);
  const [statusCounts, setStatusCounts] =
    useState<Record<DesignJobStatus, number>>(initialStatusCounts);

  const [searchInput, setSearchInput] = useState('');
  const [appliedQuery, setAppliedQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilterValue>('active');
  const [categoryFilter, setCategoryFilter] =
    useState<CategoryFilterValue>('ALL');
  const [priorityFilter, setPriorityFilter] =
    useState<PriorityFilterValue>('ALL');
  const [page, setPage] = useState(1);
  const [viewMode, setViewMode] = useState<ViewMode>('table');

  const [isLoading, setIsLoading] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [statusBanner, setStatusBanner] = useState<string | null>(null);
  const [isCreateOpen, setIsCreateOpen] = useState(false);

  const lastFetchedKeyRef = useRef<string>(
    buildFilterKey({
      q: '',
      status: 'active',
      category: 'ALL',
      priority: 'ALL',
      page: 1,
    })
  );

  const activeFilterKey = buildFilterKey({
    q: appliedQuery,
    status: statusFilter,
    category: categoryFilter,
    priority: priorityFilter,
    page,
  });

  useEffect(() => {
    if (lastFetchedKeyRef.current === activeFilterKey) {
      return;
    }

    const controller = new AbortController();
    setIsLoading(true);
    setFetchError(null);

    const query: Partial<DesignJobListQuery> = {
      status: statusFilter,
      category: categoryFilter,
      priority: priorityFilter,
      page,
      limit: initialPagination.limit,
    };
    if (appliedQuery) {
      query.q = appliedQuery;
    }

    fetchDesignJobsRequest(query, controller.signal)
      .then((res) => {
        lastFetchedKeyRef.current = activeFilterKey;
        setJobs(res.jobs);
        setPagination(res.pagination);
        setStatusCounts(res.statusCounts);
      })
      .catch((error) => {
        if ((error as { name?: string })?.name === 'AbortError') {
          return;
        }
        setFetchError(
          error instanceof DesignApiError
            ? error.message
            : 'Unable to load design jobs.'
        );
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setIsLoading(false);
        }
      });

    return () => controller.abort();
  }, [
    activeFilterKey,
    appliedQuery,
    categoryFilter,
    initialPagination.limit,
    page,
    priorityFilter,
    statusFilter,
  ]);

  const handleCreated = async (created: DesignJobDetail) => {
    setIsCreateOpen(false);
    setStatusBanner(`Created design job "${created.title}".`);
    setFetchError(null);
    setIsLoading(true);
    try {
      const nextFilter: StatusFilterValue =
        statusFilter === 'CANCELLED' || statusFilter === 'PUBLISHED'
          ? 'active'
          : statusFilter;
      if (nextFilter !== statusFilter) {
        setStatusFilter(nextFilter);
      }
      setPage(1);
      const res = await fetchDesignJobsRequest({
        q: appliedQuery || undefined,
        status: nextFilter,
        category: categoryFilter,
        priority: priorityFilter,
        page: 1,
        limit: initialPagination.limit,
      });
      lastFetchedKeyRef.current = buildFilterKey({
        q: appliedQuery,
        status: nextFilter,
        category: categoryFilter,
        priority: priorityFilter,
        page: 1,
      });
      setJobs(res.jobs);
      setPagination(res.pagination);
      setStatusCounts(res.statusCounts);
    } catch {
      setJobs((prev) => [created, ...prev]);
    } finally {
      setIsLoading(false);
    }
  };

  const resetFilters = () => {
    setSearchInput('');
    setAppliedQuery('');
    setStatusFilter('active');
    setCategoryFilter('ALL');
    setPriorityFilter('ALL');
    setPage(1);
  };

  const totalActiveCount =
    statusCounts.DRAFT +
    statusCounts.PENDING +
    statusCounts.IN_PROGRESS +
    statusCounts.AWAITING_REVIEW +
    statusCounts.APPROVED +
    statusCounts.EXPORTED;

  const visibleBoardColumns =
    statusFilter === 'all'
      ? BOARD_STATUS_COLUMNS
      : statusFilter === 'active'
        ? BOARD_STATUS_COLUMNS.slice(0, 6)
        : BOARD_STATUS_COLUMNS.filter((col) => col === statusFilter);

  return (
    <div className="space-y-6">
      <Header
        title="Design Management"
        description="Coordinate creative requests, artwork revisions, exports, and publication milestones."
        badge={
          <Badge variant="primary" size="md">
            {totalActiveCount} Active
          </Badge>
        }
        actions={
          <Button
            type="button"
            variant="primary"
            onClick={() => {
              setStatusBanner(null);
              setIsCreateOpen(true);
            }}
          >
            <Plus className="h-4 w-4" />
            New Design Job
          </Button>
        }
      />

      {statusBanner && (
        <div
          role="status"
          className="flex items-center justify-between gap-3 rounded-lg border border-[#BBF7D0] bg-[#F0FDF4] px-4 py-3 text-xs font-medium text-[#166534]"
        >
          <span className="inline-flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-[#16A34A]" />
            {statusBanner}
          </span>
          <button
            type="button"
            aria-label="Dismiss message"
            onClick={() => setStatusBanner(null)}
            className="text-[#166534] hover:opacity-75"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Pipeline Counters */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8">
        {DESIGN_JOB_STATUSES.map((st) => {
          const isSelected = statusFilter === st;
          return (
            <button
              key={st}
              type="button"
              onClick={() => {
                setStatusFilter(isSelected ? 'active' : st);
                setPage(1);
              }}
              className={`rounded-xl border px-3 py-2.5 text-left transition-colors ${
                isSelected
                  ? 'border-[#6541A5] bg-[#EFEBF8]'
                  : 'border-[#E8E5ED] bg-white hover:border-[#A99AD1]'
              }`}
            >
              <p className="truncate text-[11px] font-medium text-[#77727F]">
                {DESIGN_JOB_STATUS_LABELS[st]}
              </p>
              <p className="mt-1 text-lg font-bold text-[#24212B]">
                {statusCounts[st]}
              </p>
            </button>
          );
        })}
      </div>

      {/* Filter Toolbar */}
      <Card padding="sm">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setPage(1);
              setAppliedQuery(searchInput.trim());
            }}
            className="grid flex-1 grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-12"
          >
            <div className="lg:col-span-5">
              <label
                htmlFor={searchInputId}
                className="mb-1 block text-xs font-medium text-[#24212B]"
              >
                Search Jobs
              </label>
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-[#77727F]" />
                <input
                  id={searchInputId}
                  type="search"
                  placeholder="Search title, brief, or member..."
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  className="h-9 w-full rounded-lg border border-[#E8E5ED] bg-white pl-9 pr-8 text-sm text-[#24212B] placeholder:text-[#9B96A4] focus:border-[#6541A5] focus:outline-none focus:ring-2 focus:ring-[#6541A5]/20"
                />
                {searchInput && (
                  <button
                    type="button"
                    aria-label="Clear design search"
                    onClick={() => {
                      setSearchInput('');
                      setAppliedQuery('');
                      setPage(1);
                    }}
                    className="absolute right-2 top-2 text-[#77727F] hover:text-[#24212B]"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>
            </div>

            <div className="lg:col-span-2">
              <label
                htmlFor={statusSelectId}
                className="mb-1 block text-xs font-medium text-[#24212B]"
              >
                Status
              </label>
              <select
                id={statusSelectId}
                value={statusFilter}
                onChange={(e) => {
                  setStatusFilter(e.target.value as StatusFilterValue);
                  setPage(1);
                }}
                className="h-9 w-full rounded-lg border border-[#E8E5ED] bg-white px-2.5 text-sm text-[#24212B] focus:border-[#6541A5] focus:outline-none focus:ring-2 focus:ring-[#6541A5]/20"
              >
                <option value="active">Active Queue</option>
                <option value="all">All Statuses</option>
                {DESIGN_JOB_STATUSES.map((st) => (
                  <option key={st} value={st}>
                    {DESIGN_JOB_STATUS_LABELS[st]}
                  </option>
                ))}
              </select>
            </div>

            <div className="lg:col-span-3">
              <label
                htmlFor={categorySelectId}
                className="mb-1 block text-xs font-medium text-[#24212B]"
              >
                Category
              </label>
              <select
                id={categorySelectId}
                value={categoryFilter}
                onChange={(e) => {
                  setCategoryFilter(e.target.value as CategoryFilterValue);
                  setPage(1);
                }}
                className="h-9 w-full rounded-lg border border-[#E8E5ED] bg-white px-2.5 text-sm text-[#24212B] focus:border-[#6541A5] focus:outline-none focus:ring-2 focus:ring-[#6541A5]/20"
              >
                <option value="ALL">All Categories</option>
                {DESIGN_CATEGORIES.map((cat) => (
                  <option key={cat} value={cat}>
                    {DESIGN_CATEGORY_LABELS[cat]}
                  </option>
                ))}
              </select>
            </div>

            <div className="lg:col-span-2">
              <label
                htmlFor={prioritySelectId}
                className="mb-1 block text-xs font-medium text-[#24212B]"
              >
                Priority
              </label>
              <select
                id={prioritySelectId}
                value={priorityFilter}
                onChange={(e) => {
                  setPriorityFilter(e.target.value as PriorityFilterValue);
                  setPage(1);
                }}
                className="h-9 w-full rounded-lg border border-[#E8E5ED] bg-white px-2.5 text-sm text-[#24212B] focus:border-[#6541A5] focus:outline-none focus:ring-2 focus:ring-[#6541A5]/20"
              >
                <option value="ALL">All Priorities</option>
                {DESIGN_PRIORITIES.map((priority) => (
                  <option key={priority} value={priority}>
                    {DESIGN_PRIORITY_LABELS[priority]}
                  </option>
                ))}
              </select>
            </div>
          </form>

          <div className="flex items-center gap-2 self-end">
            <div
              className="inline-flex rounded-lg border border-[#E8E5ED] bg-[#F8F7FA] p-0.5"
              role="group"
              aria-label="Design jobs view mode"
            >
              <button
                type="button"
                onClick={() => setViewMode('table')}
                aria-pressed={viewMode === 'table'}
                className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors ${
                  viewMode === 'table'
                    ? 'bg-white text-[#6541A5] shadow-xs'
                    : 'text-[#77727F] hover:text-[#24212B]'
                }`}
              >
                <LayoutList className="h-3.5 w-3.5" />
                List
              </button>
              <button
                type="button"
                onClick={() => setViewMode('board')}
                aria-pressed={viewMode === 'board'}
                className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors ${
                  viewMode === 'board'
                    ? 'bg-white text-[#6541A5] shadow-xs'
                    : 'text-[#77727F] hover:text-[#24212B]'
                }`}
              >
                <Columns3 className="h-3.5 w-3.5" />
                Board
              </button>
            </div>
          </div>
        </div>
      </Card>

      {fetchError && (
        <div
          role="alert"
          className="flex items-center gap-2 rounded-lg border border-[#FECACA] bg-[#FEF2F2] px-4 py-3 text-xs text-[#991B1B]"
        >
          <AlertCircle className="h-4 w-4 shrink-0 text-[#DC2626]" />
          <span>{fetchError}</span>
        </div>
      )}

      {/* Results Area */}
      {isLoading ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-[#77727F]">
            Loading design jobs...
          </CardContent>
        </Card>
      ) : jobs.length === 0 ? (
        <EmptyState
          icon={<Palette className="h-6 w-6" />}
          title="No Design Jobs Match This View"
          description={
            appliedQuery ||
            statusFilter !== 'active' ||
            categoryFilter !== 'ALL' ||
            priorityFilter !== 'ALL'
              ? 'Adjust your filters or start a new design job to populate this queue.'
              : 'Create your first design job or launch a Birthday Flyer directly from Upcoming Birthdays.'
          }
          actionText={
            appliedQuery ||
            statusFilter !== 'active' ||
            categoryFilter !== 'ALL' ||
            priorityFilter !== 'ALL'
              ? 'Reset Filters'
              : 'Create First Design Job'
          }
          onAction={
            appliedQuery ||
            statusFilter !== 'active' ||
            categoryFilter !== 'ALL' ||
            priorityFilter !== 'ALL'
              ? resetFilters
              : () => setIsCreateOpen(true)
          }
        />
      ) : viewMode === 'table' ? (
        <Card padding="none">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-[#E8E5ED] bg-[#F8F7FA] text-[11px] font-semibold uppercase tracking-wide text-[#77727F]">
                  <th className="px-4 py-3">Design Job</th>
                  <th className="px-4 py-3">Linked Member</th>
                  <th className="px-4 py-3">Due Date</th>
                  <th className="px-4 py-3">Priority</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3 text-right">Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E8E5ED] text-sm">
                {jobs.map((job) => (
                  <tr key={job.id} className="hover:bg-[#F8F7FA]/70">
                    <td className="px-4 py-3.5">
                      <Link
                        href={`/designs/${job.id}`}
                        className="font-semibold text-[#24212B] hover:text-[#6541A5]"
                      >
                        {job.title}
                      </Link>
                      <p className="mt-0.5 text-xs text-[#77727F]">
                        {DESIGN_CATEGORY_LABELS[job.category]}
                        {job.targetPlatform ? ` · ${job.targetPlatform}` : ''}
                        {job.dimensions ? ` · ${job.dimensions}` : ''}
                      </p>
                    </td>
                    <td className="px-4 py-3.5">
                      {job.member ? (
                        <Link
                          href={`/members/${job.member.id}`}
                          className="inline-flex items-center gap-2 hover:text-[#6541A5]"
                        >
                          <MemberAvatar
                            memberId={job.member.id}
                            fullName={job.member.fullName}
                            hasPhoto={job.member.hasPhoto}
                            photoUpdatedAt={job.member.photoUpdatedAt}
                            size="sm"
                          />
                          <div>
                            <span className="block text-xs font-medium text-[#24212B]">
                              {job.member.fullName}
                            </span>
                            {job.birthdayTargetYear !== null && (
                              <span className="text-[11px] text-[#77727F]">
                                Birthday {job.birthdayTargetYear}
                              </span>
                            )}
                          </div>
                        </Link>
                      ) : (
                        <span className="text-xs text-[#77727F]">
                          General creative brief
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3.5 text-xs text-[#24212B]">
                      <span className="inline-flex items-center gap-1.5">
                        <Calendar className="h-3.5 w-3.5 text-[#77727F]" />
                        {formatCivilIsoDisplay(job.dueDate)}
                      </span>
                    </td>
                    <td className="px-4 py-3.5">
                      <Badge
                        variant={getDesignPriorityBadgeVariant(job.priority)}
                        size="sm"
                      >
                        {DESIGN_PRIORITY_LABELS[job.priority]}
                      </Badge>
                    </td>
                    <td className="px-4 py-3.5">
                      <Badge
                        variant={getDesignStatusBadgeVariant(job.status)}
                        size="sm"
                      >
                        {DESIGN_JOB_STATUS_LABELS[job.status]}
                      </Badge>
                    </td>
                    <td className="px-4 py-3.5 text-right">
                      <Link
                        href={`/designs/${job.id}`}
                        className="inline-flex items-center gap-1 text-xs font-medium text-[#6541A5] hover:underline"
                      >
                        Open
                        <ArrowRight className="h-3 w-3" />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {pagination.totalPages > 1 && (
            <div className="flex items-center justify-between border-t border-[#E8E5ED] px-4 py-3 text-xs text-[#77727F]">
              <span>
                Page {pagination.page} of {pagination.totalPages} ({pagination.total}{' '}
                jobs)
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
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {visibleBoardColumns.map((colStatus) => {
            const columnJobs = jobs.filter((job) => job.status === colStatus);
            return (
              <Card key={colStatus} padding="sm" className="bg-[#F8F7FA]/60">
                <div className="flex items-center justify-between border-b border-[#E8E5ED] pb-2.5">
                  <div className="flex items-center gap-2">
                    <Badge
                      variant={getDesignStatusBadgeVariant(colStatus)}
                      size="sm"
                    >
                      {DESIGN_JOB_STATUS_LABELS[colStatus]}
                    </Badge>
                  </div>
                  <span className="text-xs font-medium text-[#77727F]">
                    {columnJobs.length}
                  </span>
                </div>
                <div className="mt-3 space-y-2.5">
                  {columnJobs.length === 0 ? (
                    <p className="rounded-lg border border-dashed border-[#E8E5ED] px-3 py-4 text-center text-xs text-[#77727F]">
                      No jobs in {DESIGN_JOB_STATUS_LABELS[colStatus].toLowerCase()}.
                    </p>
                  ) : (
                    columnJobs.map((job) => (
                      <Link
                        key={job.id}
                        href={`/designs/${job.id}`}
                        className="block rounded-lg border border-[#E8E5ED] bg-white p-3 transition-colors hover:border-[#A99AD1]"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <p className="text-sm font-semibold text-[#24212B]">
                            {job.title}
                          </p>
                          <Badge
                            variant={getDesignPriorityBadgeVariant(job.priority)}
                            size="sm"
                          >
                            {DESIGN_PRIORITY_LABELS[job.priority]}
                          </Badge>
                        </div>
                        <p className="mt-1 text-xs text-[#77727F]">
                          {DESIGN_CATEGORY_LABELS[job.category]}
                        </p>
                        <div className="mt-2.5 flex items-center justify-between text-[11px] text-[#77727F]">
                          <span>{job.member?.fullName ?? 'Unassigned member'}</span>
                          <span>{formatCivilIsoDisplay(job.dueDate)}</span>
                        </div>
                      </Link>
                    ))
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <DesignJobModal
        isOpen={isCreateOpen}
        onClose={() => setIsCreateOpen(false)}
        onCreated={handleCreated}
        memberOptions={memberOptions}
      />
    </div>
  );
}

