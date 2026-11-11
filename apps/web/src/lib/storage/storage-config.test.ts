import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import {
  assertKeyMatchesMemberScope,
  buildMemberPhotoObjectKey,
  getObjectStorageConfig,
  StorageConfigError,
  StorageKeyViolationError,
} from './storage-config';

describe('Object Storage Configuration & Key Isolation', () => {
  const validDevEnv = {
    AWS_ENDPOINT_URL_S3:
      'https://br-nameless-silence-bexjp44k.storage.c-9.us-east-2.aws.neon.tech',
    AWS_REGION: 'us-east-2',
    AWS_ACCESS_KEY_ID: 'nak_test_id',
    AWS_SECRET_ACCESS_KEY: 'nsk_test_secret',
    OBJECT_STORAGE_BUCKET: 'crelune-dev-member-photos',
    OBJECT_STORAGE_ENV_PREFIX: 'development',
    NEON_BRANCH: 'development',
    NEON_BRANCH_ID: 'br-nameless-silence-bexjp44k',
  };

  it('loads isolated development storage configuration cleanly', () => {
    const cfg = getObjectStorageConfig(validDevEnv);
    expect(cfg).toEqual({
      endpoint:
        'https://br-nameless-silence-bexjp44k.storage.c-9.us-east-2.aws.neon.tech',
      region: 'us-east-2',
      accessKeyId: 'nak_test_id',
      secretAccessKey: 'nsk_test_secret',
      bucket: 'crelune-dev-member-photos',
      envPrefix: 'development',
    });
  });

  it('rejects cross-environment production endpoint or production bucket under development config', () => {
    expect(() =>
      getObjectStorageConfig({
        ...validDevEnv,
        AWS_ENDPOINT_URL_S3:
          'https://br-withered-moon-be8coj8h.storage.c-9.us-east-2.aws.neon.tech',
      })
    ).toThrow(StorageConfigError);

    expect(() =>
      getObjectStorageConfig({
        ...validDevEnv,
        NEON_BRANCH: 'production',
      })
    ).toThrow(StorageConfigError);

    expect(() =>
      getObjectStorageConfig({
        ...validDevEnv,
        OBJECT_STORAGE_BUCKET: 'crelune-production-photos',
      })
    ).toThrow(StorageConfigError);

    expect(() =>
      getObjectStorageConfig({
        ...validDevEnv,
        OBJECT_STORAGE_ENV_PREFIX: 'production',
      })
    ).toThrow(StorageConfigError);
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

    // Cross-environment production namespace rejected when envPrefix='development'
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

    // Cross-organisation and cross-member keys rejected
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

  it('keeps storage credentials and S3 SDK imports strictly out of browser client components', () => {
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
    }
  });
});
