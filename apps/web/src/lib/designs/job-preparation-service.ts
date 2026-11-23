/**
 * CRELUNE — Creative Job Preparation, Manifest Generation & Export Service (Stage 5.4)
 *
 * Bridges Design Management (`DesignJob`) with immutable Template Versions,
 * field mappings, versioned `JobPrepManifest` contracts, manual preparation
 * fallbacks, and verified deliverable (`ExportRecord`) intake.
 *
 * Core Invariants:
 * - Never silently substitutes an active template version for an already pinned version.
 * - Never fabricates missing required fields, birth years, or member photographs.
 * - Never embeds credentials, presigned URLs, storage keys, or session secrets in manifests.
 * - Keeps `EXPORTED` and `PUBLISHED` strictly separate across both manual and agent paths.
 */

import crypto from 'node:crypto';
import sharp from 'sharp';
import { Prisma, prisma } from '@crelune/database';
import {
  ACTIVE_CREATIVE_DISPATCH_STATUSES,
  CREATIVE_AGENT_MANIFEST_VERSION,
  CREATIVE_BYTE_LIMITS,
  CREATIVE_DISPATCH_PUBLICATION_RULE,
  EXPORT_FILE_FORMATS,
  canTransitionCreativeDispatchStatus,
  canTransitionDesignJobStatus,
  containsForbiddenManifestSecret,
  creativeJobManifestSchema,
  type ApproveExportForPublishInput,
  type CreateCreativeJobDispatchInput,
  type CreateExportRecordInput,
  type CreateExportUploadIntentInput,
  type CreativeDispatchStatus,
  type CreativeJobDispatchSummary,
  type CreativeManifestFieldValue,
  type CreativeUploadIntentSummary,
  type DesignCategory,
  type DesignJobPreparationSnapshot,
  type DesignJobStatus,
  type DesignJobTemplateBindingSummary,
  type ExportFileFormat,
  type ExportRecordSummary,
  type JobPrepManifest,
  type PreparationValidationIssue,
  type PresignedUploadTarget,
  type RecoverCreativeJobDispatchInput,
  type TemplateFileFormat,
  type TemplateInspectionStatus,
  type TemplateStudioType,
} from '@crelune/shared';
import * as auditService from '@/lib/audit/audit-service';
import { loadOwnerBirthdayPreferences } from '@/lib/birthdays/birthday-preferences';
import {
  DesignJobNotFoundError,
  DesignJobValidationError,
  type DesignActorContext,
} from '@/lib/designs/design-job-service';
import {
  CreativeObjectTooLargeError,
  createCreativeObjectStorageProvider,
  type CreativeObjectStorageProvider,
} from '@/lib/storage/creative-storage';
import {
  assertKeyMatchesExportDeliverableScope,
  assertKeyMatchesTemplateMasterScope,
  buildExportDeliverableObjectKey,
  type CreativeExportExtension,
} from '@/lib/storage/storage-config';

export class DispatchNotFoundError extends Error {
  constructor() {
    super('Creative job dispatch not found.');
    this.name = 'DispatchNotFoundError';
  }
}

export class ExportRecordNotFoundError extends Error {
  constructor() {
    super('Export deliverable record not found.');
    this.name = 'ExportRecordNotFoundError';
  }
}

export class JobPreparationValidationError extends Error {
  public readonly code: string;
  public readonly issues: PreparationValidationIssue[];

  constructor(
    message: string,
    issues: PreparationValidationIssue[] = [],
    code: string = 'JOB_PREPARATION_INVALID'
  ) {
    super(message);
    this.name = 'JobPreparationValidationError';
    this.code = code;
    this.issues = issues;
  }
}

export class JobPreparationConflictError extends Error {
  public readonly code: string;

  constructor(message: string, code: string = 'JOB_PREPARATION_CONFLICT') {
    super(message);
    this.name = 'JobPreparationConflictError';
    this.code = code;
  }
}

export interface JobPreparationServiceDependencies {
  storage?: CreativeObjectStorageProvider;
  now?: () => Date;
}

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

const MANUAL_MODE_NOTICE =
  'CRELUNE prepares validated manifests and pinned master files without automatically modifying Affinity documents in the browser. Verify layers and complete creative adjustments in Affinity 3.3 before exporting.';

function formatBirthdayDisplay(
  birthMonth: number | null,
  birthDay: number | null
): string | null {
  if (birthMonth === null || birthDay === null) {
    return null;
  }
  const monthName = MONTH_NAMES[birthMonth - 1];
  if (!monthName) return null;
  // Intentionally omits birth year so unknown years are never fabricated.
  return `${birthDay} ${monthName}`;
}

function splitMemberName(fullName: string, preferredName: string | null): {
  firstName: string;
  lastName: string | null;
} {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  const firstName = preferredName?.trim() || parts[0] || fullName.trim();
  const lastName = parts.length > 1 ? parts.slice(1).join(' ') : null;
  return { firstName, lastName };
}

function sanitizeSafeSlugFilename(
  originalFilename: string,
  fallbackBase: string,
  extension: string
): string {
  const withoutExt = originalFilename.replace(/\.[^/.]+$/, '');
  const clean = withoutExt
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return `${clean || fallbackBase}.${extension.toLowerCase()}`;
}

function extensionFromMimeType(mimeType: string | null): string {
  switch (mimeType?.toLowerCase()) {
    case 'image/png':
      return 'png';
    case 'image/webp':
      return 'webp';
    case 'image/jpeg':
    default:
      return 'jpg';
  }
}

function exportExtensionFromFormat(format: ExportFileFormat): CreativeExportExtension {
  switch (format) {
    case 'PNG':
      return 'png';
    case 'JPEG':
      return 'jpg';
    case 'PDF':
      return 'pdf';
  }
}

function parseDefaultExportFormats(rawDefault?: string | null): ExportFileFormat[] {
  const upper = (rawDefault ?? 'PNG').toUpperCase();
  if ((EXPORT_FILE_FORMATS as readonly string[]).includes(upper)) {
    return [upper as ExportFileFormat];
  }
  return ['PNG'];
}

