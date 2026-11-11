import { describe, it, expect } from 'vitest';
import { MAX_MEMBER_PHOTO_BYTES } from '@crelune/shared';
import {
  ImageValidationError,
  validateUploadedMemberPhoto,
} from './image-validator';
import {
  createOversizedDimensionPngHeader,
  createSyntheticJpeg,
  createSyntheticPng,
  createSyntheticWebp,
} from '@/test/synthetic-images';

describe('Member Photo Image Security Validator', () => {
  it('accepts valid synthetic JPEG, PNG, and WebP photos with exact MIME and extension', () => {
    const png = validateUploadedMemberPhoto({
      bytes: createSyntheticPng(12, 10),
      declaredMimeType: 'image/png',
      filename: 'portrait.png',
    });
    expect(png.mimeType).toBe('image/png');
    expect(png.extension).toBe('png');
    expect(png.width).toBe(12);
    expect(png.height).toBe(10);

    const jpg = validateUploadedMemberPhoto({
      bytes: createSyntheticJpeg(24, 18),
      declaredMimeType: 'image/jpeg',
      filename: 'portrait.jpeg',
    });
    expect(jpg.mimeType).toBe('image/jpeg');
    expect(jpg.extension).toBe('jpg');
    expect(jpg.width).toBe(24);
    expect(jpg.height).toBe(18);

    const webp = validateUploadedMemberPhoto({
      bytes: createSyntheticWebp(32, 16),
      declaredMimeType: 'image/webp',
      filename: 'portrait.webp',
    });
    expect(webp.mimeType).toBe('image/webp');
    expect(webp.extension).toBe('webp');
    expect(webp.width).toBe(32);
    expect(webp.height).toBe(16);
  });

  it('rejects spoofed MIME types and mismatched or executable file extensions', () => {
    const pngBytes = createSyntheticPng(4, 4);

    // PNG bytes claiming image/jpeg
    expect(() =>
      validateUploadedMemberPhoto({
        bytes: pngBytes,
        declaredMimeType: 'image/jpeg',
        filename: 'photo.png',
      })
    ).toThrow(ImageValidationError);

    // JPEG bytes with .png extension
    expect(() =>
      validateUploadedMemberPhoto({
        bytes: createSyntheticJpeg(8, 8),
        declaredMimeType: 'image/jpeg',
        filename: 'photo.png',
      })
    ).toThrow(/extension does not match/i);

    // Valid PNG with .exe extension
    expect(() =>
      validateUploadedMemberPhoto({
        bytes: pngBytes,
        declaredMimeType: 'image/png',
        filename: 'payload.exe',
      })
    ).toThrow(/extension does not match/i);
  });

  it('rejects SVG, XML, HTML, and executable payloads even when disguised as images', () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    expect(() =>
      validateUploadedMemberPhoto({
        bytes: svg,
        declaredMimeType: 'image/jpeg',
        filename: 'disguised.jpg',
      })
    ).toThrow(/SVG, XML, and HTML/i);

    const bomSvg = Buffer.concat([
      Buffer.from([0xef, 0xbb, 0xbf]),
      Buffer.from('  <?xml version="1.0"?><svg></svg>'),
    ]);
    expect(() =>
      validateUploadedMemberPhoto({
        bytes: bomSvg,
        declaredMimeType: 'image/png',
        filename: 'disguised.png',
      })
    ).toThrow(/SVG, XML, and HTML/i);

    const peBinary = Buffer.concat([Buffer.from('MZ'), Buffer.alloc(32, 0)]);
    expect(() =>
      validateUploadedMemberPhoto({
        bytes: peBinary,
        declaredMimeType: 'image/jpeg',
        filename: 'binary.jpg',
      })
    ).toThrow(/Executable files/i);
  });

  it('rejects malformed, corrupted, and truncated JPEG/PNG/WebP images', () => {
    const png = Buffer.from(createSyntheticPng(8, 8));
    // Truncated PNG (missing IEND)
    expect(() =>
      validateUploadedMemberPhoto({
        bytes: png.subarray(0, png.length - 6),
        declaredMimeType: 'image/png',
        filename: 'truncated.png',
      })
    ).toThrow(ImageValidationError);

    // Corrupt PNG CRC
    const badCrcPng = Buffer.from(png);
    badCrcPng[badCrcPng.length - 1] ^= 0xff;
    expect(() =>
      validateUploadedMemberPhoto({
        bytes: badCrcPng,
        declaredMimeType: 'image/png',
        filename: 'badcrc.png',
      })
    ).toThrow(/Corrupted PNG CRC/i);

    // Truncated JPEG (missing EOI)
    const jpg = Buffer.from(createSyntheticJpeg(8, 8));
    expect(() =>
      validateUploadedMemberPhoto({
        bytes: jpg.subarray(0, jpg.length - 2),
        declaredMimeType: 'image/jpeg',
        filename: 'truncated.jpg',
      })
    ).toThrow(ImageValidationError);

    // Truncated WebP
    const webp = Buffer.from(createSyntheticWebp(8, 8));
    expect(() =>
      validateUploadedMemberPhoto({
        bytes: webp.subarray(0, webp.length - 3),
        declaredMimeType: 'image/webp',
        filename: 'truncated.webp',
      })
    ).toThrow(/Truncated/i);
  });

  it('rejects oversized uploads (>10 MB), excessive dimensions, decompression bombs, and path-traversal filenames', () => {
    // >10 MB payload
    const tooLarge = new Uint8Array(MAX_MEMBER_PHOTO_BYTES + 1);
    tooLarge[0] = 0xff;
    tooLarge[1] = 0xd8;
    tooLarge[2] = 0xff;
    expect(() =>
      validateUploadedMemberPhoto({
        bytes: tooLarge,
        declaredMimeType: 'image/jpeg',
        filename: 'huge.jpg',
      })
    ).toThrow(/maximum allowed size/i);

    // Excessive width/height in PNG IHDR (rejected before pixel allocation/inflation)
    expect(() =>
      validateUploadedMemberPhoto({
        bytes: createOversizedDimensionPngHeader(6001, 100),
        declaredMimeType: 'image/png',
        filename: 'wide.png',
      })
    ).toThrow(/dimensions exceed/i);

    // Pixel-count bomb (5500 x 5500 = 30.25M > 25M max pixels)
    expect(() =>
      validateUploadedMemberPhoto({
        bytes: createOversizedDimensionPngHeader(5500, 5500),
        declaredMimeType: 'image/png',
        filename: 'bomb.png',
      })
    ).toThrow(/pixel count exceeds/i);

    // Excessive dimensions in JPEG SOF0 & WebP VP8L
    expect(() =>
      validateUploadedMemberPhoto({
        bytes: createSyntheticJpeg(7000, 200),
        declaredMimeType: 'image/jpeg',
        filename: 'wide.jpg',
      })
    ).toThrow(/dimensions exceed/i);

    expect(() =>
      validateUploadedMemberPhoto({
        bytes: createSyntheticWebp(6500, 100),
        declaredMimeType: 'image/webp',
        filename: 'wide.webp',
      })
    ).toThrow(/dimensions exceed/i);

    // Path traversal filenames
    for (const evilName of [
      '../secret.png',
      '..\\..\\secret.png',
      'sub/dir/photo.png',
      '%2e%2e/photo.png',
    ]) {
      expect(() =>
        validateUploadedMemberPhoto({
          bytes: createSyntheticPng(4, 4),
          declaredMimeType: 'image/png',
          filename: evilName,
        })
      ).toThrow(/path traversal/i);
    }
  });
});

