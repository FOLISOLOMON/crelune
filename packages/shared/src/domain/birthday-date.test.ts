import { describe, it, expect } from 'vitest';
import {
  DEFAULT_LEAP_DAY_POLICY,
  DEFAULT_REMINDER_LEAD_DAYS,
  DEFAULT_TIMEZONE,
  addCalendarDays,
  buildBirthdayReminderIdempotencyKey,
  calculateBirthdayReminderDates,
  civilDateToUtcMidnight,
  diffCalendarDays,
  formatCivilDateIso,
  getDaysInMonth,
  getNextBirthdayOccurrence,
  getTodayCivilDate,
  isLeapYear,
  isValidCalendarDay,
  isValidIanaTimeZone,
  parseCivilDateIso,
  resolveCelebrationDateForYear,
  utcDateOnlyToCivilDate,
  validateBirthdayTuple,
  validateReminderLeadDays,
} from './birthday-date.js';

describe('Birthday Date Core — Gregorian Calendar & Leap-Year Rules', () => {
  it('defaults timezone to Africa/Accra, leap-day policy to FEB_28, and reminder lead days to [7, 3, 1, 0]', () => {
    expect(DEFAULT_TIMEZONE).toBe('Africa/Accra');
    expect(DEFAULT_LEAP_DAY_POLICY).toBe('FEB_28');
    expect(DEFAULT_REMINDER_LEAD_DAYS).toEqual([7, 3, 1, 0]);
  });

  it('correctly identifies leap years including century exceptions (2024, 2025, 2026, 2000, 2100)', () => {
    expect(isLeapYear(2024)).toBe(true);
    expect(isLeapYear(2025)).toBe(false);
    expect(isLeapYear(2026)).toBe(false);
    expect(isLeapYear(2000)).toBe(true);
    expect(isLeapYear(1900)).toBe(false);
    expect(isLeapYear(2100)).toBe(false);
  });

  it('validates valid and invalid calendar dates accurately', () => {
    expect(getDaysInMonth(2, null)).toBe(29);
    expect(getDaysInMonth(2, 2024)).toBe(29);
    expect(getDaysInMonth(2, 2025)).toBe(28);
    expect(getDaysInMonth(2, 2100)).toBe(28);
    expect(getDaysInMonth(4, 2026)).toBe(30);
    expect(getDaysInMonth(12, 2026)).toBe(31);

    expect(isValidCalendarDay(1, 31)).toBe(true);
    expect(isValidCalendarDay(4, 30)).toBe(true);
    expect(isValidCalendarDay(2, 29, null)).toBe(true);
    expect(isValidCalendarDay(2, 29, 2024)).toBe(true);

    // Invalid calendar combinations
    expect(isValidCalendarDay(2, 30)).toBe(false);
    expect(isValidCalendarDay(2, 29, 2025)).toBe(false);
    expect(isValidCalendarDay(2, 29, 2100)).toBe(false);
    expect(isValidCalendarDay(4, 31)).toBe(false);
    expect(isValidCalendarDay(6, 31)).toBe(false);
    expect(isValidCalendarDay(9, 31)).toBe(false);
    expect(isValidCalendarDay(11, 31)).toBe(false);
    expect(isValidCalendarDay(0, 15)).toBe(false);
    expect(isValidCalendarDay(13, 1)).toBe(false);
    expect(isValidCalendarDay(5, 0)).toBe(false);
    expect(isValidCalendarDay(5, 32)).toBe(false);
  });

  it('validates supplied, unknown-year, omitted, and partial birthday tuples', () => {
    expect(validateBirthdayTuple({})).toEqual({ valid: true, hasBirthday: false });
    expect(
      validateBirthdayTuple({ birthMonth: null, birthDay: null, birthYear: null })
    ).toEqual({ valid: true, hasBirthday: false });

    expect(
      validateBirthdayTuple({ birthMonth: 2, birthDay: 29, birthYear: null })
    ).toEqual({
      valid: true,
      hasBirthday: true,
      birthMonth: 2,
      birthDay: 29,
      birthYear: null,
    });

    expect(
      validateBirthdayTuple(
        { birthMonth: 2, birthDay: 29, birthYear: 2024 },
        { maxBirthYear: 2026 }
      )
    ).toEqual({
      valid: true,
      hasBirthday: true,
      birthMonth: 2,
      birthDay: 29,
      birthYear: 2024,
    });

    // Reject Feb 29 in non-leap known birth year
    expect(
      validateBirthdayTuple(
        { birthMonth: 2, birthDay: 29, birthYear: 2025 },
        { maxBirthYear: 2026 }
      ).valid
    ).toBe(false);

    // Reject partial birthdays (missing day, missing month, or year without month/day)
    expect(validateBirthdayTuple({ birthMonth: 5 }).valid).toBe(false);
    expect(validateBirthdayTuple({ birthDay: 14 }).valid).toBe(false);
    expect(validateBirthdayTuple({ birthYear: 1995 }).valid).toBe(false);
  });
});

