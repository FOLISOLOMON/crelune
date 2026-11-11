import {
  DeleteObjectsCommand,
  HeadBucketCommand,
  ListObjectsV2Command,
  S3Client,
} from '@aws-sdk/client-s3';
import sharp from 'sharp';
import { prisma } from '@crelune/database';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as auditService from '@/lib/audit/audit-service';
import { AUDIT_ACTIONS } from '@/lib/audit/audit-service';
import { verifyActiveOwnerInDatabase } from '@/lib/auth/owner-guard';
import { createMember, MemberNotFoundError } from '@/lib/members/member-service';
import {
  deleteMemberPhoto,
  getMemberPhoto,
  MemberPhotoConflictError,
  MemberPhotoNotFoundError,
  retryPendingStorageCleanups,
  uploadMemberPhoto,
} from '@/lib/members/member-photo-service';
import { processUploadedMemberPhoto } from '@/lib/storage/image-processor';
import {
  createObjectStorageProvider,
  type ObjectStorageProvider,
} from '@/lib/storage/object-storage';
import { assertSafeDevStorageEnvironment } from '@/test/assert-dev-db';
import {
  createDecodableJpeg,
  createDecodablePng,
  createDecodableWebp,
  createSyntheticExifGpsJpeg,
} from '@/test/synthetic-images';

const RUN_PREFIX = `__pg_photo_${Date.now()}`;

