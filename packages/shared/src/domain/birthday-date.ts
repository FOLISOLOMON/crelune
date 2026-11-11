/**
 * CRELUNE — Pure Civil Birthday Date & Reminder Schedule Engine
 *
 * Strictly uses date-only civil coordinates (`{ year, month, day }`) and calendar
 * day arithmetic. Never relies on host local timezone offsets or 24-hour epoch
 * subtraction, eliminating timezone-shift and DST defects.
 */

export const DEFAULT_TIMEZONE = 'Africa/Accra';
export const DEFAULT_LEAP_DAY_POLICY = 'FEB_28' as const;
export const SUPPORTED_LEAP_DAY_POLICIES = ['FEB_28', 'MAR_1'] as const;
export const DEFAULT_REMINDER_LEAD_DAYS = [7, 3, 1, 0] as const;

export const MIN_BIRTH_YEAR = 1900;

export type LeapDayPolicy = (typeof SUPPORTED_LEAP_DAY_POLICIES)[number];

export interface CivilDate {
  year: number;
  month: number; // 1..12
  day: number; // 1..31
}

export interface BirthdayDateInput {
  birthMonth?: number | null;
  birthDay?: number | null;
  birthYear?: number | null;
}

export interface CelebratedDateResolution {
  date: CivilDate;
  isoDate: string;
  observedDueToLeapPolicy: boolean;
}

export interface NextBirthdayOccurrence {
  targetYear: number;
  celebrationDate: CivilDate;
  celebrationIsoDate: string;
  observedDueToLeapPolicy: boolean;
  daysUntil: number;
  turningAge: number | null;
}

export interface ScheduledReminderDate {
  targetYear: number;
  leadDays: number;
  celebrationDate: CivilDate;
  celebrationIsoDate: string;
  scheduledDate: CivilDate;
  scheduledIsoDate: string;
  observedDueToLeapPolicy: boolean;
}

export type BirthdayValidationResult =
  | { valid: true; hasBirthday: false }
  | {
      valid: true;
      hasBirthday: true;
      birthMonth: number;
      birthDay: number;
      birthYear: number | null;
    }
  | { valid: false; reason: string };

const DAYS_IN_MONTH = [0, 31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] as const;
const MS_PER_DAY = 86_400_000;

/**
 * Standard proleptic Gregorian leap-year rule:
 * divisible by 4, except centuries unless divisible by 400.
 */
export function isLeapYear(year: number): boolean {
  if (!Number.isInteger(year)) {
    throw new RangeError(`Expected integer year, received ${String(year)}`);
  }
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/**
 * Returns the maximum number of valid calendar days in a given month (1..12).
 * When `year` is omitted or null for February, returns 29 so February 29
 * birthdays remain valid when the birth year is unknown.
 */
export function getDaysInMonth(month: number, year?: number | null): number {
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    throw new RangeError(`Invalid calendar month "${String(month)}": expected 1..12`);
  }
  if (month === 2) {
    if (year == null) {
      return 29;
    }
    return isLeapYear(year) ? 29 : 28;
  }
  return DAYS_IN_MONTH[month]!;
}

/**
 * Validates a concrete (month, day, optional year) calendar tuple.
 */
export function isValidCalendarDay(
  month: number,
  day: number,
  year?: number | null
): boolean {
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    return false;
  }
  if (year != null && !Number.isInteger(year)) {
    return false;
  }
  if (!Number.isInteger(day) || day < 1) {
    return false;
  }
  return day <= getDaysInMonth(month, year);
}

/**
 * Validates member birthday inputs according to CRELUNE rules:
 * - Omitted completely (`birthMonth`, `birthDay`, `birthYear` all null/undefined) is valid.
 * - Supplying either `birthMonth`, `birthDay`, or `birthYear` requires both `birthMonth` and `birthDay`.
 * - `birthYear` remains optional (`null` when unknown) and must never be fabricated.
 * - Rejects impossible dates (Feb 30, Apr 31, or Feb 29 paired with a non-leap `birthYear`).
 */
export function validateBirthdayTuple(
  input: BirthdayDateInput,
  options?: { maxBirthYear?: number; timezone?: string }
): BirthdayValidationResult {
  const { birthMonth, birthDay, birthYear } = input;
  const hasMonth = birthMonth !== null && birthMonth !== undefined;
  const hasDay = birthDay !== null && birthDay !== undefined;
  const hasYear = birthYear !== null && birthYear !== undefined;

  if (!hasMonth && !hasDay && !hasYear) {
    return { valid: true, hasBirthday: false };
  }

  if (!hasMonth || !hasDay) {
    return {
      valid: false,
      reason: 'Both birthMonth and birthDay are required when a birthday is supplied.',
    };
  }

  if (!Number.isInteger(birthMonth) || birthMonth < 1 || birthMonth > 12) {
    return {
      valid: false,
      reason: `Invalid birthMonth "${String(birthMonth)}": expected an integer between 1 and 12.`,
    };
  }

  if (hasYear) {
    const maxYear =
      options?.maxBirthYear ?? getTodayCivilDate(options?.timezone ?? DEFAULT_TIMEZONE).year;
    if (!Number.isInteger(birthYear) || birthYear < MIN_BIRTH_YEAR || birthYear > maxYear) {
      return {
        valid: false,
        reason: `Invalid birthYear "${String(birthYear)}": expected an integer between ${MIN_BIRTH_YEAR} and ${maxYear}.`,
      };
    }
  }

  const maxDay = getDaysInMonth(birthMonth, hasYear ? birthYear : null);
  if (!Number.isInteger(birthDay) || birthDay < 1 || birthDay > maxDay) {
    return {
      valid: false,
      reason: hasYear
        ? `Invalid calendar date ${birthMonth}/${birthDay}/${birthYear}.`
        : `Invalid calendar date ${birthMonth}/${birthDay}.`,
    };
  }

  return {
    valid: true,
    hasBirthday: true,
    birthMonth,
    birthDay,
    birthYear: hasYear ? birthYear : null,
  };
}

