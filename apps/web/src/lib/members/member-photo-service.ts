/**
 * CRELUNE — Private Member Photograph Lifecycle Service
 *
 * Coordinates Neon Object Storage operations with PostgreSQL member metadata,
 * transactional append-only audit logging, and durable cleanup retries:
 *  - Verifies organisation ownership on every read, upload, replacement, and deletion.
 *  - Accepts only processed, EXIF/metadata-stripped image bytes (`ProcessedMemberPhoto`).
 *  - Uploads & verifies new objects before committing Postgres updates.
 *  - Persists durable `PendingStorageCleanup` records whenever an orphan or obsolete
 *    object deletion fails, without exposing credentials, URLs, or blocking committed writes.
 *  - Validates every key against the approved environment, organisation, and member scope
 *    before read, enqueue, or deletion.
 */

import { prisma, type StorageCleanupReason } from '@crelune/database';
import {
  isMemberArchived,
  type MemberDetail,
  type MemberPhotoMimeType,
  type MemberPhotoSummary,
} from '@crelune/shared';
import * as auditService from '@/lib/audit/audit-service';
import {
  mapMemberDetail,
  MEMBER_DETAIL_SELECT,
  MemberNotFoundError,
  type MemberActorContext,
} from '@/lib/members/member-service';
import type { ProcessedMemberPhoto } from '@/lib/storage/image-processor';
import {
  createObjectStorageProvider,
  type ObjectStorageProvider,
} from '@/lib/storage/object-storage';
import {
  APPROVED_PROD_STORAGE_TARGET,
  assertKeyMatchesMemberScope,
  buildMemberPhotoObjectKey,
  StorageKeyViolationError,
} from '@/lib/storage/storage-config';

export class MemberPhotoNotFoundError extends Error {
  constructor() {
    super('Member photo not found.');
    this.name = 'MemberPhotoNotFoundError';
  }
}

export class MemberPhotoConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MemberPhotoConflictError';
  }
}

export interface RetrievedMemberPhoto {
  body: Uint8Array;
  contentType: string;
  byteSize: number;
  updatedAt: Date | null;
}

export interface UploadMemberPhotoResult {
  member: MemberDetail;
  photo: MemberPhotoSummary;
}

export interface DeleteMemberPhotoResult {
  member: MemberDetail;
  removed: boolean;
}

export interface RetryStorageCleanupsOptions {
  organisationId: string;
  memberId?: string;
  limit?: number;
  now?: Date;
  ignoreBackoff?: boolean;
}

export interface RetryStorageCleanupsResult {
  examined: number;
  succeeded: number;
  failed: number;
  rejected: number;
  skipped: number;
}

const DEFAULT_RETRY_DELAY_MS = 30_000;
const MAX_RETRY_DELAY_MS = 3_600_000;

function getStorageOrDefault(
  storage?: ObjectStorageProvider
): ObjectStorageProvider {
  return storage ?? createObjectStorageProvider();
}

/**
 * Formats external storage errors cleanly for database/log storage without
 * ever leaking URLs, object keys, bucket names, or credentials.
 */
function formatSafeCleanupError(err: unknown): string {
  if (!err || typeof err !== 'object') {
    return 'UnknownStorageError';
  }
  const errName =
    err instanceof Error && /^[A-Za-z0-9_]{1,40}$/.test(err.name)
      ? err.name
      : 'StorageError';
  const meta = (err as { $metadata?: { httpStatusCode?: number } }).$metadata;
  const status = meta?.httpStatusCode;
  if (typeof status === 'number' && Number.isInteger(status) && status >= 100 && status <= 599) {
    return `${errName}:${status}`.slice(0, 64);
  }
  return errName.slice(0, 64);
}

async function enqueuePendingStorageCleanup(params: {
  storage: ObjectStorageProvider;
  organisationId: string;
  memberId: string;
  storageKey: string;
  reason: StorageCleanupReason;
  error: unknown;
}): Promise<void> {
  // Never enqueue out-of-scope or arbitrary keys into durable cleanup storage
  assertKeyMatchesMemberScope(params.storageKey, {
    envPrefix: params.storage.envPrefix,
    organisationId: params.organisationId,
    memberId: params.memberId,
  });

  const safeError = formatSafeCleanupError(params.error);
  const nextRetryAt = new Date(Date.now() + DEFAULT_RETRY_DELAY_MS);

  await prisma.pendingStorageCleanup.upsert({
    where: { storageKey: params.storageKey },
    create: {
      organisationId: params.organisationId,
      memberId: params.memberId,
      storageKey: params.storageKey,
      reason: params.reason,
      status: 'PENDING',
      attemptCount: 1,
      lastError: safeError,
      nextRetryAt,
    },
    update: {
      reason: params.reason,
      status: 'PENDING',
      attemptCount: { increment: 1 },
      lastError: safeError,
      nextRetryAt,
      completedAt: null,
    },
  });
}

