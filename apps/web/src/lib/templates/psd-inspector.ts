/**
 * CRELUNE — Bounded Read-Only PSD Layer Inspector (`@webtoon/psd` Adapter)
 *
 * Implements `PsdLayerInspector` behind strict file-size, dimension, depth,
 * node-count, and timeout caps. Extracted layer metadata NEVER implies live
 * editability inside Affinity 3.3 (`editabilityVerified: false` always).
 */

import Psd, { type Group, type Layer, type NodeChild } from '@webtoon/psd';
import {
  DEFAULT_PSD_INSPECTION_LIMITS,
  psdInspectionResultSchema,
  type PsdInspectInput,
  type PsdInspectionLimits,
  type PsdInspectionResult,
  type PsdLayerInspector,
  type PsdLayerKind,
  type PsdLayerNode,
} from '@crelune/shared';

export const PSD_INSPECTOR_ENGINE_ID = 'webtoon-psd-0.4.0' as const;
const MAX_PSD_DIMENSION_PX = 30_000;
const PSD_HEADER_MIN_BYTES = 26;

export class PsdInspectionError extends Error {
  constructor(
    message: string,
    public readonly code:
      | 'INVALID_PSD_HEADER'
      | 'UNSUPPORTED_PSD_VERSION'
      | 'PSD_SIZE_EXCEEDED'
      | 'PSD_DIMENSIONS_INVALID'
      | 'PSD_PARSE_FAILED'
      | 'PSD_INSPECTION_TIMEOUT'
  ) {
    super(message);
    this.name = 'PsdInspectionError';
  }
}

function resolveLimits(partial?: Partial<PsdInspectionLimits>): PsdInspectionLimits {
  return {
    maxFileBytes:
      partial?.maxFileBytes ?? DEFAULT_PSD_INSPECTION_LIMITS.maxFileBytes,
    maxLayerNodes:
      partial?.maxLayerNodes ?? DEFAULT_PSD_INSPECTION_LIMITS.maxLayerNodes,
    maxGroupDepth:
      partial?.maxGroupDepth ?? DEFAULT_PSD_INSPECTION_LIMITS.maxGroupDepth,
    maxTextPreviewChars:
      partial?.maxTextPreviewChars ??
      DEFAULT_PSD_INSPECTION_LIMITS.maxTextPreviewChars,
    timeoutMs: partial?.timeoutMs ?? DEFAULT_PSD_INSPECTION_LIMITS.timeoutMs,
  };
}

function assertValidPsdHeader(buffer: Uint8Array, maxFileBytes: number): void {
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
}

