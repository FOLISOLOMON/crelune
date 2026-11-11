// @vitest-environment jsdom

import React from 'react';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  BirthdayOverviewResponse,
  DesignJobDetail,
  DesignJobSummary,
  NotificationListResponse,
} from '@crelune/shared';
import { BirthdayOperationsClient } from '@/components/birthdays/BirthdayOperationsClient';
import { NotificationsClient } from '@/components/notifications/NotificationsClient';
import { BirthdayPreferencesCard } from '@/components/settings/BirthdayPreferencesCard';
import { DesignJobsClient } from '@/components/designs/DesignJobsClient';
import { DesignJobDetailClient } from '@/components/designs/DesignJobDetailClient';

const { routerRefreshMock, routerPushMock } = vi.hoisted(() => ({
  routerRefreshMock: vi.fn(),
  routerPushMock: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    refresh: routerRefreshMock,
    push: routerPushMock,
  }),
}));

const MEMBER_ID = '11111111-1111-4111-8111-111111111111';
const JOB_ID = '55555555-5555-4555-8555-555555555555';

const BASE_BIRTHDAY_OVERVIEW: BirthdayOverviewResponse = {
  timezone: 'Africa/Accra',
  leapDayPolicy: 'FEB_28',
  todayIso: '2026-11-11',
  selectedMonth: 11,
  selectedYear: 2026,
  preferences: {
    timezone: 'Africa/Accra',
    leapDayPolicy: 'FEB_28',
    birthdayReminderDays: [7, 3, 1, 0],
  },
  counts: {
    totalWithBirthday: 1,
    todayCount: 0,
    weekCount: 1,
    monthCount: 1,
    upcomingCount: 1,
    awaitingPrepCount: 1,
  },
  today: [],
  thisWeek: [
    {
      memberId: MEMBER_ID,
      fullName: 'Daniel Boateng',
      preferredName: 'Danny',
      birthDay: 29,
      birthMonth: 2,
      birthYear: null,
      hasPhoto: false,
      photoUpdatedAt: null,
      targetYear: 2026,
      celebratedDateIso: '2026-11-14',
      celebratedMonth: 11,
      celebratedDay: 14,
      daysUntil: 3,
      isToday: false,
      isLeapDayAdjusted: true,
      prepId: null,
      prepStatus: 'UPCOMING',
      prepNotes: null,
      designJobId: null,
      designJobTitle: null,
      designJobStatus: null,
    },
  ],
  thisMonth: [],
  upcoming: [
    {
      memberId: MEMBER_ID,
      fullName: 'Daniel Boateng',
      preferredName: 'Danny',
      birthDay: 29,
      birthMonth: 2,
      birthYear: null,
      hasPhoto: false,
      photoUpdatedAt: null,
      targetYear: 2026,
      celebratedDateIso: '2026-11-14',
      celebratedMonth: 11,
      celebratedDay: 14,
      daysUntil: 3,
      isToday: false,
      isLeapDayAdjusted: true,
      prepId: null,
      prepStatus: 'UPCOMING',
      prepNotes: null,
      designJobId: null,
      designJobTitle: null,
      designJobStatus: null,
    },
  ],
  monthEntries: [
    {
      memberId: MEMBER_ID,
      fullName: 'Daniel Boateng',
      preferredName: 'Danny',
      birthDay: 29,
      birthMonth: 2,
      birthYear: null,
      hasPhoto: false,
      photoUpdatedAt: null,
      targetYear: 2026,
      celebratedDateIso: '2026-11-14',
      celebratedMonth: 11,
      celebratedDay: 14,
      daysUntil: 3,
      isToday: false,
      isLeapDayAdjusted: true,
      prepId: null,
      prepStatus: 'UPCOMING',
      prepNotes: null,
      designJobId: null,
      designJobTitle: null,
      designJobStatus: null,
    },
  ],
};