async function attemptDeleteOrEnqueue(params: {
  storage: ObjectStorageProvider;
  organisationId: string;
  memberId: string;
  key: string;
  reason: StorageCleanupReason;
}): Promise<void> {
  assertKeyMatchesMemberScope(params.key, {
    envPrefix: params.storage.envPrefix,
    organisationId: params.organisationId,
    memberId: params.memberId,
  });

  try {
    await params.storage.deleteObject(params.key);
  } catch (deleteErr) {
    const safeErrLabel = formatSafeCleanupError(deleteErr);
    try {
      await enqueuePendingStorageCleanup({
        storage: params.storage,
        organisationId: params.organisationId,
        memberId: params.memberId,
        storageKey: params.key,
        reason: params.reason,
        error: deleteErr,
      });
      console.error(
        `Queued durable storage cleanup (reason=${params.reason}, error=${safeErrLabel}).`
      );
    } catch (queueErr) {
      console.error(
        `Failed to enqueue durable storage cleanup (reason=${params.reason}, deleteError=${safeErrLabel}, queueError=${formatSafeCleanupError(queueErr)}).`
      );
    }
  }
}

/**
 * Uploads or replaces a member's private photograph using processed, metadata-stripped
 * bytes without risking data loss or broken DB pointers on storage or transaction failures.
 */
