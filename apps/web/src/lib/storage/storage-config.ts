/**
 * CRELUNE — Private Object Storage Configuration & Key Isolation
 *
 * Server-only configuration loader and environment/organisation-scoped key builder.
 * Enforces exact runtime allowlists pairing object storage endpoints, buckets,
 * Neon branch metadata, pooled/direct PostgreSQL endpoints, and credential branch assertions.
 */

import crypto from 'node:crypto';

export type StorageEnvPrefix = 'development' | 'production';

export interface ObjectStorageConfig {
  endpoint: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  envPrefix: StorageEnvPrefix;
  branchId: string;
  branchName: string;
  credentialBranchId: string;
  pooledDbHost: string;
  directDbHost: string;
  databaseName: string;
}

export interface ApprovedStorageTarget {
  endpointHost: string;
  region: string;
  bucket: string;
  envPrefix: StorageEnvPrefix;
  branchId: string;
  branchName: string;
  pooledDbHost: string;
  directDbHost: string;
  databaseName: string;
}

const VALID_ID_REGEX = /^[a-zA-Z0-9_-]{1,64}$/;
const ALLOWED_ENV_PREFIXES = new Set<StorageEnvPrefix>(['development', 'production']);
const ALLOWED_EXTENSIONS = new Set(['jpg', 'png', 'webp']);

export const APPROVED_DEV_STORAGE_TARGET: ApprovedStorageTarget = {
  endpointHost: 'br-nameless-silence-bexjp44k.storage.c-9.us-east-2.aws.neon.tech',
  region: 'us-east-2',
  bucket: 'crelune-dev-member-photos',
  envPrefix: 'development',
  branchId: 'br-nameless-silence-bexjp44k',
  branchName: 'development',
  pooledDbHost: 'ep-muddy-math-ben8e8p7-pooler.c-9.us-east-2.aws.neon.tech',
  directDbHost: 'ep-muddy-math-ben8e8p7.c-9.us-east-2.aws.neon.tech',
  databaseName: 'neondb',
};

// Production object storage and production DB pairing have not yet been provisioned or approved.
// Keep null until an explicit production endpoint, bucket, region, branch ID,
// pooled DB host, direct DB host, and prefix are provisioned and approved.
export const APPROVED_PROD_STORAGE_TARGET: ApprovedStorageTarget | null = null;

const KNOWN_PROD_BRANCH_ID = 'br-withered-moon-be8coj8h';
const KNOWN_PROD_BRANCH_NAMES = new Set(['production', 'prod', 'main']);
const KNOWN_PROD_DB_HOSTS = new Set([
  'ep-mute-forest-bepsjmsu-pooler.c-9.us-east-2.aws.neon.tech',
  'ep-mute-forest-bepsjmsu.c-9.us-east-2.aws.neon.tech',
]);
const KNOWN_PROD_DB_ENDPOINT_ID = 'ep-mute-forest-bepsjmsu';

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

function isPlaceholderValue(value: string): boolean {
  const lower = value.toLowerCase();
  return (
    lower.startsWith('replace-with-') ||
    lower.includes('br-example-id') ||
    lower === 'example'
  );
}

function validateStrictHttpsEndpoint(endpointRaw: string): URL {
  let parsedEndpoint: URL;
  try {
    parsedEndpoint = new URL(endpointRaw);
  } catch {
    throw new StorageConfigError('AWS_ENDPOINT_URL_S3 is not a valid URL.');
  }

  if (parsedEndpoint.protocol !== 'https:') {
    throw new StorageConfigError('AWS_ENDPOINT_URL_S3 must use HTTPS.');
  }

  if (parsedEndpoint.username || parsedEndpoint.password) {
    throw new StorageConfigError('AWS_ENDPOINT_URL_S3 must not embed credentials.');
  }

  if (
    parsedEndpoint.port ||
    (parsedEndpoint.pathname !== '/' && parsedEndpoint.pathname !== '') ||
    parsedEndpoint.search ||
    parsedEndpoint.hash
  ) {
    throw new StorageConfigError(
      'AWS_ENDPOINT_URL_S3 must be a clean origin URL without custom ports, paths, or query parameters.'
    );
  }

  return parsedEndpoint;
}

/**
 * Parses a PostgreSQL connection URL cleanly with `new URL` without exposing
 * credentials, query secrets, or raw connection strings in thrown errors.
 */
