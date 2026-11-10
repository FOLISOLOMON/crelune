/**
 * CRELUNE — Owner Account Provisioning CLI Script
 *
 * Secure CLI tool to provision the single owner account into the database.
 * Strictly local execution only — no public HTTP registration endpoint exists.
 *
 * Security Enhancements (Milestone 2.1):
 * - Passwords passed via CLI arguments (--password) are prohibited to prevent leakage in shell history/ps.
 * - Interactive password input is masked with '*' on TTY consoles.
 * - Password strength validation rejects trivial/common passwords.
 * - Default timezone set to Africa/Accra.
 * - Guaranteed database connection teardown on all exit paths.
 */

import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';
import crypto from 'node:crypto';
import readline from 'node:readline';
import { validatePasswordStrength } from '@crelune/shared';

dotenv.config({ path: '.env.local' });

if (!process.env.DATABASE_URL) {
  console.error('Error: DATABASE_URL is not set in .env.local');
  process.exit(1);
}

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: process.env.DATABASE_URL,
    },
  },
});

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

async function promptText(question) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function promptPasswordMasked(promptLabel) {
  return new Promise((resolve, reject) => {
    process.stdout.write(promptLabel);

    if (!process.stdin.isTTY) {
      // Non-interactive fallback (e.g. automated test pipe)
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        terminal: false,
      });
      rl.question('', (answer) => {
        rl.close();
        resolve(answer.trim());
      });
      return;
    }

    let password = '';
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding('utf8');

    const onData = (char) => {
      if (char === '\n' || char === '\r' || char === '\u0004') {
        process.stdin.setRawMode(false);
        process.stdin.pause();
        process.stdin.removeListener('data', onData);
        process.stdout.write('\n');
        resolve(password);
      } else if (char === '\u0003') {
        // Ctrl+C
        process.stdin.setRawMode(false);
        process.stdin.pause();
        process.stdin.removeListener('data', onData);
        process.stdout.write('\n');
        reject(new Error('Provisioning cancelled by user'));
      } else if (char === '\u0008' || char === '\x7f') {
        // Backspace
        if (password.length > 0) {
          password = password.slice(0, -1);
          process.stdout.write('\b \b');
        }
      } else {
        password += char;
        process.stdout.write('*');
      }
    };

    process.stdin.on('data', onData);
  });
}

function parseArgs() {
  const args = {};
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith('--')) {
      const [key, ...vals] = arg.slice(2).split('=');
      args[key] = vals.join('=');
    }
  }
  return args;
}

async function main() {
  console.log('====================================================');
  console.log('   CRELUNE — Owner Account Provisioning Tool        ');
  console.log('   (Single-Owner Security Protocol)                 ');
  console.log('====================================================\n');

  try {
    const args = parseArgs();

    // Prohibit CLI password arguments for process table and shell history protection
    if (args.password) {
      console.error('[SECURITY ERROR] Supplying passwords via CLI arguments (--password) is prohibited.');
      console.error('Command-line arguments leak into process tables (ps/wmic) and shell history files.');
      console.error('Please run the script without --password to enter credentials via masked interactive prompt.\n');
      process.exitCode = 1;
      return;
    }

    // Check if an owner already exists
    const existingOwner = await prisma.user.findFirst({
      where: { role: 'OWNER' },
    });

    if (existingOwner) {
      console.log(`An owner account already exists (${existingOwner.email}).`);
      console.log('CRELUNE initial release enforces a single owner.');
      console.log('To reset or update password, use an authorized administrative procedure.');
      return;
    }

    let email = args.email;
    let name = args.name;

    if (!email) {
      email = await promptText('Enter owner email address: ');
    }
    if (!email || !email.includes('@')) {
      console.error('Invalid email address provided.');
      process.exitCode = 1;
      return;
    }

    const password = await promptPasswordMasked('Enter owner master password (masked): ');
    const pwdError = validatePasswordStrength(password);
    if (pwdError) {
      console.error(`[ERROR] ${pwdError}`);
      process.exitCode = 1;
      return;
    }

    const confirmPassword = await promptPasswordMasked('Confirm owner master password (masked): ');
    if (password !== confirmPassword) {
      console.error('[ERROR] Passwords do not match.');
      process.exitCode = 1;
      return;
    }

    if (!name) {
      name = await promptText('Enter owner full name (e.g. Solomon Foli): ');
    }
    name = name || 'CRELUNE Owner';
    const nameParts = name.split(' ');
    const firstName = nameParts[0] || 'Owner';
    const lastName = nameParts.slice(1).join(' ') || 'Admin';

    // Ensure Default Organisation exists
    let organisation = await prisma.organisation.findFirst({
      where: { slug: 'crelune-ops' },
    });

    if (!organisation) {
      organisation = await prisma.organisation.create({
        data: {
          name: 'CRELUNE Operations',
          slug: 'crelune-ops',
        },
      });
      console.log(`Created default organisation: ${organisation.name} (${organisation.id})`);
    }

    const passwordHash = hashPassword(password);

    const user = await prisma.user.create({
      data: {
        organisationId: organisation.id,
        email: email.toLowerCase().trim(),
        passwordHash,
        firstName,
        lastName,
        role: 'OWNER',
        isActive: true,
        preferences: {
          create: {
            theme: 'light',
            dateFormat: 'DD/MM/YYYY',
            timezone: 'Africa/Accra',
            leadTimeDaysBirthday: 14,
            leadTimeDaysEvent: 21,
            defaultExportFormat: 'PNG',
          },
        },
      },
      include: {
        preferences: true,
      },
    });

    console.log('\n✔ Owner account created successfully!');
    console.log(`  User ID      : ${user.id}`);
    console.log(`  Email        : ${user.email}`);
    console.log(`  Name         : ${user.firstName} ${user.lastName}`);
    console.log(`  Role         : ${user.role}`);
    console.log(`  Organisation : ${organisation.name}`);
    console.log(`  Timezone     : ${user.preferences?.timezone}`);
    console.log('\nYou may now log in to CRELUNE Web using these credentials.\n');
  } catch (err) {
    console.error('Error provisioning owner account:', err instanceof Error ? err.message : err);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

if (process.env.NODE_ENV !== 'test' && !process.env.VITEST) {
  main();
}
