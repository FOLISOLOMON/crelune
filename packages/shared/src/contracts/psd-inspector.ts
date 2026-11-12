import { z } from 'zod';
import {
  CREATIVE_BYTE_LIMITS,
  TEMPLATE_INSPECTION_STATUSES,
} from '../domain/template.js';

export const PSD_LAYER_KINDS = [
  'TEXT',
  'GROUP',
  'PIXEL',
  'VECTOR',
  'ADJUSTMENT',
  'SMART_OBJECT',
  'UNKNOWN',
] as const;

export type PsdLayerKind = (typeof PSD_LAYER_KINDS)[number];

export const DEFAULT_PSD_INSPECTION_LIMITS = {
  maxFileBytes: CREATIVE_BYTE_LIMITS.TEMPLATE_MASTER_MAX_BYTES,
  maxLayerNodes: 500,
  maxGroupDepth: 16,
  maxTextPreviewChars: 240,
  timeoutMs: 10_000,
} as const;

export const psdLayerBoundsSchema = z.object({
  left: z.number().int(),
  top: z.number().int(),
  width: z.number().int().min(0),
  height: z.number().int().min(0),
});

export type PsdLayerBounds = z.infer<typeof psdLayerBoundsSchema>;

export const psdLayerNodeSchema = z.object({
  id: z.string().trim().min(1).max(160),
  name: z.string().min(1).max(240),
  kind: z.enum(PSD_LAYER_KINDS),
  path: z.array(z.string().min(1).max(240)).max(DEFAULT_PSD_INSPECTION_LIMITS.maxGroupDepth),
  visible: z.boolean(),
  opacityPercent: z.number().min(0).max(100).optional(),
  bounds: psdLayerBoundsSchema.optional(),
  textPreview: z
    .string()
    .max(DEFAULT_PSD_INSPECTION_LIMITS.maxTextPreviewChars)
    .optional(),
  childCount: z.number().int().min(0).optional(),
});

export type PsdLayerNode = z.infer<typeof psdLayerNodeSchema>;

/**
 * Contract explicitly separates extracted PSD structure metadata from
 * unverified live editability inside Affinity 3.3.
 */
export const psdInspectionResultSchema = z.object({
  engineId: z.string().trim().min(1).max(80),
  detectionSource: z.enum(['PSD_PARSER', 'MANUAL_FALLBACK']),
  status: z.enum(TEMPLATE_INSPECTION_STATUSES),
  widthPx: z.number().int().positive().nullable(),
  heightPx: z.number().int().positive().nullable(),
  layerCount: z.number().int().min(0),
  layerCountTruncated: z.boolean().default(false),
  extractedMetadataOnly: z.literal(true),
  editabilityVerified: z.literal(false),
  summary: z.string().trim().max(500).nullable(),
  layers: z
    .array(psdLayerNodeSchema)
    .max(DEFAULT_PSD_INSPECTION_LIMITS.maxLayerNodes),
});

export type PsdInspectionResult = z.infer<typeof psdInspectionResultSchema>;

export interface PsdInspectionLimits {
  maxFileBytes: number;
  maxLayerNodes: number;
  maxGroupDepth: number;
  maxTextPreviewChars: number;
  timeoutMs: number;
}

export interface PsdInspectInput {
  buffer: Uint8Array;
  filename: string;
  limits?: Partial<PsdInspectionLimits>;
}

/**
 * Replaceable parser abstraction so Stage 5.2 can evaluate @webtoon/psd or any
 * alternative PSD reader behind bounded resource caps without coupling domain contracts.
 */
export interface PsdLayerInspector {
  readonly engineId: string;
  inspectBuffer(input: PsdInspectInput): Promise<PsdInspectionResult>;
}

