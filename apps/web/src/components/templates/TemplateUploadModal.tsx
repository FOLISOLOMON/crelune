'use client';

import React, { useEffect, useId, useState } from 'react';
import {
  AlertCircle,
  FileCheck,
  FileText,
  Image as ImageIcon,
  Info,
  Loader2,
  UploadCloud,
  X,
} from 'lucide-react';
import { Button, Input } from '@crelune/ui';
import {
  DESIGN_CATEGORIES,
  TEMPLATE_STUDIO_TYPES,
  type DesignCategory,
  type TemplateDetail,
  type TemplateStudioType,
} from '@crelune/shared';
import {
  abandonUploadIntentRequest,
  completeTemplateVersionUploadRequest,
  createTemplateRequest,
  createTemplateUploadIntentRequest,
  TemplateApiError,
  uploadBytesToPresignedUrl,
} from '@/lib/templates/template-api-client';
import {
  computeBufferSha256Hex,
  formatByteSize,
  TEMPLATE_CATEGORY_LABELS,
  TEMPLATE_STUDIO_LABELS,
  validateTemplateMasterFile,
  validateTemplatePreviewFile,
} from '@/lib/templates/template-ui-utils';

export interface TemplateUploadModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (template: TemplateDetail) => void;
  existingTemplate?: TemplateDetail | null; // null if creating brand new template
}

type UploadStep = 'form' | 'hashing' | 'intent' | 'uploading' | 'finalizing' | 'success';

