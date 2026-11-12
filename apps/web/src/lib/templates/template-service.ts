/**
 * CRELUNE — Template Management, Presigned Upload Verification & Mapping Service
 *
 * Implements Stage 5.2 backend workflows on top of Stage 5.1/5.1.2 database models
 * and dedicated creative object storage (`crelune-dev-creative`):
 * - Organisation-scoped template CRUD, version activation/rollback, and soft archival.
 * - Short-lived presigned PUT upload intents with idempotency and replay protection.
 * - Authoritative server-side object verification (actual downloaded bytes, byteSize,
 *   SHA-256, preview image magic/dimensions, and bounded PSD metadata inspection).
 * - Immutable `TemplateVersion` registration and version-scoped `TemplateFieldMapping`.
 * - Durable `CreativeStorageCleanup` queueing on rejected or abandoned uploads.
 */

import crypto from 'node:crypto';
import sharp from 'sharp';
import {
  Prisma,
  prisma,
  type CreativeStorageCleanupReason,
} from '@crelune/database';
import {
  CREATIVE_BYTE_LIMITS,
  extractNormalizedFileExtension,
  getTemplateFormatCapabilities,
  psdInspectionResultSchema,
  type CreateTemplateInput,
  type CreateTemplatePreviewUploadIntentInput,
  type CreateTemplateVersionUploadIntentInput,
  type CompleteTemplateVersionUploadInput,
  type CreativeUploadIntentSummary,
  type PresignedUploadTarget,
  type PsdInspectionResult,
  type TemplateDetail,
  type TemplateFieldMappingSummary,
  type TemplateFileFormat,
  type TemplateListQuery,
  type TemplateSummary,
  type TemplateVersionDetail,
  type TemplateVersionSummary,
  type UpdateTemplateInput,
  type UpsertTemplateFieldMappingsInput,
} from '@crelune/shared';
import * as auditService from '@/lib/audit/audit-service';
import {
  assertCreativeKeyEnvPrefix,
  CreativeObjectTooLargeError,
  createCreativeObjectStorageProvider,
  type CreativeObjectStorageProvider,
} from '@/lib/storage/creative-storage';
import {
  assertKeyMatchesTemplateMasterScope,
  assertKeyMatchesTemplateMasterStagingScope,
  assertKeyMatchesTemplatePreviewScope,
  assertKeyMatchesTemplatePreviewStagingScope,
  buildTemplateMasterObjectKey,
  buildTemplateMasterStagingObjectKey,
  buildTemplatePreviewObjectKey,
  buildTemplatePreviewStagingObjectKey,
  type CreativeMasterExtension,
  type CreativePreviewExtension,
} from '@/lib/storage/storage-config';
import {
  PsdInspectionError,
  validatePsdHeader,
} from '@/lib/templates/psd-inspector';

function detectPreviewImageMagicMime(
  bytes: Uint8Array
): 'image/jpeg' | 'image/png' | 'image/webp' | null {
  if (
    bytes.byteLength >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff
  ) {
    return 'image/jpeg';
  }
  if (
    bytes.byteLength >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return 'image/png';
  }
  if (
    bytes.byteLength >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return 'image/webp';
  }
  return null;
}

const MAX_PREVIEW_DIMENSION_PX = 30_000;
export const CREATIVE_CLEANUP_EXPIRY_GRACE_MS = 60_000;

export interface TemplateActorContext {
  userId: string;
  organisationId: string;
}

export class TemplateNotFoundError extends Error {
  constructor() {
    super('Template not found.');
    this.name = 'TemplateNotFoundError';
  }
}

export class TemplateVersionNotFoundError extends Error {
  constructor() {
    super('Template version not found.');
    this.name = 'TemplateVersionNotFoundError';
  }
}

export class UploadIntentNotFoundError extends Error {
  constructor() {
    super('Creative upload intent not found.');
    this.name = 'UploadIntentNotFoundError';
  }
}

export class TemplateValidationError extends Error {
  constructor(
    message: string,
    public readonly code: string = 'VALIDATION_ERROR'
  ) {
    super(message);
    this.name = 'TemplateValidationError';
  }
}

export class TemplateConflictError extends Error {
  constructor(
    message: string,
    public readonly code: string = 'TEMPLATE_CONFLICT'
  ) {
    super(message);
    this.name = 'TemplateConflictError';
  }
}

export class UploadIntentConflictError extends Error {
  constructor(
    message: string,
    public readonly code: string = 'UPLOAD_INTENT_CONFLICT'
  ) {
    super(message);
    this.name = 'UploadIntentConflictError';
  }
}

export class UploadIntentExpiredError extends Error {
  constructor() {
    super('Creative upload intent has expired. Request a new upload intent.');
    this.name = 'UploadIntentExpiredError';
  }
}

export interface TemplateServiceDependencies {
  storage?: CreativeObjectStorageProvider;
  now?: () => Date;
}

const VERSION_SUMMARY_SELECT = {
  id: true,
  templateId: true,
  versionNumber: true,
  format: true,
  originalFilename: true,
  mimeType: true,
  byteSize: true,
  sha256: true,
  widthPx: true,
  heightPx: true,
  previewStorageKey: true,
  inspectionStatus: true,
  inspectionSummary: true,
  inspectedAt: true,
  createdAt: true,
} satisfies Prisma.TemplateVersionSelect;

