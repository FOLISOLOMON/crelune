/**
 * CRELUNE — Untrusted Image Validation, Signature Inspection & Decompression-Bomb Guard
 *
 * Enforces strict server-side binary verification for private member photographs:
 *  - Only JPEG, PNG, and WebP are accepted (SVG, HTML, XML, executables blocked).
 *  - Verifies magic bytes, declared MIME (when present), safe filename & extension,
 *    full container framing (rejects truncated files and trailing payloads),
 *    pixel dimensions/decompression limits, and bounded PNG IDAT decompression.
 */

import zlib from 'node:zlib';
import {
  MAX_MEMBER_PHOTO_BYTES,
  MAX_MEMBER_PHOTO_HEIGHT,
  MAX_MEMBER_PHOTO_PIXELS,
  MAX_MEMBER_PHOTO_WIDTH,
  MIN_MEMBER_PHOTO_BYTES,
  type MemberPhotoMimeType,
} from '@crelune/shared';

export interface ValidatedMemberPhoto {
  bytes: Uint8Array;
  mimeType: MemberPhotoMimeType;
  extension: 'jpg' | 'png' | 'webp';
  width: number;
  height: number;
  byteSize: number;
}

export class ImageValidationError extends Error {
  public readonly code: string;

  constructor(message: string, code: string = 'INVALID_IMAGE') {
    super(message);
    this.name = 'ImageValidationError';
    this.code = code;
  }
}

const MIME_TO_EXTENSIONS: Record<MemberPhotoMimeType, ReadonlyArray<string>> = {
  'image/jpeg': ['.jpg', '.jpeg'],
  'image/png': ['.png'],
  'image/webp': ['.webp'],
};

const MIME_TO_CANONICAL_EXT: Record<MemberPhotoMimeType, 'jpg' | 'png' | 'webp'> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

const PNG_SIGNATURE = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function assertSafeDimensionBounds(width: number, height: number): void {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw new ImageValidationError('Image has invalid dimensions.');
  }
  if (width > MAX_MEMBER_PHOTO_WIDTH || height > MAX_MEMBER_PHOTO_HEIGHT) {
    throw new ImageValidationError(
      `Image dimensions exceed the maximum allowed size (${MAX_MEMBER_PHOTO_WIDTH}x${MAX_MEMBER_PHOTO_HEIGHT}).`
    );
  }
  if (width * height > MAX_MEMBER_PHOTO_PIXELS) {
    throw new ImageValidationError(
      `Image pixel count exceeds the maximum allowed limit (${MAX_MEMBER_PHOTO_PIXELS} pixels).`
    );
  }
}

function rejectDangerousSignatures(bytes: Uint8Array): void {
  // Block executable headers (PE/COFF MZ, ELF, Mach-O, shebang)
  if (
    (bytes.length >= 2 && bytes[0] === 0x4d && bytes[1] === 0x5a) || // MZ
    (bytes.length >= 4 &&
      bytes[0] === 0x7f &&
      bytes[1] === 0x45 &&
      bytes[2] === 0x4c &&
      bytes[3] === 0x46) || // \x7fELF
    (bytes.length >= 2 && bytes[0] === 0x23 && bytes[1] === 0x21) // #!
  ) {
    throw new ImageValidationError(
      'Executable files are strictly prohibited.',
      'UNSUPPORTED_FILE_TYPE'
    );
  }

  // Strip optional UTF-8 BOM and leading whitespace before scanning text markers
  let offset = 0;
  if (
    bytes.length >= 3 &&
    bytes[0] === 0xef &&
    bytes[1] === 0xbb &&
    bytes[2] === 0xbf
  ) {
    offset = 3;
  }
  const headText = Buffer.from(bytes.subarray(offset, Math.min(bytes.length, offset + 512)))
    .toString('utf8')
    .trimStart()
    .toLowerCase();

  if (
    headText.startsWith('<svg') ||
    headText.startsWith('<?xml') ||
    headText.startsWith('<!doctype') ||
    headText.startsWith('<html') ||
    headText.startsWith('<script') ||
    headText.includes('<svg')
  ) {
    throw new ImageValidationError(
      'SVG, XML, and HTML files are not permitted for member photos.',
      'UNSUPPORTED_FILE_TYPE'
    );
  }
}

