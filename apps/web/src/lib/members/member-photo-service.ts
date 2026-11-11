/**
 * CRELUNE — Private Member Photograph Lifecycle Service
 *
 * Coordinates Neon Object Storage operations with PostgreSQL member metadata
 * and transactional append-only audit logging:
 *  - Verifies organisation ownership on every read, upload, replacement, and deletion.
 *  - Uploads & verifies new objects before committing Postgres updates.
 *  - Cleans up newly uploaded objects if the Postgres transaction fails.
 *  - Deletes previous objects only after DB commit succeeds, and validates
 *    object key scope before every read or deletion.
 */

import { prisma } from '@crelune/database';
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
import type { ValidatedMemberPhoto } from '@/lib/storage/image-validator';
import {
  createObjectStorageProvider,
  type ObjectStorageProvider,
} from '@/lib/storage/object-storage';
import {
  assertKeyMatchesMemberScope,
  buildMemberPhotoObjectKey,
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

function getStorageOrDefault(
  storage?: ObjectStorageProvider
): ObjectStorageProvider {
  return storage ?? createObjectStorageProvider();
}

async function safeCompensateDelete(
  storage: ObjectStorageProvider,
  key: string,
  reason: string
): Promise<void> {
  try {
    await storage.deleteObject(key);
  } catch (err) {
    console.error(
      `Object storage cleanup failed (${reason}):`,
      err instanceof Error ? err.name : 'UnknownError'
    );
  }
}

/**
 * Uploads or replaces a member's private photograph without risking data loss or
 * broken DB pointers on storage or transaction failures.
 */
export async function uploadMemberPhoto(
  actor: MemberActorContext,
  memberId: string,
  validatedPhoto: ValidatedMemberPhoto,
  storageProvider?: ObjectStorageProvider
): Promise<UploadMemberPhotoResult> {
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
    extension: validatedPhoto.extension,
  });

  // Step 1: Upload and verify the new object before mutating PostgreSQL
  await storage.putPrivateObject({
    key: newKey,
    body: validatedPhoto.bytes,
    contentType: validatedPhoto.mimeType,
    cacheControl: 'private, no-store',
  });

  try {
    const head = await storage.headObject(newKey);
    if (!head.exists || (head.contentLength !== undefined && head.contentLength !== validatedPhoto.byteSize)) {
      throw new Error('Uploaded photo failed post-upload storage verification.');
    }
  } catch (err) {
    await safeCompensateDelete(storage, newKey, 'post_upload_verify_failure');
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
          photoMimeType: validatedPhoto.mimeType,
          photoByteSize: validatedPhoto.byteSize,
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
          mimeType: validatedPhoto.mimeType,
          byteSize: validatedPhoto.byteSize,
          width: validatedPhoto.width,
          height: validatedPhoto.height,
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
    // Database failed after S3 upload succeeded -> delete orphan newKey, leaving any prior photo intact
    await safeCompensateDelete(storage, newKey, 'db_transaction_rollback');
    throw err;
  }

  // Step 3: Now that Postgres points safely to newKey, delete old key inside verified scope
  if (previousKeyToDelete && previousKeyToDelete !== newKey) {
    try {
      assertKeyMatchesMemberScope(previousKeyToDelete, {
        envPrefix: storage.envPrefix,
        organisationId: actor.organisationId,
        memberId,
      });
      await safeCompensateDelete(storage, previousKeyToDelete, 'previous_photo_cleanup');
    } catch (err) {
      console.error(
        'Skipped old photo deletion due to key scope mismatch:',
        err instanceof Error ? err.name : 'UnknownError'
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
      mimeType: validatedPhoto.mimeType as MemberPhotoMimeType,
      byteSize: validatedPhoto.byteSize,
      width: validatedPhoto.width,
      height: validatedPhoto.height,
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
 * deletes the object from private storage.
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
    await safeCompensateDelete(storage, keyToDelete, 'member_photo_removed');
  }

  return {
    member: txResult.member,
    removed: txResult.removed,
  };
}

