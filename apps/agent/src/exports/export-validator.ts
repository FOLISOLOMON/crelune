/**
 * CRELUNE Windows Creative Agent — Local Export Deliverable Validator
 *
 * Verifies every export strictly inside `workspaces/jobs/<jobId>/exports/`
 * before requesting an upload intent from CRELUNE:
 * - Rejects traversal or files outside the job's `exports/` directory.
 * - Verifies file exists, non-empty, <= 50 MB limit.
 * - Validates PNG (`89 50 4E 47` + IHDR dimensions), JPEG (`FF D8 FF` + SOF dimensions),
 *   or PDF (`%PDF-` + `%%EOF`).
 * - Computes SHA-256 and asserts original master template SHA-256 is untouched.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import {
  CREATIVE_BYTE_LIMITS,
  type ExportFileFormat,
} from '@crelune/shared';
import {
  assertSafeAgentIdentifier,
  assertSafeBasename,
  resolveStrictlyWithinRoot,
} from '../security/path-safety.js';
import {
  computeSha256Hex,
  verifyMasterTemplateIntegrity,
} from '../workspace/job-workspace.js';

export interface ValidatedLocalExport {
  filePath: string;
  filename: string;
  format: ExportFileFormat;
  mimeType: string;
  bytes: Uint8Array;
  byteSize: number;
  sha256: string;
  widthPx: number | null;
  heightPx: number | null;
}

function parsePngDimensions(bytes: Uint8Array): { widthPx: number; heightPx: number } {
  if (
    bytes.byteLength < 24 ||
    bytes[0] !== 0x89 ||
    bytes[1] !== 0x50 ||
    bytes[2] !== 0x4e ||
    bytes[3] !== 0x47 ||
    bytes[4] !== 0x0d ||
    bytes[5] !== 0x0a ||
    bytes[6] !== 0x1a ||
    bytes[7] !== 0x0a
  ) {
    throw new Error('Export file does not have a valid PNG signature.');
  }
  const chunkType = Buffer.from(bytes.subarray(12, 16)).toString('ascii');
  if (chunkType !== 'IHDR') {
    throw new Error('PNG export is missing leading IHDR chunk.');
  }
  const buf = Buffer.from(bytes);
  const widthPx = buf.readUInt32BE(16);
  const heightPx = buf.readUInt32BE(20);
  if (widthPx < 1 || heightPx < 1 || widthPx > 30000 || heightPx > 30000) {
    throw new Error('PNG export dimensions are out of valid bounds.');
  }
  return { widthPx, heightPx };
}

function parseJpegDimensions(
  bytes: Uint8Array
): { widthPx: number | null; heightPx: number | null } {
  if (
    bytes.byteLength < 4 ||
    bytes[0] !== 0xff ||
    bytes[1] !== 0xd8 ||
    bytes[2] !== 0xff
  ) {
    throw new Error('Export file does not have a valid JPEG signature.');
  }

  let offset = 2;
  while (offset + 4 < bytes.byteLength) {
    if (bytes[offset] !== 0xff) break;
    const marker = bytes[offset + 1]!;
    offset += 2;
    if (marker === 0xd9 || marker === 0xda) break;
    if (offset + 2 > bytes.byteLength) break;
    const segLen = (bytes[offset]! << 8) | bytes[offset + 1]!;
    if (segLen < 2 || offset + segLen > bytes.byteLength) break;

    const isSof =
      (marker >= 0xc0 && marker <= 0xc3) ||
      (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) ||
      (marker >= 0xcd && marker <= 0xcf);
    if (isSof && segLen >= 7) {
      const heightPx = (bytes[offset + 3]! << 8) | bytes[offset + 4]!;
      const widthPx = (bytes[offset + 5]! << 8) | bytes[offset + 6]!;
      if (widthPx >= 1 && heightPx >= 1 && widthPx <= 30000 && heightPx <= 30000) {
        return { widthPx, heightPx };
      }
    }
    offset += segLen;
  }

  return { widthPx: null, heightPx: null };
}

function validatePdfBytes(bytes: Uint8Array): void {
  if (bytes.byteLength < 10) {
    throw new Error('PDF export is too small to be valid.');
  }
  const header = Buffer.from(bytes.subarray(0, 5)).toString('ascii');
  if (header !== '%PDF-') {
    throw new Error('Export file does not start with %PDF-.');
  }
  const tail = Buffer.from(
    bytes.subarray(Math.max(0, bytes.byteLength - 2048))
  ).toString('latin1');
  if (!tail.includes('%%EOF')) {
    throw new Error('PDF export is missing %%EOF trailer.');
  }
}

export async function validateLocalExportDeliverable(params: {
  workspaceRoot: string;
  jobId: string;
  exportFilename: string;
  masterSourcePath?: string;
  expectedMasterSha256?: string;
}): Promise<ValidatedLocalExport> {
  const safeJobId = assertSafeAgentIdentifier(params.jobId, 'jobId');
  const safeFilename = assertSafeBasename(
    params.exportFilename,
    'export filename'
  );

  const exportsDir = resolveStrictlyWithinRoot(
    path.resolve(params.workspaceRoot),
    'jobs',
    safeJobId,
    'exports'
  );
  const filePath = resolveStrictlyWithinRoot(exportsDir, safeFilename);

  const stat = await fs.stat(filePath);
  if (!stat.isFile()) {
    throw new Error('Export path is not a regular file.');
  }
  if (
    stat.size === 0 ||
    stat.size > CREATIVE_BYTE_LIMITS.EXPORT_DELIVERABLE_MAX_BYTES
  ) {
    throw new Error(
      `Export file size (${stat.size} bytes) must be between 1 byte and ${CREATIVE_BYTE_LIMITS.EXPORT_DELIVERABLE_MAX_BYTES} bytes.`
    );
  }

  const lower = safeFilename.toLowerCase();
  let format: ExportFileFormat;
  let mimeType: string;
  if (lower.endsWith('.png')) {
    format = 'PNG';
    mimeType = 'image/png';
  } else if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) {
    format = 'JPEG';
    mimeType = 'image/jpeg';
  } else if (lower.endsWith('.pdf')) {
    format = 'PDF';
    mimeType = 'application/pdf';
  } else {
    throw new Error(
      'Unsupported export extension. Allowed deliverables are .png, .jpg, .jpeg, or .pdf.'
    );
  }

  const bytes = new Uint8Array(await fs.readFile(filePath));
  let widthPx: number | null = null;
  let heightPx: number | null = null;

  if (format === 'PNG') {
    const dims = parsePngDimensions(bytes);
    widthPx = dims.widthPx;
    heightPx = dims.heightPx;
  } else if (format === 'JPEG') {
    const dims = parseJpegDimensions(bytes);
    widthPx = dims.widthPx;
    heightPx = dims.heightPx;
  } else {
    validatePdfBytes(bytes);
  }

  // Re-verify original master template was NEVER modified before registering export
  if (params.masterSourcePath && params.expectedMasterSha256) {
    const integrity = await verifyMasterTemplateIntegrity({
      masterSourcePath: params.masterSourcePath,
      expectedSha256: params.expectedMasterSha256,
    });
    if (!integrity.ok) {
      throw new Error(
        'Master template integrity check failed before export registration. Refusing to report export.'
      );
    }
  }

  const sha256 = computeSha256Hex(bytes);

  return {
    filePath,
    filename: safeFilename,
    format,
    mimeType,
    bytes,
    byteSize: bytes.byteLength,
    sha256,
    widthPx,
    heightPx,
  };
}
