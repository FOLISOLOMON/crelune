/**
 * CRELUNE — Minimal Bounded PSD Header Validator (Stage 5.2.2 Safe Fallback)
 *
 * Automatic PSD layer parsing is disabled in production workflows.
 * Uploaded PSD files undergo only minimal, bounded 26-byte header validation:
 *  - File size <= 100 MB (CREATIVE_BYTE_LIMITS.TEMPLATE_MASTER_MAX_BYTES)
 *  - Adobe PSD magic signature ("8BPS")
 *  - Standard PSD v1 format (version === 1; PSB v2 rejected)
 *  - Valid canvas dimensions (1..30,000px)
 *
 * Layer inspection and field mapping must be completed manually in Affinity.
 */

import { CREATIVE_BYTE_LIMITS } from '@crelune/shared';

export const MAX_PSD_DIMENSION_PX = 30_000;
export const PSD_HEADER_MIN_BYTES = 26;

export type PsdInspectionErrorCode =
  | 'INVALID_PSD_HEADER'
  | 'UNSUPPORTED_PSD_VERSION'
  | 'PSD_SIZE_EXCEEDED'
  | 'PSD_DIMENSIONS_INVALID';

export class PsdInspectionError extends Error {
  constructor(
    message: string,
    public readonly code: PsdInspectionErrorCode
  ) {
    super(message);
    this.name = 'PsdInspectionError';
  }
}

export interface PsdHeaderValidationResult {
  version: 1;
  widthPx: number;
  heightPx: number;
  editabilityVerified: false;
}

export function validatePsdHeader(
  buffer: Uint8Array,
  maxFileBytes: number = CREATIVE_BYTE_LIMITS.TEMPLATE_MASTER_MAX_BYTES
): PsdHeaderValidationResult {
  if (buffer.byteLength > maxFileBytes) {
    throw new PsdInspectionError(
      `PSD file exceeds maximum allowed size of ${maxFileBytes} bytes.`,
      'PSD_SIZE_EXCEEDED'
    );
  }
  if (buffer.byteLength < PSD_HEADER_MIN_BYTES) {
    throw new PsdInspectionError(
      'File is too small to be a valid Adobe PSD document.',
      'INVALID_PSD_HEADER'
    );
  }

  // Adobe PSD magic signature: "8BPS"
  if (
    buffer[0] !== 0x38 ||
    buffer[1] !== 0x42 ||
    buffer[2] !== 0x50 ||
    buffer[3] !== 0x53
  ) {
    throw new PsdInspectionError(
      'Uploaded file does not have a valid Adobe PSD (8BPS) header.',
      'INVALID_PSD_HEADER'
    );
  }

  const view = new DataView(buffer.buffer, buffer.byteOffset, PSD_HEADER_MIN_BYTES);
  const version = view.getUint16(4, false);
  if (version !== 1) {
    throw new PsdInspectionError(
      `Unsupported PSD format version (${version}); only standard PSD v1 is supported.`,
      'UNSUPPORTED_PSD_VERSION'
    );
  }

  const height = view.getUint32(14, false);
  const width = view.getUint32(18, false);
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0 ||
    width > MAX_PSD_DIMENSION_PX ||
    height > MAX_PSD_DIMENSION_PX
  ) {
    throw new PsdInspectionError(
      `PSD dimensions (${width}x${height}) are outside permitted bounds (1-${MAX_PSD_DIMENSION_PX}px).`,
      'PSD_DIMENSIONS_INVALID'
    );
  }

  return {
    version: 1,
    widthPx: width,
    heightPx: height,
    editabilityVerified: false,
  };
}
