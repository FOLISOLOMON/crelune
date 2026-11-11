import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const APPROVED_DEV_BRANCH_NAME = 'development';
const APPROVED_DEV_BRANCH_ID = 'br-nameless-silence-bexjp44k';
const APPROVED_DEV_ENDPOINT = 'ep-muddy-math-ben8e8p7';
const PRODUCTION_BRANCH_IDS = new Set(['br-withered-moon-be8coj8h']);
const PRODUCTION_ENDPOINTS = ['ep-mute-forest-bepsjmsu'];

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const webDir = path.resolve(__dirname, '..');
const rootEnvPath = path.resolve(webDir, '../../.env.local');

if (!fs.existsSync(rootEnvPath)) {
  console.error(
    `[test:integration:db] Aborted: expected environment file not found at ${rootEnvPath}.`
  );
  process.exit(1);
}

const fileEnv = dotenv.parse(fs.readFileSync(rootEnvPath, 'utf8'));

// Reject silent mismatch if parent shell pre-populated any Neon/DB environment variables
for (const key of [
  'DATABASE_URL',
  'DATABASE_URL_UNPOOLED',
  'NEON_BRANCH',
  'NEON_BRANCH_ID',
]) {
  if (process.env[key] && process.env[key] !== fileEnv[key]) {
    console.error(
      `[test:integration:db] Aborted: pre-existing shell ${key} conflicts with .env.local.`
    );
    process.exit(1);
  }
}

const mergedEnv = { ...process.env, ...fileEnv };

if (mergedEnv.NODE_ENV === 'production') {
  console.error('[test:integration:db] Aborted: NODE_ENV=production is forbidden.');
  process.exit(1);
}
if (mergedEnv.NEON_BRANCH !== APPROVED_DEV_BRANCH_NAME) {
  console.error(
    `[test:integration:db] Aborted: expected NEON_BRANCH="${APPROVED_DEV_BRANCH_NAME}", got "${mergedEnv.NEON_BRANCH || ''}".`
  );
  process.exit(1);
}
if (PRODUCTION_BRANCH_IDS.has(mergedEnv.NEON_BRANCH_ID || '')) {
  console.error(
    '[test:integration:db] Aborted: production Neon branch ID detected.'
  );
  process.exit(1);
}
if (mergedEnv.NEON_BRANCH_ID !== APPROVED_DEV_BRANCH_ID) {
  console.error(
    `[test:integration:db] Aborted: expected NEON_BRANCH_ID="${APPROVED_DEV_BRANCH_ID}", got "${mergedEnv.NEON_BRANCH_ID || ''}".`
  );
  process.exit(1);
}

let dbHost;
let directHost;
try {
  dbHost = new URL(mergedEnv.DATABASE_URL || '').hostname.toLowerCase();
  directHost = new URL(mergedEnv.DATABASE_URL_UNPOOLED || '').hostname.toLowerCase();
} catch {
  console.error(
    '[test:integration:db] Aborted: invalid or missing DATABASE_URL / DATABASE_URL_UNPOOLED.'
  );
  process.exit(1);
}

for (const prodEndpoint of PRODUCTION_ENDPOINTS) {
  if (dbHost.includes(prodEndpoint) || directHost.includes(prodEndpoint)) {
    console.error(
      '[test:integration:db] Aborted: production Neon endpoint detected.'
    );
    process.exit(1);
  }
}

const validPooled =
  dbHost.endsWith('.neon.tech') &&
  (dbHost.startsWith(`${APPROVED_DEV_ENDPOINT}-pooler.`) ||
    dbHost.startsWith(`${APPROVED_DEV_ENDPOINT}.`));
const validDirect =
  directHost.endsWith('.neon.tech') &&
  !directHost.startsWith(`${APPROVED_DEV_ENDPOINT}-pooler.`) &&
  directHost.startsWith(`${APPROVED_DEV_ENDPOINT}.`);

if (!validPooled || !validDirect) {
  console.error(
    `[test:integration:db] Aborted: endpoints do not match approved development endpoint "${APPROVED_DEV_ENDPOINT}" (pooled="${dbHost}", direct="${directHost}").`
  );
  process.exit(1);
}

console.log(
  `[test:integration:db] Verified target branch="${mergedEnv.NEON_BRANCH}" (${mergedEnv.NEON_BRANCH_ID}) pooled="${dbHost}" direct="${directHost}"`
);

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
  console.error('[test:integration:db] No *.pg.integration.test.ts files found.');
  process.exit(1);
}

const vitestBin = path.resolve(webDir, '../../node_modules/vitest/vitest.mjs');
execFileSync(process.execPath, [vitestBin, 'run', ...integrationFiles], {
  cwd: webDir,
  env: mergedEnv,
  stdio: 'inherit',
});