import { describe, it, expect, vi } from 'vitest';
import {
  AUDIT_ACTIONS,
  recordAuditEvent,
  sanitizeAuditMetadata,
} from './audit-service';

describe('Audit Service & Metadata Sanitization', () => {
  it('strips sensitive personal information, credentials, tokens, notes, and contact details from metadata', () => {
    const sanitized = sanitizeAuditMetadata({
      changedFields: ['fullName', 'birthDay'],
      hasNotes: true,
      notes: 'Confidential pastoral counseling note',
      phone: '+233245550199',
      email: 'private@example.com',
      password: 'secret',
      passwordHash: 'hash',
      sessionToken: 'tok_123',
      nested: {
        secretKey: 'abc',
        phoneNumber: '0245550199',
        safeFlag: true,
      },
    });

    expect(sanitized).toEqual({
      changedFields: ['fullName', 'birthDay'],
      hasNotes: true,
      nested: {
        safeFlag: true,
      },
    });
  });

  it('returns undefined when metadata is empty or contains only stripped sensitive keys', () => {
    expect(sanitizeAuditMetadata(undefined)).toBeUndefined();
    expect(sanitizeAuditMetadata({})).toBeUndefined();
    expect(sanitizeAuditMetadata({ notes: 'secret', email: 'a@b.com' })).toBeUndefined();
  });

  it('writes sanitized append-only audit logs and rejects missing required identifiers', async () => {
    const createMock = vi.fn(async ({ data }) => ({ id: 'aud_1', ...data }));
    const fakeTx = { auditLog: { create: createMock } } as unknown as Parameters<
      typeof recordAuditEvent
    >[0];

    await recordAuditEvent(fakeTx, {
      organisationId: 'org_1',
      actorUserId: 'usr_1',
      action: AUDIT_ACTIONS.MEMBER_UPDATED,
      entityType: 'Member',
      entityId: 'mem_1',
      metadata: {
        changedFields: ['fullName'],
        notes: 'Must never persist in audit metadata',
      },
    });

    expect(createMock).toHaveBeenCalledTimes(1);
    expect(createMock.mock.calls[0]?.[0]).toEqual({
      data: {
        organisationId: 'org_1',
        actorUserId: 'usr_1',
        action: 'MEMBER_UPDATED',
        entityType: 'Member',
        entityId: 'mem_1',
        metadata: { changedFields: ['fullName'] },
      },
    });

    await expect(
      recordAuditEvent(fakeTx, {
        organisationId: '',
        actorUserId: 'usr_1',
        action: AUDIT_ACTIONS.MEMBER_CREATED,
        entityType: 'Member',
        entityId: 'mem_1',
      })
    ).rejects.toThrow(/requires valid organisationId/i);
  });
});
