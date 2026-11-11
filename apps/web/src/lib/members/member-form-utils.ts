import {
  ALLOWED_MEMBER_PHOTO_MIME_TYPES,
  MAX_MEMBER_PHOTO_BYTES,
  createMemberSchema,
  updateMemberSchema,
  type CreateMemberInput,
  type DuplicateMatchReason,
  type MemberDetail,
  type MemberDirectoryItem,
  type UpdateMemberInput,
} from '@crelune/shared';

export const MONTH_OPTIONS = [
  { value: 1, label: 'January', short: 'Jan' },
  { value: 2, label: 'February', short: 'Feb' },
  { value: 3, label: 'March', short: 'Mar' },
  { value: 4, label: 'April', short: 'Apr' },
  { value: 5, label: 'May', short: 'May' },
  { value: 6, label: 'June', short: 'Jun' },
  { value: 7, label: 'July', short: 'Jul' },
  { value: 8, label: 'August', short: 'Aug' },
  { value: 9, label: 'September', short: 'Sep' },
  { value: 10, label: 'October', short: 'Oct' },
  { value: 11, label: 'November', short: 'Nov' },
  { value: 12, label: 'December', short: 'Dec' },
] as const;

export type MemberFormField =
  | 'fullName'
  | 'preferredName'
  | 'birthMonth'
  | 'birthDay'
  | 'birthYear'
  | 'phone'
  | 'email'
  | 'notes';

export type MemberFieldErrors = Partial<Record<MemberFormField, string>>;

export interface MemberFormValues {
  fullName: string;
  preferredName: string;
  birthMonth: string;
  birthDay: string;
  birthYear: string;
  phone: string;
  email: string;
  notes: string;
}

export const EMPTY_MEMBER_FORM_VALUES: MemberFormValues = {
  fullName: '',
  preferredName: '',
  birthMonth: '',
  birthDay: '',
  birthYear: '',
  phone: '',
  email: '',
  notes: '',
};

export function memberDetailToFormValues(member: MemberDetail): MemberFormValues {
  return {
    fullName: member.fullName,
    preferredName: member.preferredName ?? '',
    birthMonth: member.birthMonth !== null ? String(member.birthMonth) : '',
    birthDay: member.birthDay !== null ? String(member.birthDay) : '',
    birthYear: member.birthYear !== null ? String(member.birthYear) : '',
    phone: member.phone ?? '',
    email: member.email ?? '',
    notes: member.notes ?? '',
  };
}

function parseOptionalWholeNumber(
  raw: string,
  fieldLabel: string
): { ok: true; value: number | null } | { ok: false; error: string } {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { ok: true, value: null };
  }
  if (!/^\d+$/.test(trimmed)) {
    return { ok: false, error: `${fieldLabel} must be a whole number` };
  }
  const parsed = Number.parseInt(trimmed, 10);
  if (!Number.isSafeInteger(parsed)) {
    return { ok: false, error: `${fieldLabel} is not valid` };
  }
  return { ok: true, value: parsed };
}

function mapZodIssuesToFieldErrors(
  issues: ReadonlyArray<{ path: (string | number)[]; message: string }>
): { fieldErrors: MemberFieldErrors; formError: string | null } {
  const fieldErrors: MemberFieldErrors = {};
  let formError: string | null = null;

  const knownFields = new Set<MemberFormField>([
    'fullName',
    'preferredName',
    'birthMonth',
    'birthDay',
    'birthYear',
    'phone',
    'email',
    'notes',
  ]);

  for (const issue of issues) {
    const firstKey = issue.path[0];
    if (typeof firstKey === 'string' && knownFields.has(firstKey as MemberFormField)) {
      const typedKey = firstKey as MemberFormField;
      if (!fieldErrors[typedKey]) {
        fieldErrors[typedKey] = issue.message;
      }
    } else if (!formError) {
      formError = issue.message;
    }
  }

  return { fieldErrors, formError };
}

