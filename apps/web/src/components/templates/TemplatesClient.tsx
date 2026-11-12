'use client';

import React, { useId, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ChevronLeft,
  ChevronRight,
  FileText,
  Plus,
  Search,
} from 'lucide-react';
import {
  Badge,
  Button,
  EmptyState,
  Header,
  Input,
} from '@crelune/ui';
import {
  DESIGN_CATEGORIES,
  TEMPLATE_STUDIO_TYPES,
  type DesignCategory,
  type TemplateDetail,
  type TemplateListQuery,
  type TemplateStudioType,
  type TemplateSummary,
} from '@crelune/shared';
import {
  fetchTemplatesRequest,
  TemplateApiError,
} from '@/lib/templates/template-api-client';
import {
  formatDateTimeDisplay,
  getTemplateInspectionBadgeVariant,
  TEMPLATE_CATEGORY_LABELS,
  TEMPLATE_STUDIO_LABELS,
} from '@/lib/templates/template-ui-utils';
import { TemplateUploadModal } from './TemplateUploadModal';

export interface TemplatesClientProps {
  initialTemplates: TemplateSummary[];
  initialTotal: number;
  initialPage: number;
  initialPageSize: number;
}

export function TemplatesClient({
  initialTemplates,
  initialTotal,
  initialPage,
  initialPageSize,
}: TemplatesClientProps) {
  const router = useRouter();
  const searchInputId = useId();

  const [templates, setTemplates] = useState<TemplateSummary[]>(initialTemplates);
  const [total, setTotal] = useState(initialTotal);
  const [page, setPage] = useState(initialPage);
  const [pageSize] = useState(initialPageSize);

  // Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<'ALL' | DesignCategory>('ALL');
  const [studioFilter, setStudioFilter] = useState<'ALL' | TemplateStudioType>('ALL');
  const [includeArchived, setIncludeArchived] = useState(false);

  // UI States
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const loadTemplates = async (overrides: Partial<TemplateListQuery> = {}) => {
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const q = overrides.q !== undefined ? overrides.q : searchQuery;
      const cat = overrides.category !== undefined ? overrides.category : categoryFilter;
      const studio = overrides.studioType !== undefined ? overrides.studioType : studioFilter;
      const arch = overrides.includeArchived !== undefined ? overrides.includeArchived : includeArchived;
      const p = overrides.page !== undefined ? overrides.page : page;

      const res = await fetchTemplatesRequest({
        q,
        category: cat,
        studioType: studio,
        includeArchived: arch,
        page: p,
        pageSize,
      });

      setTemplates(res.items);
      setTotal(res.total);
      setPage(res.page);
    } catch (err) {
      setErrorMessage(
        err instanceof TemplateApiError
          ? err.message
          : 'Failed to load templates from workspace.'
      );
    } finally {
      setIsLoading(false);
    }
  };

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(1);
    loadTemplates({ page: 1, q: searchQuery });
  };

  const handleCategoryChange = (val: 'ALL' | DesignCategory) => {
    setCategoryFilter(val);
    setPage(1);
    loadTemplates({ page: 1, category: val });
  };

  const handleStudioChange = (val: 'ALL' | TemplateStudioType) => {
    setStudioFilter(val);
    setPage(1);
    loadTemplates({ page: 1, studioType: val });
  };

  const handleToggleArchived = (checked: boolean) => {
    setIncludeArchived(checked);
    setPage(1);
    loadTemplates({ page: 1, includeArchived: checked });
  };

  const handlePageChange = (nextPage: number) => {
    if (nextPage < 1 || nextPage > totalPages) return;
    setPage(nextPage);
    loadTemplates({ page: nextPage });
  };

  const handleUploadSuccess = (newTemplate: TemplateDetail) => {
    // Navigate straight to the new template's detail page
    router.push(`/templates/${encodeURIComponent(newTemplate.id)}`);
  };

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <Header
            title="Creative Template Catalog"
            description="Manage reusable Affinity (.af, .afdesign, .afphoto, .afpub) and Photoshop (.psd) master documents."
          />
        </div>
        <div className="shrink-0">
          <Button
            type="button"
            onClick={() => setIsUploadModalOpen(true)}
            className="w-full sm:w-auto"
          >
            <Plus className="h-4 w-4 mr-1.5" />
            Add Template
          </Button>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="rounded-2xl border border-[#E8E5ED] bg-white p-4 shadow-xs space-y-3">
        <div className="flex flex-col md:flex-row md:items-center gap-3">
          {/* Search Form */}
          <form onSubmit={handleSearchSubmit} className="flex-1 relative">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-[#77727F]" />
            <Input
              id={searchInputId}
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search templates by name or description..."
              className="pl-9 h-10 w-full text-xs"
            />
          </form>

          {/* Category Dropdown */}
          <div className="w-full md:w-56 shrink-0">
            <select
              value={categoryFilter}
              onChange={(e) => handleCategoryChange(e.target.value as 'ALL' | DesignCategory)}
              className="w-full h-10 rounded-lg border border-[#E8E5ED] bg-white px-3 text-xs text-[#24212B] focus:border-[#6541A5] focus:outline-none"
              aria-label="Filter by category"
            >
              <option value="ALL">All Categories</option>
              {DESIGN_CATEGORIES.map((cat) => (
                <option key={cat} value={cat}>
                  {TEMPLATE_CATEGORY_LABELS[cat] || cat}
                </option>
              ))}
            </select>
          </div>

          {/* Studio Dropdown */}
          <div className="w-full md:w-52 shrink-0">
            <select
              value={studioFilter}
              onChange={(e) => handleStudioChange(e.target.value as 'ALL' | TemplateStudioType)}
              className="w-full h-10 rounded-lg border border-[#E8E5ED] bg-white px-3 text-xs text-[#24212B] focus:border-[#6541A5] focus:outline-none"
              aria-label="Filter by studio"
            >
              <option value="ALL">All Studios</option>
              {TEMPLATE_STUDIO_TYPES.map((studio) => (
                <option key={studio} value={studio}>
                  {TEMPLATE_STUDIO_LABELS[studio] || studio}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Second Row: Archived Filter & Results Counter */}
        <div className="flex items-center justify-between border-t border-[#E8E5ED]/80 pt-3 text-xs text-[#77727F]">
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={includeArchived}
              onChange={(e) => handleToggleArchived(e.target.checked)}
              className="h-4 w-4 rounded border-[#E8E5ED] text-[#6541A5] focus:ring-[#6541A5]"
            />
            <span>Include archived templates</span>
          </label>

          <span>
            {isLoading ? 'Updating...' : `Showing ${templates.length} of ${total} templates`}
          </span>
        </div>
      </div>

      {/* Error Notice */}
      {errorMessage && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-xs text-rose-800">
          {errorMessage}
        </div>
      )}

      {/* Template Grid or Empty State */}
      {templates.length === 0 ? (
        <div className="space-y-4">
          <EmptyState
            icon={<FileText className="w-8 h-8 text-[#6541A5]" />}
            title="No Templates Found"
            description={
              searchQuery || categoryFilter !== 'ALL' || studioFilter !== 'ALL'
                ? 'No templates match your current filters. Clear the search or choose different criteria.'
                : 'You have not uploaded any creative templates yet. Add an Affinity or Photoshop master file to begin.'
            }
            actionText={
              searchQuery || categoryFilter !== 'ALL' || studioFilter !== 'ALL'
                ? 'Clear Filters'
                : 'Add First Template'
            }
            onAction={
              searchQuery || categoryFilter !== 'ALL' || studioFilter !== 'ALL'
                ? () => {
                    setSearchQuery('');
                    setCategoryFilter('ALL');
                    setStudioFilter('ALL');
                    loadTemplates({ q: '', category: 'ALL', studioType: 'ALL', page: 1 });
                  }
                : () => setIsUploadModalOpen(true)
            }
          />
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {templates.map((tmpl) => {
            const activeVer = tmpl.activeVersion;
            return (
              <Link
                key={tmpl.id}
                href={`/templates/${encodeURIComponent(tmpl.id)}`}
                className="group flex flex-col justify-between rounded-2xl border border-[#E8E5ED] bg-white p-5 shadow-xs transition-all hover:border-[#6541A5]/40 hover:shadow-md"
              >
                <div className="space-y-3">
                  {/* Top Tags */}
                  <div className="flex items-center justify-between gap-2">
                    <Badge variant="primary" size="sm">
                      {TEMPLATE_CATEGORY_LABELS[tmpl.category] || tmpl.category}
                    </Badge>
                    <div className="flex items-center gap-1.5">
                      {!tmpl.isActive && (
                        <Badge variant="warning" size="sm" className="bg-amber-50 text-amber-800 border-amber-200">
                          Archived
                        </Badge>
                      )}
                      <Badge variant="default" size="sm">
                        {TEMPLATE_STUDIO_LABELS[tmpl.studioType] || tmpl.studioType}
                      </Badge>
                    </div>
                  </div>

                  {/* Title and Description */}
                  <div>
                    <h3 className="text-sm font-bold text-[#24212B] group-hover:text-[#6541A5] transition-colors line-clamp-1">
                      {tmpl.name}
                    </h3>
                    <p className="mt-1 text-xs text-[#77727F] line-clamp-2">
                      {tmpl.description || 'No description provided.'}
                    </p>
                  </div>

                  {/* Version Info Box */}
                  <div className="rounded-xl border border-[#E8E5ED] bg-[#F8F7FA] p-3 space-y-1.5 text-xs">
                    <div className="flex items-center justify-between">
                      <span className="text-[#77727F]">Active Master:</span>
                      <span className="font-semibold text-[#24212B]">
                        {activeVer ? `v${activeVer.versionNumber} (${activeVer.format})` : 'No Active Version'}
                      </span>
                    </div>
                    {activeVer && (
                      <div className="flex items-center justify-between text-[11px]">
                        <span className="text-[#77727F]">Inspection:</span>
                        <Badge
                          variant={getTemplateInspectionBadgeVariant(activeVer.inspectionStatus)}
                          size="sm"
                        >
                          {activeVer.inspectionStatus}
                        </Badge>
                      </div>
                    )}
                    {activeVer?.widthPx && activeVer?.heightPx ? (
                      <div className="flex items-center justify-between text-[11px] text-[#77727F]">
                        <span>Dimensions:</span>
                        <span>{activeVer.widthPx} × {activeVer.heightPx} px</span>
                      </div>
                    ) : null}
                  </div>
                </div>

                {/* Footer Metadata */}
                <div className="mt-4 pt-3 border-t border-[#E8E5ED] flex items-center justify-between text-[11px] text-[#77727F]">
                  <span>{tmpl.versionCount} {tmpl.versionCount === 1 ? 'version' : 'versions'}</span>
                  <span>Updated {formatDateTimeDisplay(tmpl.updatedAt)}</span>
                </div>
              </Link>
            );
          })}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between border-t border-[#E8E5ED] pt-4">
          <p className="text-xs text-[#77727F]">
            Page {page} of {totalPages} ({total} total)
          </p>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={page <= 1 || isLoading}
              onClick={() => handlePageChange(page - 1)}
            >
              <ChevronLeft className="h-4 w-4 mr-1" />
              Previous
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={page >= totalPages || isLoading}
              onClick={() => handlePageChange(page + 1)}
            >
              Next
              <ChevronRight className="h-4 w-4 ml-1" />
            </Button>
          </div>
        </div>
      )}

      {/* Upload Modal */}
      <TemplateUploadModal
        isOpen={isUploadModalOpen}
        onClose={() => setIsUploadModalOpen(false)}
        onSuccess={handleUploadSuccess}
      />
    </div>
  );
}
