/**
 * CRELUNE — Pure Member Domain Helpers
 *
 * Single source of truth for active/archived state derivation and normalization.
 */

export interface ArchivableMemberRecord {
  archivedAt: Date | string | null | undefined;
}

/**
 * Derives active state strictly from `archivedAt` (`archivedAt IS NULL` in SQL).
 * No separate redundant `isActive` flag exists on Member records.
 */
export function isMemberActive(member: ArchivableMemberRecord): boolean {
  return member.archivedAt === null || member.archivedAt === undefined;
}

/**
 * Derives archived state strictly from `archivedAt`.
 */
export function isMemberArchived(member: ArchivableMemberRecord): boolean {
  return !isMemberActive(member);
}

/**
 * Normalizes a member's full name for duplicate detection and indexing:
 * Unicode NFKC normalization, trims outer whitespace, collapses internal gaps,
 * and folds to lowercase.
 */
export function normalizeMemberName(fullName: string): string {
  return fullName.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
}

/**
 * Normalizes optional phone numbers for duplicate detection while preserving a
 * leading `+` country indicator when supplied.
 */
export function normalizeMemberPhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const trimmed = phone.trim();
  if (!trimmed) return null;

  const hasLeadingPlus = trimmed.startsWith('+');
  const digits = trimmed.replace(/\D+/g, '');
  if (!digits) return null;

  return hasLeadingPlus ? `+${digits}` : digits;
}
