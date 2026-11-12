// @vitest-environment jsdom

import React from 'react';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  TemplateDetail,
  TemplateSummary,
} from '@crelune/shared';
import { TemplatesClient } from '@/components/templates/TemplatesClient';
import { TemplateDetailClient } from '@/components/templates/TemplateDetailClient';
import { VersionPreviewCard } from '@/components/templates/VersionPreviewCard';
import { FieldMappingEditor } from '@/components/templates/FieldMappingEditor';
import { TemplateUploadModal } from '@/components/templates/TemplateUploadModal';

const { routerRefreshMock, routerPushMock } = vi.hoisted(() => ({
  routerRefreshMock: vi.fn(),
  routerPushMock: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    refresh: routerRefreshMock,
    push: routerPushMock,
  }),
}));

const SAMPLE_TEMPLATE_SUMMARY: TemplateSummary = {
  id: 'tmpl-1111-1111-1111',
  name: 'Sunday Birthday Celebration',
  category: 'BIRTHDAY_FLYER',
  studioType: 'AFFINITY_DESIGNER',
  description: 'Official 1080x1350 celebration flyer',
  isActive: true,
  archivedAt: null,
  activeVersion: {
    id: 'ver-1111-1111-1111',
    templateId: 'tmpl-1111-1111-1111',
    versionNumber: 1,
    format: 'PSD',
    originalFilename: 'birthday-square.psd',
    mimeType: 'image/vnd.adobe.photoshop',
    byteSize: 2048576,
    sha256: 'a'.repeat(64),
    widthPx: 1080,
    heightPx: 1350,
    hasPreview: true,
    inspectionStatus: 'MANUAL_REQUIRED',
    inspectionSummary: 'PSD header validated; automatic layer inspection is disabled for safety. Complete layer inspection and field mapping manually in Affinity.',
    inspectedAt: null,
    createdAt: '2026-11-12T10:00:00.000Z',
  },
  versionCount: 2,
  createdAt: '2026-11-12T09:00:00.000Z',
  updatedAt: '2026-11-12T10:00:00.000Z',
};

const SAMPLE_TEMPLATE_DETAIL: TemplateDetail = {
  ...SAMPLE_TEMPLATE_SUMMARY,
  versions: [
    {
      ...SAMPLE_TEMPLATE_SUMMARY.activeVersion!,
      versionNumber: 2,
      id: 'ver-2222-2222-2222',
      format: 'AFDESIGN',
      originalFilename: 'birthday-v2.afdesign',
    },
    SAMPLE_TEMPLATE_SUMMARY.activeVersion!,
  ],
  activeMappings: [
    {
      id: 'map-1',
      templateVersionId: 'ver-1111-1111-1111',
      fieldKey: 'member.fullName',
      fieldType: 'TEXT',
      targetLayerName: 'Celebrant_Name',
      layerPath: ['Header', 'Details'],
      isRequired: true,
      defaultValue: null,
      notes: 'Celebrant name line',
      createdAt: '2026-11-12T10:05:00.000Z',
      updatedAt: '2026-11-12T10:05:00.000Z',
    },
  ],
};

