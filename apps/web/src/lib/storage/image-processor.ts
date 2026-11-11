/**
 * CRELUNE — Safe Image Decoding, Orientation Normalization, EXIF/Metadata Stripping & Re-encoding
 *
 * Decodes untrusted JPEG, PNG, and WebP buffers with `sharp` (libvips), applies
 * EXIF orientation into the pixel buffer, strips all EXIF (including GPS), XMP,
 * IPTC, and comment metadata, re-encodes in the canonical format while preserving
 * transparency/color quality, and re-validates the final output bytes.
 *
 * Original unprocessed bytes are never stored or returned. Metadata values are never logged.
 */

import sharp from 'sharp';
import {
  MAX_MEMBER_PHOTO_BYTES,
  MAX_MEMBER_PHOTO_HEIGHT,
  MAX_MEMBER_PHOTO_PIXELS,
  MAX_MEMBER_PHOTO_WIDTH,
  type MemberPhotoMimeType,
} from '@crelune/shared';
import {
  ImageValidationError,
  validateUploadedMemberPhoto,
  type UploadValidationInput,
  type ValidatedMemberPhoto,
} from '@/lib/storage/image-validator';

export interface ProcessedMemberPhoto extends ValidatedMemberPhoto {
  readonly processed: true;
}

const SHARP_FORMAT_TO_MIME: Record<string, MemberPhotoMimeType> = {
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

/**
 * Validates, safely decodes, orientation-normalizes, metadata-strips, re-encodes,
 * and re-validates an uploaded member photograph prior to persistence.
 */
export async function processUploadedMemberPhoto(
  input: UploadValidationInput
): Promise<ProcessedMemberPhoto> {
  // Step 1: Structural pre-validation (MIME/filename/extension/container/pixel bomb checks)
  const initial = validateUploadedMemberPhoto(input);

  const inputBuffer = Buffer.from(
    initial.bytes.buffer,
    initial.bytes.byteOffset,
    initial.bytes.byteLength
  );

  let detectedSharpFormat: string | undefined;
  let outputBuffer: Buffer;

  try {
    const inspector = sharp(inputBuffer, {
      failOn: 'error',
      limitInputPixels: MAX_MEMBER_PHOTO_PIXELS,
    });
    const metadata = await inspector.metadata();
    detectedSharpFormat = metadata.format;

    if (
      !detectedSharpFormat ||
      SHARP_FORMAT_TO_MIME[detectedSharpFormat] !== initial.mimeType
    ) {
      throw new ImageValidationError(
        'Decoded image format does not match verified image signature.',
        'UNSUPPORTED_FILE_TYPE'
      );
    }

    if (
      !metadata.width ||
      !metadata.height ||
      metadata.width < 1 ||
      metadata.height < 1 ||
      metadata.width > MAX_MEMBER_PHOTO_WIDTH ||
      metadata.height > MAX_MEMBER_PHOTO_HEIGHT ||
      metadata.width * metadata.height > MAX_MEMBER_PHOTO_PIXELS
    ) {
      throw new ImageValidationError(
        'Decoded image dimensions exceed CRELUNE safety limits.'
      );
    }

    // Reject multi-page / animated payloads rather than silently storing extra frames
    if (metadata.pages !== undefined && metadata.pages > 1) {
      throw new ImageValidationError(
        'Animated or multi-page images are not supported for member photos.',
        'UNSUPPORTED_FILE_TYPE'
      );
    }

    // Step 2: Rotate according to EXIF orientation, normalize to sRGB without
    // retaining EXIF, GPS, XMP, IPTC, ICC, or comment chunks, and re-encode.
    let pipeline = sharp(inputBuffer, {
      failOn: 'error',
      limitInputPixels: MAX_MEMBER_PHOTO_PIXELS,
    })
      .rotate()
      .toColorspace('srgb');

    if (initial.mimeType === 'image/jpeg') {
      pipeline = pipeline.jpeg({
        quality: 88,
        mozjpeg: true,
      });
    } else if (initial.mimeType === 'image/png') {
      pipeline = pipeline.png({
        compressionLevel: 9,
      });
    } else if (initial.mimeType === 'image/webp') {
      pipeline = pipeline.webp({
        quality: 88,
      });
    } else {
      throw new ImageValidationError(
        'Unsupported member photo format for safe metadata stripping.',
        'UNSUPPORTED_FILE_TYPE'
      );
    }

    outputBuffer = await pipeline.toBuffer();
  } catch (err) {
    if (err instanceof ImageValidationError) {
      throw err;
    }
    throw new ImageValidationError(
      'Uploaded image could not be safely decoded and sanitized.'
    );
  }

  if (outputBuffer.byteLength > MAX_MEMBER_PHOTO_BYTES) {
    throw new ImageValidationError(
      'Sanitized photo exceeds the 10 MB maximum file size.',
      'FILE_TOO_LARGE'
    );
  }

  // Step 3: Post-encoding verification of the final bytes (magic bytes, framing,
  // post-rotation dimensions, and absence of residual metadata segments).
  const revalidated = validateUploadedMemberPhoto({
    bytes: new Uint8Array(outputBuffer),
    declaredMimeType: initial.mimeType,
  });

  // Verify the encoded output carries no residual EXIF, XMP, IPTC, orientation, or comment markers
  try {
    const outMeta = await sharp(outputBuffer, {
      failOn: 'error',
      limitInputPixels: MAX_MEMBER_PHOTO_PIXELS,
    }).metadata();

    if (
      outMeta.exif ||
      outMeta.iptc ||
      outMeta.xmp ||
      outMeta.icc ||
      (outMeta.comments && outMeta.comments.length > 0) ||
      (outMeta.orientation !== undefined && outMeta.orientation !== 1)
    ) {
      throw new ImageValidationError(
        'Sanitized image retained prohibited embedded metadata.'
      );
    }
  } catch (err) {
    if (err instanceof ImageValidationError) {
      throw err;
    }
    throw new ImageValidationError('Failed post-sanitization metadata verification.');
  }

  return {
    ...revalidated,
    processed: true,
  };
}

