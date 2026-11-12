import { z } from 'zod';
import { DESIGN_CATEGORIES } from '../domain/design-job.js';
import {
  CREATIVE_BYTE_LIMITS,
  EXPORT_FILE_FORMATS,
  EXPORT_FORMAT_MIME_TYPES,
  isValidTemplateFieldKey,
  TEMPLATE_FIELD_TYPES,
  TEMPLATE_FILE_FORMATS,
  TEMPLATE_FORMAT_EXTENSIONS,
  TEMPLATE_FORMAT_MIME_TYPES,
  TEMPLATE_PREVIEW_MIME_TYPES,
  TEMPLATE_STUDIO_TYPES,
  type CreativeUploadKind,
  type CreativeUploadStatus,
  type ExportFileFormat,
  type TemplateFieldType,
  type TemplateFileFormat,
  type TemplateInspectionStatus,
  type TemplateStudioType,
} from '../domain/template.js';

const WINDOWS_DRIVE_PATH_REGEX = /(?:^|[\s"'(=])[a-zA-Z]:[\\/]/;
const UNC_PATH_REGEX = /^\\\\[^\\]+\\/;
const UNIX_ABSOLUTE_PATH_REGEX = /(?:^|[\s"'(=])\/(?:Users|home|var|etc|tmp|opt|mnt)\//;
const SHA256_HEX_REGEX = /^[0-9a-f]{64}$/;
const SAFE_IDEMPOTENCY_KEY_REGEX = /^[a-zA-Z0-9._:-]{12,120}$/;

export function containsFilesystemPathLiteral(value: string): boolean {
  return (
    WINDOWS_DRIVE_PATH_REGEX.test(value) ||
    UNC_PATH_REGEX.test(value) ||
    UNIX_ABSOLUTE_PATH_REGEX.test(value) ||
    value.includes('..\\') ||
    value.includes('../') ||
    value.includes('\0')
  );
}

export const nonFilesystemTextSchema = (maxLength: number) =>
  z
    .string()
    .trim()
    .max(maxLength)
    .refine((val) => !containsFilesystemPathLiteral(val), {
      message: 'Value must not contain local filesystem paths or path traversal sequences.',
    });

export const sanitizedTemplateFilenameSchema = z
  .string()
  .trim()
  .min(3)
  .max(180)
  .refine(
    (filename) =>
      !filename.includes('/') &&
      !filename.includes('\\') &&
      !filename.includes('..') &&
      !containsFilesystemPathLiteral(filename),
    {
      message: 'Filename must be a valid basename without directories or traversal.',
    }
  );

export function extractNormalizedFileExtension(filename: string): string | null {
  const trimmed = filename.trim();
  const dotIdx = trimmed.lastIndexOf('.');
  if (dotIdx <= 0 || dotIdx === trimmed.length - 1) {
    return null;
  }
  return trimmed.slice(dotIdx + 1).toLowerCase();
}

export const sha256HexSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(SHA256_HEX_REGEX, 'Expected a 64-character lowercase hex SHA-256 digest.');

export const idempotencyKeySchema = z
  .string()
  .trim()
  .regex(
    SAFE_IDEMPOTENCY_KEY_REGEX,
    'Idempotency key must be 12-120 safe alphanumeric, dot, underscore, colon, or hyphen characters.'
  );

export const createTemplateSchema = z.object({
  name: nonFilesystemTextSchema(120).pipe(z.string().min(2)),
  category: z.enum(DESIGN_CATEGORIES).default('GENERAL_GRAPHIC_DESIGN'),
  studioType: z.enum(TEMPLATE_STUDIO_TYPES),
  description: nonFilesystemTextSchema(500).nullable().optional(),
});

export type CreateTemplateInput = z.infer<typeof createTemplateSchema>;

export const updateTemplateSchema = z
  .object({
    name: nonFilesystemTextSchema(120).pipe(z.string().min(2)).optional(),
    category: z.enum(DESIGN_CATEGORIES).optional(),
    studioType: z.enum(TEMPLATE_STUDIO_TYPES).optional(),
    description: nonFilesystemTextSchema(500).nullable().optional(),
    isActive: z.boolean().optional(),
    activeVersionId: z.string().trim().min(1).max(80).nullable().optional(),
  })
  .refine(
    (payload) =>
      payload.name !== undefined ||
      payload.category !== undefined ||
      payload.studioType !== undefined ||
      payload.description !== undefined ||
      payload.isActive !== undefined ||
      payload.activeVersionId !== undefined,
    { message: 'At least one template field must be provided for update.' }
  );

export type UpdateTemplateInput = z.infer<typeof updateTemplateSchema>;

export const createTemplateVersionUploadIntentSchema = z
  .object({
    templateId: z.string().trim().min(1).max(80),
    format: z.enum(TEMPLATE_FILE_FORMATS),
    originalFilename: sanitizedTemplateFilenameSchema,
    mimeType: z.string().trim().toLowerCase().min(3).max(120),
    byteSize: z
      .number()
      .int()
      .min(1)
      .max(CREATIVE_BYTE_LIMITS.TEMPLATE_MASTER_MAX_BYTES),
    sha256: sha256HexSchema,
    idempotencyKey: idempotencyKeySchema,
  })
  .superRefine((data, ctx) => {
    const ext = extractNormalizedFileExtension(data.originalFilename);
    const allowedExts = TEMPLATE_FORMAT_EXTENSIONS[data.format];
    if (!ext || !allowedExts.includes(ext)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['originalFilename'],
        message: `Filename extension must match ${data.format} (${allowedExts.join(', ')}).`,
      });
    }

    const allowedMimes = TEMPLATE_FORMAT_MIME_TYPES[data.format];
    if (!allowedMimes.includes(data.mimeType)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['mimeType'],
        message: `MIME type "${data.mimeType}" is not permitted for format ${data.format}.`,
      });
    }
  });

