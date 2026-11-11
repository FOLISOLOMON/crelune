import { describe, it, expect } from 'vitest';
import {
  classifyDuplicateCandidates,
  mapMemberDetail,
  mapMemberDirectoryItem,
} from './member-service';

describe('Member Service — Duplicate Classification & Projections', () => {
  const baseRows = [
    {
      id: 'mem_name_only',
      fullName: 'Ama Mensah',
      preferredName: null,
      normalizedName: 'ama mensah',
      normalizedPhone: '+233200000001',
      birthMonth: 5,
      birthDay: 12,
      archivedAt: null,
    },
    {
      id: 'mem_archived_phone',
      fullName: 'Different Person',
      preferredName: 'Sis. D',
      normalizedName: 'different person',
      normalizedPhone: '0245550199',
      birthMonth: 8,
      birthDay: 2,
      archivedAt: new Date('2026-01-15T00:00:00.000Z'),
    },
    {
      id: 'mem_both',
      fullName: 'Ama Mensah',
      preferredName: 'Ama',
      normalizedName: 'ama mensah',
      normalizedPhone: '0245550199',
      birthMonth: 10,
      birthDay: 14,
      archivedAt: null,
    },
  ];

  it('prioritizes PHONE_AND_NAME, then PHONE, then NAME and retains archived matches', () => {
    const candidates = classifyDuplicateCandidates(baseRows, '0245550199', 'ama mensah');

    expect(candidates).toEqual([
      {
        id: 'mem_both',
        fullName: 'Ama Mensah',
        preferredName: 'Ama',
        birthMonth: 10,
        birthDay: 14,
        isArchived: false,
        matchReason: 'PHONE_AND_NAME',
      },
      {
        id: 'mem_archived_phone',
        fullName: 'Different Person',
        preferredName: 'Sis. D',
        birthMonth: 8,
        birthDay: 2,
        isArchived: true,
        matchReason: 'PHONE',
      },
      {
        id: 'mem_name_only',
        fullName: 'Ama Mensah',
        preferredName: null,
        birthMonth: 5,
        birthDay: 12,
        isArchived: false,
        matchReason: 'NAME',
      },
    ]);
  });

  it('derives isActive strictly from archivedAt and strips private notes & storage keys from list items', () => {
    const now = new Date('2026-11-11T00:00:00.000Z');
    const row = {
      id: 'mem_1',
      fullName: 'Kofi Owusu',
      preferredName: null,
      birthDay: 14,
      birthMonth: 10,
      birthYear: null,
      phone: '0245550199',
      email: 'kofi@example.com',
      photoStorageKey: 'members/photos/secret-key.jpg',
      photoUpdatedAt: now,
      archivedAt: null,
      createdAt: now,
      updatedAt: now,
      notes: 'Sensitive pastoral notes',
    };

    const listDto = mapMemberDirectoryItem(row);
    expect(listDto.isActive).toBe(true);
    expect(listDto.hasPhoto).toBe(true);
    expect('notes' in listDto).toBe(false);
    expect('photoStorageKey' in listDto).toBe(false);

    const detailDto = mapMemberDetail(row);
    expect(detailDto.notes).toBe('Sensitive pastoral notes');
    expect(detailDto.hasPhoto).toBe(true);
    expect('photoStorageKey' in detailDto).toBe(false);

    const archivedDto = mapMemberDirectoryItem({ ...row, archivedAt: now });
    expect(archivedDto.isActive).toBe(false);
    expect(archivedDto.archivedAt).toBe(now.toISOString());
  });
});
