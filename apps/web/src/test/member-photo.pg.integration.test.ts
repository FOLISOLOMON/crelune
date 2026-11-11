import {
  DeleteObjectsCommand,
  HeadBucketCommand,
  ListObjectsV2Command,
  S3Client,
} from '@aws-sdk/client-s3';
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
  uploadMemberPhoto,
} from '@/lib/members/member-photo-service';
import { validateUploadedMemberPhoto } from '@/lib/storage/image-validator';
import { createObjectStorageProvider } from '@/lib/storage/object-storage';
import { assertSafeDevStorageEnvironment } from '@/test/assert-dev-db';
import {
  createSyntheticJpeg,
  createSyntheticPng,
  createSyntheticWebp,
} from '@/test/synthetic-images';

const RUN_PREFIX = `__pg_photo_${Date.now()}`;

describe('PostgreSQL + Neon Object Storage Stage 3.3 Integration (Neon Development)', () => {
  let orgAId = '';
  let orgBId = '';
  let ownerAId = '';
  let nonOwnerId = '';
  let createdMemberIds: string[] = [];
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
        await prisma.auditLog.deleteMany({
          where: { organisationId: { in: [orgAId, orgBId].filter(Boolean) } },
        });
        await prisma.member.deleteMany({
          where: { organisationId: { in: [orgAId, orgBId].filter(Boolean) } },
        });
        await prisma.user.deleteMany({
          where: { id: { in: [ownerAId, nonOwnerId].filter(Boolean) } },
        });
        await prisma.organisation.deleteMany({
          where: { id: { in: [orgAId, orgBId].filter(Boolean) } },
        });
      }
      // Verify zero synthetic objects remain in Neon development bucket
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

    const validated = validateUploadedMemberPhoto({
      bytes: createSyntheticPng(8, 8),
      declaredMimeType: 'image/png',
      filename: 'private-check.png',
    });

    await uploadMemberPhoto({ userId: ownerAId, organisationId: orgAId }, member.id, validated);
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

  it('uploads, retrieves, replaces, enforces archival rules, deletes, and cleans old objects in Neon development', async () => {
    const member = await createMember(
      { userId: ownerAId, organisationId: orgAId },
      { fullName: `${RUN_PREFIX} Photo Lifecycle`, confirmDuplicate: true }
    );
    createdMemberIds.push(member.id);
    const storage = createObjectStorageProvider();

    // Upload initial JPEG
    const jpegBytes = createSyntheticJpeg(20, 24);
    const upload1 = await uploadMemberPhoto(
      { userId: ownerAId, organisationId: orgAId },
      member.id,
      validateUploadedMemberPhoto({
        bytes: jpegBytes,
        declaredMimeType: 'image/jpeg',
        filename: 'portrait.jpg',
      }),
      storage
    );
    expect(upload1.photo.mimeType).toBe('image/jpeg');

    const row1 = await prisma.member.findUniqueOrThrow({ where: { id: member.id } });
    const firstKey = row1.photoStorageKey!;
    expect(firstKey).toMatch(
      new RegExp(`^development/organisations/${orgAId}/members/${member.id}/photos/[a-zA-Z0-9-]+\\.jpg$`)
    );
    expect(row1.photoMimeType).toBe('image/jpeg');
    expect(row1.photoByteSize).toBe(jpegBytes.byteLength);

    // Retrieve exact bytes
    const fetched1 = await getMemberPhoto(orgAId, member.id, storage);
    expect(fetched1.contentType).toBe('image/jpeg');
    expect(Buffer.from(fetched1.body)).toEqual(Buffer.from(jpegBytes));

    // Replace with WebP -> verify new key stored & firstKey removed from Neon S3
    const webpBytes = createSyntheticWebp(16, 16);
    await uploadMemberPhoto(
      { userId: ownerAId, organisationId: orgAId },
      member.id,
      validateUploadedMemberPhoto({
        bytes: webpBytes,
        declaredMimeType: 'image/webp',
        filename: 'updated.webp',
      }),
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
      Buffer.from(webpBytes)
    );
    await expect(
      uploadMemberPhoto(
        { userId: ownerAId, organisationId: orgAId },
        member.id,
        validateUploadedMemberPhoto({
          bytes: createSyntheticPng(),
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
    expect(rowCleared.photoMimeType).toBeNull();
    expect(rowCleared.photoByteSize).toBeNull();
    expect(rowCleared.photoUpdatedAt).toBeNull();

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

  it('preserves previous photo on storage upload failure and removes new orphan if audit/DB fails', async () => {
    const member = await createMember(
      { userId: ownerAId, organisationId: orgAId },
      { fullName: `${RUN_PREFIX} Compensation`, confirmDuplicate: true }
    );
    createdMemberIds.push(member.id);
    const realStorage = createObjectStorageProvider();

    // Baseline photo uploaded cleanly
    const baselinePng = createSyntheticPng(6, 6);
    await uploadMemberPhoto(
      { userId: ownerAId, organisationId: orgAId },
      member.id,
      validateUploadedMemberPhoto({
        bytes: baselinePng,
        declaredMimeType: 'image/png',
        filename: 'base.png',
      }),
      realStorage
    );
    const baselineKey = (await prisma.member.findUniqueOrThrow({ where: { id: member.id } }))
      .photoStorageKey!;

    // Failure A: Upload step throws -> prior DB + S3 intact
    await expect(
      uploadMemberPhoto(
        { userId: ownerAId, organisationId: orgAId },
        member.id,
        validateUploadedMemberPhoto({
          bytes: createSyntheticJpeg(),
          declaredMimeType: 'image/jpeg',
          filename: 'fail.jpg',
        }),
        {
          envPrefix: realStorage.envPrefix,
          putPrivateObject: async () => {
            throw new Error('Simulated S3 failure');
          },
          headObject: realStorage.headObject.bind(realStorage),
          getObject: realStorage.getObject.bind(realStorage),
          deleteObject: realStorage.deleteObject.bind(realStorage),
        }
      )
    ).rejects.toThrow(/Simulated S3 failure/);

    expect(Buffer.from((await getMemberPhoto(orgAId, member.id, realStorage)).body)).toEqual(
      Buffer.from(baselinePng)
    );

    // Failure B: S3 upload succeeds, then AuditLog fails -> DB rolls back AND new S3 object deleted (no orphan)
    vi.spyOn(auditService, 'recordAuditEvent').mockRejectedValueOnce(
      new Error('Simulated audit failure')
    );
    await expect(
      uploadMemberPhoto(
        { userId: ownerAId, organisationId: orgAId },
        member.id,
        validateUploadedMemberPhoto({
          bytes: createSyntheticWebp(),
          declaredMimeType: 'image/webp',
          filename: 'rollback.webp',
        }),
        realStorage
      )
    ).rejects.toThrow(/Simulated audit failure/);

    const afterRollback = await prisma.member.findUniqueOrThrow({ where: { id: member.id } });
    expect(afterRollback.photoStorageKey).toBe(baselineKey);

    const listMemberObjects = await s3RawClient.send(
      new ListObjectsV2Command({
        Bucket: bucketName,
        Prefix: `development/organisations/${orgAId}/members/${member.id}/photos/`,
      })
    );
    expect((listMemberObjects.Contents ?? []).map((o) => o.Key)).toEqual([baselineKey]);

    await deleteMemberPhoto({ userId: ownerAId, organisationId: orgAId }, member.id, realStorage);
  });

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
      validateUploadedMemberPhoto({
        bytes: createSyntheticPng(),
        declaredMimeType: 'image/png',
        filename: 'orgA.png',
      }),
      realStorage
    );

    // Non-OWNER session rejected by DB guard
    const roleCheck = await verifyActiveOwnerInDatabase({
      sub: nonOwnerId,
      role: 'OWNER',
      org: orgAId,
      ver: 1,
      iat: Math.floor(Date.now() / 1000) - 10,
      exp: Math.floor(Date.now() / 1000) + 3600,
    });
    expect(roleCheck.status).toBe('revoked');

    // Cross-organisation operations rejected cleanly
    await expect(getMemberPhoto(orgBId, member.id, realStorage)).rejects.toThrow(
      MemberPhotoNotFoundError
    );
    await expect(
      uploadMemberPhoto(
        { userId: ownerAId, organisationId: orgBId },
        member.id,
        validateUploadedMemberPhoto({
          bytes: createSyntheticJpeg(),
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
