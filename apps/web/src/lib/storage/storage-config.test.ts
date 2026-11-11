import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import {
  APPROVED_DEV_STORAGE_TARGET,
  assertKeyMatchesMemberScope,
  buildMemberPhotoObjectKey,
  getObjectStorageConfig,
  StorageConfigError,
  StorageKeyViolationError,
} from './storage-config';

describe('Object Storage Configuration & Exact Runtime Allowlist', () => {
  const validDevEnv = {
    AWS_ENDPOINT_URL_S3:
      `https://${APPROVED_DEV_STORAGE_TARGET.endpointHost}`,
    AWS_REGION: APPROVED_DEV_STORAGE_TARGET.region,
    AWS_ACCESS_KEY_ID: 'nak_test_dev_id',
    AWS_SECRET_ACCESS_KEY: 'nsk_test_dev_secret',
    OBJECT_STORAGE_BUCKET: APPROVED_DEV_STORAGE_TARGET.bucket,
    OBJECT_STORAGE_ENV_PREFIX: APPROVED_DEV_STORAGE_TARGET.envPrefix,
    OBJECT_STORAGE_CREDENTIAL_BRANCH_ID: APPROVED_DEV_STORAGE_TARGET.branchId,
    NEON_BRANCH: APPROVED_DEV_STORAGE_TARGET.branchName,
    NEON_BRANCH_ID: APPROVED_DEV_STORAGE_TARGET.branchId,
    DATABASE_URL: `postgresql://crelune_test:super_secret_pw@${APPROVED_DEV_STORAGE_TARGET.pooledDbHost}/${APPROVED_DEV_STORAGE_TARGET.databaseName}?sslmode=require`,
    DATABASE_URL_UNPOOLED: `postgres://crelune_test:super_secret_pw@${APPROVED_DEV_STORAGE_TARGET.directDbHost}/${APPROVED_DEV_STORAGE_TARGET.databaseName}?sslmode=require`,
  };

  it('loads exact approved development storage configuration cleanly', () => {
    const cfg = getObjectStorageConfig(validDevEnv);
    expect(cfg).toEqual({
      endpoint:
        'https://br-nameless-silence-bexjp44k.storage.c-9.us-east-2.aws.neon.tech',
      region: 'us-east-2',
      accessKeyId: 'nak_test_dev_id',
      secretAccessKey: 'nsk_test_dev_secret',
      bucket: 'crelune-dev-member-photos',
      envPrefix: 'development',
      branchId: 'br-nameless-silence-bexjp44k',
      branchName: 'development',
      credentialBranchId: 'br-nameless-silence-bexjp44k',
      pooledDbHost: 'ep-muddy-math-ben8e8p7-pooler.c-9.us-east-2.aws.neon.tech',
      directDbHost: 'ep-muddy-math-ben8e8p7.c-9.us-east-2.aws.neon.tech',
      databaseName: 'neondb',
    });
  });

  it('rejects wrong endpoints, lookalike endpoints, non-HTTPS URLs, and endpoint paths/ports', () => {
    for (const badEndpoint of [
      'https://arbitrary-bucket.s3.us-east-2.amazonaws.com',
      'https://br-other-branch-123456.storage.c-9.us-east-2.aws.neon.tech',
      'https://br-nameless-silence-bexjp44k.storage.c-9.us-east-2.aws.neon.tech.evil.com',
      'https://evil.br-nameless-silence-bexjp44k.storage.c-9.us-east-2.aws.neon.tech',
      'https://br-nameless-silence-bexjp44k.storage.us-east-2.aws.neon.tech',
      'http://br-nameless-silence-bexjp44k.storage.c-9.us-east-2.aws.neon.tech',
      'https://br-nameless-silence-bexjp44k.storage.c-9.us-east-2.aws.neon.tech:8443',
      'https://br-nameless-silence-bexjp44k.storage.c-9.us-east-2.aws.neon.tech/extra',
    ]) {
      expect(() =>
        getObjectStorageConfig({
          ...validDevEnv,
          AWS_ENDPOINT_URL_S3: badEndpoint,
        })
      ).toThrow(StorageConfigError);
    }
  });

  it('rejects wrong region, wrong bucket, wrong prefix, missing branch ID, and mismatched branch name/ID', () => {
    // Wrong region
    expect(() =>
      getObjectStorageConfig({ ...validDevEnv, AWS_REGION: 'us-east-1' })
    ).toThrow(StorageConfigError);

    // Wrong or lookalike bucket
    for (const badBucket of [
      'crelune-dev-member-photos-copy',
      'crelune-staging-member-photos',
      'crelune-production-photos',
      'arbitrary-bucket',
    ]) {
      expect(() =>
        getObjectStorageConfig({ ...validDevEnv, OBJECT_STORAGE_BUCKET: badBucket })
      ).toThrow(StorageConfigError);
    }

    // Wrong or unapproved environment prefix
    for (const badPrefix of ['staging', 'preview', 'dev', 'local']) {
      expect(() =>
        getObjectStorageConfig({ ...validDevEnv, OBJECT_STORAGE_ENV_PREFIX: badPrefix })
      ).toThrow(StorageConfigError);
    }

    // Missing NEON_BRANCH_ID or NEON_BRANCH
    expect(() =>
      getObjectStorageConfig({ ...validDevEnv, NEON_BRANCH_ID: '' })
    ).toThrow(StorageConfigError);
    expect(() =>
      getObjectStorageConfig({ ...validDevEnv, NEON_BRANCH: '' })
    ).toThrow(StorageConfigError);

    // Mismatched branch name and branch ID
    expect(() =>
      getObjectStorageConfig({
        ...validDevEnv,
        NEON_BRANCH: 'development',
        NEON_BRANCH_ID: 'br-wrong-branch-999',
      })
    ).toThrow(StorageConfigError);
    expect(() =>
      getObjectStorageConfig({
        ...validDevEnv,
        NEON_BRANCH: 'main',
        NEON_BRANCH_ID: APPROVED_DEV_STORAGE_TARGET.branchId,
      })
    ).toThrow(StorageConfigError);
  });

  it('rejects cross-environment development/production combinations and fails closed on unapproved production', () => {
    // Development prefix with production endpoint, branch, DB host, or credentials
    expect(() =>
      getObjectStorageConfig({
        ...validDevEnv,
        AWS_ENDPOINT_URL_S3:
          'https://br-withered-moon-be8coj8h.storage.c-9.us-east-2.aws.neon.tech',
      })
    ).toThrow(StorageConfigError);

    expect(() =>
      getObjectStorageConfig({ ...validDevEnv, NEON_BRANCH: 'production' })
    ).toThrow(StorageConfigError);

    expect(() =>
      getObjectStorageConfig({
        ...validDevEnv,
        NEON_BRANCH_ID: 'br-withered-moon-be8coj8h',
      })
    ).toThrow(StorageConfigError);

    expect(() =>
      getObjectStorageConfig({
        ...validDevEnv,
        OBJECT_STORAGE_CREDENTIAL_BRANCH_ID: 'br-withered-moon-be8coj8h',
      })
    ).toThrow(StorageConfigError);

    expect(() =>
      getObjectStorageConfig({
        ...validDevEnv,
        DATABASE_URL:
          'postgresql://u:p@ep-mute-forest-bepsjmsu-pooler.c-9.us-east-2.aws.neon.tech/neondb',
      })
    ).toThrow(StorageConfigError);

    // Production prefix with development endpoint, bucket, branch, or credentials
    expect(() =>
      getObjectStorageConfig({
        ...validDevEnv,
        OBJECT_STORAGE_ENV_PREFIX: 'production',
      })
    ).toThrow(StorageConfigError);

    // Production prefix with arbitrary non-approved production config MUST STILL FAIL CLOSED
    expect(() =>
      getObjectStorageConfig({
        AWS_ENDPOINT_URL_S3:
          'https://br-withered-moon-be8coj8h.storage.c-9.us-east-2.aws.neon.tech',
        AWS_REGION: 'us-east-2',
        AWS_ACCESS_KEY_ID: 'nak_prod_candidate',
        AWS_SECRET_ACCESS_KEY: 'nsk_prod_candidate',
        OBJECT_STORAGE_BUCKET: 'crelune-prod-member-photos',
        OBJECT_STORAGE_ENV_PREFIX: 'production',
        OBJECT_STORAGE_CREDENTIAL_BRANCH_ID: 'br-withered-moon-be8coj8h',
        NEON_BRANCH: 'production',
        NEON_BRANCH_ID: 'br-withered-moon-be8coj8h',
        DATABASE_URL:
          'postgresql://prod_user:prod_pw@ep-mute-forest-bepsjmsu-pooler.c-9.us-east-2.aws.neon.tech/neondb?sslmode=require',
        DATABASE_URL_UNPOOLED:
          'postgresql://prod_user:prod_pw@ep-mute-forest-bepsjmsu.c-9.us-east-2.aws.neon.tech/neondb?sslmode=require',
      })
    ).toThrow(/not approved or configured/i);
  });

  it('enforces exact DATABASE_URL, DATABASE_URL_UNPOOLED, and OBJECT_STORAGE_CREDENTIAL_BRANCH_ID pairing without leaking secrets', () => {
    const expectRejectedWithoutLeaks = (
      overrides: Record<string, string | undefined>,
      secretFragments: string[] = []
    ) => {
      let caught: unknown;
      try {
        getObjectStorageConfig({
          ...validDevEnv,
          ...overrides,
        });
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(StorageConfigError);
      const message = caught instanceof Error ? caught.message : String(caught);
      expect(message).not.toContain('super_secret_pw');
      expect(message).not.toContain('crelune_test');
      for (const secretFragment of secretFragments) {
        expect(message).not.toContain(secretFragment);
      }
    };

    // Missing database URLs or credential branch marker
    expectRejectedWithoutLeaks({ DATABASE_URL: undefined });
    expectRejectedWithoutLeaks({ DATABASE_URL: '' });
    expectRejectedWithoutLeaks({ DATABASE_URL_UNPOOLED: undefined });
    expectRejectedWithoutLeaks({ DATABASE_URL_UNPOOLED: '' });
    expectRejectedWithoutLeaks({ OBJECT_STORAGE_CREDENTIAL_BRANCH_ID: undefined });
    expectRejectedWithoutLeaks({ OBJECT_STORAGE_CREDENTIAL_BRANCH_ID: '' });
    expectRejectedWithoutLeaks({
      OBJECT_STORAGE_CREDENTIAL_BRANCH_ID: 'br-example-id',
    });
    expectRejectedWithoutLeaks({
      OBJECT_STORAGE_CREDENTIAL_BRANCH_ID: 'br-other-branch-123',
    });

    // Malformed URLs and wrong protocols
    for (const malformedUrl of [
      'not-a-url',
      'http://crelune_user:leaked_secret@ep-muddy-math-ben8e8p7-pooler.c-9.us-east-2.aws.neon.tech/neondb',
      'mysql://crelune_user:leaked_secret@ep-muddy-math-ben8e8p7-pooler.c-9.us-east-2.aws.neon.tech/neondb',
      'postgresql://crelune_user:leaked_secret@ep-muddy-math-ben8e8p7-pooler.c-9.us-east-2.aws.neon.tech',
    ]) {
      expectRejectedWithoutLeaks(
        { DATABASE_URL: malformedUrl },
        ['crelune_user', 'leaked_secret']
      );
      expectRejectedWithoutLeaks(
        { DATABASE_URL_UNPOOLED: malformedUrl },
        ['crelune_user', 'leaked_secret']
      );
    }

    // Swapped pooled and direct URLs
    expectRejectedWithoutLeaks({
      DATABASE_URL: validDevEnv.DATABASE_URL_UNPOOLED,
      DATABASE_URL_UNPOOLED: validDevEnv.DATABASE_URL,
    });

    // Wrong database name
    expectRejectedWithoutLeaks({
      DATABASE_URL: `postgresql://u:secret_db_pw@${APPROVED_DEV_STORAGE_TARGET.pooledDbHost}/otherdb?sslmode=require`,
    }, ['secret_db_pw']);
    expectRejectedWithoutLeaks({
      DATABASE_URL_UNPOOLED: `postgresql://u:secret_db_pw@${APPROVED_DEV_STORAGE_TARGET.directDbHost}/otherdb?sslmode=require`,
    }, ['secret_db_pw']);

    // Arbitrary, lookalike, query-smuggled, or production hosts even when NEON_BRANCH & NEON_BRANCH_ID say development
    for (const badHost of [
      'ep-other-db-pooler.c-9.us-east-2.aws.neon.tech',
      `${APPROVED_DEV_STORAGE_TARGET.pooledDbHost}.evil.com`,
      `evil.${APPROVED_DEV_STORAGE_TARGET.pooledDbHost}`,
      'ep-mute-forest-bepsjmsu-pooler.c-9.us-east-2.aws.neon.tech',
      'localhost',
    ]) {
      expectRejectedWithoutLeaks(
        {
          DATABASE_URL: `postgresql://u:secret_leak@${badHost}/neondb?host=${APPROVED_DEV_STORAGE_TARGET.pooledDbHost}`,
        },
        ['secret_leak']
      );
    }

    expectRejectedWithoutLeaks(
      {
        DATABASE_URL_UNPOOLED:
          'postgresql://u:secret_leak@ep-mute-forest-bepsjmsu.c-9.us-east-2.aws.neon.tech/neondb',
      },
      ['secret_leak']
    );
  });

  it('never uses original filenames and enforces environment + organisation + member key isolation', () => {
    const key = buildMemberPhotoObjectKey({
      envPrefix: 'development',
      organisationId: 'org_abc123',
      memberId: 'mem_xyz789',
      extension: 'png',
      objectId: 'obj-uuid-1111',
    });

    expect(key).toBe(
      'development/organisations/org_abc123/members/mem_xyz789/photos/obj-uuid-1111.png'
    );

    expect(() =>
      assertKeyMatchesMemberScope(key, {
        envPrefix: 'development',
        organisationId: 'org_abc123',
        memberId: 'mem_xyz789',
      })
    ).not.toThrow();

    expect(() =>
      assertKeyMatchesMemberScope(
        'production/organisations/org_abc123/members/mem_xyz789/photos/obj-uuid-1111.png',
        {
          envPrefix: 'development',
          organisationId: 'org_abc123',
          memberId: 'mem_xyz789',
        }
      )
    ).toThrow(StorageKeyViolationError);

    expect(() =>
      assertKeyMatchesMemberScope(key, {
        envPrefix: 'development',
        organisationId: 'org_other',
        memberId: 'mem_xyz789',
      })
    ).toThrow(StorageKeyViolationError);

    expect(() =>
      assertKeyMatchesMemberScope(
        'development/organisations/org_abc123/members/mem_xyz789/photos/../other.png',
        {
          envPrefix: 'development',
          organisationId: 'org_abc123',
          memberId: 'mem_xyz789',
        }
      )
    ).toThrow(StorageKeyViolationError);
  });

  it('keeps storage credentials, S3 SDK, and sharp strictly out of browser client components', () => {
    const componentsDir = path.resolve(__dirname, '../../components');
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (/\.(ts|tsx)$/.test(entry.name)) files.push(full);
      }
    };
    walk(componentsDir);

    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const content = fs.readFileSync(file, 'utf8');
      expect(content).not.toContain('AWS_SECRET_ACCESS_KEY');
      expect(content).not.toContain('AWS_ACCESS_KEY_ID');
      expect(content).not.toContain('@aws-sdk/client-s3');
      expect(content).not.toContain('lib/storage/object-storage');
      expect(content).not.toContain('lib/storage/image-processor');
    }
  });
});
