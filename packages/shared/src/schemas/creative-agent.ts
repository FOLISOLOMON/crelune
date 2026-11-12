import { z } from 'zod';
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
} from '../domain/template.js';
import {
  containsFilesystemPathLiteral,
  idempotencyKeySchema,
  nonFilesystemTextSchema,
  sha256HexSchema,
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
  }),
});

export type CreativeAgentHeartbeatInput = z.infer<typeof creativeAgentHeartbeatSchema>;

export const createCreativeJobDispatchSchema = z.object({
  designJobId: z.string().trim().min(1).max(80),
  templateVersionId: z.string().trim().min(1).max(80).optional(),
  assignedAgentId: z.string().trim().min(1).max(80).nullable().optional(),
  idempotencyKey: idempotencyKeySchema,
  exportFormats: z.array(z.enum(EXPORT_FILE_FORMATS)).min(1).max(3).default(['PNG']),
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

/**
 * Versioned job manifest sent to an authenticated local Windows Creative Agent.
 * Deliberately excludes local filesystem paths, secret storage credentials, and S3 signing keys.
 */
export const creativeJobManifestSchema = z.object({
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
});

export type CreativeJobManifest = z.infer<typeof creativeJobManifestSchema>;

export const updateCreativeDispatchStatusSchema = z
  .object({
    status: z.enum(CREATIVE_DISPATCH_STATUSES),
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

export { CREATIVE_AGENT_STATUSES };

