'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  AlertCircle,
  Archive,
  ArrowLeft,
  CheckCircle2,
  FileText,
  History,
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
} from '@crelune/ui';
import {
  type TemplateDetail,
  type TemplateFieldMappingSummary,
  type TemplateVersionSummary,
} from '@crelune/shared';
import {
  archiveTemplateRequest,
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

  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);
  const [isUpdatingStatus, setIsUpdatingStatus] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const activeVersion = template.activeVersion;
  const selectedVersion =
    template.versions.find((v) => v.id === selectedVersionId) ||
    activeVersion ||
    template.versions[0];

  const handleTemplateUpdated = (updated: TemplateDetail) => {
    setTemplate(updated);
    if (updated.activeVersion) {
      setSelectedVersionId(updated.activeVersion.id);
    }
    router.refresh();
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
    // If saving mappings for active version, update activeMappings
    if (selectedVersion?.id === template.activeVersion?.id) {
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
            <Badge variant="warning" size="sm" className="bg-amber-50 text-amber-800 border-amber-200">
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
        <div className="flex items-center gap-2.5 rounded-xl border border-emerald-200 bg-emerald-50/90 p-3.5 text-xs text-emerald-900 shadow-xs">
          <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
          <span>{statusMessage}</span>
        </div>
      )}

      {errorMessage && (
        <div className="flex items-center gap-2.5 rounded-xl border border-rose-200 bg-rose-50/90 p-3.5 text-xs text-rose-900 shadow-xs">
          <AlertCircle className="h-4 w-4 shrink-0 text-rose-600" />
          <span>{errorMessage}</span>
        </div>
      )}

      {/* Header Profile Card */}
      <div className="rounded-2xl border border-[#E8E5ED] bg-white p-6 shadow-xs">
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
                <span>{template.versions.length} total {template.versions.length === 1 ? 'version' : 'versions'}</span>
              </div>
            </div>
          </div>

          {/* Header Action Buttons */}
          <div className="flex items-center gap-2.5 shrink-0">
            {template.isActive ? (
              <>
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
                    Version {selectedVersion?.versionNumber || 1} Preview
                  </CardTitle>
                  <CardDescription className="text-xs text-[#77727F]">
                    {selectedVersion?.format} master document
                  </CardDescription>
                </div>
                {selectedVersion?.id === activeVersion?.id ? (
                  <Badge variant="success" size="sm">Active Version</Badge>
                ) : (
                  <Badge variant="default" size="sm">History</Badge>
                )}
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {selectedVersion && (
                <VersionPreviewCard
                  templateId={template.id}
                  versionId={selectedVersion.id}
                  hasPreview={selectedVersion.hasPreview}
                  versionNumber={selectedVersion.versionNumber}
                  format={selectedVersion.format}
                  widthPx={selectedVersion.widthPx}
                  heightPx={selectedVersion.heightPx}
                />
              )}

              {/* Version Technical Details */}
              {selectedVersion && (
                <div className="rounded-xl border border-[#E8E5ED] bg-[#F8F7FA]/60 p-3.5 space-y-2.5 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="text-[#77727F]">Master File:</span>
                    <span className="font-medium text-[#24212B] truncate max-w-[200px]" title={selectedVersion.originalFilename}>
                      {selectedVersion.originalFilename}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-[#77727F]">Format:</span>
                    <span className="font-medium text-[#24212B]">
                      {TEMPLATE_FORMAT_LABELS[selectedVersion.format] || selectedVersion.format}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-[#77727F]">Byte Size:</span>
                    <span className="font-medium text-[#24212B]">
                      {formatByteSize(selectedVersion.byteSize)}
                    </span>
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
                    <Badge variant={getTemplateInspectionBadgeVariant(selectedVersion.inspectionStatus)} size="sm">
                      {selectedVersion.inspectionStatus}
                    </Badge>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-[#77727F]">Uploaded:</span>
                    <span className="text-[#24212B]">
                      {formatDateTimeDisplay(selectedVersion.createdAt)}
                    </span>
                  </div>

                  <div className="pt-2 border-t border-[#E8E5ED]/80">
                    <p className="text-[11px] text-[#77727F] leading-relaxed">
                      <strong>Inspection Summary:</strong> {selectedVersion.inspectionSummary || 'Manual field mapping required in Affinity 3.3.'}
                    </p>
                  </div>
                </div>
              )}

              {/* Activate/Rollback Button if selected is not active */}
              {selectedVersion &&
                template.isActive &&
                selectedVersion.id !== activeVersion?.id && (
                  <div className="pt-2">
                    <Button
                      type="button"
                      variant="outline"
                      className="w-full text-xs"
                      onClick={() => handleActivateVersion(selectedVersion)}
                      disabled={isUpdatingStatus}
                    >
                      <RotateCcw className="h-3.5 w-3.5 mr-1.5 text-[#6541A5]" />
                      {selectedVersion.versionNumber < (activeVersion?.versionNumber || 0)
                        ? `Roll Back to Version ${selectedVersion.versionNumber}`
                        : `Activate Version ${selectedVersion.versionNumber}`}
                    </Button>
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
              <div className="flex items-center gap-2 overflow-x-auto pb-1">
                {template.versions.map((v) => {
                  const isSelected = v.id === selectedVersion?.id;
                  const isActive = v.id === activeVersion?.id;
                  return (
                    <button
                      key={v.id}
                      type="button"
                      onClick={() => setSelectedVersionId(v.id)}
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
                        <span className="h-2 w-2 rounded-full bg-emerald-500" title="Active Version" />
                      )}
                    </button>
                  );
                })}
              </div>
            </CardContent>
          </Card>

          {/* Field Mapping Editor Component */}
          {selectedVersion && (
            <FieldMappingEditor
              key={selectedVersion.id}
              templateId={template.id}
              versionId={selectedVersion.id}
              versionNumber={selectedVersion.versionNumber}
              format={selectedVersion.format}
              initialMappings={
                selectedVersion.id === activeVersion?.id
                  ? template.activeMappings
                  : []
              }
              onMappingsSaved={handleMappingsSaved}
              isArchived={!template.isActive}
            />
          )}
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
