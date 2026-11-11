import { describe, it, expect } from 'vitest';
import {
  MEMBER_LIST_DEFAULT_LIMIT,
  MEMBER_LIST_MAX_LIMIT,
  createMemberSchema,
  memberIdParamSchema,
  memberListQuerySchema,
  updateMemberSchema,
} from './member.js';

describe('Member Validation Schemas', () => {
  it('accepts a valid member with full name and normalized fields and unknown birth year', () => {
    const parsed = createMemberSchema.safeParse({
      fullName: '  Ama   Mensah-Bonsu  ',
      preferredName: '  Sis.   Ama ',
      birthMonth: 2,
      birthDay: 29,
      birthYear: null,
      phone: ' +233 24 555-0199 ',
      email: '  Ama@Example.COM ',
      notes: '  Choir lead  ',
    });

    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data).toEqual({
        fullName: 'Ama Mensah-Bonsu',
        preferredName: 'Sis. Ama',
        birthMonth: 2,
        birthDay: 29,
        birthYear: null,
        phone: '+233 24 555-0199',
        email: 'ama@example.com',
        notes: 'Choir lead',
        confirmDuplicate: false,
      });
    }
  });

  it('rejects blank names, invalid phone numbers, invalid emails, and impossible birthdays', () => {
    expect(createMemberSchema.safeParse({ fullName: '   ' }).success).toBe(false);
    expect(
      createMemberSchema.safeParse({ fullName: 'Valid Name', phone: 'not-a-phone' }).success
    ).toBe(false);
    expect(
      createMemberSchema.safeParse({ fullName: 'Valid Name', phone: '123' }).success
    ).toBe(false);
    expect(
      createMemberSchema.safeParse({ fullName: 'Valid Name', email: 'bad-email' }).success
    ).toBe(false);
    expect(
      createMemberSchema.safeParse({
        fullName: 'Valid Name',
        birthMonth: 2,
        birthDay: 30,
      }).success
    ).toBe(false);
    expect(
      createMemberSchema.safeParse({
        fullName: 'Valid Name',
        birthMonth: 2,
        birthDay: 29,
        birthYear: 2025,
      }).success
    ).toBe(false);
    expect(
      createMemberSchema.safeParse({
        fullName: 'Valid Name',
        birthMonth: 5,
      }).success
    ).toBe(false);
  });

  it('rejects client-supplied organisationId, protected fields, and unknown keys via strict schemas', () => {
    expect(
      createMemberSchema.safeParse({
        fullName: 'Kwame Boateng',
        organisationId: 'org_other',
      }).success
    ).toBe(false);

    expect(
      updateMemberSchema.safeParse({
        fullName: 'Updated Name',
        archivedAt: new Date().toISOString(),
      }).success
    ).toBe(false);

    expect(
      updateMemberSchema.safeParse({
        fullName: 'Updated Name',
        isActive: false,
      }).success
    ).toBe(false);

    expect(updateMemberSchema.safeParse({}).success).toBe(false);
  });

  it('validates pagination, filtering, and route ID parameters safely', () => {
    const defaults = memberListQuerySchema.parse({});
    expect(defaults).toEqual({
      status: 'active',
      sort: 'name_asc',
      page: 1,
      limit: MEMBER_LIST_DEFAULT_LIMIT,
    });

    expect(
      memberListQuerySchema.safeParse({ limit: MEMBER_LIST_MAX_LIMIT + 1 }).success
    ).toBe(false);
    expect(memberListQuerySchema.safeParse({ birthMonth: 13 }).success).toBe(false);
    expect(memberListQuerySchema.safeParse({ extra: 'bad' }).success).toBe(false);

    expect(memberIdParamSchema.safeParse('cm4xyz_123').success).toBe(true);
    expect(memberIdParamSchema.safeParse('../admin').success).toBe(false);
  });
});
