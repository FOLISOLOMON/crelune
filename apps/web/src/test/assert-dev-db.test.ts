import { describe, it, expect } from 'vitest';
import { assertSafeDevDatabaseEnvironment } from './assert-dev-db';

describe('PostgreSQL Integration Database Safety Guard', () => {
  const validDevEnv = {
    NODE_ENV: 'test',
    NEON_BRANCH: 'development',
    NEON_BRANCH_ID: 'br-nameless-silence-bexjp44k',
    DATABASE_URL:
      'postgresql://user:pass@ep-muddy-math-ben8e8p7-pooler.c-9.us-east-2.aws.neon.tech/neondb?sslmode=require',
    DATABASE_URL_UNPOOLED:
      'postgresql://user:pass@ep-muddy-math-ben8e8p7.c-9.us-east-2.aws.neon.tech/neondb?sslmode=require',
  };

  it('allows explicit development branch configuration', () => {
    expect(assertSafeDevDatabaseEnvironment(validDevEnv)).toEqual({
      dbHost: 'ep-muddy-math-ben8e8p7-pooler.c-9.us-east-2.aws.neon.tech',
      branchName: 'development',
    });
  });

  it('rejects NEON_BRANCH=production', () => {
    expect(() =>
      assertSafeDevDatabaseEnvironment({ ...validDevEnv, NEON_BRANCH: 'production' })
    ).toThrow(/protected branch/i);
  });

  it('rejects production branch ID even if NEON_BRANCH is mislabeled', () => {
    expect(() =>
      assertSafeDevDatabaseEnvironment({
        ...validDevEnv,
        NEON_BRANCH_ID: 'br-withered-moon-be8coj8h',
      })
    ).toThrow(/production branch ID/i);
  });

  it('rejects production endpoint hostname in DATABASE_URL or DATABASE_URL_UNPOOLED', () => {
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

  it('rejects missing NEON_BRANCH, missing DATABASE_URL, or NODE_ENV=production', () => {
    expect(() =>
      assertSafeDevDatabaseEnvironment({ ...validDevEnv, NEON_BRANCH: '' })
    ).toThrow(/NEON_BRANCH is missing/i);
    expect(() =>
      assertSafeDevDatabaseEnvironment({ ...validDevEnv, DATABASE_URL: '' })
    ).toThrow(/DATABASE_URL is missing/i);
    expect(() =>
      assertSafeDevDatabaseEnvironment({ ...validDevEnv, NODE_ENV: 'production' })
    ).toThrow(/NODE_ENV=production/i);
  });
});
