/**
 * CRELUNE — Private Creative Object Storage Provider & Presigned Upload Helper
 *
 * Strictly bound to the dedicated creative bucket (`OBJECT_STORAGE_CREATIVE_BUCKET`,
 * e.g. `crelune-dev-creative`), isolated from member-photo storage (`crelune-dev-member-photos`).
 */

import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { CREATIVE_BYTE_LIMITS } from '@crelune/shared';
import {
  getCreativeObjectStorageConfig,
  StorageKeyViolationError,
  type ObjectStorageConfig,
  type StorageEnvPrefix,
} from '@/lib/storage/storage-config';
import type {
  GetObjectResult,
  HeadObjectResult,
  PutPrivateObjectInput,
} from '@/lib/storage/object-storage';

export interface PresignedCreativePutInput {
  key: string;
  contentType: string;
  contentLength: number;
  expiresInSeconds?: number;
}

export interface PresignedCreativePutResult {
  url: string;
  method: 'PUT';
  requiredHeaders: {
    'content-type': string;
    'content-length': string;
  };
  expiresAt: Date;
}

export class CreativeObjectTooLargeError extends Error {
  constructor(maxBytes: number) {
    super(`Uploaded creative object exceeds maximum allowed size (${maxBytes} bytes).`);
    this.name = 'CreativeObjectTooLargeError';
  }
}

export interface CreativeObjectStorageProvider {
  readonly envPrefix: StorageEnvPrefix;
  readonly bucket: string;
  createPresignedPutUrl(
    input: PresignedCreativePutInput
  ): Promise<PresignedCreativePutResult>;
  putPrivateObject(input: PutPrivateObjectInput): Promise<void>;
  headObject(key: string): Promise<HeadObjectResult>;
  getObjectBounded(key: string, maxBytes: number): Promise<GetObjectResult>;
  deleteObject(key: string): Promise<void>;
}

function getHttpStatusCode(err: unknown): number | undefined {
  if (!err || typeof err !== 'object') return undefined;
  const meta = (err as { $metadata?: { httpStatusCode?: number } }).$metadata;
  return meta?.httpStatusCode;
}

export function assertCreativeKeyEnvPrefix(
  key: string,
  envPrefix: StorageEnvPrefix
): void {
  if (
    !key ||
    key.startsWith('/') ||
    key.includes('..') ||
    key.includes('\\') ||
    key.includes('%') ||
    key.includes('\0') ||
    !key.startsWith(`${envPrefix}/organisations/`)
  ) {
    throw new StorageKeyViolationError(
      'Creative object key does not match approved environment/organisation prefix.'
    );
  }
}

export class NeonS3CreativeStorageProvider implements CreativeObjectStorageProvider {
  public readonly envPrefix: StorageEnvPrefix;
  public readonly bucket: string;
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

  async createPresignedPutUrl(
    input: PresignedCreativePutInput
  ): Promise<PresignedCreativePutResult> {
    assertCreativeKeyEnvPrefix(input.key, this.envPrefix);
    const ttl = Math.min(
      Math.max(60, input.expiresInSeconds ?? CREATIVE_BYTE_LIMITS.UPLOAD_INTENT_TTL_SECONDS),
      CREATIVE_BYTE_LIMITS.UPLOAD_INTENT_TTL_SECONDS
    );

    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: input.key,
      ContentType: input.contentType,
      ContentLength: input.contentLength,
    });

    const url = await getSignedUrl(this.client, command, { expiresIn: ttl });
    return {
      url,
      method: 'PUT',
      requiredHeaders: {
        'content-type': input.contentType,
        'content-length': String(input.contentLength),
      },
      expiresAt: new Date(Date.now() + ttl * 1000),
    };
  }

  async putPrivateObject(input: PutPrivateObjectInput): Promise<void> {
    assertCreativeKeyEnvPrefix(input.key, this.envPrefix);
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
    assertCreativeKeyEnvPrefix(key, this.envPrefix);
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

  async getObjectBounded(key: string, maxBytes: number): Promise<GetObjectResult> {
    assertCreativeKeyEnvPrefix(key, this.envPrefix);
    const response = await this.client.send(
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
      })
    );
    if (
      response.ContentLength !== undefined &&
      response.ContentLength > maxBytes
    ) {
      throw new CreativeObjectTooLargeError(maxBytes);
    }
    if (!response.Body) {
      throw new Error('Creative object storage returned an empty body.');
    }

    const stream = response.Body.transformToWebStream();
    const reader = stream.getReader();
    const chunks: Uint8Array[] = [];
    let totalBytes = 0;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value || value.byteLength === 0) continue;
        totalBytes += value.byteLength;
        if (totalBytes > maxBytes) {
          await reader.cancel().catch(() => undefined);
          throw new CreativeObjectTooLargeError(maxBytes);
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }

    const combined = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of chunks) {
      combined.set(chunk, offset);
      offset += chunk.byteLength;
    }

    return {
      body: combined,
      contentLength: response.ContentLength ?? combined.byteLength,
      contentType: response.ContentType,
    };
  }

  async deleteObject(key: string): Promise<void> {
    assertCreativeKeyEnvPrefix(key, this.envPrefix);
    await this.client.send(
      new DeleteObjectCommand({
        Bucket: this.bucket,
        Key: key,
      })
    );
  }
}

export function createCreativeObjectStorageProvider(
  env: Record<string, string | undefined> = process.env
): CreativeObjectStorageProvider {
  const config = getCreativeObjectStorageConfig(env);
  return new NeonS3CreativeStorageProvider(config);
}