describe('Birthday Date Core — Leap-Day Policies & Rollover Occurrences', () => {
  it('resolves February 29 in 2024, 2025, 2026, and 2100 under default FEB_28 policy', () => {
    expect(resolveCelebrationDateForYear(2, 29, 2024)).toEqual({
      date: { year: 2024, month: 2, day: 29 },
      isoDate: '2024-02-29',
      observedDueToLeapPolicy: false,
    });
    expect(resolveCelebrationDateForYear(2, 29, 2025)).toEqual({
      date: { year: 2025, month: 2, day: 28 },
      isoDate: '2025-02-28',
      observedDueToLeapPolicy: true,
    });
    expect(resolveCelebrationDateForYear(2, 29, 2026)).toEqual({
      date: { year: 2026, month: 2, day: 28 },
      isoDate: '2026-02-28',
      observedDueToLeapPolicy: true,
    });
    expect(resolveCelebrationDateForYear(2, 29, 2100)).toEqual({
      date: { year: 2100, month: 2, day: 28 },
      isoDate: '2100-02-28',
      observedDueToLeapPolicy: true,
    });
  });

  it('supports MAR_1 leap-day policy in non-leap years', () => {
    expect(resolveCelebrationDateForYear(2, 29, 2025, 'MAR_1')).toEqual({
      date: { year: 2025, month: 3, day: 1 },
      isoDate: '2025-03-01',
      observedDueToLeapPolicy: true,
    });
    expect(resolveCelebrationDateForYear(2, 29, 2026, 'MAR_1')).toEqual({
      date: { year: 2026, month: 3, day: 1 },
      isoDate: '2026-03-01',
      observedDueToLeapPolicy: true,
    });
    expect(resolveCelebrationDateForYear(2, 29, 2100, 'MAR_1')).toEqual({
      date: { year: 2100, month: 3, day: 1 },
      isoDate: '2100-03-01',
      observedDueToLeapPolicy: true,
    });
    // Leap year itself stays Feb 29 regardless of policy
    expect(resolveCelebrationDateForYear(2, 29, 2024, 'MAR_1')).toEqual({
      date: { year: 2024, month: 2, day: 29 },
      isoDate: '2024-02-29',
      observedDueToLeapPolicy: false,
    });
  });

  it('supports unknown birth year without inventing age and preserves known turningAge', () => {
    const unknownYear = getNextBirthdayOccurrence(
      { birthMonth: 8, birthDay: 19, birthYear: null },
      { year: 2026, month: 8, day: 19 }
    );
    expect(unknownYear.targetYear).toBe(2026);
    expect(unknownYear.daysUntil).toBe(0);
    expect(unknownYear.turningAge).toBeNull();

    const knownYear = getNextBirthdayOccurrence(
      { birthMonth: 8, birthDay: 19, birthYear: 1996 },
      { year: 2026, month: 8, day: 12 }
    );
    expect(knownYear.targetYear).toBe(2026);
    expect(knownYear.daysUntil).toBe(7);
    expect(knownYear.turningAge).toBe(30);
  });

  it('handles December-to-January year transitions cleanly', () => {
    const rollover = getNextBirthdayOccurrence(
      { birthMonth: 1, birthDay: 2, birthYear: null },
      { year: 2026, month: 12, day: 28 }
    );
    expect(rollover).toEqual({
      targetYear: 2027,
      celebrationDate: { year: 2027, month: 1, day: 2 },
      celebrationIsoDate: '2027-01-02',
      observedDueToLeapPolicy: false,
      daysUntil: 5,
      turningAge: null,
    });

    const dec31 = getNextBirthdayOccurrence(
      { birthMonth: 12, birthDay: 30, birthYear: 1990 },
      { year: 2026, month: 12, day: 31 }
    );
    expect(dec31.targetYear).toBe(2027);
    expect(dec31.daysUntil).toBe(364);
    expect(dec31.turningAge).toBe(37);
  });
});

