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
import type { DesignJobPreparationSnapshot } from '@crelune/shared';
import { DesignJobPreparationPanel } from '@/components/designs/DesignJobPreparationPanel';

const SAMPLE_SHA = 'c'.repeat(64);

const READY_PREPARATION_SNAPSHOT: DesignJobPreparationSnapshot = {
  designJobId: 'job-s54-001',
  ready: true,
  issues: [],
  warnings: [
    {
      code: 'PINNED_OLDER_VERSION',
      severity: 'WARNING',
      message:
        'This job remains strictly pinned to v1 even though a newer active template version exists.',
    },
  ],
  binding: {
    templateId: 'tpl-s54-001',
    templateName: 'Sunday Birthday Editorial',
    templateCategory: 'BIRTHDAY_FLYER',
    templateStudioType: 'AFFINITY_DESIGNER',
    templateIsActive: true,
    templateVersionId: 'ver-s54-001',
    versionNumber: 1,
    format: 'PSD',
    originalFilename: 'birthday-editorial.psd',
    byteSize: 4096,
    sha256: SAMPLE_SHA,
    widthPx: 1080,
    heightPx: 1350,
    hasPreview: true,
    inspectionStatus: 'MANUAL_REQUIRED',
    activeVersionId: 'ver-s54-002',
    isPinnedToOlderVersion: true,
  },
  defaultExportFormats: ['PNG'],
  manifestPreview: {
    manifestVersion: 1,
    dispatchId: 'preview_job-s54-001',
    designJobId: 'job-s54-001',
    organisationId: 'org-s54-001',
    templateId: 'tpl-s54-001',
    templateVersionId: 'ver-s54-001',
    templateFormat: 'PSD',
    templateStudioType: 'AFFINITY_DESIGNER',
    templateSha256: SAMPLE_SHA,
    templateRelativeFilename: 'templates/birthday-editorial.psd',
    preserveMasterImmutable: true,
    publicationRule: 'EXPORT_DOES_NOT_PUBLISH',
    outputSpec: {
      formats: ['PNG'],
      targetPlatform: 'Instagram',
      dimensions: '1080x1350px',
    },
    fields: [
      {
        fieldKey: 'member.fullName',
        fieldType: 'TEXT',
        targetLayerName: 'Celebrant_Name',
        layerPath: ['Header'],
        textValue: 'Ama Mensah',
        assetReference: null,
      },
      {
        fieldKey: 'member.photo',
        fieldType: 'IMAGE',
        targetLayerName: 'Portrait_Frame',
        layerPath: null,
        textValue: null,
        assetReference: {
          assetKind: 'MEMBER_PHOTO',
          assetId: 'mem-1',
          expectedSha256: null,
          suggestedRelativeFilename: 'assets/member-photo-mem-1.jpg',
        },
      },
    ],
    createdAt: '2026-11-23T12:00:00.000Z',
    designJobTitle: 'Ama Mensah Birthday Flyer',
    designCategory: 'BIRTHDAY_FLYER',
    templateName: 'Sunday Birthday Editorial',
    templateVersionNumber: 1,
    templateByteSize: 4096,
    manualModeNotice:
      'CRELUNE prepares validated manifests and pinned master files without automatically modifying Affinity documents in the browser.',
  },
  dispatches: [],
  exports: [
    {
      id: 'exp-s54-001',
      designJobId: 'job-s54-001',
      dispatchId: null,
      format: 'PNG',
      mimeType: 'image/png',
      byteSize: 8192,
      sha256: 'd'.repeat(64),
      widthPx: 1080,
      heightPx: 1350,
      resolutionDpi: 300,
      isApprovedForPublish: false,
      ownerApprovedAt: null,
      publishedAt: null,
      createdAt: '2026-11-23T12:05:00.000Z',
    },
  ],
  hasActiveDispatch: false,
  manualFallback: {
    available: true,
    manifestDownloadPath: '/api/designs/job-s54-001/preparation/manifest',
    templateMasterDownloadPath: '/api/designs/job-s54-001/preparation/master',
    memberPhotoDownloadPath: '/api/members/mem-1/photo',
    notice:
      'CRELUNE prepares validated manifests and pinned master files without automatically modifying Affinity documents in the browser.',
  },
};

function createJsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('Stage 5.4 Creative Job Preparation UI Panel', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    cleanup();
    globalThis.fetch = originalFetch;
  });

  it('displays pinned historical template version, resolved fields, manual fallback links, and queues a dispatch', async () => {
    const fetchMock = vi.mocked(globalThis.fetch);
    const onJobUpdated = vi.fn();

    fetchMock
      .mockResolvedValueOnce(
        createJsonResponse(
          {
            dispatch: {
              id: 'disp_new_123',
              designJobId: 'job-s54-001',
              templateVersionId: 'ver-s54-001',
              assignedAgentId: null,
              manifestVersion: 1,
              status: 'QUEUED',
              claimedAt: null,
              readyForArtistAt: null,
              completedAt: null,
              failedAt: null,
              errorCode: null,
              errorMessage: null,
              createdAt: '2026-11-23T12:10:00.000Z',
              updatedAt: '2026-11-23T12:10:00.000Z',
            },
            manifest: READY_PREPARATION_SNAPSHOT.manifestPreview,
            idempotentReplay: false,
          },
          201
        )
      )
      .mockResolvedValueOnce(
        createJsonResponse({
          preparation: {
            ...READY_PREPARATION_SNAPSHOT,
            hasActiveDispatch: true,
            dispatches: [
              {
                id: 'disp_new_123',
                designJobId: 'job-s54-001',
                templateVersionId: 'ver-s54-001',
                assignedAgentId: null,
                manifestVersion: 1,
                status: 'QUEUED',
                claimedAt: null,
                readyForArtistAt: null,
                completedAt: null,
                failedAt: null,
                errorCode: null,
                errorMessage: null,
                createdAt: '2026-11-23T12:10:00.000Z',
                updatedAt: '2026-11-23T12:10:00.000Z',
              },
            ],
          },
        })
      );

    render(
      <DesignJobPreparationPanel
        jobId="job-s54-001"
        initialPreparation={READY_PREPARATION_SNAPSHOT}
        onJobUpdated={onJobUpdated}
      />
    );

    expect(screen.getByText('Sunday Birthday Editorial')).toBeTruthy();
    expect(screen.getByText(/Pinned to Historical Version/i)).toBeTruthy();
    expect(screen.getByText('Ama Mensah')).toBeTruthy();
    expect(screen.getByText(/Download Manifest JSON/i)).toBeTruthy();
    expect(screen.getByText(/Download Pinned Master/i)).toBeTruthy();
    expect(screen.getByText(/Download Member Photo/i)).toBeTruthy();

    fireEvent.click(
      screen.getByRole('button', { name: /prepare & queue dispatch/i })
    );

    await waitFor(() => {
      expect(screen.getAllByText(/disp_new_123/i).length).toBeGreaterThanOrEqual(
        1
      );
    });
    expect(onJobUpdated).toHaveBeenCalledTimes(1);
  });

  it('shows blocking missing asset/field issues without fabricating content and allows toggling publish approval on exports', async () => {
    const fetchMock = vi.mocked(globalThis.fetch);
    fetchMock
      .mockResolvedValueOnce(
        createJsonResponse({
          exportRecord: {
            ...READY_PREPARATION_SNAPSHOT.exports[0],
            isApprovedForPublish: true,
            ownerApprovedAt: '2026-11-23T12:15:00.000Z',
          },
        })
      )
      .mockResolvedValueOnce(
        createJsonResponse({
          preparation: {
            ...READY_PREPARATION_SNAPSHOT,
            ready: false,
            issues: [
              {
                code: 'MISSING_REQUIRED_ASSET',
                severity: 'ERROR',
                fieldKey: 'member.photo',
                message:
                  'Linked member does not have an uploaded profile photograph.',
              },
            ],
            exports: [
              {
                ...READY_PREPARATION_SNAPSHOT.exports[0],
                isApprovedForPublish: true,
                ownerApprovedAt: '2026-11-23T12:15:00.000Z',
              },
            ],
          },
        })
      );

    render(
      <DesignJobPreparationPanel
        jobId="job-s54-001"
        initialPreparation={{
          ...READY_PREPARATION_SNAPSHOT,
          ready: false,
          issues: [
            {
              code: 'MISSING_REQUIRED_ASSET',
              severity: 'ERROR',
              fieldKey: 'member.photo',
              message:
                'Linked member does not have an uploaded profile photograph.',
            },
          ],
        }}
      />
    );

    expect(
      screen.getByText(
        /Linked member does not have an uploaded profile photograph/i
      )
    ).toBeTruthy();

    const queueButton = screen.getByRole('button', {
      name: /prepare & queue dispatch/i,
    }) as HTMLButtonElement;
    expect(queueButton.disabled).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: /approve export/i }));
    await waitFor(() => {
      expect(
        screen.getAllByText(/Approved for Publish/i).length
      ).toBeGreaterThanOrEqual(1);
    });
  });

  it('surfaces owner intervention notice for stranded READY_FOR_ARTIST dispatches and triggers explicit Release & Requeue recovery', async () => {
    const fetchMock = vi.mocked(globalThis.fetch);
    fetchMock
      .mockResolvedValueOnce(
        createJsonResponse({
          dispatch: {
            id: 'disp_artist_1',
            designJobId: 'job-s54-001',
            templateVersionId: 'ver-s54-001',
            assignedAgentId: null,
            manifestVersion: 1,
            status: 'QUEUED',
            claimedAt: null,
            leaseExpiresAt: null,
            readyForArtistAt: null,
            completedAt: null,
            failedAt: null,
            errorCode: null,
            errorMessage: null,
            requiresOwnerIntervention: false,
            interventionReason: null,
            createdAt: '2026-11-23T12:10:00.000Z',
            updatedAt: '2026-11-23T12:25:00.000Z',
          },
        })
      )
      .mockResolvedValueOnce(
        createJsonResponse({
          preparation: {
            ...READY_PREPARATION_SNAPSHOT,
            hasActiveDispatch: true,
            dispatches: [
              {
                id: 'disp_artist_1',
                designJobId: 'job-s54-001',
                templateVersionId: 'ver-s54-001',
                assignedAgentId: null,
                manifestVersion: 1,
                status: 'QUEUED',
                claimedAt: null,
                leaseExpiresAt: null,
                readyForArtistAt: null,
                completedAt: null,
                failedAt: null,
                errorCode: null,
                errorMessage: null,
                requiresOwnerIntervention: false,
                interventionReason: null,
                createdAt: '2026-11-23T12:10:00.000Z',
                updatedAt: '2026-11-23T12:25:00.000Z',
              },
            ],
          },
        })
      );

    render(
      <DesignJobPreparationPanel
        jobId="job-s54-001"
        initialPreparation={{
          ...READY_PREPARATION_SNAPSHOT,
          hasActiveDispatch: true,
          dispatches: [
            {
              id: 'disp_artist_1',
              designJobId: 'job-s54-001',
              templateVersionId: 'ver-s54-001',
              assignedAgentId: 'agt_revoked_1',
              manifestVersion: 1,
              status: 'READY_FOR_ARTIST',
              claimedAt: '2026-11-23T12:10:00.000Z',
              leaseExpiresAt: null,
              readyForArtistAt: '2026-11-23T12:11:00.000Z',
              completedAt: null,
              failedAt: null,
              errorCode: 'AGENT_REVOKED_INTERVENTION_REQUIRED',
              errorMessage: 'Assigned agent was revoked.',
              requiresOwnerIntervention: true,
              interventionReason:
                'Assigned agent was revoked while artist edits may be in progress.',
              createdAt: '2026-11-23T12:10:00.000Z',
              updatedAt: '2026-11-23T12:15:00.000Z',
            },
          ],
        }}
      />
    );

    expect(screen.getByText(/Owner Action Required/i)).toBeTruthy();
    const recoverBtn = screen.getByRole('button', {
      name: /Release & Requeue/i,
    });
    fireEvent.click(recoverBtn);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/designs/job-s54-001/dispatches/disp_artist_1/recover',
        expect.objectContaining({ method: 'POST' })
      );
    });
    expect(
      screen.getByText(/Existing local working copies will be preserved/i)
    ).toBeTruthy();
  });
});
