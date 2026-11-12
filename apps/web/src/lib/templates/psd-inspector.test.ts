import { describe, expect, it } from 'vitest';
import {
  MAX_PSD_DIMENSION_PX,
  PSD_HEADER_MIN_BYTES,
  PsdInspectionError,
  validatePsdHeader,
} from './psd-inspector';

function buildMinimalPsdHeader(params: {
  width: number;
  height: number;
  version?: number;
  extraBytes?: number;
}): Uint8Array {
  const totalBytes = PSD_HEADER_MIN_BYTES + (params.extraBytes ?? 0);
  const buffer = new Uint8Array(totalBytes);
  const view = new DataView(buffer.buffer);
  // Signature "8BPS"
  buffer[0] = 0x38;
  buffer[1] = 0x42;
  buffer[2] = 0x50;
  buffer[3] = 0x53;
  // Version (1 = PSD, 2 = PSB)
  view.setUint16(4, params.version ?? 1, false);
  // Channels = 3, Height, Width, Depth = 8, ColorMode = 3 (RGB)
  view.setUint16(12, 3, false);
  view.setUint32(14, params.height, false);
  view.setUint32(18, params.width, false);
  view.setUint16(22, 8, false);
  view.setUint16(24, 3, false);
  return buffer;
}

describe('validatePsdHeader (Stage 5.2.2 Safe Fallback)', () => {
  it('validates a minimal PSD v1 header and returns dimensions with editabilityVerified=false', () => {
    const psd = buildMinimalPsdHeader({
      width: 1080,
      height: 1350,
      extraBytes: 64,
    });

    const result = validatePsdHeader(psd);
    expect(result).toEqual({
      version: 1,
      widthPx: 1080,
      heightPx: 1350,
      editabilityVerified: false,
    });
  });

  it('rejects truncated buffers and non-8BPS headers with INVALID_PSD_HEADER', () => {
    expect(() => validatePsdHeader(new Uint8Array(10))).toThrowError(
      PsdInspectionError
    );

    try {
      validatePsdHeader(new Uint8Array(10));
    } catch (err) {
      expect(err).toMatchObject({ code: 'INVALID_PSD_HEADER' });
    }

    const fakePng = new Uint8Array([0x89, 0x50, 0x4e, 0x47, ...new Array(30).fill(0)]);
    try {
      validatePsdHeader(fakePng);
      expect.unreachable('Expected INVALID_PSD_HEADER');
    } catch (err) {
      expect(err).toMatchObject({
        name: 'PsdInspectionError',
        code: 'INVALID_PSD_HEADER',
      });
    }
  });

  it('rejects unsupported PSD versions (e.g. PSB v2 or v0) with UNSUPPORTED_PSD_VERSION', () => {
    for (const version of [0, 2, 99]) {
      const buf = buildMinimalPsdHeader({ width: 500, height: 500, version });
      try {
        validatePsdHeader(buf);
        expect.unreachable(`Expected UNSUPPORTED_PSD_VERSION for version ${version}`);
      } catch (err) {
        expect(err).toMatchObject({
          name: 'PsdInspectionError',
          code: 'UNSUPPORTED_PSD_VERSION',
        });
      }
    }
  });

  it('rejects zero or out-of-bounds dimensions with PSD_DIMENSIONS_INVALID', () => {
    const cases = [
      { width: 0, height: 100 },
      { width: 100, height: 0 },
      { width: MAX_PSD_DIMENSION_PX + 1, height: 100 },
      { width: 100, height: MAX_PSD_DIMENSION_PX + 1 },
    ];

    for (const dims of cases) {
      const buf = buildMinimalPsdHeader(dims);
      try {
        validatePsdHeader(buf);
        expect.unreachable(`Expected PSD_DIMENSIONS_INVALID for ${dims.width}x${dims.height}`);
      } catch (err) {
        expect(err).toMatchObject({
          name: 'PsdInspectionError',
          code: 'PSD_DIMENSIONS_INVALID',
        });
      }
    }
  });

  it('rejects PSD buffers exceeding maxFileBytes with PSD_SIZE_EXCEEDED', () => {
    const buf = buildMinimalPsdHeader({ width: 100, height: 100, extraBytes: 32 });
    try {
      validatePsdHeader(buf, 16);
      expect.unreachable('Expected PSD_SIZE_EXCEEDED');
    } catch (err) {
      expect(err).toMatchObject({
        name: 'PsdInspectionError',
        code: 'PSD_SIZE_EXCEEDED',
      });
    }
  });
});