function normalizeOptionalString(raw: string): string | null {
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export type BuildCreatePayloadResult =
  | { success: true; data: CreateMemberInput }
  | { success: false; fieldErrors: MemberFieldErrors; formError: string | null };

/**
 * Parses controlled form strings into a strictly validated `CreateMemberInput`,
 * preserving unknown birth years as `null` without fabricating a year.
 */
export function buildCreateMemberPayload(
  values: MemberFormValues,
  confirmDuplicate = false
): BuildCreatePayloadResult {
  const fieldErrors: MemberFieldErrors = {};

  const monthParsed = parseOptionalWholeNumber(values.birthMonth, 'Birth month');
  const dayParsed = parseOptionalWholeNumber(values.birthDay, 'Birth day');
  const yearParsed = parseOptionalWholeNumber(values.birthYear, 'Birth year');

  if (!monthParsed.ok) fieldErrors.birthMonth = monthParsed.error;
  if (!dayParsed.ok) fieldErrors.birthDay = dayParsed.error;
  if (!yearParsed.ok) fieldErrors.birthYear = yearParsed.error;

  if (Object.keys(fieldErrors).length > 0) {
    return {
      success: false,
      fieldErrors,
      formError: 'Please fix the highlighted fields before continuing.',
    };
  }

  const candidate = {
    fullName: values.fullName.trim(),
    preferredName: normalizeOptionalString(values.preferredName),
    birthMonth: monthParsed.ok ? monthParsed.value : null,
    birthDay: dayParsed.ok ? dayParsed.value : null,
    birthYear: yearParsed.ok ? yearParsed.value : null,
    phone: normalizeOptionalString(values.phone),
    email: normalizeOptionalString(values.email),
    notes: normalizeOptionalString(values.notes),
    confirmDuplicate,
  };

  const parsed = createMemberSchema.safeParse(candidate);
  if (!parsed.success) {
    const mapped = mapZodIssuesToFieldErrors(parsed.error.issues);
    return {
      success: false,
      fieldErrors: mapped.fieldErrors,
      formError: mapped.formError,
    };
  }

  return { success: true, data: parsed.data };
}

export type BuildUpdatePayloadResult =
  | { success: true; hasChanges: true; data: UpdateMemberInput }
  | { success: true; hasChanges: false; data: null }
  | { success: false; fieldErrors: MemberFieldErrors; formError: string | null };

/**
 * Computes a diffed `UpdateMemberInput` from initial member state and form values.
 * Sends `birthMonth`, `birthDay`, and `birthYear` together when any birthday field changes
 * so server-side date tuple integrity checks always receive consistent coordinates.
 */
export function buildUpdateMemberPayload(
  initial: MemberDetail,
  values: MemberFormValues
): BuildUpdatePayloadResult {
  const fieldErrors: MemberFieldErrors = {};

  const monthParsed = parseOptionalWholeNumber(values.birthMonth, 'Birth month');
  const dayParsed = parseOptionalWholeNumber(values.birthDay, 'Birth day');
  const yearParsed = parseOptionalWholeNumber(values.birthYear, 'Birth year');

  if (!monthParsed.ok) fieldErrors.birthMonth = monthParsed.error;
  if (!dayParsed.ok) fieldErrors.birthDay = dayParsed.error;
  if (!yearParsed.ok) fieldErrors.birthYear = yearParsed.error;

  if (Object.keys(fieldErrors).length > 0) {
    return {
      success: false,
      fieldErrors,
      formError: 'Please fix the highlighted fields before saving.',
    };
  }

  const nextFullName = values.fullName.trim();
  const nextPreferredName = normalizeOptionalString(values.preferredName);
  const nextBirthMonth = monthParsed.ok ? monthParsed.value : null;
  const nextBirthDay = dayParsed.ok ? dayParsed.value : null;
  const nextBirthYear = yearParsed.ok ? yearParsed.value : null;
  const nextPhone = normalizeOptionalString(values.phone);
  const nextEmail = normalizeOptionalString(values.email);
  const nextNotes = normalizeOptionalString(values.notes);

  const patch: Record<string, unknown> = {};

  if (nextFullName !== initial.fullName) {
    patch.fullName = nextFullName;
  }
  if (nextPreferredName !== initial.preferredName) {
    patch.preferredName = nextPreferredName;
  }
  if (
    nextBirthMonth !== initial.birthMonth ||
    nextBirthDay !== initial.birthDay ||
    nextBirthYear !== initial.birthYear
  ) {
    patch.birthMonth = nextBirthMonth;
    patch.birthDay = nextBirthDay;
    patch.birthYear = nextBirthYear;
  }
  if (nextPhone !== initial.phone) {
    patch.phone = nextPhone;
  }
  if (nextEmail !== initial.email) {
    patch.email = nextEmail;
  }
  if (nextNotes !== initial.notes) {
    patch.notes = nextNotes;
  }

  if (Object.keys(patch).length === 0) {
    return { success: true, hasChanges: false, data: null };
  }

  const parsed = updateMemberSchema.safeParse(patch);
  if (!parsed.success) {
    const mapped = mapZodIssuesToFieldErrors(parsed.error.issues);
    return {
      success: false,
      fieldErrors: mapped.fieldErrors,
      formError: mapped.formError,
    };
  }

  return { success: true, hasChanges: true, data: parsed.data };
}

/**
 * Formats date-only birthday coordinates without timezone conversion.
 */
export function formatMemberBirthday(
  member: Pick<MemberDirectoryItem, 'birthMonth' | 'birthDay' | 'birthYear'>,
  fallback = 'Not recorded'
): string {
  if (member.birthMonth === null || member.birthDay === null) {
    return fallback;
  }
  const monthMeta = MONTH_OPTIONS[member.birthMonth - 1];
  if (!monthMeta) {
    return fallback;
  }
  if (member.birthYear !== null) {
    return `${member.birthDay} ${monthMeta.short} ${member.birthYear}`;
  }
  return `${member.birthDay} ${monthMeta.short}`;
}

export function formatBirthdayMonthDay(
  birthMonth: number | null,
  birthDay: number | null
): string | null {
  if (birthMonth === null || birthDay === null) {
    return null;
  }
  const monthMeta = MONTH_OPTIONS[birthMonth - 1];
  if (!monthMeta) {
    return null;
  }
  return `${birthDay} ${monthMeta.short}`;
}

export function formatMemberTimestamp(isoString: string): string {
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) {
    return isoString;
  }
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(date);
}