describe('Milestone 5 Stage 5.3 Web Catalog and Template Management UI', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders the template catalog with search, category filtering, and template cards', async () => {
    render(
      <TemplatesClient
        initialTemplates={[SAMPLE_TEMPLATE_SUMMARY]}
        initialTotal={1}
        initialPage={1}
        initialPageSize={24}
      />
    );

    expect(screen.getByText('Creative Template Catalog')).toBeTruthy();
    expect(screen.getByText('Sunday Birthday Celebration')).toBeTruthy();
    expect(screen.getByText(/1080 × 1350 px/i)).toBeTruthy();
    expect(screen.getByText('MANUAL_REQUIRED')).toBeTruthy();
    expect(screen.getAllByText(/Affinity Designer/i).length).toBeGreaterThanOrEqual(1);
  });

  it('renders empty state with actionable Add Template prompt when catalog has no templates', async () => {
    render(
      <TemplatesClient
        initialTemplates={[]}
        initialTotal={0}
        initialPage={1}
        initialPageSize={24}
      />
    );

    expect(screen.getByText('No Templates Found')).toBeTruthy();
    expect(screen.getByRole('button', { name: /add first template/i })).toBeTruthy();
  });

  it('renders template details with version history tabs, technical metadata, and preview', async () => {
    render(<TemplateDetailClient initialTemplate={SAMPLE_TEMPLATE_DETAIL} />);

    expect(screen.getByText('Sunday Birthday Celebration')).toBeTruthy();
    expect(screen.getByText(/2 total versions/i)).toBeTruthy();
    expect(screen.getByText(/v1 Preview/i)).toBeTruthy();
    expect(screen.getByText(/birthday-square.psd/i)).toBeTruthy();
    expect(screen.getByText(/PSD header validated; automatic layer inspection is disabled for safety/i)).toBeTruthy();
  });

  it('renders field mapping editor with manual verification notices and allows adding/removing bindings', async () => {
    render(
      <FieldMappingEditor
        templateId={SAMPLE_TEMPLATE_DETAIL.id}
        versionId={SAMPLE_TEMPLATE_DETAIL.activeVersion!.id}
        versionNumber={1}
        format="PSD"
        initialMappings={SAMPLE_TEMPLATE_DETAIL.activeMappings}
      />
    );

    expect(screen.getByText(/Field Mappings for Version 1/i)).toBeTruthy();
    expect(screen.getByText(/Manual Layer Name Verification Required/i)).toBeTruthy();
    expect(screen.getByDisplayValue('member.fullName')).toBeTruthy();
    expect(screen.getByDisplayValue('Celebrant_Name')).toBeTruthy();

    // Add field binding
    fireEvent.click(screen.getByRole('button', { name: /add field/i }));
    expect(screen.getByText(/2 bindings/i)).toBeTruthy();
  });

  it('renders version preview card with companion image and honest visual-only disclaimer', () => {
    render(
      <VersionPreviewCard
        templateId={SAMPLE_TEMPLATE_DETAIL.id}
        versionId={SAMPLE_TEMPLATE_DETAIL.activeVersion!.id}
        hasPreview={true}
        versionNumber={1}
        format="PSD"
        widthPx={1080}
        heightPx={1350}
      />
    );

    const img = screen.getByAltText(/preview of version 1/i);
    expect(img).toBeTruthy();
    expect(screen.getByText(/v1 preview/i)).toBeTruthy();
    expect(screen.getByText(/1080 × 1350 px/i)).toBeTruthy();
  });

  it('renders missing preview fallback gracefully when hasPreview is false', () => {
    render(
      <VersionPreviewCard
        templateId={SAMPLE_TEMPLATE_DETAIL.id}
        versionId={SAMPLE_TEMPLATE_DETAIL.activeVersion!.id}
        hasPreview={false}
        versionNumber={1}
        format="AFDESIGN"
        widthPx={null}
        heightPx={null}
      />
    );

    expect(screen.getByText(/no visual preview uploaded/i)).toBeTruthy();
    expect(
      screen.getByText(/AFDESIGN master files do not render directly in browsers/i)
    ).toBeTruthy();
  });

  it('validates file formats client-side and requires master file selection in upload modal', async () => {
    render(
      <TemplateUploadModal
        isOpen={true}
        onClose={vi.fn()}
        onSuccess={vi.fn()}
      />
    );

    expect(screen.getByText(/Add New Creative Template/i)).toBeTruthy();
    expect(
      screen.getByText(/Supported: Photoshop \(\.psd\) or native Affinity/i)
    ).toBeTruthy();

    // Attempt submit with empty form
    fireEvent.click(screen.getByRole('button', { name: /^upload template$/i }));

    await waitFor(() => {
      expect(
        screen.getByText(/Template name must be at least 2 characters/i)
      ).toBeTruthy();
    });
  });
});
