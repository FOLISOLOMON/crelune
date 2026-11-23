'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Download,
  ExternalLink,
  FileCode2,
  FileUp,
  Info,
  Layers,
  Loader2,
  Send,
  ShieldCheck,
  XCircle,
} from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@crelune/ui';
import {
  ACTIVE_CREATIVE_DISPATCH_STATUSES,
  CREATIVE_BYTE_LIMITS,
  EXPORT_FILE_FORMATS,
  type CreativeDispatchStatus,
  type DesignJobPreparationSnapshot,
  type ExportFileFormat,
} from '@crelune/shared';
import {
  cancelCreativeDispatchRequest,
  completeExportRecordRequest,
  createCreativeDispatchRequest,
  createExportUploadIntentRequest,
  DesignApiError,
  fetchDesignJobPreparationRequest,
  setExportPublishApprovalRequest,
} from '@/lib/designs/design-api-client';
import { uploadBytesToPresignedUrl } from '@/lib/templates/template-api-client';
import {
  computeBufferSha256Hex,
  formatByteSize,
  formatDateTimeDisplay,
  TEMPLATE_STUDIO_LABELS,
} from '@/lib/templates/template-ui-utils';

export interface DesignJobPreparationPanelProps {
  jobId: string;
  initialPreparation: DesignJobPreparationSnapshot | null;
  onJobUpdated?: () => void;
}

function getDispatchBadgeVariant(
  status: CreativeDispatchStatus
): 'default' | 'primary' | 'success' | 'warning' | 'error' | 'info' {
  switch (status) {
    case 'EXPORTED':
      return 'success';
    case 'QUEUED':
      return 'info';
    case 'CLAIMED':
    case 'DOWNLOADING_ASSETS':
    case 'OPENING_TEMPLATE':
    case 'EXPORTING':
      return 'primary';
    case 'READY_FOR_ARTIST':
      return 'warning';
    case 'FAILED':
    case 'CANCELLED':
      return 'error';
    default:
      return 'default';
  }
}

function detectExportFormat(file: File): {
  format: ExportFileFormat;
  mimeType: string;
} | null {
  const name = file.name.toLowerCase();
  if (name.endsWith('.png') || file.type === 'image/png') {
    return { format: 'PNG', mimeType: 'image/png' };
  }
  if (
    name.endsWith('.jpg') ||
    name.endsWith('.jpeg') ||
    file.type === 'image/jpeg'
  ) {
    return { format: 'JPEG', mimeType: 'image/jpeg' };
  }
  if (name.endsWith('.pdf') || file.type === 'application/pdf') {
    return { format: 'PDF', mimeType: 'application/pdf' };
  }
  return null;
}