function sanitizeLayerName(raw: string | undefined, fallback: string): string {
  const cleaned = (raw ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .trim();
  if (!cleaned) return fallback;
  return cleaned.slice(0, 240);
}

function classifyLayerKind(layer: Layer): PsdLayerKind {
  if (layer.text !== undefined || layer.additionalProperties?.typeToolObjectSetting) {
    return 'TEXT';
  }
  const props = layer.additionalProperties;
  if (props?.smartObjectPlacedLayerData) {
    return 'SMART_OBJECT';
  }
  if (
    props?.vectorMaskSetting ||
    props?.vectorStrokeData ||
    props?.vectorStrokeContentData
  ) {
    return 'VECTOR';
  }
  if (props?.hueSaturation || props?.solidColorSheetSetting || props?.gradientFillSetting || props?.patternFillSetting) {
    return 'ADJUSTMENT';
  }
  if (layer.width > 0 || layer.height > 0) {
    return 'PIXEL';
  }
  return 'UNKNOWN';
}

function toSafeOpacityPercent(opacityByte: number): number | undefined {
  if (!Number.isFinite(opacityByte)) return undefined;
  const clamped = Math.min(255, Math.max(0, opacityByte));
  return Math.round((clamped / 255) * 10000) / 100;
}

export class WebtoonPsdLayerInspector implements PsdLayerInspector {
  public readonly engineId = PSD_INSPECTOR_ENGINE_ID;

  async inspectBuffer(input: PsdInspectInput): Promise<PsdInspectionResult> {
    const limits = resolveLimits(input.limits);
    assertValidPsdHeader(input.buffer, limits.maxFileBytes);

    const parseTask = Promise.resolve().then(() => {
      const arrayBuffer = input.buffer.buffer.slice(
        input.buffer.byteOffset,
        input.buffer.byteOffset + input.buffer.byteLength
      );

      let psd: Psd;
      try {
        psd = Psd.parse(arrayBuffer);
      } catch {
        throw new PsdInspectionError(
          'Uploaded PSD structure is malformed or could not be parsed safely.',
          'PSD_PARSE_FAILED'
        );
      }

      if (
        !Number.isInteger(psd.width) ||
        !Number.isInteger(psd.height) ||
        psd.width <= 0 ||
        psd.height <= 0 ||
        psd.width > MAX_PSD_DIMENSION_PX ||
        psd.height > MAX_PSD_DIMENSION_PX
      ) {
        throw new PsdInspectionError(
          'Parsed PSD dimensions are invalid or exceed allowed bounds.',
          'PSD_DIMENSIONS_INVALID'
        );
      }

      const nodes: PsdLayerNode[] = [];
      let truncated = false;
      let counter = 0;

      const visit = (children: NodeChild[], parentPath: string[], depth: number): void => {
        if (depth >= limits.maxGroupDepth) {
          truncated = true;
          return;
        }
        for (const child of children) {
          if (nodes.length >= limits.maxLayerNodes) {
            truncated = true;
            return;
          }
          counter += 1;

          if (child.type === 'Group') {
            const group = child as Group;
            const groupName = sanitizeLayerName(group.name, `Group ${counter}`);
            const currentPath = [...parentPath, groupName].slice(
              0,
              limits.maxGroupDepth
            );
            nodes.push({
              id: `node-${counter}`,
              name: groupName,
              kind: 'GROUP',
              path: currentPath,
              visible: true,
              opacityPercent: toSafeOpacityPercent(group.opacity),
              childCount: group.children.length,
            });
            visit(group.children, currentPath, depth + 1);
          } else {
            const layer = child as Layer;
            const layerName = sanitizeLayerName(layer.name, `Layer ${counter}`);
            const kind = classifyLayerKind(layer);
            const currentPath = [...parentPath, layerName].slice(
              0,
              limits.maxGroupDepth
            );
            const textPreview =
              typeof layer.text === 'string' && layer.text.length > 0
                ? layer.text
                    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ' ')
                    .slice(0, limits.maxTextPreviewChars)
                : undefined;

            nodes.push({
              id: `node-${counter}`,
              name: layerName,
              kind,
              path: currentPath,
              visible: !layer.isHidden,
              opacityPercent: toSafeOpacityPercent(layer.opacity),
              bounds:
                layer.width >= 0 && layer.height >= 0
                  ? {
                      left: Math.trunc(layer.left),
                      top: Math.trunc(layer.top),
                      width: Math.max(0, Math.trunc(layer.width)),
                      height: Math.max(0, Math.trunc(layer.height)),
                    }
                  : undefined,
              textPreview,
            });
          }
        }
      };

      visit(psd.children, [], 0);

      const summary = truncated
        ? `Extracted ${nodes.length} PSD layer node(s) (truncated at bounded cap); Affinity 3.3 editability requires artist verification.`
        : `Extracted ${nodes.length} PSD layer node(s); Affinity 3.3 editability requires artist verification.`;

      return psdInspectionResultSchema.parse({
        engineId: this.engineId,
        detectionSource: 'PSD_PARSER',
        status: 'INSPECTED',
        widthPx: psd.width,
        heightPx: psd.height,
        layerCount: nodes.length,
        layerCountTruncated: truncated,
        extractedMetadataOnly: true,
        editabilityVerified: false,
        summary,
        layers: nodes,
      });
    });

    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        parseTask,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            reject(
              new PsdInspectionError(
                'PSD inspection timed out under bounded resource limits.',
                'PSD_INSPECTION_TIMEOUT'
              )
            );
          }, limits.timeoutMs);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}

export const defaultPsdLayerInspector = new WebtoonPsdLayerInspector();

