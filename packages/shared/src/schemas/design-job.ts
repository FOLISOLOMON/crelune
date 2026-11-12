/**
 * CRELUNE — Design Job Zod Contracts & DTOs (Milestone 4)
 */

import { z } from 'zod';
import {
  DESIGN_CATEGORIES,
  DESIGN_JOB_STATUSES,
  DESIGN_PRIORITIES,
  type DesignCategory,
  type DesignJobStatus,
  type DesignPriority,
} from '../domain/design-job.js';
import { parseCivilDateIso } from '../domain/birthday-date.js';
import { memberIdParamSchema } from './member.js';

export const DESIGN_JOB_TITLE_MAX_LENGTH = 160;
export const DESIGN_JOB_TEXT_MAX_LENGTH = 4000;
export const DESIGN_JOB_SHORT_FIELD_MAX_LENGTH = 120;
export const DESIGN_JOB_NOTE_MAX_LENGTH = 2000;
export const DESIGN_JOB_LIST_DEFAULT_LIMIT = 25;
export const DESIGN_JOB_LIST_MAX_LIMIT = 100;

export const designJobIdParamSchema = memberIdParamSchema;

function preprocessOptionalTrimmedString(maxLength: number, fieldLabel: string) {
  return z.preprocess(
    (val) => {
      if (val === undefined) return undefined;
      if (val === null) return null;
      if (typeof val === 'string') {
        const trimmed = val.trim();
        return trimmed.length === 0 ? null : trimmed;
      }
      return val;
    },
    z
      .string()
      .max(maxLength, `${fieldLabel} must not exceed ${maxLength} characters`)
      .nullable()
      .optional()
  );
}

const optionalCivilDateSchema = z.preprocess(
  (val) => {
    if (val === undefined) return undefined;
    if (val === null) return null;
    if (typeof val === 'string') {
      const trimmed = val.trim();
      return trimmed.length === 0 ? null : trimmed;
    }
    return val;
  },
  z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Due date must use YYYY-MM-DD format')
    .refine((value) => {
      try {
        parseCivilDateIso(value);
        return true;
      } catch {
        return false;
      }
    }, 'Due date is not a valid calendar date')
    .nullable()
    .optional()
);

const optionalMemberIdSchema = z.preprocess(
  (val) => {
    if (val === undefined) return undefined;
    if (val === null || val === '') return null;
    return val;
  },
  memberIdParamSchema.nullable().optional()
);

const optionalBirthdayTargetYearSchema = z
  .number()
  .int('Birthday target year must be a whole number')
  .min(2000, 'Birthday target year is out of range')
  .max(2200, 'Birthday target year is out of range')
  .nullable()
  .optional();

export const createDesignJobSchema = z
  .object({
    title: z
      .string()
      .trim()
      .min(1, 'Design title is required')
      .max(
        DESIGN_JOB_TITLE_MAX_LENGTH,
        `Design title must not exceed ${DESIGN_JOB_TITLE_MAX_LENGTH} characters`
      ),
    category: z.enum(DESIGN_CATEGORIES).default('GENERAL_GRAPHIC_DESIGN'),
    priority: z.enum(DESIGN_PRIORITIES).default('NORMAL'),
    initialStatus: z.enum(['DRAFT', 'PENDING']).default('DRAFT'),
    memberId: optionalMemberIdSchema,
    birthdayTargetYear: optionalBirthdayTargetYearSchema,
    requiredText: preprocessOptionalTrimmedString(
      DESIGN_JOB_TEXT_MAX_LENGTH,
      'Required text'
    ),
    dimensions: preprocessOptionalTrimmedString(
      DESIGN_JOB_SHORT_FIELD_MAX_LENGTH,
      'Dimensions'
    ),
    targetPlatform: preprocessOptionalTrimmedString(
      DESIGN_JOB_SHORT_FIELD_MAX_LENGTH,
      'Target platform'
    ),
    preferredTemplateNote: preprocessOptionalTrimmedString(
      DESIGN_JOB_SHORT_FIELD_MAX_LENGTH,
      'Preferred template'
    ),
    templateId: optionalMemberIdSchema,
    templateVersionId: optionalMemberIdSchema,
    referenceNotes: preprocessOptionalTrimmedString(
      DESIGN_JOB_TEXT_MAX_LENGTH,
      'Reference notes'
    ),
    notes: preprocessOptionalTrimmedString(
      DESIGN_JOB_NOTE_MAX_LENGTH,
      'Design notes'
    ),
    dueDate: optionalCivilDateSchema,
  })
  .strict()
  .superRefine((data, ctx) => {
    if (data.category === 'BIRTHDAY_FLYER') {
      if (!data.memberId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['memberId'],
          message: 'A linked member is required for birthday flyer jobs.',
        });
      }
      if (data.birthdayTargetYear === undefined || data.birthdayTargetYear === null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['birthdayTargetYear'],
          message: 'A birthday target year is required for birthday flyer jobs.',
        });
      }
      return;
    }

    if (data.birthdayTargetYear !== undefined && data.birthdayTargetYear !== null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['birthdayTargetYear'],
        message: 'Birthday target year is only allowed for birthday flyer jobs.',
      });
    }
  });

export type CreateDesignJobInput = z.infer<typeof createDesignJobSchema>;

