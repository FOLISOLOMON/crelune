'use client';

import React, { useEffect, useId } from 'react';
import Link from 'next/link';
import { AlertTriangle, ExternalLink } from 'lucide-react';
import { Badge, Button } from '@crelune/ui';
import type { DuplicateCandidateSummary } from '@crelune/shared';
import {
  describeDuplicateMatchReason,
  formatBirthdayMonthDay,
} from '@/lib/members/member-form-utils';

export interface DuplicateMemberDialogProps {
  open: boolean;
  candidates: DuplicateCandidateSummary[];
  message: string;
  isConfirming: boolean;
  onCancel: () => void;
  onConfirmCreate: () => void;
}

export function DuplicateMemberDialog({
  open,
  candidates,
  message,
  isConfirming,
  onCancel,
  onConfirmCreate,
}: DuplicateMemberDialogProps) {
  const titleId = useId();

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !isConfirming) {
        onCancel();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, isConfirming, onCancel]);

  if (!open) {
    return null;
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#24212B]/45 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
    >
      <div className="w-full max-w-lg rounded-lg border border-[#E8E5ED] bg-white shadow-lg">
        <div className="flex items-start gap-3 border-b border-[#E8E5ED] px-5 py-4">
          <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#FFFBEB] text-[#B45309] border border-[#FDE68A]">
            <AlertTriangle className="h-4 w-4" />
          </div>
          <div>
            <h3 id={titleId} className="text-base font-semibold text-[#24212B]">
              Possible Duplicate Member Found
            </h3>
            <p className="mt-1 text-xs text-[#77727F] leading-relaxed">
              {message}
            </p>
          </div>
        </div>

        <div className="max-h-72 overflow-y-auto px-5 py-4 space-y-2.5">
          <p className="text-xs font-medium text-[#24212B]">
            Matching existing {candidates.length === 1 ? 'record' : 'records'}:
          </p>

          {candidates.map((candidate) => {
            const birthdayLabel = formatBirthdayMonthDay(
              candidate.birthMonth,
              candidate.birthDay
            );
            return (
              <div
                key={candidate.id}
                className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 rounded-lg border border-[#E8E5ED] bg-[#F8F7FA] px-3.5 py-2.5"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold text-[#24212B] truncate">
                      {candidate.fullName}
                    </span>
                    {candidate.preferredName && (
                      <span className="text-xs text-[#77727F]">
                        ({candidate.preferredName})
                      </span>
                    )}
                    <Badge
                      variant={candidate.isArchived ? 'warning' : 'success'}
                      size="sm"
                    >
                      {candidate.isArchived ? 'Archived' : 'Active'}
                    </Badge>
                  </div>
                  <p className="mt-0.5 text-xs text-[#77727F]">
                    {describeDuplicateMatchReason(candidate.matchReason)}
                    {birthdayLabel ? ` · Birthday ${birthdayLabel}` : ''}
                  </p>
                </div>

                <Link
                  href={`/members/${candidate.id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-[#6541A5] hover:underline"
                >
                  Inspect
                  <ExternalLink className="h-3 w-3" />
                </Link>
              </div>
            );
          })}
        </div>

        <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2.5 border-t border-[#E8E5ED] bg-[#FBFBFC] px-5 py-3.5 rounded-b-lg">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={isConfirming}
            onClick={onCancel}
          >
            Cancel & Review Form
          </Button>
          <Button
            type="button"
            variant="primary"
            size="sm"
            isLoading={isConfirming}
            onClick={onConfirmCreate}
          >
            Yes, Create Separate Member
          </Button>
        </div>
      </div>
    </div>
  );
}