function assertSafeFilename(
  filename: string | undefined,
  detectedMime: MemberPhotoMimeType
): void {
  if (!filename || !filename.trim()) {
    return;
  }
  const trimmed = filename.trim();
  const lowered = trimmed.toLowerCase();

  if (
    trimmed.includes('..') ||
    trimmed.includes('/') ||
    trimmed.includes('\\') ||
    trimmed.includes('\0') ||
    lowered.includes('%2e') ||
    lowered.includes('%2f') ||
    lowered.includes('%5c')
  ) {
    throw new ImageValidationError(
      'Invalid filename: path traversal characters are not allowed.',
      'INVALID_FILENAME'
    );
  }

  const lastDot = trimmed.lastIndexOf('.');
  if (lastDot === -1) {
    return;
  }

  const ext = trimmed.slice(lastDot).toLowerCase();
  const allowedExts = MIME_TO_EXTENSIONS[detectedMime];
  if (!allowedExts.includes(ext)) {
    throw new ImageValidationError(
      'File extension does not match the detected image format.',
      'EXTENSION_MISMATCH'
    );
  }
}

function assertDeclaredMimeMatches(
  declaredMime: string | undefined,
  detectedMime: MemberPhotoMimeType
): void {
  if (!declaredMime || !declaredMime.trim()) {
    return;
  }
  const normalized = declaredMime.split(';')[0]?.trim().toLowerCase() ?? '';
  if (!normalized) {
    return;
  }
  if (normalized !== detectedMime) {
    throw new ImageValidationError(
      'Declared file MIME type does not match actual image signature.',
      'MIME_MISMATCH'
    );
  }
}

function hasPrefix(bytes: Uint8Array, prefix: Uint8Array): boolean {
  if (bytes.length < prefix.length) return false;
  for (let i = 0; i < prefix.length; i += 1) {
    if (bytes[i] !== prefix[i]) return false;
  }
  return true;
}

function getPngChannels(colorType: number): number | null {
  switch (colorType) {
    case 0:
      return 1; // Grayscale
    case 2:
      return 3; // RGB
    case 3:
      return 1; // Palette index
    case 4:
      return 2; // Grayscale + Alpha
    case 6:
      return 4; // RGBA
    default:
      return null;
  }
}

function isValidPngBitDepth(colorType: number, bitDepth: number): boolean {
  switch (colorType) {
    case 0:
      return bitDepth === 1 || bitDepth === 2 || bitDepth === 4 || bitDepth === 8 || bitDepth === 16;
    case 2:
    case 4:
    case 6:
      return bitDepth === 8 || bitDepth === 16;
    case 3:
      return bitDepth === 1 || bitDepth === 2 || bitDepth === 4 || bitDepth === 8;
    default:
      return false;
  }
}

