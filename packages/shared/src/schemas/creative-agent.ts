import { z } from 'zod';
import { DESIGN_CATEGORIES, type DesignCategory } from '../domain/design-job.js';
import {
  CREATIVE_AGENT_STATUSES,
  CREATIVE_DISPATCH_PUBLICATION_RULE,
  CREATIVE_DISPATCH_STATUSES,
  EXPORT_FILE_FORMATS,
  TEMPLATE_FIELD_TYPES,
  TEMPLATE_FILE_FORMATS,
  TEMPLATE_STUDIO_TYPES,
  type CreativeAgentStatus,
  type CreativeDispatchStatus,
  type ExportFileFormat,
  type TemplateInspectionStatus,
} from '../domain/template.js';
import {
  containsFilesystemPathLiteral,
  idempotencyKeySchema,
  nonFilesystemTextSchema,
  sha256HexSchema,
  type ExportRecordSummary,
} from './template.js';

export const CREATIVE_AGENT_MANIFEST_VERSION = 1 as const;

export const agentSafeRelativeFilenameSchema = z
  .string()
  .trim()
  .min(3)
  .max(180)
  .refine(
    (value) =>
      !value.startsWith('/') &&
      !value.startsWith('\\') &&
      !value.includes('\\') &&
      !value.includes('..') &&
      !containsFilesystemPathLiteral(value),
    {
      message:
        'Manifest filename must be relative without traversal, backslashes, or local drive prefixes.',
    }
  );

export const registerCreativeAgentSchema = z.object({
  name: nonFilesystemTextSchema(80).pipe(z.string().min(2)),
  machineLabel: nonFilesystemTextSchema(80).pipe(z.string().min(2)),
});

export type RegisterCreativeAgentInput = z.infer<typeof registerCreativeAgentSchema>;

export const revokeCreativeAgentSchema = z.object({
  reason: nonFilesystemTextSchema(300).pipe(z.string().min(4)),
});

export type RevokeCreativeAgentInput = z.infer<typeof revokeCreativeAgentSchema>;

export const creativeAgentHeartbeatSchema = z.object({
  agentVersion: nonFilesystemTextSchema(40).pipe(z.string().min(1)),
  affinityVersion: nonFilesystemTextSchema(40).nullable().optional(),
  supportedFormats: z.array(z.enum(TEMPLATE_FILE_FORMATS)).max(10),
  capabilities: z.object({
    canPrepareWorkingCopy: z.boolean(),
    canLaunchAllowlistedAffinity: z.boolean(),
    canUploadVerifiedExports: z.boolean(),
    mcpOptInConfigured: z.boolean().optional(),
  }),
});

export type CreativeAgentHeartbeatInput = z.infer<typeof creativeAgentHeartbeatSchema>;

export const customFieldValuesSchema = z
  .record(
    z
      .string()
      .trim()
      .regex(/^(custom\.[a-z][a-z0-9_]{1,47}|event\.(title|dateDisplay))$/),
    nonFilesystemTextSchema(1000)
  )
  .refine((map) => Object.keys(map).length <= 50, {
    message: 'Too many custom field overrides supplied.',
  });

export const createCreativeJobDispatchSchema = z.object({
  designJobId: z.string().trim().min(1).max(80),
  templateVersionId: z.string().trim().min(1).max(80).optional(),
  assignedAgentId: z.string().trim().min(1).max(80).nullable().optional(),
  idempotencyKey: idempotencyKeySchema,
  exportFormats: z.array(z.enum(EXPORT_FILE_FORMATS)).min(1).max(3).default(['PNG']),
  customFieldValues: customFieldValuesSchema.optional(),
});

export type CreateCreativeJobDispatchInput = z.infer<
  typeof createCreativeJobDispatchSchema
>;