/**
 * Formats a civil date tuple strictly as `YYYY-MM-DD`.
 */
export function formatCivilDateIso(date: CivilDate): string {
  if (!isValidCalendarDay(date.month, date.day, date.year)) {
    throw new RangeError(
      `Invalid civil date: ${String(date.year)}-${String(date.month)}-${String(date.day)}`
    );
  }
  const y = String(date.year).padStart(4, '0');
  const m = String(date.month).padStart(2, '0');
  const d = String(date.day).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Parses a strict `YYYY-MM-DD` civil date string.
 */
export function parseCivilDateIso(isoDate: string): CivilDate {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate.trim());
  if (!match) {
    throw new RangeError(`Invalid YYYY-MM-DD date string: "${isoDate}"`);
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!isValidCalendarDay(month, day, year)) {
    throw new RangeError(`Non-existent calendar date: "${isoDate}"`);
  }
  return { year, month, day };
}

/**
 * Converts a civil date into a UTC-midnight JS Date for PostgreSQL `@db.Date` storage.
 */
export function civilDateToUtcMidnight(date: CivilDate): Date {
  if (!isValidCalendarDay(date.month, date.day, date.year)) {
    throw new RangeError(
      `Cannot convert invalid civil date ${String(date.year)}-${String(date.month)}-${String(date.day)}`
    );
  }
  return new Date(Date.UTC(date.year, date.month - 1, date.day));
}

/**
 * Reads a PostgreSQL `@db.Date` JS Date strictly using UTC calendar components,
 * preventing host timezone offsets from shifting the calendar day.
 */
export function utcDateOnlyToCivilDate(date: Date): CivilDate {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    throw new RangeError('Expected a valid Date instance.');
  }
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  };
}

/**
 * Pure calendar-day comparison: returns -1 if a < b, 0 if a == b, 1 if a > b.
 */
export function compareCivilDates(a: CivilDate, b: CivilDate): -1 | 0 | 1 {
  if (a.year !== b.year) return a.year < b.year ? -1 : 1;
  if (a.month !== b.month) return a.month < b.month ? -1 : 1;
  if (a.day !== b.day) return a.day < b.day ? -1 : 1;
  return 0;
}

/**
 * Adds an integer number of calendar days to a civil date.
 * Uses pure proleptic Gregorian UTC calendar normalization so host DST changes
 * never introduce 23-hour or 25-hour off-by-one shifts.
 */
export function addCalendarDays(date: CivilDate, deltaDays: number): CivilDate {
  if (!isValidCalendarDay(date.month, date.day, date.year)) {
    throw new RangeError(
      `Invalid civil date: ${String(date.year)}-${String(date.month)}-${String(date.day)}`
    );
  }
  if (!Number.isInteger(deltaDays)) {
    throw new RangeError(`Expected integer deltaDays, received ${String(deltaDays)}`);
  }
  const normalized = new Date(Date.UTC(date.year, date.month - 1, date.day + deltaDays));
  return {
    year: normalized.getUTCFullYear(),
    month: normalized.getUTCMonth() + 1,
    day: normalized.getUTCDate(),
  };
}

/**
 * Returns the exact signed integer calendar day difference (`to - from`).
 */
export function diffCalendarDays(from: CivilDate, to: CivilDate): number {
  const fromMs = civilDateToUtcMidnight(from).getTime();
  const toMs = civilDateToUtcMidnight(to).getTime();
  return Math.round((toMs - fromMs) / MS_PER_DAY);
}

/**
 * Extracts today's civil calendar date in the specified IANA timezone
 * (defaulting to `Africa/Accra`). Immune to host machine timezone.
 */
export function getTodayCivilDate(
  timezone: string = DEFAULT_TIMEZONE,
  now: Date = new Date()
): CivilDate {
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
    throw new RangeError('Expected a valid reference Date instance.');
  }
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = formatter.formatToParts(now);
  const year = Number(parts.find((p) => p.type === 'year')?.value);
  const month = Number(parts.find((p) => p.type === 'month')?.value);
  const day = Number(parts.find((p) => p.type === 'day')?.value);

  if (!isValidCalendarDay(month, day, year)) {
    throw new Error(`Failed to resolve valid civil date in timezone "${timezone}".`);
  }
  return { year, month, day };
}