function parseAndVerifyPng(bytes: Uint8Array): { width: number; height: number } {
  const buf = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let interlace = 0;
  let sawIhdr = false;
  let sawIend = false;
  const idatChunks: Buffer[] = [];
  let totalIdatCompressedBytes = 0;

  while (offset < buf.length) {
    if (offset + 12 > buf.length) {
      throw new ImageValidationError('Truncated PNG chunk header.');
    }
    const chunkLength = buf.readUInt32BE(offset);
    const chunkType = buf.toString('ascii', offset + 4, offset + 8);
    const dataStart = offset + 8;
    const dataEnd = dataStart + chunkLength;
    const crcOffset = dataEnd;

    if (chunkLength > 0x7fffffff || crcOffset + 4 > buf.length) {
      throw new ImageValidationError('Truncated or invalid PNG chunk payload.');
    }

    const expectedCrc = buf.readUInt32BE(crcOffset);
    const actualCrc = zlib.crc32(buf.subarray(offset + 4, dataEnd));
    if (actualCrc !== expectedCrc) {
      throw new ImageValidationError(`Corrupted PNG CRC in ${chunkType} chunk.`);
    }

    if (!sawIhdr) {
      if (chunkType !== 'IHDR' || chunkLength !== 13) {
        throw new ImageValidationError('Invalid PNG header chunk.');
      }
      width = buf.readUInt32BE(dataStart);
      height = buf.readUInt32BE(dataStart + 4);
      bitDepth = buf.readUInt8(dataStart + 8);
      colorType = buf.readUInt8(dataStart + 9);
      const compression = buf.readUInt8(dataStart + 10);
      const filter = buf.readUInt8(dataStart + 11);
      interlace = buf.readUInt8(dataStart + 12);

      if (
        compression !== 0 ||
        filter !== 0 ||
        (interlace !== 0 && interlace !== 1) ||
        !isValidPngBitDepth(colorType, bitDepth)
      ) {
        throw new ImageValidationError('Unsupported or invalid PNG encoding parameters.');
      }

      assertSafeDimensionBounds(width, height);
      sawIhdr = true;
    } else if (sawIend) {
      throw new ImageValidationError('Unexpected trailing data after PNG IEND.');
    } else if (chunkType === 'IDAT') {
      totalIdatCompressedBytes += chunkLength;
      if (totalIdatCompressedBytes > MAX_MEMBER_PHOTO_BYTES) {
        throw new ImageValidationError('PNG compressed data exceeds maximum allowed limit.');
      }
      idatChunks.push(buf.subarray(dataStart, dataEnd));
    } else if (chunkType === 'IEND') {
      if (chunkLength !== 0) {
        throw new ImageValidationError('Invalid PNG IEND marker.');
      }
      sawIend = true;
      if (crcOffset + 4 !== buf.length) {
        throw new ImageValidationError('Trailing payload found after PNG IEND.');
      }
    }

    offset = crcOffset + 4;
  }

  if (!sawIhdr || !sawIend || idatChunks.length === 0) {
    throw new ImageValidationError('Incomplete or truncated PNG image.');
  }

  const channels = getPngChannels(colorType);
  if (!channels) {
    throw new ImageValidationError('Unsupported PNG color type.');
  }

  // Exact bound on uncompressed scanline data to neutralize zlib bombs before inflateSync
  const rowPayloadBytes = Math.ceil((width * channels * bitDepth) / 8);
  const maxExpectedUncompressedBytes =
    interlace === 0
      ? height * (1 + rowPayloadBytes)
      : height * (1 + rowPayloadBytes) + height * 7;

  let inflated: Buffer;
  try {
    inflated = zlib.inflateSync(Buffer.concat(idatChunks), {
      maxOutputLength: Math.max(maxExpectedUncompressedBytes, 64),
    });
  } catch {
    throw new ImageValidationError('Corrupted or unsafe compressed PNG image data.');
  }

  if (interlace === 0 && inflated.length !== height * (1 + rowPayloadBytes)) {
    throw new ImageValidationError('PNG decoded image byte length does not match declared dimensions.');
  }

  return { width, height };
}

function isSofMarker(marker: number): boolean {
  if (marker < 0xc0 || marker > 0xcb) return false;
  // Exclude DHT (0xC4), JPG reserved (0xC8), DAC (0xCC)
  return marker !== 0xc4 && marker !== 0xc8;
}

