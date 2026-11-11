import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import { processUploadedMemberPhoto } from './image-processor';
import { ImageValidationError } from './image-validator';
import {
  createOversizedDimensionPngHeader,
  createSyntheticExifGpsJpeg,
  createSyntheticMetadataPng,
  createSyntheticMetadataWebp,
} from '@/test/synthetic-images';

describe('Member Photo EXIF Stripping, Orientation & Safe Re-encoding', () => {
  it('strips EXIF, GPS coordinates, XMP, and JPEG COM comments while producing valid re-encoded JPEG', async () => {
    const dirtyJpeg = await createSyntheticExifGpsJpeg({
      width: 24,
      height: 16,
      orientation: '1',
    });

    const inputText = Buffer.from(dirtyJpeg).toString('latin1');
    expect(inputText).toContain('SyntheticCam');
    expect(inputText).toContain('SecretGPSLocation');
    expect(inputText).toContain('HiddenAuthor');

    const processed = await processUploadedMemberPhoto({
      bytes: dirtyJpeg,
      declaredMimeType: 'image/jpeg',
      filename: 'camera-gps.jpg',
    });

    expect(processed.processed).toBe(true);
    expect(processed.mimeType).toBe('image/jpeg');
    expect(processed.extension).toBe('jpg');
    expect(processed.width).toBe(24);
    expect(processed.height).toBe(16);
    expect(Buffer.from(processed.bytes)).not.toEqual(Buffer.from(dirtyJpeg));

    const outMeta = await sharp(Buffer.from(processed.bytes)).metadata();
    expect(outMeta.format).toBe('jpeg');
    expect(outMeta.exif).toBeUndefined();
    expect(outMeta.iptc).toBeUndefined();
    expect(outMeta.xmp).toBeUndefined();
    expect(outMeta.icc).toBeUndefined();
    expect(outMeta.comments).toBeUndefined();
    expect(outMeta.orientation).toBeUndefined();

    const outputText = Buffer.from(processed.bytes).toString('latin1');
    expect(outputText).not.toContain('SyntheticCam');
    expect(outputText).not.toContain('SecretGPSLocation');
    expect(outputText).not.toContain('HiddenAuthor');
    expect(outputText).not.toContain('http://ns.adobe.com/xap');
  });

  it('bakes EXIF orientation into pixel dimensions and clears orientation tag cleanly', async () => {
    // 24x12 pixels with EXIF orientation 6 (90 deg CW) -> upright output must be 12x24
    const rotatedJpeg = await createSyntheticExifGpsJpeg({
      width: 24,
      height: 12,
      orientation: '6',
    });

    const processed = await processUploadedMemberPhoto({
      bytes: rotatedJpeg,
      declaredMimeType: 'image/jpeg',
      filename: 'portrait-exif6.jpg',
    });

    expect(processed.width).toBe(12);
    expect(processed.height).toBe(24);

    const outMeta = await sharp(Buffer.from(processed.bytes)).metadata();
    expect(outMeta.width).toBe(12);
    expect(outMeta.height).toBe(24);
    expect(outMeta.exif).toBeUndefined();
    expect(outMeta.orientation).toBeUndefined();
  });

  it('strips PNG and WebP metadata chunks while preserving alpha transparency and visual pixel fidelity', async () => {
    const dirtyPng = await createSyntheticMetadataPng(12, 10);
    const pngProcessed = await processUploadedMemberPhoto({
      bytes: dirtyPng,
      declaredMimeType: 'image/png',
      filename: 'alpha.png',
    });

    expect(pngProcessed.mimeType).toBe('image/png');
    expect(pngProcessed.width).toBe(12);
    expect(pngProcessed.height).toBe(10);
    const pngMeta = await sharp(Buffer.from(pngProcessed.bytes)).metadata();
    expect(pngMeta.hasAlpha).toBe(true);
    expect(pngMeta.exif).toBeUndefined();
    expect(Buffer.from(pngProcessed.bytes).toString('latin1')).not.toContain(
      'SyntheticPrivateUserComment'
    );

    const pngRaw = await sharp(Buffer.from(pngProcessed.bytes)).raw().toBuffer();
    // Pixel (0, 0) had alpha 128 in generator
    expect(pngRaw[3]).toBe(128);
    expect(pngRaw[7]).toBe(255);

    const dirtyWebp = await createSyntheticMetadataWebp(16, 12);
    const webpProcessed = await processUploadedMemberPhoto({
      bytes: dirtyWebp,
      declaredMimeType: 'image/webp',
      filename: 'alpha.webp',
    });

    expect(webpProcessed.mimeType).toBe('image/webp');
    expect(webpProcessed.width).toBe(16);
    expect(webpProcessed.height).toBe(12);
    const webpMeta = await sharp(Buffer.from(webpProcessed.bytes)).metadata();
    expect(webpMeta.hasAlpha).toBe(true);
    expect(webpMeta.exif).toBeUndefined();
    expect(Buffer.from(webpProcessed.bytes).toString('latin1')).not.toContain(
      'WebpSyntheticCam'
    );
  });

  it('rejects oversized dimensions, pixel bombs, and un-decodable corrupt payloads before storage', async () => {
    await expect(
      processUploadedMemberPhoto({
        bytes: createOversizedDimensionPngHeader(6001, 100),
        declaredMimeType: 'image/png',
        filename: 'too-wide.png',
      })
    ).rejects.toThrow(ImageValidationError);

    await expect(
      processUploadedMemberPhoto({
        bytes: createOversizedDimensionPngHeader(5500, 5500),
        declaredMimeType: 'image/png',
        filename: 'pixel-bomb.png',
      })
    ).rejects.toThrow(ImageValidationError);

    // Corrupted non-decodable image claiming JPEG
    const garbageJpg = Buffer.from([
      0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x08, 0x00, 0x08, 0x03,
      0x01, 0x11, 0x00, 0x02, 0x11, 0x00, 0x03, 0x11, 0x00,
      0xff, 0xda, 0x00, 0x0c, 0x03, 0x01, 0x00, 0x02, 0x00, 0x03, 0x00, 0x00, 0x3f, 0x00,
      0x7f, 0x00, 0xff, 0xd9,
    ]);
    await expect(
      processUploadedMemberPhoto({
        bytes: garbageJpg,
        declaredMimeType: 'image/jpeg',
        filename: 'undecodable.jpg',
      })
    ).rejects.toThrow(ImageValidationError);
  });
});

