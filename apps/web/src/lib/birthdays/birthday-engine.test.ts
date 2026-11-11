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

  it('enforces CRON_SECRET strength (>= 32 trimmed chars), bearer header auth, and query-string rejection', async () => {
    const baseUrl = 'http://localhost:3000/api/cron/birthday-reminders';
    const postWithAuth = (token: string, url = baseUrl) =>
      new Request(url, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}` },
      });

    // Missing, blank, placeholder, 1-char, and 31-char secrets must fail closed with 503
    const invalidConfiguredSecrets: Array<string | undefined> = [
      undefined,
      '',
      '   ',
      'replace-with-a-secure-random-cron-secret-at-least-32-chars',
      'changeme',
      'example',
      'x',
      'a'.repeat(31),
      `   ${'a'.repeat(31)}   `,
    ];

    for (const configured of invalidConfiguredSecrets) {
      const token = configured?.trim() || 'any_token_value_32_characters_ok';
      const res = verifyCronBearerRequest(
        postWithAuth(token),
        configured === undefined ? {} : { CRON_SECRET: configured }
      );
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.response.status).toBe(503);
        const body = JSON.stringify(await res.response.json());
        if (configured && configured.trim().length > 0) {
          expect(body).not.toContain(configured.trim());
        }
      }
    }

    // Exactly 32-character secret is accepted only with matching Bearer token
    const exact32 = 'a'.repeat(32);
    const validExact32 = verifyCronBearerRequest(postWithAuth(exact32), {
      CRON_SECRET: exact32,
    });
    expect(validExact32.ok).toBe(true);

    // Trimming applies to CRON_SECRET value length
    const validPadded32 = verifyCronBearerRequest(postWithAuth(exact32), {
      CRON_SECRET: `  ${exact32}  `,
    });
    expect(validPadded32.ok).toBe(true);

    const secret = 'cron_secret_value_for_unit_tests_32chars_longer';

    const querySecretRes = verifyCronBearerRequest(
      postWithAuth(secret, `${baseUrl}?secret=${secret}`),
      { CRON_SECRET: secret }
    );
    expect(querySecretRes.ok).toBe(false);
    if (!querySecretRes.ok) {
      expect(querySecretRes.response.status).toBe(401);
      const body = JSON.stringify(await querySecretRes.response.json());
      expect(body).not.toContain(secret);
    }

    const wrongTokenRes = verifyCronBearerRequest(postWithAuth('wrong-token'), {
      CRON_SECRET: secret,
    });
    expect(wrongTokenRes.ok).toBe(false);
    if (!wrongTokenRes.ok) {
      expect(wrongTokenRes.response.status).toBe(401);
      const body = JSON.stringify(await wrongTokenRes.response.json());
      expect(body).not.toContain(secret);
      expect(body).not.toContain('wrong-token');
    }

    const validRes = verifyCronBearerRequest(postWithAuth(secret), {
      CRON_SECRET: secret,
    });
    expect(validRes.ok).toBe(true);
  });
});

