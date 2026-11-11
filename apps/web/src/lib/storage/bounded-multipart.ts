/**
 * CRELUNE — Bounded Multipart Upload Reader
 *
 * Streams request bodies up to a strict byte ceiling BEFORE multipart parsing,
 * defending against missing or spoofed Content-Length headers and preventing
 * arbitrary memory exhaustion in Node.js route handlers.
 */

import { MAX_MEMBER_PHOTO_BYTES } from '@crelune/shared';

// Hard body ceiling enforced before multipart parsing: 10 MB image cap + 256 KB multipart framing allowance
export const MAX_MULTIPART_CONTENT_LENGTH = MAX_MEMBER_PHOTO_BYTES + 256 * 1024;

export class BoundedMultipartError extends Error {
  public readonly status: 400 | 413;
  public readonly code: string;

  constructor(status: 400 | 413, code: string, message: string) {
    super(message);
    this.name = 'BoundedMultipartError';
    this.status = status;
    this.code = code;
  }
}

function hasValidMultipartHeader(contentType: string): boolean {
  const lower = contentType.toLowerCase();
  if (!lower.includes('multipart/form-data')) {
    return false;
  }
  return /;\s*boundary=(?:"[^"]+"|[^\s;]+)/i.test(contentType);
}

/**
 * Reads a streaming `multipart/form-data` request up to `maxBodyBytes`, cancelling
 * the underlying stream immediately if actual transmitted bytes exceed the limit
 * (even when `Content-Length` is absent or falsely small).
 */
export async function readBoundedMultipartFormData(
  request: Request,
  maxBodyBytes: number
): Promise<FormData> {
  const contentType = request.headers.get('content-type') || '';
  if (!hasValidMultipartHeader(contentType)) {
    throw new BoundedMultipartError(
      400,
      'INVALID_CONTENT_TYPE',
      'Upload request must use multipart/form-data with a valid boundary.'
    );
  }

  const contentLengthHeader = request.headers.get('content-length');
  if (contentLengthHeader !== null) {
    const trimmedLength = contentLengthHeader.trim();
    if (!/^\d+$/.test(trimmedLength)) {
      throw new BoundedMultipartError(
        400,
        'INVALID_CONTENT_LENGTH',
        'Malformed Content-Length header.'
      );
    }
    const declaredLength = Number.parseInt(trimmedLength, 10);
    if (!Number.isSafeInteger(declaredLength) || declaredLength > maxBodyBytes) {
      throw new BoundedMultipartError(
        413,
        'FILE_TOO_LARGE',
        'Uploaded photo request exceeds the 10 MB maximum limit.'
      );
    }
  }

  if (!request.body) {
    throw new BoundedMultipartError(
      400,
      'INVALID_UPLOAD_BODY',
      'Multipart upload body is missing.'
    );
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  let exceededLimit = false;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      if (!value || value.byteLength === 0) {
        continue;
      }

      totalBytes += value.byteLength;
      if (totalBytes > maxBodyBytes) {
        exceededLimit = true;
        try {
          await reader.cancel('Upload body exceeded maximum allowed byte limit.');
        } catch {
          // Stream may already be closing or errored; fail closed with 413 below.
        }
        throw new BoundedMultipartError(
          413,
          'FILE_TOO_LARGE',
          'Uploaded photo request exceeds the 10 MB maximum limit.'
        );
      }

      chunks.push(value);
    }
  } catch (err) {
    if (err instanceof BoundedMultipartError) {
      throw err;
    }
    if (!exceededLimit) {
      throw new BoundedMultipartError(
        400,
        'INVALID_UPLOAD_BODY',
        'Failed to read multipart upload payload.'
      );
    }
    throw err;
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // Lock already released after cancel/completion
    }
  }

  if (totalBytes === 0) {
    throw new BoundedMultipartError(
      400,
      'INVALID_UPLOAD_BODY',
      'Multipart upload payload cannot be empty.'
    );
  }

  const boundedBuffer = Buffer.concat(
    chunks.map((chunk) => Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength)),
    totalBytes
  );

  try {
    return await new Response(boundedBuffer, {
      headers: { 'content-type': contentType },
    }).formData();
  } catch {
    throw new BoundedMultipartError(
      400,
      'INVALID_UPLOAD_BODY',
      'Invalid multipart upload payload.'
    );
  }
}

