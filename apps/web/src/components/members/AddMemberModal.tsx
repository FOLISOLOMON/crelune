'use client';

import React, { useEffect, useId, useRef, useState } from 'react';
import {
  AlertCircle,
  ImagePlus,
  X,
} from 'lucide-react';
import { Button } from '@crelune/ui';
import type {
  DuplicateCandidateSummary,
  MemberDetail,
} from '@crelune/shared';
import {
  createMemberRequest,
  MemberApiError,
  uploadMemberPhotoRequest,
} from '@/lib/members/member-api-client';
import {
  buildCreateMemberPayload,
  EMPTY_MEMBER_FORM_VALUES,
  formatFileSize,
  validateClientPhotoFile,
  type MemberFieldErrors,
  type MemberFormField,
  type MemberFormValues,
} from '@/lib/members/member-form-utils';
import { DuplicateMemberDialog } from './DuplicateMemberDialog';
import { MemberFormFields } from './MemberFormFields';

export interface AddMemberModalProps {
  open: boolean;
  onClose: () => void;
  onMemberCreated: (
    member: MemberDetail,
    options: { photoWarning: string | null }
  ) => void;
}

export function AddMemberModal({
  open,
  onClose,
  onMemberCreated,
}: AddMemberModalProps) {
  const titleId = useId();
  const photoInputId = useId();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [values, setValues] = useState<MemberFormValues>(EMPTY_MEMBER_FORM_VALUES);
  const [fieldErrors, setFieldErrors] = useState<MemberFieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [selectedPhoto, setSelectedPhoto] = useState<File | null>(null);
  const [photoPreviewUrl, setPhotoPreviewUrl] = useState<string | null>(null);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [duplicateState, setDuplicateState] = useState<{
    message: string;
    candidates: DuplicateCandidateSummary[];
  } | null>(null);

  useEffect(() => {
    return () => {
      if (photoPreviewUrl) {
        URL.revokeObjectURL(photoPreviewUrl);
      }
    };
  }, [photoPreviewUrl]);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !isSubmitting && !duplicateState) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, isSubmitting, duplicateState, onClose]);

  const clearPhotoSelection = () => {
    if (photoPreviewUrl) {
      URL.revokeObjectURL(photoPreviewUrl);
    }
    setSelectedPhoto(null);
    setPhotoPreviewUrl(null);
    setPhotoError(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const resetForm = () => {
    setValues(EMPTY_MEMBER_FORM_VALUES);
    setFieldErrors({});
    setFormError(null);
    setDuplicateState(null);
    clearPhotoSelection();
  };

  const handleClose = () => {
    if (isSubmitting) return;
    resetForm();
    onClose();
  };

  const handleFieldChange = (field: MemberFormField, value: string) => {
    setValues((prev) => ({ ...prev, [field]: value }));
    if (fieldErrors[field]) {
      setFieldErrors((prev) => {
        const next = { ...prev };
        delete next[field];
        return next;
      });
    }
    if (formError) {
      setFormError(null);
    }
  };

  const handlePhotoChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setPhotoError(null);
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    const validation = validateClientPhotoFile(file);
    if (!validation.valid) {
      clearPhotoSelection();
      setPhotoError(validation.error);
      return;
    }

    if (photoPreviewUrl) {
      URL.revokeObjectURL(photoPreviewUrl);
    }
    setSelectedPhoto(file);
    setPhotoPreviewUrl(URL.createObjectURL(file));
  };

  const submitMember = async (confirmDuplicate: boolean) => {
    if (isSubmitting) {
      return;
    }

    const built = buildCreateMemberPayload(values, confirmDuplicate);
    if (!built.success) {
      setFieldErrors(built.fieldErrors);
      setFormError(
        built.formError ??
          (Object.keys(built.fieldErrors).length > 0
            ? 'Please correct the highlighted fields.'
            : 'Please review the member details.')
      );
      setDuplicateState(null);
      return;
    }

    setFieldErrors({});
    setFormError(null);
    setIsSubmitting(true);

    try {
      const createResult = await createMemberRequest(built.data);

      if (createResult.status === 'duplicate') {
        setDuplicateState({
          message: createResult.message,
          candidates: createResult.duplicateCandidates,
        });
        return;
      }

      let finalMember = createResult.member;
      let photoWarning: string | null = null;

      if (selectedPhoto) {
        try {
          const uploadResult = await uploadMemberPhotoRequest(
            finalMember.id,
            selectedPhoto
          );
          finalMember = uploadResult.member;
        } catch (photoErr) {
          photoWarning =
            photoErr instanceof Error
              ? `${finalMember.fullName} was saved, but the optional photo upload failed: ${photoErr.message}`
              : `${finalMember.fullName} was saved, but the optional photo upload failed. You can upload it from the member profile.`;
        }
      }

      resetForm();
      onMemberCreated(finalMember, { photoWarning });
    } catch (err) {
      setDuplicateState(null);
      if (err instanceof MemberApiError) {
        if (err.fieldErrors && Object.keys(err.fieldErrors).length > 0) {
          setFieldErrors(err.fieldErrors);
        }
        setFormError(err.message);
      } else {
        setFormError('Unable to reach the server. Please try again.');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleFormSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    await submitMember(false);
  };

  if (!open) {
    return null;
  }

  return (
    <>
      <div
        className="fixed inset-0 z-40 flex items-center justify-center bg-[#24212B]/40 p-4 overflow-y-auto"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div className="my-auto w-full max-w-2xl rounded-lg border border-[#E8E5ED] bg-white shadow-lg">
          <div className="flex items-center justify-between border-b border-[#E8E5ED] px-6 py-4">
            <div>
              <h2
                id={titleId}
                className="text-lg font-semibold text-[#24212B]"
              >
                Add Member
              </h2>
              <p className="mt-0.5 text-xs text-[#77727F]">
                Create a private creative directory profile. Only full name is required.
              </p>
            </div>
            <button
              type="button"
              onClick={handleClose}
              disabled={isSubmitting}
              aria-label="Close Add Member modal"
              className="rounded-md p-1.5 text-[#77727F] hover:bg-[#F8F7FA] hover:text-[#24212B] disabled:opacity-50"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <form onSubmit={handleFormSubmit} noValidate>
            <div className="max-h-[75vh] overflow-y-auto px-6 py-5 space-y-5">
              {formError && (
                <div
                  role="alert"
                  className="flex items-start gap-2 rounded-lg border border-[#FECACA] bg-[#FEF2F2] p-3 text-xs text-[#991B1B]"
                >
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-[#DC2626]" />
                  <span>{formError}</span>
                </div>
              )}

              <MemberFormFields
                values={values}
                errors={fieldErrors}
                disabled={isSubmitting}
                onChange={handleFieldChange}
              />

              <div className="rounded-lg border border-[#E8E5ED] bg-[#F8F7FA]/60 p-4 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <label
                    htmlFor={photoInputId}
                    className="text-xs font-semibold text-[#24212B]"
                  >
                    Initial Profile Photo (Optional)
                  </label>
                  <span className="text-[11px] text-[#77727F]">
                    JPEG, PNG, or WebP · Max 10 MB
                  </span>
                </div>

                <input
                  ref={fileInputRef}
                  id={photoInputId}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="sr-only"
                  disabled={isSubmitting}
                  onChange={handlePhotoChange}
                />

                {photoError && (
                  <p className="text-xs text-[#DC2626]">{photoError}</p>
                )}

                {selectedPhoto && photoPreviewUrl ? (
                  <div className="flex items-center justify-between gap-3 rounded-md border border-[#E8E5ED] bg-white p-2.5">
                    <div className="flex items-center gap-3 min-w-0">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={photoPreviewUrl}
                        alt="Selected member photo preview"
                        className="h-11 w-11 shrink-0 rounded-md object-cover border border-[#E8E5ED]"
                      />
                      <div className="min-w-0">
                        <p className="text-xs font-medium text-[#24212B] truncate">
                          {selectedPhoto.name}
                        </p>
                        <p className="text-[11px] text-[#77727F] tabular-nums">
                          {formatFileSize(selectedPhoto.size)} · Ready to upload privately
                        </p>
                      </div>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={isSubmitting}
                      onClick={clearPhotoSelection}
                    >
                      Remove
                    </Button>
                  </div>
                ) : (
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    disabled={isSubmitting}
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <ImagePlus className="mr-1.5 h-3.5 w-3.5" />
                    Select Photo (Optional)
                  </Button>
                )}
              </div>
            </div>

            <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2.5 border-t border-[#E8E5ED] bg-[#FBFBFC] px-6 py-4 rounded-b-lg">
              <Button
                type="button"
                variant="secondary"
                size="md"
                disabled={isSubmitting}
                onClick={handleClose}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                variant="primary"
                size="md"
                isLoading={isSubmitting}
                disabled={isSubmitting}
              >
                Create Member
              </Button>
            </div>
          </form>
        </div>
      </div>

      <DuplicateMemberDialog
        open={Boolean(duplicateState)}
        candidates={duplicateState?.candidates ?? []}
        message={
          duplicateState?.message ??
          'A member with matching details already exists in this directory.'
        }
        isConfirming={isSubmitting}
        onCancel={() => setDuplicateState(null)}
        onConfirmCreate={() => submitMember(true)}
      />
    </>
  );
}

