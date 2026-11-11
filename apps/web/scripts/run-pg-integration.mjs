import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const APPROVED_DEV_BRANCH_NAME = 'development';
const APPROVED_DEV_BRANCH_ID = 'br-nameless-silence-bexjp44k';
const APPROVED_DEV_POOLED_HOST =
  'ep-muddy-math-ben8e8p7-pooler.c-9.us-east-2.aws.neon.tech';
const APPROVED_DEV_DIRECT_HOST =
  'ep-muddy-math-ben8e8p7.c-9.us-east-2.aws.neon.tech';
const APPROVED_DEV_DATABASE = 'neondb';

const PRODUCTION_BRANCH_NAMES = new Set(['production', 'prod', 'main']);
const PRODUCTION_BRANCH_IDS = new Set(['br-withered-moon-be8coj8h']);
const PRODUCTION_HOSTS = new Set([
  'ep-mute-forest-bepsjmsu-pooler.c-9.us-east-2.aws.neon.tech',
  'ep-mute-forest-bepsjmsu.c-9.us-east-2.aws.neon.tech',
]);
const PRODUCTION_ENDPOINT_ID = 'ep-mute-forest-bepsjmsu';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const webDir = path.resolve(__dirname, '..');
const rootEnvPath = path.resolve(webDir, '../../.env.local');

function fail(message) {
  console.error(`[test:integration:db] Aborted: ${message}`);
  process.exit(1);
}

if (!fs.existsSync(rootEnvPath)) {
  fail(`expected environment file not found at ${rootEnvPath}.`);
}

const fileEnv = dotenv.parse(fs.readFileSync(rootEnvPath, 'utf8'));

// Reject silent mismatch if parent shell pre-populated any Neon/DB environment variables
for (const key of [
  'DATABASE_URL',
  'DATABASE_URL_UNPOOLED',
  'NEON_BRANCH',
  'NEON_BRANCH_ID',
  'AWS_ENDPOINT_URL_S3',
  'AWS_REGION',
  'OBJECT_STORAGE_BUCKET',
  'OBJECT_STORAGE_ENV_PREFIX',
  'OBJECT_STORAGE_CREDENTIAL_BRANCH_ID',
]) {
  if (process.env[key] && process.env[key] !== fileEnv[key]) {
    fail(`pre-existing shell ${key} conflicts with .env.local.`);
  }
}

const mergedEnv = { ...process.env, ...fileEnv };

if (mergedEnv.NODE_ENV === 'production') {
  fail('NODE_ENV=production is forbidden.');
}

const branchName = (mergedEnv.NEON_BRANCH || '').trim();
const branchId = (mergedEnv.NEON_BRANCH_ID || '').trim();

if (!branchName) {
  fail('NEON_BRANCH is missing.');
}
if (PRODUCTION_BRANCH_NAMES.has(branchName.toLowerCase())) {
  fail(`protected branch "${branchName}" is forbidden.`);
}
if (branchName !== APPROVED_DEV_BRANCH_NAME) {
  fail(`expected NEON_BRANCH="${APPROVED_DEV_BRANCH_NAME}", got "${branchName}".`);
}
if (!branchId) {
  fail('NEON_BRANCH_ID is missing.');
}
if (PRODUCTION_BRANCH_IDS.has(branchId)) {
  fail(`production Neon branch ID "${branchId}" is forbidden.`);
}
if (branchId !== APPROVED_DEV_BRANCH_ID) {
  fail(`expected NEON_BRANCH_ID="${APPROVED_DEV_BRANCH_ID}", got "${branchId}".`);
}

const FORBIDDEN_URL_QUERY_PARAMS = new Set([
  'host',
  'hostaddr',
  'port',
  'dbname',
  'database',
  'user',
  'username',
  'password',
  'service',
  'passfile',
  'options',
  'replication',
  'target_session_attrs',
  'sslkey',
  'sslcert',
  'sslrootcert',
  'sslcrl',
  'sslcrldir',
  'sslpassword',
  'krbsrvname',
  'gsslib',
  'gssencmode',
]);

