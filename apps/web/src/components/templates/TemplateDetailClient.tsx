'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  AlertCircle,
  Archive,
  ArrowLeft,
  CheckCircle2,
  FileText,
  History,
  Loader2,
  Pencil,
  Plus,
  RotateCcw,
} from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
} from '@crelune/ui';
import {
  DESIGN_CATEGORIES,
  TEMPLATE_STUDIO_TYPES,
  type DesignCategory,
  type TemplateDetail,
  type TemplateFieldMappingSummary,
  type TemplateStudioType,
  type TemplateVersionSummary,
} from '@crelune/shared';
import {
  archiveTemplateRequest,
  fetchTemplateVersionDetailRequest,
  restoreTemplateRequest,
  TemplateApiError,
  updateTemplateRequest,
} from '@/lib/templates/template-api-client';
import {
  formatByteSize,
  formatDateTimeDisplay,
  getTemplateInspectionBadgeVariant,
  TEMPLATE_CATEGORY_LABELS,
  TEMPLATE_FORMAT_LABELS,
  TEMPLATE_STUDIO_LABELS,
} from '@/lib/templates/template-ui-utils';
import { VersionPreviewCard } from './VersionPreviewCard';
import { FieldMappingEditor } from './FieldMappingEditor';
import { TemplateUploadModal } from './TemplateUploadModal';

export interface TemplateDetailClientProps {
  initialTemplate: TemplateDetail;
}

