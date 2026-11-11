/**
 * Fails closed if PostgreSQL integration tests target a production database,
 * an unverified branch, a mismatched/lookalike hostname, a wrong database name,
 * or conflicting shell environment configuration.
 */

import { parseStrictPostgresUrl } from '../lib/database/postgres-url';

export const APPROVED_DEV_BRANCH_NAME = 'development';
export const APPROVED_DEV_BRANCH_ID = 'br-nameless-silence-bexjp44k';
export const APPROVED_DEV_POOLED_HOST =
  'ep-muddy-math-ben8e8p7-pooler.c-9.us-east-2.aws.neon.tech';
export const APPROVED_DEV_DIRECT_HOST =
  'ep-muddy-math-ben8e8p7.c-9.us-east-2.aws.neon.tech';
export const APPROVED_DEV_DATABASE = 'neondb';
export const APPROVED_DEV_STORAGE_HOST =
  'br-nameless-silence-bexjp44k.storage.c-9.us-east-2.aws.neon.tech';
export const APPROVED_DEV_STORAGE_REGION = 'us-east-2';
export const APPROVED_DEV_STORAGE_BUCKET = 'crelune-dev-member-photos';
export const APPROVED_DEV_STORAGE_ENV_PREFIX = 'development';

const KNOWN_PRODUCTION_BRANCH_NAMES = new Set(['production', 'prod', 'main']);
const KNOWN_PRODUCTION_BRANCH_IDS = new Set(['br-withered-moon-be8coj8h']);
const KNOWN_PRODUCTION_HOSTS = new Set([
  'ep-mute-forest-bepsjmsu-pooler.c-9.us-east-2.aws.neon.tech',
  'ep-mute-forest-bepsjmsu.c-9.us-east-2.aws.neon.tech',
]);
const KNOWN_PRODUCTION_ENDPOINT_ID = 'ep-mute-forest-bepsjmsu';
const PROTECTED_ENV_KEYS = [
  'DATABASE_URL',
  'DATABASE_URL_UNPOOLED',
  'NEON_BRANCH',
  'NEON_BRANCH_ID',
  'AWS_ENDPOINT_URL_S3',
  'AWS_REGION',
  'OBJECT_STORAGE_BUCKET',
  'OBJECT_STORAGE_ENV_PREFIX',
  'OBJECT_STORAGE_CREDENTIAL_BRANCH_ID',
] as const;

export interface VerifiedDevStorageTarget {
  endpointHost: string;
  region: string;
  bucket: string;
  envPrefix: string;
}

export interface VerifiedDevDatabaseTarget {
  dbHost: string;
  directHost: string;
  database: string;
  branchName: string;
  branchId: string;
}

/**
 * Ensures pre-existing shell environment variables do not conflict with `.env.local`.
 * Never includes variable values or credentials in thrown errors.
 */
export function assertNoShellEnvConflict(
  shellEnv: Record<string, string | undefined>,
  fileEnv: Record<string, string | undefined>
): void {
  for (const key of PROTECTED_ENV_KEYS) {
    const shellValue = shellEnv[key];
    if (shellValue && shellValue !== fileEnv[key]) {
      throw new Error(
        `Refusing to run PostgreSQL integration tests: pre-existing shell ${key} conflicts with .env.local.`
      );
    }
  }
}

function parseValidatedTargetUrl(
  rawUrl: string | undefined,
  varName: 'DATABASE_URL' | 'DATABASE_URL_UNPOOLED',
  expectedHostname: string
): { hostname: string; database: string } {
  const { hostname, database } = parseStrictPostgresUrl(
    rawUrl,
    varName,
    (message) =>
      new Error(`Refusing to run PostgreSQL integration tests: ${message}`)
  );

  if (
    KNOWN_PRODUCTION_HOSTS.has(hostname) ||
    hostname.includes(KNOWN_PRODUCTION_ENDPOINT_ID)
  ) {
    throw new Error(
      `Refusing to run PostgreSQL integration tests: ${varName} targets production host "${hostname}".`
    );
  }

  if (hostname !== expectedHostname) {
    throw new Error(
      `Refusing to run PostgreSQL integration tests: ${varName} host "${hostname}" does not match exact approved development host "${expectedHostname}".`
    );
  }

  if (database !== APPROVED_DEV_DATABASE) {
    throw new Error(
      `Refusing to run PostgreSQL integration tests: ${varName} database "${database || '(empty)'}" must equal "${APPROVED_DEV_DATABASE}".`
    );
  }

  return { hostname, database };
}