const MAPPING_SUMMARY_SELECT = {
  id: true,
  templateVersionId: true,
  fieldKey: true,
  fieldType: true,
  targetLayerName: true,
  layerPathJson: true,
  isRequired: true,
  defaultValue: true,
  notes: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.TemplateFieldMappingSelect;

const UPLOAD_INTENT_SUMMARY_SELECT = {
  id: true,
  kind: true,
  status: true,
  expectedMimeType: true,
  expectedByteSize: true,
  maxAllowedBytes: true,
  expiresAt: true,
  verifiedAt: true,
} satisfies Prisma.CreativeUploadIntentSelect;

type SelectedVersionRow = Prisma.TemplateVersionGetPayload<{
  select: typeof VERSION_SUMMARY_SELECT;
}>;

type SelectedMappingRow = Prisma.TemplateFieldMappingGetPayload<{
  select: typeof MAPPING_SUMMARY_SELECT;
}>;

type SelectedIntentRow = Prisma.CreativeUploadIntentGetPayload<{
  select: typeof UPLOAD_INTENT_SUMMARY_SELECT;
}>;

function normalizeTemplateName(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLowerCase();
}

function mapVersionSummary(row: SelectedVersionRow): TemplateVersionSummary {
  return {
    id: row.id,
    templateId: row.templateId,
    versionNumber: row.versionNumber,
    format: row.format,
    originalFilename: row.originalFilename,
    mimeType: row.mimeType,
    byteSize: row.byteSize,
    sha256: row.sha256,
    widthPx: row.widthPx,
    heightPx: row.heightPx,
    hasPreview: Boolean(row.previewStorageKey),
    inspectionStatus: row.inspectionStatus,
    inspectionSummary: row.inspectionSummary,
    inspectedAt: row.inspectedAt ? row.inspectedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  };
}

function mapMappingSummary(row: SelectedMappingRow): TemplateFieldMappingSummary {
  const layerPath = Array.isArray(row.layerPathJson)
    ? row.layerPathJson.filter((item): item is string => typeof item === 'string')
    : null;
  return {
    id: row.id,
    templateVersionId: row.templateVersionId,
    fieldKey: row.fieldKey,
    fieldType: row.fieldType,
    targetLayerName: row.targetLayerName,
    layerPath,
    isRequired: row.isRequired,
    defaultValue: row.defaultValue,
    notes: row.notes,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function mapUploadIntentSummary(row: SelectedIntentRow): CreativeUploadIntentSummary {
  return {
    id: row.id,
    kind: row.kind,
    status: row.status,
    expectedMimeType: row.expectedMimeType,
    expectedByteSize: row.expectedByteSize,
    maxAllowedBytes: row.maxAllowedBytes,
    expiresAt: row.expiresAt.toISOString(),
    verifiedAt: row.verifiedAt ? row.verifiedAt.toISOString() : null,
  };
}

function previewExtensionFromMime(mimeType: string): CreativePreviewExtension {
  switch (mimeType) {
    case 'image/png':
      return 'png';
    case 'image/jpeg':
      return 'jpg';
    case 'image/webp':
      return 'webp';
    default:
      throw new TemplateValidationError(
        `Unsupported preview MIME type "${mimeType}".`
      );
  }
}

function formatFromVerifiedMasterKey(storageKey: string): TemplateFileFormat {
  const ext = extractNormalizedFileExtension(storageKey);
  switch (ext) {
    case 'psd':
      return 'PSD';
    case 'af':
      return 'AF';
    case 'afphoto':
      return 'AFPHOTO';
    case 'afdesign':
      return 'AFDESIGN';
    case 'afpub':
      return 'AFPUB';
    default:
      throw new TemplateValidationError('Unsupported template master file extension.');
  }
}

function computeNextRetryAt(attempts: number, now: Date): Date {
  const delayMs = Math.min(60 * 60 * 1000, Math.pow(2, attempts) * 60 * 1000);
  return new Date(now.getTime() + delayMs);
}

function computeCleanupDeferUntil(expiresAt: Date | null | undefined, now: Date): Date {
  if (!expiresAt) return now;
  const expiryWithGrace = expiresAt.getTime() + CREATIVE_CLEANUP_EXPIRY_GRACE_MS;
  return new Date(Math.max(now.getTime(), expiryWithGrace));
}

async function enqueueAndAttemptCreativeCleanup(
  params: {
    organisationId: string;
    bucket: string;
    objectKey: string;
    reason: CreativeStorageCleanupReason;
    now: Date;
    deferUntil?: Date;
    attemptImmediateDelete?: boolean;
  },
  storage: CreativeObjectStorageProvider
): Promise<void> {
  if (params.bucket !== storage.bucket) {
    return;
  }
  assertCreativeKeyEnvPrefix(params.objectKey, storage.envPrefix);

  const deferUntil = params.deferUntil ?? params.now;
  const mustStayPendingUntilExpiry = deferUntil.getTime() > params.now.getTime();

  const cleanup = await prisma.creativeStorageCleanup.upsert({
    where: { objectKey: params.objectKey },
    create: {
      organisationId: params.organisationId,
      bucket: params.bucket,
      objectKey: params.objectKey,
      reason: params.reason,
      status: 'PENDING',
      attempts: 0,
      nextRetryAt: deferUntil,
    },
    update: {
      reason: params.reason,
      status: 'PENDING',
      nextRetryAt: deferUntil,
      resolvedAt: null,
    },
  });

  if (params.attemptImmediateDelete === false) {
    return;
  }

  try {
    await storage.deleteObject(params.objectKey);
    if (mustStayPendingUntilExpiry) {
      // Keep cleanup PENDING until the presigned PUT URL + grace window has elapsed,
      // because a late PUT before expiry could recreate the object.
      await prisma.creativeStorageCleanup.update({
        where: { id: cleanup.id },
        data: {
          status: 'PENDING',
          attempts: cleanup.attempts + 1,
          lastError: null,
          nextRetryAt: deferUntil,
          resolvedAt: null,
        },
      });
    } else {
      await prisma.creativeStorageCleanup.update({
        where: { id: cleanup.id },
        data: {
          status: 'COMPLETED',
          attempts: cleanup.attempts + 1,
          lastError: null,
          resolvedAt: new Date(),
        },
      });
    }
  } catch (err) {
    const errorName = err instanceof Error ? err.name : 'CleanupDeleteError';
    const retryAt = computeNextRetryAt(cleanup.attempts + 1, params.now);
    await prisma.creativeStorageCleanup.update({
      where: { id: cleanup.id },
      data: {
        status: 'PENDING',
        attempts: cleanup.attempts + 1,
        lastError: errorName.slice(0, 120),
        nextRetryAt:
          retryAt.getTime() > deferUntil.getTime() ? retryAt : deferUntil,
      },
    });
  }
}

async function rejectUploadIntentWithCleanup(
  intent: {
    id: string;
    organisationId: string;
    storageBucket: string;
    storageKey: string;
    expiresAt?: Date;
  },
  reason: string,
  now: Date,
  storage: CreativeObjectStorageProvider,
  deleteObjectFromStorage: boolean
): Promise<void> {
  await prisma.creativeUploadIntent.updateMany({
    where: {
      id: intent.id,
      organisationId: intent.organisationId,
      status: 'PENDING',
    },
    data: {
      status: 'REJECTED',
      rejectionReason: reason.slice(0, 300),
    },
  });

  if (deleteObjectFromStorage) {
    await enqueueAndAttemptCreativeCleanup(
      {
        organisationId: intent.organisationId,
        bucket: intent.storageBucket,
        objectKey: intent.storageKey,
        reason: 'UPLOAD_REJECTED',
        now,
        deferUntil: computeCleanupDeferUntil(intent.expiresAt, now),
        attemptImmediateDelete: true,
      },
      storage
    );
  }
}

export async function createTemplate(
  actor: TemplateActorContext,
  input: CreateTemplateInput
): Promise<TemplateDetail> {
  const normalizedName = normalizeTemplateName(input.name);

  const created = await prisma.$transaction(async (tx) => {
    const template = await tx.template.create({
      data: {
        organisationId: actor.organisationId,
        name: input.name.trim(),
        normalizedName,
        category: input.category,
        studioType: input.studioType,
        description: input.description ?? null,
        createdByUserId: actor.userId,
        isActive: true,
      },
    });

    await auditService.recordAuditEvent(tx, {
      organisationId: actor.organisationId,
      actorUserId: actor.userId,
      action: auditService.AUDIT_ACTIONS.TEMPLATE_CREATED,
      entityType: 'Template',
      entityId: template.id,
      metadata: {
        category: template.category,
        studioType: template.studioType,
      },
    });

    return template;
  }, { maxWait: 10_000, timeout: 20_000 });

  return getTemplateDetail(actor.organisationId, created.id);
}

export async function listTemplates(
  organisationId: string,
  query: TemplateListQuery
): Promise<{
  items: TemplateSummary[];
  total: number;
  page: number;
  pageSize: number;
}> {
  const where: Prisma.TemplateWhereInput = {
    organisationId,
  };

  if (!query.includeArchived) {
    where.archivedAt = null;
    where.isActive = true;
  }
  if (query.category !== 'ALL') {
    where.category = query.category;
  }
  if (query.studioType !== 'ALL') {
    where.studioType = query.studioType;
  }
  if (query.q.trim().length > 0) {
    const qNorm = normalizeTemplateName(query.q);
    where.OR = [
      { normalizedName: { contains: qNorm, mode: 'insensitive' } },
      { name: { contains: query.q.trim(), mode: 'insensitive' } },
    ];
  }

  const skip = (query.page - 1) * query.pageSize;

  const [total, rows] = await Promise.all([
    prisma.template.count({ where }),
    prisma.template.findMany({
      where,
      orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }],
      skip,
      take: query.pageSize,
      select: {
        id: true,
        name: true,
        category: true,
        studioType: true,
        description: true,
        isActive: true,
        archivedAt: true,
        createdAt: true,
        updatedAt: true,
        activeVersion: { select: VERSION_SUMMARY_SELECT },
        _count: { select: { versions: true } },
      },
    }),
  ]);

  return {
    items: rows.map((row) => ({
      id: row.id,
      name: row.name,
      category: row.category,
      studioType: row.studioType,
      description: row.description,
      isActive: row.isActive,
      archivedAt: row.archivedAt ? row.archivedAt.toISOString() : null,
      activeVersion: row.activeVersion ? mapVersionSummary(row.activeVersion) : null,
      versionCount: row._count.versions,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    })),
    total,
    page: query.page,
    pageSize: query.pageSize,
  };
}

export async function getTemplateDetail(
  organisationId: string,
  templateId: string
): Promise<TemplateDetail> {
  const row = await prisma.template.findFirst({
    where: { id: templateId, organisationId },
    select: {
      id: true,
      name: true,
      category: true,
      studioType: true,
      description: true,
      isActive: true,
      archivedAt: true,
      createdAt: true,
      updatedAt: true,
      activeVersion: {
        select: {
          ...VERSION_SUMMARY_SELECT,
          fieldMappings: {
            orderBy: { fieldKey: 'asc' },
            select: MAPPING_SUMMARY_SELECT,
          },
        },
      },
      versions: {
        orderBy: { versionNumber: 'desc' },
        select: VERSION_SUMMARY_SELECT,
      },
    },
  });

  if (!row) {
    throw new TemplateNotFoundError();
  }

  return {
    id: row.id,
    name: row.name,
    category: row.category,
    studioType: row.studioType,
    description: row.description,
    isActive: row.isActive,
    archivedAt: row.archivedAt ? row.archivedAt.toISOString() : null,
    activeVersion: row.activeVersion ? mapVersionSummary(row.activeVersion) : null,
    versionCount: row.versions.length,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    versions: row.versions.map(mapVersionSummary),
    activeMappings: row.activeVersion
      ? row.activeVersion.fieldMappings.map(mapMappingSummary)
      : [],
  };
}

export async function getTemplateVersionDetail(
  organisationId: string,
  templateId: string,
  versionId: string
): Promise<TemplateVersionDetail> {
  const row = await prisma.templateVersion.findFirst({
    where: {
      id: versionId,
      templateId,
      organisationId,
    },
    select: {
      ...VERSION_SUMMARY_SELECT,
      detectedLayersJson: true,
      fieldMappings: {
        orderBy: { fieldKey: 'asc' },
        select: MAPPING_SUMMARY_SELECT,
      },
    },
  });

  if (!row) {
    throw new TemplateVersionNotFoundError();
  }

  let detectedLayers: PsdInspectionResult | null = null;
  if (row.detectedLayersJson !== null) {
    const parsed = psdInspectionResultSchema.safeParse(row.detectedLayersJson);
    if (parsed.success) {
      detectedLayers = parsed.data;
    }
  }

  return {
    ...mapVersionSummary(row),
    detectedLayers,
    mappings: row.fieldMappings.map(mapMappingSummary),
  };
}

export async function getTemplateVersionPreview(
  organisationId: string,
  templateId: string,
  versionId: string,
  deps: TemplateServiceDependencies = {}
): Promise<{ body: Uint8Array; mimeType: string; byteSize: number }> {
  const storage = deps.storage ?? createCreativeObjectStorageProvider();
  const row = await prisma.templateVersion.findFirst({
    where: {
      id: versionId,
      templateId,
      organisationId,
    },
    select: {
      versionNumber: true,
      storageBucket: true,
      previewStorageKey: true,
      previewMimeType: true,
      previewByteSize: true,
    },
  });

  if (!row) {
    throw new TemplateVersionNotFoundError();
  }
  if (!row.previewStorageKey || !row.previewMimeType) {
    throw new TemplateNotFoundError();
  }
  if (row.storageBucket !== storage.bucket) {
    throw new TemplateValidationError('Template preview bucket mismatch.');
  }

  assertKeyMatchesTemplatePreviewScope(row.previewStorageKey, {
    envPrefix: storage.envPrefix,
    organisationId,
    templateId,
    versionNumber: row.versionNumber,
  });

  const object = await storage.getObjectBounded(
    row.previewStorageKey,
    CREATIVE_BYTE_LIMITS.TEMPLATE_PREVIEW_MAX_BYTES
  );

  return {
    body: object.body,
    mimeType: row.previewMimeType,
    byteSize: row.previewByteSize ?? object.body.byteLength,
  };
}

export async function updateTemplate(
  actor: TemplateActorContext,
  templateId: string,
  input: UpdateTemplateInput,
  deps: TemplateServiceDependencies = {}
): Promise<TemplateDetail> {
  const now = (deps.now ?? (() => new Date()))();

  await prisma.$transaction(async (tx) => {
    const lockedRows = await tx.$queryRaw<
      Array<{
        id: string;
        active_version_id: string | null;
        is_active: boolean;
        archived_at: Date | null;
      }>
    >`
      SELECT id, active_version_id, is_active, archived_at
      FROM templates
      WHERE id = ${templateId} AND organisation_id = ${actor.organisationId}
      FOR UPDATE
    `;

    const existing = lockedRows[0];
    if (!existing) {
      throw new TemplateNotFoundError();
    }

    if (input.activeVersionId !== undefined && input.activeVersionId !== null) {
      const targetVersion = await tx.templateVersion.findFirst({
        where: {
          id: input.activeVersionId,
          templateId,
          organisationId: actor.organisationId,
        },
        select: { id: true, versionNumber: true },
      });
      if (!targetVersion) {
        throw new TemplateVersionNotFoundError();
      }
    }

    const updateData: Prisma.TemplateUpdateInput = {};
    if (input.name !== undefined) {
      updateData.name = input.name.trim();
      updateData.normalizedName = normalizeTemplateName(input.name);
    }
    if (input.category !== undefined) {
      updateData.category = input.category;
    }
    if (input.studioType !== undefined) {
      updateData.studioType = input.studioType;
    }
    if (input.description !== undefined) {
      updateData.description = input.description;
    }
    if (input.activeVersionId !== undefined) {
      updateData.activeVersion =
        input.activeVersionId === null
          ? { disconnect: true }
          : { connect: { id: input.activeVersionId } };
    }

    let archivedTransition: 'ARCHIVED' | 'RESTORED' | null = null;
    if (input.isActive !== undefined) {
      updateData.isActive = input.isActive;
      if (!input.isActive && !existing.archived_at) {
        updateData.archivedAt = now;
        archivedTransition = 'ARCHIVED';
      } else if (input.isActive && existing.archived_at) {
        updateData.archivedAt = null;
        archivedTransition = 'RESTORED';
      }
    }

    await tx.template.update({
      where: { id: existing.id },
      data: updateData,
    });

    if (
      input.activeVersionId !== undefined &&
      input.activeVersionId !== existing.active_version_id
    ) {
      await auditService.recordAuditEvent(tx, {
        organisationId: actor.organisationId,
        actorUserId: actor.userId,
        action: auditService.AUDIT_ACTIONS.TEMPLATE_VERSION_ACTIVATED,
        entityType: 'Template',
        entityId: existing.id,
        metadata: {
          previousVersionId: existing.active_version_id,
          activeVersionId: input.activeVersionId,
        },
      });
    }

    if (archivedTransition === 'ARCHIVED') {
      await auditService.recordAuditEvent(tx, {
        organisationId: actor.organisationId,
        actorUserId: actor.userId,
        action: auditService.AUDIT_ACTIONS.TEMPLATE_ARCHIVED,
        entityType: 'Template',
        entityId: existing.id,
        metadata: { isActive: false },
      });
    } else if (archivedTransition === 'RESTORED') {
      await auditService.recordAuditEvent(tx, {
        organisationId: actor.organisationId,
        actorUserId: actor.userId,
        action: auditService.AUDIT_ACTIONS.TEMPLATE_RESTORED,
        entityType: 'Template',
        entityId: existing.id,
        metadata: { isActive: true },
      });
    } else if (
      input.name !== undefined ||
      input.category !== undefined ||
      input.studioType !== undefined ||
      input.description !== undefined
    ) {
      await auditService.recordAuditEvent(tx, {
        organisationId: actor.organisationId,
        actorUserId: actor.userId,
        action: auditService.AUDIT_ACTIONS.TEMPLATE_UPDATED,
        entityType: 'Template',
        entityId: existing.id,
        metadata: {
          updatedCategory: input.category ?? null,
          updatedStudioType: input.studioType ?? null,
        },
      });
    }
  }, { maxWait: 10_000, timeout: 20_000 });

  return getTemplateDetail(actor.organisationId, templateId);
}

export async function archiveTemplate(
  actor: TemplateActorContext,
  templateId: string,
  deps: TemplateServiceDependencies = {}
): Promise<TemplateDetail> {
  return updateTemplate(actor, templateId, { isActive: false }, deps);
}

export async function restoreTemplate(
  actor: TemplateActorContext,
  templateId: string,
  deps: TemplateServiceDependencies = {}
): Promise<TemplateDetail> {
  return updateTemplate(actor, templateId, { isActive: true }, deps);
}

export async function createTemplateUploadIntent(
  actor: TemplateActorContext,
  input:
    | ({ kind: 'TEMPLATE_MASTER' } & CreateTemplateVersionUploadIntentInput)
    | ({ kind: 'TEMPLATE_PREVIEW' } & CreateTemplatePreviewUploadIntentInput),
  deps: TemplateServiceDependencies = {}
): Promise<{
  intent: CreativeUploadIntentSummary;
  upload: PresignedUploadTarget;
}> {
  const storage = deps.storage ?? createCreativeObjectStorageProvider();
  const now = (deps.now ?? (() => new Date()))();

  const template = await prisma.template.findFirst({
    where: {
      id: input.templateId,
      organisationId: actor.organisationId,
    },
    select: {
      id: true,
      isActive: true,
      archivedAt: true,
      versions: {
        orderBy: { versionNumber: 'desc' },
        take: 1,
        select: { versionNumber: true },
      },
    },
  });

  if (!template) {
    throw new TemplateNotFoundError();
  }
  if (!template.isActive || template.archivedAt !== null) {
    throw new TemplateConflictError(
      'Archived templates cannot accept new uploads. Restore the template first.',
      'TEMPLATE_ARCHIVED'
    );
  }

  const maxAllowedBytes =
    input.kind === 'TEMPLATE_MASTER'
      ? CREATIVE_BYTE_LIMITS.TEMPLATE_MASTER_MAX_BYTES
      : CREATIVE_BYTE_LIMITS.TEMPLATE_PREVIEW_MAX_BYTES;

  if (input.byteSize <= 0 || input.byteSize > maxAllowedBytes) {
    throw new TemplateValidationError(
      `File byteSize must be between 1 and ${maxAllowedBytes} bytes.`
    );
  }

  const existingIntent = await prisma.creativeUploadIntent.findUnique({
    where: { idempotencyKey: input.idempotencyKey },
    select: {
      ...UPLOAD_INTENT_SUMMARY_SELECT,
      organisationId: true,
      storageBucket: true,
      storageKey: true,
      expectedSha256: true,
    },
  });

  if (existingIntent) {
    if (existingIntent.organisationId !== actor.organisationId) {
      throw new UploadIntentConflictError(
        'Idempotency key is unavailable.',
        'IDEMPOTENCY_KEY_CONFLICT'
      );
    }
    if (
      existingIntent.kind !== input.kind ||
      existingIntent.expectedMimeType !== input.mimeType ||
      existingIntent.expectedByteSize !== input.byteSize ||
      existingIntent.expectedSha256 !== input.sha256 ||
      !existingIntent.storageKey.includes(`/templates/${template.id}/`)
    ) {
      throw new UploadIntentConflictError(
        'Idempotency key does not match the original upload parameters.',
        'IDEMPOTENCY_KEY_MISMATCH'
      );
    }
    if (existingIntent.status !== 'PENDING') {
      throw new UploadIntentConflictError(
        `Upload intent is already ${existingIntent.status} and cannot be replayed.`,
        'UPLOAD_INTENT_NOT_REUSABLE'
      );
    }
    if (existingIntent.expiresAt <= now) {
      await prisma.creativeUploadIntent.updateMany({
        where: {
          id: existingIntent.id,
          organisationId: actor.organisationId,
          status: 'PENDING',
        },
        data: { status: 'EXPIRED' },
      });
      throw new UploadIntentExpiredError();
    }

    const remainingSeconds = Math.max(
      60,
      Math.floor((existingIntent.expiresAt.getTime() - now.getTime()) / 1000)
    );
    const presigned = await storage.createPresignedPutUrl({
      key: existingIntent.storageKey,
      contentType: existingIntent.expectedMimeType,
      contentLength: existingIntent.expectedByteSize,
      expiresInSeconds: remainingSeconds,
    });

    return {
      intent: mapUploadIntentSummary(existingIntent),
      upload: {
        url: presigned.url,
        method: 'PUT',
        requiredHeaders: presigned.requiredHeaders,
        expiresAt: existingIntent.expiresAt.toISOString(),
      },
    };
  }

  let storageKey: string;
  if (input.kind === 'TEMPLATE_MASTER') {
    const ext = extractNormalizedFileExtension(input.originalFilename);
    if (!ext) {
      throw new TemplateValidationError('Master filename must include a valid extension.');
    }
    storageKey = buildTemplateMasterStagingObjectKey({
      envPrefix: storage.envPrefix,
      organisationId: actor.organisationId,
      templateId: template.id,
      extension: ext as CreativeMasterExtension,
    });
  } else {
    storageKey = buildTemplatePreviewStagingObjectKey({
      envPrefix: storage.envPrefix,
      organisationId: actor.organisationId,
      templateId: template.id,
      extension: previewExtensionFromMime(input.mimeType),
    });
  }

  const expiresAt = new Date(
    now.getTime() + CREATIVE_BYTE_LIMITS.UPLOAD_INTENT_TTL_SECONDS * 1000
  );

  const created = await prisma.creativeUploadIntent.create({
    data: {
      organisationId: actor.organisationId,
      requestedByUserId: actor.userId,
      kind: input.kind,
      idempotencyKey: input.idempotencyKey,
      storageBucket: storage.bucket,
      storageKey,
      expectedMimeType: input.mimeType,
      expectedByteSize: input.byteSize,
      expectedSha256: input.sha256,
      maxAllowedBytes,
      status: 'PENDING',
      expiresAt,
    },
    select: UPLOAD_INTENT_SUMMARY_SELECT,
  });

  const presigned = await storage.createPresignedPutUrl({
    key: storageKey,
    contentType: input.mimeType,
    contentLength: input.byteSize,
    expiresInSeconds: CREATIVE_BYTE_LIMITS.UPLOAD_INTENT_TTL_SECONDS,
  });

  return {
    intent: mapUploadIntentSummary(created),
    upload: {
      url: presigned.url,
      method: 'PUT',
      requiredHeaders: presigned.requiredHeaders,
      expiresAt: expiresAt.toISOString(),
    },
  };
}

export async function completeTemplateVersionUpload(
  actor: TemplateActorContext,
  templateId: string,
  input: CompleteTemplateVersionUploadInput,
  deps: TemplateServiceDependencies = {}
): Promise<{
  template: TemplateDetail;
  version: TemplateVersionDetail;
  inspection: PsdInspectionResult | null;
  editabilityVerified: false;
}> {
  const storage = deps.storage ?? createCreativeObjectStorageProvider();
  const now = (deps.now ?? (() => new Date()))();

  const templateExists = await prisma.template.findFirst({
    where: { id: templateId, organisationId: actor.organisationId },
    select: { id: true, isActive: true, archivedAt: true },
  });
  if (!templateExists) {
    throw new TemplateNotFoundError();
  }
  if (!templateExists.isActive || templateExists.archivedAt !== null) {
    throw new TemplateConflictError(
      'Archived templates cannot register new versions. Restore the template first.',
      'TEMPLATE_ARCHIVED'
    );
  }

  const masterIntent = await prisma.creativeUploadIntent.findFirst({
    where: {
      id: input.uploadIntentId,
      organisationId: actor.organisationId,
    },
  });
  if (!masterIntent) {
    throw new UploadIntentNotFoundError();
  }
  if (masterIntent.kind !== 'TEMPLATE_MASTER') {
    throw new TemplateValidationError(
      'uploadIntentId must refer to a TEMPLATE_MASTER upload intent.'
    );
  }
  if (masterIntent.status !== 'PENDING') {
    throw new UploadIntentConflictError(
      `Upload intent is ${masterIntent.status} and cannot be completed again.`,
      'UPLOAD_INTENT_NOT_REUSABLE'
    );
  }
  if (masterIntent.expiresAt <= now) {
    await prisma.creativeUploadIntent.updateMany({
      where: {
        id: masterIntent.id,
        organisationId: actor.organisationId,
        status: 'PENDING',
      },
      data: { status: 'EXPIRED' },
    });
    const head = await storage.headObject(masterIntent.storageKey).catch(() => ({
      exists: false,
    }));
    if (head.exists) {
      await enqueueAndAttemptCreativeCleanup(
        {
          organisationId: actor.organisationId,
          bucket: masterIntent.storageBucket,
          objectKey: masterIntent.storageKey,
          reason: 'UPLOAD_ABANDONED',
          now,
        },
        storage
      );
    }
    throw new UploadIntentExpiredError();
  }
  if (masterIntent.storageBucket !== storage.bucket) {
    throw new TemplateValidationError('Upload intent storage bucket mismatch.');
  }

  assertKeyMatchesTemplateMasterStagingScope(masterIntent.storageKey, {
    envPrefix: storage.envPrefix,
    organisationId: actor.organisationId,
    templateId,
  });

  const head = await storage.headObject(masterIntent.storageKey);
  if (!head.exists) {
    throw new TemplateValidationError(
      'Uploaded template file was not found in private storage.',
      'UPLOAD_OBJECT_NOT_FOUND'
    );
  }
  if (
    head.contentLength !== undefined &&
    head.contentLength > masterIntent.maxAllowedBytes
  ) {
    await rejectUploadIntentWithCleanup(
      masterIntent,
      'Uploaded template exceeds maximum allowed size.',
      now,
      storage,
      true
    );
    throw new TemplateValidationError(
      'Uploaded template exceeds maximum allowed size.',
      'UPLOAD_SIZE_EXCEEDED'
    );
  }

  let masterBytes: Uint8Array;
  try {
    const obj = await storage.getObjectBounded(
      masterIntent.storageKey,
      masterIntent.maxAllowedBytes
    );
    masterBytes = obj.body;
  } catch (err) {
    if (err instanceof CreativeObjectTooLargeError) {
      await rejectUploadIntentWithCleanup(
        masterIntent,
        err.message,
        now,
        storage,
        true
      );
      throw new TemplateValidationError(err.message, 'UPLOAD_SIZE_EXCEEDED');
    }
    throw err;
  }

  const actualByteSize = masterBytes.byteLength;
  if (actualByteSize <= 0 || actualByteSize !== masterIntent.expectedByteSize) {
    await rejectUploadIntentWithCleanup(
      masterIntent,
      `Uploaded byte size (${actualByteSize}) does not match expectedByteSize (${masterIntent.expectedByteSize}).`,
      now,
      storage,
      true
    );
    throw new TemplateValidationError(
      'Uploaded template byte size does not match declared upload intent.',
      'UPLOAD_SIZE_MISMATCH'
    );
  }

  const actualSha256 = crypto.createHash('sha256').update(masterBytes).digest('hex');
  if (masterIntent.expectedSha256 && actualSha256 !== masterIntent.expectedSha256) {
    await rejectUploadIntentWithCleanup(
      masterIntent,
      'Uploaded template SHA-256 checksum does not match declared upload intent.',
      now,
      storage,
      true
    );
    throw new TemplateValidationError(
      'Uploaded template SHA-256 checksum mismatch.',
      'UPLOAD_CHECKSUM_MISMATCH'
    );
  }

  const format = formatFromVerifiedMasterKey(masterIntent.storageKey);
  const capabilities = getTemplateFormatCapabilities(format);
  const leafFilename =
    masterIntent.storageKey.split('/').pop() ?? `template.${format.toLowerCase()}`;

  const inspectionResult: PsdInspectionResult | null = null;
  let widthPx: number | null = input.widthPx ?? null;
  let heightPx: number | null = input.heightPx ?? null;
  const inspectionStatus: 'MANUAL_REQUIRED' =
    capabilities.recommendedDefaultInspectionStatus === 'MANUAL_REQUIRED'
      ? 'MANUAL_REQUIRED'
      : 'MANUAL_REQUIRED';
  let inspectionSummary =
    'Native Affinity document registered; manual layer mapping required in Affinity 3.3.';
  const inspectedAt: Date | null = null;

  if (format === 'PSD') {
    try {
      const psdHeader = validatePsdHeader(
        masterBytes,
        masterIntent.maxAllowedBytes
      );
      widthPx = input.widthPx ?? psdHeader.widthPx;
      heightPx = input.heightPx ?? psdHeader.heightPx;
      inspectionSummary =
        'PSD header validated; automatic layer inspection is disabled for safety. Complete layer inspection and field mapping manually in Affinity.';
    } catch (err) {
      const reason =
        err instanceof PsdInspectionError
          ? err.message
          : 'Uploaded PSD file could not be validated safely.';
      await rejectUploadIntentWithCleanup(masterIntent, reason, now, storage, true);
      throw new TemplateValidationError(reason, 'INVALID_PSD_FILE');
    }
  }

  // Optional preview upload verification
  let verifiedPreview: {
    intentId: string;
    storageKey: string;
    mimeType: string;
    byteSize: number;
    sha256: string;
    bytes: Uint8Array;
    expiresAt: Date;
  } | null = null;

  if (input.previewUploadIntentId) {
    const previewIntent = await prisma.creativeUploadIntent.findFirst({
      where: {
        id: input.previewUploadIntentId,
        organisationId: actor.organisationId,
      },
    });
    if (!previewIntent) {
      throw new UploadIntentNotFoundError();
    }
    if (previewIntent.kind !== 'TEMPLATE_PREVIEW') {
      throw new TemplateValidationError(
        'previewUploadIntentId must refer to a TEMPLATE_PREVIEW upload intent.'
      );
    }
    if (previewIntent.status !== 'PENDING') {
      throw new UploadIntentConflictError(
        `Preview upload intent is ${previewIntent.status} and cannot be replayed.`,
        'UPLOAD_INTENT_NOT_REUSABLE'
      );
    }
    if (previewIntent.expiresAt <= now) {
      await prisma.creativeUploadIntent.updateMany({
        where: {
          id: previewIntent.id,
          organisationId: actor.organisationId,
          status: 'PENDING',
        },
        data: { status: 'EXPIRED' },
      });
      throw new UploadIntentExpiredError();
    }
    if (previewIntent.storageBucket !== storage.bucket) {
      throw new TemplateValidationError('Preview upload intent storage bucket mismatch.');
    }

    assertKeyMatchesTemplatePreviewStagingScope(previewIntent.storageKey, {
      envPrefix: storage.envPrefix,
      organisationId: actor.organisationId,
      templateId,
    });

    const previewHead = await storage.headObject(previewIntent.storageKey);
    if (!previewHead.exists) {
      throw new TemplateValidationError(
        'Uploaded template preview was not found in private storage.',
        'PREVIEW_OBJECT_NOT_FOUND'
      );
    }

    let previewBytes: Uint8Array;
    try {
      const obj = await storage.getObjectBounded(
        previewIntent.storageKey,
        previewIntent.maxAllowedBytes
      );
      previewBytes = obj.body;
    } catch (err) {
      if (err instanceof CreativeObjectTooLargeError) {
        await rejectUploadIntentWithCleanup(
          previewIntent,
          err.message,
          now,
          storage,
          true
        );
        throw new TemplateValidationError(err.message, 'UPLOAD_SIZE_EXCEEDED');
      }
      throw err;
    }

    if (
      previewBytes.byteLength <= 0 ||
      previewBytes.byteLength !== previewIntent.expectedByteSize
    ) {
      await rejectUploadIntentWithCleanup(
        previewIntent,
        'Uploaded preview byte size mismatch.',
        now,
        storage,
        true
      );
      throw new TemplateValidationError(
        'Uploaded preview byte size does not match declared upload intent.',
        'UPLOAD_SIZE_MISMATCH'
      );
    }

    const previewSha256 = crypto
      .createHash('sha256')
      .update(previewBytes)
      .digest('hex');
    if (previewIntent.expectedSha256 && previewSha256 !== previewIntent.expectedSha256) {
      await rejectUploadIntentWithCleanup(
        previewIntent,
        'Uploaded preview SHA-256 mismatch.',
        now,
        storage,
        true
      );
      throw new TemplateValidationError(
        'Uploaded preview SHA-256 checksum mismatch.',
        'UPLOAD_CHECKSUM_MISMATCH'
      );
    }

    const detectedMime = detectPreviewImageMagicMime(previewBytes);
    if (!detectedMime || detectedMime !== previewIntent.expectedMimeType) {
      await rejectUploadIntentWithCleanup(
        previewIntent,
        'Uploaded preview bytes do not match declared image MIME type.',
        now,
        storage,
        true
      );
      throw new TemplateValidationError(
        'Uploaded preview image content does not match declared MIME type.',
        'INVALID_PREVIEW_IMAGE'
      );
    }

    try {
      const meta = await sharp(previewBytes).metadata();
      if (
        !meta.width ||
        !meta.height ||
        meta.width > MAX_PREVIEW_DIMENSION_PX ||
        meta.height > MAX_PREVIEW_DIMENSION_PX
      ) {
        throw new Error('Invalid preview image dimensions');
      }
    } catch {
      await rejectUploadIntentWithCleanup(
        previewIntent,
        'Uploaded preview image is malformed or unreadable.',
        now,
        storage,
        true
      );
      throw new TemplateValidationError(
        'Uploaded preview image is malformed.',
        'INVALID_PREVIEW_IMAGE'
      );
    }

    verifiedPreview = {
      intentId: previewIntent.id,
      storageKey: previewIntent.storageKey,
      mimeType: previewIntent.expectedMimeType,
      byteSize: previewBytes.byteLength,
      sha256: previewSha256,
      bytes: previewBytes,
      expiresAt: previewIntent.expiresAt,
    };
  }

  const masterExt = format.toLowerCase() as CreativeMasterExtension;
  const promotedKeys: string[] = [];
  let createdVersionId: string;
  try {
    createdVersionId = await prisma.$transaction(async (tx) => {
      const lockedTemplates = await tx.$queryRaw<
        Array<{ id: string; is_active: boolean; archived_at: Date | null }>
      >`
        SELECT id, is_active, archived_at
        FROM templates
        WHERE id = ${templateId} AND organisation_id = ${actor.organisationId}
        FOR UPDATE
      `;
      const lockedTemplate = lockedTemplates[0];
      if (!lockedTemplate) {
        throw new TemplateNotFoundError();
      }
      if (!lockedTemplate.is_active || lockedTemplate.archived_at !== null) {
        throw new TemplateConflictError(
          'Archived templates cannot register new versions. Restore the template first.',
          'TEMPLATE_ARCHIVED'
        );
      }

      const claimedMaster = await tx.creativeUploadIntent.updateMany({
        where: {
          id: masterIntent.id,
          organisationId: actor.organisationId,
          status: 'PENDING',
        },
        data: {
          status: 'VERIFIED',
          verifiedByteSize: actualByteSize,
          verifiedSha256: actualSha256,
          verifiedAt: now,
        },
      });
      if (claimedMaster.count !== 1) {
        throw new UploadIntentConflictError(
          'Upload intent has already been processed.',
          'UPLOAD_INTENT_NOT_REUSABLE'
        );
      }

      if (verifiedPreview) {
        const claimedPreview = await tx.creativeUploadIntent.updateMany({
          where: {
            id: verifiedPreview.intentId,
            organisationId: actor.organisationId,
            status: 'PENDING',
          },
          data: {
            status: 'VERIFIED',
            verifiedByteSize: verifiedPreview.byteSize,
            verifiedSha256: verifiedPreview.sha256,
            verifiedAt: now,
          },
        });
        if (claimedPreview.count !== 1) {
          throw new UploadIntentConflictError(
            'Preview upload intent has already been processed.',
            'UPLOAD_INTENT_NOT_REUSABLE'
          );
        }
      }

      const latestVersion = await tx.templateVersion.findFirst({
        where: { templateId, organisationId: actor.organisationId },
        orderBy: { versionNumber: 'desc' },
        select: { versionNumber: true },
      });
      const nextVersionNumber = (latestVersion?.versionNumber ?? 0) + 1;

      const finalMasterKey = buildTemplateMasterObjectKey({
        envPrefix: storage.envPrefix,
        organisationId: actor.organisationId,
        templateId,
        versionNumber: nextVersionNumber,
        extension: masterExt,
      });
      assertKeyMatchesTemplateMasterScope(finalMasterKey, {
        envPrefix: storage.envPrefix,
        organisationId: actor.organisationId,
        templateId,
        versionNumber: nextVersionNumber,
      });
      const existingMasterHead = await storage.headObject(finalMasterKey);
      if (existingMasterHead.exists) {
        throw new TemplateConflictError(
          'Target template version storage object already exists.',
          'VERSION_STORAGE_KEY_COLLISION'
        );
      }
      await storage.putPrivateObject({
        key: finalMasterKey,
        body: masterBytes,
        contentType: masterIntent.expectedMimeType,
      });
      promotedKeys.push(finalMasterKey);

      let finalPreviewKey: string | null = null;
      if (verifiedPreview) {
        finalPreviewKey = buildTemplatePreviewObjectKey({
          envPrefix: storage.envPrefix,
          organisationId: actor.organisationId,
          templateId,
          versionNumber: nextVersionNumber,
          extension: previewExtensionFromMime(verifiedPreview.mimeType),
        });
        assertKeyMatchesTemplatePreviewScope(finalPreviewKey, {
          envPrefix: storage.envPrefix,
          organisationId: actor.organisationId,
          templateId,
          versionNumber: nextVersionNumber,
        });
        const existingPreviewHead = await storage.headObject(finalPreviewKey);
        if (existingPreviewHead.exists) {
          throw new TemplateConflictError(
            'Target template preview storage object already exists.',
            'VERSION_STORAGE_KEY_COLLISION'
          );
        }
        await storage.putPrivateObject({
          key: finalPreviewKey,
          body: verifiedPreview.bytes,
          contentType: verifiedPreview.mimeType,
        });
        promotedKeys.push(finalPreviewKey);
      }

      const version = await tx.templateVersion.create({
        data: {
          organisationId: actor.organisationId,
          templateId,
          versionNumber: nextVersionNumber,
          format,
          storageBucket: masterIntent.storageBucket,
          storageKey: finalMasterKey,
          previewStorageKey: finalPreviewKey,
          previewMimeType: verifiedPreview?.mimeType ?? null,
          previewByteSize: verifiedPreview?.byteSize ?? null,
          originalFilename: leafFilename,
          mimeType: masterIntent.expectedMimeType,
          byteSize: actualByteSize,
          sha256: actualSha256,
          widthPx,
          heightPx,
          inspectionStatus,
          inspectionSummary,
          detectedLayersJson:
            inspectionResult === null
              ? Prisma.JsonNull
              : (inspectionResult as unknown as Prisma.InputJsonValue),
          inspectedAt,
          uploadedByUserId: actor.userId,
          uploadIntentId: masterIntent.id,
        },
      });

      if (input.activateImmediately) {
        await tx.template.update({
          where: { id: templateId },
          data: { activeVersionId: version.id },
        });
      }

      await auditService.recordAuditEvent(tx, {
        organisationId: actor.organisationId,
        actorUserId: actor.userId,
        action: auditService.AUDIT_ACTIONS.TEMPLATE_VERSION_UPLOADED,
        entityType: 'TemplateVersion',
        entityId: version.id,
        metadata: {
          templateId,
          versionNumber: nextVersionNumber,
          format,
          byteSize: actualByteSize,
          inspectionStatus,
          activated: input.activateImmediately,
        },
      });

      if (input.activateImmediately) {
        await auditService.recordAuditEvent(tx, {
          organisationId: actor.organisationId,
          actorUserId: actor.userId,
          action: auditService.AUDIT_ACTIONS.TEMPLATE_VERSION_ACTIVATED,
          entityType: 'Template',
          entityId: templateId,
          metadata: {
            activeVersionId: version.id,
            versionNumber: nextVersionNumber,
          },
        });
      }

      return version.id;
    }, { maxWait: 10_000, timeout: 20_000 });
  } catch (err) {
    for (const key of promotedKeys) {
      await enqueueAndAttemptCreativeCleanup(
        {
          organisationId: actor.organisationId,
          bucket: storage.bucket,
          objectKey: key,
          reason: 'TEMPLATE_VERSION_RETIRED',
          now,
          attemptImmediateDelete: true,
        },
        storage
      ).catch(() => {});
    }
    throw err;
  }

  // Schedule post-expiry cleanup for temporary staging keys so late PUTs before
  // URL expiry cannot leave orphaned staging objects.
  await enqueueAndAttemptCreativeCleanup(
    {
      organisationId: actor.organisationId,
      bucket: masterIntent.storageBucket,
      objectKey: masterIntent.storageKey,
      reason: 'TEMPLATE_VERSION_RETIRED',
      now,
      deferUntil: computeCleanupDeferUntil(masterIntent.expiresAt, now),
      attemptImmediateDelete: false,
    },
    storage
  ).catch(() => {});

  if (verifiedPreview) {
    await enqueueAndAttemptCreativeCleanup(
      {
        organisationId: actor.organisationId,
        bucket: masterIntent.storageBucket,
        objectKey: verifiedPreview.storageKey,
        reason: 'TEMPLATE_VERSION_RETIRED',
        now,
        deferUntil: computeCleanupDeferUntil(verifiedPreview.expiresAt, now),
        attemptImmediateDelete: false,
      },
      storage
    ).catch(() => {});
  }

  const [template, version] = await Promise.all([
    getTemplateDetail(actor.organisationId, templateId),
    getTemplateVersionDetail(actor.organisationId, templateId, createdVersionId),
  ]);

  return {
    template,
    version,
    inspection: inspectionResult,
    editabilityVerified: false,
  };
}

export async function abandonUploadIntent(
  actor: TemplateActorContext,
  intentId: string,
  deps: TemplateServiceDependencies = {}
): Promise<CreativeUploadIntentSummary> {
  const storage = deps.storage ?? createCreativeObjectStorageProvider();
  const now = (deps.now ?? (() => new Date()))();

  const intent = await prisma.creativeUploadIntent.findFirst({
    where: {
      id: intentId,
      organisationId: actor.organisationId,
    },
  });
  if (!intent) {
    throw new UploadIntentNotFoundError();
  }
  if (intent.status !== 'PENDING') {
    throw new UploadIntentConflictError(
      `Upload intent is ${intent.status} and cannot be abandoned.`,
      'UPLOAD_INTENT_NOT_REUSABLE'
    );
  }

  const updated = await prisma.creativeUploadIntent.update({
    where: { id: intent.id },
    data: { status: 'ABANDONED' },
    select: UPLOAD_INTENT_SUMMARY_SELECT,
  });

  const deferUntil = computeCleanupDeferUntil(intent.expiresAt, now);
  const head = await storage.headObject(intent.storageKey).catch(() => ({
    exists: false,
  }));

  // Always enqueue cleanup with nextRetryAt >= expiresAt + grace so a late PUT
  // before presigned URL expiry cannot leave an orphaned object.
  await enqueueAndAttemptCreativeCleanup(
    {
      organisationId: actor.organisationId,
      bucket: intent.storageBucket,
      objectKey: intent.storageKey,
      reason: 'UPLOAD_ABANDONED',
      now,
      deferUntil,
      attemptImmediateDelete: head.exists,
    },
    storage
  );

  return mapUploadIntentSummary(updated);
}

export async function upsertTemplateFieldMappings(
  actor: TemplateActorContext,
  templateId: string,
  input: UpsertTemplateFieldMappingsInput
): Promise<TemplateFieldMappingSummary[]> {
  await prisma.$transaction(async (tx) => {
    const version = await tx.templateVersion.findFirst({
      where: {
        id: input.templateVersionId,
        templateId,
        organisationId: actor.organisationId,
      },
      select: { id: true, versionNumber: true },
    });
    if (!version) {
      throw new TemplateVersionNotFoundError();
    }

    await tx.templateFieldMapping.deleteMany({
      where: {
        templateVersionId: version.id,
        organisationId: actor.organisationId,
      },
    });

    if (input.mappings.length > 0) {
      await tx.templateFieldMapping.createMany({
        data: input.mappings.map((mapping) => ({
          organisationId: actor.organisationId,
          templateVersionId: version.id,
          fieldKey: mapping.fieldKey,
          fieldType: mapping.fieldType,
          targetLayerName: mapping.targetLayerName,
          layerPathJson:
            mapping.layerPath === undefined || mapping.layerPath === null
              ? Prisma.JsonNull
              : (mapping.layerPath as unknown as Prisma.InputJsonValue),
          isRequired: mapping.isRequired,
          defaultValue: mapping.defaultValue ?? null,
          notes: mapping.notes ?? null,
        })),
      });
    }

    await auditService.recordAuditEvent(tx, {
      organisationId: actor.organisationId,
      actorUserId: actor.userId,
      action: auditService.AUDIT_ACTIONS.TEMPLATE_MAPPINGS_UPDATED,
      entityType: 'TemplateFieldMapping',
      entityId: version.id,
      metadata: {
        templateId,
        templateVersionId: version.id,
        mappingCount: input.mappings.length,
        fieldKeys: input.mappings.map((m) => m.fieldKey),
      },
    });
  }, { maxWait: 10_000, timeout: 20_000 });

  const rows = await prisma.templateFieldMapping.findMany({
    where: {
      templateVersionId: input.templateVersionId,
      organisationId: actor.organisationId,
    },
    orderBy: { fieldKey: 'asc' },
    select: MAPPING_SUMMARY_SELECT,
  });

  return rows.map(mapMappingSummary);
}

export async function cleanupPendingCreativeStorage(
  options: {
    organisationId?: string;
    limit?: number;
  } = {},
  deps: TemplateServiceDependencies = {}
): Promise<{ processed: number; resolved: number; failed: number }> {
  const storage = deps.storage ?? createCreativeObjectStorageProvider();
  const now = (deps.now ?? (() => new Date()))();
  const limit = Math.min(Math.max(1, options.limit ?? 25), 100);

  const pending = await prisma.creativeStorageCleanup.findMany({
    where: {
      status: 'PENDING',
      nextRetryAt: { lte: now },
      ...(options.organisationId ? { organisationId: options.organisationId } : {}),
    },
    orderBy: { nextRetryAt: 'asc' },
    take: limit,
  });

  let resolved = 0;
  let failed = 0;

  for (const item of pending) {
    if (item.bucket !== storage.bucket) {
      failed += 1;
      continue;
    }
    try {
      assertCreativeKeyEnvPrefix(item.objectKey, storage.envPrefix);

      // Never delete an object referenced by any verified TemplateVersion or ExportRecord.
      const [referencedVersion, referencedExport] = await Promise.all([
        prisma.templateVersion.findFirst({
          where: {
            OR: [
              { storageKey: item.objectKey },
              { previewStorageKey: item.objectKey },
            ],
          },
          select: { id: true },
        }),
        prisma.exportRecord.findFirst({
          where: { storageKey: item.objectKey },
          select: { id: true },
        }),
      ]);
      if (referencedVersion || referencedExport) {
        await prisma.creativeStorageCleanup.update({
          where: { id: item.id },
          data: {
            status: 'REJECTED',
            attempts: item.attempts + 1,
            lastError: 'REFERENCED_BY_ACTIVE_RECORD',
            resolvedAt: now,
          },
        });
        continue;
      }

      // Defer final deletion until any associated upload intent URL has expired + grace.
      const relatedIntent = await prisma.creativeUploadIntent.findUnique({
        where: { storageKey: item.objectKey },
        select: { expiresAt: true },
      });
      if (relatedIntent) {
        const deferUntil = computeCleanupDeferUntil(relatedIntent.expiresAt, now);
        if (deferUntil.getTime() > now.getTime()) {
          await prisma.creativeStorageCleanup.update({
            where: { id: item.id },
            data: {
              nextRetryAt: deferUntil,
            },
          });
          continue;
        }
      }

      await storage.deleteObject(item.objectKey);
      await prisma.creativeStorageCleanup.update({
        where: { id: item.id },
        data: {
          status: 'COMPLETED',
          attempts: item.attempts + 1,
          lastError: null,
          resolvedAt: now,
        },
      });
      resolved += 1;
    } catch (err) {
      const errorName = err instanceof Error ? err.name : 'CleanupDeleteError';
      await prisma.creativeStorageCleanup.update({
        where: { id: item.id },
        data: {
          status: 'PENDING',
          attempts: item.attempts + 1,
          lastError: errorName.slice(0, 120),
          nextRetryAt: computeNextRetryAt(item.attempts + 1, now),
        },
      });
      failed += 1;
    }
  }

  return { processed: pending.length, resolved, failed };
}
