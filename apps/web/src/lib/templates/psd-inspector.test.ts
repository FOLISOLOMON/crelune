import { describe, expect, it } from 'vitest';
import {
  defaultPsdLayerInspector,
  PSD_INSPECTOR_ENGINE_ID,
  PsdInspectionError,
  WebtoonPsdLayerInspector,
} from './psd-inspector';

interface SyntheticLayerSpec {
  kind: 'layer' | 'group_open' | 'group_close';
  name: string;
  hidden?: boolean;
  top?: number;
  left?: number;
  bottom?: number;
  right?: number;
}

function writePascalStringPadded4(name: string): Uint8Array {
  const nameBytes = new TextEncoder().encode(name.slice(0, 255));
  const rawLen = 1 + nameBytes.length;
  const paddedLen = Math.ceil(rawLen / 4) * 4;
  const buf = new Uint8Array(paddedLen);
  buf[0] = nameBytes.length;
  buf.set(nameBytes, 1);
  return buf;
}

function buildSyntheticPsdBuffer(options: {
  width: number;
  height: number;
  version?: number;
  layers?: SyntheticLayerSpec[];
}): Uint8Array {
  const width = options.width;
  const height = options.height;
  const version = options.version ?? 1;
  const layers = options.layers ?? [];

  // 26-byte header
  const header = new Uint8Array(26);
  const hv = new DataView(header.buffer);
  header.set([0x38, 0x42, 0x50, 0x53], 0); // "8BPS"
  hv.setUint16(4, version, false); // version
  hv.setUint16(12, 4, false); // channels = 4 (RGBA)
  hv.setUint32(14, height, false);
  hv.setUint32(18, width, false);
  hv.setUint16(22, 8, false); // depth = 8
  hv.setUint16(24, 3, false); // color mode = RGB

  // Color Mode Data (4 bytes: length 0) + Image Resources (4 bytes: length 0)
  const emptySections = new Uint8Array(8);

  // Layer and Mask Information section
  const layerRecords: Uint8Array[] = [];
  const channelImageDatas: Uint8Array[] = [];

  for (const spec of layers) {
    const top = spec.top ?? 0;
    const left = spec.left ?? 0;
    const bottom = spec.bottom ?? 0;
    const right = spec.right ?? 0;

    const pascalName = writePascalStringPadded4(spec.name);
    const addlBlocks: Uint8Array[] = [];

    if (spec.kind === 'group_open' || spec.kind === 'group_close') {
      const lsct = new Uint8Array(16);
      const lv = new DataView(lsct.buffer);
      lsct.set([0x38, 0x42, 0x49, 0x4d], 0); // "8BIM"
      lsct.set([0x6c, 0x73, 0x63, 0x74], 4); // "lsct"
      lv.setUint32(8, 4, false); // data length = 4
      lv.setUint32(12, spec.kind === 'group_open' ? 1 : 3, false);
      addlBlocks.push(lsct);
    }

    const addlLen = addlBlocks.reduce((acc, b) => acc + b.byteLength, 0);
    // extraData = 4 (mask len 0) + 4 (blending ranges len 0) + pascalName + addlBlocks
    const extraDataLen = 4 + 4 + pascalName.byteLength + addlLen;

    // 4*4 (rect) + 2 (numChannels=4) + 4*(2+4) (channel info) + 4+4+1+1+1+1 (blend) + 4 (extraLen) + extraDataLen
    const recordLen = 16 + 2 + 4 * 6 + 12 + 4 + extraDataLen;
    const rec = new Uint8Array(recordLen);
    const rv = new DataView(rec.buffer);
    let offset = 0;

    rv.setInt32(offset, top, false);
    offset += 4;
    rv.setInt32(offset, left, false);
    offset += 4;
    rv.setInt32(offset, bottom, false);
    offset += 4;
    rv.setInt32(offset, right, false);
    offset += 4;

    rv.setUint16(offset, 4, false); // 4 channels
    offset += 2;
    const channelIds = [-1, 0, 1, 2];
    for (const cid of channelIds) {
      rv.setInt16(offset, cid, false);
      offset += 2;
      rv.setUint32(offset, 2, false); // 2 bytes compression header, empty pixels
      offset += 4;
      channelImageDatas.push(new Uint8Array([0, 0])); // raw compression (0)
    }

    rec.set([0x38, 0x42, 0x49, 0x4d], offset); // "8BIM"
    offset += 4;
    rec.set([0x6e, 0x6f, 0x72, 0x6d], offset); // "norm"
    offset += 4;
    rec[offset++] = 255; // opacity
    rec[offset++] = 0; // clipping
    rec[offset++] = spec.hidden ? 0x02 : 0x00; // flags (bit 1 = hidden)
    rec[offset++] = 0; // filler

    rv.setUint32(offset, extraDataLen, false);
    offset += 4;
    rv.setUint32(offset, 0, false); // layer mask len
    offset += 4;
    rv.setUint32(offset, 0, false); // blending ranges len
    offset += 4;
    rec.set(pascalName, offset);
    offset += pascalName.byteLength;
    for (const block of addlBlocks) {
      rec.set(block, offset);
      offset += block.byteLength;
    }

    layerRecords.push(rec);
  }

  const recordsSize = layerRecords.reduce((acc, r) => acc + r.byteLength, 0);
  const channelDataSize = channelImageDatas.reduce((acc, c) => acc + c.byteLength, 0);
  const layerInfoPayloadLen = 2 + recordsSize + channelDataSize;
  const layerInfoPaddedLen = Math.ceil(layerInfoPayloadLen / 4) * 4;
  const layerAndMaskLen = 4 + layerInfoPaddedLen + 4; // layerInfoLen + payload + globalLayerMask(4 bytes=0)

  const layerSection = new Uint8Array(4 + layerAndMaskLen);
  const lsv = new DataView(layerSection.buffer);
  let lsOffset = 0;
  lsv.setUint32(lsOffset, layerAndMaskLen, false);
  lsOffset += 4;
  lsv.setUint32(lsOffset, layerInfoPaddedLen, false);
  lsOffset += 4;
  lsv.setInt16(lsOffset, layers.length, false);
  lsOffset += 2;
  for (const r of layerRecords) {
    layerSection.set(r, lsOffset);
    lsOffset += r.byteLength;
  }
  for (const c of channelImageDatas) {
    layerSection.set(c, lsOffset);
    lsOffset += c.byteLength;
  }
  // remaining padding + 4-byte global layer mask length (0) are already zeroed

  // Image Data section: 2-byte compression = 0 + minimal channel bytes
  const imageData = new Uint8Array(2);

  const total = new Uint8Array(
    header.byteLength +
      emptySections.byteLength +
      layerSection.byteLength +
      imageData.byteLength
  );
  let cursor = 0;
  total.set(header, cursor);
  cursor += header.byteLength;
  total.set(emptySections, cursor);
  cursor += emptySections.byteLength;
  total.set(layerSection, cursor);
  cursor += layerSection.byteLength;
  total.set(imageData, cursor);
  return total;
}