export type CreateTemplateVersionUploadIntentInput = z.infer<
  typeof createTemplateVersionUploadIntentSchema
>;

export const createTemplatePreviewUploadIntentSchema = z.object({
  templateId: z.string().trim().min(1).max(80),
  originalFilename: sanitizedTemplateFilenameSchema,
  mimeType: z.enum(TEMPLATE_PREVIEW_MIME_TYPES),
  byteSize: z
    .number()
    .int()
    .min(1)
    .max(CREATIVE_BYTE_LIMITS.TEMPLATE_PREVIEW_MAX_BYTES),
  sha256: sha256HexSchema,
  idempotencyKey: idempotencyKeySchema,
});

export type CreateTemplatePreviewUploadIntentInput = z.infer<
  typeof createTemplatePreviewUploadIntentSchema
>;

export const completeTemplateVersionUploadSchema = z.object({
  uploadIntentId: z.string().trim().min(1).max(80),
  previewUploadIntentId: z.string().trim().min(1).max(80).nullable().optional(),
  widthPx: z.number().int().positive().max(30000).nullable().optional(),
  heightPx: z.number().int().positive().max(30000).nullable().optional(),
  activateImmediately: z.boolean().default(true),
});

export type CompleteTemplateVersionUploadInput = z.infer<
  typeof completeTemplateVersionUploadSchema
>;

export const templateFieldMappingItemSchema = z.object({
  fieldKey: z
    .string()
    .trim()
    .min(3)
    .max(80)
    .refine(isValidTemplateFieldKey, {
      message: 'fieldKey must be a canonical field key or custom.<lowercase_slug>.',
    }),
  fieldType: z.enum(TEMPLATE_FIELD_TYPES),
  targetLayerName: nonFilesystemTextSchema(240).pipe(z.string().min(1)),
  layerPath: z
    .array(nonFilesystemTextSchema(240).pipe(z.string().min(1)))
    .max(16)
    .nullable()
    .optional(),
  isRequired: z.boolean().default(false),
  defaultValue: nonFilesystemTextSchema(1000).nullable().optional(),
  notes: nonFilesystemTextSchema(400).nullable().optional(),
});

export type TemplateFieldMappingInput = z.infer<typeof templateFieldMappingItemSchema>;