describe('Birthday Date Core — Reminder Schedules & Date-Only Timezone Boundaries', () => {
  it('computes exact calendar reminder dates for 7, 3, 1, and 0 days across year rollover', () => {
    const schedules = calculateBirthdayReminderDates(
      { birthMonth: 1, birthDay: 2 },
      2027
    );

    expect(
      schedules.map((s) => ({
        leadDays: s.leadDays,
        targetYear: s.targetYear,
        scheduledIsoDate: s.scheduledIsoDate,
      }))
    ).toEqual([
      { leadDays: 7, targetYear: 2027, scheduledIsoDate: '2026-12-26' },
      { leadDays: 3, targetYear: 2027, scheduledIsoDate: '2026-12-30' },
      { leadDays: 1, targetYear: 2027, scheduledIsoDate: '2027-01-01' },
      { leadDays: 0, targetYear: 2027, scheduledIsoDate: '2027-01-02' },
    ]);
  });

  it('computes 7, 3, 1, and 0 reminder dates accurately for Feb 29 under FEB_28 vs MAR_1 in 2026', () => {
    const feb28Schedule = calculateBirthdayReminderDates(
      { birthMonth: 2, birthDay: 29 },
      2026,
      DEFAULT_REMINDER_LEAD_DAYS,
      'FEB_28'
    );
    expect(feb28Schedule.map((s) => s.scheduledIsoDate)).toEqual([
      '2026-02-21',
      '2026-02-25',
      '2026-02-27',
      '2026-02-28',
    ]);

    const mar1Schedule = calculateBirthdayReminderDates(
      { birthMonth: 2, birthDay: 29 },
      2026,
      DEFAULT_REMINDER_LEAD_DAYS,
      'MAR_1'
    );
    expect(mar1Schedule.map((s) => s.scheduledIsoDate)).toEqual([
      '2026-02-22',
      '2026-02-26',
      '2026-02-28',
      '2026-03-01',
    ]);
  });

  it('performs calendar-day arithmetic without DST off-by-one drift and preserves date-only UTC persistence roundtrips', () => {
    // Crosses US/EU spring-forward DST month cleanly via civil calendar math
    expect(addCalendarDays({ year: 2026, month: 3, day: 10 }, -7)).toEqual({
      year: 2026,
      month: 3,
      day: 3,
    });
    expect(
      diffCalendarDays(
        { year: 2024, month: 2, day: 28 },
        { year: 2024, month: 3, day: 1 }
      )
    ).toBe(2);
    expect(
      diffCalendarDays(
        { year: 2025, month: 2, day: 28 },
        { year: 2025, month: 3, day: 1 }
      )
    ).toBe(1);

    const civil = parseCivilDateIso('2026-10-14');
    const utcDate = civilDateToUtcMidnight(civil);
    expect(utcDate.toISOString()).toBe('2026-10-14T00:00:00.000Z');
    expect(utcDateOnlyToCivilDate(utcDate)).toEqual(civil);
    expect(formatCivilDateIso(civil)).toBe('2026-10-14');
  });

  it('resolves civil today accurately across timezone midnight boundaries using Africa/Accra default', () => {
    // 23:30 UTC is still June 14 in Africa/Accra (UTC+0), but June 15 in Asia/Tokyo (UTC+9)
    const lateUtc = new Date('2026-06-14T23:30:00.000Z');
    expect(getTodayCivilDate('Africa/Accra', lateUtc)).toEqual({
      year: 2026,
      month: 6,
      day: 14,
    });
    expect(getTodayCivilDate('Asia/Tokyo', lateUtc)).toEqual({
      year: 2026,
      month: 6,
      day: 15,
    });

    // 01:30 UTC is already June 15 in Africa/Accra (UTC+0), still June 14 in America/New_York (UTC-4)
    const earlyUtc = new Date('2026-06-15T01:30:00.000Z');
    expect(getTodayCivilDate(undefined, earlyUtc)).toEqual({
      year: 2026,
      month: 6,
      day: 15,
    });
    expect(getTodayCivilDate('America/New_York', earlyUtc)).toEqual({
      year: 2026,
      month: 6,
      day: 14,
    });
  });

  it('builds deterministic idempotency keys', () => {
    expect(buildBirthdayReminderIdempotencyKey('mem_123', 2027, 7)).toBe(
      'bday:mem_123:2027:7'
    );
  });

  it('validates canonical IANA timezones and reminder lead-day intervals strictly', () => {
    expect(isValidIanaTimeZone('Africa/Accra')).toBe(true);
    expect(isValidIanaTimeZone('America/New_York')).toBe(true);
    expect(isValidIanaTimeZone('UTC')).toBe(true);
    expect(isValidIanaTimeZone('Etc/UTC')).toBe(true);

    expect(isValidIanaTimeZone('')).toBe(false);
    expect(isValidIanaTimeZone(' Africa/Accra ')).toBe(false);
    expect(isValidIanaTimeZone('Invalid/Zone')).toBe(false);
    expect(isValidIanaTimeZone('EST')).toBe(false);
    expect(isValidIanaTimeZone('GMT+1')).toBe(false);

    expect(validateReminderLeadDays([7, 3, 1, 0])).toEqual({
      valid: true,
      leadDays: [7, 3, 1, 0],
    });
    expect(validateReminderLeadDays([])).toEqual({
      valid: true,
      leadDays: [],
    });
    expect(validateReminderLeadDays([-1]).valid).toBe(false);
    expect(validateReminderLeadDays([366]).valid).toBe(false);
    expect(validateReminderLeadDays([1.5]).valid).toBe(false);
    expect(validateReminderLeadDays([7, 7]).valid).toBe(false);
    expect(validateReminderLeadDays('invalid').valid).toBe(false);
  });
});