describe('WebtoonPsdLayerInspector', () => {
  it('extracts read-only layer tree metadata from a valid PSD v1 with editabilityVerified=false', async () => {
    // Note: PSD stores layer records bottom-to-top, with group_close before children and group_open after.
    const psdBuffer = buildSyntheticPsdBuffer({
      width: 1080,
      height: 1350,
      layers: [
        { kind: 'layer', name: 'Background' },
        { kind: 'group_close', name: '</Layer group>' },
        { kind: 'layer', name: 'Celebrant Name', hidden: false },
        { kind: 'layer', name: 'Hidden Note', hidden: true },
        { kind: 'group_open', name: 'Birthday Details' },
      ],
    });

    const result = await defaultPsdLayerInspector.inspectBuffer({
      buffer: psdBuffer,
      filename: 'birthday-flyer.psd',
    });

    expect(result.engineId).toBe(PSD_INSPECTOR_ENGINE_ID);
    expect(result.widthPx).toBe(1080);
    expect(result.heightPx).toBe(1350);
    expect(result.extractedMetadataOnly).toBe(true);
    expect(result.editabilityVerified).toBe(false);
    expect(result.layerCountTruncated).toBe(false);
    expect(result.layerCount).toBeGreaterThanOrEqual(4);
    expect(result.layers.some((node) => node.kind === 'GROUP')).toBe(true);
    expect(
      result.layers.some((node) => node.name === 'Birthday Details' && node.kind === 'GROUP')
    ).toBe(true);
    expect(
      result.layers.some((node) => node.name === 'Background' && node.visible === true)
    ).toBe(true);
  });

  it('truncates cleanly when node count exceeds maxLayerNodes', async () => {
    const inspector = new WebtoonPsdLayerInspector();
    const layers: SyntheticLayerSpec[] = [];
    for (let i = 0; i < 8; i += 1) {
      layers.push({ kind: 'layer', name: `Layer ${i + 1}` });
    }

    const psdBuffer = buildSyntheticPsdBuffer({
      width: 800,
      height: 800,
      layers,
    });

    const result = await inspector.inspectBuffer({
      buffer: psdBuffer,
      filename: 'truncated-layers.psd',
      limits: {
        maxLayerNodes: 3,
      },
    });

    expect(result.layerCountTruncated).toBe(true);
    expect(result.layerCount).toBe(3);
    expect(result.layers).toHaveLength(3);
    expect(result.editabilityVerified).toBe(false);
  });

  it('rejects non-PSD headers and PSB v2 files with explicit PsdInspectionError', async () => {
    const fakePng = new Uint8Array([0x89, 0x50, 0x4e, 0x47, ...new Array(30).fill(0)]);
    await expect(
      defaultPsdLayerInspector.inspectBuffer({
        buffer: fakePng,
        filename: 'fake-image.psd',
      })
    ).rejects.toMatchObject({
      name: 'PsdInspectionError',
      code: 'INVALID_PSD_HEADER',
    } satisfies Partial<PsdInspectionError>);

    const psbV2 = buildSyntheticPsdBuffer({
      width: 500,
      height: 500,
      version: 2,
    });
    await expect(
      defaultPsdLayerInspector.inspectBuffer({
        buffer: psbV2,
        filename: 'large-doc.psb',
      })
    ).rejects.toMatchObject({
      name: 'PsdInspectionError',
      code: 'UNSUPPORTED_PSD_VERSION',
    } satisfies Partial<PsdInspectionError>);
  });

  it('rejects oversized PSD buffers and invalid dimensions', async () => {
    const psdBuffer = buildSyntheticPsdBuffer({
      width: 100,
      height: 100,
    });

    await expect(
      defaultPsdLayerInspector.inspectBuffer({
        buffer: psdBuffer,
        filename: 'oversized.psd',
        limits: { maxFileBytes: 10 },
      })
    ).rejects.toMatchObject({
      code: 'PSD_SIZE_EXCEEDED',
    });

    const invalidDims = buildSyntheticPsdBuffer({
      width: 35_000,
      height: 100,
    });
    await expect(
      defaultPsdLayerInspector.inspectBuffer({
        buffer: invalidDims,
        filename: 'too-wide.psd',
      })
    ).rejects.toMatchObject({
      code: 'PSD_DIMENSIONS_INVALID',
    });
  });
});
