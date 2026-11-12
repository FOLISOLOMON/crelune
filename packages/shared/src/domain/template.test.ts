import { describe, expect, it } from 'vitest';
import {
  ALLOWED_CREATIVE_DISPATCH_TRANSITIONS,
  CREATIVE_BYTE_LIMITS,
  CREATIVE_DISPATCH_PUBLICATION_RULE,
  CREATIVE_WORKFLOW_RESPONSIBILITIES,
  DEFAULT_STUDIO_FOR_DESIGN_CATEGORY,
  canTransitionCreativeDispatchStatus,
  getTemplateFormatCapabilities,
  isNativeAffinityFormat,
  isValidTemplateFieldKey,
} from './template.js';
import { DESIGN_CATEGORIES } from './design-job.js';

describe('Template & Creative Workflow Domain Rules (Stage 5.1)', () => {
  it('enforces honest capability truth between PSD inspection and native Affinity opacity', () => {
    const psd = getTemplateFormatCapabilities('PSD');
    expect(psd).toEqual({
      format: 'PSD',
      isNativeAffinity: false,
      supportsNodeLayerInspection: true,
      requiresManualMappingFallback: false,
      supportsAffinityOpen: true,
      preserveMasterImmutable: true,
      recommendedDefaultInspectionStatus: 'PENDING',
    });

    for (const nativeFmt of ['AF', 'AFPHOTO', 'AFDESIGN', 'AFPUB'] as const) {
      expect(isNativeAffinityFormat(nativeFmt)).toBe(true);
      const caps = getTemplateFormatCapabilities(nativeFmt);
      expect(caps.supportsNodeLayerInspection).toBe(false);
      expect(caps.requiresManualMappingFallback).toBe(true);
      expect(caps.preserveMasterImmutable).toBe(true);
      expect(caps.recommendedDefaultInspectionStatus).toBe('MANUAL_REQUIRED');
    }

    expect(isNativeAffinityFormat('PSD')).toBe(false);
  });

  it('validates canonical and custom template field keys cleanly', () => {
    expect(isValidTemplateFieldKey('member.fullName')).toBe(true);
    expect(isValidTemplateFieldKey('member.photo')).toBe(true);
    expect(isValidTemplateFieldKey('event.dateDisplay')).toBe(true);
    expect(isValidTemplateFieldKey('custom.pastor_greeting')).toBe(true);

    expect(isValidTemplateFieldKey('unknown.key')).toBe(false);
    expect(isValidTemplateFieldKey('custom.BadUpperCase')).toBe(false);
    expect(isValidTemplateFieldKey('custom.a')).toBe(false);
    expect(isValidTemplateFieldKey('../traversal')).toBe(false);
  });

  it('enforces explicit creative dispatch status transitions and non-publication invariant', () => {
    expect(canTransitionCreativeDispatchStatus('QUEUED', 'CLAIMED')).toBe(true);
    expect(canTransitionCreativeDispatchStatus('CLAIMED', 'DOWNLOADING_ASSETS')).toBe(true);
    expect(canTransitionCreativeDispatchStatus('DOWNLOADING_ASSETS', 'OPENING_TEMPLATE')).toBe(true);
    expect(canTransitionCreativeDispatchStatus('OPENING_TEMPLATE', 'READY_FOR_ARTIST')).toBe(true);
    expect(canTransitionCreativeDispatchStatus('READY_FOR_ARTIST', 'EXPORTING')).toBe(true);
    expect(canTransitionCreativeDispatchStatus('EXPORTING', 'EXPORTED')).toBe(true);

    expect(canTransitionCreativeDispatchStatus('QUEUED', 'QUEUED')).toBe(false);
    expect(canTransitionCreativeDispatchStatus('QUEUED', 'EXPORTED')).toBe(false);
    expect(canTransitionCreativeDispatchStatus('EXPORTED', 'FAILED')).toBe(false);
    expect(ALLOWED_CREATIVE_DISPATCH_TRANSITIONS.EXPORTED).toEqual([]);
    expect(ALLOWED_CREATIVE_DISPATCH_TRANSITIONS.CANCELLED).toEqual([]);

    expect(CREATIVE_DISPATCH_PUBLICATION_RULE).toBe('EXPORT_DOES_NOT_PUBLISH');
    expect(CREATIVE_WORKFLOW_RESPONSIBILITIES.productOwnerApproval).toContain(
      'explicit_publish_approval_toggle'
    );
    expect(CREATIVE_WORKFLOW_RESPONSIBILITIES.windowsAgent).not.toContain(
      'explicit_publication_action'
    );
  });

  it('covers every DesignCategory in default studio mapping and safe byte ceilings', () => {
    for (const category of DESIGN_CATEGORIES) {
      expect(DEFAULT_STUDIO_FOR_DESIGN_CATEGORY[category]).toBeTruthy();
    }
    expect(CREATIVE_BYTE_LIMITS.TEMPLATE_MASTER_MAX_BYTES).toBe(100 * 1024 * 1024);
    expect(CREATIVE_BYTE_LIMITS.TEMPLATE_PREVIEW_MAX_BYTES).toBe(10 * 1024 * 1024);
    expect(CREATIVE_BYTE_LIMITS.EXPORT_DELIVERABLE_MAX_BYTES).toBe(50 * 1024 * 1024);
  });
});

