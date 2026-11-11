'use client';

import React, { useEffect, useId, useState } from 'react';
import { AlertCircle, Palette, X } from 'lucide-react';
import { Button, Input } from '@crelune/ui';
import {
  DESIGN_CATEGORIES,
  DESIGN_CATEGORY_LABELS,
  DESIGN_PRIORITIES,
  DESIGN_PRIORITY_LABELS,
  type DesignCategory,
  type DesignJobDetail,
  type DesignPriority,
} from '@crelune/shared';
import {
  createDesignJobRequest,
  DesignApiError,
} from '@/lib/designs/design-api-client';
import {
  buildCreateDesignJobPayload,
  EMPTY_DESIGN_JOB_FORM_VALUES,
  type DesignJobFormValues,
} from '@/lib/designs/design-form-utils';

export interface DesignMemberOption {
  id: string;
  fullName: string;
  preferredName?: string | null;
}

export interface DesignJobModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreated: (job: DesignJobDetail) => void;
  memberOptions?: DesignMemberOption[];
  initialPrefill?: Partial<DesignJobFormValues>;
  lockedMemberLabel?: string | null;
}

export function DesignJobModal({
  isOpen,
  onClose,
  onCreated,
  memberOptions = [],
  initialPrefill,
  lockedMemberLabel = null,
}: DesignJobModalProps) {
  const titleId = useId();
  const [values, setValues] = useState<DesignJobFormValues>(
    EMPTY_DESIGN_JOB_FORM_VALUES
  );
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setValues({
      ...EMPTY_DESIGN_JOB_FORM_VALUES,
      ...initialPrefill,
    });
    setFieldErrors({});
    setFormError(null);
  }, [isOpen, initialPrefill]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !isSubmitting) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, isSubmitting, onClose]);

  if (!isOpen) {
    return null;
  }

  const updateField = <K extends keyof DesignJobFormValues>(
    field: K,
    value: DesignJobFormValues[K]
  ) => {
    setValues((prev) => {
      const next = { ...prev, [field]: value };
      if (field === 'category') {
        if (value === 'BIRTHDAY_FLYER' && !next.birthdayTargetYear.trim()) {
          next.birthdayTargetYear = String(new Date().getFullYear());
        } else if (value !== 'BIRTHDAY_FLYER') {
          next.birthdayTargetYear = '';
        }
      }
      return next;
    });
    if (fieldErrors[field] || (field === 'category' && fieldErrors.birthdayTargetYear)) {
      setFieldErrors((prev) => {
        const next = { ...prev };
        delete next[field];
        if (field === 'category') {
          delete next.birthdayTargetYear;
        }
        return next;
      });
    }
    if (formError) {
      setFormError(null);
    }
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (isSubmitting) return;

    const built = buildCreateDesignJobPayload(values);
    if (!built.success) {
      setFieldErrors(built.fieldErrors);
      setFormError(built.formError);
      return;
    }

    setIsSubmitting(true);
    setFieldErrors({});
    setFormError(null);

    try {
      const created = await createDesignJobRequest(built.data);
      onCreated(created);
    } catch (error) {
      if (error instanceof DesignApiError) {
        if (error.fieldErrors) {
          setFieldErrors(error.fieldErrors);
        }
        setFormError(error.message);
      } else {
        setFormError('Unable to create design job right now.');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#24212B]/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
    >
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-[#E8E5ED] bg-white shadow-lg">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-[#E8E5ED] bg-white px-6 py-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#EFEBF8] text-[#6541A5]">
              <Palette className="h-4 w-4" />
            </div>
            <div>
              <h2
                id={titleId}
                className="text-base font-semibold text-[#24212B]"
              >
                New Design Job
              </h2>
              <p className="text-xs text-[#77727F]">
                Capture artwork specifications, target date, and creative brief.
              </p>
            </div>
          </div>
          <button
            type="button"
            aria-label="Close modal"
            disabled={isSubmitting}
            onClick={onClose}
            className="rounded-lg p-1.5 text-[#77727F] hover:bg-[#F8F7FA] hover:text-[#24212B] disabled:opacity-50"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 p-6">
          {formError && (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-lg border border-[#FECACA] bg-[#FEF2F2] p-3 text-xs text-[#991B1B]"
            >
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-[#DC2626]" />
              <span>{formError}</span>
            </div>
          )}

          <Input
            label="Job Title"
            required
            placeholder="e.g., Sunday Praise Celebration Flyer"
            value={values.title}
            onChange={(e) => updateField('title', e.target.value)}
            error={fieldErrors.title}
            disabled={isSubmitting}
          />

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="space-y-1.5">
              <label
                htmlFor="design-category-select"
                className="block text-xs font-medium text-[#24212B]"
              >
                Category
              </label>
              <select
                id="design-category-select"
                value={values.category}
                onChange={(e) =>
                  updateField('category', e.target.value as DesignCategory)
                }
                disabled={isSubmitting}
                className="h-9.5 w-full rounded-lg border border-[#E8E5ED] bg-white px-3 text-sm text-[#24212B] focus:border-[#6541A5] focus:outline-none focus:ring-2 focus:ring-[#6541A5]/20"
              >
                {DESIGN_CATEGORIES.map((category) => (
                  <option key={category} value={category}>
                    {DESIGN_CATEGORY_LABELS[category]}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <label
                htmlFor="design-priority-select"
                className="block text-xs font-medium text-[#24212B]"
              >
                Priority
              </label>
              <select
                id="design-priority-select"
                value={values.priority}
                onChange={(e) =>
                  updateField('priority', e.target.value as DesignPriority)
                }
                disabled={isSubmitting}
                className="h-9.5 w-full rounded-lg border border-[#E8E5ED] bg-white px-3 text-sm text-[#24212B] focus:border-[#6541A5] focus:outline-none focus:ring-2 focus:ring-[#6541A5]/20"
              >
                {DESIGN_PRIORITIES.map((priority) => (
                  <option key={priority} value={priority}>
                    {DESIGN_PRIORITY_LABELS[priority]}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <label
                htmlFor="design-initial-status-select"
                className="block text-xs font-medium text-[#24212B]"
              >
                Starting Stage
              </label>
              <select
                id="design-initial-status-select"
                value={values.initialStatus}
                onChange={(e) =>
                  updateField(
                    'initialStatus',
                    e.target.value as 'DRAFT' | 'PENDING'
                  )
                }
                disabled={isSubmitting}
                className="h-9.5 w-full rounded-lg border border-[#E8E5ED] bg-white px-3 text-sm text-[#24212B] focus:border-[#6541A5] focus:outline-none focus:ring-2 focus:ring-[#6541A5]/20"
              >
                <option value="DRAFT">Draft</option>
                <option value="PENDING">Pending Queue</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label
                htmlFor="design-member-select"
                className="block text-xs font-medium text-[#24212B]"
              >
                {values.category === 'BIRTHDAY_FLYER'
                  ? 'Linked Member *'
                  : 'Linked Member (Optional)'}
              </label>
              {lockedMemberLabel ? (
                <div className="flex h-9.5 items-center rounded-lg border border-[#E8E5ED] bg-[#F8F7FA] px-3 text-sm font-medium text-[#24212B]">
                  {lockedMemberLabel}
                </div>
              ) : (
                <select
                  id="design-member-select"
                  value={values.memberId}
                  onChange={(e) => updateField('memberId', e.target.value)}
                  disabled={isSubmitting}
                  className="h-9.5 w-full rounded-lg border border-[#E8E5ED] bg-white px-3 text-sm text-[#24212B] focus:border-[#6541A5] focus:outline-none focus:ring-2 focus:ring-[#6541A5]/20"
                >
                  <option value="">No member linked</option>
                  {memberOptions.map((member) => (
                    <option key={member.id} value={member.id}>
                      {member.fullName}
                      {member.preferredName ? ` (${member.preferredName})` : ''}
                    </option>
                  ))}
                </select>
              )}
              {fieldErrors.memberId && (
                <p className="text-xs font-medium text-[#DC2626]">
                  {fieldErrors.memberId}
                </p>
              )}
            </div>

            <Input
              label="Target Due Date"
              type="date"
              value={values.dueDate}
              onChange={(e) => updateField('dueDate', e.target.value)}
              error={fieldErrors.dueDate}
              disabled={isSubmitting}
            />
          </div>

          {values.category === 'BIRTHDAY_FLYER' && (
            <Input
              label="Birthday Target Year *"
              placeholder="e.g., 2026"
              value={values.birthdayTargetYear}
              onChange={(e) => updateField('birthdayTargetYear', e.target.value)}
              error={fieldErrors.birthdayTargetYear}
              helperText="Required for birthday flyer jobs so the design tracks against the member's annual birthday preparation."
              disabled={isSubmitting || Boolean(initialPrefill?.birthdayTargetYear)}
            />
          )}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Input
              label="Target Platform"
              placeholder="e.g., Instagram & WhatsApp Status"
              value={values.targetPlatform}
              onChange={(e) => updateField('targetPlatform', e.target.value)}
              error={fieldErrors.targetPlatform}
              disabled={isSubmitting}
            />
            <Input
              label="Dimensions / Aspect Ratio"
              placeholder="e.g., 1080 × 1350 px"
              value={values.dimensions}
              onChange={(e) => updateField('dimensions', e.target.value)}
              error={fieldErrors.dimensions}
              disabled={isSubmitting}
            />
          </div>

          <Input
            label="Preferred Template Note"
            placeholder="e.g., Clean editorial birthday layout v2"
            value={values.preferredTemplateNote}
            onChange={(e) =>
              updateField('preferredTemplateNote', e.target.value)
            }
            error={fieldErrors.preferredTemplateNote}
            disabled={isSubmitting}
          />

          <div className="space-y-1.5">
            <label
              htmlFor="design-required-text"
              className="block text-xs font-medium text-[#24212B]"
            >
              Required Artwork Copy
            </label>
            <textarea
              id="design-required-text"
              rows={3}
              placeholder="Headline, scripture/blessing, event details, or names to appear on artwork..."
              value={values.requiredText}
              onChange={(e) => updateField('requiredText', e.target.value)}
              disabled={isSubmitting}
              className="w-full rounded-lg border border-[#E8E5ED] bg-white px-3 py-2 text-sm text-[#24212B] placeholder-[#9B96A4] focus:border-[#6541A5] focus:outline-none focus:ring-2 focus:ring-[#6541A5]/20"
            />
            {fieldErrors.requiredText && (
              <p className="text-xs font-medium text-[#DC2626]">
                {fieldErrors.requiredText}
              </p>
            )}
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label
                htmlFor="design-reference-notes"
                className="block text-xs font-medium text-[#24212B]"
              >
                Reference Direction
              </label>
              <textarea
                id="design-reference-notes"
                rows={2}
                placeholder="Style cues, colour mood, typography direction..."
                value={values.referenceNotes}
                onChange={(e) => updateField('referenceNotes', e.target.value)}
                disabled={isSubmitting}
                className="w-full rounded-lg border border-[#E8E5ED] bg-white px-3 py-2 text-sm text-[#24212B] placeholder-[#9B96A4] focus:border-[#6541A5] focus:outline-none focus:ring-2 focus:ring-[#6541A5]/20"
              />
            </div>

            <div className="space-y-1.5">
              <label
                htmlFor="design-internal-notes"
                className="block text-xs font-medium text-[#24212B]"
              >
                Operational Notes
              </label>
              <textarea
                id="design-internal-notes"
                rows={2}
                placeholder="Production checklist or delivery reminders..."
                value={values.notes}
                onChange={(e) => updateField('notes', e.target.value)}
                disabled={isSubmitting}
                className="w-full rounded-lg border border-[#E8E5ED] bg-white px-3 py-2 text-sm text-[#24212B] placeholder-[#9B96A4] focus:border-[#6541A5] focus:outline-none focus:ring-2 focus:ring-[#6541A5]/20"
              />
            </div>
          </div>

          <div className="flex items-center justify-end gap-2.5 border-t border-[#E8E5ED] pt-4">
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button type="submit" variant="primary" isLoading={isSubmitting}>
              Create Design Job
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

