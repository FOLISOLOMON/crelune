/**
 * CRELUNE — Owner Birthday Preferences Validation & Resolution
 *
 * Strictly validates configured IANA timezone, leap-day policy, and reminder intervals.
 * Never silently replaces an invalid configured timezone or corrupted interval list
 * with fallback defaults.
 */

import { Prisma, prisma, type LeapDayPolicy } from '@crelune/database';
import {
  DEFAULT_LEAP_DAY_POLICY,
  DEFAULT_REMINDER_LEAD_DAYS,
  DEFAULT_TIMEZONE,
  SUPPORTED_LEAP_DAY_POLICIES,
  isValidIanaTimeZone,
  validateReminderLeadDays,
} from '@crelune/shared';

export interface ResolvedOwnerBirthdayPreferences {
  timezone: string;
  leapDayPolicy: LeapDayPolicy;
  birthdayReminderDays: number[];
}

export class InvalidBirthdayPreferencesError extends Error {
  public readonly code = 'INVALID_BIRTHDAY_PREFERENCES';

  constructor(message: string) {
    super(message);
    this.name = 'InvalidBirthdayPreferencesError';
  }
}

export interface RawOwnerPreferenceRow {
  timezone: string;
  leapDayPolicy: string;
  birthdayReminderDays: unknown;
}

/**
 * Validates stored preference settings or applies CRELUNE defaults ONLY when
 * no UserPreference row exists yet (`raw === null`).
 */
export function validateAndNormalizeOwnerPreferences(
  raw: RawOwnerPreferenceRow | null
): ResolvedOwnerBirthdayPreferences {
  if (!raw) {
    return {
      timezone: DEFAULT_TIMEZONE,
      leapDayPolicy: DEFAULT_LEAP_DAY_POLICY,
      birthdayReminderDays: [...DEFAULT_REMINDER_LEAD_DAYS],
    };
  }

  if (!isValidIanaTimeZone(raw.timezone)) {
    throw new InvalidBirthdayPreferencesError(
      'Configured owner timezone is not a valid IANA timezone.'
    );
  }

  if (
    !SUPPORTED_LEAP_DAY_POLICIES.includes(
      raw.leapDayPolicy as (typeof SUPPORTED_LEAP_DAY_POLICIES)[number]
    )
  ) {
    throw new InvalidBirthdayPreferencesError(
      'Configured leap-day policy is unsupported.'
    );
  }

  const leadDaysCheck = validateReminderLeadDays(raw.birthdayReminderDays);
  if (!leadDaysCheck.valid) {
    throw new InvalidBirthdayPreferencesError(leadDaysCheck.reason);
  }

  return {
    timezone: raw.timezone,
    leapDayPolicy: raw.leapDayPolicy as LeapDayPolicy,
    birthdayReminderDays: leadDaysCheck.leadDays,
  };
}

type PreferenceReader = Pick<Prisma.TransactionClient, 'userPreference'> | typeof prisma;

export async function loadOwnerBirthdayPreferences(
  db: PreferenceReader,
  ownerUserId: string
): Promise<ResolvedOwnerBirthdayPreferences> {
  const row = await db.userPreference.findUnique({
    where: { userId: ownerUserId },
    select: {
      timezone: true,
      leapDayPolicy: true,
      birthdayReminderDays: true,
    },
  });

  return validateAndNormalizeOwnerPreferences(row);
}

