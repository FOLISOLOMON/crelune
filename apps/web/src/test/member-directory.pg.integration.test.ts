import crypto from 'node:crypto';
import { describe, it, expect, beforeAll, afterEach, afterAll, vi } from 'vitest';
import { prisma } from '@crelune/database';
import { createMemberSchema, memberListQuerySchema } from '@crelune/shared';
import * as auditService from '@/lib/audit/audit-service';
import { verifyActiveOwnerInDatabase } from '@/lib/auth/owner-guard';
import {
  MemberDuplicateError,
  MemberNotFoundError,
  MemberValidationError,
  archiveMember,
  createMember,
  getMemberById,
  listMembers,
  restoreMember,
  updateMember,
} from '@/lib/members/member-service';
import { assertSafeDevDatabaseEnvironment } from './assert-dev-db';

describe('PostgreSQL Stage 3.2 Member Directory, Duplicate Detection & Audit Integration (Neon Development)', () => {
  const runId = crypto.randomBytes(6).toString('hex');
  const createdOrgIds = new Set<string>();

  async function createTestOrgAndUser(
    suffix: string,
    role: string = 'OWNER'
  ) {
    const org = await prisma.organisation.create({
      data: {
        name: `__pg_m3_2_org_${runId}_${suffix}`,
        slug: `__pg-m3-2-${runId}-${suffix}`,
      },
    });
    createdOrgIds.add(org.id);

    const user = await prisma.user.create({
      data: {
        organisationId: org.id,
        email: `__pg_m3_2_${suffix}_${runId}@crelune.test`,
        passwordHash: 'not-a-real-hash',
        firstName: 'Test',
        lastName: suffix,
        role,
      },
    });

    return {
      org,
      user,
      actor: { userId: user.id, organisationId: org.id },
    };
  }

  async function cleanupTestOrgs() {
    if (createdOrgIds.size === 0) return;
    const orgIds = Array.from(createdOrgIds);
    await prisma.auditLog.deleteMany({ where: { organisationId: { in: orgIds } } });
    await prisma.notification.deleteMany({ where: { organisationId: { in: orgIds } } });
    await prisma.birthdayReminder.deleteMany({ where: { organisationId: { in: orgIds } } });
    await prisma.birthdayPreparation.deleteMany({ where: { organisationId: { in: orgIds } } });
    await prisma.member.deleteMany({ where: { organisationId: { in: orgIds } } });
    await prisma.user.deleteMany({ where: { organisationId: { in: orgIds } } });
    await prisma.organisation.deleteMany({ where: { id: { in: orgIds } } });
    createdOrgIds.clear();
  }

  beforeAll(async () => {
    assertSafeDevDatabaseEnvironment(process.env);
    const rows = await prisma.$queryRaw<Array<{ db: string }>>`SELECT current_database() AS db`;
    if (rows[0]?.db !== 'neondb') {
      throw new Error(`Unexpected database "${rows[0]?.db}" for integration test.`);
    }
  }, 30_000);

  afterEach(async () => {
    vi.restoreAllMocks();
    await cleanupTestOrgs();
  });

  afterAll(async () => {
    await cleanupTestOrgs();
    await prisma.$disconnect();
  });

  it('creates, retrieves, updates, archives, and restores a member with atomic sanitized audit logs', async () => {
    const { actor } = await createTestOrgAndUser('lifecycle');

    const input = createMemberSchema.parse({
      fullName: '  Ama   Mensah-Bonsu ',
      preferredName: 'Sis. Ama',
      birthMonth: 2,
      birthDay: 29,
      birthYear: null,
      phone: '+233 24 555 0101',
      email: 'Ama@Example.com',
      notes: 'Confidential choir note that must stay out of audit metadata',
    });

    const created = await createMember(actor, input);
    expect(created.fullName).toBe('Ama Mensah-Bonsu');
    expect(created.birthYear).toBeNull();
    expect(created.isActive).toBe(true);
    expect(created.notes).toBe('Confidential choir note that must stay out of audit metadata');

    const fetched = await getMemberById(actor.organisationId, created.id);
    expect(fetched.id).toBe(created.id);
    expect(fetched.notes).toBe(created.notes);

    // Reject partial invalid merged birthday update (Feb 29 + non-leap 2025)
    await expect(
      updateMember(actor, created.id, { birthYear: 2025 })
    ).rejects.toThrow(MemberValidationError);

    const updated = await updateMember(actor, created.id, {
      preferredName: 'Auntie Ama',
      notes: 'Updated private note',
    });
    expect(updated.preferredName).toBe('Auntie Ama');
    expect(updated.notes).toBe('Updated private note');

    const archived = await archiveMember(actor, created.id);
    expect(archived.changed).toBe(true);
    expect(archived.member.isActive).toBe(false);
    expect(archived.member.archivedAt).not.toBeNull();

    const restored = await restoreMember(actor, created.id);
    expect(restored.changed).toBe(true);
    expect(restored.member.isActive).toBe(true);
    expect(restored.member.archivedAt).toBeNull();

    const audits = await prisma.auditLog.findMany({
      where: { organisationId: actor.organisationId, entityId: created.id },
      orderBy: { createdAt: 'asc' },
    });
    expect(audits.map((a) => a.action)).toEqual([
      'MEMBER_CREATED',
      'MEMBER_UPDATED',
      'MEMBER_ARCHIVED',
      'MEMBER_RESTORED',
    ]);
    // Ensure notes/phone/email PII never leaks into persisted AuditLog metadata
    const serializedMeta = JSON.stringify(audits.map((a) => a.metadata));
    expect(serializedMeta).not.toContain('Confidential choir note');
    expect(serializedMeta).not.toContain('Updated private note');
    expect(serializedMeta).not.toContain('024 555 0101');
    expect(serializedMeta).not.toContain('ama@example.com');
  }, 25_000);

  it('lists members with pagination, search, status/birthMonth filters, sorting, and omits notes', async () => {
    const { actor } = await createTestOrgAndUser('listing');

    const m1 = await createMember(
      actor,
      createMemberSchema.parse({
        fullName: 'Daniel Osei',
        birthMonth: 10,
        birthDay: 20,
        phone: '0241112222',
        notes: 'Private note 1',
      })
    );
    await createMember(
      actor,
      createMemberSchema.parse({
        fullName: 'Abena Boateng',
        birthMonth: 10,
        birthDay: 5,
        phone: '0209998888',
        notes: 'Private note 2',
      })
    );
    const m3 = await createMember(
      actor,
      createMemberSchema.parse({
        fullName: 'Zacchaeus Kumi',
        birthMonth: 3,
        birthDay: 11,
        phone: '0277776666',
      })
    );
    await archiveMember(actor, m3.id);

    // Active pagination page 1 limit 1 sorted by birthday_asc -> Abena (Oct 5) before Daniel (Oct 20)
    const page1 = await listMembers(
      actor.organisationId,
      memberListQuerySchema.parse({
        status: 'active',
        birthMonth: 10,
        sort: 'birthday_asc',
        page: 1,
        limit: 1,
      })
    );
    expect(page1.members).toHaveLength(1);
    expect(page1.members[0]!.fullName).toBe('Abena Boateng');
    expect('notes' in page1.members[0]!).toBe(false);
    expect(page1.pagination).toEqual({
      page: 1,
      limit: 1,
      total: 2,
      totalPages: 2,
      hasNextPage: true,
      hasPreviousPage: false,
    });

    // Search by phone digits across active members
    const phoneSearch = await listMembers(
      actor.organisationId,
      memberListQuerySchema.parse({ q: '241112' })
    );
    expect(phoneSearch.members.map((m) => m.id)).toEqual([m1.id]);

    // Archived filter shows archived member only
    const archivedList = await listMembers(
      actor.organisationId,
      memberListQuerySchema.parse({ status: 'archived' })
    );
    expect(archivedList.members.map((m) => m.id)).toEqual([m3.id]);
    expect(archivedList.members[0]!.isActive).toBe(false);
  }, 25_000);

  it('enforces organisation isolation and non-owner role rejection', async () => {
    const { actor: orgAActor } = await createTestOrgAndUser('org-a', 'OWNER');
    const { actor: orgBActor } = await createTestOrgAndUser('org-b', 'OWNER');
    const { user: designerUser, org: orgC } = await createTestOrgAndUser(
      'non-owner',
      'DESIGNER'
    );

    const orgAMember = await createMember(
      orgAActor,
      createMemberSchema.parse({
        fullName: 'Isolated Member',
        phone: '0240001111',
      })
    );

    // Org B cannot read, update, archive, or restore Org A's member
    await expect(getMemberById(orgBActor.organisationId, orgAMember.id)).rejects.toThrow(
      MemberNotFoundError
    );
    await expect(
      updateMember(orgBActor, orgAMember.id, { fullName: 'Hacked' })
    ).rejects.toThrow(MemberNotFoundError);
    await expect(archiveMember(orgBActor, orgAMember.id)).rejects.toThrow(
      MemberNotFoundError
    );
    await expect(restoreMember(orgBActor, orgAMember.id)).rejects.toThrow(
      MemberNotFoundError
    );

    // Org B can legitimately create a member with same name/phone (duplicate checks stay org-scoped)
    const orgBMember = await createMember(
      orgBActor,
      createMemberSchema.parse({
        fullName: 'Isolated Member',
        phone: '0240001111',
      })
    );
    expect(orgBMember.id).not.toBe(orgAMember.id);

    // Non-OWNER database user is rejected as revoked by verifyActiveOwnerInDatabase
    const nowSec = Math.floor(Date.now() / 1000);
    const nonOwnerAuth = await verifyActiveOwnerInDatabase({
      sub: designerUser.id,
      role: 'OWNER',
      org: orgC.id,
      ver: designerUser.sessionVersion,
      iat: nowSec - 5,
      exp: nowSec + 600,
    });
    expect(nonOwnerAuth.status).toBe('revoked');
  }, 25_000);

  it('detects name, phone, and archived-member duplicates cleanly while allowing confirmDuplicate=true', async () => {
    const { actor } = await createTestOrgAndUser('dups');

    const first = await createMember(
      actor,
      createMemberSchema.parse({
        fullName: 'Kwame Mensah',
        phone: '024 333 4444',
      })
    );

    // 1. Phone match triggers PHONE duplicate warning
    await expect(
      createMember(
        actor,
        createMemberSchema.parse({
          fullName: 'Different Fullname',
          phone: '024-333-4444',
        })
      )
    ).rejects.toMatchObject({
      name: 'MemberDuplicateError',
      candidates: [expect.objectContaining({ id: first.id, matchReason: 'PHONE', isArchived: false })],
    });

    // 2. Archive first member -> duplicate detection STILL warns and marks isArchived=true
    await archiveMember(actor, first.id);

    await expect(
      createMember(
        actor,
        createMemberSchema.parse({
          fullName: 'kwame   mensah',
        })
      )
    ).rejects.toMatchObject({
      name: 'MemberDuplicateError',
      candidates: [expect.objectContaining({ id: first.id, matchReason: 'NAME', isArchived: true })],
    });

    // 3. Explicit confirmation permits creating a legitimate distinct member with the same name
    const confirmedSecond = await createMember(
      actor,
      createMemberSchema.parse({
        fullName: 'Kwame Mensah',
        confirmDuplicate: true,
      })
    );
    expect(confirmedSecond.id).not.toBe(first.id);
  }, 25_000);

  it('prevents concurrent duplicate creation races via advisory lock and rolls back member writes if audit logging fails', async () => {
    const { actor } = await createTestOrgAndUser('concurrency-rollback');

    // Concurrent duplicate requests without confirmDuplicate: exactly 1 succeeds, 1 throws MemberDuplicateError
    const payload = createMemberSchema.parse({
      fullName: 'Concurrent Grace',
      phone: '0248889999',
    });

    const settled = await Promise.allSettled([
      createMember(actor, payload),
      createMember(actor, payload),
    ]);

    const fulfilled = settled.filter((r) => r.status === 'fulfilled');
    const rejected = settled.filter((r) => r.status === 'rejected');

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(
      MemberDuplicateError
    );

    const existingMemberId = (
      fulfilled[0] as PromiseFulfilledResult<{ id: string }>
    ).value.id;

    // Simulate AuditLog failure during createMember -> transaction must roll back member creation
    vi.spyOn(auditService, 'recordAuditEvent').mockRejectedValueOnce(
      new Error('Simulated audit failure on create')
    );

    await expect(
      createMember(
        actor,
        createMemberSchema.parse({ fullName: 'Rollback Candidate' })
      )
    ).rejects.toThrow('Simulated audit failure on create');

    const orgMembersAfterCreateFail = await prisma.member.findMany({
      where: { organisationId: actor.organisationId },
    });
    expect(orgMembersAfterCreateFail.map((m) => m.id)).toEqual([existingMemberId]);

    // Simulate AuditLog failure during archiveMember -> archive timestamp must roll back
    vi.spyOn(auditService, 'recordAuditEvent').mockRejectedValueOnce(
      new Error('Simulated audit failure on archive')
    );

    await expect(archiveMember(actor, existingMemberId)).rejects.toThrow(
      'Simulated audit failure on archive'
    );

    const untouchedMember = await prisma.member.findUnique({
      where: { id: existingMemberId },
    });
    expect(untouchedMember?.archivedAt).toBeNull();
  }, 25_000);
});
