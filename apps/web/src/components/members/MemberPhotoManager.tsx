'use client';

import React, { useEffect, useId, useRef, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Lock,
  Trash2,
  Upload,
} from 'lucide-react';
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@crelune/ui';
import type { MemberDetail } from '@crelune/shared';
import {
  removeMemberPhotoRequest,
  uploadMemberPhotoRequest,
} from '@/lib/members/member-api-client';
import {
  formatFileSize,
  validateClientPhotoFile,
} from '@/lib/members/member-form-utils';
import { MemberAvatar } from './MemberAvatar';

export interface MemberPhotoManagerProps {
  member: MemberDetail;
  onMemberUpdated: (updated: MemberDetail) => void;
}

export function MemberPhotoManager({
  member,
  onMemberUpdated,
}: MemberPhotoManagerProps) {
  const inputId = useId();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isRemoving, setIsRemoving] = useState(false);
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const isArchived = !member.isActive;
  const isBusy = isUploading || isRemoving;

  useEffect(() => {
    return () => {
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
      }
    };
  }, [previewUrl]);

  const clearSelection = () => {
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
    }
    setSelectedFile(null);
    setPreviewUrl(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleFileSelected = (event: React.ChangeEvent<HTMLInputElement>) => {
    setError(null);
    setStatusMessage(null);
    setConfirmingRemove(false);

    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    const validation = validateClientPhotoFile(file);
    if (!validation.valid) {
      clearSelection();
      setError(validation.error);
      return;
    }

    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
    }
    const nextUrl = URL.createObjectURL(file);
    setSelectedFile(file);
    setPreviewUrl(nextUrl);
  };

  const handleUploadConfirm = async () => {
    if (!selectedFile || isBusy || isArchived) {
      return;
    }

    setError(null);
    setStatusMessage(null);
    setIsUploading(true);

    try {
      const result = await uploadMemberPhotoRequest(member.id, selectedFile);
      clearSelection();
      onMemberUpdated(result.member);
      setStatusMessage(
        member.hasPhoto
          ? 'Profile photo replaced and stored privately.'
          : 'Profile photo uploaded and stored privately.'
      );
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Failed to upload member photo. Please try again.'
      );
    } finally {
      setIsUploading(false);
    }
  };

  const handleRemoveConfirmed = async () => {
    if (!member.hasPhoto || isBusy || isArchived) {
      return;
    }

    setError(null);
    setStatusMessage(null);
    setIsRemoving(true);

    try {
      const result = await removeMemberPhotoRequest(member.id);
      setConfirmingRemove(false);
      onMemberUpdated(result.member);
      setStatusMessage('Profile photo removed.');
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Failed to remove member photo. Please try again.'
      );
    } finally {
      setIsRemoving(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <CardTitle>Private Profile Photo</CardTitle>
          <span className="inline-flex items-center gap-1 text-[11px] font-medium text-[#77727F]">
            <Lock className="h-3 w-3 text-[#6541A5]" />
            Owner-only
          </span>
        </div>
        <CardDescription>
          JPEG, PNG, or WebP up to 10 MB. Stored privately and streamed via authenticated access.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        <div className="flex items-center gap-4">
          <MemberAvatar
            memberId={member.id}
            fullName={member.fullName}
            hasPhoto={member.hasPhoto}
            photoUpdatedAt={member.photoUpdatedAt}
            previewUrl={previewUrl}
            size="xl"
          />

          <div className="min-w-0 space-y-1">
            {selectedFile ? (
              <>
                <p className="text-xs font-semibold text-[#6541A5]">
                  Ready to upload preview
                </p>
                <p className="text-xs text-[#24212B] truncate">
                  {selectedFile.name}
                </p>
                <p className="text-[11px] text-[#77727F] tabular-nums">
                  {formatFileSize(selectedFile.size)}
                </p>
              </>
            ) : member.hasPhoto ? (
              <>
                <p className="text-xs font-medium text-[#24212B]">
                  Private photo on file
                </p>
                <p className="text-[11px] text-[#77727F]">
                  Replacing generates a fresh protected copy and removes the previous file.
                </p>
              </>
            ) : (
              <>
                <p className="text-xs font-medium text-[#24212B]">
                  No photo uploaded
                </p>
                <p className="text-[11px] text-[#77727F]">
                  Initials are shown in the directory until a photo is added.
                </p>
              </>
            )}
          </div>
        </div>

        {error && (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-lg border border-[#FECACA] bg-[#FEF2F2] p-3 text-xs text-[#991B1B]"
          >
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-[#DC2626]" />
            <span>{error}</span>
          </div>
        )}

        {statusMessage && (
          <div
            role="status"
            className="flex items-start gap-2 rounded-lg border border-[#A7F3D0] bg-[#ECFDF5] p-3 text-xs text-[#047857]"
          >
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[#059669]" />
            <span>{statusMessage}</span>
          </div>
        )}

        {isArchived ? (
          <div className="rounded-lg border border-[#FDE68A] bg-[#FFFBEB] px-3 py-2.5 text-xs text-[#92400E]">
            This member is archived. Restore the member before uploading, replacing, or removing their photo.
          </div>
        ) : (
          <div className="space-y-3">
            <input
              ref={fileInputRef}
              id={inputId}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="sr-only"
              disabled={isBusy}
              onChange={handleFileSelected}
            />

            {selectedFile ? (
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  variant="primary"
                  size="sm"
                  isLoading={isUploading}
                  disabled={isBusy}
                  onClick={handleUploadConfirm}
                >
                  {member.hasPhoto ? 'Save Replacement Photo' : 'Upload Photo'}
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={isBusy}
                  onClick={clearSelection}
                >
                  Cancel Selection
                </Button>
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={isBusy}
                  onClick={() => fileInputRef.current?.click()}
                >
                  <Upload className="mr-1.5 h-3.5 w-3.5" />
                  {member.hasPhoto ? 'Replace Photo' : 'Choose Photo'}
                </Button>

                {member.hasPhoto && !confirmingRemove && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={isBusy}
                    onClick={() => {
                      setError(null);
                      setStatusMessage(null);
                      setConfirmingRemove(true);
                    }}
                    className="text-[#991B1B] hover:bg-[#FEF2F2] hover:text-[#991B1B]"
                  >
                    <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                    Remove
                  </Button>
                )}
              </div>
            )}

            {confirmingRemove && (
              <div className="rounded-lg border border-[#FECACA] bg-[#FEF2F2] p-3 space-y-2.5">
                <p className="text-xs font-medium text-[#991B1B]">
                  Remove this member&apos;s private profile photo?
                </p>
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="danger"
                    size="sm"
                    isLoading={isRemoving}
                    disabled={isBusy}
                    onClick={handleRemoveConfirmed}
                  >
                    Yes, Remove Photo
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    disabled={isBusy}
                    onClick={() => setConfirmingRemove(false)}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
