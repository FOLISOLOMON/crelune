import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  MAX_MEMBER_PHOTO_BYTES,
  type MemberDetail,
} from '@crelune/shared';
import {
  buildCreateMemberPayload,
  buildUpdateMemberPayload,
  describeDuplicateMatchReason,
  EMPTY_MEMBER_FORM_VALUES,
  formatMemberBirthday,
  getMemberInitials,
  getMemberPhotoStreamUrl,
  memberDetailToFormValues,
  validateClientPhotoFile,
} from './member-form-utils';
import {
  archiveMemberRequest,
  createMemberRequest,
  fetchMembersDirectory,
  MemberApiError,
  removeMemberPhotoRequest,
  restoreMemberRequest,
  updateMemberRequest,
  uploadMemberPhotoRequest,
} from './member-api-client';

function makeMemberDetail(overrides: Partial<MemberDetail> = {}): MemberDetail {
  return {
    id: 'mem_123',
    fullName: 'Amara Osei',
    preferredName: 'Amy',
    birthDay: 14,
    birthMonth: 10,
    birthYear: 1994,
    phone: '+233240000111',
    email: 'amara@example.com',
    hasPhoto: false,
    photoUpdatedAt: null,
    isActive: true,
    archivedAt: null,
    createdAt: '2026-01-10T09:00:00.000Z',
    updatedAt: '2026-01-10T09:00:00.000Z',
    notes: 'Prefers purple gold gradient flyers.',
    ...overrides,
  };
}