export const creativeManifestFieldValueSchema = z.object({
  fieldKey: z.string().trim().min(3).max(80),
  fieldType: z.enum(TEMPLATE_FIELD_TYPES),
  targetLayerName: nonFilesystemTextSchema(240).pipe(z.string().min(1)),
  layerPath: z
    .array(nonFilesystemTextSchema(240).pipe(z.string().min(1)))
    .max(16)
    .nullable(),
  textValue: nonFilesystemTextSchema(4000).nullable(),
  assetReference: z
    .object({
      assetKind: z.enum(['MEMBER_PHOTO', 'WORKING_ASSET']),
      assetId: z.string().trim().min(1).max(80),
      expectedSha256: sha256HexSchema.nullable(),
      suggestedRelativeFilename: agentSafeRelativeFilenameSchema,
    })
    .nullable(),
});

export type CreativeManifestFieldValue = z.infer<
  typeof creativeManifestFieldValueSchema
>;

const FORBIDDEN_MANIFEST_SECRET_PATTERNS: readonly RegExp[] = [
  /postgres(?:ql)?:\/\//i,
  /x-amz-signature=/i,
  /x-amz-credential=/i,
  /x-amz-security-token=/i,
  /aws_secret_access_key/i,
  /\bbearer\s+[a-z0-9._-]{12,}/i,
  /\bcrelune_session=/i,
  /\bcln_agent_[a-z0-9_-]{8,}/i,
  /\bsession_secret\b/i,
];

export function containsForbiddenManifestSecret(value: unknown): boolean {
  if (typeof value === 'string') {
    return FORBIDDEN_MANIFEST_SECRET_PATTERNS.some((pattern) =>
      pattern.test(value)
    );
  }
  if (Array.isArray(value)) {
    return value.some((item) => containsForbiddenManifestSecret(item));
  }
  if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const lower = k.toLowerCase();
      if (
        lower.includes('presigned') ||
        lower.includes('signedurl') ||
        lower.includes('secret') ||
        lower.includes('password') ||
        lower.includes('bearertoken') ||
        lower.includes('sessiontoken') ||
        lower.includes('storagekey')
      ) {
        return true;
      }
      if (containsForbiddenManifestSecret(v)) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Versioned job preparation manifest (`JobPrepManifest`) used by both the
 * standalone web manual preparation workflow and the authenticated Windows Creative Agent.
 * Deliberately excludes local filesystem paths, database URLs, presigned URLs,
 * session tokens, and storage credentials.
 */
export const creativeJobManifestSchema = z
  .object({
    manifestVersion: z.literal(CREATIVE_AGENT_MANIFEST_VERSION),
    dispatchId: z.string().trim().min(1).max(80),
    designJobId: z.string().trim().min(1).max(80),
    organisationId: z.string().trim().min(1).max(80),
    templateId: z.string().trim().min(1).max(80),
    templateVersionId: z.string().trim().min(1).max(80),
    templateFormat: z.enum(TEMPLATE_FILE_FORMATS),
    templateStudioType: z.enum(TEMPLATE_STUDIO_TYPES),
    templateSha256: sha256HexSchema,
    templateRelativeFilename: agentSafeRelativeFilenameSchema,
    preserveMasterImmutable: z.literal(true),
    publicationRule: z.literal(CREATIVE_DISPATCH_PUBLICATION_RULE),
    outputSpec: z.object({
      formats: z.array(z.enum(EXPORT_FILE_FORMATS)).min(1).max(3),
      targetPlatform: nonFilesystemTextSchema(120).nullable(),
      dimensions: nonFilesystemTextSchema(120).nullable(),
    }),
    fields: z.array(creativeManifestFieldValueSchema).max(100),
    createdAt: z.string().datetime().optional(),
    designJobTitle: nonFilesystemTextSchema(160).optional(),
    designCategory: z.enum(DESIGN_CATEGORIES).optional(),
    templateName: nonFilesystemTextSchema(120).optional(),
    templateVersionNumber: z.number().int().min(1).max(100000).optional(),
    templateByteSize: z.number().int().min(1).optional(),
    requiredText: nonFilesystemTextSchema(4000).nullable().optional(),
    referenceNotes: nonFilesystemTextSchema(4000).nullable().optional(),
    manualModeNotice: nonFilesystemTextSchema(500).optional(),
    preparationInstructions: z
      .array(nonFilesystemTextSchema(300).pipe(z.string().min(1)))
      .max(20)
      .optional(),
  })
  .refine((data) => !containsForbiddenManifestSecret(data), {
    message:
      'Job preparation manifest must not contain credentials, presigned URLs, or private secrets.',
  });

export type CreativeJobManifest = z.infer<typeof creativeJobManifestSchema>;
export const jobPrepManifestSchema = creativeJobManifestSchema;
export type JobPrepManifest = CreativeJobManifest;

export const CREATIVE_EXECUTION_MODES = [
  'MANUAL',
  'ASSISTED',
  'AUTOMATED',
] as const;

export type CreativeExecutionMode = (typeof CREATIVE_EXECUTION_MODES)[number];

export const updateCreativeDispatchStatusSchema = z
  .object({
    status: z.enum(CREATIVE_DISPATCH_STATUSES),
    claimToken: z.string().trim().min(16).max(200).optional(),
    executionMode: z.enum(CREATIVE_EXECUTION_MODES).optional(),
    note: nonFilesystemTextSchema(500).nullable().optional(),
    errorCode: z
      .string()
      .trim()
      .regex(/^[A-Z0-9_]{2,64}$/)
      .nullable()
      .optional(),
    errorMessage: nonFilesystemTextSchema(500).nullable().optional(),
  })
  .superRefine((data, ctx) => {
    if (data.status === 'FAILED' && !data.errorMessage) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['errorMessage'],
        message: 'errorMessage is required when transitioning a dispatch to FAILED.',
      });
    }
  });