export async function uploadMemberPhoto(
  actor: MemberActorContext,
  memberId: string,
  processedPhoto: ProcessedMemberPhoto,
  storageProvider?: ObjectStorageProvider
): Promise<UploadMemberPhotoResult> {
  if (!processedPhoto.processed) {
    throw new Error('Refusing to store unprocessed image bytes without metadata sanitization.');
  }

  const storage = getStorageOrDefault(storageProvider);

  // Fail fast before transferring bytes to object storage if member is missing or archived
  const precheck = await prisma.member.findFirst({
    where: { id: memberId, organisationId: actor.organisationId },
    select: { id: true, archivedAt: true },
  });
  if (!precheck) {
    throw new MemberNotFoundError();
  }
  if (isMemberArchived(precheck)) {
    throw new MemberPhotoConflictError(
      'Archived members must be restored before uploading or replacing a photo.'
    );
  }

  const newKey = buildMemberPhotoObjectKey({
    envPrefix: storage.envPrefix,
    organisationId: actor.organisationId,
    memberId,
    extension: processedPhoto.extension,
  });

  // Step 1: Upload and verify the new sanitized object before mutating PostgreSQL
  await storage.putPrivateObject({
    key: newKey,
    body: processedPhoto.bytes,
    contentType: processedPhoto.mimeType,
    cacheControl: 'private, no-store',
  });

  try {
    const head = await storage.headObject(newKey);
    if (
      !head.exists ||
      (head.contentLength !== undefined && head.contentLength !== processedPhoto.byteSize)
    ) {
      throw new Error('Uploaded photo failed post-upload storage verification.');
    }
  } catch (err) {
    await attemptDeleteOrEnqueue({
      storage,
      organisationId: actor.organisationId,
      memberId,
      key: newKey,
      reason: 'POST_UPLOAD_VERIFY_FAILURE',
    });
    throw err;
  }

  // Step 2: Commit metadata and append-only audit inside a serialized member lock
  let previousKeyToDelete: string | null = null;
  let updatedMemberRow: Awaited<ReturnType<typeof prisma.member.update>> & {
    id: string;
    fullName: string;
    preferredName: string | null;
    birthDay: number | null;
    birthMonth: number | null;
    birthYear: number | null;
    phone: string | null;
    email: string | null;
    photoStorageKey: string | null;
    photoUpdatedAt: Date | null;
    archivedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
    notes: string | null;
  };

  try {
    const txResult = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`member_photo:${memberId}`}))`;

      const existing = await tx.member.findFirst({
        where: {
          id: memberId,
          organisationId: actor.organisationId,
        },
        select: {
          id: true,
          archivedAt: true,
          photoStorageKey: true,
        },
      });

      if (!existing) {
        throw new MemberNotFoundError();
      }
      if (isMemberArchived(existing)) {
        throw new MemberPhotoConflictError(
          'Archived members must be restored before uploading or replacing a photo.'
        );
      }

      const now = new Date();
      const updated = await tx.member.update({
        where: { id: existing.id },
        data: {
          photoStorageKey: newKey,
          photoMimeType: processedPhoto.mimeType,
          photoByteSize: processedPhoto.byteSize,
          photoUpdatedAt: now,
        },
        select: MEMBER_DETAIL_SELECT,
      });

      const replaced = Boolean(existing.photoStorageKey);
      await auditService.recordAuditEvent(tx, {
        organisationId: actor.organisationId,
        actorUserId: actor.userId,
        action: replaced
          ? auditService.AUDIT_ACTIONS.MEMBER_PHOTO_REPLACED
          : auditService.AUDIT_ACTIONS.MEMBER_PHOTO_UPLOADED,
        entityType: 'Member',
        entityId: updated.id,
        metadata: {
          mimeType: processedPhoto.mimeType,
          byteSize: processedPhoto.byteSize,
          width: processedPhoto.width,
          height: processedPhoto.height,
          replaced,
        },
      });

      return {
        updated,
        previousKey: existing.photoStorageKey,
        updatedAt: now,
      };
    });

    previousKeyToDelete = txResult.previousKey;
    updatedMemberRow = txResult.updated as typeof updatedMemberRow;
  } catch (err) {
    // Database failed after S3 upload succeeded -> delete orphan newKey (or queue retry), leaving old photo intact
    await attemptDeleteOrEnqueue({
      storage,
      organisationId: actor.organisationId,
      memberId,
      key: newKey,
      reason: 'DB_TRANSACTION_ROLLBACK',
    });
    throw err;
  }

  // Step 3: Now that Postgres points safely to newKey, delete old key (or queue retry) without failing commit
  if (previousKeyToDelete && previousKeyToDelete !== newKey) {
    try {
      await attemptDeleteOrEnqueue({
        storage,
        organisationId: actor.organisationId,
        memberId,
        key: previousKeyToDelete,
        reason: 'PREVIOUS_PHOTO_CLEANUP',
      });
    } catch (err) {
      console.error(
        'Skipped old photo deletion due to key scope mismatch:',
        formatSafeCleanupError(err)
      );
    }
  }

  const memberDetail = mapMemberDetail(updatedMemberRow);
  const photoUpdatedAtIso =
    memberDetail.photoUpdatedAt ?? new Date().toISOString();

  return {
    member: memberDetail,
    photo: {
      url: `/api/members/${memberDetail.id}/photo`,
      mimeType: processedPhoto.mimeType as MemberPhotoMimeType,
      byteSize: processedPhoto.byteSize,
      width: processedPhoto.width,
      height: processedPhoto.height,
      updatedAt: photoUpdatedAtIso,
    },
  };
}

/**
 * Retrieves an authenticated organisation member's private photograph bytes from storage.
 * Policy: Active AND archived members within the owner's organisation may be viewed for
 * profile review/audit; non-existent or cross-organisation members return 404.
 */
export async function getMemberPhoto(
  organisationId: string,
  memberId: string,
  storageProvider?: ObjectStorageProvider
): Promise<RetrievedMemberPhoto> {
  const storage = getStorageOrDefault(storageProvider);

  const member = await prisma.member.findFirst({
    where: {
      id: memberId,
      organisationId,
    },
    select: {
      id: true,
      photoStorageKey: true,
      photoMimeType: true,
      photoUpdatedAt: true,
    },
  });

  if (!member || !member.photoStorageKey) {
    throw new MemberPhotoNotFoundError();
  }

  assertKeyMatchesMemberScope(member.photoStorageKey, {
    envPrefix: storage.envPrefix,
    organisationId,
    memberId,
  });

  const objectResult = await storage.getObject(member.photoStorageKey);
  return {
    body: objectResult.body,
    contentType:
      member.photoMimeType ?? objectResult.contentType ?? 'application/octet-stream',
    byteSize: objectResult.body.byteLength,
    updatedAt: member.photoUpdatedAt,
  };
}

/**
 * Idempotently removes a member's photo metadata inside an audited transaction and then
 * deletes the object from private storage (or queues durable cleanup retry if deletion fails).
 */
export async function deleteMemberPhoto(
  actor: MemberActorContext,
  memberId: string,
  storageProvider?: ObjectStorageProvider
): Promise<DeleteMemberPhotoResult> {
  const storage = getStorageOrDefault(storageProvider);

  let keyToDelete: string | null = null;

  const txResult = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`member_photo:${memberId}`}))`;

    const existing = await tx.member.findFirst({
      where: {
        id: memberId,
        organisationId: actor.organisationId,
      },
      select: {
        ...MEMBER_DETAIL_SELECT,
        photoMimeType: true,
        photoByteSize: true,
      },
    });

    if (!existing) {
      throw new MemberNotFoundError();
    }

    if (!existing.photoStorageKey) {
      return {
        member: mapMemberDetail(existing),
        removed: false,
        key: null as string | null,
      };
    }

    assertKeyMatchesMemberScope(existing.photoStorageKey, {
      envPrefix: storage.envPrefix,
      organisationId: actor.organisationId,
      memberId,
    });

    const updated = await tx.member.update({
      where: { id: existing.id },
      data: {
        photoStorageKey: null,
        photoMimeType: null,
        photoByteSize: null,
        photoUpdatedAt: null,
      },
      select: MEMBER_DETAIL_SELECT,
    });

    await auditService.recordAuditEvent(tx, {
      organisationId: actor.organisationId,
      actorUserId: actor.userId,
      action: auditService.AUDIT_ACTIONS.MEMBER_PHOTO_REMOVED,
      entityType: 'Member',
      entityId: updated.id,
      metadata: {
        hadPreviousPhoto: true,
        previousMimeType: existing.photoMimeType,
        previousByteSize: existing.photoByteSize,
      },
    });

    return {
      member: mapMemberDetail(updated),
      removed: true,
      key: existing.photoStorageKey,
    };
  });

  keyToDelete = txResult.key;
  if (keyToDelete) {
    await attemptDeleteOrEnqueue({
      storage,
      organisationId: actor.organisationId,
      memberId,
      key: keyToDelete,
      reason: 'MEMBER_PHOTO_REMOVED',
    });
  }

  return {
    member: txResult.member,
    removed: txResult.removed,
  };
}

