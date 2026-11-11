'use client';

import React, { useEffect, useState } from 'react';
import {
  getMemberInitials,
  getMemberPhotoStreamUrl,
} from '@/lib/members/member-form-utils';

export interface MemberAvatarProps {
  memberId: string;
  fullName: string;
  hasPhoto: boolean;
  photoUpdatedAt?: string | null;
  previewUrl?: string | null;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
}

const SIZE_CLASSES: Record<NonNullable<MemberAvatarProps['size']>, string> = {
  sm: 'h-9 w-9 text-xs',
  md: 'h-11 w-11 text-sm',
  lg: 'h-16 w-16 text-lg',
  xl: 'h-24 w-24 text-2xl',
};

export function MemberAvatar({
  memberId,
  fullName,
  hasPhoto,
  photoUpdatedAt,
  previewUrl = null,
  size = 'md',
  className = '',
}: MemberAvatarProps) {
  const [imageFailed, setImageFailed] = useState(false);

  useEffect(() => {
    setImageFailed(false);
  }, [memberId, hasPhoto, photoUpdatedAt, previewUrl]);

  const effectiveSrc = previewUrl
    ? previewUrl
    : hasPhoto
      ? getMemberPhotoStreamUrl(memberId, photoUpdatedAt)
      : null;

  const showImage = Boolean(effectiveSrc) && !imageFailed;
  const initials = getMemberInitials(fullName);

  return (
    <div
      className={`relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-lg border border-[#E8E5ED] bg-[#EFEBF8] font-semibold text-[#6541A5] select-none ${SIZE_CLASSES[size]} ${className}`}
      aria-label={`${fullName} avatar`}
    >
      {showImage && effectiveSrc ? (
        // Native <img> streams authenticated private member photos directly without public URL optimization.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={effectiveSrc}
          alt={fullName}
          className="h-full w-full object-cover"
          onError={() => setImageFailed(true)}
        />
      ) : (
        <span aria-hidden="true">{initials}</span>
      )}
    </div>
  );
}

