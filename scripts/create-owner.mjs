/**
 * CRELUNE — Owner Account Provisioning CLI Script
 *
 * Secure CLI tool to provision the single owner account into the database.
 * Strictly local execution only — no public HTTP registration endpoint exists.
 *
 * Usage:
 *   node scripts/create-owner.mjs --email=owner@example.com --password=SecurePassword123! --name="First Last"
 *   OR interactive prompt if arguments are omitted.
 */

import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';
import crypto from 'node:crypto';
import readline from 'node:readline';

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

async function prompt(question, isPassword = false) {
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
    // Check if an owner already exists
    const existingOwner = await prisma.user.findFirst({
      where: { role: 'OWNER' },
    });

    if (existingOwner) {
      console.log(`An owner account already exists (${existingOwner.email}).`);
      console.log('CRELUNE initial release enforces a single owner.');
      console.log('To reset or update password, use an authorized administrative procedure.');
      process.exit(0);
    }

    const args = parseArgs();
    let email = args.email;
    let password = args.password;
    let name = args.name;

    if (!email) {
      email = await prompt('Enter owner email address: ');
    }
    if (!email || !email.includes('@')) {
      console.error('Invalid email address provided.');
      process.exit(1);
    }

    if (!password) {
      password = await prompt('Enter owner master password (min 8 chars): ');
    }
    if (!password || password.length < 8) {
      console.error('Password must be at least 8 characters long.');
      process.exit(1);
    }

    if (!name) {
      name = await prompt('Enter owner full name (e.g. Solomon Foli): ');
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
            timezone: 'UTC',
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
    console.log('\nYou may now log in to CRELUNE Web using these credentials.\n');
  } catch (err) {
    console.error('Error provisioning owner account:', err.message);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
