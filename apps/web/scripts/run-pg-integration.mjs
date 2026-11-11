import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

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

// Reject silent mismatch if parent shell pre-populated a different DATABASE_URL or NEON_BRANCH
if (process.env.DATABASE_URL && process.env.DATABASE_URL !== fileEnv.DATABASE_URL) {
  console.error(
    '[test:integration:db] Aborted: pre-existing shell DATABASE_URL conflicts with .env.local.'
  );
  process.exit(1);
}
if (process.env.NEON_BRANCH && process.env.NEON_BRANCH !== fileEnv.NEON_BRANCH) {
  console.error(
    `[test:integration:db] Aborted: shell NEON_BRANCH="${process.env.NEON_BRANCH}" conflicts with .env.local.`
  );
  process.exit(1);
}

const mergedEnv = { ...process.env, ...fileEnv };

if (mergedEnv.NODE_ENV === 'production') {
  console.error('[test:integration:db] Aborted: NODE_ENV=production is forbidden.');
  process.exit(1);
}
if (mergedEnv.NEON_BRANCH !== 'development') {
  console.error(
    `[test:integration:db] Aborted: expected NEON_BRANCH="development", got "${mergedEnv.NEON_BRANCH || ''}".`
  );
  process.exit(1);
}
if (
  mergedEnv.NEON_BRANCH_ID === 'br-withered-moon-be8coj8h' ||
  (mergedEnv.DATABASE_URL || '').includes('ep-mute-forest-bepsjmsu')
) {
  console.error(
    '[test:integration:db] Aborted: production Neon branch or endpoint detected.'
  );
  process.exit(1);
}

const dbHost = new URL(mergedEnv.DATABASE_URL).hostname;
console.log(
  `[test:integration:db] Verified target branch="${mergedEnv.NEON_BRANCH}" (${mergedEnv.NEON_BRANCH_ID}) host="${dbHost}"`
);

const vitestBin = path.resolve(webDir, '../../node_modules/vitest/vitest.mjs');
execFileSync(
  process.execPath,
  [vitestBin, 'run', 'src/lib/auth/rate-limit.pg.integration.test.ts'],
  {
    cwd: webDir,
    env: mergedEnv,
    stdio: 'inherit',
  }
);