/**
 * Retries due `PendingStorageCleanup` records for an organisation with strict
 * environment, organisation, and member scope verification and idempotent completion.
 * Out-of-scope or actively referenced keys are marked REJECTED and never deleted.
 */
export async function retryPendingStorageCleanups(
  options: RetryStorageCleanupsOptions,
  storageProvider?: ObjectStorageProvider
): Promise<RetryStorageCleanupsResult> {
  const storage = getStorageOrDefault(storageProvider);
  if (storage.envPrefix !== 'development' && !APPROVED_PROD_STORAGE_TARGET) {
    throw new StorageKeyViolationError(
      'Refusing storage cleanup against unapproved environment target.'
    );
  }

  const now = options.now ?? new Date();
  const take = Math.min(Math.max(options.limit ?? 25, 1), 100);

  const candidates = await prisma.pendingStorageCleanup.findMany({
    where: {
      organisationId: options.organisationId,
      ...(options.memberId ? { memberId: options.memberId } : {}),
      status: 'PENDING',
      ...(options.ignoreBackoff ? {} : { nextRetryAt: { lte: now } }),
    },
    orderBy: [{ nextRetryAt: 'asc' }, { createdAt: 'asc' }],
    take,
  });

  const summary: RetryStorageCleanupsResult = {
    examined: candidates.length,
    succeeded: 0,
    failed: 0,
    rejected: 0,
    skipped: 0,
  };

  for (const record of candidates) {
    // Defense-in-depth: validate exact environment, organisation, and member scope BEFORE S3 call
    try {
      if (record.organisationId !== options.organisationId) {
        throw new StorageKeyViolationError('Cleanup record organisation mismatch.');
      }
      assertKeyMatchesMemberScope(record.storageKey, {
        envPrefix: storage.envPrefix,
        organisationId: record.organisationId,
        memberId: record.memberId,
      });

      const activeReference = await prisma.member.findFirst({
        where: {
          organisationId: record.organisationId,
          photoStorageKey: record.storageKey,
        },
        select: { id: true },
      });
      if (activeReference) {
        throw new StorageKeyViolationError(
          'Cleanup key matches an active member photograph and cannot be deleted.'
        );
      }
    } catch (scopeErr) {
      const rejectedUpdate = await prisma.pendingStorageCleanup.updateMany({
        where: { id: record.id, status: 'PENDING' },
        data: {
          status: 'REJECTED',
          attemptCount: { increment: 1 },
          lastError: formatSafeCleanupError(scopeErr),
        },
      });
      if (rejectedUpdate.count === 1) {
        summary.rejected += 1;
      } else {
        summary.skipped += 1;
      }
      continue;
    }

    try {
      await storage.deleteObject(record.storageKey);

      const completedUpdate = await prisma.pendingStorageCleanup.updateMany({
        where: { id: record.id, status: 'PENDING' },
        data: {
          status: 'COMPLETED',
          completedAt: new Date(),
          lastError: null,
          attemptCount: { increment: 1 },
        },
      });
      if (completedUpdate.count === 1) {
        summary.succeeded += 1;
      } else {
        summary.skipped += 1;
      }
    } catch (deleteErr) {
      const backoffMs = Math.min(
        DEFAULT_RETRY_DELAY_MS * 2 ** Math.min(record.attemptCount, 6),
        MAX_RETRY_DELAY_MS
      );
      await prisma.pendingStorageCleanup.updateMany({
        where: { id: record.id, status: 'PENDING' },
        data: {
          attemptCount: { increment: 1 },
          lastError: formatSafeCleanupError(deleteErr),
          nextRetryAt: new Date(now.getTime() + backoffMs),
        },
      });
      summary.failed += 1;
    }
  }

  return summary;
}
