/**
 * CRELUNE — Bounded Read-Only PSD Layer Inspector (`@webtoon/psd` Worker-Isolated Adapter)
 *
 * Isolates `Psd.parse()` inside a terminable Node `worker_threads.Worker` with:
 *  - Empty environment (`env: {}`) so the parser never accesses DB/storage/session secrets
 *  - Explicit V8 heap `resourceLimits` (`256 MB` old generation, `64 MB` young generation)
 *  - Real wall-clock deadline that calls `worker.terminate()` on timeout
 *  - Bounded input transfer (`<= 100 MB`) and bounded output payload (`<= 1 MiB`)
 *
 * Extracted layer metadata NEVER implies live editability inside Affinity 3.3
 * (`editabilityVerified: false` always).
 */

import fs from 'node:fs';
import path from 'node:path';
import { Worker } from 'node:worker_threads';
import {
  DEFAULT_PSD_INSPECTION_LIMITS,
  psdInspectionResultSchema,
  type PsdInspectInput,
  type PsdInspectionLimits,
  type PsdInspectionResult,
  type PsdLayerInspector,
} from '@crelune/shared';

export const PSD_INSPECTOR_ENGINE_ID = 'webtoon-psd-0.4.0' as const;
const MAX_PSD_DIMENSION_PX = 30_000;
const PSD_HEADER_MIN_BYTES = 26;

export const PSD_WORKER_RESOURCE_LIMITS = {
  maxOldGenerationSizeMb: 256,
  maxYoungGenerationSizeMb: 64,
  codeRangeSizeMb: 16,
} as const;

export type PsdInspectionErrorCode =
  | 'INVALID_PSD_HEADER'
  | 'UNSUPPORTED_PSD_VERSION'
  | 'PSD_SIZE_EXCEEDED'
  | 'PSD_DIMENSIONS_INVALID'
  | 'PSD_PARSE_FAILED'
  | 'PSD_INSPECTION_TIMEOUT'
  | 'PSD_OUTPUT_EXCEEDED'
  | 'PSD_WORKER_TERMINATED';

export class PsdInspectionError extends Error {
  constructor(
    message: string,
    public readonly code: PsdInspectionErrorCode
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

function resolveDefaultWorkerScriptPath(): string {
  const candidates = [
    path.resolve(process.cwd(), 'src/lib/templates/psd-parse-worker.mjs'),
    path.resolve(process.cwd(), 'apps/web/src/lib/templates/psd-parse-worker.mjs'),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  throw new PsdInspectionError(
    'PSD inspection worker script is unavailable in the runtime environment.',
    'PSD_PARSE_FAILED'
  );
}

type WorkerPayload =
  | { ok: true; result: unknown }
  | { ok: false; code: PsdInspectionErrorCode; message: string };

export class WebtoonPsdLayerInspector implements PsdLayerInspector {
  public readonly engineId = PSD_INSPECTOR_ENGINE_ID;
  private readonly workerScriptPath?: string;

  constructor(options?: { workerScriptPath?: string }) {
    this.workerScriptPath = options?.workerScriptPath;
  }

  async inspectBuffer(input: PsdInspectInput): Promise<PsdInspectionResult> {
    const limits = resolveLimits(input.limits);
    assertValidPsdHeader(input.buffer, limits.maxFileBytes);

    const workerPath = this.workerScriptPath ?? resolveDefaultWorkerScriptPath();
    const copy = new Uint8Array(input.buffer.byteLength);
    copy.set(input.buffer);
    const transferredBuffer: ArrayBuffer = copy.buffer;

    return new Promise<PsdInspectionResult>((resolve, reject) => {
      let settled = false;

      const worker = new Worker(workerPath, {
        env: {},
        resourceLimits: { ...PSD_WORKER_RESOURCE_LIMITS },
        workerData: {
          arrayBuffer: transferredBuffer,
          limits,
          maxDimensionPx: MAX_PSD_DIMENSION_PX,
          engineId: this.engineId,
        },
        transferList: [transferredBuffer],
      });

      const timer = setTimeout(() => {
        void worker.terminate();
        finish(() => {
          reject(
            new PsdInspectionError(
              'PSD inspection timed out under bounded worker execution limits.',
              'PSD_INSPECTION_TIMEOUT'
            )
          );
        });
      }, limits.timeoutMs);

      const finish = (fn: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        fn();
      };

      worker.once('message', (msg: WorkerPayload) => {
        void worker.terminate();
        if (!msg || typeof msg !== 'object') {
          finish(() => {
            reject(
              new PsdInspectionError(
                'PSD inspection worker returned an invalid response.',
                'PSD_PARSE_FAILED'
              )
            );
          });
          return;
        }
        if (!msg.ok) {
          finish(() => {
            reject(new PsdInspectionError(msg.message, msg.code));
          });
          return;
        }

        const parsed = psdInspectionResultSchema.safeParse(msg.result);
        if (!parsed.success) {
          finish(() => {
            reject(
              new PsdInspectionError(
                'PSD inspection output failed schema validation.',
                'PSD_PARSE_FAILED'
              )
            );
          });
          return;
        }

        finish(() => {
          resolve(parsed.data);
        });
      });

      worker.once('error', () => {
        void worker.terminate();
        finish(() => {
          reject(
            new PsdInspectionError(
              'PSD inspection worker failed during bounded parsing.',
              'PSD_PARSE_FAILED'
            )
          );
        });
      });

      worker.once('exit', (code) => {
        if (!settled && code !== 0) {
          finish(() => {
            reject(
              new PsdInspectionError(
                'PSD inspection worker terminated unexpectedly under resource bounds.',
                'PSD_WORKER_TERMINATED'
              )
            );
          });
        }
      });
    });
  }
}

export const defaultPsdLayerInspector = new WebtoonPsdLayerInspector();