export function TemplateUploadModal({
  isOpen,
  onClose,
  onSuccess,
  existingTemplate = null,
}: TemplateUploadModalProps) {
  const titleId = useId();
  const isNewVersion = Boolean(existingTemplate);

  // Form states
  const [name, setName] = useState('');
  const [category, setCategory] = useState<DesignCategory>('GENERAL_GRAPHIC_DESIGN');
  const [studioType, setStudioType] = useState<TemplateStudioType>('AFFINITY_DESIGNER');
  const [description, setDescription] = useState('');
  const [activateImmediately, setActivateImmediately] = useState(true);

  // File states
  const [masterFile, setMasterFile] = useState<File | null>(null);
  const [previewFile, setPreviewFile] = useState<File | null>(null);

  // Progress & Error states
  const [step, setStep] = useState<UploadStep>('form');
  const [progressMessage, setProgressMessage] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!isOpen) return;
    if (existingTemplate) {
      setName(existingTemplate.name);
      setCategory(existingTemplate.category);
      setStudioType(existingTemplate.studioType);
      setDescription(existingTemplate.description || '');
    } else {
      setName('');
      setCategory('GENERAL_GRAPHIC_DESIGN');
      setStudioType('AFFINITY_DESIGNER');
      setDescription('');
    }
    setMasterFile(null);
    setPreviewFile(null);
    setStep('form');
    setProgressMessage('');
    setFormError(null);
    setFieldErrors({});
    setStep('form');
    setProgressMessage('');
  }, [isOpen, existingTemplate]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && step === 'form') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, step, onClose]);

  if (!isOpen) return null;

  const handleMasterFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] || null;
    setFieldErrors((prev) => {
      const next = { ...prev };
      delete next.masterFile;
      return next;
    });
    setFormError(null);

    if (!file) {
      setMasterFile(null);
      return;
    }

    const validation = validateTemplateMasterFile(file);
    if (!validation.valid) {
      setFieldErrors((prev) => ({ ...prev, masterFile: validation.error! }));
      setMasterFile(null);
      return;
    }

    setMasterFile(file);

    // Auto-fill template name from filename if empty
    if (!name.trim() && !isNewVersion) {
      const base = file.name.replace(/\.[^/.]+$/, '').replace(/[-_]/g, ' ');
      setName(base.charAt(0).toUpperCase() + base.slice(1));
    }
  };

  const handlePreviewFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] || null;
    setFieldErrors((prev) => {
      const next = { ...prev };
      delete next.previewFile;
      return next;
    });
    setFormError(null);

    if (!file) {
      setPreviewFile(null);
      return;
    }

    const validation = validateTemplatePreviewFile(file);
    if (!validation.valid) {
      setFieldErrors((prev) => ({ ...prev, previewFile: validation.error! }));
      setPreviewFile(null);
      return;
    }

    setPreviewFile(file);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setFieldErrors({});

    // Client validation
    const errors: Record<string, string> = {};
    if (!isNewVersion) {
      if (!name.trim() || name.trim().length < 2) {
        errors.name = 'Template name must be at least 2 characters.';
      }
    }
    if (!masterFile) {
      errors.masterFile = 'Please select a template master file (.psd, .af, .afphoto, .afdesign, or .afpub).';
    }

    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      setFormError('Please resolve the highlighted issues before uploading.');
      return;
    }

    let targetTemplateId = existingTemplate?.id;
    let createdMasterIntentId: string | null = null;

    try {
      // Step 1: Create template metadata record if new
      if (!targetTemplateId) {
        setStep('intent');
        setProgressMessage('Initializing template record...');
        const newTemplate = await createTemplateRequest({
          name: name.trim(),
          category,
          studioType,
          description: description.trim() || null,
        });
        targetTemplateId = newTemplate.id;
      }

      // Step 2: Read bytes and compute SHA-256 digests
      setStep('hashing');
      setProgressMessage('Validating and hashing file bytes (SHA-256)...');
      const masterBuffer = await masterFile!.arrayBuffer();
      const masterBytes = new Uint8Array(masterBuffer);
      const masterSha256 = await computeBufferSha256Hex(masterBytes);

      let previewBytes: Uint8Array | null = null;
      let previewSha256: string | null = null;
      if (previewFile) {
        const previewBuffer = await previewFile.arrayBuffer();
        previewBytes = new Uint8Array(previewBuffer);
        previewSha256 = await computeBufferSha256Hex(previewBytes);
      }

      // Step 3: Create presigned upload intents
      setStep('intent');
      setProgressMessage('Requesting authorized upload credentials...');
      const masterValidation = validateTemplateMasterFile(masterFile!);

      const masterIntentRes = await createTemplateUploadIntentRequest(
        targetTemplateId,
        {
          kind: 'TEMPLATE_MASTER',
          templateId: targetTemplateId,
          format: masterValidation.format!,
          originalFilename: masterFile!.name,
          mimeType: masterValidation.mimeType!,
          byteSize: masterBytes.byteLength,
          sha256: masterSha256,
          idempotencyKey: `upload_master_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`,
        }
      );
      createdMasterIntentId = masterIntentRes.intent.id;

      let previewIntentId: string | null = null;
      let previewUploadTarget: typeof masterIntentRes.upload | null = null;
      if (previewFile && previewBytes && previewSha256) {
        const previewValidation = validateTemplatePreviewFile(previewFile);
        const previewIntentRes = await createTemplateUploadIntentRequest(
          targetTemplateId,
          {
            kind: 'TEMPLATE_PREVIEW',
            templateId: targetTemplateId,
            originalFilename: previewFile.name,
            mimeType: previewValidation.mimeType as 'image/png' | 'image/jpeg' | 'image/webp',
            byteSize: previewBytes.byteLength,
            sha256: previewSha256,
            idempotencyKey: `upload_preview_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`,
          }
        );
        previewIntentId = previewIntentRes.intent.id;
        previewUploadTarget = previewIntentRes.upload;
      }

      // Step 4: Direct binary PUT to presigned S3 URLs
      setStep('uploading');
      setProgressMessage(`Uploading ${masterFile!.name} to private creative storage...`);
      await uploadBytesToPresignedUrl(masterIntentRes.upload, masterBytes);

      if (previewUploadTarget && previewBytes) {
        setProgressMessage(`Uploading companion preview image...`);
        await uploadBytesToPresignedUrl(previewUploadTarget, previewBytes);
      }

      // Step 5: Finalize and verify on server
      setStep('finalizing');
      setProgressMessage('Verifying storage checksums and registering version...');
      const finalRes = await completeTemplateVersionUploadRequest(
        targetTemplateId,
        {
          uploadIntentId: masterIntentRes.intent.id,
          previewUploadIntentId: previewIntentId,
          activateImmediately,
        }
      );

      setStep('success');
      setProgressMessage('Template version registered successfully!');
      setTimeout(() => {
        onSuccess(finalRes.version.template);
        onClose();
      }, 700);
    } catch (err) {
      if (createdMasterIntentId) {
        // Attempt clean abandonment so backend schedules cleanup
        abandonUploadIntentRequest(createdMasterIntentId).catch(() => {});
      }
      setStep('form');
      if (err instanceof TemplateApiError) {
        setFormError(err.message);
        if (err.fieldErrors) setFieldErrors(err.fieldErrors);
      } else {
        setFormError(
          err instanceof Error
            ? err.message
            : 'An unexpected error occurred while uploading the template.'
        );
      }
    }
  };

  const isWorking = step !== 'form' && step !== 'success';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#24212B]/40 p-4 backdrop-blur-xs"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
    >
      <div className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-[#E8E5ED] bg-white shadow-2xl">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-[#E8E5ED] bg-white px-6 py-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#EFEBF8] text-[#6541A5]">
              <UploadCloud className="h-5 w-5" />
            </div>
            <div>
              <h2 id={titleId} className="text-base font-semibold text-[#24212B]">
                {isNewVersion
                  ? `Upload New Version: ${existingTemplate?.name}`
                  : 'Add New Creative Template'}
              </h2>
              <p className="text-xs text-[#77727F]">
                {isNewVersion
                  ? 'Add a revised Affinity or PSD master without breaking existing jobs.'
                  : 'Register a reusable Affinity or Photoshop master file for automated creative workflows.'}
              </p>
            </div>
          </div>
          {!isWorking && (
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg p-1.5 text-[#77727F] hover:bg-[#F8F7FA] hover:text-[#24212B]"
              aria-label="Close dialog"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          {formError && (
            <div className="flex items-start gap-2.5 rounded-xl border border-rose-200 bg-rose-50/80 p-3.5 text-xs text-rose-800">
              <AlertCircle className="h-4 w-4 shrink-0 text-rose-600 mt-0.5" />
              <span>{formError}</span>
            </div>
          )}

          {isWorking && (
            <div className="flex flex-col items-center justify-center py-8 space-y-3">
              <Loader2 className="h-8 w-8 animate-spin text-[#6541A5]" />
              <p className="text-sm font-semibold text-[#24212B]">{progressMessage}</p>
              <p className="text-xs text-[#77727F] max-w-sm text-center">
                Bytes are verified with SHA-256 and stored in private object storage. Do not navigate away.
              </p>
            </div>
          )}

          {step === 'form' && (
            <>
              {/* Template Metadata (Only for brand new template) */}
              {!isNewVersion && (
                <div className="space-y-4 rounded-xl border border-[#E8E5ED] bg-[#F8F7FA]/50 p-4">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-[#6541A5]">
                    1. Template Details
                  </h3>

                  <div>
                    <label className="block text-xs font-semibold text-[#24212B] mb-1">
                      Template Name <span className="text-rose-500">*</span>
                    </label>
                    <Input
                      type="text"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="e.g. Sunday Birthday Celebration Square"
                      disabled={isWorking}
                    />
                    {fieldErrors.name && (
                      <p className="text-xs text-rose-600 mt-1">{fieldErrors.name}</p>
                    )}
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-[#24212B] mb-1">
                        Category
                      </label>
                      <select
                        value={category}
                        onChange={(e) => setCategory(e.target.value as DesignCategory)}
                        className="w-full h-10 rounded-lg border border-[#E8E5ED] bg-white px-3 text-xs text-[#24212B] focus:border-[#6541A5] focus:outline-none"
                        disabled={isWorking}
                      >
                        {DESIGN_CATEGORIES.map((cat) => (
                          <option key={cat} value={cat}>
                            {TEMPLATE_CATEGORY_LABELS[cat] || cat}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-[#24212B] mb-1">
                        Authoring Studio
                      </label>
                      <select
                        value={studioType}
                        onChange={(e) => setStudioType(e.target.value as TemplateStudioType)}
                        className="w-full h-10 rounded-lg border border-[#E8E5ED] bg-white px-3 text-xs text-[#24212B] focus:border-[#6541A5] focus:outline-none"
                        disabled={isWorking}
                      >
                        {TEMPLATE_STUDIO_TYPES.map((studio) => (
                          <option key={studio} value={studio}>
                            {TEMPLATE_STUDIO_LABELS[studio] || studio}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-[#24212B] mb-1">
                      Description <span className="text-[#77727F] font-normal">(Optional)</span>
                    </label>
                    <textarea
                      rows={2}
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      placeholder="Usage context, dimensions, or target platform details..."
                      className="w-full rounded-lg border border-[#E8E5ED] bg-white p-2.5 text-xs text-[#24212B] focus:border-[#6541A5] focus:outline-none"
                      disabled={isWorking}
                    />
                  </div>
                </div>
              )}

              {/* Master File Upload */}
              <div className="space-y-3 rounded-xl border border-[#E8E5ED] bg-[#F8F7FA]/50 p-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-[#6541A5]">
                    {isNewVersion ? '1. Template Master File' : '2. Template Master File'}
                  </h3>
                  <span className="text-[11px] text-[#77727F]">Max 100 MB</span>
                </div>

                <div className="rounded-xl border border-dashed border-[#A99AD1] bg-white p-4 text-center">
                  <input
                    type="file"
                    id="master-file-input"
                    accept=".psd,.af,.afphoto,.afdesign,.afpub"
                    onChange={handleMasterFileChange}
                    className="hidden"
                    disabled={isWorking}
                  />
                  <label
                    htmlFor="master-file-input"
                    className="cursor-pointer flex flex-col items-center justify-center gap-1.5"
                  >
                    <FileText className="h-7 w-7 text-[#6541A5]" />
                    <span className="text-xs font-semibold text-[#6541A5] hover:underline">
                      {masterFile ? 'Choose a different master file' : 'Browse master file'}
                    </span>
                    <span className="text-[11px] text-[#77727F]">
                      Supported: Photoshop (.psd) or native Affinity (.af, .afphoto, .afdesign, .afpub)
                    </span>
                  </label>

                  {masterFile && (
                    <div className="mt-3 inline-flex items-center gap-2 rounded-lg bg-[#EFEBF8] px-3 py-1.5 text-xs font-medium text-[#6541A5]">
                      <FileCheck className="h-4 w-4 shrink-0" />
                      <span className="truncate max-w-xs">{masterFile.name}</span>
                      <span className="text-[11px] text-[#77727F]">
                        ({formatByteSize(masterFile.size)})
                      </span>
                    </div>
                  )}
                </div>

                {fieldErrors.masterFile && (
                  <p className="text-xs text-rose-600">{fieldErrors.masterFile}</p>
                )}

                {/* Honest Inspection Limitation Notice */}
                <div className="flex items-start gap-2 rounded-lg bg-amber-50/80 border border-amber-200 p-2.5 text-[11px] text-amber-900">
                  <Info className="h-3.5 w-3.5 text-amber-700 shrink-0 mt-0.5" />
                  <p>
                    <strong>Inspection Notice:</strong> Uploaded PSD and native Affinity files require manual layer mapping in Affinity 3.3. Automatic server-side layer parsing is disabled for security and sandboxing safety.
                  </p>
                </div>
              </div>

              {/* Optional Companion Preview Image */}
              <div className="space-y-3 rounded-xl border border-[#E8E5ED] bg-[#F8F7FA]/50 p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-[#6541A5]">
                      {isNewVersion ? '2. Visual Companion Preview' : '3. Visual Companion Preview'}
                    </h3>
                    <p className="text-[11px] text-[#77727F]">
                      Highly recommended: A rendered PNG, JPEG, or WebP of this template for web previews.
                    </p>
                  </div>
                  <span className="text-[11px] text-[#77727F]">Max 10 MB</span>
                </div>

                <div className="rounded-xl border border-dashed border-[#E8E5ED] bg-white p-3 text-center">
                  <input
                    type="file"
                    id="preview-file-input"
                    accept="image/png,image/jpeg,image/webp"
                    onChange={handlePreviewFileChange}
                    className="hidden"
                    disabled={isWorking}
                  />
                  <label
                    htmlFor="preview-file-input"
                    className="cursor-pointer flex flex-col items-center justify-center gap-1"
                  >
                    <ImageIcon className="h-5 w-5 text-[#77727F]" />
                    <span className="text-xs font-medium text-[#6541A5] hover:underline">
                      {previewFile ? 'Change companion preview' : 'Attach preview image (optional)'}
                    </span>
                  </label>

                  {previewFile && (
                    <div className="mt-2 inline-flex items-center gap-2 rounded-lg bg-[#F8F7FA] border border-[#E8E5ED] px-2.5 py-1 text-xs text-[#24212B]">
                      <span className="truncate max-w-xs">{previewFile.name}</span>
                      <span className="text-[11px] text-[#77727F]">
                        ({formatByteSize(previewFile.size)})
                      </span>
                    </div>
                  )}
                </div>

                {fieldErrors.previewFile && (
                  <p className="text-xs text-rose-600">{fieldErrors.previewFile}</p>
                )}
              </div>

              {/* Activation Option */}
              <div className="flex items-center gap-2.5 pt-1">
                <input
                  type="checkbox"
                  id="activate-immediately"
                  checked={activateImmediately}
                  onChange={(e) => setActivateImmediately(e.target.checked)}
                  className="h-4 w-4 rounded border-[#E8E5ED] text-[#6541A5] focus:ring-[#6541A5]"
                  disabled={isWorking}
                />
                <label
                  htmlFor="activate-immediately"
                  className="text-xs font-medium text-[#24212B] cursor-pointer"
                >
                  Activate this version immediately upon verification
                </label>
              </div>

              {/* Action Buttons */}
              <div className="flex items-center justify-end gap-3 pt-3 border-t border-[#E8E5ED]">
                <Button
                  type="button"
                  variant="outline"
                  onClick={onClose}
                  disabled={isWorking}
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={isWorking}>
                  <UploadCloud className="h-4 w-4 mr-1.5" />
                  {isNewVersion ? 'Upload Version' : 'Upload Template'}
                </Button>
              </div>
            </>
          )}
        </form>
      </div>
    </div>
  );
}