function parseAndVerifyJpeg(bytes: Uint8Array): { width: number; height: number } {
  const buf = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) {
    throw new ImageValidationError('Invalid JPEG SOI header.');
  }

  let offset = 2;
  let width = 0;
  let height = 0;
  let sawSof = false;
  let sawSos = false;
  let sawEoi = false;

  while (offset < buf.length) {
    // Skip JPEG padding 0xFF bytes before marker code
    if (buf[offset] !== 0xff) {
      throw new ImageValidationError('Malformed JPEG marker structure.');
    }
    while (offset < buf.length && buf[offset] === 0xff) {
      offset += 1;
    }
    if (offset >= buf.length) {
      throw new ImageValidationError('Truncated JPEG marker.');
    }

    const marker = buf[offset]!;
    offset += 1;

    // Standalone markers without length
    if (marker === 0x00 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      continue;
    }
    if (marker === 0xd9) {
      sawEoi = true;
      if (offset !== buf.length) {
        throw new ImageValidationError('Unexpected trailing bytes after JPEG EOI.');
      }
      break;
    }

    if (offset + 2 > buf.length) {
      throw new ImageValidationError('Truncated JPEG segment length.');
    }
    const segmentLength = buf.readUInt16BE(offset);
    if (segmentLength < 2 || offset + segmentLength > buf.length) {
      throw new ImageValidationError('Truncated or corrupt JPEG segment.');
    }

    if (isSofMarker(marker)) {
      if (segmentLength < 8) {
        throw new ImageValidationError('Truncated JPEG SOF segment.');
      }
      height = buf.readUInt16BE(offset + 3);
      width = buf.readUInt16BE(offset + 5);
      const components = buf.readUInt8(offset + 7);
      if (components !== 1 && components !== 3 && components !== 4) {
        throw new ImageValidationError('Unsupported JPEG color component count.');
      }
      assertSafeDimensionBounds(width, height);
      sawSof = true;
    }

    offset += segmentLength;

    if (marker === 0xda) {
      sawSos = true;
      // Scan entropy-coded bitstream until terminating EOI marker (FF D9)
      while (offset < buf.length - 1) {
        if (buf[offset] === 0xff) {
          const next = buf[offset + 1]!;
          if (next === 0x00) {
            offset += 2;
            continue;
          }
          if (next === 0xd9) {
            sawEoi = true;
            offset += 2;
            break;
          }
          if (next === 0xff || (next >= 0xd0 && next <= 0xd7)) {
            offset += 2;
            continue;
          }
        }
        offset += 1;
      }
      if (!sawEoi || offset !== buf.length) {
        throw new ImageValidationError('Truncated or malformed JPEG image stream.');
      }
      break;
    }
  }

  if (!sawSof || !sawSos || !sawEoi) {
    throw new ImageValidationError('Incomplete or truncated JPEG image.');
  }

  return { width, height };
}

