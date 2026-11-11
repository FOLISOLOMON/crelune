import { describe, it, expect } from 'vitest';
import {
  APPROVED_DEV_BRANCH_ID,
  APPROVED_DEV_BRANCH_NAME,
  APPROVED_DEV_DATABASE,
  APPROVED_DEV_DIRECT_HOST,
  APPROVED_DEV_POOLED_HOST,
  APPROVED_DEV_STORAGE_BUCKET,
  APPROVED_DEV_STORAGE_ENV_PREFIX,
  APPROVED_DEV_STORAGE_HOST,
  APPROVED_DEV_STORAGE_REGION,
  assertNoShellEnvConflict,
  assertSafeDevDatabaseEnvironment,
  assertSafeDevStorageEnvironment,
} from './assert-dev-db';

describe('PostgreSQL Integration Database Safety Guard', () => {
  const validDevEnv = {
    NODE_ENV: 'test',
    NEON_BRANCH: APPROVED_DEV_BRANCH_NAME,
    NEON_BRANCH_ID: APPROVED_DEV_BRANCH_ID,
    DATABASE_URL: `postgresql://user:super_secret_pw@${APPROVED_DEV_POOLED_HOST}/${APPROVED_DEV_DATABASE}?sslmode=require`,
    DATABASE_URL_UNPOOLED: `postgresql://user:super_secret_pw@${APPROVED_DEV_DIRECT_HOST}/${APPROVED_DEV_DATABASE}?sslmode=require`,
  };

  it('accepts the exact approved development pooled and direct hostnames, branch ID, and database', () => {
    expect(assertSafeDevDatabaseEnvironment(validDevEnv)).toEqual({
      dbHost: APPROVED_DEV_POOLED_HOST,
      directHost: APPROVED_DEV_DIRECT_HOST,
      database: APPROVED_DEV_DATABASE,
      branchName: APPROVED_DEV_BRANCH_NAME,
      branchId: APPROVED_DEV_BRANCH_ID,
    });
  });

  it('rejects hostnames with an extra prefix (lookalike protection)', () => {
    expect(() =>
      assertSafeDevDatabaseEnvironment({
        ...validDevEnv,
        DATABASE_URL: `postgresql://user:pass@evil-${APPROVED_DEV_POOLED_HOST}/${APPROVED_DEV_DATABASE}`,
      })
    ).toThrow(/exact approved development host/i);

    expect(() =>
      assertSafeDevDatabaseEnvironment({
        ...validDevEnv,
        DATABASE_URL_UNPOOLED: `postgresql://user:pass@sub.${APPROVED_DEV_DIRECT_HOST}/${APPROVED_DEV_DATABASE}`,
      })
    ).toThrow(/exact approved development host/i);
  });

  it('rejects hostnames with an extra suffix (lookalike protection)', () => {
    expect(() =>
      assertSafeDevDatabaseEnvironment({
        ...validDevEnv,
        DATABASE_URL: `postgresql://user:pass@${APPROVED_DEV_POOLED_HOST}.attacker.com/${APPROVED_DEV_DATABASE}`,
      })
    ).toThrow(/exact approved development host/i);

    expect(() =>
      assertSafeDevDatabaseEnvironment({
        ...validDevEnv,
        DATABASE_URL_UNPOOLED: `postgresql://user:pass@ep-muddy-math-ben8e8p7-extra.c-9.us-east-2.aws.neon.tech/${APPROVED_DEV_DATABASE}`,
      })
    ).toThrow(/exact approved development host/i);
  });

  it('rejects wrong Neon region', () => {
    expect(() =>
      assertSafeDevDatabaseEnvironment({
        ...validDevEnv,
        DATABASE_URL:
          'postgresql://user:pass@ep-muddy-math-ben8e8p7-pooler.c-9.eu-central-1.aws.neon.tech/neondb',
      })
    ).toThrow(/exact approved development host/i);

    expect(() =>
      assertSafeDevDatabaseEnvironment({
        ...validDevEnv,
        DATABASE_URL_UNPOOLED:
          'postgresql://user:pass@ep-muddy-math-ben8e8p7.c-9.us-west-2.aws.neon.tech/neondb',
      })
    ).toThrow(/exact approved development host/i);
  });

  it('rejects production endpoints in DATABASE_URL or DATABASE_URL_UNPOOLED', () => {
    expect(() =>
      assertSafeDevDatabaseEnvironment({
        ...validDevEnv,
        DATABASE_URL:
          'postgresql://user:pass@ep-mute-forest-bepsjmsu-pooler.c-9.us-east-2.aws.neon.tech/neondb',
      })
    ).toThrow(/production host/i);

    expect(() =>
      assertSafeDevDatabaseEnvironment({
        ...validDevEnv,
        DATABASE_URL_UNPOOLED:
          'postgresql://user:pass@ep-mute-forest-bepsjmsu.c-9.us-east-2.aws.neon.tech/neondb',
      })
    ).toThrow(/production host/i);
  });

  it('rejects unknown endpoints and swapped pooled/direct URLs', () => {
    expect(() =>
      assertSafeDevDatabaseEnvironment({
        ...validDevEnv,
        DATABASE_URL:
          'postgresql://user:pass@ep-unknown-00000000-pooler.c-9.us-east-2.aws.neon.tech/neondb',
      })
    ).toThrow(/exact approved development host/i);

    expect(() =>
      assertSafeDevDatabaseEnvironment({
        ...validDevEnv,
        DATABASE_URL: validDevEnv.DATABASE_URL_UNPOOLED,
      })
    ).toThrow(/exact approved development host/i);

    expect(() =>
      assertSafeDevDatabaseEnvironment({
        ...validDevEnv,
        DATABASE_URL_UNPOOLED: validDevEnv.DATABASE_URL,
      })
    ).toThrow(/exact approved development host/i);
  });

  it('rejects wrong branch ID, production branch ID, missing branch ID, and protected branch names', () => {
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
        NEON_BRANCH_ID: 'br-wrong-branch-123456',
      })
    ).toThrow(/expected NEON_BRANCH_ID=/i);

    expect(() =>
      assertSafeDevDatabaseEnvironment({ ...validDevEnv, NEON_BRANCH: 'production' })
    ).toThrow(/protected branch/i);

    expect(() =>
      assertSafeDevDatabaseEnvironment({ ...validDevEnv, NEON_BRANCH: 'staging' })
    ).toThrow(/expected NEON_BRANCH="development"/i);
  });

  it('rejects malformed URLs, non-postgres protocols, wrong database names, and never leaks credentials', () => {
    for (const badUrl of [
      '',
      'not-a-valid-url',
      `http://user:super_secret_pw@${APPROVED_DEV_POOLED_HOST}/neondb`,
    ]) {
      let thrownMessage = '';
      try {
        assertSafeDevDatabaseEnvironment({
          ...validDevEnv,
          DATABASE_URL: badUrl,
        });
      } catch (err) {
        thrownMessage = err instanceof Error ? err.message : String(err);
      }
      expect(thrownMessage).toBeTruthy();
      expect(thrownMessage).not.toContain('super_secret_pw');
    }

    expect(() =>
      assertSafeDevDatabaseEnvironment({
        ...validDevEnv,
        DATABASE_URL: `postgresql://user:pass@${APPROVED_DEV_POOLED_HOST}/otherdb`,
      })
    ).toThrow(/must equal "neondb"/i);

    expect(() =>
      assertSafeDevDatabaseEnvironment({ ...validDevEnv, NODE_ENV: 'production' })
    ).toThrow(/NODE_ENV=production/i);
  });

  it('rejects shell environment conflicts with .env.local without leaking secret values', () => {
    expect(() =>
      assertNoShellEnvConflict({ NEON_BRANCH: 'production' }, validDevEnv)
    ).toThrow(/shell NEON_BRANCH conflicts with \.env\.local/i);

    let thrownMessage = '';
    try {
      assertNoShellEnvConflict(
        {
          DATABASE_URL:
            'postgresql://attacker:leaked_secret@ep-mute-forest-bepsjmsu-pooler.c-9.us-east-2.aws.neon.tech/neondb',
        },
        validDevEnv
      );
    } catch (err) {
      thrownMessage = err instanceof Error ? err.message : String(err);
    }
    expect(thrownMessage).toMatch(/shell DATABASE_URL conflicts with \.env\.local/i);
    expect(thrownMessage).not.toContain('leaked_secret');

    expect(() =>
      assertNoShellEnvConflict(
        {
          DATABASE_URL: validDevEnv.DATABASE_URL,
          DATABASE_URL_UNPOOLED: validDevEnv.DATABASE_URL_UNPOOLED,
          NEON_BRANCH: validDevEnv.NEON_BRANCH,
          NEON_BRANCH_ID: validDevEnv.NEON_BRANCH_ID,
        },
        validDevEnv
      )
    ).not.toThrow();
  });

  it('validates development Neon Object Storage configuration and blocks production endpoints', () => {
    const validStorageEnv = {
      ...validDevEnv,
      AWS_ENDPOINT_URL_S3: `https://${APPROVED_DEV_STORAGE_HOST}`,
      AWS_REGION: APPROVED_DEV_STORAGE_REGION,
      OBJECT_STORAGE_BUCKET: APPROVED_DEV_STORAGE_BUCKET,
      OBJECT_STORAGE_ENV_PREFIX: APPROVED_DEV_STORAGE_ENV_PREFIX,
      AWS_ACCESS_KEY_ID: 'nak_test',
      AWS_SECRET_ACCESS_KEY: 'nsk_test',
    };

    expect(assertSafeDevStorageEnvironment(validStorageEnv)).toEqual({
      endpointHost: APPROVED_DEV_STORAGE_HOST,
      region: APPROVED_DEV_STORAGE_REGION,
      bucket: APPROVED_DEV_STORAGE_BUCKET,
      envPrefix: APPROVED_DEV_STORAGE_ENV_PREFIX,
    });

    expect(() =>
      assertSafeDevStorageEnvironment({
        ...validStorageEnv,
        AWS_ENDPOINT_URL_S3:
          'https://br-withered-moon-be8coj8h.storage.c-9.us-east-2.aws.neon.tech',
      })
    ).toThrow(/production branch/i);

    expect(() =>
      assertSafeDevStorageEnvironment({
        ...validStorageEnv,
        OBJECT_STORAGE_ENV_PREFIX: 'production',
      })
    ).toThrow(/OBJECT_STORAGE_ENV_PREFIX/i);
  });
});