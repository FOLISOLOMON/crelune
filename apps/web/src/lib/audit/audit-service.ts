/**
 * CRELUNE — Application-Level Append-Only Audit Logging Service
 *
 * Writes sanitized, transactional audit records for critical operations.
 * Guarantees that any audit failure aborts the surrounding Prisma transaction.
 * Append-only semantics are enforced at the application-service layer (no update
 * or delete audit operations are exposed).
 */

import { Prisma } from '@crelune/database';

export const AUDIT_ACTIONS = {
  MEMBER_CREATED: 'MEMBER_CREATED',
  MEMBER_UPDATED: 'MEMBER_UPDATED',
  MEMBER_ARCHIVED: 'MEMBER_ARCHIVED',
  MEMBER_RESTORED: 'MEMBER_RESTORED',
  MEMBER_PHOTO_UPLOADED: 'MEMBER_PHOTO_UPLOADED',
  MEMBER_PHOTO_REPLACED: 'MEMBER_PHOTO_REPLACED',
  MEMBER_PHOTO_REMOVED: 'MEMBER_PHOTO_REMOVED',
  BIRTHDAY_PREFERENCES_UPDATED: 'BIRTHDAY_PREFERENCES_UPDATED',
  BIRTHDAY_PREP_UPDATED: 'BIRTHDAY_PREP_UPDATED',
  BIRTHDAY_REMINDER_FAILED: 'BIRTHDAY_REMINDER_FAILED',
  NOTIFICATION_READ_ALL: 'NOTIFICATION_READ_ALL',
  DESIGN_JOB_CREATED: 'DESIGN_JOB_CREATED',
  DESIGN_JOB_UPDATED: 'DESIGN_JOB_UPDATED',
  DESIGN_JOB_STATUS_CHANGED: 'DESIGN_JOB_STATUS_CHANGED',
  TEMPLATE_CREATED: 'TEMPLATE_CREATED',
  TEMPLATE_UPDATED: 'TEMPLATE_UPDATED',
  TEMPLATE_ARCHIVED: 'TEMPLATE_ARCHIVED',
  TEMPLATE_VERSION_UPLOADED: 'TEMPLATE_VERSION_UPLOADED',
  TEMPLATE_VERSION_ACTIVATED: 'TEMPLATE_VERSION_ACTIVATED',
  TEMPLATE_MAPPINGS_UPDATED: 'TEMPLATE_MAPPINGS_UPDATED',
  CREATIVE_AGENT_REGISTERED: 'CREATIVE_AGENT_REGISTERED',
  CREATIVE_AGENT_REVOKED: 'CREATIVE_AGENT_REVOKED',
  CREATIVE_DISPATCH_CREATED: 'CREATIVE_DISPATCH_CREATED',
  CREATIVE_DISPATCH_CLAIMED: 'CREATIVE_DISPATCH_CLAIMED',
  CREATIVE_DISPATCH_STATUS_CHANGED: 'CREATIVE_DISPATCH_STATUS_CHANGED',
  EXPORT_RECORD_CREATED: 'EXPORT_RECORD_CREATED',
  EXPORT_OWNER_APPROVAL_CHANGED: 'EXPORT_OWNER_APPROVAL_CHANGED',
} as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[keyof typeof AUDIT_ACTIONS];

const FORBIDDEN_METADATA_KEYS = new Set([
  'password',
  'passwordhash',
  'secret',
  'sessionsecret',
  'token',
  'sessiontoken',
  'session',
  'sessionversion',
  'cookie',
  'authorization',
  'notes',
  'phone',
  'normalizedphone',
  'email',
  'rawbody',
  'body',
  'requestbody',
  'photostoragekey',
  'storagekey',
  'objectkey',
  'signedurl',
  'presignedurl',
  'imagebytes',
  'accesskeyid',
  'secretaccesskey',
  'agenttoken',
  'claimtoken',
  'manifestjson',
  'detectlayersjson',
]);

const MAX_METADATA_DEPTH = 3;
const MAX_STRING_LENGTH = 120;
const MAX_ARRAY_ITEMS = 25;

export interface RecordAuditEventInput {
  organisationId: string;
  actorUserId?: string | null;
  action: AuditAction;
  entityType:
    | 'Member'
    | 'BirthdayPreparation'
    | 'BirthdayReminder'
    | 'Notification'
    | 'UserPreference'
    | 'DesignJob'
    | 'Template'
    | 'TemplateVersion'
    | 'TemplateFieldMapping'
    | 'CreativeUploadIntent'
    | 'CreativeAgent'
    | 'CreativeJobDispatch'
    | 'ExportRecord';
  entityId: string;
  metadata?: Record<string, unknown> | null;
}

function isSensitiveKey(key: string): boolean {
  const normalized = key.trim().toLowerCase();
  if (FORBIDDEN_METADATA_KEYS.has(normalized)) {
    return true;
  }
  if (
    normalized.includes('password') ||
    normalized.includes('secret') ||
    normalized.includes('token') ||
    normalized.includes('cookie') ||
    normalized.includes('authorization')
  ) {
    return true;
  }
  // Allow boolean presence indicators (`hasNotes`, `hasPhone`, `hasEmail`),
  // while blocking actual note/phone/email payload fields.
  if (normalized.startsWith('has')) {
    return false;
  }
  return (
    normalized === 'note' ||
    normalized === 'phonenumber' ||
    normalized === 'emailaddress' ||
    normalized.endsWith('notes') ||
    normalized.endsWith('phone') ||
    normalized.endsWith('email')
  );
}

function sanitizeValue(value: unknown, depth: number): unknown {
  if (value === null || typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === 'string') {
    return value.length > MAX_STRING_LENGTH
      ? `${value.slice(0, MAX_STRING_LENGTH)}...`
      : value;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (depth >= MAX_METADATA_DEPTH) {
    return undefined;
  }
  if (Array.isArray(value)) {
    return value
      .slice(0, MAX_ARRAY_ITEMS)
      .map((item) => sanitizeValue(item, depth + 1))
      .filter((item) => item !== undefined);
  }
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (isSensitiveKey(k)) {
        continue;
      }
      const clean = sanitizeValue(v, depth + 1);
      if (clean !== undefined) {
        out[k] = clean;
      }
    }
    return out;
  }
  return undefined;
}

/**
 * Strips sensitive fields, credentials, private notes, contact details, and oversized
 * structures before persisting audit metadata.
 */
export function sanitizeAuditMetadata(
  raw?: Record<string, unknown> | null
): Prisma.InputJsonValue | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return undefined;
  }
  const sanitized = sanitizeValue(raw, 0) as Record<string, unknown> | undefined;
  if (!sanitized || Object.keys(sanitized).length === 0) {
    return undefined;
  }
  return sanitized as Prisma.InputJsonValue;
}

/**
 * Persists a single append-only audit event inside an active database transaction.
 * Throws if required identifiers are missing or if Prisma insertion fails, rolling
 * back the enclosing business transaction.
 */
export async function recordAuditEvent(
  tx: Prisma.TransactionClient,
  input: RecordAuditEventInput
) {
  if (!input.organisationId || !input.action || !input.entityId) {
    throw new Error('AuditLog requires valid organisationId, action, and entityId.');
  }

  const cleanMetadata = sanitizeAuditMetadata(input.metadata);

  return tx.auditLog.create({
    data: {
      organisationId: input.organisationId,
      actorUserId: input.actorUserId ?? null,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      ...(cleanMetadata !== undefined ? { metadata: cleanMetadata } : {}),
    },
  });
}