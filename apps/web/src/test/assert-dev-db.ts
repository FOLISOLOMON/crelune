/**
 * Fails closed if PostgreSQL integration tests target a production database,
 * an unverified branch, a mismatched/lookalike hostname, a wrong database name,
 * or conflicting shell environment configuration.
 */

export const APPROVED_DEV_BRANCH_NAME = 'development';
export const APPROVED_DEV_BRANCH_ID = 'br-nameless-silence-bexjp44k';
export const APPROVED_DEV_POOLED_HOST =
  'ep-muddy-math-ben8e8p7-pooler.c-9.us-east-2.aws.neon.tech';
export const APPROVED_DEV_DIRECT_HOST =
  'ep-muddy-math-ben8e8p7.c-9.us-east-2.aws.neon.tech';
export const APPROVED_DEV_DATABASE = 'neondb';

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
] as const;

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
  varName: string,
  expectedHostname: string
): { hostname: string; database: string } {
  if (!rawUrl || !rawUrl.trim()) {
    throw new Error(
      `Refusing to run PostgreSQL integration tests: ${varName} is missing.`
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    throw new Error(
      `Refusing to run PostgreSQL integration tests: malformed ${varName}.`
    );
  }

  if (parsed.protocol !== 'postgresql:' && parsed.protocol !== 'postgres:') {
    throw new Error(
      `Refusing to run PostgreSQL integration tests: invalid protocol for ${varName}.`
    );
  }

  const hostname = parsed.hostname.toLowerCase();
  if (!hostname) {
    throw new Error(
      `Refusing to run PostgreSQL integration tests: missing hostname in ${varName}.`
    );
  }

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

  const database = parsed.pathname.replace(/^\//, '');
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