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
    NEON_BRANCH: APPROVED_DEV_STORAGE_TARGET.branchName,
    NEON_BRANCH_ID: APPROVED_DEV_STORAGE_TARGET.branchId,
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
        NEON_BRANCH: 'production',
        NEON_BRANCH_ID: 'br-withered-moon-be8coj8h',
      })
    ).toThrow(/not approved or configured/i);
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
