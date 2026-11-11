import { describe, it, expect } from 'vitest';
import {
  APPROVED_DEV_BRANCH_ID,
  APPROVED_DEV_BRANCH_NAME,
  APPROVED_DEV_ENDPOINT,
  assertSafeDevDatabaseEnvironment,
} from './assert-dev-db';

describe('PostgreSQL Integration Database Safety Guard', () => {
  const validDevEnv = {
    NODE_ENV: 'test',
    NEON_BRANCH: APPROVED_DEV_BRANCH_NAME,
    NEON_BRANCH_ID: APPROVED_DEV_BRANCH_ID,
    DATABASE_URL: `postgresql://user:pass@${APPROVED_DEV_ENDPOINT}-pooler.c-9.us-east-2.aws.neon.tech/neondb?sslmode=require`,
    DATABASE_URL_UNPOOLED: `postgresql://user:pass@${APPROVED_DEV_ENDPOINT}.c-9.us-east-2.aws.neon.tech/neondb?sslmode=require`,
  };

  it('accepts exact approved development branch ID, name, pooled URL, and unpooled URL', () => {
    expect(assertSafeDevDatabaseEnvironment(validDevEnv)).toEqual({
      dbHost: `${APPROVED_DEV_ENDPOINT}-pooler.c-9.us-east-2.aws.neon.tech`,
      directHost: `${APPROVED_DEV_ENDPOINT}.c-9.us-east-2.aws.neon.tech`,
      branchName: APPROVED_DEV_BRANCH_NAME,
      branchId: APPROVED_DEV_BRANCH_ID,
    });
  });

  it('rejects production or unknown branch names', () => {
    expect(() =>
      assertSafeDevDatabaseEnvironment({ ...validDevEnv, NEON_BRANCH: 'production' })
    ).toThrow(/protected branch/i);

    expect(() =>
      assertSafeDevEnvironmentWithBranch(validDevEnv, 'main')
    ).toThrow(/protected branch/i);

    expect(() =>
      assertSafeDevEnvironmentWithBranch(validDevEnv, 'staging')
    ).toThrow(/expected NEON_BRANCH="development"/i);
  });

  it('rejects missing, production, or mismatched NEON_BRANCH_ID even when NEON_BRANCH=development', () => {
    expect(() =>
      assertSafeDevDatabaseEnvironment({ ...validDevEnv, NEON_BRANCH_ID: '' })
    ).toThrow(/NEON_BRANCH_ID is missing/i);

    expect(() =>
      assertSafeDevDatabaseEnvironment({
        ...validDevEnv,
        NEON_BRANCH_ID: 'br-withered-moon-be8coj8h',
      })
    ).toThrow(/production branch ID/i);

    expect(() =>
      assertSafeDevDatabaseEnvironment({
        ...validDevEnv,
        NEON_BRANCH_ID: 'br-unknown-branch-123456',
      })
    ).toThrow(/expected NEON_BRANCH_ID=/i);
  });

  it('rejects production endpoints in DATABASE_URL or DATABASE_URL_UNPOOLED', () => {
    expect(() =>
      assertSafeDevDatabaseEnvironment({
        ...validDevEnv,
        DATABASE_URL:
          'postgresql://user:pass@ep-mute-forest-bepsjmsu-pooler.c-9.us-east-2.aws.neon.tech/neondb',
      })
    ).toThrow(/production endpoint/i);

    expect(() =>
      assertSafeDevDatabaseEnvironment({
        ...validDevEnv,
        DATABASE_URL_UNPOOLED:
          'postgresql://user:pass@ep-mute-forest-bepsjmsu.c-9.us-east-2.aws.neon.tech/neondb',
      })
    ).toThrow(/production endpoint/i);
  });

  it('rejects mismatched endpoints, non-Neon hosts, and pooled hosts in DATABASE_URL_UNPOOLED', () => {
    expect(() =>
      assertSafeDevDatabaseEnvironment({
        ...validDevEnv,
        DATABASE_URL:
          'postgresql://user:pass@ep-other-endpoint-pooler.c-9.us-east-2.aws.neon.tech/neondb',
      })
    ).toThrow(/does not match approved development endpoint/i);

    expect(() =>
      assertSafeDevDatabaseEnvironment({
        ...validDevEnv,
        DATABASE_URL_UNPOOLED:
          'postgresql://user:pass@ep-other-endpoint.c-9.us-east-2.aws.neon.tech/neondb',
      })
    ).toThrow(/does not match approved development endpoint/i);

    expect(() =>
      assertSafeDevDatabaseEnvironment({
        ...validDevEnv,
        DATABASE_URL: `postgresql://user:pass@${APPROVED_DEV_ENDPOINT}.example.com/neondb`,
      })
    ).toThrow(/not an approved Neon endpoint/i);

    expect(() =>
      assertSafeDevDatabaseEnvironment({
        ...validDevEnv,
        DATABASE_URL_UNPOOLED: `postgresql://user:pass@${APPROVED_DEV_ENDPOINT}-pooler.c-9.us-east-2.aws.neon.tech/neondb`,
      })
    ).toThrow(/direct unpooled endpoint/i);
  });

  it('rejects missing NEON_BRANCH, missing DATABASE_URL, missing DATABASE_URL_UNPOOLED, or NODE_ENV=production', () => {
    expect(() =>
      assertSafeDevDatabaseEnvironment({ ...validDevEnv, NEON_BRANCH: '' })
    ).toThrow(/NEON_BRANCH is missing/i);
    expect(() =>
      assertSafeDevDatabaseEnvironment({ ...validDevEnv, DATABASE_URL: '' })
    ).toThrow(/DATABASE_URL is missing/i);
    expect(() =>
      assertSafeDevDatabaseEnvironment({
        ...validDevEnv,
        DATABASE_URL_UNPOOLED: '',
      })
    ).toThrow(/DATABASE_URL_UNPOOLED is missing/i);
    expect(() =>
      assertSafeDevDatabaseEnvironment({ ...validDevEnv, NODE_ENV: 'production' })
    ).toThrow(/NODE_ENV=production/i);
  });
});

function assertSafeDevEnvironmentWithBranch(
  base: Record<string, string>,
  branch: string
) {
  return assertSafeDevDatabaseEnvironment({ ...base, NEON_BRANCH: branch });
}