export function getMemberInitials(fullName: string): string {
  const parts = fullName
    .trim()
    .split(/\s+/)
    .filter((part) => part.length > 0);
  if (parts.length === 0) {
    return 'M';
  }
  if (parts.length === 1) {
    return parts[0].slice(0, 2).toUpperCase();
  }
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

/**
 * Builds the private, cache-busted photo stream endpoint URL without exposing storage keys.
 */
export function getMemberPhotoStreamUrl(
  memberId: string,
  photoUpdatedAt?: string | null
): string {
  const basePath = `/api/members/${encodeURIComponent(memberId)}/photo`;
  if (!photoUpdatedAt) {
    return basePath;
  }
  return `${basePath}?v=${encodeURIComponent(photoUpdatedAt)}`;
}

export function validateClientPhotoFile(file: {
  type: string;
  size: number;
  name?: string;
}): { valid: true } | { valid: false; error: string } {
  const normalizedType = file.type.toLowerCase();
  if (
    !ALLOWED_MEMBER_PHOTO_MIME_TYPES.includes(
      normalizedType as (typeof ALLOWED_MEMBER_PHOTO_MIME_TYPES)[number]
    )
  ) {
    return {
      valid: false,
      error: 'Please choose a JPEG, PNG, or WebP image file.',
    };
  }
  if (file.size <= 0) {
    return {
      valid: false,
      error: 'The selected image file is empty.',
    };
  }
  if (file.size > MAX_MEMBER_PHOTO_BYTES) {
    return {
      valid: false,
      error: 'Photo exceeds the 10 MB maximum file size limit.',
    };
  }
  return { valid: true };
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${Math.round(bytes / 1024)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function describeDuplicateMatchReason(reason: DuplicateMatchReason): string {
  switch (reason) {
    case 'PHONE_AND_NAME':
      return 'Matches both phone number and full name';
    case 'PHONE':
      return 'Matches existing phone number';
    case 'NAME':
    default:
      return 'Matches existing full name';
  }
}

export function mapServerIssuesToFieldErrors(
  issues: Array<{ path: string; message: string }> | undefined
): MemberFieldErrors {
  if (!issues || issues.length === 0) {
    return {};
  }
  const fieldErrors: MemberFieldErrors = {};
  for (const issue of issues) {
    const key = issue.path.split('.')[0] as MemberFormField;
    if (key && !fieldErrors[key]) {
      fieldErrors[key] = issue.message;
    }
  }
  return fieldErrors;
}

