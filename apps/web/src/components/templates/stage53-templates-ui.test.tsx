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
  TemplateVersionDetail,
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
    inspectionSummary:
      'PSD header validated; automatic layer inspection is disabled for safety. Complete layer inspection and field mapping manually in Affinity.',
    inspectedAt: null,
    createdAt: '2026-11-12T10:00:00.000Z',
  },
  versionCount: 2,
  createdAt: '2026-11-12T09:00:00.000Z',
  updatedAt: '2026-11-12T10:00:00.000Z',
};

const SAMPLE_VERSION_2: TemplateVersionDetail = {
  ...SAMPLE_TEMPLATE_SUMMARY.activeVersion!,
  versionNumber: 2,
  id: 'ver-2222-2222-2222',
  format: 'AFDESIGN',
  originalFilename: 'birthday-v2.afdesign',
  sha256: 'b'.repeat(64),
  detectedLayers: null,
  mappings: [
    {
      id: 'map-v2-1',
      templateVersionId: 'ver-2222-2222-2222',
      fieldKey: 'member.photo',
      fieldType: 'IMAGE',
      targetLayerName: 'Portrait_Frame_V2',
      layerPath: ['Content', 'Portrait'],
      isRequired: true,
      defaultValue: null,
      notes: 'V2 frame',
      createdAt: '2026-11-12T11:00:00.000Z',
      updatedAt: '2026-11-12T11:00:00.000Z',
    },
  ],
};