function parsePostgresUrl(
  rawUrl: string | undefined,
  varName: 'DATABASE_URL' | 'DATABASE_URL_UNPOOLED'
): { hostname: string; database: string } {
  const trimmed = (rawUrl || '').trim();
  if (!trimmed) {
    throw new StorageConfigError(
      `${varName} is required to verify runtime database and storage pairing.`
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new StorageConfigError(`${varName} is malformed.`);
  }

  if (parsed.protocol !== 'postgresql:' && parsed.protocol !== 'postgres:') {
    throw new StorageConfigError(`${varName} must use a valid PostgreSQL protocol.`);
  }

  const hostname = parsed.hostname.toLowerCase();
  if (!hostname) {
    throw new StorageConfigError(`${varName} is missing a database hostname.`);
  }

  const database = parsed.pathname.replace(/^\//, '');
  if (!database || database.includes('/')) {
    throw new StorageConfigError(`${varName} is missing a valid database name.`);
  }

  return { hostname, database };
}

function assertTargetEquality(
  actual: {
    endpointHost: string;
    region: string;
    bucket: string;
    envPrefix: StorageEnvPrefix;
    branchId: string;
    branchName: string;
    credentialBranchId: string;
    pooledDbHost: string;
    pooledDbName: string;
    directDbHost: string;
    directDbName: string;
  },
  approved: ApprovedStorageTarget
): void {
  if (actual.branchName !== approved.branchName) {
    throw new StorageConfigError(
      `NEON_BRANCH "${actual.branchName}" does not match exact approved branch "${approved.branchName}".`
    );
  }
  if (actual.branchId !== approved.branchId) {
    throw new StorageConfigError(
      `NEON_BRANCH_ID "${actual.branchId}" does not match exact approved branch ID for ${approved.envPrefix}.`
    );
  }
  if (actual.credentialBranchId !== approved.branchId) {
    throw new StorageConfigError(
      `OBJECT_STORAGE_CREDENTIAL_BRANCH_ID "${actual.credentialBranchId}" does not match exact approved branch ID for ${approved.envPrefix}.`
    );
  }
  if (actual.endpointHost !== approved.endpointHost) {
    throw new StorageConfigError(
      `AWS_ENDPOINT_URL_S3 host "${actual.endpointHost}" does not match exact approved ${approved.envPrefix} storage host "${approved.endpointHost}".`
    );
  }
  if (actual.region !== approved.region) {
    throw new StorageConfigError(
      `AWS_REGION "${actual.region}" does not match exact approved ${approved.envPrefix} region "${approved.region}".`
    );
  }
  if (actual.bucket !== approved.bucket) {
    throw new StorageConfigError(
      `OBJECT_STORAGE_BUCKET "${actual.bucket}" does not match exact approved ${approved.envPrefix} bucket "${approved.bucket}".`
    );
  }
  if (actual.pooledDbHost !== approved.pooledDbHost) {
    throw new StorageConfigError(
      `DATABASE_URL host "${actual.pooledDbHost}" does not match exact approved ${approved.envPrefix} pooled host "${approved.pooledDbHost}".`
    );
  }
  if (actual.pooledDbName !== approved.databaseName) {
    throw new StorageConfigError(
      `DATABASE_URL database "${actual.pooledDbName}" does not match exact approved ${approved.envPrefix} database "${approved.databaseName}".`
    );
  }
  if (actual.directDbHost !== approved.directDbHost) {
    throw new StorageConfigError(
      `DATABASE_URL_UNPOOLED host "${actual.directDbHost}" does not match exact approved ${approved.envPrefix} direct host "${approved.directDbHost}".`
    );
  }
  if (actual.directDbName !== approved.databaseName) {
    throw new StorageConfigError(
      `DATABASE_URL_UNPOOLED database "${actual.directDbName}" does not match exact approved ${approved.envPrefix} database "${approved.databaseName}".`
    );
  }
}

/**
 * Loads and validates Neon Object Storage credentials against an exact runtime
 * allowlist pairing storage endpoints, buckets, credential branch assertions,
 * and pooled/direct PostgreSQL URLs (failing closed for unapproved production).
 * Never embeds database usernames, passwords, full URLs, or storage secrets in errors.
 */
export function getObjectStorageConfig(
  env: Record<string, string | undefined> = process.env
): ObjectStorageConfig {
  const endpointRaw = (env.AWS_ENDPOINT_URL_S3 || '').trim();
  const region = (env.AWS_REGION || '').trim();
  const accessKeyId = (env.AWS_ACCESS_KEY_ID || '').trim();
  const secretAccessKey = (env.AWS_SECRET_ACCESS_KEY || '').trim();
  const bucket = (env.OBJECT_STORAGE_BUCKET || '').trim();
  const envPrefixRaw = (env.OBJECT_STORAGE_ENV_PREFIX || '').trim();
  const neonBranch = (env.NEON_BRANCH || '').trim();
  const neonBranchId = (env.NEON_BRANCH_ID || '').trim();
  const credentialBranchId = (env.OBJECT_STORAGE_CREDENTIAL_BRANCH_ID || '').trim();

  if (
    !endpointRaw ||
    !region ||
    !accessKeyId ||
    !secretAccessKey ||
    !bucket ||
    !envPrefixRaw
  ) {
    throw new StorageConfigError(
      'Object storage configuration is incomplete. Verify server environment variables.'
    );
  }

  if (isPlaceholderValue(accessKeyId) || isPlaceholderValue(secretAccessKey)) {
    throw new StorageConfigError(
      'Object storage credentials use placeholder values and cannot be used.'
    );
  }

  if (!ALLOWED_ENV_PREFIXES.has(envPrefixRaw as StorageEnvPrefix)) {
    throw new StorageConfigError(
      'OBJECT_STORAGE_ENV_PREFIX must be an approved environment prefix (development or production).'
    );
  }
  const envPrefix = envPrefixRaw as StorageEnvPrefix;

  if (!neonBranchId) {
    throw new StorageConfigError(
      'NEON_BRANCH_ID is required to verify object storage branch isolation.'
    );
  }

  if (!neonBranch) {
    throw new StorageConfigError(
      'NEON_BRANCH is required to verify object storage branch isolation.'
    );
  }

  if (!credentialBranchId || isPlaceholderValue(credentialBranchId)) {
    throw new StorageConfigError(
      'OBJECT_STORAGE_CREDENTIAL_BRANCH_ID is required to assert storage credential branch association.'
    );
  }

  const parsedEndpoint = validateStrictHttpsEndpoint(endpointRaw);
  const endpointHost = parsedEndpoint.hostname.toLowerCase();

  if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket)) {
    throw new StorageConfigError('OBJECT_STORAGE_BUCKET has an invalid S3 bucket name.');
  }

  const pooledDb = parsePostgresUrl(env.DATABASE_URL, 'DATABASE_URL');
  const directDb = parsePostgresUrl(env.DATABASE_URL_UNPOOLED, 'DATABASE_URL_UNPOOLED');

  if (envPrefix === 'development') {
    if (
      KNOWN_PROD_BRANCH_NAMES.has(neonBranch.toLowerCase()) ||
      neonBranchId === KNOWN_PROD_BRANCH_ID ||
      credentialBranchId === KNOWN_PROD_BRANCH_ID ||
      endpointHost.includes(KNOWN_PROD_BRANCH_ID) ||
      bucket.toLowerCase().includes('prod') ||
      accessKeyId.includes(KNOWN_PROD_BRANCH_ID) ||
      secretAccessKey.includes(KNOWN_PROD_BRANCH_ID) ||
      KNOWN_PROD_DB_HOSTS.has(pooledDb.hostname) ||
      KNOWN_PROD_DB_HOSTS.has(directDb.hostname) ||
      pooledDb.hostname.startsWith(`${KNOWN_PROD_DB_ENDPOINT_ID}-`) ||
      directDb.hostname.startsWith(`${KNOWN_PROD_DB_ENDPOINT_ID}.`)
    ) {
      throw new StorageConfigError(
        'Refusing development storage prefix paired with production branch, endpoint, database, or credentials.'
      );
    }

    assertTargetEquality(
      {
        endpointHost,
        region,
        bucket,
        envPrefix,
        branchId: neonBranchId,
        branchName: neonBranch,
        credentialBranchId,
        pooledDbHost: pooledDb.hostname,
        pooledDbName: pooledDb.database,
        directDbHost: directDb.hostname,
        directDbName: directDb.database,
      },
      APPROVED_DEV_STORAGE_TARGET
    );
  } else {
    // Reject obvious development contamination under production prefix first
    if (
      neonBranch.toLowerCase() === APPROVED_DEV_STORAGE_TARGET.branchName ||
      neonBranchId === APPROVED_DEV_STORAGE_TARGET.branchId ||
      credentialBranchId === APPROVED_DEV_STORAGE_TARGET.branchId ||
      endpointHost === APPROVED_DEV_STORAGE_TARGET.endpointHost ||
      endpointHost.includes(APPROVED_DEV_STORAGE_TARGET.branchId) ||
      bucket === APPROVED_DEV_STORAGE_TARGET.bucket ||
      pooledDb.hostname === APPROVED_DEV_STORAGE_TARGET.pooledDbHost ||
      directDb.hostname === APPROVED_DEV_STORAGE_TARGET.directDbHost ||
      accessKeyId.includes(APPROVED_DEV_STORAGE_TARGET.branchId) ||
      secretAccessKey.includes(APPROVED_DEV_STORAGE_TARGET.branchId)
    ) {
      throw new StorageConfigError(
        'Refusing production storage prefix paired with development branch, endpoint, database, bucket, or credentials.'
      );
    }

    if (!APPROVED_PROD_STORAGE_TARGET) {
      throw new StorageConfigError(
        'Production object storage target is not approved or configured. Failing closed.'
      );
    }

    assertTargetEquality(
      {
        endpointHost,
        region,
        bucket,
        envPrefix,
        branchId: neonBranchId,
        branchName: neonBranch,
        credentialBranchId,
        pooledDbHost: pooledDb.hostname,
        pooledDbName: pooledDb.database,
        directDbHost: directDb.hostname,
        directDbName: directDb.database,
      },
      APPROVED_PROD_STORAGE_TARGET
    );
  }

  return {
    endpoint: parsedEndpoint.origin,
    region,
    accessKeyId,
    secretAccessKey,
    bucket,
    envPrefix,
    branchId: neonBranchId,
    branchName: neonBranch,
    credentialBranchId,
    pooledDbHost: pooledDb.hostname,
    directDbHost: directDb.hostname,
    databaseName: pooledDb.database,
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