export function TemplateDetailClient({
  initialTemplate,
}: TemplateDetailClientProps) {
  const router = useRouter();
  const [template, setTemplate] = useState<TemplateDetail>(initialTemplate);
  const [selectedVersionId, setSelectedVersionId] = useState<string>(
    initialTemplate.activeVersion?.id ||
      initialTemplate.versions[0]?.id ||
      ''
  );

  // Cache loaded mappings per versionId so switching to historical versions
  // never displays stale or empty mappings that could accidentally overwrite data.
  const [versionMappingsById, setVersionMappingsById] = useState<
    Record<string, TemplateFieldMappingSummary[]>
  >(() =>
    initialTemplate.activeVersion
      ? { [initialTemplate.activeVersion.id]: initialTemplate.activeMappings }
      : {}
  );
  const [isLoadingVersionMappings, setIsLoadingVersionMappings] = useState(false);
  const [versionMappingsError, setVersionMappingsError] = useState<string | null>(null);
  const [versionRetryNonce, setVersionRetryNonce] = useState(0);

  // Metadata edit state
  const [isEditingMetadata, setIsEditingMetadata] = useState(false);
  const [editName, setEditName] = useState(initialTemplate.name);
  const [editCategory, setEditCategory] = useState<DesignCategory>(initialTemplate.category);
  const [editStudioType, setEditStudioType] = useState<TemplateStudioType>(
    initialTemplate.studioType
  );
  const [editDescription, setEditDescription] = useState(initialTemplate.description ?? '');
  const [isSavingMetadata, setIsSavingMetadata] = useState(false);

  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);
  const [isUpdatingStatus, setIsUpdatingStatus] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const activeVersion = template.activeVersion;
  const selectedVersion =
    template.versions.find((v) => v.id === selectedVersionId) ||
    activeVersion ||
    template.versions[0];

  const hasLoadedSelectedMappings = Boolean(
    selectedVersion && versionMappingsById[selectedVersion.id] !== undefined
  );

  useEffect(() => {
    if (!selectedVersion) return;
    if (versionMappingsById[selectedVersion.id] !== undefined) {
      setVersionMappingsError(null);
      setIsLoadingVersionMappings(false);
      return;
    }

    const controller = new AbortController();
    setIsLoadingVersionMappings(true);
    setVersionMappingsError(null);

    fetchTemplateVersionDetailRequest(
      template.id,
      selectedVersion.id,
      controller.signal
    )
      .then((detail) => {
        setVersionMappingsById((prev) => ({
          ...prev,
          [selectedVersion.id]: detail.mappings,
        }));
      })
      .catch((err) => {
        if ((err as { name?: string })?.name === 'AbortError') return;
        setVersionMappingsError(
          err instanceof TemplateApiError
            ? err.message
            : 'Unable to load field mappings for this version.'
        );
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setIsLoadingVersionMappings(false);
        }
      });

    return () => controller.abort();
  }, [selectedVersion, template.id, versionMappingsById, versionRetryNonce]);

  const handleTemplateUpdated = (updated: TemplateDetail) => {
    setTemplate(updated);
    if (updated.activeVersion) {
      setSelectedVersionId(updated.activeVersion.id);
      setVersionMappingsById((prev) => ({
        ...prev,
        [updated.activeVersion!.id]: updated.activeMappings,
      }));
    }
    router.refresh();
  };

  const handleOpenEditMetadata = () => {
    setEditName(template.name);
    setEditCategory(template.category);
    setEditStudioType(template.studioType);
    setEditDescription(template.description ?? '');
    setStatusMessage(null);
    setErrorMessage(null);
    setIsEditingMetadata(true);
  };

  const handleSaveMetadata = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSavingMetadata) return;

    const trimmedName = editName.trim();
    if (trimmedName.length < 2) {
      setErrorMessage('Template name must be at least 2 characters.');
      return;
    }

    setIsSavingMetadata(true);
    setStatusMessage(null);
    setErrorMessage(null);

    try {
      const updated = await updateTemplateRequest(template.id, {
        name: trimmedName,
        category: editCategory,
        studioType: editStudioType,
        description: editDescription.trim() || null,
      });
      setTemplate(updated);
      setIsEditingMetadata(false);
      setStatusMessage('Template details updated.');
      router.refresh();
    } catch (err) {
      setErrorMessage(
        err instanceof TemplateApiError
          ? err.message
          : 'Failed to update template details.'
      );
    } finally {
      setIsSavingMetadata(false);
    }
  };

  const handleActivateVersion = async (version: TemplateVersionSummary) => {
    setStatusMessage(null);
    setErrorMessage(null);
    setIsUpdatingStatus(true);
    try {
      const updated = await updateTemplateRequest(template.id, {
        activeVersionId: version.id,
      });
      setTemplate(updated);
      setSelectedVersionId(version.id);
      setVersionMappingsById((prev) => ({
        ...prev,
        [version.id]: updated.activeMappings,
      }));
      setStatusMessage(
        `Version ${version.versionNumber} is now the active version for this template.`
      );
      router.refresh();
    } catch (err) {
      setErrorMessage(
        err instanceof TemplateApiError
          ? err.message
          : 'Failed to switch active version.'
      );
    } finally {
      setIsUpdatingStatus(false);
    }
  };

  const handleToggleArchive = async () => {
    setStatusMessage(null);
    setErrorMessage(null);
    setIsUpdatingStatus(true);
    try {
      if (template.isActive) {
        const updated = await archiveTemplateRequest(template.id);
        setTemplate(updated);
        setStatusMessage('Template archived. Existing design jobs remain intact.');
      } else {
        const updated = await restoreTemplateRequest(template.id);
        setTemplate(updated);
        setStatusMessage('Template restored to active catalog.');
      }
      router.refresh();
    } catch (err) {
      setErrorMessage(
        err instanceof TemplateApiError
          ? err.message
          : 'Failed to update template archive status.'
      );
    } finally {
      setIsUpdatingStatus(false);
    }
  };

  const handleMappingsSaved = (newMappings: TemplateFieldMappingSummary[]) => {
    if (!selectedVersion) return;
    setVersionMappingsById((prev) => ({
      ...prev,
      [selectedVersion.id]: newMappings,
    }));
    if (selectedVersion.id === template.activeVersion?.id) {
      setTemplate((prev) => ({
        ...prev,
        activeMappings: newMappings,
      }));
    }
  };

  return (
    <div className="space-y-6 max-w-6xl">
      {/* Top Navigation & Status Breadcrumbs */}
      <div className="flex items-center justify-between">
        <Link
          href="/templates"
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#77727F] hover:text-[#6541A5] transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Template Catalog
        </Link>

        <div className="flex items-center gap-2">
          {!template.isActive && (
            <Badge
              variant="warning"
              size="sm"
              className="bg-amber-50 text-amber-800 border-amber-200"
            >
              Archived Template
            </Badge>
          )}
          <Badge variant={template.isActive ? 'success' : 'default'} size="sm">
            {template.isActive ? 'Active' : 'Archived'}
          </Badge>
        </div>
      </div>

      {/* Alerts */}
      {statusMessage && (
        <div
          role="status"
          className="flex items-center gap-2.5 rounded-xl border border-emerald-200 bg-emerald-50/90 p-3.5 text-xs text-emerald-900 shadow-xs"
        >
          <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
          <span>{statusMessage}</span>
        </div>
      )}

      {errorMessage && (
        <div
          role="alert"
          className="flex items-center gap-2.5 rounded-xl border border-rose-200 bg-rose-50/90 p-3.5 text-xs text-rose-900 shadow-xs"
        >
          <AlertCircle className="h-4 w-4 shrink-0 text-rose-600" />
          <span>{errorMessage}</span>
        </div>
      )}

      {/* Header Profile Card */}
      <div className="rounded-2xl border border-[#E8E5ED] bg-white p-6 shadow-xs">
        {isEditingMetadata ? (
          <form onSubmit={handleSaveMetadata} className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-[#24212B]">
                Edit Template Details
              </h2>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="md:col-span-1">
                <Input
                  label="Template Name"
                  required
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  disabled={isSavingMetadata}
                />
              </div>
              <div className="space-y-1.5">
                <label
                  htmlFor="edit-template-category"
                  className="block text-xs font-medium text-[#24212B]"
                >
                  Category
                </label>
                <select
                  id="edit-template-category"
                  value={editCategory}
                  onChange={(e) => setEditCategory(e.target.value as DesignCategory)}
                  disabled={isSavingMetadata}
                  className="h-9.5 w-full rounded-lg border border-[#E8E5ED] bg-white px-3 text-xs text-[#24212B]"
                >
                  {DESIGN_CATEGORIES.map((cat) => (
                    <option key={cat} value={cat}>
                      {TEMPLATE_CATEGORY_LABELS[cat] || cat}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <label
                  htmlFor="edit-template-studio"
                  className="block text-xs font-medium text-[#24212B]"
                >
                  Authoring Studio
                </label>
                <select
                  id="edit-template-studio"
                  value={editStudioType}
                  onChange={(e) =>
                    setEditStudioType(e.target.value as TemplateStudioType)
                  }
                  disabled={isSavingMetadata}
                  className="h-9.5 w-full rounded-lg border border-[#E8E5ED] bg-white px-3 text-xs text-[#24212B]"
                >
                  {TEMPLATE_STUDIO_TYPES.map((studio) => (
                    <option key={studio} value={studio}>
                      {TEMPLATE_STUDIO_LABELS[studio] || studio}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="space-y-1.5">
              <label
                htmlFor="edit-template-description"
                className="block text-xs font-medium text-[#24212B]"
              >
                Description
              </label>
              <textarea
                id="edit-template-description"
                rows={2}
                value={editDescription}
                onChange={(e) => setEditDescription(e.target.value)}
                disabled={isSavingMetadata}
                className="w-full rounded-lg border border-[#E8E5ED] bg-white p-2.5 text-xs text-[#24212B]"
              />
            </div>
            <div className="flex items-center justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setIsEditingMetadata(false)}
                disabled={isSavingMetadata}
              >
                Cancel
              </Button>
              <Button type="submit" size="sm" isLoading={isSavingMetadata}>
                Save Details
              </Button>
            </div>
          </form>
        ) : (
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div className="flex items-start gap-4">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-[#EFEBF8] text-[#6541A5] shadow-xs">
                <FileText className="h-6 w-6" />
              </div>
              <div>
                <div className="flex items-center gap-2.5 flex-wrap">
                  <h1 className="text-xl font-bold tracking-tight text-[#24212B]">
                    {template.name}
                  </h1>
                  <Badge variant="primary" size="sm">
                    {TEMPLATE_CATEGORY_LABELS[template.category] || template.category}
                  </Badge>
                  <Badge variant="default" size="sm">
                    {TEMPLATE_STUDIO_LABELS[template.studioType] || template.studioType}
                  </Badge>
                </div>
                <p className="mt-1 text-xs text-[#77727F]">
                  {template.description || 'No description provided.'}
                </p>
                <div className="mt-2.5 flex items-center gap-4 text-[11px] text-[#77727F] flex-wrap">
                  <span>Created {formatDateTimeDisplay(template.createdAt)}</span>
                  <span>•</span>
                  <span>Updated {formatDateTimeDisplay(template.updatedAt)}</span>
                  <span>•</span>
                  <span>
                    {template.versions.length} total{' '}
                    {template.versions.length === 1 ? 'version' : 'versions'}
                  </span>
                </div>
              </div>
            </div>

            {/* Header Action Buttons */}
            <div className="flex items-center gap-2 shrink-0 flex-wrap">
              {template.isActive ? (
                <>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handleOpenEditMetadata}
                    disabled={isUpdatingStatus}
                  >
                    <Pencil className="h-3.5 w-3.5 mr-1 text-[#77727F]" />
                    Edit Details
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handleToggleArchive}
                    disabled={isUpdatingStatus}
                  >
                    <Archive className="h-3.5 w-3.5 mr-1 text-[#77727F]" />
                    Archive
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => setIsUploadModalOpen(true)}
                    disabled={isUpdatingStatus}
                  >
                    <Plus className="h-3.5 w-3.5 mr-1" />
                    New Version
                  </Button>
                </>
              ) : (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleToggleArchive}
                  disabled={isUpdatingStatus}
                >
                  <RotateCcw className="h-3.5 w-3.5 mr-1 text-emerald-600" />
                  Restore Template
                </Button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Main Grid: Left = Version Preview & Metadata; Right = Version History & Mapping */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column (5 Cols): Selected Version Visual Preview & File Inspection */}
        <div className="lg:col-span-5 space-y-6">
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-sm font-semibold text-[#24212B]">
                    {selectedVersion
                      ? `Version ${selectedVersion.versionNumber} Preview`
                      : 'No Version Uploaded Yet'}
                  </CardTitle>
                  <CardDescription className="text-xs text-[#77727F]">
                    {selectedVersion
                      ? `${selectedVersion.format} master document`
                      : 'Upload a version to enable preview and field mapping.'}
                  </CardDescription>
                </div>
                {selectedVersion &&
                  (selectedVersion.id === activeVersion?.id ? (
                    <Badge variant="success" size="sm">
                      Active Version
                    </Badge>
                  ) : (
                    <Badge variant="default" size="sm">
                      History
                    </Badge>
                  ))}
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {selectedVersion ? (
                <>
                  <VersionPreviewCard
                    key={selectedVersion.id}
                    templateId={template.id}
                    versionId={selectedVersion.id}
                    hasPreview={selectedVersion.hasPreview}
                    versionNumber={selectedVersion.versionNumber}
                    format={selectedVersion.format}
                    widthPx={selectedVersion.widthPx}
                    heightPx={selectedVersion.heightPx}
                  />

                  {/* Version Technical Details */}
                  <div className="rounded-xl border border-[#E8E5ED] bg-[#F8F7FA]/60 p-3.5 space-y-2.5 text-xs">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[#77727F]">Master File:</span>
                      <span
                        className="font-medium text-[#24212B] truncate max-w-[200px]"
                        title={selectedVersion.originalFilename}
                      >
                        {selectedVersion.originalFilename}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-[#77727F]">Format:</span>
                      <span className="font-medium text-[#24212B]">
                        {TEMPLATE_FORMAT_LABELS[selectedVersion.format] ||
                          selectedVersion.format}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-[#77727F]">Byte Size:</span>
                      <span className="font-medium text-[#24212B]">
                        {formatByteSize(selectedVersion.byteSize)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[#77727F]">SHA-256:</span>
                      <code
                        className="font-mono text-[11px] text-[#24212B]"
                        title={selectedVersion.sha256}
                      >
                        {selectedVersion.sha256.slice(0, 16)}…
                      </code>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-[#77727F]">Dimensions:</span>
                      <span className="font-medium text-[#24212B]">
                        {selectedVersion.widthPx && selectedVersion.heightPx
                          ? `${selectedVersion.widthPx} × ${selectedVersion.heightPx} px`
                          : 'Custom / Unspecified'}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-[#77727F]">Inspection Status:</span>
                      <Badge
                        variant={getTemplateInspectionBadgeVariant(
                          selectedVersion.inspectionStatus
                        )}
                        size="sm"
                      >
                        {selectedVersion.inspectionStatus}
                      </Badge>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-[#77727F]">Editability Verified:</span>
                      <span className="font-medium text-amber-800">
                        No (Manual in Affinity)
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-[#77727F]">Uploaded:</span>
                      <span className="text-[#24212B]">
                        {formatDateTimeDisplay(selectedVersion.createdAt)}
                      </span>
                    </div>

                    <div className="pt-2 border-t border-[#E8E5ED]/80">
                      <p className="text-[11px] text-[#77727F] leading-relaxed">
                        <strong>Inspection Summary:</strong>{' '}
                        {selectedVersion.inspectionSummary ||
                          'Manual field mapping required in Affinity 3.3.'}
                      </p>
                    </div>
                  </div>

                  {/* Activate/Rollback Button if selected is not active */}
                  {template.isActive && selectedVersion.id !== activeVersion?.id && (
                    <div className="pt-2">
                      <Button
                        type="button"
                        variant="outline"
                        className="w-full text-xs"
                        onClick={() => handleActivateVersion(selectedVersion)}
                        disabled={isUpdatingStatus}
                      >
                        <RotateCcw className="h-3.5 w-3.5 mr-1.5 text-[#6541A5]" />
                        {selectedVersion.versionNumber <
                        (activeVersion?.versionNumber || 0)
                          ? `Roll Back to Version ${selectedVersion.versionNumber}`
                          : `Activate Version ${selectedVersion.versionNumber}`}
                      </Button>
                    </div>
                  )}
                </>
              ) : (
                <div className="rounded-xl border border-dashed border-[#E8E5ED] bg-[#F8F7FA] p-6 text-center text-xs text-[#77727F]">
                  No master versions uploaded yet. Click <strong>New Version</strong>{' '}
                  above to attach your Affinity or PSD master document.
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Right Column (7 Cols): Version Selector + Field Mappings */}
        <div className="lg:col-span-7 space-y-6">
          {/* Version History Selector Tabs */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <History className="h-4 w-4 text-[#6541A5]" />
                  <CardTitle className="text-sm font-semibold text-[#24212B]">
                    Version History
                  </CardTitle>
                </div>
                <span className="text-[11px] text-[#77727F]">
                  Select version to inspect or edit bindings
                </span>
              </div>
            </CardHeader>
            <CardContent>
              {template.versions.length === 0 ? (
                <p className="text-xs text-[#77727F]">
                  No versions registered for this template yet.
                </p>
              ) : (
                <div className="flex items-center gap-2 overflow-x-auto pb-1">
                  {template.versions.map((v) => {
                    const isSelected = v.id === selectedVersion?.id;
                    const isActive = v.id === activeVersion?.id;
                    return (
                      <button
                        key={v.id}
                        type="button"
                        onClick={() => setSelectedVersionId(v.id)}
                        aria-pressed={isSelected}
                        className={`flex items-center gap-2 rounded-xl px-3.5 py-2 text-xs font-semibold transition-all shrink-0 border ${
                          isSelected
                            ? 'border-[#6541A5] bg-[#EFEBF8] text-[#6541A5] shadow-xs'
                            : 'border-[#E8E5ED] bg-white text-[#77727F] hover:bg-[#F8F7FA] hover:text-[#24212B]'
                        }`}
                      >
                        <span>v{v.versionNumber}</span>
                        <span className="text-[10px] uppercase text-[#77727F] font-normal">
                          ({v.format})
                        </span>
                        {isActive && (
                          <span
                            className="h-2 w-2 rounded-full bg-emerald-500"
                            title="Active Version"
                          />
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Field Mapping Editor Component */}
          {selectedVersion &&
            (isLoadingVersionMappings && !hasLoadedSelectedMappings ? (
              <div className="flex items-center justify-center gap-2 rounded-2xl border border-[#E8E5ED] bg-white p-8 text-xs text-[#77727F]">
                <Loader2 className="h-4 w-4 animate-spin text-[#6541A5]" />
                <span>
                  Loading field mappings for Version {selectedVersion.versionNumber}...
                </span>
              </div>
            ) : versionMappingsError && !hasLoadedSelectedMappings ? (
              <div
                role="alert"
                className="flex items-center justify-between gap-3 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-xs text-rose-800"
              >
                <span>{versionMappingsError}</span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setVersionRetryNonce((n) => n + 1)}
                >
                  Retry
                </Button>
              </div>
            ) : (
              <FieldMappingEditor
                key={selectedVersion.id}
                templateId={template.id}
                versionId={selectedVersion.id}
                versionNumber={selectedVersion.versionNumber}
                format={selectedVersion.format}
                initialMappings={versionMappingsById[selectedVersion.id] ?? []}
                onMappingsSaved={handleMappingsSaved}
                isArchived={!template.isActive}
              />
            ))}
        </div>
      </div>

      {/* Upload New Version Modal */}
      <TemplateUploadModal
        isOpen={isUploadModalOpen}
        onClose={() => setIsUploadModalOpen(false)}
        onSuccess={handleTemplateUpdated}
        existingTemplate={template}
      />
    </div>
  );
}