function mapDispatchSummary(
  row: {
    id: string;
    designJobId: string;
    templateVersionId: string;
    assignedAgentId: string | null;
    manifestVersion: number;
    status: string;
    claimedAt: Date | null;
    leaseExpiresAt?: Date | null;
    readyForArtistAt: Date | null;
    completedAt: Date | null;
    failedAt: Date | null;
    errorCode: string | null;
    errorMessage: string | null;
    assignedAgent?: { status: string } | null;
    createdAt: Date;
    updatedAt: Date;
  },
  now: Date = new Date()
): CreativeJobDispatchSummary {
  const status = row.status as CreativeDispatchStatus;
  let requiresOwnerIntervention = false;
  let interventionReason: string | null = null;

  if (status === 'READY_FOR_ARTIST') {
    if (
      row.errorCode === 'AGENT_REVOKED_INTERVENTION_REQUIRED' ||
      row.assignedAgent?.status === 'REVOKED'
    ) {
      requiresOwnerIntervention = true;
      interventionReason =
        row.errorMessage ??
        'Assigned agent was revoked while artist edits may be in progress. Review local work and either upload export manually, cancel, or explicitly release for recovery.';
    } else if (!row.leaseExpiresAt || row.leaseExpiresAt <= now) {
      requiresOwnerIntervention = true;
      interventionReason =
        'Artist workspace lease expired. Existing local edits are preserved and will not be overwritten automatically; upload export manually, cancel, or explicitly release for recovery.';
    }
  }

  return {
    id: row.id,
    designJobId: row.designJobId,
    templateVersionId: row.templateVersionId,
    assignedAgentId: row.assignedAgentId,
    manifestVersion: row.manifestVersion,
    status,
    claimedAt: row.claimedAt ? row.claimedAt.toISOString() : null,
    leaseExpiresAt: row.leaseExpiresAt ? row.leaseExpiresAt.toISOString() : null,
    readyForArtistAt: row.readyForArtistAt
      ? row.readyForArtistAt.toISOString()
      : null,
    completedAt: row.completedAt ? row.completedAt.toISOString() : null,
    failedAt: row.failedAt ? row.failedAt.toISOString() : null,
    errorCode: row.errorCode,
    errorMessage: row.errorMessage,
    requiresOwnerIntervention,
    interventionReason,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function mapExportRecordSummary(row: {
  id: string;
  designJobId: string;
  dispatchId: string | null;
  format: string;
  mimeType: string;
  byteSize: number;
  sha256: string;
  widthPx: number | null;
  heightPx: number | null;
  resolutionDpi: number | null;
  isApprovedForPublish: boolean;
  ownerApprovedAt: Date | null;
  publishedAt: Date | null;
  createdAt: Date;
}): ExportRecordSummary {
  return {
    id: row.id,
    designJobId: row.designJobId,
    dispatchId: row.dispatchId,
    format: row.format as ExportFileFormat,
    mimeType: row.mimeType,
    byteSize: row.byteSize,
    sha256: row.sha256,
    widthPx: row.widthPx,
    heightPx: row.heightPx,
    resolutionDpi: row.resolutionDpi,
    isApprovedForPublish: row.isApprovedForPublish,
    ownerApprovedAt: row.ownerApprovedAt
      ? row.ownerApprovedAt.toISOString()
      : null,
    publishedAt: row.publishedAt ? row.publishedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  };
}

interface LoadedJobForPreparation {
  id: string;
  organisationId: string;
  title: string;
  category: string;
  status: string;
  requiredText: string | null;
  dimensions: string | null;
  targetPlatform: string | null;
  referenceNotes: string | null;
  notes: string | null;
  templateId: string | null;
  templateVersionId: string | null;
  member: {
    id: string;
    fullName: string;
    preferredName: string | null;
    birthMonth: number | null;
    birthDay: number | null;
    photoStorageKey: string | null;
    photoMimeType: string | null;
    archivedAt: Date | null;
  } | null;
  template: {
    id: string;
    name: string;
    category: string;
    studioType: string;
    isActive: boolean;
    archivedAt: Date | null;
    activeVersionId: string | null;
  } | null;
  templateVersion: {
    id: string;
    versionNumber: number;
    format: string;
    storageKey: string;
    storageBucket: string;
    originalFilename: string;
    mimeType: string;
    byteSize: number;
    sha256: string;
    widthPx: number | null;
    heightPx: number | null;
    previewStorageKey: string | null;
    inspectionStatus: string;
    fieldMappings: Array<{
      id: string;
      fieldKey: string;
      fieldType: string;
      targetLayerName: string;
      layerPathJson: Prisma.JsonValue | null;
      isRequired: boolean;
      defaultValue: string | null;
      notes: string | null;
    }>;
  } | null;
  creativeDispatches: Array<{
    id: string;
    designJobId: string;
    templateVersionId: string;
    assignedAgentId: string | null;
    manifestVersion: number;
    status: string;
    claimedAt: Date | null;
    readyForArtistAt: Date | null;
    completedAt: Date | null;
    failedAt: Date | null;
    errorCode: string | null;
    errorMessage: string | null;
    createdAt: Date;
    updatedAt: Date;
  }>;
  exportRecords: Array<{
    id: string;
    designJobId: string;
    dispatchId: string | null;
    format: string;
    mimeType: string;
    byteSize: number;
    sha256: string;
    widthPx: number | null;
    heightPx: number | null;
    resolutionDpi: number | null;
    isApprovedForPublish: boolean;
    ownerApprovedAt: Date | null;
    publishedAt: Date | null;
    createdAt: Date;
  }>;
}

const PREPARATION_JOB_SELECT = {
  id: true,
  organisationId: true,
  title: true,
  category: true,
  status: true,
  requiredText: true,
  dimensions: true,
  targetPlatform: true,
  referenceNotes: true,
  notes: true,
  templateId: true,
  templateVersionId: true,
  member: {
    select: {
      id: true,
      fullName: true,
      preferredName: true,
      birthMonth: true,
      birthDay: true,
      photoStorageKey: true,
      photoMimeType: true,
      archivedAt: true,
    },
  },
  template: {
    select: {
      id: true,
      name: true,
      category: true,
      studioType: true,
      isActive: true,
      archivedAt: true,
      activeVersionId: true,
    },
  },
  templateVersion: {
    select: {
      id: true,
      versionNumber: true,
      format: true,
      storageKey: true,
      storageBucket: true,
      originalFilename: true,
      mimeType: true,
      byteSize: true,
      sha256: true,
      widthPx: true,
      heightPx: true,
      previewStorageKey: true,
      inspectionStatus: true,
      fieldMappings: {
        orderBy: { fieldKey: 'asc' },
        select: {
          id: true,
          fieldKey: true,
          fieldType: true,
          targetLayerName: true,
          layerPathJson: true,
          isRequired: true,
          defaultValue: true,
          notes: true,
        },
      },
    },
  },
  creativeDispatches: {
    orderBy: [{ createdAt: 'desc' }],
    take: 20,
    select: {
      id: true,
      designJobId: true,
      templateVersionId: true,
      assignedAgentId: true,
      manifestVersion: true,
      status: true,
      claimedAt: true,
      leaseExpiresAt: true,
      readyForArtistAt: true,
      completedAt: true,
      failedAt: true,
      errorCode: true,
      errorMessage: true,
      assignedAgent: {
        select: {
          status: true,
        },
      },
      createdAt: true,
      updatedAt: true,
    },
  },
  exportRecords: {
    orderBy: [{ createdAt: 'desc' }],
    take: 20,
    select: {
      id: true,
      designJobId: true,
      dispatchId: true,
      format: true,
      mimeType: true,
      byteSize: true,
      sha256: true,
      widthPx: true,
      heightPx: true,
      resolutionDpi: true,
      isApprovedForPublish: true,
      ownerApprovedAt: true,
      publishedAt: true,
      createdAt: true,
    },
  },
} satisfies Prisma.DesignJobSelect;

function buildBindingSummary(
  job: LoadedJobForPreparation
): DesignJobTemplateBindingSummary | null {
  if (!job.template || !job.templateVersion) {
    return null;
  }
  return {
    templateId: job.template.id,
    templateName: job.template.name,
    templateCategory: job.template.category as DesignCategory,
    templateStudioType: job.template.studioType as TemplateStudioType,
    templateIsActive:
      job.template.isActive && job.template.archivedAt === null,
    templateVersionId: job.templateVersion.id,
    versionNumber: job.templateVersion.versionNumber,
    format: job.templateVersion.format as TemplateFileFormat,
    originalFilename: job.templateVersion.originalFilename,
    byteSize: job.templateVersion.byteSize,
    sha256: job.templateVersion.sha256,
    widthPx: job.templateVersion.widthPx ?? null,
    heightPx: job.templateVersion.heightPx ?? null,
    hasPreview: Boolean(job.templateVersion.previewStorageKey),
    inspectionStatus: job.templateVersion
      .inspectionStatus as TemplateInspectionStatus,
    activeVersionId: job.template.activeVersionId ?? null,
    isPinnedToOlderVersion:
      Boolean(job.template.activeVersionId) &&
      job.template.activeVersionId !== job.templateVersion.id,
  };
}

function resolveFieldsAndManifest(params: {
  job: LoadedJobForPreparation;
  dispatchId: string;
  exportFormats: ExportFileFormat[];
  customFieldValues?: Record<string, string>;
  now: Date;
}): {
  ready: boolean;
  issues: PreparationValidationIssue[];
  warnings: PreparationValidationIssue[];
  manifest: JobPrepManifest | null;
} {
  const { job, dispatchId, exportFormats, customFieldValues, now } = params;
  const issues: PreparationValidationIssue[] = [];
  const warnings: PreparationValidationIssue[] = [];

  if (job.status === 'PUBLISHED' || job.status === 'CANCELLED') {
    issues.push({
      code: 'JOB_TERMINAL_STATUS',
      severity: 'ERROR',
      message: `Cannot prepare creative job while status is ${job.status}.`,
    });
  }

  if (!job.templateId || !job.template) {
    issues.push({
      code: 'NO_TEMPLATE_BOUND',
      severity: 'ERROR',
      message: 'Select a registered template before preparing this design job.',
    });
  }

  if (!job.templateVersionId || !job.templateVersion) {
    issues.push({
      code: 'NO_TEMPLATE_VERSION_PINNED',
      severity: 'ERROR',
      message:
        'Pin an exact immutable template version before preparing this design job.',
    });
  }

  if (!job.template || !job.templateVersion) {
    return { ready: false, issues, warnings, manifest: null };
  }

  if (!job.template.isActive || job.template.archivedAt !== null) {
    warnings.push({
      code: 'TEMPLATE_ARCHIVED',
      severity: 'WARNING',
      message:
        'This job is pinned to an archived template. Historical preparation remains traceable, but consider restoring or choosing an active template for new work.',
    });
  }

  if (
    job.template.activeVersionId &&
    job.template.activeVersionId !== job.templateVersion.id
  ) {
    warnings.push({
      code: 'PINNED_OLDER_VERSION',
      severity: 'WARNING',
      message: `This job remains strictly pinned to v${job.templateVersion.versionNumber} even though a newer active template version exists.`,
    });
  }

  if (job.templateVersion.inspectionStatus === 'MANUAL_REQUIRED') {
    warnings.push({
      code: 'MANUAL_INSPECTION_REQUIRED',
      severity: 'WARNING',
      message:
        'Layer names and editability on this template version are manually maintained and must be verified inside Affinity 3.3.',
    });
  }

  if (job.templateVersion.fieldMappings.length === 0) {
    warnings.push({
      code: 'NO_FIELD_MAPPINGS',
      severity: 'WARNING',
      message:
        'No field mappings are configured for this template version. The artist will place text and images manually in Affinity.',
    });
  }

  const resolvedFields: CreativeManifestFieldValue[] = [];

  for (const mapping of job.templateVersion.fieldMappings) {
    const layerPath = Array.isArray(mapping.layerPathJson)
      ? (mapping.layerPathJson.filter(
          (seg): seg is string => typeof seg === 'string' && seg.trim().length > 0
        ) as string[])
      : null;

    if (mapping.fieldKey === 'member.photo') {
      if (job.member && job.member.photoStorageKey) {
        const photoExt = extensionFromMimeType(job.member.photoMimeType);
        resolvedFields.push({
          fieldKey: mapping.fieldKey,
          fieldType: mapping.fieldType as CreativeManifestFieldValue['fieldType'],
          targetLayerName: mapping.targetLayerName,
          layerPath,
          textValue: null,
          assetReference: {
            assetKind: 'MEMBER_PHOTO',
            assetId: job.member.id,
            expectedSha256: null,
            suggestedRelativeFilename: `assets/member-photo-${job.member.id}.${photoExt}`,
          },
        });
      } else {
        const message = !job.member
          ? 'Template expects a member photograph (member.photo), but no member is linked to this job.'
          : 'Linked member does not have an uploaded profile photograph.';
        if (mapping.isRequired) {
          issues.push({
            code: 'MISSING_REQUIRED_ASSET',
            severity: 'ERROR',
            fieldKey: mapping.fieldKey,
            message,
          });
        } else {
          warnings.push({
            code: 'OPTIONAL_ASSET_MISSING',
            severity: 'WARNING',
            fieldKey: mapping.fieldKey,
            message,
          });
        }
        resolvedFields.push({
          fieldKey: mapping.fieldKey,
          fieldType: mapping.fieldType as CreativeManifestFieldValue['fieldType'],
          targetLayerName: mapping.targetLayerName,
          layerPath,
          textValue: null,
          assetReference: null,
        });
      }
      continue;
    }

    if (mapping.fieldType === 'IMAGE' && mapping.fieldKey !== 'member.photo') {
      const message = `Image field "${mapping.fieldKey}" requires general working-asset delivery, which is not supported in Milestone 5 (deferred to Milestone 8 Asset Library). Only member.photo (MEMBER_PHOTO) is supported for automated agent delivery; place other images manually in Affinity.`;
      if (mapping.isRequired) {
        issues.push({
          code: 'UNSUPPORTED_ASSET_KIND',
          severity: 'ERROR',
          fieldKey: mapping.fieldKey,
          message,
        });
      } else {
        warnings.push({
          code: 'UNSUPPORTED_ASSET_KIND',
          severity: 'WARNING',
          fieldKey: mapping.fieldKey,
          message,
        });
      }
      resolvedFields.push({
        fieldKey: mapping.fieldKey,
        fieldType: 'IMAGE',
        targetLayerName: mapping.targetLayerName,
        layerPath,
        textValue: null,
        assetReference: null,
      });
      continue;
    }

    let resolvedText: string | null = null;
    switch (mapping.fieldKey) {
      case 'member.fullName':
        resolvedText = job.member?.fullName ?? null;
        break;
      case 'member.firstName':
        resolvedText = job.member
          ? splitMemberName(job.member.fullName, job.member.preferredName)
              .firstName
          : null;
        break;
      case 'member.lastName':
        resolvedText = job.member
          ? splitMemberName(job.member.fullName, job.member.preferredName)
              .lastName
          : null;
        break;
      case 'member.birthdayDisplay':
        resolvedText = job.member
          ? formatBirthdayDisplay(job.member.birthMonth, job.member.birthDay)
          : null;
        break;
      case 'design.title':
        resolvedText = job.title;
        break;
      case 'design.requiredText':
        resolvedText = job.requiredText ?? null;
        break;
      case 'design.notes':
        resolvedText = job.notes ?? null;
        break;
      case 'event.title':
      case 'event.dateDisplay':
        resolvedText = customFieldValues?.[mapping.fieldKey]?.trim() || null;
        break;
      default:
        resolvedText = customFieldValues?.[mapping.fieldKey]?.trim() || null;
        break;
    }

    if (!resolvedText && mapping.defaultValue?.trim()) {
      resolvedText = mapping.defaultValue.trim();
    }

    if (!resolvedText) {
      const msg = `Missing value for mapped field "${mapping.fieldKey}" (target layer: "${mapping.targetLayerName}").`;
      if (mapping.isRequired) {
        issues.push({
          code: 'MISSING_REQUIRED_FIELD',
          severity: 'ERROR',
          fieldKey: mapping.fieldKey,
          message: msg,
        });
      } else {
        warnings.push({
          code: 'OPTIONAL_FIELD_UNRESOLVED',
          severity: 'WARNING',
          fieldKey: mapping.fieldKey,
          message: msg,
        });
      }
    }

    resolvedFields.push({
      fieldKey: mapping.fieldKey,
      fieldType: mapping.fieldType as CreativeManifestFieldValue['fieldType'],
      targetLayerName: mapping.targetLayerName,
      layerPath,
      textValue: resolvedText,
      assetReference: null,
    });
  }

  const templateSafeFile = sanitizeSafeSlugFilename(
    job.templateVersion.originalFilename,
    `template-v${job.templateVersion.versionNumber}`,
    job.templateVersion.format.toLowerCase()
  );

  const instructions: string[] = [
    `Create an isolated working copy of "${templateSafeFile}" (pinned v${job.templateVersion.versionNumber}, SHA-256 ${job.templateVersion.sha256.slice(0, 12)}...). Never modify the original master file.`,
    `Open the working copy in Affinity 3.3 (${job.template.studioType}) and verify layer hierarchy and fonts.`,
  ];

  if (resolvedFields.length > 0) {
    instructions.push(
      `Apply ${resolvedFields.length} mapped field value(s) to their configured target layers in the working copy.`
    );
  }
  instructions.push(
    `Export deliverables in requested format(s): ${exportFormats.join(', ')}.`,
    'Upload verified export back to CRELUNE for owner review. Exporting does not automatically publish the artwork.'
  );

  const candidateManifest = {
    manifestVersion: CREATIVE_AGENT_MANIFEST_VERSION,
    dispatchId,
    designJobId: job.id,
    organisationId: job.organisationId,
    templateId: job.template.id,
    templateVersionId: job.templateVersion.id,
    templateFormat: job.templateVersion.format as TemplateFileFormat,
    templateStudioType: job.template.studioType as TemplateStudioType,
    templateSha256: job.templateVersion.sha256,
    templateRelativeFilename: `templates/${templateSafeFile}`,
    preserveMasterImmutable: true as const,
    publicationRule: CREATIVE_DISPATCH_PUBLICATION_RULE,
    outputSpec: {
      formats: exportFormats,
      targetPlatform: job.targetPlatform ?? null,
      dimensions:
        job.dimensions ??
        (job.templateVersion.widthPx && job.templateVersion.heightPx
          ? `${job.templateVersion.widthPx}x${job.templateVersion.heightPx}px`
          : null),
    },
    fields: resolvedFields,
    createdAt: now.toISOString(),
    designJobTitle: job.title,
    designCategory: job.category as DesignCategory,
    templateName: job.template.name,
    templateVersionNumber: job.templateVersion.versionNumber,
    templateByteSize: job.templateVersion.byteSize,
    requiredText: job.requiredText ?? null,
    referenceNotes: job.referenceNotes ?? null,
    manualModeNotice: MANUAL_MODE_NOTICE,
    preparationInstructions: instructions,
  };

  if (containsForbiddenManifestSecret(candidateManifest)) {
    issues.push({
      code: 'MANIFEST_SECRET_POLICY_VIOLATION',
      severity: 'ERROR',
      message:
        'Job text or notes contain patterns resembling private credentials, tokens, or signed URLs and cannot be placed in a preparation manifest.',
    });
    return { ready: false, issues, warnings, manifest: null };
  }

  const parsedManifest = creativeJobManifestSchema.safeParse(candidateManifest);
  if (!parsedManifest.success) {
    issues.push({
      code: 'MANIFEST_CONTRACT_INVALID',
      severity: 'ERROR',
      message:
        parsedManifest.error.issues[0]?.message ??
        'Job preparation manifest failed schema validation.',
    });
    return { ready: false, issues, warnings, manifest: null };
  }

  return {
    ready: issues.length === 0,
    issues,
    warnings,
    manifest: parsedManifest.data,
  };
}

export async function getDesignJobPreparationSnapshot(
  actor: DesignActorContext,
  jobId: string,
  options: {
    exportFormats?: ExportFileFormat[];
    customFieldValues?: Record<string, string>;
    now?: () => Date;
  } = {}
): Promise<DesignJobPreparationSnapshot> {
  const now = (options.now ?? (() => new Date()))();
  const [job, userPref] = await Promise.all([
    prisma.designJob.findFirst({
      where: {
        id: jobId,
        organisationId: actor.organisationId,
      },
      select: PREPARATION_JOB_SELECT,
    }),
    prisma.userPreference.findUnique({
      where: { userId: actor.userId },
      select: { defaultExportFormat: true },
    }),
  ]);

  if (!job) {
    throw new DesignJobNotFoundError();
  }

  const defaultExportFormats =
    options.exportFormats && options.exportFormats.length > 0
      ? options.exportFormats
      : parseDefaultExportFormats(userPref?.defaultExportFormat);

  const binding = buildBindingSummary(job);
  const resolved = resolveFieldsAndManifest({
    job,
    dispatchId: `preview_${job.id}`,
    exportFormats: defaultExportFormats,
    customFieldValues: options.customFieldValues,
    now,
  });

  const dispatches = job.creativeDispatches.map((row) =>
    mapDispatchSummary(row, now)
  );
  const exports = job.exportRecords.map(mapExportRecordSummary);
  const hasActiveDispatch = dispatches.some((d) =>
    ACTIVE_CREATIVE_DISPATCH_STATUSES.includes(d.status)
  );

  return {
    designJobId: job.id,
    ready: resolved.ready,
    issues: resolved.issues,
    warnings: resolved.warnings,
    binding,
    defaultExportFormats,
    manifestPreview: resolved.manifest,
    dispatches,
    exports,
    hasActiveDispatch,
    manualFallback: {
      available: Boolean(binding && resolved.manifest),
      manifestDownloadPath: `/api/designs/${encodeURIComponent(job.id)}/preparation/manifest`,
      templateMasterDownloadPath: binding
        ? `/api/designs/${encodeURIComponent(job.id)}/preparation/master`
        : null,
      memberPhotoDownloadPath:
        job.member && job.member.photoStorageKey
          ? `/api/members/${encodeURIComponent(job.member.id)}/photo`
          : null,
      notice: MANUAL_MODE_NOTICE,
    },
  };
}

export async function createCreativeJobDispatch(
  actor: DesignActorContext,
  jobId: string,
  input: CreateCreativeJobDispatchInput,
  deps: JobPreparationServiceDependencies = {}
): Promise<{
  dispatch: CreativeJobDispatchSummary;
  manifest: JobPrepManifest;
  idempotentReplay: boolean;
}> {
  const now = (deps.now ?? (() => new Date()))();

  if (input.designJobId !== jobId) {
    throw new DesignJobValidationError(
      'designJobId in payload does not match route design job id.'
    );
  }

  return prisma.$transaction(async (tx) => {
    // Idempotency check before acquiring mutable state
    const existingByKey = await tx.creativeJobDispatch.findUnique({
      where: { idempotencyKey: input.idempotencyKey },
      select: {
        id: true,
        organisationId: true,
        designJobId: true,
        templateVersionId: true,
        assignedAgentId: true,
        manifestVersion: true,
        manifestJson: true,
        status: true,
        claimedAt: true,
        readyForArtistAt: true,
        completedAt: true,
        failedAt: true,
        errorCode: true,
        errorMessage: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (existingByKey) {
      if (
        existingByKey.organisationId !== actor.organisationId ||
        existingByKey.designJobId !== jobId
      ) {
        throw new JobPreparationConflictError(
          'Idempotency key has already been used for another creative job.',
          'IDEMPOTENCY_KEY_CONFLICT'
        );
      }
      const parsedExisting = creativeJobManifestSchema.parse(
        existingByKey.manifestJson
      );
      return {
        dispatch: mapDispatchSummary(existingByKey),
        manifest: parsedExisting,
        idempotentReplay: true,
      };
    }

    // Lock parent DesignJob FOR UPDATE to serialize concurrent dispatch creation
    await tx.$queryRaw<
      Array<{ id: string }>
    >`SELECT id FROM design_jobs WHERE id = ${jobId} AND organisation_id = ${actor.organisationId} FOR UPDATE`;

    const job = await tx.designJob.findFirst({
      where: { id: jobId, organisationId: actor.organisationId },
      select: PREPARATION_JOB_SELECT,
    });

    if (!job) {
      throw new DesignJobNotFoundError();
    }

    if (job.status === 'PUBLISHED' || job.status === 'CANCELLED') {
      throw new JobPreparationConflictError(
        `Cannot prepare a creative dispatch for a ${job.status} design job.`,
        'JOB_TERMINAL_STATUS'
      );
    }

    // Prevent duplicate active dispatches on the same design job
    const activeDispatch = await tx.creativeJobDispatch.findFirst({
      where: {
        organisationId: actor.organisationId,
        designJobId: job.id,
        status: { in: [...ACTIVE_CREATIVE_DISPATCH_STATUSES] },
      },
      select: { id: true, status: true },
    });
    if (activeDispatch) {
      throw new JobPreparationConflictError(
        `An active creative dispatch (${activeDispatch.status}) already exists for this design job. Cancel it before preparing a new dispatch.`,
        'ACTIVE_DISPATCH_EXISTS'
      );
    }

    // Strict template version pinning — never silently substitute a different active version
    if (
      job.templateVersionId &&
      input.templateVersionId &&
      input.templateVersionId !== job.templateVersionId
    ) {
      throw new JobPreparationConflictError(
        'This design job is already pinned to a specific template version. Update the job template binding explicitly before preparing with a different version.',
        'TEMPLATE_VERSION_MISMATCH'
      );
    }

    let jobForPrep = job;
    if (job.templateId && !job.templateVersionId) {
      if (!input.templateVersionId) {
        throw new JobPreparationValidationError(
          'Select and pin an exact template version before preparing this job.',
          [
            {
              code: 'NO_TEMPLATE_VERSION_PINNED',
              severity: 'ERROR',
              message: 'Pin a template version before preparing.',
            },
          ]
        );
      }
      const version = await tx.templateVersion.findFirst({
        where: {
          id: input.templateVersionId,
          templateId: job.templateId,
          organisationId: actor.organisationId,
        },
        select: { id: true },
      });
      if (!version) {
        throw new DesignJobValidationError(
          'Selected template version does not belong to the bound template.'
        );
      }
      await tx.designJob.update({
        where: { id: job.id },
        data: { templateVersionId: version.id },
      });
      const reloaded = await tx.designJob.findFirstOrThrow({
        where: { id: job.id, organisationId: actor.organisationId },
        select: PREPARATION_JOB_SELECT,
      });
      jobForPrep = reloaded;
    }

    let validatedAgentId: string | null = null;
    if (input.assignedAgentId) {
      const agent = await tx.creativeAgent.findFirst({
        where: {
          id: input.assignedAgentId,
          organisationId: actor.organisationId,
          status: 'ACTIVE',
          revokedAt: null,
        },
        select: { id: true },
      });
      if (!agent) {
        throw new DesignJobValidationError(
          'Selected Windows Creative Agent is not active in your workspace.'
        );
      }
      validatedAgentId = agent.id;
    }

    // Pre-generate dispatch CUID-like safe ID so manifestJson stores exact dispatchId atomically
    const dispatchId = `disp_${crypto.randomBytes(12).toString('hex')}`;
    const resolved = resolveFieldsAndManifest({
      job: jobForPrep,
      dispatchId,
      exportFormats: input.exportFormats,
      customFieldValues: input.customFieldValues,
      now,
    });

    if (!resolved.ready || !resolved.manifest) {
      throw new JobPreparationValidationError(
        resolved.issues[0]?.message ??
          'Design job is missing required template bindings, fields, or assets.',
        resolved.issues
      );
    }

    const createdDispatch = await tx.creativeJobDispatch.create({
      data: {
        id: dispatchId,
        organisationId: actor.organisationId,
        designJobId: jobForPrep.id,
        templateVersionId: jobForPrep.templateVersionId!,
        assignedAgentId: validatedAgentId,
        requestedByUserId: actor.userId,
        idempotencyKey: input.idempotencyKey,
        manifestVersion: CREATIVE_AGENT_MANIFEST_VERSION,
        manifestJson: resolved.manifest as unknown as Prisma.InputJsonValue,
        status: 'QUEUED',
      },
    });

    // Integrate with existing DesignJob state machine cleanly (no duplicate status system)
    const currentStatus = jobForPrep.status as DesignJobStatus;
    if (currentStatus === 'DRAFT' && canTransitionDesignJobStatus('DRAFT', 'PENDING')) {
      await tx.designJob.update({
        where: { id: jobForPrep.id },
        data: { status: 'PENDING' },
      });
      await tx.designJobHistory.create({
        data: {
          organisationId: actor.organisationId,
          designJobId: jobForPrep.id,
          previousStatus: 'DRAFT',
          newStatus: 'PENDING',
          note: `Prepared creative job manifest (dispatch ${createdDispatch.id}) pinned to ${jobForPrep.template!.name} v${jobForPrep.templateVersion!.versionNumber}.`,
          changedByUserId: actor.userId,
        },
      });
    } else {
      await tx.designJobHistory.create({
        data: {
          organisationId: actor.organisationId,
          designJobId: jobForPrep.id,
          previousStatus: currentStatus,
          newStatus: currentStatus,
          note: `Prepared creative job manifest (dispatch ${createdDispatch.id}) pinned to ${jobForPrep.template!.name} v${jobForPrep.templateVersion!.versionNumber}.`,
          changedByUserId: actor.userId,
        },
      });
    }

    await auditService.recordAuditEvent(tx, {
      organisationId: actor.organisationId,
      actorUserId: actor.userId,
      action: auditService.AUDIT_ACTIONS.CREATIVE_DISPATCH_CREATED,
      entityType: 'CreativeJobDispatch',
      entityId: createdDispatch.id,
      metadata: {
        designJobId: jobForPrep.id,
        templateId: jobForPrep.template!.id,
        templateVersionId: jobForPrep.templateVersion!.id,
        versionNumber: jobForPrep.templateVersion!.versionNumber,
        exportFormats: input.exportFormats,
        hasAssignedAgent: Boolean(validatedAgentId),
      },
    });

    return {
      dispatch: mapDispatchSummary(createdDispatch),
      manifest: resolved.manifest,
      idempotentReplay: false,
    };
  }, { maxWait: 10000, timeout: 15000 });
}

export async function cancelCreativeJobDispatch(
  actor: DesignActorContext,
  jobId: string,
  dispatchId: string,
  reason?: string | null
): Promise<CreativeJobDispatchSummary> {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw<
      Array<{ id: string }>
    >`SELECT id FROM design_jobs WHERE id = ${jobId} AND organisation_id = ${actor.organisationId} FOR UPDATE`;

    const dispatch = await tx.creativeJobDispatch.findFirst({
      where: {
        id: dispatchId,
        designJobId: jobId,
        organisationId: actor.organisationId,
      },
    });
    if (!dispatch) {
      throw new DispatchNotFoundError();
    }

    const current = dispatch.status as CreativeDispatchStatus;
    if (current === 'CANCELLED') {
      return mapDispatchSummary(dispatch);
    }
    if (!canTransitionCreativeDispatchStatus(current, 'CANCELLED')) {
      throw new JobPreparationConflictError(
        `Cannot cancel a creative dispatch that is already ${current}.`,
        'INVALID_DISPATCH_TRANSITION'
      );
    }

    const updated = await tx.creativeJobDispatch.update({
      where: { id: dispatch.id },
      data: {
        status: 'CANCELLED',
        claimTokenHash: null,
        leaseExpiresAt: null,
        errorCode: 'OWNER_CANCELLED',
        errorMessage: reason?.trim() || 'Cancelled by workspace owner.',
      },
    });

    await auditService.recordAuditEvent(tx, {
      organisationId: actor.organisationId,
      actorUserId: actor.userId,
      action: auditService.AUDIT_ACTIONS.CREATIVE_DISPATCH_STATUS_CHANGED,
      entityType: 'CreativeJobDispatch',
      entityId: dispatch.id,
      metadata: {
        designJobId: jobId,
        previousStatus: current,
        newStatus: 'CANCELLED',
      },
    });

    return mapDispatchSummary(updated);
  }, { maxWait: 10000, timeout: 15000 });
}

/**
 * Explicit owner recovery action for dispatches held in `READY_FOR_ARTIST`
 * (e.g., after lease expiry or assigned-agent revocation).
 * Preserves local artist working copies (enforced by Windows Creative Agent) and
 * returns the dispatch to `QUEUED` with cleared ownership/claim/lease state.
 */
export async function recoverCreativeJobDispatch(
  actor: DesignActorContext,
  jobId: string,
  dispatchId: string,
  input: RecoverCreativeJobDispatchInput,
  deps: JobPreparationServiceDependencies = {}
): Promise<CreativeJobDispatchSummary> {
  const now = (deps.now ?? (() => new Date()))();

  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw<
      Array<{ id: string }>
    >`SELECT id FROM design_jobs WHERE id = ${jobId} AND organisation_id = ${actor.organisationId} FOR UPDATE`;

    const dispatch = await tx.creativeJobDispatch.findFirst({
      where: {
        id: dispatchId,
        designJobId: jobId,
        organisationId: actor.organisationId,
      },
      include: {
        assignedAgent: {
          select: { status: true },
        },
      },
    });
    if (!dispatch) {
      throw new DispatchNotFoundError();
    }

    const current = dispatch.status as CreativeDispatchStatus;
    if (current === 'EXPORTED' || current === 'FAILED' || current === 'CANCELLED') {
      throw new JobPreparationConflictError(
        `Cannot recover a terminal creative dispatch (${current}). Queue a new dispatch instead.`,
        'INVALID_DISPATCH_TRANSITION'
      );
    }

    if (current === 'QUEUED') {
      return mapDispatchSummary(dispatch, now);
    }

    const previousAgentId = dispatch.assignedAgentId;
    const updated = await tx.creativeJobDispatch.update({
      where: { id: dispatch.id },
      data: {
        status: 'QUEUED',
        assignedAgentId: null,
        claimTokenHash: null,
        leaseExpiresAt: null,
        readyForArtistAt: null,
        errorCode: null,
        errorMessage: null,
      },
    });

    await auditService.recordAuditEvent(tx, {
      organisationId: actor.organisationId,
      actorUserId: actor.userId,
      action: auditService.AUDIT_ACTIONS.CREATIVE_DISPATCH_RECOVERED,
      entityType: 'CreativeJobDispatch',
      entityId: dispatch.id,
      metadata: {
        designJobId: jobId,
        previousStatus: current,
        previousAgentId,
        recoveryType: 'OWNER_EXPLICIT_REQUEUE',
        confirmPreserveLocalWork: input.confirmPreserveLocalWork,
      },
    });

    return mapDispatchSummary(updated, now);
  }, { maxWait: 10000, timeout: 15000 });
}

export async function getPinnedTemplateMasterForDesignJob(
  organisationId: string,
  jobId: string,
  deps: JobPreparationServiceDependencies = {}
): Promise<{
  body: Uint8Array;
  mimeType: string;
  byteSize: number;
  sha256: string;
  filename: string;
}> {
  const storage = deps.storage ?? createCreativeObjectStorageProvider();
  const job = await prisma.designJob.findFirst({
    where: { id: jobId, organisationId },
    select: {
      id: true,
      templateId: true,
      templateVersion: {
        select: {
          id: true,
          templateId: true,
          versionNumber: true,
          format: true,
          storageBucket: true,
          storageKey: true,
          originalFilename: true,
          mimeType: true,
          byteSize: true,
          sha256: true,
        },
      },
    },
  });

  if (!job) {
    throw new DesignJobNotFoundError();
  }
  if (!job.templateVersion) {
    throw new DesignJobValidationError(
      'This design job does not have a pinned template version.'
    );
  }
  if (job.templateVersion.storageBucket !== storage.bucket) {
    throw new DesignJobValidationError(
      'Pinned template version bucket does not match active creative storage target.'
    );
  }

  assertKeyMatchesTemplateMasterScope(job.templateVersion.storageKey, {
    envPrefix: storage.envPrefix,
    organisationId,
    templateId: job.templateVersion.templateId,
    versionNumber: job.templateVersion.versionNumber,
  });

  const obj = await storage.getObjectBounded(
    job.templateVersion.storageKey,
    CREATIVE_BYTE_LIMITS.TEMPLATE_MASTER_MAX_BYTES
  );

  const actualSha = crypto.createHash('sha256').update(obj.body).digest('hex');
  if (actualSha !== job.templateVersion.sha256) {
    throw new Error('Pinned template master integrity verification failed.');
  }

  const safeFilename = sanitizeSafeSlugFilename(
    job.templateVersion.originalFilename,
    `template-v${job.templateVersion.versionNumber}`,
    job.templateVersion.format.toLowerCase()
  );

  return {
    body: obj.body,
    mimeType: job.templateVersion.mimeType,
    byteSize: obj.body.byteLength,
    sha256: actualSha,
    filename: safeFilename,
  };
}

// =============================================================================
// EXPORT DELIVERABLE UPLOAD & VERIFICATION (Shared by Web Manual + Agent Paths)
// =============================================================================

function validateExportDeliverableBytes(
  format: ExportFileFormat,
  bytes: Uint8Array
): Promise<{ widthPx: number | null; heightPx: number | null }> {
  if (bytes.byteLength === 0) {
    throw new DesignJobValidationError('Uploaded export file cannot be empty.');
  }
  if (bytes.byteLength > CREATIVE_BYTE_LIMITS.EXPORT_DELIVERABLE_MAX_BYTES) {
    throw new CreativeObjectTooLargeError(
      CREATIVE_BYTE_LIMITS.EXPORT_DELIVERABLE_MAX_BYTES
    );
  }

  if (format === 'PDF') {
    const header = Buffer.from(bytes.subarray(0, 5)).toString('ascii');
    if (header !== '%PDF-') {
      throw new DesignJobValidationError(
        'Uploaded PDF export does not start with a valid %PDF- signature.'
      );
    }
    const tailSlice = bytes.subarray(Math.max(0, bytes.byteLength - 2048));
    const tailText = Buffer.from(tailSlice).toString('latin1');
    if (!tailText.includes('%%EOF')) {
      throw new DesignJobValidationError(
        'Uploaded PDF export is truncated (missing %%EOF trailer).'
      );
    }
    return Promise.resolve({ widthPx: null, heightPx: null });
  }

  if (format === 'PNG') {
    const isPng =
      bytes.byteLength >= 8 &&
      bytes[0] === 0x89 &&
      bytes[1] === 0x50 &&
      bytes[2] === 0x4e &&
      bytes[3] === 0x47 &&
      bytes[4] === 0x0d &&
      bytes[5] === 0x0a &&
      bytes[6] === 0x1a &&
      bytes[7] === 0x0a;
    if (!isPng) {
      throw new DesignJobValidationError(
        'Uploaded PNG export does not match PNG file signature.'
      );
    }
  } else if (format === 'JPEG') {
    const isJpeg =
      bytes.byteLength >= 3 &&
      bytes[0] === 0xff &&
      bytes[1] === 0xd8 &&
      bytes[2] === 0xff;
    if (!isJpeg) {
      throw new DesignJobValidationError(
        'Uploaded JPEG export does not match JPEG file signature.'
      );
    }
  }

  return sharp(bytes, { limitInputPixels: 30000 * 30000 })
    .metadata()
    .then((meta) => {
      const expectedSharpFormat = format === 'PNG' ? 'png' : 'jpeg';
      if (meta.format !== expectedSharpFormat) {
        throw new DesignJobValidationError(
          `Uploaded export image decoded as ${meta.format ?? 'unknown'}, expected ${expectedSharpFormat}.`
        );
      }
      if (!meta.width || !meta.height) {
        throw new DesignJobValidationError(
          'Uploaded export image has invalid dimensions.'
        );
      }
      return { widthPx: meta.width, heightPx: meta.height };
    });
}

export async function createExportDeliverableUploadIntent(
  actor: {
    organisationId: string;
    userId?: string | null;
    agentId?: string | null;
  },
  input: CreateExportUploadIntentInput,
  deps: JobPreparationServiceDependencies = {}
): Promise<{
  intent: CreativeUploadIntentSummary;
  upload: PresignedUploadTarget;
}> {
  const storage = deps.storage ?? createCreativeObjectStorageProvider();
  const now = (deps.now ?? (() => new Date()))();

  const job = await prisma.designJob.findFirst({
    where: { id: input.designJobId, organisationId: actor.organisationId },
    select: { id: true, status: true },
  });
  if (!job) {
    throw new DesignJobNotFoundError();
  }
  if (job.status === 'CANCELLED') {
    throw new JobPreparationConflictError(
      'Cannot upload exports for a cancelled design job.',
      'JOB_CANCELLED'
    );
  }

  if (input.dispatchId) {
    const dispatch = await prisma.creativeJobDispatch.findFirst({
      where: {
        id: input.dispatchId,
        designJobId: job.id,
        organisationId: actor.organisationId,
      },
      select: { id: true },
    });
    if (!dispatch) {
      throw new DispatchNotFoundError();
    }
  }

  const existing = await prisma.creativeUploadIntent.findUnique({
    where: { idempotencyKey: input.idempotencyKey },
  });
  if (existing) {
    if (
      existing.organisationId !== actor.organisationId ||
      existing.kind !== 'EXPORT_DELIVERABLE'
    ) {
      throw new JobPreparationConflictError(
        'Upload intent idempotency key conflicts with an existing record.',
        'IDEMPOTENCY_KEY_CONFLICT'
      );
    }
    if (existing.status !== 'PENDING' || existing.expiresAt <= now) {
      throw new JobPreparationConflictError(
        `Upload intent is ${existing.status} and cannot be reused.`,
        'UPLOAD_INTENT_NOT_REUSABLE'
      );
    }
    const presigned = await storage.createPresignedPutUrl({
      key: existing.storageKey,
      contentType: existing.expectedMimeType,
      contentLength: existing.expectedByteSize,
    });
    return {
      intent: {
        id: existing.id,
        kind: existing.kind,
        status: existing.status,
        expectedMimeType: existing.expectedMimeType,
        expectedByteSize: existing.expectedByteSize,
        maxAllowedBytes: existing.maxAllowedBytes,
        expiresAt: existing.expiresAt.toISOString(),
        verifiedAt: existing.verifiedAt ? existing.verifiedAt.toISOString() : null,
      },
      upload: {
        url: presigned.url,
        method: presigned.method,
        requiredHeaders: presigned.requiredHeaders,
        expiresAt: presigned.expiresAt.toISOString(),
      },
    };
  }

  const objectKey = buildExportDeliverableObjectKey({
    envPrefix: storage.envPrefix,
    organisationId: actor.organisationId,
    designJobId: job.id,
    extension: exportExtensionFromFormat(input.format),
  });
  assertKeyMatchesExportDeliverableScope(objectKey, {
    envPrefix: storage.envPrefix,
    organisationId: actor.organisationId,
    designJobId: job.id,
  });

  const presigned = await storage.createPresignedPutUrl({
    key: objectKey,
    contentType: input.mimeType,
    contentLength: input.byteSize,
  });

  const created = await prisma.creativeUploadIntent.create({
    data: {
      organisationId: actor.organisationId,
      requestedByUserId: actor.userId ?? null,
      agentId: actor.agentId ?? null,
      kind: 'EXPORT_DELIVERABLE',
      idempotencyKey: input.idempotencyKey,
      storageBucket: storage.bucket,
      storageKey: objectKey,
      expectedMimeType: input.mimeType,
      expectedByteSize: input.byteSize,
      expectedSha256: input.sha256,
      maxAllowedBytes: CREATIVE_BYTE_LIMITS.EXPORT_DELIVERABLE_MAX_BYTES,
      status: 'PENDING',
      expiresAt: presigned.expiresAt,
    },
  });

  return {
    intent: {
      id: created.id,
      kind: created.kind,
      status: created.status,
      expectedMimeType: created.expectedMimeType,
      expectedByteSize: created.expectedByteSize,
      maxAllowedBytes: created.maxAllowedBytes,
      expiresAt: created.expiresAt.toISOString(),
      verifiedAt: null,
    },
    upload: {
      url: presigned.url,
      method: presigned.method,
      requiredHeaders: presigned.requiredHeaders,
      expiresAt: presigned.expiresAt.toISOString(),
    },
  };
}

export async function completeExportDeliverableUpload(
  actor: {
    organisationId: string;
    userId?: string | null;
    agentId?: string | null;
  },
  input: CreateExportRecordInput,
  deps: JobPreparationServiceDependencies = {}
): Promise<{ exportRecord: ExportRecordSummary; idempotentReplay: boolean }> {
  const storage = deps.storage ?? createCreativeObjectStorageProvider();
  const now = (deps.now ?? (() => new Date()))();

  // Check idempotent replay first if uploadIntentId already produced an ExportRecord
  const existingExport = await prisma.exportRecord.findFirst({
    where: {
      organisationId: actor.organisationId,
      designJobId: input.designJobId,
      uploadIntentId: input.uploadIntentId,
    },
  });
  if (existingExport) {
    return {
      exportRecord: mapExportRecordSummary(existingExport),
      idempotentReplay: true,
    };
  }

  const intent = await prisma.creativeUploadIntent.findFirst({
    where: {
      id: input.uploadIntentId,
      organisationId: actor.organisationId,
      kind: 'EXPORT_DELIVERABLE',
    },
  });
  if (!intent) {
    throw new DesignJobValidationError('Export upload intent not found.');
  }
  if (intent.status !== 'PENDING') {
    throw new JobPreparationConflictError(
      `Export upload intent is ${intent.status} and cannot be finalized.`,
      'UPLOAD_INTENT_NOT_REUSABLE'
    );
  }
  if (intent.expiresAt <= now) {
    await prisma.creativeUploadIntent.update({
      where: { id: intent.id },
      data: { status: 'EXPIRED' },
    });
    throw new JobPreparationConflictError(
      'Export upload intent has expired. Request a fresh upload intent.',
      'UPLOAD_INTENT_EXPIRED'
    );
  }

  assertKeyMatchesExportDeliverableScope(intent.storageKey, {
    envPrefix: storage.envPrefix,
    organisationId: actor.organisationId,
    designJobId: input.designJobId,
  });

  let downloaded: { body: Uint8Array };
  try {
    downloaded = await storage.getObjectBounded(
      intent.storageKey,
      CREATIVE_BYTE_LIMITS.EXPORT_DELIVERABLE_MAX_BYTES
    );
  } catch (err) {
    await prisma.creativeUploadIntent.update({
      where: { id: intent.id },
      data: { status: 'REJECTED', rejectionReason: 'OBJECT_READ_FAILED' },
    });
    throw err;
  }

  const actualBytes = downloaded.body;
  const actualSha256 = crypto
    .createHash('sha256')
    .update(actualBytes)
    .digest('hex');

  if (
    actualBytes.byteLength !== intent.expectedByteSize ||
    (intent.expectedSha256 && actualSha256 !== intent.expectedSha256)
  ) {
    await prisma.creativeUploadIntent.update({
      where: { id: intent.id },
      data: {
        status: 'REJECTED',
        verifiedByteSize: actualBytes.byteLength,
        verifiedSha256: actualSha256,
        rejectionReason: 'CHECKSUM_OR_SIZE_MISMATCH',
      },
    });
    await storage.deleteObject(intent.storageKey).catch(() => {});
    throw new DesignJobValidationError(
      'Uploaded export file size or SHA-256 checksum does not match upload intent.'
    );
  }

  let verifiedDims: { widthPx: number | null; heightPx: number | null };
  try {
    verifiedDims = await validateExportDeliverableBytes(
      input.format,
      actualBytes
    );
  } catch (err) {
    await prisma.creativeUploadIntent.update({
      where: { id: intent.id },
      data: {
        status: 'REJECTED',
        verifiedByteSize: actualBytes.byteLength,
        verifiedSha256: actualSha256,
        rejectionReason: 'INVALID_EXPORT_BINARY',
      },
    });
    await storage.deleteObject(intent.storageKey).catch(() => {});
    throw err;
  }

  const createdRecord = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw<
      Array<{ id: string }>
    >`SELECT id FROM design_jobs WHERE id = ${input.designJobId} AND organisation_id = ${actor.organisationId} FOR UPDATE`;

    const job = await tx.designJob.findFirst({
      where: { id: input.designJobId, organisationId: actor.organisationId },
      select: { id: true, status: true, exportedAt: true },
    });
    if (!job) {
      throw new DesignJobNotFoundError();
    }

    const claimed = await tx.creativeUploadIntent.updateMany({
      where: {
        id: intent.id,
        organisationId: actor.organisationId,
        status: 'PENDING',
      },
      data: {
        status: 'VERIFIED',
        verifiedByteSize: actualBytes.byteLength,
        verifiedSha256: actualSha256,
        verifiedAt: now,
      },
    });
    if (claimed.count !== 1) {
      throw new JobPreparationConflictError(
        'Export upload intent was already consumed.',
        'UPLOAD_INTENT_NOT_REUSABLE'
      );
    }

    if (input.dispatchId) {
      const dispatch = await tx.creativeJobDispatch.findFirst({
        where: {
          id: input.dispatchId,
          designJobId: job.id,
          organisationId: actor.organisationId,
        },
        select: { id: true, status: true },
      });
      if (!dispatch) {
        throw new DispatchNotFoundError();
      }
      if (dispatch.status !== 'EXPORTED') {
        await tx.creativeJobDispatch.update({
          where: { id: dispatch.id },
          data: {
            status: 'EXPORTED',
            completedAt: now,
            // Retain claimTokenHash strictly so idempotent export-completion retries
            // from the exact same winning claim remain verifiable while terminal
            // status + cleared leaseExpiresAt block all further active operations.
            leaseExpiresAt: null,
          },
        });
      }
    }

    // ExportRecord is NEVER approved for publish or published automatically.
    const record = await tx.exportRecord.create({
      data: {
        organisationId: actor.organisationId,
        designJobId: job.id,
        dispatchId: input.dispatchId ?? null,
        uploadedByAgentId: actor.agentId ?? null,
        uploadedByUserId: actor.userId ?? null,
        uploadIntentId: intent.id,
        format: input.format,
        storageBucket: intent.storageBucket,
        storageKey: intent.storageKey,
        mimeType: intent.expectedMimeType,
        byteSize: actualBytes.byteLength,
        sha256: actualSha256,
        widthPx: verifiedDims.widthPx ?? input.widthPx ?? null,
        heightPx: verifiedDims.heightPx ?? input.heightPx ?? null,
        resolutionDpi: input.resolutionDpi ?? null,
        isApprovedForPublish: false,
        ownerApprovedAt: null,
        ownerApprovedByUserId: null,
        publishedAt: null,
      },
    });

    // Advance APPROVED -> EXPORTED (keeping PUBLISHED strictly separate!) or record proof arrival on IN_PROGRESS -> AWAITING_REVIEW
    const currentStatus = job.status as DesignJobStatus;
    if (currentStatus === 'APPROVED') {
      await tx.designJob.update({
        where: { id: job.id },
        data: {
          status: 'EXPORTED',
          exportedAt: job.exportedAt ?? now,
        },
      });
      await tx.designJobHistory.create({
        data: {
          organisationId: actor.organisationId,
          designJobId: job.id,
          previousStatus: 'APPROVED',
          newStatus: 'EXPORTED',
          note: `Verified ${input.format} deliverable registered (SHA-256 ${actualSha256.slice(0, 12)}...). Publication still requires explicit owner confirmation.`,
          changedByUserId: actor.userId ?? null,
        },
      });
    } else if (currentStatus === 'IN_PROGRESS') {
      await tx.designJob.update({
        where: { id: job.id },
        data: { status: 'AWAITING_REVIEW' },
      });
      await tx.designJobHistory.create({
        data: {
          organisationId: actor.organisationId,
          designJobId: job.id,
          previousStatus: 'IN_PROGRESS',
          newStatus: 'AWAITING_REVIEW',
          note: `Verified ${input.format} deliverable uploaded for owner visual review (SHA-256 ${actualSha256.slice(0, 12)}...).`,
          changedByUserId: actor.userId ?? null,
        },
      });
    }

    await auditService.recordAuditEvent(tx, {
      organisationId: actor.organisationId,
      actorUserId: actor.userId ?? null,
      action: auditService.AUDIT_ACTIONS.EXPORT_RECORD_CREATED,
      entityType: 'ExportRecord',
      entityId: record.id,
      metadata: {
        designJobId: job.id,
        dispatchId: input.dispatchId ?? null,
        format: input.format,
        byteSize: actualBytes.byteLength,
        uploadedByAgent: Boolean(actor.agentId),
      },
    });

    return record;
  });

  return {
    exportRecord: mapExportRecordSummary(createdRecord),
    idempotentReplay: false,
  };
}