export const updateDesignJobSchema = z
  .object({
    title: z
      .string()
      .trim()
      .min(1, 'Design title is required')
      .max(
        DESIGN_JOB_TITLE_MAX_LENGTH,
        `Design title must not exceed ${DESIGN_JOB_TITLE_MAX_LENGTH} characters`
      )
      .optional(),
    category: z.enum(DESIGN_CATEGORIES).optional(),
    priority: z.enum(DESIGN_PRIORITIES).optional(),
    memberId: optionalMemberIdSchema,
    birthdayTargetYear: optionalBirthdayTargetYearSchema,
    requiredText: preprocessOptionalTrimmedString(
      DESIGN_JOB_TEXT_MAX_LENGTH,
      'Required text'
    ),
    dimensions: preprocessOptionalTrimmedString(
      DESIGN_JOB_SHORT_FIELD_MAX_LENGTH,
      'Dimensions'
    ),
    targetPlatform: preprocessOptionalTrimmedString(
      DESIGN_JOB_SHORT_FIELD_MAX_LENGTH,
      'Target platform'
    ),
    preferredTemplateNote: preprocessOptionalTrimmedString(
      DESIGN_JOB_SHORT_FIELD_MAX_LENGTH,
      'Preferred template'
    ),
    templateId: optionalMemberIdSchema,
    templateVersionId: optionalMemberIdSchema,
    referenceNotes: preprocessOptionalTrimmedString(
      DESIGN_JOB_TEXT_MAX_LENGTH,
      'Reference notes'
    ),
    notes: preprocessOptionalTrimmedString(
      DESIGN_JOB_NOTE_MAX_LENGTH,
      'Design notes'
    ),
    dueDate: optionalCivilDateSchema,
  })
  .strict()
  .superRefine((data, ctx) => {
    if (Object.keys(data).length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'At least one design job field must be updated.',
      });
    }

    if (data.category === 'BIRTHDAY_FLYER') {
      if (data.memberId === null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['memberId'],
          message: 'A linked member is required for birthday flyer jobs.',
        });
      }
      if (data.birthdayTargetYear === null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['birthdayTargetYear'],
          message: 'A birthday target year is required for birthday flyer jobs.',
        });
      }
    } else if (
      data.category !== undefined &&
      data.birthdayTargetYear !== undefined &&
      data.birthdayTargetYear !== null
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['birthdayTargetYear'],
        message: 'Birthday target year is only allowed for birthday flyer jobs.',
      });
    } else if (
      data.birthdayTargetYear !== undefined &&
      data.birthdayTargetYear !== null &&
      data.memberId === null
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['memberId'],
        message: 'A linked member is required when specifying a birthday target year.',
      });
    }
  });

export type UpdateDesignJobInput = z.infer<typeof updateDesignJobSchema>;

export const transitionDesignJobSchema = z
  .object({
    status: z.enum(DESIGN_JOB_STATUSES),
    note: preprocessOptionalTrimmedString(
      DESIGN_JOB_NOTE_MAX_LENGTH,
      'Transition note'
    ),
  })
  .strict();

export type TransitionDesignJobInput = z.infer<typeof transitionDesignJobSchema>;

export const designJobListQuerySchema = z
  .object({
    q: z.preprocess(
      (val) => {
        if (typeof val !== 'string') return undefined;
        const trimmed = val.trim();
        return trimmed.length === 0 ? undefined : trimmed;
      },
      z.string().max(120, 'Search query is too long').optional()
    ),
    status: z
      .enum([
        'all',
        'active',
        ...DESIGN_JOB_STATUSES,
      ])
      .default('active'),
    category: z.enum(['ALL', ...DESIGN_CATEGORIES]).default('ALL'),
    priority: z.enum(['ALL', ...DESIGN_PRIORITIES]).default('ALL'),
    memberId: optionalMemberIdSchema,
    page: z.preprocess(
      (val) => (val === '' || val === undefined || val === null ? 1 : Number(val)),
      z.number().int().min(1)
    ),
    limit: z.preprocess(
      (val) =>
        val === '' || val === undefined || val === null
          ? DESIGN_JOB_LIST_DEFAULT_LIMIT
          : Number(val),
      z.number().int().min(1).max(DESIGN_JOB_LIST_MAX_LIMIT)
    ),
  })
  .strict();

export type DesignJobListQuery = z.infer<typeof designJobListQuerySchema>;

export interface LinkedMemberSummary {
  id: string;
  fullName: string;
  preferredName: string | null;
  hasPhoto: boolean;
  photoUpdatedAt: string | null;
  isActive: boolean;
}

export interface DesignJobSummary {
  id: string;
  title: string;
  category: DesignCategory;
  status: DesignJobStatus;
  priority: DesignPriority;
  memberId: string | null;
  member: LinkedMemberSummary | null;
  birthdayTargetYear: number | null;
  templateId?: string | null;
  templateVersionId?: string | null;
  targetPlatform: string | null;
  dimensions: string | null;
  dueDate: string | null;
  approvedAt: string | null;
  exportedAt: string | null;
  publishedAt: string | null;
  cancelledAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DesignJobHistoryEntry {
  id: string;
  previousStatus: DesignJobStatus | null;
  newStatus: DesignJobStatus;
  note: string | null;
  changedByName: string | null;
  createdAt: string;
}

export interface DesignJobDetail extends DesignJobSummary {
  requiredText: string | null;
  preferredTemplateNote: string | null;
  referenceNotes: string | null;
  notes: string | null;
  history: DesignJobHistoryEntry[];
}

