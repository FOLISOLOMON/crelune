/**
 * CRELUNE — Private Object Storage Provider Abstraction & Neon S3 Implementation
 *
 * Decouples domain services from AWS SDK / Neon S3 internals so storage operations
 * are verifiable, replaceable, and strictly scoped to private buckets.
 */

import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import {
  getObjectStorageConfig,
  type ObjectStorageConfig,
  type StorageEnvPrefix,
} from '@/lib/storage/storage-config';

export interface PutPrivateObjectInput {
  key: string;
  body: Uint8Array;
  contentType: string;
  cacheControl?: string;
}

export interface HeadObjectResult {
  exists: boolean;
  contentLength?: number;
  contentType?: string;
}

export interface GetObjectResult {
  body: Uint8Array;
  contentLength?: number;
  contentType?: string;
}

export interface ObjectStorageProvider {
  readonly envPrefix: StorageEnvPrefix;
  putPrivateObject(input: PutPrivateObjectInput): Promise<void>;
  headObject(key: string): Promise<HeadObjectResult>;
  getObject(key: string): Promise<GetObjectResult>;
  deleteObject(key: string): Promise<void>;
}

function getHttpStatusCode(err: unknown): number | undefined {
  if (!err || typeof err !== 'object') return undefined;
  const meta = (err as { $metadata?: { httpStatusCode?: number } }).$metadata;
  return meta?.httpStatusCode;
}

export class NeonS3ObjectStorageProvider implements ObjectStorageProvider {
  public readonly envPrefix: StorageEnvPrefix;
  private readonly bucket: string;
  private readonly client: S3Client;

  constructor(config: ObjectStorageConfig) {
    this.envPrefix = config.envPrefix;
    this.bucket = config.bucket;
    this.client = new S3Client({
      region: config.region,
      endpoint: config.endpoint,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
      // Neon Object Storage requires path-style addressing (`forcePathStyle: true`)
      forcePathStyle: true,
    });
  }

  async putPrivateObject(input: PutPrivateObjectInput): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: input.key,
        Body: input.body,
        ContentType: input.contentType,
        ContentLength: input.body.byteLength,
        CacheControl: input.cacheControl ?? 'private, no-store',
      })
    );
  }

  async headObject(key: string): Promise<HeadObjectResult> {
    try {
      const response = await this.client.send(
        new HeadObjectCommand({
          Bucket: this.bucket,
          Key: key,
        })
      );
      return {
        exists: true,
        contentLength: response.ContentLength,
        contentType: response.ContentType,
      };
    } catch (err) {
      const status = getHttpStatusCode(err);
      const name = err instanceof Error ? err.name : '';
      if (status === 404 || name === 'NotFound' || name === 'NoSuchKey') {
        return { exists: false };
      }
      throw err;
    }
  }

  async getObject(key: string): Promise<GetObjectResult> {
    const response = await this.client.send(
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
      })
    );
    if (!response.Body) {
      throw new Error('Object storage returned an empty body.');
    }
    const bytes = await response.Body.transformToByteArray();
    return {
      body: bytes,
      contentLength: response.ContentLength ?? bytes.byteLength,
      contentType: response.ContentType,
    };
  }

  async deleteObject(key: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({
        Bucket: this.bucket,
        Key: key,
      })
    );
  }
}

export function createObjectStorageProvider(
  env: Record<string, string | undefined> = process.env
): ObjectStorageProvider {
  const config = getObjectStorageConfig(env);
  return new NeonS3ObjectStorageProvider(config);
}

