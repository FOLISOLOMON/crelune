import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  resolveAuthenticatedOwnerMock,
  validateRequestOriginMock,
  clearSessionCookieMock,
  getBirthdayOverviewMock,
  updateBirthdayPreparationStatusMock,
  updateOwnerBirthdayPreferencesMock,
} = vi.hoisted(() => ({
  resolveAuthenticatedOwnerMock: vi.fn(),
  validateRequestOriginMock: vi.fn(),
  clearSessionCookieMock: vi.fn(),
  getBirthdayOverviewMock: vi.fn(),
  updateBirthdayPreparationStatusMock: vi.fn(),
  updateOwnerBirthdayPreferencesMock: vi.fn(),
}));

vi.mock('@/lib/auth/owner-guard', () => ({
  resolveAuthenticatedOwner: resolveAuthenticatedOwnerMock,
}));

vi.mock('@/lib/auth/csrf', () => ({
  validateRequestOrigin: validateRequestOriginMock,
}));

vi.mock('@/lib/auth/session', () => ({
  clearSessionCookie: clearSessionCookieMock,
}));

vi.mock('@/lib/birthdays/birthday-overview-service', () => ({
  getBirthdayOverview: getBirthdayOverviewMock,
  updateBirthdayPreparationStatus: updateBirthdayPreparationStatusMock,
  updateOwnerBirthdayPreferences: updateOwnerBirthdayPreferencesMock,
}));

import { GET as getBirthdaysOverview } from './route';
import { PATCH as patchBirthdayPrepStatus } from './[memberId]/[targetYear]/status/route';
import { PATCH as patchBirthdayPreferences } from '@/app/api/settings/birthdays/route';

const AUTHENTICATED_OWNER = {
  status: 'authenticated' as const,
  owner: {
    profile: {
      id: '11111111-1111-4111-8111-111111111111',
      organisationId: '22222222-2222-4222-8222-222222222222',
      organisationName: 'CRELUNE',
      email: 'owner@example.com',
      firstName: 'Workspace',
      lastName: 'Owner',
      role: 'OWNER',
    },
    preferences: null,
  },
};

const VALID_MEMBER_ID = '33333333-3333-4333-8333-333333333333';

describe('Stage 3.6 Birthday Overview, Prep Status & Preferences Routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveAuthenticatedOwnerMock.mockResolvedValue(AUTHENTICATED_OWNER);
    validateRequestOriginMock.mockReturnValue({ allowed: true });
  });

  it('rejects unauthenticated GET /api/birthdays with 401', async () => {
    resolveAuthenticatedOwnerMock.mockResolvedValue({ status: 'unauthenticated' });
    const res = await getBirthdaysOverview(
      new Request('http://localhost:3000/api/birthdays?month=11&year=2026')
    );
    expect(res.status).toBe(401);
  });

  it('forwards validated query params on GET /api/birthdays', async () => {
    getBirthdayOverviewMock.mockResolvedValue({
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
      thisWeek: [],
      thisMonth: [],
      upcoming: [],
      monthEntries: [],
    });

    const res = await getBirthdaysOverview(
      new Request(
        'http://localhost:3000/api/birthdays?month=11&year=2026&prepStatus=DESIGN_IN_PROGRESS'
      )
    );
    expect(res.status).toBe(200);
    expect(getBirthdayOverviewMock).toHaveBeenCalledWith(
      AUTHENTICATED_OWNER.owner.profile.organisationId,
      AUTHENTICATED_OWNER.owner.profile.id,
      expect.objectContaining({
        month: 11,
        year: 2026,
        prepStatus: 'DESIGN_IN_PROGRESS',
      })
    );
  });

  it('enforces CSRF on PATCH /api/birthdays/[memberId]/[targetYear]/status', async () => {
    validateRequestOriginMock.mockReturnValue({
      allowed: false,
      reason: 'Cross-origin request rejected',
    });

    const res = await patchBirthdayPrepStatus(
      new Request(
        `http://localhost:3000/api/birthdays/${VALID_MEMBER_ID}/2026/status`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'DESIGN_IN_PROGRESS' }),
        }
      ),
      { params: Promise.resolve({ memberId: VALID_MEMBER_ID, targetYear: '2026' }) }
    );

    expect(res.status).toBe(403);
    expect(updateBirthdayPreparationStatusMock).not.toHaveBeenCalled();
  });

  it('updates birthday preparation status cleanly with valid input', async () => {
    updateBirthdayPreparationStatusMock.mockResolvedValue({
      id: '44444444-4444-4444-8444-444444444444',
      memberId: VALID_MEMBER_ID,
      targetYear: 2026,
      status: 'AWAITING_APPROVAL',
      notes: 'Draft flyer uploaded for pastor review',
      statusUpdatedAt: '2026-11-11T10:00:00.000Z',
    });

    const res = await patchBirthdayPrepStatus(
      new Request(
        `http://localhost:3000/api/birthdays/${VALID_MEMBER_ID}/2026/status`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            status: 'AWAITING_APPROVAL',
            notes: 'Draft flyer uploaded for pastor review',
          }),
        }
      ),
      { params: Promise.resolve({ memberId: VALID_MEMBER_ID, targetYear: '2026' }) }
    );

    expect(res.status).toBe(200);
    expect(updateBirthdayPreparationStatusMock).toHaveBeenCalledWith(
      {
        userId: AUTHENTICATED_OWNER.owner.profile.id,
        organisationId: AUTHENTICATED_OWNER.owner.profile.organisationId,
      },
      VALID_MEMBER_ID,
      2026,
      {
        status: 'AWAITING_APPROVAL',
        notes: 'Draft flyer uploaded for pastor review',
      }
    );
  });

  it('rejects invalid IANA timezones and updates valid preferences on PATCH /api/settings/birthdays', async () => {
    const badRes = await patchBirthdayPreferences(
      new Request('http://localhost:3000/api/settings/birthdays', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          timezone: 'Not/A_Zone',
          leapDayPolicy: 'FEB_28',
          birthdayReminderDays: [7, 1, 0],
        }),
      })
    );
    expect(badRes.status).toBe(400);
    expect(updateOwnerBirthdayPreferencesMock).not.toHaveBeenCalled();

    updateOwnerBirthdayPreferencesMock.mockResolvedValue({
      preferences: {
        timezone: 'Europe/London',
        leapDayPolicy: 'MAR_1',
        birthdayReminderDays: [7, 3, 0],
      },
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
    });

    const okRes = await patchBirthdayPreferences(
      new Request('http://localhost:3000/api/settings/birthdays', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          timezone: 'Europe/London',
          leapDayPolicy: 'MAR_1',
          birthdayReminderDays: [7, 3, 0],
        }),
      })
    );
    expect(okRes.status).toBe(200);
    expect(updateOwnerBirthdayPreferencesMock).toHaveBeenCalledTimes(1);
  });
});