export function DesignJobPreparationPanel({
  jobId,
  initialPreparation,
  onJobUpdated,
}: DesignJobPreparationPanelProps) {
  const [preparation, setPreparation] =
    useState<DesignJobPreparationSnapshot | null>(initialPreparation);
  const [selectedFormats, setSelectedFormats] = useState<ExportFileFormat[]>(
    () => initialPreparation?.defaultExportFormats ?? ['PNG']
  );
  const [customValues, setCustomValues] = useState<Record<string, string>>({});
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isDispatching, setIsDispatching] = useState(false);
  const [cancellingDispatchId, setCancellingDispatchId] = useState<
    string | null
  >(null);
  const [isUploadingExport, setIsUploadingExport] = useState(false);
  const [togglingExportId, setTogglingExportId] = useState<string | null>(null);
  const [panelError, setPanelError] = useState<string | null>(null);
  const [panelSuccess, setPanelSuccess] = useState<string | null>(null);

  const refreshPreparation = async () => {
    setIsRefreshing(true);
    try {
      const fresh = await fetchDesignJobPreparationRequest(jobId);
      setPreparation(fresh);
    } catch (err) {
      setPanelError(
        err instanceof DesignApiError
          ? err.message
          : 'Unable to refresh job preparation status.'
      );
    } finally {
      setIsRefreshing(false);
    }
  };

  const toggleExportFormat = (format: ExportFileFormat) => {
    setSelectedFormats((prev) => {
      if (prev.includes(format)) {
        return prev.length > 1 ? prev.filter((f) => f !== format) : prev;
      }
      return [...prev, format];
    });
  };

  const handlePrepareDispatch = async () => {
    if (!preparation?.binding || isDispatching) return;
    setIsDispatching(true);
    setPanelError(null);
    setPanelSuccess(null);

    const cleanedCustomValues: Record<string, string> = {};
    for (const [k, v] of Object.entries(customValues)) {
      if (v.trim()) {
        cleanedCustomValues[k] = v.trim();
      }
    }

    try {
      const res = await createCreativeDispatchRequest(jobId, {
        designJobId: jobId,
        templateVersionId: preparation.binding.templateVersionId,
        exportFormats: selectedFormats,
        idempotencyKey: `prep_${jobId}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        ...(Object.keys(cleanedCustomValues).length > 0
          ? { customFieldValues: cleanedCustomValues }
          : {}),
      });
      setPanelSuccess(
        `Creative job dispatch ${res.dispatch.id} queued and pinned to ${preparation.binding.templateName} v${preparation.binding.versionNumber}.`
      );
      await refreshPreparation();
      onJobUpdated?.();
    } catch (err) {
      setPanelError(
        err instanceof DesignApiError
          ? err.message
          : 'Unable to prepare creative dispatch.'
      );
    } finally {
      setIsDispatching(false);
    }
  };

  const handleCancelDispatch = async (dispatchId: string) => {
    if (cancellingDispatchId) return;
    setCancellingDispatchId(dispatchId);
    setPanelError(null);
    setPanelSuccess(null);
    try {
      await cancelCreativeDispatchRequest(
        jobId,
        dispatchId,
        'Cancelled by owner from Design Brief.'
      );
      setPanelSuccess(`Dispatch ${dispatchId} cancelled.`);
      await refreshPreparation();
    } catch (err) {
      setPanelError(
        err instanceof DesignApiError
          ? err.message
          : 'Unable to cancel creative dispatch.'
      );
    } finally {
      setCancellingDispatchId(null);
    }
  };

  const handleManualExportUpload = async (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || isUploadingExport) return;

    setPanelError(null);
    setPanelSuccess(null);

    const detected = detectExportFormat(file);
    if (!detected) {
      setPanelError(
        'Unsupported export file. Upload a PNG, JPEG, or PDF deliverable.'
      );
      return;
    }
    if (file.size === 0 || file.size > CREATIVE_BYTE_LIMITS.EXPORT_DELIVERABLE_MAX_BYTES) {
      setPanelError(
        `Export file must be between 1 byte and ${formatByteSize(CREATIVE_BYTE_LIMITS.EXPORT_DELIVERABLE_MAX_BYTES)}.`
      );
      return;
    }

    setIsUploadingExport(true);
    try {
      const buffer = await file.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      const sha256 = await computeBufferSha256Hex(bytes);

      const intentRes = await createExportUploadIntentRequest(jobId, {
        designJobId: jobId,
        format: detected.format,
        originalFilename: file.name,
        mimeType: detected.mimeType,
        byteSize: bytes.byteLength,
        sha256,
        idempotencyKey: `export_${jobId}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      });

      await uploadBytesToPresignedUrl(intentRes.upload, bytes);

      await completeExportRecordRequest(jobId, {
        designJobId: jobId,
        uploadIntentId: intentRes.intent.id,
        format: detected.format,
        mimeType: detected.mimeType,
      });

      setPanelSuccess(
        `Verified ${detected.format} deliverable uploaded. Exporting does not automatically publish this design.`
      );
      await refreshPreparation();
      onJobUpdated?.();
    } catch (err) {
      setPanelError(
        err instanceof Error
          ? err.message
          : 'Unable to upload and verify export deliverable.'
      );
    } finally {
      setIsUploadingExport(false);
    }
  };

  const handleTogglePublishApproval = async (
    exportId: string,
    nextApproved: boolean
  ) => {
    if (togglingExportId) return;
    setTogglingExportId(exportId);
    setPanelError(null);
    setPanelSuccess(null);
    try {
      await setExportPublishApprovalRequest(jobId, exportId, {
        isApprovedForPublish: nextApproved,
      });
      setPanelSuccess(
        nextApproved
          ? 'Export deliverable marked approved for publishing. Move job to Published manually after posting.'
          : 'Export publish approval revoked.'
      );
      await refreshPreparation();
    } catch (err) {
      setPanelError(
        err instanceof DesignApiError
          ? err.message
          : 'Unable to update export approval.'
      );
    } finally {
      setTogglingExportId(null);
    }
  };

  if (!preparation) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Creative Job Preparation</CardTitle>
          <CardDescription>
            Load template binding and job preparation manifest details.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={refreshPreparation}
            isLoading={isRefreshing}
          >
            Load Preparation Details
          </Button>
        </CardContent>
      </Card>
    );
  }

  const customOrEventFields = (preparation.manifestPreview?.fields ?? []).filter(
    (f) => f.fieldKey.startsWith('custom.') || f.fieldKey.startsWith('event.')
  );

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Layers className="h-4 w-4 text-[#6541A5]" />
            <CardTitle>Creative Job Preparation &amp; Deliverables</CardTitle>
          </div>
          <Badge variant={preparation.ready ? 'success' : 'warning'} size="sm">
            {preparation.ready ? 'Manifest Ready' : 'Action Required'}
          </Badge>
        </div>
        <CardDescription>
          Bind an exact immutable template version, validate mapped fields, queue for the Windows Creative Agent, or prepare manually in Affinity 3.3.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-5">
        {panelSuccess && (
          <div
            role="status"
            className="flex items-center gap-2 rounded-lg border border-[#BBF7D0] bg-[#F0FDF4] px-3.5 py-2.5 text-xs font-medium text-[#166534]"
          >
            <CheckCircle2 className="h-4 w-4 shrink-0 text-[#16A34A]" />
            <span>{panelSuccess}</span>
          </div>
        )}

        {panelError && (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-lg border border-[#FECACA] bg-[#FEF2F2] p-3 text-xs text-[#991B1B]"
          >
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-[#DC2626]" />
            <span>{panelError}</span>
          </div>
        )}

        {/* 1. Pinned Template Version Summary */}
        <div className="rounded-xl border border-[#E8E5ED] bg-[#F8F7FA] p-4 space-y-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-[#6541A5]">
              Pinned Template Version
            </p>
            {preparation.binding && (
              <Link
                href={`/templates/${encodeURIComponent(preparation.binding.templateId)}`}
                className="inline-flex items-center gap-1 text-xs font-medium text-[#6541A5] hover:underline"
              >
                Inspect Template
                <ExternalLink className="h-3 w-3" />
              </Link>
            )}
          </div>

          {preparation.binding ? (
            <div className="space-y-1.5 text-xs">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-semibold text-[#24212B]">
                  {preparation.binding.templateName}
                </span>
                <Badge variant="primary" size="sm">
                  Pinned v{preparation.binding.versionNumber} ({preparation.binding.format})
                </Badge>
                <Badge variant="default" size="sm">
                  {TEMPLATE_STUDIO_LABELS[preparation.binding.templateStudioType] ||
                    preparation.binding.templateStudioType}
                </Badge>
                {preparation.binding.isPinnedToOlderVersion && (
                  <Badge variant="warning" size="sm">
                    Pinned to Historical Version
                  </Badge>
                )}
              </div>
              <p className="text-[11px] text-[#77727F]">
                Master: <strong className="text-[#24212B]">{preparation.binding.originalFilename}</strong> ·{' '}
                {formatByteSize(preparation.binding.byteSize)} · SHA-256{' '}
                <code className="font-mono">{preparation.binding.sha256.slice(0, 14)}…</code>
              </p>
            </div>
          ) : (
            <p className="text-xs text-[#77727F]">
              No registered template is bound to this design job yet. Click{' '}
              <strong>Edit Brief</strong> above to select a template and pin an exact version.
            </p>
          )}
        </div>

        {/* 2. Blocking Validation Issues & Warnings */}
        {preparation.issues.length > 0 && (
          <div className="rounded-xl border border-rose-200 bg-rose-50/80 p-3.5 space-y-1.5 text-xs text-rose-900">
            <div className="flex items-center gap-1.5 font-semibold">
              <AlertCircle className="h-4 w-4 text-rose-600" />
              <span>Required Before Preparation ({preparation.issues.length})</span>
            </div>
            <ul className="list-disc pl-5 space-y-1">
              {preparation.issues.map((issue, idx) => (
                <li key={`${issue.code}-${idx}`}>{issue.message}</li>
              ))}
            </ul>
          </div>
        )}

        {preparation.warnings.length > 0 && (
          <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-3.5 space-y-1.5 text-xs text-amber-900">
            <div className="flex items-center gap-1.5 font-semibold">
              <AlertTriangle className="h-4 w-4 text-amber-700" />
              <span>Preparation Notes &amp; Reminders</span>
            </div>
            <ul className="list-disc pl-5 space-y-1 text-[11px]">
              {preparation.warnings.map((w, idx) => (
                <li key={`${w.code}-${idx}`}>{w.message}</li>
              ))}
            </ul>
          </div>
        )}

        {/* 3. Resolved Mapped Fields Preview */}
        {preparation.manifestPreview && (
          <div className="space-y-2.5">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-semibold text-[#24212B]">
                Resolved Field Mappings ({preparation.manifestPreview.fields.length})
              </h4>
              <span className="text-[11px] text-[#77727F]">
                Manifest v{preparation.manifestPreview.manifestVersion} · Zero secrets embedded
              </span>
            </div>

            {preparation.manifestPreview.fields.length === 0 ? (
              <p className="rounded-lg border border-dashed border-[#E8E5ED] bg-[#F8F7FA] p-3 text-xs text-[#77727F]">
                No layer field mappings defined on this template version.
              </p>
            ) : (
              <div className="overflow-x-auto rounded-xl border border-[#E8E5ED]">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-[#E8E5ED] bg-[#F8F7FA] text-[11px] text-[#77727F]">
                      <th className="px-3 py-2 font-semibold">Field Key</th>
                      <th className="px-3 py-2 font-semibold">Target Layer</th>
                      <th className="px-3 py-2 font-semibold">Resolved Value</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#E8E5ED] bg-white">
                    {preparation.manifestPreview.fields.map((field) => (
                      <tr key={field.fieldKey}>
                        <td className="px-3 py-2 font-mono text-[11px] text-[#6541A5]">
                          {field.fieldKey}
                        </td>
                        <td className="px-3 py-2 text-[#24212B]">
                          {field.targetLayerName}
                          {field.layerPath && field.layerPath.length > 0 && (
                            <span className="block text-[10px] text-[#77727F]">
                              Path: {field.layerPath.join(' / ')}
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-[#24212B]">
                          {field.assetReference ? (
                            <Badge variant="success" size="sm">
                              Asset: {field.assetReference.suggestedRelativeFilename}
                            </Badge>
                          ) : field.textValue ? (
                            <span className="break-words">{field.textValue}</span>
                          ) : (
                            <span className="italic text-rose-700">
                              Unresolved (not fabricated)
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Optional Custom / Event Overrides */}
            {customOrEventFields.length > 0 && (
              <div className="rounded-xl border border-[#E8E5ED] bg-[#F8F7FA]/60 p-3 space-y-2">
                <p className="text-[11px] font-semibold text-[#24212B]">
                  Supply Custom Field Values for Dispatch
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  {customOrEventFields.map((field) => (
                    <div key={field.fieldKey} className="space-y-1">
                      <label
                        htmlFor={`custom-field-${field.fieldKey}`}
                        className="block text-[11px] font-medium text-[#77727F]"
                      >
                        {field.fieldKey} ({field.targetLayerName})
                      </label>
                      <input
                        id={`custom-field-${field.fieldKey}`}
                        type="text"
                        value={customValues[field.fieldKey] ?? ''}
                        onChange={(e) =>
                          setCustomValues((prev) => ({
                            ...prev,
                            [field.fieldKey]: e.target.value,
                          }))
                        }
                        placeholder={field.textValue || 'Enter value...'}
                        className="h-8.5 w-full rounded-lg border border-[#E8E5ED] bg-white px-2.5 text-xs text-[#24212B]"
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* 4. Queue Dispatch for Windows Creative Agent & Manual Preparation Fallback */}
        {preparation.binding && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Agent Dispatch Path */}
            <div className="rounded-xl border border-[#E8E5ED] bg-white p-4 space-y-3">
              <div>
                <h4 className="text-xs font-semibold text-[#24212B]">
                  Windows Creative Agent Queue
                </h4>
                <p className="mt-0.5 text-[11px] text-[#77727F]">
                  Create a traceable, version-pinned job dispatch for your local Windows Creative Agent.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-3 text-xs">
                <span className="text-[11px] font-medium text-[#77727F]">
                  Output Formats:
                </span>
                {EXPORT_FILE_FORMATS.map((fmt) => (
                  <label
                    key={fmt}
                    className="inline-flex items-center gap-1.5 cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={selectedFormats.includes(fmt)}
                      onChange={() => toggleExportFormat(fmt)}
                      className="h-3.5 w-3.5 rounded border-[#E8E5ED] text-[#6541A5]"
                    />
                    <span>{fmt}</span>
                  </label>
                ))}
              </div>

              <Button
                type="button"
                variant="primary"
                size="sm"
                onClick={handlePrepareDispatch}
                isLoading={isDispatching}
                disabled={
                  preparation.hasActiveDispatch ||
                  (!preparation.ready && customOrEventFields.length === 0)
                }
                className="w-full"
              >
                <Send className="h-3.5 w-3.5 mr-1.5" />
                {preparation.hasActiveDispatch
                  ? 'Active Dispatch Already Queued'
                  : 'Prepare & Queue Dispatch'}
              </Button>
            </div>

            {/* Standalone Manual Preparation Fallback */}
            <div className="rounded-xl border border-[#E8E5ED] bg-[#F8F7FA]/70 p-4 space-y-3">
              <div>
                <h4 className="text-xs font-semibold text-[#24212B]">
                  Manual Preparation Fallback (No Agent Needed)
                </h4>
                <p className="mt-0.5 text-[11px] text-[#77727F]">
                  {preparation.manualFallback.notice}
                </p>
              </div>

              <div className="flex flex-wrap gap-2">
                {preparation.manualFallback.available && (
                  <a
                    href={preparation.manualFallback.manifestDownloadPath}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-[#E8E5ED] bg-white px-3 py-1.5 text-xs font-medium text-[#24212B] hover:border-[#6541A5] hover:text-[#6541A5]"
                  >
                    <FileCode2 className="h-3.5 w-3.5" />
                    Download Manifest JSON
                  </a>
                )}
                {preparation.manualFallback.templateMasterDownloadPath && (
                  <a
                    href={preparation.manualFallback.templateMasterDownloadPath}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-[#E8E5ED] bg-white px-3 py-1.5 text-xs font-medium text-[#24212B] hover:border-[#6541A5] hover:text-[#6541A5]"
                  >
                    <Download className="h-3.5 w-3.5" />
                    Download Pinned Master
                  </a>
                )}
                {preparation.manualFallback.memberPhotoDownloadPath && (
                  <a
                    href={preparation.manualFallback.memberPhotoDownloadPath}
                    download
                    className="inline-flex items-center gap-1.5 rounded-lg border border-[#E8E5ED] bg-white px-3 py-1.5 text-xs font-medium text-[#24212B] hover:border-[#6541A5] hover:text-[#6541A5]"
                  >
                    <Download className="h-3.5 w-3.5" />
                    Download Member Photo
                  </a>
                )}
              </div>
            </div>
          </div>
        )}

        {/* 5. Active & Historical Creative Dispatches */}
        {preparation.dispatches.length > 0 && (
          <div className="space-y-2">
            <h4 className="text-xs font-semibold text-[#24212B]">
              Preparation Dispatches ({preparation.dispatches.length})
            </h4>
            <ul className="space-y-2">
              {preparation.dispatches.map((disp) => {
                const isActive = ACTIVE_CREATIVE_DISPATCH_STATUSES.includes(
                  disp.status
                );
                return (
                  <li
                    key={disp.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[#E8E5ED] bg-white px-3.5 py-2.5 text-xs"
                  >
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-2">
                        <code className="font-mono text-[11px] font-semibold text-[#24212B]">
                          {disp.id}
                        </code>
                        <Badge
                          variant={getDispatchBadgeVariant(disp.status)}
                          size="sm"
                        >
                          {disp.status}
                        </Badge>
                      </div>
                      <p className="text-[11px] text-[#77727F]">
                        Created {formatDateTimeDisplay(disp.createdAt)}
                        {disp.errorMessage ? ` · ${disp.errorMessage}` : ''}
                      </p>
                    </div>
                    {isActive && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        isLoading={cancellingDispatchId === disp.id}
                        onClick={() => handleCancelDispatch(disp.id)}
                      >
                        <XCircle className="h-3.5 w-3.5 mr-1 text-rose-600" />
                        Cancel Dispatch
                      </Button>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        {/* 6. Export Deliverables & Explicit Publish Approval */}
        <div className="border-t border-[#E8E5ED] pt-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h4 className="text-xs font-semibold text-[#24212B]">
                Verified Export Deliverables ({preparation.exports.length})
              </h4>
              <p className="text-[11px] text-[#77727F]">
                Upload exported PNG, JPEG, or PDF files manually or receive verified exports from the Windows Creative Agent.
              </p>
            </div>

            <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-[#E8E5ED] bg-white px-3 py-1.5 text-xs font-medium text-[#24212B] hover:border-[#6541A5] hover:text-[#6541A5]">
              {isUploadingExport ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <FileUp className="h-3.5 w-3.5" />
              )}
              <span>
                {isUploadingExport ? 'Verifying Export...' : 'Upload Export Deliverable'}
              </span>
              <input
                type="file"
                accept=".png,.jpg,.jpeg,.pdf,image/png,image/jpeg,application/pdf"
                onChange={handleManualExportUpload}
                disabled={isUploadingExport}
                className="hidden"
              />
            </label>
          </div>

          <div className="flex items-start gap-2 rounded-lg border border-[#D3CAEC] bg-[#EFEBF8]/50 px-3 py-2 text-[11px] text-[#24212B]">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#6541A5]" />
            <span>
              Exported files are stored privately and never published automatically. Review each deliverable and mark <strong>Published</strong> explicitly in the Production Pipeline above after posting.
            </span>
          </div>

          {preparation.exports.length === 0 ? (
            <p className="text-xs text-[#77727F]">
              No export deliverables uploaded for this design job yet.
            </p>
          ) : (
            <ul className="space-y-2">
              {preparation.exports.map((exp) => (
                <li
                  key={exp.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#E8E5ED] bg-white px-3.5 py-2.5 text-xs"
                >
                  <div className="space-y-0.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="primary" size="sm">
                        {exp.format}
                      </Badge>
                      <span className="font-medium text-[#24212B]">
                        {formatByteSize(exp.byteSize)}
                      </span>
                      {exp.widthPx && exp.heightPx && (
                        <span className="text-[11px] text-[#77727F]">
                          {exp.widthPx} × {exp.heightPx} px
                        </span>
                      )}
                      <Badge
                        variant={exp.isApprovedForPublish ? 'success' : 'default'}
                        size="sm"
                      >
                        {exp.isApprovedForPublish
                          ? 'Approved for Publish'
                          : 'Awaiting Publish Approval'}
                      </Badge>
                    </div>
                    <p className="text-[11px] text-[#77727F]">
                      SHA-256 <code className="font-mono">{exp.sha256.slice(0, 14)}…</code> ·{' '}
                      {formatDateTimeDisplay(exp.createdAt)}
                    </p>
                  </div>

                  <div className="flex items-center gap-2">
                    <a
                      href={`/api/designs/${encodeURIComponent(jobId)}/exports/${encodeURIComponent(exp.id)}/file`}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 rounded-lg border border-[#E8E5ED] px-2.5 py-1 text-xs font-medium text-[#6541A5] hover:bg-[#F8F7FA]"
                    >
                      <Download className="h-3 w-3" />
                      Inspect
                    </a>
                    <Button
                      type="button"
                      variant={exp.isApprovedForPublish ? 'outline' : 'secondary'}
                      size="sm"
                      isLoading={togglingExportId === exp.id}
                      onClick={() =>
                        handleTogglePublishApproval(
                          exp.id,
                          !exp.isApprovedForPublish
                        )
                      }
                    >
                      <ShieldCheck className="h-3.5 w-3.5 mr-1" />
                      {exp.isApprovedForPublish ? 'Revoke Approval' : 'Approve Export'}
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
