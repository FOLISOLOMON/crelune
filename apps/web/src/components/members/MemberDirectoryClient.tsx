'use client';

import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import Link from 'next/link';
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Search,
  UserPlus,
  Users,
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
  MEMBER_LIST_DEFAULT_LIMIT,
  type MemberDetail,
  type MemberDirectoryItem,
  type MemberListQuery,
  type MemberPaginationMeta,
} from '@crelune/shared';
import { fetchMembersDirectory } from '@/lib/members/member-api-client';
import {
  formatMemberBirthday,
  MONTH_OPTIONS,
} from '@/lib/members/member-form-utils';
import { AddMemberModal } from './AddMemberModal';
import { MemberAvatar } from './MemberAvatar';

export interface MemberDirectoryClientProps {
  initialMembers: MemberDirectoryItem[];
  initialPagination: MemberPaginationMeta;
}

type StatusFilter = MemberListQuery['status'];
type SortOption = MemberListQuery['sort'];

export function MemberDirectoryClient({
  initialMembers,
  initialPagination,
}: MemberDirectoryClientProps) {
  const searchInputId = useId();
  const statusSelectId = useId();
  const monthSelectId = useId();
  const sortSelectId = useId();

  const [members, setMembers] = useState<MemberDirectoryItem[]>(initialMembers);
  const [pagination, setPagination] =
    useState<MemberPaginationMeta>(initialPagination);

  const [searchInput, setSearchInput] = useState('');
  const [appliedQuery, setAppliedQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('active');
  const [birthMonthFilter, setBirthMonthFilter] = useState<string>('');
  const [sortOption, setSortOption] = useState<SortOption>('name_asc');
  const [page, setPage] = useState(initialPagination.page || 1);

  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [createdNotice, setCreatedNotice] = useState<{
    member: MemberDetail;
    photoWarning: string | null;
  } | null>(null);

  const isFirstRender = useRef(true);
  const abortRef = useRef<AbortController | null>(null);

  const loadDirectory = useCallback(
    async (params: {
      q: string;
      status: StatusFilter;
      birthMonth: string;
      sort: SortOption;
      page: number;
    }) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setIsLoading(true);
      setLoadError(null);

      try {
        const result = await fetchMembersDirectory(
          {
            q: params.q || undefined,
            status: params.status,
            birthMonth: params.birthMonth
              ? Number.parseInt(params.birthMonth, 10)
              : undefined,
            sort: params.sort,
            page: params.page,
            limit: MEMBER_LIST_DEFAULT_LIMIT,
          },
          controller.signal
        );

        if (controller.signal.aborted) {
          return;
        }

        setMembers(result.members);
        setPagination(result.pagination);
      } catch (err) {
        if (controller.signal.aborted) {
          return;
        }
        setLoadError(
          err instanceof Error
            ? err.message
            : 'Unable to load members right now. Please retry.'
        );
      } finally {
        if (!controller.signal.aborted) {
          setIsLoading(false);
        }
      }
    },
    []
  );

  // Debounce search text cleanly before querying the directory API.
  useEffect(() => {
    const trimmed = searchInput.trim();
    if (trimmed === appliedQuery) {
      return;
    }
    const timer = window.setTimeout(() => {
      setPage(1);
      setAppliedQuery(trimmed);
    }, 280);
    return () => window.clearTimeout(timer);
  }, [searchInput, appliedQuery]);

  // Fetch updated directory whenever active query parameters change.
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    void loadDirectory({
      q: appliedQuery,
      status: statusFilter,
      birthMonth: birthMonthFilter,
      sort: sortOption,
      page,
    });
  }, [appliedQuery, statusFilter, birthMonthFilter, sortOption, page, loadDirectory]);

  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  const hasActiveFilters =
    appliedQuery.length > 0 ||
    statusFilter !== 'active' ||
    birthMonthFilter.length > 0 ||
    sortOption !== 'name_asc';

  const handleClearFilters = () => {
    setSearchInput('');
    setAppliedQuery('');
    setStatusFilter('active');
    setBirthMonthFilter('');
    setSortOption('name_asc');
    setPage(1);
  };

  const handleMemberCreated = (
    member: MemberDetail,
    options: { photoWarning: string | null }
  ) => {
    setIsAddModalOpen(false);
    setCreatedNotice({ member, photoWarning: options.photoWarning });
    setPage(1);
    void loadDirectory({
      q: appliedQuery,
      status: statusFilter,
      birthMonth: birthMonthFilter,
      sort: sortOption,
      page: 1,
    });
  };

  const rangeStart =
    pagination.total === 0 ? 0 : (pagination.page - 1) * pagination.limit + 1;
  const rangeEnd = Math.min(
    pagination.page * pagination.limit,
    pagination.total
  );

  return (
    <div className="space-y-6">
      <Header
        title="Members Directory"
        description="Organised directory of member profiles, birthdays, and private contact records."
        actions={
          <Button
            type="button"
            variant="primary"
            size="md"
            onClick={() => setIsAddModalOpen(true)}
          >
            <UserPlus className="mr-1.5 h-4 w-4" />
            Add Member
          </Button>
        }
      />

      {createdNotice && (
        <div className="space-y-2">
          <div
            role="status"
            className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 rounded-lg border border-[#A7F3D0] bg-[#ECFDF5] px-4 py-3 text-xs text-[#047857]"
          >
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 shrink-0 text-[#059669]" />
              <span>
                <strong>{createdNotice.member.fullName}</strong> was added to your directory.
              </span>
            </div>
            <div className="flex items-center gap-3">
              <Link
                href={`/members/${createdNotice.member.id}`}
                className="font-semibold text-[#047857] underline hover:no-underline"
              >
                View profile
              </Link>
              <button
                type="button"
                aria-label="Dismiss notice"
                onClick={() => setCreatedNotice(null)}
                className="rounded p-0.5 text-[#047857]/80 hover:text-[#047857]"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          {createdNotice.photoWarning && (
            <div
              role="alert"
              className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 rounded-lg border border-[#FDE68A] bg-[#FFFBEB] px-4 py-3 text-xs text-[#92400E]"
            >
              <div className="flex items-start gap-2">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[#D97706]" />
                <span>{createdNotice.photoWarning}</span>
              </div>
              <Link
                href={`/members/${createdNotice.member.id}`}
                className="shrink-0 font-semibold text-[#92400E] underline hover:no-underline"
              >
                Open profile to upload photo
              </Link>
            </div>
          )}
        </div>
      )}

      {/* Search & Filter Toolbar */}
      <Card>
        <CardContent className="p-4">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setPage(1);
              setAppliedQuery(searchInput.trim());
            }}
            className="grid grid-cols-1 md:grid-cols-12 gap-3 items-end"
          >
            <div className="md:col-span-5 flex flex-col gap-1.5">
              <label
                htmlFor={searchInputId}
                className="text-xs font-medium text-[#24212B]"
              >
                Search Members
              </label>
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-[#77727F]" />
                <input
                  id={searchInputId}
                  type="search"
                  placeholder="Search by name or phone..."
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  className="h-9 w-full rounded-md border border-[#E8E5ED] bg-white pl-9 pr-8 text-sm text-[#24212B] placeholder:text-[#77727F]/60 focus:border-[#6541A5] focus:outline-none focus:ring-2 focus:ring-[#6541A5]/20"
                />
                {searchInput.length > 0 && (
                  <button
                    type="button"
                    aria-label="Clear search"
                    onClick={() => {
                      setSearchInput('');
                      setAppliedQuery('');
                      setPage(1);
                    }}
                    className="absolute right-2 top-2 rounded p-0.5 text-[#77727F] hover:text-[#24212B]"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>
            </div>

            <div className="md:col-span-2 flex flex-col gap-1.5">
              <label
                htmlFor={statusSelectId}
                className="text-xs font-medium text-[#24212B]"
              >
                Status
              </label>
              <select
                id={statusSelectId}
                value={statusFilter}
                onChange={(e) => {
                  setStatusFilter(e.target.value as StatusFilter);
                  setPage(1);
                }}
                className="h-9 rounded-md border border-[#E8E5ED] bg-white px-3 text-sm text-[#24212B] focus:border-[#6541A5] focus:outline-none focus:ring-2 focus:ring-[#6541A5]/20"
              >
                <option value="active">Active</option>
                <option value="archived">Archived</option>
                <option value="all">All Records</option>
              </select>
            </div>

            <div className="md:col-span-2 flex flex-col gap-1.5">
              <label
                htmlFor={monthSelectId}
                className="text-xs font-medium text-[#24212B]"
              >
                Birth Month
              </label>
              <select
                id={monthSelectId}
                value={birthMonthFilter}
                onChange={(e) => {
                  setBirthMonthFilter(e.target.value);
                  setPage(1);
                }}
                className="h-9 rounded-md border border-[#E8E5ED] bg-white px-3 text-sm text-[#24212B] focus:border-[#6541A5] focus:outline-none focus:ring-2 focus:ring-[#6541A5]/20"
              >
                <option value="">All Months</option>
                {MONTH_OPTIONS.map((m) => (
                  <option key={m.value} value={String(m.value)}>
                    {m.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="md:col-span-3 flex flex-col gap-1.5">
              <label
                htmlFor={sortSelectId}
                className="text-xs font-medium text-[#24212B]"
              >
                Sort By
              </label>
              <select
                id={sortSelectId}
                value={sortOption}
                onChange={(e) => {
                  setSortOption(e.target.value as SortOption);
                  setPage(1);
                }}
                className="h-9 rounded-md border border-[#E8E5ED] bg-white px-3 text-sm text-[#24212B] focus:border-[#6541A5] focus:outline-none focus:ring-2 focus:ring-[#6541A5]/20"
              >
                <option value="name_asc">Name (A–Z)</option>
                <option value="name_desc">Name (Z–A)</option>
                <option value="birthday_asc">Birthday Month</option>
                <option value="recent">Recently Added</option>
              </select>
            </div>
          </form>

          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-[#E8E5ED] pt-3 text-xs text-[#77727F]">
            <span className="tabular-nums">
              {pagination.total}{' '}
              {pagination.total === 1 ? 'member' : 'members'} found
              {statusFilter === 'active'
                ? ' (active directory)'
                : statusFilter === 'archived'
                  ? ' (archived)'
                  : ''}
            </span>

            {hasActiveFilters && (
              <button
                type="button"
                onClick={handleClearFilters}
                className="font-medium text-[#6541A5] hover:underline"
              >
                Reset filters
              </button>
            )}
          </div>
        </CardContent>
      </Card>

      {loadError && (
        <div
          role="alert"
          className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-lg border border-[#FECACA] bg-[#FEF2F2] p-4 text-xs text-[#991B1B]"
        >
          <div className="flex items-center gap-2">
            <AlertCircle className="h-4 w-4 shrink-0 text-[#DC2626]" />
            <span>{loadError}</span>
          </div>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() =>
              void loadDirectory({
                q: appliedQuery,
                status: statusFilter,
                birthMonth: birthMonthFilter,
                sort: sortOption,
                page,
              })
            }
          >
            Retry
          </Button>
        </div>
      )}

      {/* Loading Skeleton */}
      {isLoading ? (
        <Card>
          <CardContent className="p-0 divide-y divide-[#E8E5ED]">
            {[1, 2, 3, 4].map((rowKey) => (
              <div
                key={rowKey}
                className="flex items-center justify-between gap-4 px-5 py-4 animate-pulse"
              >
                <div className="flex items-center gap-3">
                  <div className="h-11 w-11 rounded-lg bg-[#E8E5ED]" />
                  <div className="space-y-2">
                    <div className="h-3.5 w-36 rounded bg-[#E8E5ED]" />
                    <div className="h-3 w-24 rounded bg-[#F0EEF4]" />
                  </div>
                </div>
                <div className="hidden sm:block h-3.5 w-20 rounded bg-[#F0EEF4]" />
                <div className="h-7 w-20 rounded bg-[#E8E5ED]" />
              </div>
            ))}
          </CardContent>
        </Card>
      ) : members.length === 0 ? (
        hasActiveFilters ? (
          <EmptyState
            icon={<Users className="h-6 w-6" />}
            title="No matching members found"
            description="Try adjusting your search keywords, birth month, or status filter."
            actionText="Reset all filters"
            onAction={handleClearFilters}
          />
        ) : (
          <EmptyState
            icon={<Users className="h-6 w-6" />}
            title="Your member directory is empty"
            description="Start by adding your first member with their name, optional birthday, and private contact details."
            actionText="Add your first member"
            onAction={() => setIsAddModalOpen(true)}
          />
        )
      ) : (
        <Card>
          {/* Desktop Table View */}
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-[#E8E5ED] bg-[#FBFBFC] text-[11px] font-semibold uppercase tracking-wider text-[#77727F]">
                  <th className="py-3 pl-5 pr-3">Member</th>
                  <th className="py-3 px-3">Birthday</th>
                  <th className="py-3 px-3">Contact</th>
                  <th className="py-3 px-3">Status</th>
                  <th className="py-3 pl-3 pr-5 text-right">Profile</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E8E5ED]">
                {members.map((member) => {
                  const birthdayText = formatMemberBirthday(member);
                  return (
                    <tr
                      key={member.id}
                      className="hover:bg-[#F8F7FA]/70 transition-colors"
                    >
                      <td className="py-3.5 pl-5 pr-3">
                        <div className="flex items-center gap-3 min-w-0">
                          <MemberAvatar
                            memberId={member.id}
                            fullName={member.fullName}
                            hasPhoto={member.hasPhoto}
                            photoUpdatedAt={member.photoUpdatedAt}
                            size="md"
                          />
                          <div className="min-w-0">
                            <Link
                              href={`/members/${member.id}`}
                              className="block text-sm font-semibold text-[#24212B] hover:text-[#6541A5] truncate"
                            >
                              {member.fullName}
                            </Link>
                            {member.preferredName && (
                              <p className="text-xs text-[#77727F] truncate">
                                Preferred: {member.preferredName}
                              </p>
                            )}
                          </div>
                        </div>
                      </td>

                      <td className="py-3.5 px-3 text-sm text-[#24212B] tabular-nums whitespace-nowrap">
                        {birthdayText}
                      </td>

                      <td className="py-3.5 px-3 text-xs text-[#77727F]">
                        {member.phone || member.email ? (
                          <div className="space-y-0.5">
                            {member.phone && (
                              <p className="text-[#24212B] tabular-nums">
                                {member.phone}
                              </p>
                            )}
                            {member.email && (
                              <p className="truncate max-w-[220px]">
                                {member.email}
                              </p>
                            )}
                          </div>
                        ) : (
                          <span>No contact info</span>
                        )}
                      </td>

                      <td className="py-3.5 px-3 whitespace-nowrap">
                        <Badge
                          variant={member.isActive ? 'success' : 'warning'}
                          size="sm"
                        >
                          {member.isActive ? 'Active' : 'Archived'}
                        </Badge>
                      </td>

                      <td className="py-3.5 pl-3 pr-5 text-right whitespace-nowrap">
                        <Link
                          href={`/members/${member.id}`}
                          className="inline-flex items-center justify-center rounded-md border border-[#E8E5ED] bg-white px-3 py-1.5 text-xs font-medium text-[#24212B] hover:bg-[#F8F7FA] hover:border-[#D6D0E0] transition-colors"
                        >
                          View Profile
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Mobile Card List View */}
          <div className="md:hidden divide-y divide-[#E8E5ED]">
            {members.map((member) => {
              const birthdayText = formatMemberBirthday(member);
              return (
                <Link
                  key={member.id}
                  href={`/members/${member.id}`}
                  className="flex items-start justify-between gap-3 p-4 hover:bg-[#F8F7FA]/70 transition-colors"
                >
                  <div className="flex items-start gap-3 min-w-0">
                    <MemberAvatar
                      memberId={member.id}
                      fullName={member.fullName}
                      hasPhoto={member.hasPhoto}
                      photoUpdatedAt={member.photoUpdatedAt}
                      size="md"
                    />
                    <div className="min-w-0 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-semibold text-[#24212B] truncate">
                          {member.fullName}
                        </span>
                        <Badge
                          variant={member.isActive ? 'success' : 'warning'}
                          size="sm"
                        >
                          {member.isActive ? 'Active' : 'Archived'}
                        </Badge>
                      </div>
                      {member.preferredName && (
                        <p className="text-xs text-[#77727F]">
                          Preferred: {member.preferredName}
                        </p>
                      )}
                      <p className="text-xs text-[#77727F] tabular-nums">
                        Birthday: {birthdayText}
                      </p>
                      {(member.phone || member.email) && (
                        <p className="text-xs text-[#77727F] truncate">
                          {member.phone ?? member.email}
                        </p>
                      )}
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>

          {/* Pagination Bar */}
          {pagination.totalPages > 1 && (
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-t border-[#E8E5ED] bg-[#FBFBFC] px-5 py-3 text-xs text-[#77727F]">
              <span className="tabular-nums">
                Showing {rangeStart}–{rangeEnd} of {pagination.total} (Page{' '}
                {pagination.page} of {pagination.totalPages})
              </span>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={!pagination.hasPreviousPage || isLoading}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  <ChevronLeft className="mr-1 h-3.5 w-3.5" />
                  Previous
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={!pagination.hasNextPage || isLoading}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Next
                  <ChevronRight className="ml-1 h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          )}
        </Card>
      )}

      <AddMemberModal
        open={isAddModalOpen}
        onClose={() => setIsAddModalOpen(false)}
        onMemberCreated={handleMemberCreated}
      />
    </div>
  );
}