describe('member-form-utils', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('builds valid create payload with unknown birthYear preserved as null', () => {
    const result = buildCreateMemberPayload({
      ...EMPTY_MEMBER_FORM_VALUES,
      fullName: '  Kwame Mensah ',
      preferredName: '  ',
      birthMonth: '10',
      birthDay: '14',
      birthYear: '',
      phone: ' +233 24 000 0000 ',
      email: ' kwame@example.com ',
      notes: 'Choir creative lead',
    });

    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.data).toEqual({
      fullName: 'Kwame Mensah',
      preferredName: null,
      birthMonth: 10,
      birthDay: 14,
      birthYear: null,
      phone: '+233 24 000 0000',
      email: 'kwame@example.com',
      notes: 'Choir creative lead',
      confirmDuplicate: false,
    });
  });

  it('rejects missing fullName, non-numeric days, invalid calendar dates, and future birth years', () => {
    const missingName = buildCreateMemberPayload(EMPTY_MEMBER_FORM_VALUES);
    expect(missingName.success).toBe(false);
    if (!missingName.success) {
      expect(missingName.fieldErrors.fullName).toBeDefined();
    }

    const nonNumericDay = buildCreateMemberPayload({
      ...EMPTY_MEMBER_FORM_VALUES,
      fullName: 'Ama Boateng',
      birthMonth: '4',
      birthDay: 'abc',
    });
    expect(nonNumericDay.success).toBe(false);
    if (!nonNumericDay.success) {
      expect(nonNumericDay.fieldErrors.birthDay).toMatch(/whole number/i);
    }

    const invalidCalendarDate = buildCreateMemberPayload({
      ...EMPTY_MEMBER_FORM_VALUES,
      fullName: 'Ama Boateng',
      birthMonth: '2',
      birthDay: '30',
    });
    expect(invalidCalendarDate.success).toBe(false);
    if (!invalidCalendarDate.success) {
      expect(invalidCalendarDate.fieldErrors.birthDay).toBeDefined();
    }

    const futureYear = buildCreateMemberPayload({
      ...EMPTY_MEMBER_FORM_VALUES,
      fullName: 'Ama Boateng',
      birthMonth: '2',
      birthDay: '14',
      birthYear: '2099',
    });
    expect(futureYear.success).toBe(false);
    if (!futureYear.success) {
      expect(futureYear.fieldErrors.birthYear).toMatch(/future/i);
    }
  });

  it('computes minimal diffed update payload and preserves atomic birthday clearing', () => {
    const initial = makeMemberDetail();
    const unchanged = buildUpdateMemberPayload(
      initial,
      memberDetailToFormValues(initial)
    );
    expect(unchanged).toEqual({
      success: true,
      hasChanges: false,
      data: null,
    });

    const clearedBirthday = buildUpdateMemberPayload(initial, {
      ...memberDetailToFormValues(initial),
      birthMonth: '',
      birthDay: '',
      birthYear: '',
      notes: 'Updated note',
    });

    expect(clearedBirthday.success).toBe(true);
    if (!clearedBirthday.success || !clearedBirthday.hasChanges) return;
    expect(clearedBirthday.data).toEqual({
      birthMonth: null,
      birthDay: null,
      birthYear: null,
      notes: 'Updated note',
    });
  });

  it('formats date-only birthdays consistently without timezone shift', () => {
    expect(
      formatMemberBirthday({ birthMonth: 10, birthDay: 14, birthYear: null })
    ).toBe('14 Oct');
    expect(
      formatMemberBirthday({ birthMonth: 2, birthDay: 29, birthYear: 1996 })
    ).toBe('29 Feb 1996');
    expect(
      formatMemberBirthday({ birthMonth: null, birthDay: null, birthYear: null })
    ).toBe('Not recorded');
  });

  it('builds private cache-busted photo URLs without exposing storage keys', () => {
    expect(getMemberPhotoStreamUrl('mem_1')).toBe('/api/members/mem_1/photo');
    expect(
      getMemberPhotoStreamUrl('mem_1', '2026-05-01T12:00:00.000Z')
    ).toBe('/api/members/mem_1/photo?v=2026-05-01T12%3A00%3A00.000Z');
  });

  it('validates supported image formats and 10 MB maximum size', () => {
    expect(
      validateClientPhotoFile({ type: 'image/jpeg', size: 2048 })
    ).toEqual({ valid: true });
    expect(
      validateClientPhotoFile({ type: 'image/png', size: MAX_MEMBER_PHOTO_BYTES })
    ).toEqual({ valid: true });

    const badMime = validateClientPhotoFile({
      type: 'image/svg+xml',
      size: 1024,
    });
    expect(badMime.valid).toBe(false);

    const tooLarge = validateClientPhotoFile({
      type: 'image/webp',
      size: MAX_MEMBER_PHOTO_BYTES + 1,
    });
    expect(tooLarge.valid).toBe(false);

    const empty = validateClientPhotoFile({
      type: 'image/jpeg',
      size: 0,
    });
    expect(empty.valid).toBe(false);
  });

  it('computes accessible initials and duplicate reason descriptions', () => {
    expect(getMemberInitials('Amara Akosua Osei')).toBe('AO');
    expect(getMemberInitials('Kofi')).toBe('KO');
    expect(describeDuplicateMatchReason('PHONE_AND_NAME')).toContain('phone');
    expect(describeDuplicateMatchReason('NAME')).toContain('full name');
  });
});