export function assertSafeDevDatabaseEnvironment(
  env: Record<string, string | undefined> = process.env
): VerifiedDevDatabaseTarget {
  if (env.NODE_ENV === 'production') {
    throw new Error(
      'Refusing to run PostgreSQL integration tests when NODE_ENV=production.'
    );
  }

  const branchName = (env.NEON_BRANCH || '').trim();
  const branchId = (env.NEON_BRANCH_ID || '').trim();

  if (!branchName) {
    throw new Error(
      'Refusing to run PostgreSQL integration tests: NEON_BRANCH is missing (cannot verify development target).'
    );
  }

  if (KNOWN_PRODUCTION_BRANCH_NAMES.has(branchName.toLowerCase())) {
    throw new Error(
      `Refusing to run PostgreSQL integration tests against protected branch "${branchName}".`
    );
  }

  if (branchName !== APPROVED_DEV_BRANCH_NAME) {
    throw new Error(
      `Refusing to run PostgreSQL integration tests: expected NEON_BRANCH="${APPROVED_DEV_BRANCH_NAME}", got "${branchName}".`
    );
  }

  if (!branchId) {
    throw new Error(
      'Refusing to run PostgreSQL integration tests: NEON_BRANCH_ID is missing (cannot verify exact development branch).'
    );
  }

  if (KNOWN_PRODUCTION_BRANCH_IDS.has(branchId)) {
    throw new Error(
      `Refusing to run PostgreSQL integration tests against production branch ID "${branchId}".`
    );
  }

  if (branchId !== APPROVED_DEV_BRANCH_ID) {
    throw new Error(
      `Refusing to run PostgreSQL integration tests: expected NEON_BRANCH_ID="${APPROVED_DEV_BRANCH_ID}", got "${branchId}".`
    );
  }

  const pooled = parseValidatedTargetUrl(
    env.DATABASE_URL,
    'DATABASE_URL',
    APPROVED_DEV_POOLED_HOST
  );
  const direct = parseValidatedTargetUrl(
    env.DATABASE_URL_UNPOOLED,
    'DATABASE_URL_UNPOOLED',
    APPROVED_DEV_DIRECT_HOST
  );

  return {
    dbHost: pooled.hostname,
    directHost: direct.hostname,
    database: pooled.database,
    branchName,
    branchId,
  };
}

/**
 * Fails closed if storage integration tests target a production Neon branch endpoint,
 * missing/wrong bucket, wrong environment prefix, or missing storage credentials.
 */
export function assertSafeDevStorageEnvironment(
  env: Record<string, string | undefined> = process.env
): VerifiedDevStorageTarget {
  assertSafeDevDatabaseEnvironment(env);

  const rawEndpoint = (env.AWS_ENDPOINT_URL_S3 || '').trim();
  if (!rawEndpoint) {
    throw new Error(
      'Refusing to run storage integration tests: AWS_ENDPOINT_URL_S3 is missing.'
    );
  }

  let parsedEndpoint: URL;
  try {
    parsedEndpoint = new URL(rawEndpoint);
  } catch {
    throw new Error(
      'Refusing to run storage integration tests: malformed AWS_ENDPOINT_URL_S3.'
    );
  }

  if (parsedEndpoint.protocol !== 'https:') {
    throw new Error(
      'Refusing to run storage integration tests: AWS_ENDPOINT_URL_S3 must use HTTPS.'
    );
  }

  const endpointHost = parsedEndpoint.hostname.toLowerCase();
  for (const prodBranchId of KNOWN_PRODUCTION_BRANCH_IDS) {
    if (endpointHost.includes(prodBranchId)) {
      throw new Error(
        `Refusing to run storage integration tests: AWS_ENDPOINT_URL_S3 targets production branch "${prodBranchId}".`
      );
    }
  }

  if (endpointHost !== APPROVED_DEV_STORAGE_HOST) {
    throw new Error(
      `Refusing to run storage integration tests: AWS_ENDPOINT_URL_S3 host "${endpointHost}" does not match exact approved development host "${APPROVED_DEV_STORAGE_HOST}".`
    );
  }

  const region = (env.AWS_REGION || '').trim();
  if (region !== APPROVED_DEV_STORAGE_REGION) {
    throw new Error(
      `Refusing to run storage integration tests: AWS_REGION must equal "${APPROVED_DEV_STORAGE_REGION}".`
    );
  }

  const bucket = (env.OBJECT_STORAGE_BUCKET || '').trim();
  if (bucket !== APPROVED_DEV_STORAGE_BUCKET) {
    throw new Error(
      `Refusing to run storage integration tests: OBJECT_STORAGE_BUCKET must equal "${APPROVED_DEV_STORAGE_BUCKET}".`
    );
  }

  const envPrefix = (env.OBJECT_STORAGE_ENV_PREFIX || '').trim();
  if (envPrefix !== APPROVED_DEV_STORAGE_ENV_PREFIX) {
    throw new Error(
      `Refusing to run storage integration tests: OBJECT_STORAGE_ENV_PREFIX must equal "${APPROVED_DEV_STORAGE_ENV_PREFIX}".`
    );
  }

  const credentialBranchId = (env.OBJECT_STORAGE_CREDENTIAL_BRANCH_ID || '').trim();
  if (credentialBranchId !== APPROVED_DEV_BRANCH_ID) {
    throw new Error(
      `Refusing to run storage integration tests: OBJECT_STORAGE_CREDENTIAL_BRANCH_ID must equal "${APPROVED_DEV_BRANCH_ID}".`
    );
  }

  if (!(env.AWS_ACCESS_KEY_ID || '').trim() || !(env.AWS_SECRET_ACCESS_KEY || '').trim()) {
    throw new Error(
      'Refusing to run storage integration tests: AWS_ACCESS_KEY_ID or AWS_SECRET_ACCESS_KEY is missing.'
    );
  }

  return {
    endpointHost,
    region,
    bucket,
    envPrefix,
  };
}