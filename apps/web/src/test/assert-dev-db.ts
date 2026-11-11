/**
 * Fails closed if PostgreSQL integration tests target a production database,
 * an unverified branch, or fall back to unintended environment configuration.
 */

const KNOWN_PRODUCTION_BRANCH_NAMES = new Set(['production', 'prod', 'main']);
const KNOWN_PRODUCTION_BRANCH_IDS = new Set(['br-withered-moon-be8coj8h']);
const KNOWN_PRODUCTION_ENDPOINTS = ['ep-mute-forest-bepsjmsu'];

export function assertSafeDevDatabaseEnvironment(
  env: Record<string, string | undefined> = process.env
): { dbHost: string; branchName: string } {
  if (env.NODE_ENV === 'production') {
    throw new Error(
      'Refusing to run PostgreSQL integration tests when NODE_ENV=production.'
    );
  }

  const databaseUrl = env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error(
      'Refusing to run PostgreSQL integration tests: DATABASE_URL is missing.'
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

  if (branchName !== 'development') {
    throw new Error(
      `Refusing to run PostgreSQL integration tests: expected NEON_BRANCH="development", got "${branchName}".`
    );
  }

  if (branchId && KNOWN_PRODUCTION_BRANCH_IDS.has(branchId)) {
    throw new Error(
      `Refusing to run PostgreSQL integration tests against production branch ID "${branchId}".`
    );
  }

  let dbHost: string;
  try {
    dbHost = new URL(databaseUrl).hostname.toLowerCase();
  } catch {
    throw new Error('Refusing to run PostgreSQL integration tests: invalid DATABASE_URL.');
  }

  for (const prodEndpoint of KNOWN_PRODUCTION_ENDPOINTS) {
    if (dbHost.includes(prodEndpoint)) {
      throw new Error(
        `Refusing to run PostgreSQL integration tests: DATABASE_URL targets production endpoint "${dbHost}".`
      );
    }
  }

  if (env.DATABASE_URL_UNPOOLED) {
    let directHost: string;
    try {
      directHost = new URL(env.DATABASE_URL_UNPOOLED).hostname.toLowerCase();
    } catch {
      throw new Error(
        'Refusing to run PostgreSQL integration tests: invalid DATABASE_URL_UNPOOLED.'
      );
    }
    for (const prodEndpoint of KNOWN_PRODUCTION_ENDPOINTS) {
      if (directHost.includes(prodEndpoint)) {
        throw new Error(
          `Refusing to run PostgreSQL integration tests: DATABASE_URL_UNPOOLED targets production endpoint "${directHost}".`
        );
      }
    }
  }

  return { dbHost, branchName };
}