function validateUrlHost(rawUrl, varName, expectedHost) {
  if (!rawUrl || !rawUrl.trim()) {
    fail(`${varName} is missing.`);
  }
  const trimmed = rawUrl.trim();
  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch {
    fail(`malformed ${varName}.`);
  }
  if (parsed.protocol !== 'postgresql:' && parsed.protocol !== 'postgres:') {
    fail(`invalid protocol for ${varName}.`);
  }
  if (parsed.hash) {
    fail(`${varName} must not contain a URL fragment.`);
  }
  const afterScheme = trimmed.slice(trimmed.indexOf('://') + 3);
  const authorityEnd = Math.min(
    ...[afterScheme.indexOf('/'), afterScheme.indexOf('?'), afterScheme.indexOf('#')].map((i) =>
      i === -1 ? afterScheme.length : i
    )
  );
  const authority = afterScheme.slice(0, authorityEnd);
  const atIdx = authority.lastIndexOf('@');
  const hostPort = atIdx === -1 ? authority : authority.slice(atIdx + 1);
  const portColon = hostPort.indexOf(':');
  if (portColon !== -1 && hostPort.slice(portColon + 1) !== '5432') {
    fail(`${varName} specifies an unapproved explicit port.`);
  }
  if (parsed.port && parsed.port !== '5432') {
    fail(`${varName} specifies an unapproved explicit port.`);
  }
  const host = parsed.hostname.toLowerCase();
  if (!host || host.includes(',') || host.includes('%')) {
    fail(`missing or invalid hostname in ${varName}.`);
  }
  if (PRODUCTION_HOSTS.has(host) || host.includes(PRODUCTION_ENDPOINT_ID)) {
    fail(`${varName} targets production host "${host}".`);
  }
  if (host !== expectedHost) {
    fail(`${varName} host "${host}" does not match exact approved host "${expectedHost}".`);
  }
  const database = parsed.pathname.replace(/^\//, '');
  if (database !== APPROVED_DEV_DATABASE) {
    fail(`${varName} database "${database || '(empty)'}" must equal "${APPROVED_DEV_DATABASE}".`);
  }
  if (parsed.search) {
    if (parsed.search.includes(';')) {
      fail(`${varName} contains invalid query parameter delimiter syntax.`);
    }
    const seenKeys = new Set();
    for (const seg of parsed.search.slice(1).split('&')) {
      const eq = seg.indexOf('=');
      if (eq <= 0) fail(`${varName} contains a malformed query parameter.`);
      const rawKey = seg.slice(0, eq);
      if (rawKey.includes('%')) fail(`${varName} contains an obfuscated query parameter.`);
      const lowerKey = rawKey.toLowerCase();
      if (seenKeys.has(lowerKey)) {
        fail(`${varName} contains duplicate query parameter "${lowerKey}".`);
      }
      seenKeys.add(lowerKey);
      if (FORBIDDEN_URL_QUERY_PARAMS.has(lowerKey)) {
        fail(`${varName} contains disallowed query parameter "${lowerKey}".`);
      }
      const val = decodeURIComponent(seg.slice(eq + 1).replace(/\+/g, ' ')).trim().toLowerCase();
      if (lowerKey === 'sslmode' && !['require', 'verify-ca', 'verify-full'].includes(val)) {
        fail(`${varName} specifies an unapproved sslmode setting.`);
      }
      if (lowerKey === 'channel_binding' && !['require', 'prefer'].includes(val)) {
        fail(`${varName} specifies an unapproved channel_binding setting.`);
      }
    }
  }
  return host;
}

const dbHost = validateUrlHost(
  mergedEnv.DATABASE_URL,
  'DATABASE_URL',
  APPROVED_DEV_POOLED_HOST
);
const directHost = validateUrlHost(
  mergedEnv.DATABASE_URL_UNPOOLED,
  'DATABASE_URL_UNPOOLED',
  APPROVED_DEV_DIRECT_HOST
);

console.log(
  `[test:integration:db] Verified target branch="${branchName}" (${branchId}) db="${APPROVED_DEV_DATABASE}" pooled="${dbHost}" direct="${directHost}"`
);

const APPROVED_DEV_STORAGE_HOST =
  'br-nameless-silence-bexjp44k.storage.c-9.us-east-2.aws.neon.tech';
if (mergedEnv.AWS_ENDPOINT_URL_S3) {
  let s3Url;
  try {
    s3Url = new URL(mergedEnv.AWS_ENDPOINT_URL_S3.trim());
  } catch {
    fail('malformed AWS_ENDPOINT_URL_S3.');
  }
  const s3Host = s3Url.hostname.toLowerCase();
  if (s3Host.includes('br-withered-moon-be8coj8h') || s3Host !== APPROVED_DEV_STORAGE_HOST) {
    fail(`AWS_ENDPOINT_URL_S3 host "${s3Host}" does not match exact approved development storage host.`);
  }
}
if (
  mergedEnv.OBJECT_STORAGE_ENV_PREFIX &&
  mergedEnv.OBJECT_STORAGE_ENV_PREFIX.trim() !== 'development'
) {
  fail('OBJECT_STORAGE_ENV_PREFIX must equal "development" for integration tests.');
}
if (
  !mergedEnv.OBJECT_STORAGE_CREDENTIAL_BRANCH_ID ||
  mergedEnv.OBJECT_STORAGE_CREDENTIAL_BRANCH_ID.trim() !== APPROVED_DEV_BRANCH_ID
) {
  fail(
    `OBJECT_STORAGE_CREDENTIAL_BRANCH_ID must equal "${APPROVED_DEV_BRANCH_ID}" for integration tests.`
  );
}

function findPgIntegrationTests(dir) {
  const results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...findPgIntegrationTests(full));
    } else if (entry.isFile() && entry.name.endsWith('.pg.integration.test.ts')) {
      results.push(path.relative(webDir, full).replace(/\\/g, '/'));
    }
  }
  return results.sort();
}

const integrationFiles = findPgIntegrationTests(path.join(webDir, 'src'));
if (integrationFiles.length === 0) {
  fail('no *.pg.integration.test.ts files found.');
}

const vitestBin = path.resolve(webDir, '../../node_modules/vitest/vitest.mjs');
execFileSync(
  process.execPath,
  [
    vitestBin,
    'run',
    '--no-file-parallelism',
    '--testTimeout=90000',
    '--hookTimeout=45000',
    ...integrationFiles,
  ],
  {
    cwd: webDir,
    env: mergedEnv,
    stdio: 'inherit',
  }
);