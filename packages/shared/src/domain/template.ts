import type { DesignCategory } from './design-job.js';

export const TEMPLATE_STUDIO_TYPES = [
  'AFFINITY_PHOTO',
  'AFFINITY_DESIGNER',
  'AFFINITY_PUBLISHER',
  'AFFINITY_STUDIO',
] as const;

export type TemplateStudioType = (typeof TEMPLATE_STUDIO_TYPES)[number];

export const TEMPLATE_FILE_FORMATS = [
  'PSD',
  'AF',
  'AFPHOTO',
  'AFDESIGN',
  'AFPUB',
] as const;

export type TemplateFileFormat = (typeof TEMPLATE_FILE_FORMATS)[number];

export const NATIVE_AFFINITY_FORMATS = [
  'AF',
  'AFPHOTO',
  'AFDESIGN',
  'AFPUB',
] as const;

export type NativeAffinityFormat = (typeof NATIVE_AFFINITY_FORMATS)[number];

export const TEMPLATE_INSPECTION_STATUSES = [
  'PENDING',
  'INSPECTED',
  'MANUAL_REQUIRED',
  'FAILED',
] as const;

export type TemplateInspectionStatus = (typeof TEMPLATE_INSPECTION_STATUSES)[number];

export const TEMPLATE_FIELD_TYPES = [
  'TEXT',
  'IMAGE',
  'DATE',
  'COLOR',
] as const;

export type TemplateFieldType = (typeof TEMPLATE_FIELD_TYPES)[number];

export const CREATIVE_UPLOAD_KINDS = [
  'TEMPLATE_MASTER',
  'TEMPLATE_PREVIEW',
  'WORKING_ASSET',
  'EXPORT_DELIVERABLE',
] as const;

export type CreativeUploadKind = (typeof CREATIVE_UPLOAD_KINDS)[number];

export const CREATIVE_UPLOAD_STATUSES = [
  'PENDING',
  'VERIFIED',
  'REJECTED',
  'EXPIRED',
  'ABANDONED',
] as const;

export type CreativeUploadStatus = (typeof CREATIVE_UPLOAD_STATUSES)[number];

export const CREATIVE_AGENT_STATUSES = ['ACTIVE', 'REVOKED'] as const;

export type CreativeAgentStatus = (typeof CREATIVE_AGENT_STATUSES)[number];

export const CREATIVE_DISPATCH_STATUSES = [
  'QUEUED',
  'CLAIMED',
  'DOWNLOADING_ASSETS',
  'OPENING_TEMPLATE',
  'READY_FOR_ARTIST',
  'EXPORTING',
  'EXPORTED',
  'FAILED',
  'CANCELLED',
] as const;

export type CreativeDispatchStatus = (typeof CREATIVE_DISPATCH_STATUSES)[number];

export const ACTIVE_CREATIVE_DISPATCH_STATUSES: readonly CreativeDispatchStatus[] = [
  'QUEUED',
  'CLAIMED',
  'DOWNLOADING_ASSETS',
  'OPENING_TEMPLATE',
  'READY_FOR_ARTIST',
  'EXPORTING',
] as const;

export const EXPORT_FILE_FORMATS = ['PNG', 'JPEG', 'PDF'] as const;

export type ExportFileFormat = (typeof EXPORT_FILE_FORMATS)[number];

export const CREATIVE_STORAGE_NAMESPACES = [
  'templates',
  'working_assets',
  'exports',
] as const;

export type CreativeStorageNamespace = (typeof CREATIVE_STORAGE_NAMESPACES)[number];

export const CREATIVE_BYTE_LIMITS = {
  TEMPLATE_MASTER_MAX_BYTES: 100 * 1024 * 1024,
  TEMPLATE_PREVIEW_MAX_BYTES: 10 * 1024 * 1024,
  WORKING_ASSET_MAX_BYTES: 25 * 1024 * 1024,
  EXPORT_DELIVERABLE_MAX_BYTES: 50 * 1024 * 1024,
  UPLOAD_INTENT_TTL_SECONDS: 15 * 60,
} as const;

export const TEMPLATE_FORMAT_EXTENSIONS: Record<TemplateFileFormat, readonly string[]> = {
  PSD: ['psd'],
  AF: ['af'],
  AFPHOTO: ['afphoto'],
  AFDESIGN: ['afdesign'],
  AFPUB: ['afpub'],
};

export const TEMPLATE_FORMAT_MIME_TYPES: Record<TemplateFileFormat, readonly string[]> = {
  PSD: [
    'image/vnd.adobe.photoshop',
    'application/x-photoshop',
    'application/photoshop',
    'application/octet-stream',
  ],
  AF: ['application/octet-stream', 'application/x-affinity'],
  AFPHOTO: ['application/octet-stream', 'application/x-affinity-photo'],
  AFDESIGN: ['application/octet-stream', 'application/x-affinity-designer'],
  AFPUB: ['application/octet-stream', 'application/x-affinity-publisher'],
};

export const TEMPLATE_PREVIEW_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'image/webp',
] as const;

export const EXPORT_FORMAT_MIME_TYPES: Record<ExportFileFormat, readonly string[]> = {
  PNG: ['image/png'],
  JPEG: ['image/jpeg'],
  PDF: ['application/pdf'],
};