describe('PostgreSQL + Neon Object Storage Stage 3.3.1 Integration (Neon Development)', () => {
  let orgAId = '';
  let orgBId = '';
  let ownerAId = '';
  let nonOwnerId = '';
  const createdMemberIds: string[] = [];
  let endpointOrigin = '';
  let bucketName = '';
  let s3RawClient: S3Client;

  beforeAll(async () => {
    const target = assertSafeDevStorageEnvironment(process.env);
    endpointOrigin = `https://${target.endpointHost}`;
    bucketName = target.bucket;

    s3RawClient = new S3Client({
      region: target.region,
      endpoint: endpointOrigin,
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
      },
      forcePathStyle: true,
    });

    const orgA = await prisma.organisation.create({
      data: { name: `${RUN_PREFIX} Org A`, slug: `${RUN_PREFIX}-org-a` },
    });
    const orgB = await prisma.organisation.create({
      data: { name: `${RUN_PREFIX} Org B`, slug: `${RUN_PREFIX}-org-b` },
    });
    orgAId = orgA.id;
    orgBId = orgB.id;

    const ownerA = await prisma.user.create({
      data: {
        organisationId: orgAId,
        email: `${RUN_PREFIX}-owner@crelune.test`,
        passwordHash: 'not_used',
        firstName: 'Photo',
        lastName: 'Tester',
        role: 'OWNER',
        isActive: true,
        sessionVersion: 1,
      },
    });
    const designer = await prisma.user.create({
      data: {
        organisationId: orgAId,
        email: `${RUN_PREFIX}-designer@crelune.test`,
        passwordHash: 'not_used',
        firstName: 'Designer',
        lastName: 'Blocked',
        role: 'DESIGNER',
        isActive: true,
        sessionVersion: 1,
      },
    });
    ownerAId = ownerA.id;
    nonOwnerId = designer.id;
  });

  async function purgeTestNamespaceObjects(organisationId: string): Promise<number> {
    if (!organisationId) return 0;
    const prefix = `development/organisations/${organisationId}/`;
    const listed = await s3RawClient.send(
      new ListObjectsV2Command({ Bucket: bucketName, Prefix: prefix })
    );
    const keys = (listed.Contents ?? [])
      .map((obj) => obj.Key)
      .filter((k): k is string => Boolean(k));
    if (keys.length > 0) {
      await s3RawClient.send(
        new DeleteObjectsCommand({
          Bucket: bucketName,
          Delete: { Objects: keys.map((Key) => ({ Key })) },
        })
      );
    }
    return keys.length;
  }

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    try {
      await purgeTestNamespaceObjects(orgAId);
      await purgeTestNamespaceObjects(orgBId);
      if (orgAId || orgBId) {
        const orgIds = [orgAId, orgBId].filter(Boolean);
        await prisma.pendingStorageCleanup.deleteMany({
          where: { organisationId: { in: orgIds } },
        });
        await prisma.auditLog.deleteMany({
          where: { organisationId: { in: orgIds } },
        });
        await prisma.member.deleteMany({
          where: { organisationId: { in: orgIds } },
        });
        await prisma.user.deleteMany({
          where: { id: { in: [ownerAId, nonOwnerId].filter(Boolean) } },
        });
        await prisma.organisation.deleteMany({
          where: { id: { in: orgIds } },
        });
      }
      for (const orgId of [orgAId, orgBId].filter(Boolean)) {
        const remaining = await s3RawClient.send(
          new ListObjectsV2Command({
            Bucket: bucketName,
            Prefix: `development/organisations/${orgId}/`,
          })
        );
        expect(remaining.Contents ?? []).toHaveLength(0);
      }
    } finally {
      s3RawClient.destroy();
      await prisma.$disconnect();
    }
  });

  it('verifies development bucket is private and rejects unauthenticated HTTP retrieval', async () => {
    await s3RawClient.send(new HeadBucketCommand({ Bucket: bucketName }));

    const member = await createMember(
      { userId: ownerAId, organisationId: orgAId },
      { fullName: `${RUN_PREFIX} Private Check`, confirmDuplicate: true }
    );
    createdMemberIds.push(member.id);

    const processed = await processUploadedMemberPhoto({
      bytes: await createDecodablePng(8, 8),
      declaredMimeType: 'image/png',
      filename: 'private-check.png',
    });

    await uploadMemberPhoto({ userId: ownerAId, organisationId: orgAId }, member.id, processed);
    const dbMember = await prisma.member.findUniqueOrThrow({ where: { id: member.id } });
    const objectUrl = `${endpointOrigin}/${bucketName}/${dbMember.photoStorageKey}`;

    const unauthBucketRes = await fetch(`${endpointOrigin}/${bucketName}`);
    expect(unauthBucketRes.ok).toBe(false);
    expect([401, 403]).toContain(unauthBucketRes.status);

    const unauthObjectRes = await fetch(objectUrl);
    expect(unauthObjectRes.ok).toBe(false);
    expect([401, 403]).toContain(unauthObjectRes.status);

    await deleteMemberPhoto({ userId: ownerAId, organisationId: orgAId }, member.id);
  });

  it('strips EXIF/GPS before persistence, enforces archival rules, deletes, and cleans old objects in Neon development', async () => {
    const member = await createMember(
      { userId: ownerAId, organisationId: orgAId },
      { fullName: `${RUN_PREFIX} EXIF Lifecycle`, confirmDuplicate: true }
    );
    createdMemberIds.push(member.id);
    const storage = createObjectStorageProvider();

    // Upload JPEG with EXIF/GPS/XMP/COM metadata & Orientation=6 (24x16 -> upright 16x24)
    const exifJpeg = await createSyntheticExifGpsJpeg({
      width: 24,
      height: 16,
      orientation: '6',
    });
    const processed1 = await processUploadedMemberPhoto({
      bytes: exifJpeg,
      declaredMimeType: 'image/jpeg',
      filename: 'portrait.jpg',
    });

    const upload1 = await uploadMemberPhoto(
      { userId: ownerAId, organisationId: orgAId },
      member.id,
      processed1,
      storage
    );
    expect(upload1.photo.mimeType).toBe('image/jpeg');
    expect(upload1.photo.width).toBe(16);
    expect(upload1.photo.height).toBe(24);

    const row1 = await prisma.member.findUniqueOrThrow({ where: { id: member.id } });
    const firstKey = row1.photoStorageKey!;
    expect(firstKey).toMatch(
      new RegExp(`^development/organisations/${orgAId}/members/${member.id}/photos/[a-zA-Z0-9-]+\\.jpg$`)
    );
    expect(row1.photoByteSize).toBe(processed1.byteSize);

    // Retrieved object from Neon S3 must contain ZERO EXIF/GPS/XMP/COM metadata
    const fetched1 = await getMemberPhoto(orgAId, member.id, storage);
    expect(fetched1.contentType).toBe('image/jpeg');
    expect(Buffer.from(fetched1.body)).not.toEqual(Buffer.from(exifJpeg));
    const fetchedBuf = Buffer.from(fetched1.body);
    expect(fetchedBuf.toString('latin1')).not.toContain('SecretGPSLocation');
    expect(fetchedBuf.toString('latin1')).not.toContain('SyntheticCam');
    const fetchedMeta = await sharp(fetchedBuf).metadata();
    expect(fetchedMeta.exif).toBeUndefined();
    expect(fetchedMeta.width).toBe(16);
    expect(fetchedMeta.height).toBe(24);

    // Replace with WebP -> verify new key stored & firstKey removed from Neon S3
    const processedWebp = await processUploadedMemberPhoto({
      bytes: await createDecodableWebp(16, 16),
      declaredMimeType: 'image/webp',
      filename: 'updated.webp',
    });
    await uploadMemberPhoto(
      { userId: ownerAId, organisationId: orgAId },
      member.id,
      processedWebp,
      storage
    );
    const row2 = await prisma.member.findUniqueOrThrow({ where: { id: member.id } });
    const secondKey = row2.photoStorageKey!;
    expect(secondKey).not.toBe(firstKey);
    expect((await storage.headObject(firstKey)).exists).toBe(false);
    expect((await storage.headObject(secondKey)).exists).toBe(true);

    // Archived member: GET allowed, POST upload rejected
    await prisma.member.update({
      where: { id: member.id },
      data: { archivedAt: new Date() },
    });
    expect(Buffer.from((await getMemberPhoto(orgAId, member.id, storage)).body)).toEqual(
      Buffer.from(processedWebp.bytes)
    );
    await expect(
      uploadMemberPhoto(
        { userId: ownerAId, organisationId: orgAId },
        member.id,
        await processUploadedMemberPhoto({
          bytes: await createDecodablePng(8, 8),
          declaredMimeType: 'image/png',
          filename: 'blocked.png',
        }),
        storage
      )
    ).rejects.toThrow(MemberPhotoConflictError);

    // Removal + idempotent second removal
    const del1 = await deleteMemberPhoto({ userId: ownerAId, organisationId: orgAId }, member.id, storage);
    expect(del1.removed).toBe(true);
    expect((await storage.headObject(secondKey)).exists).toBe(false);

    const rowCleared = await prisma.member.findUniqueOrThrow({ where: { id: member.id } });
    expect(rowCleared.photoStorageKey).toBeNull();

    const del2 = await deleteMemberPhoto({ userId: ownerAId, organisationId: orgAId }, member.id, storage);
    expect(del2.removed).toBe(false);

    const logs = await prisma.auditLog.findMany({
      where: { organisationId: orgAId, entityId: member.id },
      orderBy: { createdAt: 'asc' },
    });
    expect(logs.map((l) => l.action)).toContain(AUDIT_ACTIONS.MEMBER_PHOTO_UPLOADED);
    expect(logs.map((l) => l.action)).toContain(AUDIT_ACTIONS.MEMBER_PHOTO_REPLACED);
    expect(logs.map((l) => l.action)).toContain(AUDIT_ACTIONS.MEMBER_PHOTO_REMOVED);
    for (const log of logs) {
      const serialized = JSON.stringify(log.metadata ?? {});
      expect(serialized).not.toContain(firstKey);
      expect(serialized).not.toContain(secondKey);
    }
  });

  it('queues durable cleanup on failed compensation/replacement/removal, supports idempotent retries, and rejects out-of-scope cleanup keys', async () => {
    const member = await createMember(
      { userId: ownerAId, organisationId: orgAId },
      { fullName: `${RUN_PREFIX} Durable Cleanup`, confirmDuplicate: true }
    );
    createdMemberIds.push(member.id);
    const realStorage = createObjectStorageProvider();

    // 1. Baseline upload succeeds
    const png1 = await processUploadedMemberPhoto({
      bytes: await createDecodablePng(8, 8),
      declaredMimeType: 'image/png',
      filename: 'base.png',
    });
    await uploadMemberPhoto({ userId: ownerAId, organisationId: orgAId }, member.id, png1, realStorage);
    const key1 = (await prisma.member.findUniqueOrThrow({ where: { id: member.id } })).photoStorageKey!;

    // Storage wrapper whose deleteObject fails with URL/credential text in message (verifying sanitization)
    const failingDeleteStorage: ObjectStorageProvider = {
      envPrefix: realStorage.envPrefix,
      putPrivateObject: realStorage.putPrivateObject.bind(realStorage),
      headObject: realStorage.headObject.bind(realStorage),
      getObject: realStorage.getObject.bind(realStorage),
      deleteObject: async () => {
        const err = new Error(
          'Delete failed at https://br-nameless-silence-bexjp44k.storage.c-9.us-east-2.aws.neon.tech?X-Amz-Credential=nsk_secret'
        );
        err.name = 'NetworkTimeoutError';
        throw err;
      },
    };

    // 2. Failed new-object compensation (DB audit fails AND S3 delete throws) -> queued durably & prior key1 preserved
    vi.spyOn(auditService, 'recordAuditEvent').mockRejectedValueOnce(new Error('Simulated audit failure'));
    const webpOrphan = await processUploadedMemberPhoto({
      bytes: await createDecodableWebp(10, 10),
      declaredMimeType: 'image/webp',
      filename: 'orphan.webp',
    });
    await expect(
      uploadMemberPhoto(
        { userId: ownerAId, organisationId: orgAId },
        member.id,
        webpOrphan,
        failingDeleteStorage
      )
    ).rejects.toThrow(/Simulated audit failure/);

    expect((await prisma.member.findUniqueOrThrow({ where: { id: member.id } })).photoStorageKey).toBe(key1);
    const compRecords = await prisma.pendingStorageCleanup.findMany({
      where: { organisationId: orgAId, memberId: member.id, status: 'PENDING' },
    });
    expect(compRecords).toHaveLength(1);
    expect(compRecords[0]!.reason).toBe('DB_TRANSACTION_ROLLBACK');
    expect(compRecords[0]!.lastError).not.toContain('https://');
    expect(compRecords[0]!.lastError).not.toContain('nsk_secret');
    const orphanKey = compRecords[0]!.storageKey;
    expect((await realStorage.headObject(orphanKey)).exists).toBe(true);

    // Retry clears the failed new-object compensation orphan in Neon S3
    const retryComp = await retryPendingStorageCleanups(
      { organisationId: orgAId, memberId: member.id, ignoreBackoff: true },
      realStorage
    );
    expect(retryComp).toEqual({
      examined: 1,
      succeeded: 1,
      failed: 0,
      rejected: 0,
      skipped: 0,
    });
    expect((await realStorage.headObject(orphanKey)).exists).toBe(false);

    // 3. Failed old-photo deletion after replacement: DB points cleanly to key2 & key1 is queued PENDING
    const jpg2 = await processUploadedMemberPhoto({
      bytes: await createDecodableJpeg(12, 12),
      declaredMimeType: 'image/jpeg',
      filename: 'replace.jpg',
    });
    const replaceRes = await uploadMemberPhoto(
      { userId: ownerAId, organisationId: orgAId },
      member.id,
      jpg2,
      failingDeleteStorage
    );
    expect(replaceRes.member.hasPhoto).toBe(true);
    const key2 = (await prisma.member.findUniqueOrThrow({ where: { id: member.id } })).photoStorageKey!;
    expect(key2).not.toBe(key1);
    // Old photo key1 remained intact until replacement committed, and is still queued because delete failed
    expect((await realStorage.headObject(key1)).exists).toBe(true);
    const queuedReplace = await prisma.pendingStorageCleanup.findUniqueOrThrow({
      where: { storageKey: key1 },
    });
    expect(queuedReplace.status).toBe('PENDING');
    expect(queuedReplace.reason).toBe('PREVIOUS_PHOTO_CLEANUP');

    // 4. Failed deletion after member photo removal: DB clears photo metadata & queues key2 PENDING
    const delRes = await deleteMemberPhoto(
      { userId: ownerAId, organisationId: orgAId },
      member.id,
      failingDeleteStorage
    );
    expect(delRes.removed).toBe(true);
    expect((await prisma.member.findUniqueOrThrow({ where: { id: member.id } })).photoStorageKey).toBeNull();
    const queuedRemove = await prisma.pendingStorageCleanup.findUniqueOrThrow({
      where: { storageKey: key2 },
    });
    expect(queuedRemove.status).toBe('PENDING');
    expect(queuedRemove.reason).toBe('MEMBER_PHOTO_REMOVED');

    // 5. Out-of-scope & arbitrary cleanup keys MUST be rejected and NEVER passed to deleteObject
    const outOfScopeRows = await prisma.pendingStorageCleanup.createMany({
      data: [
        {
          organisationId: orgAId,
          memberId: member.id,
          storageKey: `production/organisations/${orgAId}/members/${member.id}/photos/bad-prod.png`,
          reason: 'MEMBER_PHOTO_REMOVED',
          status: 'PENDING',
        },
        {
          organisationId: orgAId,
          memberId: member.id,
          storageKey: `development/organisations/${orgBId}/members/${member.id}/photos/cross-org.png`,
          reason: 'MEMBER_PHOTO_REMOVED',
          status: 'PENDING',
        },
        {
          organisationId: orgAId,
          memberId: member.id,
          storageKey: '../arbitrary-traversal-key.png',
          reason: 'MEMBER_PHOTO_REMOVED',
          status: 'PENDING',
        },
      ],
    });
    expect(outOfScopeRows.count).toBe(3);

    const deleteSpy = vi.spyOn(realStorage, 'deleteObject');
    const retryResult = await retryPendingStorageCleanups(
      { organisationId: orgAId, memberId: member.id, ignoreBackoff: true },
      realStorage
    );
    expect(retryResult).toEqual({
      examined: 5,
      succeeded: 2, // key1 + key2
      failed: 0,
      rejected: 3, // 3 out-of-scope keys
      skipped: 0,
    });
    expect(deleteSpy).toHaveBeenCalledTimes(2);
    expect(deleteSpy).toHaveBeenCalledWith(key1);
    expect(deleteSpy).toHaveBeenCalledWith(key2);
    expect((await realStorage.headObject(key1)).exists).toBe(false);
    expect((await realStorage.headObject(key2)).exists).toBe(false);

    // 6. Duplicate retry is an idempotent no-op
    deleteSpy.mockClear();
    const duplicateRetry = await retryPendingStorageCleanups(
      { organisationId: orgAId, memberId: member.id, ignoreBackoff: true },
      realStorage
    );
    expect(duplicateRetry).toEqual({
      examined: 0,
      succeeded: 0,
      failed: 0,
      rejected: 0,
      skipped: 0,
    });
    expect(deleteSpy).not.toHaveBeenCalled();
  }, 60_000);

  it('enforces cross-organisation and non-owner authorization boundaries against PostgreSQL', async () => {
    const member = await createMember(
      { userId: ownerAId, organisationId: orgAId },
      { fullName: `${RUN_PREFIX} Isolated Org Member`, confirmDuplicate: true }
    );
    createdMemberIds.push(member.id);

    const realStorage = createObjectStorageProvider();
    await uploadMemberPhoto(
      { userId: ownerAId, organisationId: orgAId },
      member.id,
      await processUploadedMemberPhoto({
        bytes: await createDecodablePng(8, 8),
        declaredMimeType: 'image/png',
        filename: 'orgA.png',
      }),
      realStorage
    );

    const roleCheck = await verifyActiveOwnerInDatabase({
      sub: nonOwnerId,
      role: 'OWNER',
      org: orgAId,
      ver: 1,
      iat: Math.floor(Date.now() / 1000) - 10,
      exp: Math.floor(Date.now() / 1000) + 3600,
    });
    expect(roleCheck.status).toBe('revoked');

    await expect(getMemberPhoto(orgBId, member.id, realStorage)).rejects.toThrow(
      MemberPhotoNotFoundError
    );
    await expect(
      uploadMemberPhoto(
        { userId: ownerAId, organisationId: orgBId },
        member.id,
        await processUploadedMemberPhoto({
          bytes: await createDecodableJpeg(8, 8),
          declaredMimeType: 'image/jpeg',
          filename: 'hijack.jpg',
        }),
        realStorage
      )
    ).rejects.toThrow(MemberNotFoundError);
    await expect(
      deleteMemberPhoto({ userId: ownerAId, organisationId: orgBId }, member.id, realStorage)
    ).rejects.toThrow(MemberNotFoundError);

    await deleteMemberPhoto({ userId: ownerAId, organisationId: orgAId }, member.id, realStorage);
  });
});