export type UpdateCreativeDispatchStatusInput = z.infer<
  typeof updateCreativeDispatchStatusSchema
>;

export interface CreativeAgentSummary {
  id: string;
  name: string;
  machineLabel: string;
  tokenPrefix: string;
  status: CreativeAgentStatus;
  agentVersion: string | null;
  affinityVersion: string | null;
  lastHeartbeatAt: string | null;
  revokedAt: string | null;
  revocationReason: string | null;
  createdAt: string;
}

export interface CreativeJobDispatchSummary {
  id: string;
  designJobId: string;
  templateVersionId: string;
  assignedAgentId: string | null;
  manifestVersion: number;
  status: CreativeDispatchStatus;
  claimedAt: string | null;
  readyForArtistAt: string | null;
  completedAt: string | null;
  failedAt: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PreparationValidationIssue {
  code: string;
  severity: 'ERROR' | 'WARNING';
  fieldKey?: string;
  message: string;
}

export interface DesignJobTemplateBindingSummary {
  templateId: string;
  templateName: string;
  templateCategory: DesignCategory;
  templateStudioType: (typeof TEMPLATE_STUDIO_TYPES)[number];
  templateIsActive: boolean;
  templateVersionId: string;
  versionNumber: number;
  format: (typeof TEMPLATE_FILE_FORMATS)[number];
  originalFilename: string;
  byteSize: number;
  sha256: string;
  widthPx: number | null;
  heightPx: number | null;
  hasPreview: boolean;
  inspectionStatus: TemplateInspectionStatus;
  activeVersionId: string | null;
  isPinnedToOlderVersion: boolean;
}

export interface DesignJobPreparationSnapshot {
  designJobId: string;
  ready: boolean;
  issues: PreparationValidationIssue[];
  warnings: PreparationValidationIssue[];
  binding: DesignJobTemplateBindingSummary | null;
  defaultExportFormats: ExportFileFormat[];
  manifestPreview: JobPrepManifest | null;
  dispatches: CreativeJobDispatchSummary[];
  exports: ExportRecordSummary[];
  hasActiveDispatch: boolean;
  manualFallback: {
    available: boolean;
    manifestDownloadPath: string;
    templateMasterDownloadPath: string | null;
    memberPhotoDownloadPath: string | null;
    notice: string;
  };
}

export { CREATIVE_AGENT_STATUSES };
