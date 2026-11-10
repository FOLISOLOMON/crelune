import type { ReactNode } from 'react';
import { Badge } from './Badge.js';

export interface EmptyStateProps {
  title: string;
  description: string;
  badgeText?: string;
  actionText?: string;
  onAction?: () => void;
  icon?: ReactNode;
}

export function EmptyState({
  title,
  description,
  badgeText,
  actionText,
  onAction,
  icon,
}: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center p-8 text-center rounded-xl border border-dashed border-[#E8E5ED] bg-[#FBFBFC] max-w-lg mx-auto my-6">
      {icon && (
        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-[#EFEBF8] text-[#6541A5] mb-4">
          {icon}
        </div>
      )}
      {badgeText && (
        <Badge variant="primary" size="sm" className="mb-2">
          {badgeText}
        </Badge>
      )}
      <h4 className="text-base font-semibold text-[#24212B]">{title}</h4>
      <p className="mt-1.5 text-xs text-[#77727F] max-w-md leading-relaxed">
        {description}
      </p>
      {actionText && onAction && (
        <button
          onClick={onAction}
          className="mt-4 text-xs font-medium text-[#6541A5] hover:underline"
        >
          {actionText}
        </button>
      )}
    </div>
  );
}
