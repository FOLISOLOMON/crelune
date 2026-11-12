import { describe, expect, it } from 'vitest';
import { CREATIVE_BYTE_LIMITS } from '../domain/template.js';
import { psdInspectionResultSchema } from '../contracts/psd-inspector.js';
import {
  CREATIVE_AGENT_MANIFEST_VERSION,
  creativeAgentHeartbeatSchema,
  creativeJobManifestSchema,
  registerCreativeAgentSchema,
  revokeCreativeAgentSchema,
  updateCreativeDispatchStatusSchema,
} from './creative-agent.js';
import { createDesignJobSchema } from './design-job.js';
import {
  approveExportForPublishSchema,
  containsFilesystemPathLiteral,
  createExportRecordSchema,
  createTemplateSchema,
  createTemplateVersionUploadIntentSchema,
  updateTemplateSchema,
  upsertTemplateFieldMappingsSchema,
} from './template.js';

const SAMPLE_SHA256 = 'a'.repeat(64);

describe('Stage 5.1 Template, Upload Intent, Manifest & Dispatch Schemas', () => {
  it('validates template catalog creation/update and rejects local filesystem paths', () => {
    expect(
      createTemplateSchema.parse({
        name: 'Birthday Golden Halo',
        category: 'BIRTHDAY_FLYER',
        studioType: 'AFFINITY_STUDIO',
        description: 'Standard portrait flyer template',
      })
    ).toMatchObject({
      name: 'Birthday Golden Halo',
      category: 'BIRTHDAY_FLYER',
    });

    expect(containsFilesystemPathLiteral('C:\\Users\\Artist\\template.psd')).toBe(true);
    expect(containsFilesystemPathLiteral('\\\\NAS\\Share\\flyer.afphoto')).toBe(true);
    expect(containsFilesystemPathLiteral('../secret.psd')).toBe(true);

    expect(
      createTemplateSchema.safeParse({
        name: 'C:\\Templates\\Birthday.psd',
        category: 'BIRTHDAY_FLYER',
        studioType: 'AFFINITY_STUDIO',
      }).success
    ).toBe(false);

    expect(updateTemplateSchema.safeParse({}).success).toBe(false);
    expect(
      updateTemplateSchema.safeParse({ activeVersionId: 'ver_abc123' }).success
    ).toBe(true);
  });

  it('validates template master upload intents across formats, MIME types, extensions, and 100 MB cap', () => {
    const validPsd = createTemplateVersionUploadIntentSchema.safeParse({
      templateId: 'tpl_123',
      format: 'PSD',
      originalFilename: 'birthday-flyer-v1.psd',
      mimeType: 'image/vnd.adobe.photoshop',
      byteSize: 2_500_000,
      sha256: SAMPLE_SHA256.toUpperCase(),
      idempotencyKey: 'intent_tpl123_v1_001',
    });
    expect(validPsd.success).toBe(true);
    if (validPsd.success) {
      expect(validPsd.data.sha256).toBe(SAMPLE_SHA256);
    }

    expect(
      createTemplateVersionUploadIntentSchema.safeParse({
        templateId: 'tpl_123',
        format: 'AFPHOTO',
        originalFilename: 'church-card.afphoto',
        mimeType: 'application/octet-stream',
        byteSize: 4_000_000,
        sha256: SAMPLE_SHA256,
        idempotencyKey: 'intent_tpl123_v2_001',
      }).success
    ).toBe(true);

    // Mismatched extension for format
    expect(
      createTemplateVersionUploadIntentSchema.safeParse({
        templateId: 'tpl_123',
        format: 'AFPHOTO',
        originalFilename: 'malicious.psd',
        mimeType: 'application/octet-stream',
        byteSize: 1024,
        sha256: SAMPLE_SHA256,
        idempotencyKey: 'intent_mismatch_001',
      }).success
    ).toBe(false);

    // Path inside filename rejected
    expect(
      createTemplateVersionUploadIntentSchema.safeParse({
        templateId: 'tpl_123',
        format: 'PSD',
        originalFilename: '..\\evil.psd',
        mimeType: 'application/octet-stream',
        byteSize: 1024,
        sha256: SAMPLE_SHA256,
        idempotencyKey: 'intent_path_001',
      }).success
    ).toBe(false);

    // Over 100 MB rejected
    expect(
      createTemplateVersionUploadIntentSchema.safeParse({
        templateId: 'tpl_123',
        format: 'PSD',
        originalFilename: 'huge.psd',
        mimeType: 'application/octet-stream',
        byteSize: CREATIVE_BYTE_LIMITS.TEMPLATE_MASTER_MAX_BYTES + 1,
        sha256: SAMPLE_SHA256,
        idempotencyKey: 'intent_oversize_001',
      }).success
    ).toBe(false);
  });

  it('rejects duplicate fieldKey entries in template version mappings', () => {
    const valid = upsertTemplateFieldMappingsSchema.safeParse({
      templateVersionId: 'ver_1',
      mappings: [
        {
          fieldKey: 'member.fullName',
          fieldType: 'TEXT',
          targetLayerName: 'Recipient Name',
          layerPath: ['Typography', 'Recipient Name'],
          isRequired: true,
        },
        {
          fieldKey: 'member.photo',
          fieldType: 'IMAGE',
          targetLayerName: 'Portrait Mask',
          isRequired: true,
        },
      ],
    });
    expect(valid.success).toBe(true);

    const dup = upsertTemplateFieldMappingsSchema.safeParse({
      templateVersionId: 'ver_1',
      mappings: [
        {
          fieldKey: 'member.fullName',
          fieldType: 'TEXT',
          targetLayerName: 'Layer A',
        },
        {
          fieldKey: 'member.fullName',
          fieldType: 'TEXT',
          targetLayerName: 'Layer B',
        },
      ],
    });
    expect(dup.success).toBe(false);
  });

  it('validates replaceable PSD inspection result contract separating metadata from Affinity editability', () => {
    const parsed = psdInspectionResultSchema.parse({
      engineId: 'psd-contract-v1',
      detectionSource: 'PSD_PARSER',
      status: 'INSPECTED',
      widthPx: 1080,
      heightPx: 1350,
      layerCount: 1,
      layerCountTruncated: false,
      extractedMetadataOnly: true,
      editabilityVerified: false,
      summary: 'Detected 1 mappable text layer',
      layers: [
        {
          id: 'layer-1',
          name: 'Recipient Name',
          kind: 'TEXT',
          path: ['Card', 'Recipient Name'],
          visible: true,
          opacityPercent: 100,
          bounds: { left: 100, top: 200, width: 500, height: 80 },
          textPreview: 'Happy Birthday',
        },
      ],
    });
    expect(parsed.extractedMetadataOnly).toBe(true);
    expect(parsed.editabilityVerified).toBe(false);
  });

  it('validates creative agent registration, revocation, heartbeat, versioned manifests, exports, and design job optional template refs', () => {
    expect(
      registerCreativeAgentSchema.safeParse({
        name: 'Studio Desk PC',
        machineLabel: 'CRELUNE-STUDIO-01',
      }).success
    ).toBe(true);

    expect(
      revokeCreativeAgentSchema.safeParse({ reason: 'Workstation retired' }).success
    ).toBe(true);

    expect(
      creativeAgentHeartbeatSchema.safeParse({
        agentVersion: '0.1.0',
        affinityVersion: '3.3.0',
        supportedFormats: ['PSD', 'AF', 'AFPHOTO'],
        capabilities: {
          canPrepareWorkingCopy: true,
          canLaunchAllowlistedAffinity: true,
          canUploadVerifiedExports: true,
        },
      }).success
    ).toBe(true);

    const manifest = creativeJobManifestSchema.parse({
      manifestVersion: CREATIVE_AGENT_MANIFEST_VERSION,
      dispatchId: 'disp_1',
      designJobId: 'job_1',
      organisationId: 'org_1',
      templateId: 'tpl_1',
      templateVersionId: 'ver_1',
      templateFormat: 'PSD',
      templateStudioType: 'AFFINITY_STUDIO',
      templateSha256: SAMPLE_SHA256,
      templateRelativeFilename: 'templates/birthday-v1.psd',
      preserveMasterImmutable: true,
      publicationRule: 'EXPORT_DOES_NOT_PUBLISH',
      outputSpec: {
        formats: ['PNG'],
        targetPlatform: 'Instagram Story',
        dimensions: '1080x1920',
      },
      fields: [
        {
          fieldKey: 'member.fullName',
          fieldType: 'TEXT',
          targetLayerName: 'Recipient Name',
          layerPath: ['Typography', 'Recipient Name'],
          textValue: 'Ama Mensah',
          assetReference: null,
        },
      ],
    });
    expect(manifest.preserveMasterImmutable).toBe(true);

    // Reject absolute Windows path inside manifest
    expect(
      creativeJobManifestSchema.safeParse({
        ...manifest,
        templateRelativeFilename: 'C:\\work\\birthday.psd',
      }).success
    ).toBe(false);

    // Dispatch FAILED requires errorMessage
    expect(
      updateCreativeDispatchStatusSchema.safeParse({
        status: 'FAILED',
        errorCode: 'AFFINITY_LAUNCH_ERROR',
      }).success
    ).toBe(false);
    expect(
      updateCreativeDispatchStatusSchema.safeParse({
        status: 'FAILED',
        errorCode: 'AFFINITY_LAUNCH_ERROR',
        errorMessage: 'Affinity 3.3 returned non-zero exit status.',
      }).success
    ).toBe(true);

    // Export MIME match & publish approval schema
    expect(
      createExportRecordSchema.safeParse({
        designJobId: 'job_1',
        uploadIntentId: 'intent_export_1',
        format: 'PNG',
        mimeType: 'application/pdf',
      }).success
    ).toBe(false);

    expect(
      approveExportForPublishSchema.safeParse({ isApprovedForPublish: true }).success
    ).toBe(true);

    // DesignJob optional template linkage remains backwards-compatible
    expect(
      createDesignJobSchema.safeParse({
        title: 'Sunday Announcement Graphic',
        category: 'EVENT_ANNOUNCEMENT',
        templateId: 'tpl_1',
        templateVersionId: 'ver_1',
      }).success
    ).toBe(true);
  });
});