export const upsertTemplateFieldMappingsSchema = z
  .object({
    templateVersionId: z.string().trim().min(1).max(80),
    mappings: z.array(templateFieldMappingItemSchema).max(100),
  })
  .superRefine((data, ctx) => {
    const seen = new Set<string>();
    data.mappings.forEach((item, index) => {
      if (seen.has(item.fieldKey)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['mappings', index, 'fieldKey'],
          message: `Duplicate fieldKey "${item.fieldKey}" within the same template version.`,
        });
      }
      seen.add(item.fieldKey);
    });
  });

export type UpsertTemplateFieldMappingsInput = z.infer<
  typeof upsertTemplateFieldMappingsSchema
>;

export const templateListQuerySchema = z.object({
  q: z.string().trim().max(100).optional().default(''),
  category: z.union([z.literal('ALL'), z.enum(DESIGN_CATEGORIES)]).default('ALL'),
  studioType: z
    .union([z.literal('ALL'), z.enum(TEMPLATE_STUDIO_TYPES)])
    .default('ALL'),
  includeArchived: z.coerce.boolean().default(false),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(24),
});

export type TemplateListQuery = z.infer<typeof templateListQuerySchema>;

export const createExportRecordSchema = z
  .object({
    designJobId: z.string().trim().min(1).max(80),
    dispatchId: z.string().trim().min(1).max(80).nullable().optional(),
    uploadIntentId: z.string().trim().min(1).max(80),
    format: z.enum(EXPORT_FILE_FORMATS),
    mimeType: z.string().trim().toLowerCase().min(3).max(120),
    widthPx: z.number().int().positive().max(30000).nullable().optional(),
    heightPx: z.number().int().positive().max(30000).nullable().optional(),
    resolutionDpi: z.number().int().min(72).max(2400).nullable().optional(),
  })
  .superRefine((data, ctx) => {
    const allowedMimes = EXPORT_FORMAT_MIME_TYPES[data.format];
    if (!allowedMimes.includes(data.mimeType)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['mimeType'],
        message: `MIME type "${data.mimeType}" does not match export format ${data.format}.`,
      });
    }
  });

export type CreateExportRecordInput = z.infer<typeof createExportRecordSchema>;

export const approveExportForPublishSchema = z.object({
  isApprovedForPublish: z.boolean(),
});

export type ApproveExportForPublishInput = z.infer<
  typeof approveExportForPublishSchema
>;

export interface TemplateFieldMappingSummary {
  id: string;
  templateVersionId: string;
  fieldKey: string;
  fieldType: TemplateFieldType;
  targetLayerName: string;
  layerPath: string[] | null;
  isRequired: boolean;
  defaultValue: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TemplateVersionSummary {
  id: string;
  templateId: string;
  versionNumber: number;
  format: TemplateFileFormat;
  originalFilename: string;
  mimeType: string;
  byteSize: number;
  sha256: string;
  widthPx: number | null;
  heightPx: number | null;
  hasPreview: boolean;
  inspectionStatus: TemplateInspectionStatus;
  inspectionSummary: string | null;
  inspectedAt: string | null;
  createdAt: string;
}

export interface TemplateSummary {
  id: string;
  name: string;
  category: (typeof DESIGN_CATEGORIES)[number];
  studioType: TemplateStudioType;
  description: string | null;
  isActive: boolean;
  archivedAt: string | null;
  activeVersion: TemplateVersionSummary | null;
  versionCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface TemplateDetail extends TemplateSummary {
  versions: TemplateVersionSummary[];
  activeMappings: TemplateFieldMappingSummary[];
}

export interface CreativeUploadIntentSummary {
  id: string;
  kind: CreativeUploadKind;
  status: CreativeUploadStatus;
  expectedMimeType: string;
  expectedByteSize: number;
  maxAllowedBytes: number;
  expiresAt: string;
  verifiedAt: string | null;
}

export interface ExportRecordSummary {
  id: string;
  designJobId: string;
  dispatchId: string | null;
  format: ExportFileFormat;
  mimeType: string;
  byteSize: number;
  sha256: string;
  widthPx: number | null;
  heightPx: number | null;
  resolutionDpi: number | null;
  isApprovedForPublish: boolean;
  ownerApprovedAt: string | null;
  publishedAt: string | null;
  createdAt: string;
}