describe('member-api-client', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('serializes directory search, status, birthMonth, sort, and page parameters', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          members: [],
          pagination: {
            page: 2,
            limit: 25,
            total: 30,
            totalPages: 2,
            hasNextPage: false,
            hasPreviousPage: true,
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    );

    const res = await fetchMembersDirectory({
      q: 'Amara',
      status: 'archived',
      birthMonth: 10,
      sort: 'birthday_asc',
      page: 2,
      limit: 25,
    });

    expect(res.pagination.page).toBe(2);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(
      '/api/members?q=Amara&status=archived&birthMonth=10&sort=birthday_asc&page=2&limit=25'
    );
    expect(init?.credentials).toBe('same-origin');
  });

  it('handles 409 potential duplicate detection and explicit confirmation retry', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            error: 'Potential duplicate detected.',
            code: 'POTENTIAL_DUPLICATE_MEMBER',
            requiresConfirmation: true,
            duplicateCandidates: [
              {
                id: 'mem_existing',
                fullName: 'Amara Osei',
                preferredName: null,
                birthMonth: 10,
                birthDay: 14,
                isArchived: false,
                matchReason: 'NAME',
              },
            ],
          }),
          { status: 409, headers: { 'Content-Type': 'application/json' } }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ member: makeMemberDetail({ id: 'mem_new' }) }),
          { status: 201, headers: { 'Content-Type': 'application/json' } }
        )
      );

    const firstAttempt = await createMemberRequest({
      fullName: 'Amara Osei',
      confirmDuplicate: false,
    });
    expect(firstAttempt.status).toBe('duplicate');
    if (firstAttempt.status === 'duplicate') {
      expect(firstAttempt.duplicateCandidates).toHaveLength(1);
      expect(firstAttempt.duplicateCandidates[0].id).toBe('mem_existing');
    }

    const secondAttempt = await createMemberRequest({
      fullName: 'Amara Osei',
      confirmDuplicate: true,
    });
    expect(secondAttempt.status).toBe('created');
    if (secondAttempt.status === 'created') {
      expect(secondAttempt.member.id).toBe('mem_new');
    }
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('maps server validation issues to fieldErrors on PATCH error', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          error: 'Member input failed validation.',
          code: 'VALIDATION_ERROR',
          issues: [{ path: 'email', message: 'Invalid email address' }],
        }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      )
    );

    await expect(
      updateMemberRequest('mem_123', { email: 'bad-email' })
    ).rejects.toMatchObject({
      name: 'MemberApiError',
      status: 400,
      code: 'VALIDATION_ERROR',
      fieldErrors: { email: 'Invalid email address' },
    });
  });

  it('executes archive, restore, photo upload, and photo removal requests with same-origin credentials', async () => {
    const member = makeMemberDetail();
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            member: { ...member, isActive: false, archivedAt: '2026-06-01T00:00:00.000Z' },
            changed: true,
          }),
          { status: 200 }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            member: { ...member, isActive: true, archivedAt: null },
            changed: true,
          }),
          { status: 200 }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            member: {
              ...member,
              hasPhoto: true,
              photoUpdatedAt: '2026-06-02T10:00:00.000Z',
            },
            photo: {
              url: '/api/members/mem_123/photo',
              contentType: 'image/jpeg',
              updatedAt: '2026-06-02T10:00:00.000Z',
            },
          }),
          { status: 200 }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            member: { ...member, hasPhoto: false, photoUpdatedAt: null },
            removed: true,
          }),
          { status: 200 }
        )
      );

    const archived = await archiveMemberRequest('mem_123');
    expect(archived.member.isActive).toBe(false);

    const restored = await restoreMemberRequest('mem_123');
    expect(restored.member.isActive).toBe(true);

    const photoFile = new File([new Uint8Array([1, 2, 3])], 'portrait.jpg', {
      type: 'image/jpeg',
    });
    const uploaded = await uploadMemberPhotoRequest('mem_123', photoFile);
    expect(uploaded.member.hasPhoto).toBe(true);
    expect(uploaded.photo.url).toBe('/api/members/mem_123/photo');

    const removed = await removeMemberPhotoRequest('mem_123');
    expect(removed.removed).toBe(true);
    expect(removed.member.hasPhoto).toBe(false);

    expect(fetchMock).toHaveBeenCalledTimes(4);
    for (const [, init] of fetchMock.mock.calls) {
      expect(init?.credentials).toBe('same-origin');
    }
  });

  it('surfaces typed MemberApiError when photo upload fails with 413', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          error: 'Uploaded photo exceeds the 10 MB maximum limit.',
          code: 'FILE_TOO_LARGE',
        }),
        { status: 413 }
      )
    );

    const file = new File([new Uint8Array([1])], 'big.jpg', {
      type: 'image/jpeg',
    });

    await expect(
      uploadMemberPhotoRequest('mem_123', file)
    ).rejects.toBeInstanceOf(MemberApiError);
  });
});

