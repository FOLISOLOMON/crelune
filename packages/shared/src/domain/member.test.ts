import { describe, it, expect } from 'vitest';
import {
  isMemberActive,
  isMemberArchived,
  normalizeMemberName,
  normalizeMemberPhone,
} from './member.js';

describe('Member Domain Helpers', () => {
  it('derives active vs archived state strictly from archivedAt', () => {
    expect(isMemberActive({ archivedAt: null })).toBe(true);
    expect(isMemberActive({ archivedAt: undefined })).toBe(true);
    expect(isMemberArchived({ archivedAt: null })).toBe(false);

    const timestamp = new Date('2026-11-11T00:00:00.000Z');
    expect(isMemberActive({ archivedAt: timestamp })).toBe(false);
    expect(isMemberArchived({ archivedAt: timestamp })).toBe(true);
    expect(isMemberArchived({ archivedAt: timestamp.toISOString() })).toBe(true);
  });

  it('normalizes member full names and phone numbers cleanly', () => {
    expect(normalizeMemberName('  Ama   Mensah-Bonsu  ')).toBe('ama mensah-bonsu');
    expect(normalizeMemberPhone(' +233 24 555-0199 ')).toBe('+233245550199');
    expect(normalizeMemberPhone('024 555 0199')).toBe('0245550199');
    expect(normalizeMemberPhone('   ')).toBeNull();
    expect(normalizeMemberPhone(null)).toBeNull();
  });
});
