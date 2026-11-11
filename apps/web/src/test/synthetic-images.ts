/**
 * Deterministic synthetic image generators for unit and integration tests.
 * Generates minimal valid binary PNG, JPEG, and WebP containers (zero real photos).
 */

import zlib from 'node:zlib';

function makePngChunk(type: string, data: Buffer): Buffer {
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcInput = Buffer.concat([typeBuf, data]);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(zlib.crc32(crcInput) >>> 0, 0);
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

export function createSyntheticPng(width: number = 4, height: number = 4): Uint8Array {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // non-interlaced

  const rawScanlines = Buffer.alloc(height * (1 + width * 4), 0x80);
  for (let y = 0; y < height; y += 1) {
    rawScanlines[y * (1 + width * 4)] = 0; // filter type None
  }
  const compressed = zlib.deflateSync(rawScanlines);

  return Buffer.concat([
    sig,
    makePngChunk('IHDR', ihdr),
    makePngChunk('IDAT', compressed),
    makePngChunk('IEND', Buffer.alloc(0)),
  ]);
}

/**
 * Crafts a structurally valid PNG header claiming large dimensions (for decompression/dimension limit tests)
 * without allocating huge uncompressed pixel buffers.
 */
export function createOversizedDimensionPngHeader(width: number, height: number): Uint8Array {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2; // RGB
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  return Buffer.concat([
    sig,
    makePngChunk('IHDR', ihdr),
    makePngChunk('IDAT', zlib.deflateSync(Buffer.from([0, 1, 2, 3]))),
    makePngChunk('IEND', Buffer.alloc(0)),
  ]);
}

export function createSyntheticJpeg(width: number = 8, height: number = 8): Uint8Array {
  const soi = Buffer.from([0xff, 0xd8]);
  // APP0 JFIF
  const app0 = Buffer.from([
    0xff, 0xe0, 0x00, 0x10,
    0x4a, 0x46, 0x49, 0x46, 0x00,
    0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00,
  ]);
  // SOF0 baseline DCT
  const sof0 = Buffer.alloc(19);
  sof0[0] = 0xff;
  sof0[1] = 0xc0;
  sof0.writeUInt16BE(17, 2); // segment length (8 + 3*3)
  sof0[4] = 8; // precision
  sof0.writeUInt16BE(height, 5);
  sof0.writeUInt16BE(width, 7);
  sof0[9] = 3; // components YCbCr
  sof0[10] = 1; sof0[11] = 0x11; sof0[12] = 0;
  sof0[13] = 2; sof0[14] = 0x11; sof0[15] = 0;
  sof0[16] = 3; sof0[17] = 0x11; sof0[18] = 0;

  // SOS + minimal entropy bytes + EOI
  const sos = Buffer.from([
    0xff, 0xda, 0x00, 0x0c,
    0x03, 0x01, 0x00, 0x02, 0x00, 0x03, 0x00,
    0x00, 0x3f, 0x00,
    0x7f, 0x00, // dummy entropy stream bytes
    0xff, 0xd9, // EOI
  ]);

  return Buffer.concat([soi, app0, sof0, sos]);
}

export function createSyntheticWebp(width: number = 8, height: number = 8): Uint8Array {
  // Minimal valid lossless VP8L chunk
  const wBits = (width - 1) & 0x3fff;
  const hBits = (height - 1) & 0x3fff;
  const packed = (wBits | (hBits << 14)) >>> 0;
  const vp8lPayload = Buffer.alloc(8);
  vp8lPayload[0] = 0x2f; // VP8L signature byte
  vp8lPayload.writeUInt32LE(packed, 1);
  vp8lPayload[5] = 0x00;
  vp8lPayload[6] = 0x00;
  vp8lPayload[7] = 0x00;

  const chunkHeader = Buffer.alloc(8);
  chunkHeader.write('VP8L', 0, 'ascii');
  chunkHeader.writeUInt32LE(vp8lPayload.length, 4);

  const webpTag = Buffer.from('WEBP', 'ascii');
  const riffSize = webpTag.length + chunkHeader.length + vp8lPayload.length;
  const riffHeader = Buffer.alloc(8);
  riffHeader.write('RIFF', 0, 'ascii');
  riffHeader.writeUInt32LE(riffSize, 4);

  return Buffer.concat([riffHeader, webpTag, chunkHeader, vp8lPayload]);
}