const SAMPLE_TEMPLATE_DETAIL: TemplateDetail = {
  ...SAMPLE_TEMPLATE_SUMMARY,
  versions: [SAMPLE_VERSION_2, SAMPLE_TEMPLATE_SUMMARY.activeVersion!],
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

function createJsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('Milestone 5 Stage 5.3 Web Catalog and Template Management UI', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    cleanup();
    globalThis.fetch = originalFetch;
  });

  it('renders the template catalog with private preview thumbnail, filters, pagination, and error retry', async () => {
    const fetchMock = vi.mocked(globalThis.fetch);
    fetchMock
      .mockResolvedValueOnce(
        createJsonResponse({ error: 'Temporary catalog outage' }, 503)
      )
      .mockResolvedValueOnce(
        createJsonResponse({
          items: [SAMPLE_TEMPLATE_SUMMARY],
          total: 30,
          page: 2,
          pageSize: 24,
        })
      );

    render(
      <TemplatesClient
        initialTemplates={[SAMPLE_TEMPLATE_SUMMARY]}
        initialTotal={30}
        initialPage={1}
        initialPageSize={24}
      />
    );

    expect(screen.getByText('Creative Template Catalog')).toBeTruthy();
    expect(screen.getByText('Sunday Birthday Celebration')).toBeTruthy();
    expect(screen.getByText(/1080 × 1350 px/i)).toBeTruthy();
    expect(screen.getByText('MANUAL_REQUIRED')).toBeTruthy();
    expect(screen.getAllByText(/Affinity Designer/i).length).toBeGreaterThanOrEqual(1);

    const previewImg = screen.getByAltText(
      /Preview for Sunday Birthday Celebration/i
    ) as HTMLImageElement;
    expect(previewImg.getAttribute('src')).toBe(
      '/api/templates/tmpl-1111-1111-1111/versions/ver-1111-1111-1111/preview'
    );

    // Trigger page 2 -> error -> retry succeeds
    fireEvent.click(screen.getByRole('button', { name: /next/i }));
    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain(
        'Temporary catalog outage'
      );
    });

    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    await waitFor(() => {
      expect(screen.getByText(/Page 2 of 2/i)).toBeTruthy();
    });
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

  it('fetches non-active version mappings when switching versions, supports metadata editing, activation/rollback, and archive/restore', async () => {
    const fetchMock = vi.mocked(globalThis.fetch);
    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === 'string' ? input : input.toString();
      const method = init?.method ?? 'GET';

      if (
        url ===
          '/api/templates/tmpl-1111-1111-1111/versions/ver-2222-2222-2222' &&
        method === 'GET'
      ) {
        return createJsonResponse({ version: SAMPLE_VERSION_2 });
      }
      if (url === '/api/templates/tmpl-1111-1111-1111' && method === 'PATCH') {
        const body = JSON.parse(String(init?.body ?? '{}'));
        if (body.activeVersionId === 'ver-2222-2222-2222') {
          return createJsonResponse({
            template: {
              ...SAMPLE_TEMPLATE_DETAIL,
              activeVersion: SAMPLE_VERSION_2,
              activeMappings: SAMPLE_VERSION_2.mappings,
            },
          });
        }
        return createJsonResponse({
          template: {
            ...SAMPLE_TEMPLATE_DETAIL,
            name: body.name ?? SAMPLE_TEMPLATE_DETAIL.name,
            description: body.description ?? SAMPLE_TEMPLATE_DETAIL.description,
          },
        });
      }
      if (
        url === '/api/templates/tmpl-1111-1111-1111/archive' &&
        method === 'POST'
      ) {
        return createJsonResponse({
          template: {
            ...SAMPLE_TEMPLATE_DETAIL,
            isActive: false,
            archivedAt: '2026-11-23T12:00:00.000Z',
          },
        });
      }
      if (
        url === '/api/templates/tmpl-1111-1111-1111/restore' &&
        method === 'POST'
      ) {
        return createJsonResponse({
          template: {
            ...SAMPLE_TEMPLATE_DETAIL,
            isActive: true,
            archivedAt: null,
          },
        });
      }
      return createJsonResponse({ error: `Unexpected ${method} ${url}` }, 500);
    });

    render(<TemplateDetailClient initialTemplate={SAMPLE_TEMPLATE_DETAIL} />);

    expect(screen.getByText('Sunday Birthday Celebration')).toBeTruthy();
    expect(screen.getByText(/No \(Manual in Affinity\)/i)).toBeTruthy();
    expect(screen.getByDisplayValue('Celebrant_Name')).toBeTruthy();

    // Switch to Version 2 (non-active) -> loads its actual mappings from backend
    fireEvent.click(screen.getByRole('button', { name: /v2/i }));
    await waitFor(() => {
      expect(screen.getByDisplayValue('Portrait_Frame_V2')).toBeTruthy();
    });

    // Activate Version 2
    fireEvent.click(
      screen.getByRole('button', { name: /activate version 2/i })
    );
    await waitFor(() => {
      expect(
        screen.getByText(/Version 2 is now the active version/i)
      ).toBeTruthy();
    });

    // Edit template metadata
    fireEvent.click(screen.getByRole('button', { name: /edit details/i }));
    const nameInput = screen.getByLabelText(/template name/i);
    fireEvent.change(nameInput, {
      target: { value: 'Sunday Birthday Editorial' },
    });
    fireEvent.click(screen.getByRole('button', { name: /save details/i }));
    await waitFor(() => {
      expect(screen.getByText('Sunday Birthday Editorial')).toBeTruthy();
    });

    // Archive and restore
    fireEvent.click(screen.getByRole('button', { name: /^archive$/i }));
    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: /restore template/i })
      ).toBeTruthy();
    });

    fireEvent.click(screen.getByRole('button', { name: /restore template/i }));
    await waitFor(() => {
      expect(
        screen.getByText(/Template restored to active catalog/i)
      ).toBeTruthy();
    });
  });

  it('renders field mapping editor with manual verification notices, validation, and API save', async () => {
    const fetchMock = vi.mocked(globalThis.fetch);
    fetchMock.mockResolvedValueOnce(
      createJsonResponse({ mappings: SAMPLE_TEMPLATE_DETAIL.activeMappings })
    );

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

    // Save existing mappings
    fireEvent.click(screen.getByRole('button', { name: /save mappings/i }));
    await waitFor(() => {
      expect(
        screen.getByText(/Field mappings saved successfully/i)
      ).toBeTruthy();
    });

    // Add incomplete binding -> client validation catches it
    fireEvent.click(screen.getByRole('button', { name: /add field/i }));
    expect(screen.getByText(/2 bindings/i)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /save mappings/i }));
    await waitFor(() => {
      expect(
        screen.getByText(/Please resolve the highlighted field mapping errors/i)
      ).toBeTruthy();
    });
  });

  it('renders version preview card with companion image and missing preview fallback gracefully', () => {
    const { rerender } = render(
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

    rerender(
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

  it('validates upload modal fields, executes presigned upload with Blob, abandons both intents on failure, and retries without duplicating template creation', async () => {
    const onSuccess = vi.fn();
    const onClose = vi.fn();
    const fetchMock = vi.mocked(globalThis.fetch);

    let createTemplateCalls = 0;
    let putAttempts = 0;
    const abandonedIntents: string[] = [];

    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === 'string' ? input : input.toString();
      const method = init?.method ?? 'GET';

      if (url === '/api/templates' && method === 'POST') {
        createTemplateCalls += 1;
        return createJsonResponse({ template: SAMPLE_TEMPLATE_DETAIL }, 201);
      }
      if (
        url === '/api/templates/tmpl-1111-1111-1111/upload-intents' &&
        method === 'POST'
      ) {
        const payload = JSON.parse(String(init?.body ?? '{}'));
        const isMaster = payload.kind === 'TEMPLATE_MASTER';
        const intentId = isMaster
          ? `intent-master-${putAttempts + 1}`
          : `intent-preview-${putAttempts + 1}`;
        return createJsonResponse(
          {
            intent: {
              id: intentId,
              kind: payload.kind,
              status: 'PENDING',
              storageBucket: 'crelune-dev-creative',
              storageKey: `development/organisations/org/templates/tmpl-1111-1111-1111/staging/${intentId}`,
              expectedMimeType: payload.mimeType,
              expectedByteSize: payload.byteSize,
              maxAllowedBytes: 100 * 1024 * 1024,
              expiresAt: '2026-11-23T14:00:00.000Z',
            },
            upload: {
              url: `https://storage.example.test/${intentId}`,
              method: 'PUT',
              requiredHeaders: {
                'content-type': payload.mimeType,
                'content-length': String(payload.byteSize),
              },
              expiresAt: '2026-11-23T14:00:00.000Z',
            },
          },
          201
        );
      }
      if (url.startsWith('https://storage.example.test/') && method === 'PUT') {
        // Confirm browser-safe Blob payload (not Node Buffer)
        expect(init?.body instanceof Blob).toBe(true);
        putAttempts += 1;
        if (putAttempts === 1) {
          return new Response('', { status: 502 });
        }
        return new Response('', { status: 200 });
      }
      if (
        url.startsWith('/api/templates/upload-intents/') &&
        url.endsWith('/abandon') &&
        method === 'POST'
      ) {
        abandonedIntents.push(url);
        return createJsonResponse({ intent: { status: 'ABANDONED' } }, 200);
      }
      if (
        url === '/api/templates/tmpl-1111-1111-1111/versions' &&
        method === 'POST'
      ) {
        return createJsonResponse(
          {
            version: {
              template: SAMPLE_TEMPLATE_DETAIL,
              version: SAMPLE_VERSION_2,
              inspection: null,
              editabilityVerified: false,
            },
          },
          201
        );
      }

      return createJsonResponse({ error: `Unexpected ${method} ${url}` }, 500);
    });

    render(
      <TemplateUploadModal
        isOpen={true}
        onClose={onClose}
        onSuccess={onSuccess}
      />
    );

    // 1. Empty submit triggers client validation
    fireEvent.click(screen.getByRole('button', { name: /^upload template$/i }));
    await waitFor(() => {
      expect(
        screen.getByText(/Template name must be at least 2 characters/i)
      ).toBeTruthy();
    });

    // 2. Attach master + preview files (with jsdom-compatible arrayBuffer)
    const masterFile = new File([new Uint8Array([0x38, 0x42, 0x50, 0x53])], 'flyer.psd', {
      type: 'image/vnd.adobe.photoshop',
    });
    Object.defineProperty(masterFile, 'arrayBuffer', {
      value: async () => new Uint8Array([0x38, 0x42, 0x50, 0x53]).buffer,
    });
    const previewFile = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], 'preview.png', {
      type: 'image/png',
    });
    Object.defineProperty(previewFile, 'arrayBuffer', {
      value: async () => new Uint8Array([0x89, 0x50, 0x4e, 0x47]).buffer,
    });

    const masterInput = document.getElementById('master-file-input') as HTMLInputElement;
    const previewInput = document.getElementById('preview-file-input') as HTMLInputElement;
    fireEvent.change(masterInput, { target: { files: [masterFile] } });
    fireEvent.change(previewInput, { target: { files: [previewFile] } });

    // 3. First attempt fails on S3 PUT -> BOTH intents abandoned, Retry offered
    fireEvent.click(screen.getByRole('button', { name: /^upload template$/i }));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /retry upload/i })).toBeTruthy();
    });
    expect(createTemplateCalls).toBe(1);
    expect(abandonedIntents).toHaveLength(2);

    // 4. Retry succeeds without calling POST /api/templates a second time
    fireEvent.click(screen.getByRole('button', { name: /retry upload/i }));
    await waitFor(() => {
      expect(onSuccess).toHaveBeenCalledWith(SAMPLE_TEMPLATE_DETAIL);
    });
    expect(createTemplateCalls).toBe(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