/**
 * Resolves the celebration civil date in `targetYear` for a member birthday,
 * applying the configured leap-day policy (`FEB_28` default or `MAR_1`) when
 * the member was born on February 29 and `targetYear` is a non-leap year.
 */
export function resolveCelebrationDateForYear(
  birthMonth: number,
  birthDay: number,
  targetYear: number,
  policy: LeapDayPolicy = DEFAULT_LEAP_DAY_POLICY
): CelebratedDateResolution {
  if (!isValidCalendarDay(birthMonth, birthDay, null)) {
    throw new RangeError(`Invalid birthday month/day ${birthMonth}/${birthDay}.`);
  }
  if (!Number.isInteger(targetYear)) {
    throw new RangeError(`Expected integer targetYear, received ${String(targetYear)}`);
  }

  let resolved: CivilDate;
  let observedDueToLeapPolicy = false;

  if (birthMonth === 2 && birthDay === 29 && !isLeapYear(targetYear)) {
    observedDueToLeapPolicy = true;
    resolved =
      policy === 'MAR_1'
        ? { year: targetYear, month: 3, day: 1 }
        : { year: targetYear, month: 2, day: 28 };
  } else {
    resolved = { year: targetYear, month: birthMonth, day: birthDay };
  }

  return {
    date: resolved,
    isoDate: formatCivilDateIso(resolved),
    observedDueToLeapPolicy,
  };
}

/**
 * Finds the next birthday occurrence on or after `referenceDate` (handling
 * December-to-January year transitions and leap-day policy transitions cleanly).
 */
export function getNextBirthdayOccurrence(
  birthday: { birthMonth: number; birthDay: number; birthYear?: number | null },
  referenceDate: CivilDate,
  policy: LeapDayPolicy = DEFAULT_LEAP_DAY_POLICY
): NextBirthdayOccurrence {
  if (!isValidCalendarDay(referenceDate.month, referenceDate.day, referenceDate.year)) {
    throw new RangeError('Invalid reference civil date.');
  }

  const sameYearResolution = resolveCelebrationDateForYear(
    birthday.birthMonth,
    birthday.birthDay,
    referenceDate.year,
    policy
  );

  const targetYear =
    compareCivilDates(sameYearResolution.date, referenceDate) < 0
      ? referenceDate.year + 1
      : referenceDate.year;

  const finalResolution =
    targetYear === referenceDate.year
      ? sameYearResolution
      : resolveCelebrationDateForYear(
          birthday.birthMonth,
          birthday.birthDay,
          targetYear,
          policy
        );

  const turningAge =
    birthday.birthYear != null ? targetYear - birthday.birthYear : null;

  return {
    targetYear,
    celebrationDate: finalResolution.date,
    celebrationIsoDate: finalResolution.isoDate,
    observedDueToLeapPolicy: finalResolution.observedDueToLeapPolicy,
    daysUntil: diffCalendarDays(referenceDate, finalResolution.date),
    turningAge,
  };
}

/**
 * Calculates calendar-date reminder schedules for all configured lead days
 * (default `[7, 3, 1, 0]`). Safely crosses December-to-January year boundaries
 * (e.g. Jan 2 birthday - 7 days -> Dec 26 of previous year) using calendar arithmetic.
 */
export function calculateBirthdayReminderDates(
  birthday: { birthMonth: number; birthDay: number },
  targetYear: number,
  leadDaysList: readonly number[] = DEFAULT_REMINDER_LEAD_DAYS,
  policy: LeapDayPolicy = DEFAULT_LEAP_DAY_POLICY
): ScheduledReminderDate[] {
  const celebration = resolveCelebrationDateForYear(
    birthday.birthMonth,
    birthday.birthDay,
    targetYear,
    policy
  );

  const uniqueLeadDays = Array.from(new Set(leadDaysList)).sort((a, b) => b - a);

  return uniqueLeadDays.map((leadDays) => {
    if (!Number.isInteger(leadDays) || leadDays < 0 || leadDays > 365) {
      throw new RangeError(
        `Invalid reminder leadDays "${String(leadDays)}": expected integer in 0..365.`
      );
    }
    const scheduledDate = addCalendarDays(celebration.date, -leadDays);
    return {
      targetYear,
      leadDays,
      celebrationDate: celebration.date,
      celebrationIsoDate: celebration.isoDate,
      scheduledDate,
      scheduledIsoDate: formatCivilDateIso(scheduledDate),
      observedDueToLeapPolicy: celebration.observedDueToLeapPolicy,
    };
  });
}

/**
 * Deterministic idempotency key matching BirthdayReminder's unique key contract.
 */
export function buildBirthdayReminderIdempotencyKey(
  memberId: string,
  targetYear: number,
  leadDays: number
): string {
  return `bday:${memberId}:${targetYear}:${leadDays}`;
}
