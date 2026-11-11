/**
 * CRELUNE — Shared Member Directory Validation Schemas & DTO Contracts
 */

import { z } from 'zod';
import {
  DEFAULT_TIMEZONE,
  MIN_BIRTH_YEAR,
  getTodayCivilDate,
  isValidCalendarDay,
  validateBirthdayTuple,
} from '../domain/birthday-date.js';
import { normalizeMemberPhone } from '../domain/member.js';

export const MEMBER_NAME_MAX_LENGTH = 150;
export const MEMBER_PREFERRED_NAME_MAX_LENGTH = 80;
export const MEMBER_PHONE_MAX_LENGTH = 30;
export const MEMBER_EMAIL_MAX_LENGTH = 254;
export const MEMBER_NOTES_MAX_LENGTH = 4000;

export const MEMBER_LIST_DEFAULT_LIMIT = 25;
export const MEMBER_LIST_MAX_LIMIT = 100;

export const MEMBER_STATUS_FILTER_OPTIONS = ['active', 'archived', 'all'] as const;
export type MemberStatusFilter = (typeof MEMBER_STATUS_FILTER_OPTIONS)[number];

export const MEMBER_SORT_OPTIONS = [
  'name_asc',
  'name_desc',
  'birthday_asc',
  'recent',
] as const;
export type MemberSortOption = (typeof MEMBER_SORT_OPTIONS)[number];

export type DuplicateMatchReason = 'PHONE' | 'NAME' | 'PHONE_AND_NAME';

export interface DuplicateCandidateSummary {
  id: string;
  fullName: string;
  preferredName: string | null;
  birthMonth: number | null;
  birthDay: number | null;
  isArchived: boolean;
  matchReason: DuplicateMatchReason;
}

export interface MemberDirectoryItem {
  id: string;
  fullName: string;
  preferredName: string | null;
  birthDay: number | null;
  birthMonth: number | null;
  birthYear: number | null;
  phone: string | null;
  email: string | null;
  hasPhoto: boolean;
  photoUpdatedAt: string | null;
  isActive: boolean;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface MemberDetail extends MemberDirectoryItem {
  notes: string | null;
}

export interface MemberPaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
}

function collapseNameWhitespace(value: string): string {
  return value.normalize('NFKC').trim().replace(/\s+/g, ' ');
}

function emptyToNull(value: string | null | undefined): string | null | undefined {
  if (value === undefined || value === null) return value;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

const fullNameSchema = z
  .string({ required_error: 'Full name is required' })
  .transform(collapseNameWhitespace)
  .refine((val) => val.length >= 1, 'Full name is required')
  .refine(
    (val) => val.length <= MEMBER_NAME_MAX_LENGTH,
    `Full name must not exceed ${MEMBER_NAME_MAX_LENGTH} characters`
  );

const optionalPreferredNameSchema = z
  .string()
  .nullable()
  .optional()
  .transform((val) => {
    if (val === undefined || val === null) return val;
    const cleaned = collapseNameWhitespace(val);
    return cleaned.length === 0 ? null : cleaned;
  })
  .refine(
    (val) => val === undefined || val === null || val.length <= MEMBER_PREFERRED_NAME_MAX_LENGTH,
    `Preferred name must not exceed ${MEMBER_PREFERRED_NAME_MAX_LENGTH} characters`
  );

const optionalPhoneSchema = z
  .string()
  .nullable()
  .optional()
  .transform(emptyToNull)
  .refine(
    (val) => val === undefined || val === null || val.length <= MEMBER_PHONE_MAX_LENGTH,
    `Phone number must not exceed ${MEMBER_PHONE_MAX_LENGTH} characters`
  )
  .refine((val) => {
    if (val === undefined || val === null) return true;
    const normalized = normalizeMemberPhone(val);
    if (!normalized) return false;
    const digitsCount = normalized.startsWith('+') ? normalized.length - 1 : normalized.length;
    return digitsCount >= 7 && digitsCount <= 15;
  }, 'Please enter a valid phone number (7 to 15 digits)');

const optionalEmailSchema = z
  .string()
  .nullable()
  .optional()
  .transform((val) => {
    const cleaned = emptyToNull(val);
    return typeof cleaned === 'string' ? cleaned.toLowerCase() : cleaned;
  })
  .refine(
    (val) => val === undefined || val === null || val.length <= MEMBER_EMAIL_MAX_LENGTH,
    `Email must not exceed ${MEMBER_EMAIL_MAX_LENGTH} characters`
  )
  .refine((val) => {
    if (val === undefined || val === null) return true;
    return z.string().email().safeParse(val).success;
  }, 'Please enter a valid email address');

const optionalNotesSchema = z
  .string()
  .nullable()
  .optional()
  .transform(emptyToNull)
  .refine(
    (val) => val === undefined || val === null || val.length <= MEMBER_NOTES_MAX_LENGTH,
    `Notes must not exceed ${MEMBER_NOTES_MAX_LENGTH} characters`
  );

const nullableBirthMonthSchema = z
  .number()
  .int('Birth month must be a whole number')
  .min(1, 'Birth month must be between 1 and 12')
  .max(12, 'Birth month must be between 1 and 12')
  .nullable()
  .optional();

const nullableBirthDaySchema = z
  .number()
  .int('Birth day must be a whole number')
  .min(1, 'Birth day must be between 1 and 31')
  .max(31, 'Birth day must be between 1 and 31')
  .nullable()
  .optional();

const nullableBirthYearSchema = z
  .number()
  .int('Birth year must be a whole number')
  .min(MIN_BIRTH_YEAR, `Birth year must be ${MIN_BIRTH_YEAR} or later`)
  .refine((year) => {
    const currentYear = getTodayCivilDate(DEFAULT_TIMEZONE).year;
    return year <= currentYear;
  }, 'Birth year cannot be in the future')
  .nullable()
  .optional();

export const memberIdParamSchema = z
  .string()
  .trim()
  .min(1, 'Member ID is required')
  .max(64, 'Member ID is invalid')
  .regex(/^[a-zA-Z0-9_-]+$/, 'Member ID contains unsupported characters');

export const createMemberSchema = z
  .object({
    fullName: fullNameSchema,
    preferredName: optionalPreferredNameSchema,
    birthMonth: nullableBirthMonthSchema,
    birthDay: nullableBirthDaySchema,
    birthYear: nullableBirthYearSchema,
    phone: optionalPhoneSchema,
    email: optionalEmailSchema,
    notes: optionalNotesSchema,
    confirmDuplicate: z.boolean().optional().default(false),
  })
  .strict()
  .superRefine((data, ctx) => {
    const check = validateBirthdayTuple({
      birthMonth: data.birthMonth ?? null,
      birthDay: data.birthDay ?? null,
      birthYear: data.birthYear ?? null,
    });
    if (!check.valid) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['birthDay'],
        message: check.reason,
      });
    }
  });

