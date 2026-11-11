import { describe, it, expect } from 'vitest';
import {
  DEFAULT_LEAP_DAY_POLICY,
  DEFAULT_REMINDER_LEAD_DAYS,
  DEFAULT_TIMEZONE,
  resolveCelebrationDateForYear,
} from '@crelune/shared';
import { verifyCronBearerRequest } from '@/lib/auth/cron-auth';
import {
  InvalidBirthdayPreferencesError,
  validateAndNormalizeOwnerPreferences,
} from '@/lib/birthdays/birthday-preferences';
import {
  buildBirthdayNotificationContent,
  formatSafeReminderError,
} from '@/lib/birthdays/birthday-processor-service';

describe('Birthday Engine Preferences, Notifications & Cron Bearer Security', () => {
  it('applies approved defaults only when UserPreference row is absent and never silently overrides invalid configured settings', () => {
    expect(validateAndNormalizeOwnerPreferences(null)).toEqual({
      timezone: DEFAULT_TIMEZONE,
      leapDayPolicy: DEFAULT_LEAP_DAY_POLICY,
      birthdayReminderDays: [...DEFAULT_REMINDER_LEAD_DAYS],
    });

    expect(
      validateAndNormalizeOwnerPreferences({
        timezone: 'America/New_York',
        leapDayPolicy: 'MAR_1',
        birthdayReminderDays: [14, 7, 0],
      })
    ).toEqual({
      timezone: 'America/New_York',
      leapDayPolicy: 'MAR_1',
      birthdayReminderDays: [14, 7, 0],
    });

    expect(() =>
      validateAndNormalizeOwnerPreferences({
        timezone: 'Invalid/Zone',
        leapDayPolicy: 'FEB_28',
        birthdayReminderDays: [7, 3, 1, 0],
      })
    ).toThrow(InvalidBirthdayPreferencesError);

    expect(() =>
      validateAndNormalizeOwnerPreferences({
        timezone: 'Africa/Accra',
        leapDayPolicy: 'FEB_28',
        birthdayReminderDays: [-5, 3],
      })
    ).toThrow(InvalidBirthdayPreferencesError);
  });

  it('builds privacy-safe notification title, body, leap-day note, and internal route href', () => {
    const celebrationFeb28 = resolveCelebrationDateForYear(2, 29, 2026, 'FEB_28');
    const noticeToday = buildBirthdayNotificationContent(
      {
        id: 'mem_123',
        fullName: 'Kofi Owusu',
        preferredName: 'Bro. Kofi',
      },
      0,
      celebrationFeb28
    );

    expect(noticeToday.title).toBe('Birthday today: Bro. Kofi');
    expect(noticeToday.body).toContain('28 Feb 2026');
    expect(noticeToday.body).toContain('leap-day policy');
    expect(noticeToday.href).toBe('/members/mem_123');

    const noticeUpcoming = buildBirthdayNotificationContent(
      {
        id: 'mem_456',
        fullName: 'Ama Mensah',
        preferredName: null,
      },
      7,
      resolveCelebrationDateForYear(10, 14, 2026, 'FEB_28')
    );
    expect(noticeUpcoming.title).toBe('Upcoming birthday (7 days): Ama Mensah');
    expect(noticeUpcoming.body).toContain('14 Oct 2026');
    expect(noticeUpcoming.body).toContain('in 7 days');
    expect(noticeUpcoming.href).toBe('/members/mem_456');
  });

  it('sanitizes reminder processing errors without exposing connection URLs or credentials', () => {
    const sensitiveErr = Object.assign(
      new Error('postgresql://user:super_secret@ep-bad.neon.tech/neondb connection failed'),
      { code: 'P1001' }
    );
    sensitiveErr.name = 'PrismaClientKnownRequestError';

    const formatted = formatSafeReminderError(sensitiveErr);
    expect(formatted).toBe('PrismaClientKnownRequestError:P1001');
    expect(formatted).not.toContain('super_secret');
    expect(formatted).not.toContain('postgresql://');
  });

  it('enforces CRON_SECRET bearer header authentication and blocks query-string secrets or missing config', () => {
    const missingSecretRes = verifyCronBearerRequest(
      new Request('http://localhost:3000/api/cron/birthday-reminders', {
        method: 'POST',
        headers: { authorization: 'Bearer anything' },
      }),
      {}
    );
    expect(missingSecretRes.ok).toBe(false);
    if (!missingSecretRes.ok) {
      expect(missingSecretRes.response.status).toBe(503);
    }

    const secret = 'cron_secret_value_for_unit_tests_32chars';

    const querySecretRes = verifyCronBearerRequest(
      new Request(`http://localhost:3000/api/cron/birthday-reminders?secret=${secret}`, {
        method: 'POST',
        headers: { authorization: `Bearer ${secret}` },
      }),
      { CRON_SECRET: secret }
    );
    expect(querySecretRes.ok).toBe(false);
    if (!querySecretRes.ok) {
      expect(querySecretRes.response.status).toBe(401);
    }

    const wrongTokenRes = verifyCronBearerRequest(
      new Request('http://localhost:3000/api/cron/birthday-reminders', {
        method: 'POST',
        headers: { authorization: 'Bearer wrong-token' },
      }),
      { CRON_SECRET: secret }
    );
    expect(wrongTokenRes.ok).toBe(false);
    if (!wrongTokenRes.ok) {
      expect(wrongTokenRes.response.status).toBe(401);
    }

    const validRes = verifyCronBearerRequest(
      new Request('http://localhost:3000/api/cron/birthday-reminders', {
        method: 'POST',
        headers: { authorization: `Bearer ${secret}` },
      }),
      { CRON_SECRET: secret }
    );
    expect(validRes.ok).toBe(true);
  });
});

