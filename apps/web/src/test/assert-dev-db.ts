/**
 * Fails closed if PostgreSQL integration tests target a production database,
 * an unverified branch, a mismatched endpoint, or fallback configuration.
 */

export const APPROVED_DEV_BRANCH_NAME = 'development';
export const APPROVED_DEV_BRANCH_ID = 'br-nameless-silence-bexjp44k';
export const APPROVED_DEV_ENDPOINT = 'ep-muddy-math-ben8e8p7';

const KNOWN_PRODUCTION_BRANCH_NAMES = new Set(['production', 'prod', 'main']);
const KNOWN_PRODUCTION_BRANCH_IDS = new Set(['br-withered-moon-be8coj8h']);
const KNOWN_PRODUCTION_ENDPOINTS = ['ep-mute-forest-bepsjmsu'];

export interface VerifiedDevDatabaseTarget {
  dbHost: string;
  directHost: string;
  branchName: string;
  branchId: string;
}

function parseUrlHostname(rawUrl: string | undefined, varName: string): string {
  if (!rawUrl || !rawUrl.trim()) {
    throw new Error(
      `Refusing to run PostgreSQL integration tests: ${varName} is missing.`
    );
  }
  try {
    return new URL(rawUrl).hostname.toLowerCase();
  } catch {
    throw new Error(
      `Refusing to run PostgreSQL integration tests: invalid ${varName}.`
    );
  }
}

function assertNotProductionEndpoint(hostname: string, varName: string): void {
  for (const prodEndpoint of KNOWN_PRODUCTION_ENDPOINTS) {
    if (hostname.includes(prodEndpoint)) {
      throw new Error(
        `Refusing to run PostgreSQL integration tests: ${varName} targets production endpoint "${hostname}".`
      );
    }
  }
}

function assertApprovedDevEndpoint(
  hostname: string,
  varName: string,
  options: { allowPooler: boolean }
): void {
  assertNotProductionEndpoint(hostname, varName);

  if (!hostname.endsWith('.neon.tech')) {
    throw new Error(
      `Refusing to run PostgreSQL integration tests: ${varName} host "${hostname}" is not an approved Neon endpoint.`
    );
  }

  const directPrefix = `${APPROVED_DEV_ENDPOINT}.`;
  const poolerPrefix = `${APPROVED_DEV_ENDPOINT}-pooler.`;

  if (!options.allowPooler && hostname.startsWith(poolerPrefix)) {
    throw new Error(
      `Refusing to run PostgreSQL integration tests: ${varName} must use the direct unpooled endpoint, got "${hostname}".`
    );
  }

  const matchesApprovedEndpoint = options.allowPooler
    ? hostname.startsWith(poolerPrefix) || hostname.startsWith(directPrefix)
    : hostname.startsWith(directPrefix);

  if (!matchesApprovedEndpoint) {
    throw new Error(
      `Refusing to run PostgreSQL integration tests: ${varName} host "${hostname}" does not match approved development endpoint "${APPROVED_DEV_ENDPOINT}".`
    );
  }
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

  const dbHost = parseUrlHostname(env.DATABASE_URL, 'DATABASE_URL');
  assertApprovedDevEndpoint(dbHost, 'DATABASE_URL', { allowPooler: true });

  const directHost = parseUrlHostname(
    env.DATABASE_URL_UNPOOLED,
    'DATABASE_URL_UNPOOLED'
  );
  assertApprovedDevEndpoint(directHost, 'DATABASE_URL_UNPOOLED', {
    allowPooler: false,
  });

  return { dbHost, directHost, branchName, branchId };
}