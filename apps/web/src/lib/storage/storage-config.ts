/**
 * CRELUNE — Private Object Storage Configuration & Key Isolation
 *
 * Server-only configuration loader and environment/organisation-scoped key builder.
 * Guarantees credentials and branch/environment namespaces cannot leak or cross boundaries.
 */

import crypto from 'node:crypto';

export type StorageEnvPrefix = 'development' | 'staging' | 'production';

export interface ObjectStorageConfig {
  endpoint: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  envPrefix: StorageEnvPrefix;
}

const VALID_ID_REGEX = /^[a-zA-Z0-9_-]{1,64}$/;
const ALLOWED_ENV_PREFIXES = new Set<StorageEnvPrefix>([
  'development',
  'staging',
  'production',
]);
const ALLOWED_EXTENSIONS = new Set(['jpg', 'png', 'webp']);

const DEV_BRANCH_ID = 'br-nameless-silence-bexjp44k';
const PROD_BRANCH_ID = 'br-withered-moon-be8coj8h';

export class StorageConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StorageConfigError';
  }
}

export class StorageKeyViolationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StorageKeyViolationError';
  }
}

/**
 * Loads and validates Neon Object Storage S3 credentials and environment isolation bounds.
 * Never embeds credential values in error messages.
 */
export function getObjectStorageConfig(
  env: Record<string, string | undefined> = process.env
): ObjectStorageConfig {
  const endpointRaw = (env.AWS_ENDPOINT_URL_S3 || '').trim();
  const region = (env.AWS_REGION || '').trim();
  const accessKeyId = (env.AWS_ACCESS_KEY_ID || '').trim();
  const secretAccessKey = (env.AWS_SECRET_ACCESS_KEY || '').trim();
  const bucket = (env.OBJECT_STORAGE_BUCKET || '').trim();
  const envPrefix = (env.OBJECT_STORAGE_ENV_PREFIX || '').trim() as StorageEnvPrefix;

  if (!endpointRaw || !region || !accessKeyId || !secretAccessKey || !bucket || !envPrefix) {
    throw new StorageConfigError(
      'Object storage configuration is incomplete. Verify server environment variables.'
    );
  }

  let parsedEndpoint: URL;
  try {
    parsedEndpoint = new URL(endpointRaw);
  } catch {
    throw new StorageConfigError('AWS_ENDPOINT_URL_S3 is not a valid URL.');
  }

  if (parsedEndpoint.protocol !== 'https:') {
    throw new StorageConfigError('AWS_ENDPOINT_URL_S3 must use HTTPS.');
  }

  if (!ALLOWED_ENV_PREFIXES.has(envPrefix)) {
    throw new StorageConfigError(
      'OBJECT_STORAGE_ENV_PREFIX must be one of development, staging, or production.'
    );
  }

  if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket)) {
    throw new StorageConfigError('OBJECT_STORAGE_BUCKET has an invalid S3 bucket name.');
  }

  const endpointHost = parsedEndpoint.hostname.toLowerCase();
  const neonBranch = (env.NEON_BRANCH || '').trim().toLowerCase();
  const neonBranchId = (env.NEON_BRANCH_ID || '').trim();

  // Fail closed on cross-environment / cross-branch storage configuration mistakes
  if (envPrefix === 'development') {
    if (neonBranch === 'production' || neonBranchId === PROD_BRANCH_ID) {
      throw new StorageConfigError(
        'Refusing development storage prefix when targeting production database branch.'
      );
    }
    if (endpointHost.includes(PROD_BRANCH_ID) || bucket.toLowerCase().includes('prod')) {
      throw new StorageConfigError(
        'Refusing development storage configuration pointing at production storage endpoint or bucket.'
      );
    }
  } else if (envPrefix === 'production') {
    if (neonBranch === 'development' || neonBranchId === DEV_BRANCH_ID) {
      throw new StorageConfigError(
        'Refusing production storage prefix while attached to development branch.'
      );
    }
    if (endpointHost.includes(DEV_BRANCH_ID)) {
      throw new StorageConfigError(
        'Refusing production storage prefix pointing at development storage endpoint.'
      );
    }
  }

  return {
    endpoint: parsedEndpoint.origin,
    region,
    accessKeyId,
    secretAccessKey,
    bucket,
    envPrefix,
  };
}

function assertSafeIdentifier(value: string, label: string): string {
  if (!VALID_ID_REGEX.test(value)) {
    throw new StorageKeyViolationError(`${label} contains invalid characters for storage paths.`);
  }
  return value;
}

export function buildMemberPhotoPrefix(params: {
  envPrefix: StorageEnvPrefix;
  organisationId: string;
  memberId: string;
}): string {
  if (!ALLOWED_ENV_PREFIXES.has(params.envPrefix)) {
    throw new StorageKeyViolationError('Invalid storage environment prefix.');
  }
  const orgId = assertSafeIdentifier(params.organisationId, 'organisationId');
  const memberId = assertSafeIdentifier(params.memberId, 'memberId');
  return `${params.envPrefix}/organisations/${orgId}/members/${memberId}/photos/`;
}

/**
 * Generates an unpredictable, server-controlled, organisation-scoped object key.
 * Original uploaded filenames are never used.
 */
export function buildMemberPhotoObjectKey(params: {
  envPrefix: StorageEnvPrefix;
  organisationId: string;
  memberId: string;
  extension: 'jpg' | 'png' | 'webp';
  objectId?: string;
}): string {
  if (!ALLOWED_EXTENSIONS.has(params.extension)) {
    throw new StorageKeyViolationError('Unsupported image extension for object key.');
  }
  const objectId = params.objectId ?? crypto.randomUUID();
  if (!VALID_ID_REGEX.test(objectId)) {
    throw new StorageKeyViolationError('Invalid generated object identifier.');
  }
  const prefix = buildMemberPhotoPrefix(params);
  return `${prefix}${objectId}.${params.extension}`;
}

/**
 * Verifies a stored key strictly belongs to the target environment, organisation,
 * and member namespace before any read or delete call hits object storage.
 */
export function assertKeyMatchesMemberScope(
  key: string,
  params: {
    envPrefix: StorageEnvPrefix;
    organisationId: string;
    memberId: string;
  }
): void {
  if (
    !key ||
    key.startsWith('/') ||
    key.includes('..') ||
    key.includes('\\') ||
    key.includes('%') ||
    key.includes('\0')
  ) {
    throw new StorageKeyViolationError('Unsafe object storage key rejected.');
  }
  const expectedPrefix = buildMemberPhotoPrefix(params);
  if (!key.startsWith(expectedPrefix)) {
    throw new StorageKeyViolationError(
      'Object storage key does not match the authorised environment or organisation scope.'
    );
  }
  const filenamePart = key.slice(expectedPrefix.length);
  if (!/^[a-zA-Z0-9_-]+\.(jpg|png|webp)$/.test(filenamePart)) {
    throw new StorageKeyViolationError('Object storage key leaf has an invalid format.');
  }
}

