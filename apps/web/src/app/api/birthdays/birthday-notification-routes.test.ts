import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { OwnerAuthState } from '@/lib/auth/owner-guard';
import { InvalidBirthdayPreferencesError } from '@/lib/birthdays/birthday-preferences';
import { NotificationNotFoundError } from '@/lib/notifications/notification-service';

const mockState = vi.hoisted(() => ({
  authResult: { status: 'unauthenticated', owner: null } as OwnerAuthState,
  clearCookieCalls: 0,
  throwOnSync: null as Error | null,
  throwOnList: null as Error | null,
  throwOnReadSingle: null as Error | null,
}));

vi.mock('@/lib/auth/owner-guard', () => ({
  resolveAuthenticatedOwner: vi.fn(async () => mockState.authResult),
}));

vi.mock('@/lib/auth/session', () => ({
  clearSessionCookie: vi.fn(async () => {
    mockState.clearCookieCalls += 1;
  }),
}));

vi.mock('@/lib/birthdays/birthday-engine-service', () => ({
  runOrganisationBirthdayCycle: vi.fn(async () => {
    if (mockState.throwOnSync) throw mockState.throwOnSync;
    return {
      schedulesCreated: 4,
      schedulesUpdated: 1,
      schedulesCancelled: 0,
      preparationsSynced: 2,
      remindersDue: 1,
      notificationsCreated: 1,
      remindersSkipped: 0,
      remindersFailed: 0,
      unreadNotificationCount: 1,
    };
  }),
  runScheduledBirthdayRemindersForActiveOwners: vi.fn(async () => {
    if (mockState.throwOnSync) throw mockState.throwOnSync;
    return {
      processedOrganisations: 1,
      schedulesCreated: 2,
      schedulesUpdated: 0,
      schedulesCancelled: 0,
      preparationsSynced: 1,
      remindersDue: 1,
      notificationsCreated: 1,
      remindersSkipped: 0,
      remindersFailed: 0,
    };
  }),
}));

vi.mock('@/lib/notifications/notification-service', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/lib/notifications/notification-service')>();
  return {
    ...actual,
    listOwnerNotifications: vi.fn(async () => {
      if (mockState.throwOnList) throw mockState.throwOnList;
      return {
        notifications: [
          {
            id: 'not_1',
            memberId: 'mem_1',
            birthdayReminderId: 'rem_1',
            type: 'BIRTHDAY_REMINDER',
            title: 'Birthday today: Ama',
            body: "Ama's birthday celebration is today (11 Nov 2026).",
            href: '/members/mem_1',
            isRead: false,
            readAt: null,
            createdAt: '2026-11-11T08:00:00.000Z',
          },
        ],
        unreadCount: 1,
        pagination: {
          page: 1,
          limit: 25,
          total: 1,
          totalPages: 1,
          hasNextPage: false,
          hasPreviousPage: false,
        },
      };
    }),
    markNotificationAsRead: vi.fn(async (_actor, id: string) => {
      if (mockState.throwOnReadSingle) throw mockState.throwOnReadSingle;
      return {
        notification: {
          id,
          memberId: 'mem_1',
          birthdayReminderId: 'rem_1',
          type: 'BIRTHDAY_REMINDER',
          title: 'Birthday today: Ama',
          body: "Ama's birthday celebration is today (11 Nov 2026).",
          href: '/members/mem_1',
          isRead: true,
          readAt: '2026-11-11T08:05:00.000Z',
          createdAt: '2026-11-11T08:00:00.000Z',
        },
        changed: true,
      };
    }),
    markAllNotificationsAsRead: vi.fn(async () => ({ markedCount: 3 })),
  };
});

import { POST as syncPost } from '@/app/api/birthdays/sync/route';
import { POST as cronPost } from '@/app/api/cron/birthday-reminders/route';
import { GET as notificationsGet } from '@/app/api/notifications/route';
import { PATCH as notificationReadPatch } from '@/app/api/notifications/[id]/read/route';
import { POST as notificationReadAllPost } from '@/app/api/notifications/read-all/route';