export async function getExportDeliverableFile(
  organisationId: string,
  jobId: string,
  exportId: string,
  deps: JobPreparationServiceDependencies = {}
): Promise<{
  body: Uint8Array;
  mimeType: string;
  byteSize: number;
  filename: string;
}> {
  const storage = deps.storage ?? createCreativeObjectStorageProvider();
  const record = await prisma.exportRecord.findFirst({
    where: { id: exportId, designJobId: jobId, organisationId },
  });
  if (!record) {
    throw new ExportRecordNotFoundError();
  }
  if (record.storageBucket !== storage.bucket) {
    throw new DesignJobValidationError('Export bucket mismatch.');
  }

  assertKeyMatchesExportDeliverableScope(record.storageKey, {
    envPrefix: storage.envPrefix,
    organisationId,
    designJobId: jobId,
  });

  const obj = await storage.getObjectBounded(
    record.storageKey,
    CREATIVE_BYTE_LIMITS.EXPORT_DELIVERABLE_MAX_BYTES
  );

  const ext = exportExtensionFromFormat(record.format as ExportFileFormat);
  return {
    body: obj.body,
    mimeType: record.mimeType,
    byteSize: obj.body.byteLength,
    filename: `design-${jobId}-export-${record.id}.${ext}`,
  };
}

export async function setExportPublishApproval(
  actor: DesignActorContext,
  jobId: string,
  exportId: string,
  input: ApproveExportForPublishInput
): Promise<ExportRecordSummary> {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.exportRecord.findFirst({
      where: {
        id: exportId,
        designJobId: jobId,
        organisationId: actor.organisationId,
      },
    });
    if (!existing) {
      throw new ExportRecordNotFoundError();
    }

    const now = new Date();
    const updated = await tx.exportRecord.update({
      where: { id: existing.id },
      data: {
        isApprovedForPublish: input.isApprovedForPublish,
        ownerApprovedAt: input.isApprovedForPublish ? now : null,
        ownerApprovedByUserId: input.isApprovedForPublish ? actor.userId : null,
      },
    });

    await auditService.recordAuditEvent(tx, {
      organisationId: actor.organisationId,
      actorUserId: actor.userId,
      action: auditService.AUDIT_ACTIONS.EXPORT_OWNER_APPROVAL_CHANGED,
      entityType: 'ExportRecord',
      entityId: existing.id,
      metadata: {
        designJobId: jobId,
        isApprovedForPublish: input.isApprovedForPublish,
      },
    });

    return mapExportRecordSummary(updated);
  });
}

export { loadOwnerBirthdayPreferences };