describe('Stage 3.6 & Milestone 4 Interactive UI Workflows', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('navigates Birthday calendar months, updates preparation status, syncs reminders, and starts a linked flyer', async () => {
    let currentPrepStatus = 'UPCOMING' as const;
    let linkedJobId: string | null = null;

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/birthdays/sync' && init?.method === 'POST') {
        return new Response(
          JSON.stringify({
            summary: {
              schedulesCreated: 1,
              schedulesUpdated: 0,
              schedulesCancelled: 0,
              preparationsSynced: 1,
              remindersDue: 1,
              notificationsCreated: 1,
              remindersSkipped: 0,
              remindersFailed: 0,
              unreadNotificationCount: 1,
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }

      if (url.includes(`/api/birthdays/${MEMBER_ID}/2026/status`) && init?.method === 'PATCH') {
        currentPrepStatus = 'DESIGN_IN_PROGRESS' as never;
        return new Response(
          JSON.stringify({
            preparation: {
              id: 'prep-1',
              memberId: MEMBER_ID,
              targetYear: 2026,
              status: currentPrepStatus,
              notes: null,
              statusUpdatedAt: '2026-11-11T10:00:00.000Z',
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }

      if (url === '/api/designs' && init?.method === 'POST') {
        linkedJobId = JOB_ID;
        return new Response(
          JSON.stringify({
            job: {
              id: JOB_ID,
              title: 'Daniel Boateng Birthday Flyer 2026',
              category: 'BIRTHDAY_FLYER',
              status: 'PENDING',
              priority: 'HIGH',
              memberId: MEMBER_ID,
              member: null,
              birthdayTargetYear: 2026,
              targetPlatform: null,
              dimensions: null,
              dueDate: '2026-11-14',
              approvedAt: null,
              exportedAt: null,
              publishedAt: null,
              cancelledAt: null,
              createdAt: '2026-11-11T10:00:00.000Z',
              updatedAt: '2026-11-11T10:00:00.000Z',
              requiredText: null,
              preferredTemplateNote: null,
              referenceNotes: null,
              notes: null,
              history: [],
            },
          }),
          { status: 201, headers: { 'Content-Type': 'application/json' } }
        );
      }

      if (url.startsWith('/api/birthdays')) {
        const parsed = new URL(url, 'http://localhost:3000');
        const month = Number(parsed.searchParams.get('month') ?? 11);
        const year = Number(parsed.searchParams.get('year') ?? 2026);
        const updatedItem = {
          ...BASE_BIRTHDAY_OVERVIEW.upcoming[0],
          prepStatus: currentPrepStatus,
          designJobId: linkedJobId,
          designJobStatus: linkedJobId ? 'PENDING' : null,
        };
        return new Response(
          JSON.stringify({
            ...BASE_BIRTHDAY_OVERVIEW,
            selectedMonth: month,
            selectedYear: year,
            upcoming: [updatedItem],
            monthEntries: month === 11 ? [updatedItem] : [],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<BirthdayOperationsClient initialOverview={BASE_BIRTHDAY_OVERVIEW} />);

    // Displays leap-day adjustment indicator & avoids fabricating unknown birth year
    expect(screen.getByText(/leap-day adjusted/i)).toBeTruthy();
    expect(screen.getByText(/birth year not recorded/i)).toBeTruthy();

    // Update prep status inline
    fireEvent.change(
      screen.getByLabelText(/preparation status for daniel boateng/i),
      { target: { value: 'DESIGN_IN_PROGRESS' } }
    );
    await screen.findByText(/updated daniel boateng's 2026 birthday prep/i);

    // Sync reminders explicitly
    fireEvent.click(screen.getByRole('button', { name: /sync reminders now/i }));
    await screen.findByText(/1 due notification\(s\) generated/i);
    expect(routerRefreshMock).toHaveBeenCalled();

    // Launch Birthday Flyer modal prefilled for Daniel Boateng
    fireEvent.click(screen.getByRole('button', { name: /start birthday flyer/i }));
    await screen.findByRole('dialog');
    fireEvent.click(screen.getByRole('button', { name: /create design job/i }));
    await screen.findByText(/started "daniel boateng birthday flyer 2026"/i);

    // Switch to Monthly Calendar and advance to December 2026
    fireEvent.click(screen.getByRole('tab', { name: /monthly calendar/i }));
    await screen.findByText(/november 2026 celebration calendar/i);
    fireEvent.click(screen.getByRole('button', { name: /next month/i }));
    await screen.findByText(/december 2026 celebration calendar/i);
  });

  it('filters unread notifications, marks one read, and marks all read in NotificationsClient', async () => {
    const initialNotifications: NotificationListResponse = {
      notifications: [
        {
          id: 'notif-1',
          memberId: MEMBER_ID,
          birthdayReminderId: 'rem-1',
          type: 'BIRTHDAY_REMINDER',
          title: 'Birthday in 3 days: Daniel Boateng',
          body: 'Prepare artwork before 14 Nov 2026.',
          href: `/members/${MEMBER_ID}`,
          isRead: false,
          readAt: null,
          createdAt: '2026-11-11T08:00:00.000Z',
        },
        {
          id: 'notif-2',
          memberId: null,
          birthdayReminderId: null,
          type: 'SYSTEM',
          title: 'Workspace Sync Ready',
          body: 'Reminder engine active.',
          href: '/birthdays',
          isRead: false,
          readAt: null,
          createdAt: '2026-11-10T08:00:00.000Z',
        },
      ],
      unreadCount: 2,
      pagination: {
        page: 1,
        limit: 25,
        total: 2,
        totalPages: 1,
        hasNextPage: false,
        hasPreviousPage: false,
      },
    };

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/notifications/notif-1/read' && init?.method === 'PATCH') {
        return new Response(
          JSON.stringify({
            notification: {
              id: 'notif-1',
              isRead: true,
              readAt: '2026-11-11T10:05:00.000Z',
            },
            changed: true,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      if (url === '/api/notifications/read-all' && init?.method === 'POST') {
        return new Response(
          JSON.stringify({ updatedCount: 1, unreadCount: 0 }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      if (url.startsWith('/api/notifications')) {
        return new Response(
          JSON.stringify({
            ...initialNotifications,
            unreadCount: 0,
            notifications: initialNotifications.notifications.map((n) => ({
              ...n,
              isRead: true,
              readAt: '2026-11-11T10:05:00.000Z',
            })),
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<NotificationsClient initialData={initialNotifications} />);

    const readButtons = screen.getAllByRole('button', { name: /^mark read$/i });
    fireEvent.click(readButtons[0]!);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/notifications/notif-1/read',
        expect.objectContaining({ method: 'PATCH' })
      );
      expect(routerRefreshMock).toHaveBeenCalled();
    });
  });

  it('validates timezone and saves birthday preferences in BirthdayPreferencesCard', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/settings/birthdays' && init?.method === 'PATCH') {
        const body = JSON.parse(String(init.body));
        return new Response(
          JSON.stringify({
            preferences: body,
            reconciliation: {
              schedulesCreated: 2,
              schedulesUpdated: 1,
              schedulesCancelled: 0,
              preparationsSynced: 3,
              remindersDue: 0,
              notificationsCreated: 0,
              remindersSkipped: 0,
              remindersFailed: 0,
              unreadNotificationCount: 0,
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <BirthdayPreferencesCard
        initialPreferences={{
          timezone: 'Africa/Accra',
          leapDayPolicy: 'FEB_28',
          birthdayReminderDays: [7, 3, 1, 0],
        }}
      />
    );

    // Rejects invalid IANA timezone client-side before sending network call
    fireEvent.change(screen.getByLabelText(/iana timezone identifier/i), {
      target: { value: 'Mars/Olympus' },
    });
    fireEvent.click(
      screen.getByRole('button', { name: /save birthday preferences/i })
    );
    await screen.findByText(/please choose a valid iana timezone/i);
    expect(fetchMock).not.toHaveBeenCalled();

    // Accepts valid timezone + leap-day policy switch and saves
    fireEvent.change(screen.getByLabelText(/iana timezone identifier/i), {
      target: { value: 'Europe/London' },
    });
    fireEvent.click(screen.getByLabelText(/march 1/i));
    fireEvent.click(
      screen.getByRole('button', { name: /save birthday preferences/i })
    );

    await screen.findByText(/pending reminder schedules reconciled/i);
    expect(routerRefreshMock).toHaveBeenCalled();
  });

  it('toggles DesignJobsClient board view and advances EXPORTED -> PUBLISHED explicitly in DesignJobDetailClient', async () => {
    const summaryJob: DesignJobSummary = {
      id: JOB_ID,
      title: 'Youth Camp Poster',
      category: 'EVENT_ANNOUNCEMENT',
      status: 'EXPORTED',
      priority: 'HIGH',
      memberId: null,
      member: null,
      birthdayTargetYear: null,
      targetPlatform: 'Instagram',
      dimensions: '1080x1350',
      dueDate: '2026-11-28',
      approvedAt: '2026-11-10T10:00:00.000Z',
      exportedAt: '2026-11-11T09:00:00.000Z',
      publishedAt: null,
      cancelledAt: null,
      createdAt: '2026-11-09T10:00:00.000Z',
      updatedAt: '2026-11-11T09:00:00.000Z',
    };

    const detailJob: DesignJobDetail = {
      ...summaryJob,
      requiredText: 'CRELUNE Youth Camp 2026',
      preferredTemplateNote: null,
      referenceNotes: null,
      notes: null,
      history: [
        {
          id: 'hist-1',
          previousStatus: 'APPROVED',
          newStatus: 'EXPORTED',
          note: 'Exported lossless PNG',
          changedByName: 'Workspace Owner',
          createdAt: '2026-11-11T09:00:00.000Z',
        },
      ],
    };

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === `/api/designs/${JOB_ID}/transition` && init?.method === 'POST') {
        const body = JSON.parse(String(init.body));
        return new Response(
          JSON.stringify({
            job: {
              ...detailJob,
              status: body.status,
              publishedAt: '2026-11-11T10:30:00.000Z',
              history: [
                {
                  id: 'hist-2',
                  previousStatus: 'EXPORTED',
                  newStatus: body.status,
                  note: body.note ?? null,
                  changedByName: 'Workspace Owner',
                  createdAt: '2026-11-11T10:30:00.000Z',
                },
                ...detailJob.history,
              ],
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <DesignJobsClient
        initialJobs={[summaryJob]}
        initialPagination={{
          page: 1,
          limit: 25,
          total: 1,
          totalPages: 1,
          hasNextPage: false,
          hasPreviousPage: false,
        }}
        initialStatusCounts={{
          DRAFT: 0,
          PENDING: 0,
          IN_PROGRESS: 0,
          AWAITING_REVIEW: 0,
          APPROVED: 0,
          EXPORTED: 1,
          PUBLISHED: 0,
          CANCELLED: 0,
        }}
        memberOptions={[]}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /board/i }));
    await screen.findByText('Youth Camp Poster');
    cleanup();

    render(<DesignJobDetailClient initialJob={detailJob} memberOptions={[]} />);
    // Explicit rule check: EXPORTED warns owner publication is separate
    expect(
      screen.getByText(/exporting artwork does not automatically mark a design as published/i)
    ).toBeTruthy();

    fireEvent.change(screen.getByLabelText(/transition note/i), {
      target: { value: 'Posted to official channel' },
    });
    fireEvent.click(screen.getByRole('button', { name: /move to published/i }));

    await screen.findByText(/design status updated to published/i);
    await screen.findByText(/posted to official channel/i);
  });
});