export interface TemplateFormatCapabilities {
  format: TemplateFileFormat;
  isNativeAffinity: boolean;
  supportsNodeLayerInspection: boolean;
  requiresManualMappingFallback: boolean;
  supportsAffinityOpen: boolean;
  preserveMasterImmutable: boolean;
  recommendedDefaultInspectionStatus: TemplateInspectionStatus;
}

export function isNativeAffinityFormat(
  format: TemplateFileFormat
): format is NativeAffinityFormat {
  return (NATIVE_AFFINITY_FORMATS as readonly string[]).includes(format);
}

/**
 * Capability truth table grounded in Stage 5.0 Milestone 1 findings:
 * - PSD supports automated metadata inspection (bounded layer tree) in Stage 5.2+.
 * - Native Affinity formats (.af, .afphoto, .afdesign, .afpub) remain opaque binaries
 *   and must default to manual mapping fallback rather than pretending automated parsing exists.
 */
export function getTemplateFormatCapabilities(
  format: TemplateFileFormat
): TemplateFormatCapabilities {
  const nativeAffinity = isNativeAffinityFormat(format);
  return {
    format,
    isNativeAffinity: nativeAffinity,
    supportsNodeLayerInspection: format === 'PSD',
    requiresManualMappingFallback: nativeAffinity,
    supportsAffinityOpen: true,
    preserveMasterImmutable: true,
    recommendedDefaultInspectionStatus: nativeAffinity
      ? 'MANUAL_REQUIRED'
      : 'PENDING',
  };
}

export const CANONICAL_TEMPLATE_FIELD_KEYS = [
  'member.firstName',
  'member.lastName',
  'member.fullName',
  'member.birthdayDisplay',
  'member.photo',
  'design.title',
  'design.requiredText',
  'design.notes',
  'event.title',
  'event.dateDisplay',
] as const;

export type CanonicalTemplateFieldKey =
  (typeof CANONICAL_TEMPLATE_FIELD_KEYS)[number];

const CUSTOM_FIELD_KEY_PATTERN = /^custom\.[a-z][a-z0-9_]{1,47}$/;

export function isValidTemplateFieldKey(fieldKey: string): boolean {
  if ((CANONICAL_TEMPLATE_FIELD_KEYS as readonly string[]).includes(fieldKey)) {
    return true;
  }
  return CUSTOM_FIELD_KEY_PATTERN.test(fieldKey);
}

export const ALLOWED_CREATIVE_DISPATCH_TRANSITIONS: Record<
  CreativeDispatchStatus,
  readonly CreativeDispatchStatus[]
> = {
  QUEUED: ['CLAIMED', 'CANCELLED', 'FAILED'],
  CLAIMED: ['DOWNLOADING_ASSETS', 'FAILED', 'CANCELLED'],
  DOWNLOADING_ASSETS: ['OPENING_TEMPLATE', 'FAILED', 'CANCELLED'],
  OPENING_TEMPLATE: ['READY_FOR_ARTIST', 'EXPORTING', 'FAILED', 'CANCELLED'],
  READY_FOR_ARTIST: ['EXPORTING', 'EXPORTED', 'FAILED', 'CANCELLED'],
  EXPORTING: ['EXPORTED', 'FAILED', 'CANCELLED'],
  EXPORTED: [],
  FAILED: [],
  CANCELLED: [],
};

export function canTransitionCreativeDispatchStatus(
  from: CreativeDispatchStatus,
  to: CreativeDispatchStatus
): boolean {
  if (from === to) return false;
  return ALLOWED_CREATIVE_DISPATCH_TRANSITIONS[from].includes(to);
}

export const CREATIVE_DISPATCH_PUBLICATION_RULE = 'EXPORT_DOES_NOT_PUBLISH' as const;

export const CREATIVE_WORKFLOW_RESPONSIBILITIES = {
  web: [
    'template_catalog_management',
    'manual_field_mapping_review',
    'design_job_dispatch_request',
    'export_review_and_explicit_owner_approval',
  ],
  backend: [
    'owner_and_agent_authentication',
    'presigned_upload_intent_issuance',
    'object_head_and_sha256_verification',
    'immutable_template_version_registry',
    'job_manifest_generation_and_state_machine',
    'publication_separation_enforcement',
  ],
  windowsAgent: [
    'outbound_polling_and_heartbeat',
    'isolated_working_copy_preparation',
    'verified_template_and_asset_download',
    'allowlisted_affinity_launch_only',
    'export_upload_completion',
  ],
  affinityApp: [
    'interactive_artist_editing',
    'working_copy_document_authoring',
    'manual_export_production',
  ],
  productOwnerApproval: [
    'explicit_publish_approval_toggle',
    'explicit_publication_action',
  ],
} as const;

export const DEFAULT_STUDIO_FOR_DESIGN_CATEGORY: Record<
  DesignCategory,
  TemplateStudioType
> = {
  BIRTHDAY_FLYER: 'AFFINITY_STUDIO',
  CHURCH_PROGRAMME_FLYER: 'AFFINITY_PUBLISHER',
  EVENT_ANNOUNCEMENT: 'AFFINITY_STUDIO',
  SERVICE_FLYER: 'AFFINITY_STUDIO',
  SOCIAL_MEDIA_GRAPHIC: 'AFFINITY_DESIGNER',
  SPECIAL_EVENT_ARTWORK: 'AFFINITY_STUDIO',
  GENERAL_GRAPHIC_DESIGN: 'AFFINITY_STUDIO',
};