export type CreateMemberInput = z.infer<typeof createMemberSchema>;

export const updateMemberSchema = z
  .object({
    fullName: fullNameSchema.optional(),
    preferredName: optionalPreferredNameSchema,
    birthMonth: nullableBirthMonthSchema,
    birthDay: nullableBirthDaySchema,
    birthYear: nullableBirthYearSchema,
    phone: optionalPhoneSchema,
    email: optionalEmailSchema,
    notes: optionalNotesSchema,
  })
  .strict()
  .superRefine((data, ctx) => {
    if (Object.keys(data).length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'At least one updatable member field is required.',
      });
      return;
    }

    // Reject impossible partial clearing / setting within the patch payload itself
    if (
      (data.birthMonth === null && data.birthDay !== undefined && data.birthDay !== null) ||
      (data.birthDay === null && data.birthMonth !== undefined && data.birthMonth !== null)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['birthDay'],
        message: 'Birth month and birth day must either both be set or both be cleared.',
      });
      return;
    }

    if (
      data.birthMonth !== undefined &&
      data.birthMonth !== null &&
      data.birthDay !== undefined &&
      data.birthDay !== null
    ) {
      if (!isValidCalendarDay(data.birthMonth, data.birthDay, data.birthYear ?? null)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['birthDay'],
          message: 'Invalid calendar birthday combination.',
        });
      }
    }
  });

export type UpdateMemberInput = z.infer<typeof updateMemberSchema>;

export const memberListQuerySchema = z
  .object({
    q: z
      .string()
      .trim()
      .max(100, 'Search query must not exceed 100 characters')
      .optional()
      .transform((val) => (val && val.length > 0 ? val : undefined)),
    status: z.enum(MEMBER_STATUS_FILTER_OPTIONS).optional().default('active'),
    birthMonth: z
      .preprocess(
        (val) => (val === '' || val === undefined || val === null ? undefined : Number(val)),
        z
          .number()
          .int('Birth month filter must be an integer')
          .min(1, 'Birth month filter must be between 1 and 12')
          .max(12, 'Birth month filter must be between 1 and 12')
          .optional()
      ),
    sort: z.enum(MEMBER_SORT_OPTIONS).optional().default('name_asc'),
    page: z.preprocess(
      (val) => (val === '' || val === undefined || val === null ? 1 : Number(val)),
      z.number().int('Page must be an integer').min(1, 'Page must be at least 1')
    ),
    limit: z.preprocess(
      (val) =>
        val === '' || val === undefined || val === null
          ? MEMBER_LIST_DEFAULT_LIMIT
          : Number(val),
      z
        .number()
        .int('Limit must be an integer')
        .min(1, 'Limit must be at least 1')
        .max(
          MEMBER_LIST_MAX_LIMIT,
          `Limit must not exceed ${MEMBER_LIST_MAX_LIMIT}`
        )
    ),
  })
  .strict();

export type MemberListQuery = z.infer<typeof memberListQuerySchema>;