function setAuthenticatedOwner() {
  mockState.authResult = {
    status: 'authenticated',
    owner: {
      session: {
        sub: 'usr_owner_1',
        role: 'OWNER',
        org: 'org_1',
        ver: 1,
        iat: 1000,
        exp: 2000,
      },
      profile: {
        id: 'usr_owner_1',
        firstName: 'Owner',
        lastName: 'User',
        email: 'owner@example.com',
        role: 'OWNER',
        organisationId: 'org_1',
        organisationName: 'CRELUNE',
        timezone: 'Africa/Accra',
      },
      preferences: {
        theme: 'light',
        dateFormat: 'DD/MM/YYYY',
        timezone: 'Africa/Accra',
        leadTimeDaysBirthday: 14,
        leadTimeDaysEvent: 21,
        defaultExportFormat: 'PNG',
      },
    },
  };
}

describe('Birthday Sync, Cron & Notification API Routes', () => {
  const originalCronSecret = process.env.CRON_SECRET;

  beforeEach(() => {
    mockState.authResult = { status: 'unauthenticated', owner: null };
    mockState.clearCookieCalls = 0;
    mockState.throwOnSync = null;
    mockState.throwOnList = null;
    mockState.throwOnReadSingle = null;
    delete process.env.CRON_SECRET;
  });

  afterEach(() => {
    if (originalCronSecret === undefined) {
      delete process.env.CRON_SECRET;
    } else {
      process.env.CRON_SECRET = originalCronSecret;
    }
  });

  it('rejects unauthenticated and revoked requests across owner birthday/notification endpoints', async () => {
    for (const call of [
      () =>
        syncPost(
          new Request('http://localhost:3000/api/birthdays/sync', {
            method: 'POST',
            headers: { host: 'localhost:3000', origin: 'http://localhost:3000' },
          })
        ),
      () =>
        notificationsGet(
          new Request('http://localhost:3000/api/notifications', { method: 'GET' })
        ),
      () =>
        notificationReadPatch(
          new Request('http://localhost:3000/api/notifications/not_1/read', {
            method: 'PATCH',
            headers: { host: 'localhost:3000', origin: 'http://localhost:3000' },
          }),
          { params: Promise.resolve({ id: 'not_1' }) }
        ),
      () =>
        notificationReadAllPost(
          new Request('http://localhost:3000/api/notifications/read-all', {
            method: 'POST',
            headers: { host: 'localhost:3000', origin: 'http://localhost:3000' },
          })
        ),
    ]) {
      const res = await call();
      expect(res.status).toBe(401);
    }

    mockState.authResult = { status: 'revoked', owner: null };
    const revokedRes = await notificationsGet(
      new Request('http://localhost:3000/api/notifications', { method: 'GET' })
    );
    expect(revokedRes.status).toBe(401);
    expect(mockState.clearCookieCalls).toBe(1);
  });

  it('enforces CSRF Origin checks and rejects unexpected payload fields on owner mutations', async () => {
    setAuthenticatedOwner();

    const csrfSync = await syncPost(
      new Request('http://localhost:3000/api/birthdays/sync', {
        method: 'POST',
        headers: { host: 'localhost:3000', origin: 'https://evil.example' },
      })
    );
    expect(csrfSync.status).toBe(403);

    const csrfReadAll = await notificationReadAllPost(
      new Request('http://localhost:3000/api/notifications/read-all', {
        method: 'POST',
        headers: { host: 'localhost:3000', origin: 'https://evil.example' },
      })
    );
    expect(csrfReadAll.status).toBe(403);

    const csrfReadSingle = await notificationReadPatch(
      new Request('http://localhost:3000/api/notifications/not_1/read', {
        method: 'PATCH',
        headers: { host: 'localhost:3000', origin: 'https://evil.example' },
      }),
      { params: Promise.resolve({ id: 'not_1' }) }
    );
    expect(csrfReadSingle.status).toBe(403);

    // Reject client-supplied organisationId spoofing on /api/birthdays/sync
    const spoofedOrgRes = await syncPost(
      new Request('http://localhost:3000/api/birthdays/sync', {
        method: 'POST',
        headers: {
          host: 'localhost:3000',
          origin: 'http://localhost:3000',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ organisationId: 'org_other' }),
      })
    );
    expect(spoofedOrgRes.status).toBe(400);

    // Reject invalid JSON
    const badJsonRes = await syncPost(
      new Request('http://localhost:3000/api/birthdays/sync', {
        method: 'POST',
        headers: {
          host: 'localhost:3000',
          origin: 'http://localhost:3000',
          'content-type': 'application/json',
        },
        body: '{invalid',
      })
    );
    expect(badJsonRes.status).toBe(400);

    // Valid empty POST succeeds with private no-store cache headers
    const okSync = await syncPost(
      new Request('http://localhost:3000/api/birthdays/sync', {
        method: 'POST',
        headers: { host: 'localhost:3000', origin: 'http://localhost:3000' },
      })
    );
    expect(okSync.status).toBe(200);
    expect(okSync.headers.get('cache-control')).toBe('private, no-store');
    const json = await okSync.json();
    expect(json.notificationsCreated).toBe(1);
    expect(json.unreadNotificationCount).toBe(1);
  });

  it('protects POST /api/cron/birthday-reminders with CRON_SECRET bearer auth and returns minimal non-PII stats', async () => {
    // Fails closed when CRON_SECRET is missing
    const missingSecret = await cronPost(
      new Request('http://localhost:3000/api/cron/birthday-reminders', {
        method: 'POST',
        headers: { authorization: 'Bearer test-secret' },
      })
    );
    expect(missingSecret.status).toBe(503);

    process.env.CRON_SECRET = 'valid_cron_secret_at_least_32_characters_long';

    // Rejects invalid bearer secret
    const badSecret = await cronPost(
      new Request('http://localhost:3000/api/cron/birthday-reminders', {
        method: 'POST',
        headers: { authorization: 'Bearer wrong_secret' },
      })
    );
    expect(badSecret.status).toBe(401);

    // Rejects query-string secret even when valid bearer header is also supplied
    const querySecret = await cronPost(
      new Request(
        `http://localhost:3000/api/cron/birthday-reminders?secret=${process.env.CRON_SECRET}`,
        {
          method: 'POST',
          headers: { authorization: `Bearer ${process.env.CRON_SECRET}` },
        }
      )
    );
    expect(querySecret.status).toBe(401);

    // Valid Bearer succeeds and returns strictly aggregate counts (no PII)
    const okCron = await cronPost(
      new Request('http://localhost:3000/api/cron/birthday-reminders', {
        method: 'POST',
        headers: { authorization: `Bearer ${process.env.CRON_SECRET}` },
      })
    );
    expect(okCron.status).toBe(200);
    expect(okCron.headers.get('cache-control')).toBe('private, no-store');
    const body = await okCron.json();
    expect(body).toEqual({
      ok: true,
      processedOrganisations: 1,
      schedulesCreated: 2,
      schedulesUpdated: 0,
      schedulesCancelled: 0,
      preparationsSynced: 1,
      remindersDue: 1,
      notificationsCreated: 1,
      remindersSkipped: 0,
      remindersFailed: 0,
    });
  });

  it('validates notification query/params and sanitizes error payloads without leaking DB URLs', async () => {
    setAuthenticatedOwner();

    const invalidQuery = await notificationsGet(
      new Request('http://localhost:3000/api/notifications?unreadOnly=maybe', {
        method: 'GET',
      })
    );
    expect(invalidQuery.status).toBe(400);

    const invalidId = await notificationReadPatch(
      new Request('http://localhost:3000/api/notifications/bad%20id!/read', {
        method: 'PATCH',
        headers: { host: 'localhost:3000', origin: 'http://localhost:3000' },
      }),
      { params: Promise.resolve({ id: 'bad id!' }) }
    );
    expect(invalidId.status).toBe(400);

    mockState.throwOnReadSingle = new NotificationNotFoundError();
    const notFound = await notificationReadPatch(
      new Request('http://localhost:3000/api/notifications/not_other/read', {
        method: 'PATCH',
        headers: { host: 'localhost:3000', origin: 'http://localhost:3000' },
      }),
      { params: Promise.resolve({ id: 'not_other' }) }
    );
    expect(notFound.status).toBe(404);

    mockState.throwOnSync = new InvalidBirthdayPreferencesError(
      'Configured owner timezone is not a valid IANA timezone.'
    );
    const badPrefs = await syncPost(
      new Request('http://localhost:3000/api/birthdays/sync', {
        method: 'POST',
        headers: { host: 'localhost:3000', origin: 'http://localhost:3000' },
      })
    );
    expect(badPrefs.status).toBe(422);

    mockState.throwOnList = new Error(
      'postgresql://neondb_owner:secret@ep-bad.neon.tech/neondb connection error'
    );
    const internalErr = await notificationsGet(
      new Request('http://localhost:3000/api/notifications', { method: 'GET' })
    );
    expect(internalErr.status).toBe(500);
    const raw = await internalErr.text();
    expect(raw).not.toContain('secret');
    expect(raw).not.toContain('postgresql://');
  });
});