function parseAndVerifyWebp(bytes: Uint8Array): { width: number; height: number } {
  const buf = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (
    buf.length < 20 ||
    buf.toString('ascii', 0, 4) !== 'RIFF' ||
    buf.toString('ascii', 8, 12) !== 'WEBP'
  ) {
    throw new ImageValidationError('Invalid WebP RIFF header.');
  }

  const riffDeclaredSize = buf.readUInt32LE(4);
  if (riffDeclaredSize + 8 !== buf.length) {
    throw new ImageValidationError('Truncated or trailing-corrupted WebP container.');
  }

  let offset = 12;
  let width = 0;
  let height = 0;
  let foundDimensions = false;
  let foundBitstreamChunk = false;

  while (offset < buf.length) {
    if (offset + 8 > buf.length) {
      throw new ImageValidationError('Truncated WebP chunk header.');
    }
    const fourCc = buf.toString('ascii', offset, offset + 4);
    const chunkSize = buf.readUInt32LE(offset + 4);
    const dataStart = offset + 8;
    const dataEnd = dataStart + chunkSize;
    const paddedEnd = dataEnd + (chunkSize % 2);

    if (paddedEnd > buf.length) {
      throw new ImageValidationError(`Truncated WebP ${fourCc} chunk.`);
    }

    if (fourCc === 'VP8 ') {
      if (chunkSize < 10) {
        throw new ImageValidationError('Truncated WebP VP8 frame.');
      }
      // Check VP8 keyframe start code: 9D 01 2A at frame bytes 3..5
      if (
        buf[dataStart + 3] !== 0x9d ||
        buf[dataStart + 4] !== 0x01 ||
        buf[dataStart + 5] !== 0x2a
      ) {
        throw new ImageValidationError('Invalid WebP VP8 keyframe signature.');
      }
      if (!foundDimensions) {
        width = buf.readUInt16LE(dataStart + 6) & 0x3fff;
        height = buf.readUInt16LE(dataStart + 8) & 0x3fff;
        foundDimensions = true;
      }
      foundBitstreamChunk = true;
    } else if (fourCc === 'VP8L') {
      if (chunkSize < 5 || buf[dataStart] !== 0x2f) {
        throw new ImageValidationError('Invalid WebP VP8L header.');
      }
      const bits = buf.readUInt32LE(dataStart + 1);
      if (!foundDimensions) {
        width = (bits & 0x3fff) + 1;
        height = ((bits >> 14) & 0x3fff) + 1;
        foundDimensions = true;
      }
      foundBitstreamChunk = true;
    } else if (fourCc === 'VP8X') {
      if (chunkSize < 10) {
        throw new ImageValidationError('Truncated WebP VP8X header.');
      }
      width = 1 + (buf[dataStart + 4]! | (buf[dataStart + 5]! << 8) | (buf[dataStart + 6]! << 16));
      height = 1 + (buf[dataStart + 7]! | (buf[dataStart + 8]! << 8) | (buf[dataStart + 9]! << 16));
      foundDimensions = true;
    }

    offset = paddedEnd;
  }

  if (!foundDimensions || !foundBitstreamChunk || offset !== buf.length) {
    throw new ImageValidationError('Incomplete or unsupported WebP image.');
  }

  assertSafeDimensionBounds(width, height);
  return { width, height };
}

function detectMimeFromMagicBytes(bytes: Uint8Array): MemberPhotoMimeType | null {
  if (hasPrefix(bytes, PNG_SIGNATURE)) {
    return 'image/png';
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return 'image/webp';
  }
  return null;
}

/**
 * Validates an untrusted binary upload as JPEG, PNG, or WebP and extracts safe dimensions.
 */
export function validateUploadedMemberPhoto(input: {
  bytes: Uint8Array;
  declaredMimeType?: string;
  filename?: string;
}): ValidatedMemberPhoto {
  const { bytes, declaredMimeType, filename } = input;

  if (bytes.byteLength < MIN_MEMBER_PHOTO_BYTES) {
    throw new ImageValidationError('Uploaded image file is empty or truncated.');
  }
  if (bytes.byteLength > MAX_MEMBER_PHOTO_BYTES) {
    throw new ImageValidationError(
      `Uploaded photo exceeds the maximum allowed size (${MAX_MEMBER_PHOTO_BYTES / (1024 * 1024)} MB).`,
      'FILE_TOO_LARGE'
    );
  }

  rejectDangerousSignatures(bytes);

  const detectedMime = detectMimeFromMagicBytes(bytes);
  if (!detectedMime) {
    throw new ImageValidationError(
      'Unsupported image format. Only JPEG, PNG, and WebP photographs are allowed.',
      'UNSUPPORTED_FILE_TYPE'
    );
  }

  assertDeclaredMimeMatches(declaredMimeType, detectedMime);
  assertSafeFilename(filename, detectedMime);

  let dimensions: { width: number; height: number };
  if (detectedMime === 'image/png') {
    dimensions = parseAndVerifyPng(bytes);
  } else if (detectedMime === 'image/jpeg') {
    dimensions = parseAndVerifyJpeg(bytes);
  } else {
    dimensions = parseAndVerifyWebp(bytes);
  }

  return {
    bytes,
    mimeType: detectedMime,
    extension: MIME_TO_CANONICAL_EXT[detectedMime],
    width: dimensions.width,
    height: dimensions.height,
    byteSize: bytes.byteLength,
  };
}

