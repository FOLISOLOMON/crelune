import Psd from '@webtoon/psd';
import { parentPort, workerData } from 'node:worker_threads';

const MAX_WORKER_OUTPUT_BYTES = 1_048_576; // 1 MiB cap on serialized layer metadata

function sanitizeLayerName(raw, fallback) {
  const cleaned = (raw ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
  if (!cleaned) return fallback;
  return cleaned.slice(0, 240);
}

function classifyLayerKind(layer) {
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
  if (
    props?.hueSaturation ||
    props?.solidColorSheetSetting ||
    props?.gradientFillSetting ||
    props?.patternFillSetting
  ) {
    return 'ADJUSTMENT';
  }
  if (layer.width > 0 || layer.height > 0) {
    return 'PIXEL';
  }
  return 'UNKNOWN';
}

function toSafeOpacityPercent(opacityByte) {
  if (!Number.isFinite(opacityByte)) return undefined;
  const clamped = Math.min(255, Math.max(0, opacityByte));
  return Math.round((clamped / 255) * 10000) / 100;
}

function run() {
  if (!parentPort) {
    throw new Error('psd-parse-worker must run inside a Node worker thread.');
  }

  const { arrayBuffer, limits, maxDimensionPx, engineId } = workerData;

  let psd;
  try {
    psd = Psd.parse(arrayBuffer);
  } catch {
    parentPort.postMessage({
      ok: false,
      code: 'PSD_PARSE_FAILED',
      message: 'Uploaded PSD structure is malformed or could not be parsed safely.',
    });
    return;
  }

  if (
    !Number.isInteger(psd.width) ||
    !Number.isInteger(psd.height) ||
    psd.width <= 0 ||
    psd.height <= 0 ||
    psd.width > maxDimensionPx ||
    psd.height > maxDimensionPx
  ) {
    parentPort.postMessage({
      ok: false,
      code: 'PSD_DIMENSIONS_INVALID',
      message: 'Parsed PSD dimensions are invalid or exceed allowed bounds.',
    });
    return;
  }

  const nodes = [];
  let truncated = false;
  let counter = 0;

  const visit = (children, parentPath, depth) => {
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
        const groupName = sanitizeLayerName(child.name, `Group ${counter}`);
        const currentPath = [...parentPath, groupName].slice(0, limits.maxGroupDepth);
        nodes.push({
          id: `layer_${counter}`,
          name: groupName,
          kind: 'GROUP',
          visible: !child.isHidden,
          opacity: toSafeOpacityPercent(child.opacity),
          path: currentPath,
          depth,
        });
        if (Array.isArray(child.children) && child.children.length > 0) {
          visit(child.children, currentPath, depth + 1);
        }
      } else if (child.type === 'Layer') {
        const layerName = sanitizeLayerName(child.name, `Layer ${counter}`);
        const currentPath = [...parentPath, layerName].slice(0, limits.maxGroupDepth);
        const kind = classifyLayerKind(child);
        const rawText =
          typeof child.text === 'string'
            ? child.text.replace(/[\u0000-\u001f\u007f]/g, ' ').trim()
            : '';
        const textPreview =
          rawText.length > 0 ? rawText.slice(0, limits.maxTextPreviewChars) : undefined;

        nodes.push({
          id: `layer_${counter}`,
          name: layerName,
          kind,
          visible: !child.isHidden,
          opacity: toSafeOpacityPercent(child.opacity),
          bounds: {
            left: Math.trunc(child.left),
            top: Math.trunc(child.top),
            width: Math.max(0, Math.trunc(child.width)),
            height: Math.max(0, Math.trunc(child.height)),
          },
          textPreview,
          path: currentPath,
          depth,
        });
      }
    }
  };

  visit(psd.children, [], 0);

  const summary = truncated
    ? `Extracted ${nodes.length} PSD layer node(s) (truncated at bounded cap); Affinity 3.3 editability requires artist verification.`
    : `Extracted ${nodes.length} PSD layer node(s); Affinity 3.3 editability requires artist verification.`;

  const result = {
    engineId,
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
  };

  const serializedBytes = Buffer.byteLength(JSON.stringify(result), 'utf8');
  if (serializedBytes > MAX_WORKER_OUTPUT_BYTES) {
    parentPort.postMessage({
      ok: false,
      code: 'PSD_OUTPUT_EXCEEDED',
      message: 'Parsed PSD layer metadata exceeds maximum permitted output size.',
    });
    return;
  }

  parentPort.postMessage({ ok: true, result });
}

run();

