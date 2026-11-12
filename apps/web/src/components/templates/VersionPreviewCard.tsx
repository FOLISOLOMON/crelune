'use client';

import React, { useState } from 'react';
import { Eye, FileText, ImageOff } from 'lucide-react';

interface VersionPreviewCardProps {
  templateId: string;
  versionId: string;
  hasPreview: boolean;
  versionNumber: number;
  format: string;
  widthPx: number | null;
  heightPx: number | null;
  className?: string;
}

export function VersionPreviewCard({
  templateId,
  versionId,
  hasPreview,
  versionNumber,
  format,
  widthPx,
  heightPx,
  className = '',
}: VersionPreviewCardProps) {
  const [loadError, setLoadError] = useState(false);
  const [showFullModal, setShowFullModal] = useState(false);

  const previewSrc = `/api/templates/${encodeURIComponent(
    templateId
  )}/versions/${encodeURIComponent(versionId)}/preview`;

  if (!hasPreview || loadError) {
    return (
      <div
        className={`flex flex-col items-center justify-center rounded-xl border border-dashed border-[#E8E5ED] bg-[#F8F7FA] p-6 text-center ${className}`}
      >
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-white text-[#77727F] shadow-sm mb-3">
          {loadError ? (
            <ImageOff className="h-6 w-6 text-[#A09BAA]" />
          ) : (
            <FileText className="h-6 w-6 text-[#6541A5]" />
          )}
        </div>
        <p className="text-xs font-semibold text-[#24212B]">
          {loadError ? 'Preview Unavailable' : 'No Visual Preview Uploaded'}
        </p>
        <p className="mt-1 text-[11px] text-[#77727F] max-w-xs">
          {loadError
            ? 'The preview image could not be loaded from private storage.'
            : `${format} master files do not render directly in browsers. Attach a companion PNG/JPEG preview during upload for visual reference.`}
        </p>
        {widthPx && heightPx && (
          <span className="mt-2 text-[10px] font-medium text-[#77727F] bg-white px-2 py-0.5 rounded border border-[#E8E5ED]">
            Canvas: {widthPx} × {heightPx} px
          </span>
        )}
      </div>
    );
  }

  return (
    <>
      <div
        className={`group relative overflow-hidden rounded-xl border border-[#E8E5ED] bg-white shadow-sm transition-all hover:shadow-md ${className}`}
      >
        <div className="relative aspect-[4/3] w-full bg-[#F8F7FA] flex items-center justify-center overflow-hidden">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={previewSrc}
            alt={`Preview of Version ${versionNumber}`}
            className="h-full w-full object-contain transition-transform duration-300 group-hover:scale-105"
            onError={() => setLoadError(true)}
            loading="lazy"
          />
          <div className="absolute inset-0 bg-[#24212B]/0 group-hover:bg-[#24212B]/40 transition-colors flex items-center justify-center opacity-0 group-hover:opacity-100">
            <button
              type="button"
              onClick={() => setShowFullModal(true)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-white/95 px-3 py-1.5 text-xs font-semibold text-[#24212B] shadow-md hover:bg-white transition-transform active:scale-95"
            >
              <Eye className="h-3.5 w-3.5 text-[#6541A5]" />
              View Full Preview
            </button>
          </div>
        </div>

        <div className="border-t border-[#E8E5ED] bg-white px-3 py-2 flex items-center justify-between text-[11px] text-[#77727F]">
          <span className="font-medium text-[#24212B]">v{versionNumber} Preview</span>
          {widthPx && heightPx ? (
            <span>
              {widthPx} × {heightPx} px
            </span>
          ) : (
            <span>Companion Image</span>
          )}
        </div>
      </div>

      {showFullModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#24212B]/60 p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          onClick={() => setShowFullModal(false)}
        >
          <div
            className="relative max-h-[90vh] max-w-4xl overflow-hidden rounded-2xl bg-white p-4 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between pb-3 border-b border-[#E8E5ED]">
              <div>
                <h3 className="text-sm font-semibold text-[#24212B]">
                  Version {versionNumber} Visual Preview
                </h3>
                <p className="text-[11px] text-[#77727F]">
                  Visual rendering reference only; live document editability is verified in Affinity.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowFullModal(false)}
                className="rounded-lg p-1.5 text-[#77727F] hover:bg-[#F8F7FA] hover:text-[#24212B]"
                aria-label="Close preview modal"
              >
                ✕
              </button>
            </div>
            <div className="mt-4 flex max-h-[75vh] items-center justify-center overflow-auto bg-[#F8F7FA] rounded-xl p-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={previewSrc}
                alt={`Full preview of Version ${versionNumber}`}
                className="max-h-[70vh] max-w-full object-contain rounded-lg shadow-sm"
              />
            </div>
          </div>
        </div>
      )}
    </>
  );
}

