'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import {
  AlertCircle,
  ArrowLeft,
  Calendar,
  CheckCircle2,
  Clock,
  Pencil,
  ShieldCheck,
  UserRound,
} from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
} from '@crelune/ui';
import {
  DESIGN_CATEGORIES,
  DESIGN_CATEGORY_LABELS,
  DESIGN_JOB_STATUS_LABELS,
  DESIGN_PRIORITIES,
  DESIGN_PRIORITY_LABELS,
  getAllowedNextDesignJobStatuses,
  type DesignCategory,
  type DesignJobDetail,
  type DesignJobStatus,
  type DesignPriority,
} from '@crelune/shared';
import {
  DesignApiError,
  transitionDesignJobRequest,
  updateDesignJobRequest,
} from '@/lib/designs/design-api-client';
import {
  buildUpdateDesignJobPayload,
  designJobDetailToFormValues,
  formatCivilIsoDisplay,
  getDesignPriorityBadgeVariant,
  getDesignStatusBadgeVariant,
  type DesignJobFormValues,
} from '@/lib/designs/design-form-utils';
import { formatMemberTimestamp } from '@/lib/members/member-form-utils';
import { MemberAvatar } from '@/components/members/MemberAvatar';
import type { DesignMemberOption } from './DesignJobModal';

export interface DesignJobDetailClientProps {
  initialJob: DesignJobDetail;
  memberOptions: DesignMemberOption[];
}

export function DesignJobDetailClient({
  initialJob,
  memberOptions,
}: DesignJobDetailClientProps) {
  const [job, setJob] = useState<DesignJobDetail>(initialJob);
  const [isEditing, setIsEditing] = useState(false);
  const [formValues, setFormValues] = useState<DesignJobFormValues>(() =>
    designJobDetailToFormValues(initialJob)
  );
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const [transitionNote, setTransitionNote] = useState('');
  const [transitionError, setTransitionError] = useState<string | null>(null);
  const [transitionBusyStatus, setTransitionBusyStatus] =
    useState<DesignJobStatus | null>(null);
  const [statusBanner, setStatusBanner] = useState<string | null>(null);

  const allowedTransitions = getAllowedNextDesignJobStatuses(job.status);

  const handleFieldChange = <K extends keyof DesignJobFormValues>(
    field: K,
    value: DesignJobFormValues[K]
  ) => {
    setFormValues((prev) => {
      const next = { ...prev, [field]: value };
      if (field === 'category') {
        if (value === 'BIRTHDAY_FLYER' && !next.birthdayTargetYear.trim()) {
          next.birthdayTargetYear = String(
            job.birthdayTargetYear ?? new Date().getFullYear()
          );
        } else if (value !== 'BIRTHDAY_FLYER') {
          next.birthdayTargetYear = '';
        }
      }
      return next;
    });
    if (
      fieldErrors[field] ||
      (field === 'category' && fieldErrors.birthdayTargetYear)
    ) {
      setFieldErrors((prev) => {
        const next = { ...prev };
        delete next[field];
        if (field === 'category') {
          delete next.birthdayTargetYear;
        }
        return next;
      });
    }
    if (formError) setFormError(null);
  };

  const handleSaveEdits = async (event: React.FormEvent) => {
    event.preventDefault();
    if (isSaving) return;

    const built = buildUpdateDesignJobPayload(job, formValues);
    if (!built.success) {
      setFieldErrors(built.fieldErrors);
      setFormError(built.formError);
      return;
    }

    if (!built.hasChanges) {
      setIsEditing(false);
      return;
    }

    setIsSaving(true);
    setFieldErrors({});
    setFormError(null);

    try {
      const updated = await updateDesignJobRequest(job.id, built.data);
      setJob(updated);
      setFormValues(designJobDetailToFormValues(updated));
      setIsEditing(false);
      setStatusBanner('Design brief details saved.');
    } catch (error) {
      if (error instanceof DesignApiError) {
        if (error.fieldErrors) setFieldErrors(error.fieldErrors);
        setFormError(error.message);
      } else {
        setFormError('Unable to update design brief right now.');
      }
    } finally {
      setIsSaving(false);
    }
  };

  const handleTransition = async (nextStatus: DesignJobStatus) => {
    if (transitionBusyStatus) return;
    setTransitionBusyStatus(nextStatus);
    setTransitionError(null);
    setStatusBanner(null);

    try {
      const updated = await transitionDesignJobRequest(job.id, {
        status: nextStatus,
        note: transitionNote.trim() || undefined,
      });
      setJob(updated);
      setTransitionNote('');
      setStatusBanner(
        `Design status updated to ${DESIGN_JOB_STATUS_LABELS[updated.status]}.`
      );
    } catch (error) {
      setTransitionError(
        error instanceof DesignApiError
          ? error.message
          : 'Unable to update design status right now.'
      );
    } finally {
      setTransitionBusyStatus(null);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/designs"
          className="inline-flex items-center gap-1.5 text-xs font-medium text-[#77727F] hover:text-[#6541A5]"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to Design Management
        </Link>

        <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-bold tracking-tight text-[#24212B] sm:text-2xl">
                {job.title}
              </h1>
              <Badge variant={getDesignStatusBadgeVariant(job.status)} size="md">
                {DESIGN_JOB_STATUS_LABELS[job.status]}
              </Badge>
              <Badge
                variant={getDesignPriorityBadgeVariant(job.priority)}
                size="sm"
              >
                {DESIGN_PRIORITY_LABELS[job.priority]}
              </Badge>
            </div>
            <p className="mt-1 text-xs text-[#77727F]">
              {DESIGN_CATEGORY_LABELS[job.category]} · Due{' '}
              {formatCivilIsoDisplay(job.dueDate)}
            </p>
          </div>

          {!isEditing && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                setFormValues(designJobDetailToFormValues(job));
                setFieldErrors({});
                setFormError(null);
                setStatusBanner(null);
                setIsEditing(true);
              }}
            >
              <Pencil className="h-3.5 w-3.5" />
              Edit Brief
            </Button>
          )}
        </div>
      </div>

      {statusBanner && (
        <div
          role="status"
          className="flex items-center gap-2 rounded-lg border border-[#BBF7D0] bg-[#F0FDF4] px-4 py-3 text-xs font-medium text-[#166534]"
        >
          <CheckCircle2 className="h-4 w-4 shrink-0 text-[#16A34A]" />
          <span>{statusBanner}</span>
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Main Column */}
        <div className="space-y-6 lg:col-span-2">
          {/* Status Workflow Card */}
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <ShieldCheck className="h-4 w-4 text-[#6541A5]" />
                <CardTitle>Production Pipeline</CardTitle>
              </div>
              <CardDescription>
                Move this job through approved stages. Exported and Published are tracked separately.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {job.status === 'EXPORTED' && (
                <div className="rounded-lg border border-[#D3CAEC] bg-[#EFEBF8]/60 px-3.5 py-2.5 text-xs text-[#24212B]">
                  <strong>Publication Check:</strong> Exporting artwork does not automatically mark a design as published. Confirm <strong>Published</strong> explicitly after sharing or posting.
                </div>
              )}

              {transitionError && (
                <div
                  role="alert"
                  className="flex items-start gap-2 rounded-lg border border-[#FECACA] bg-[#FEF2F2] p-3 text-xs text-[#991B1B]"
                >
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-[#DC2626]" />
                  <span>{transitionError}</span>
                </div>
              )}

              {allowedTransitions.length === 0 ? (
                <p className="text-xs text-[#77727F]">
                  This job is in terminal status ({DESIGN_JOB_STATUS_LABELS[job.status]}).
                </p>
              ) : (
                <>
                  <Input
                    label="Transition Note (Optional)"
                    placeholder="Add context for this status update (e.g., Exported 1080x1350 PNG)..."
                    value={transitionNote}
                    onChange={(e) => setTransitionNote(e.target.value)}
                    disabled={transitionBusyStatus !== null}
                  />
                  <div className="flex flex-wrap gap-2">
                    {allowedTransitions.map((targetStatus) => (
                      <Button
                        key={targetStatus}
                        type="button"
                        variant={
                          targetStatus === 'CANCELLED'
                            ? 'danger'
                            : targetStatus === 'PUBLISHED' ||
                                targetStatus === 'APPROVED'
                              ? 'primary'
                              : 'secondary'
                        }
                        size="sm"
                        isLoading={transitionBusyStatus === targetStatus}
                        disabled={transitionBusyStatus !== null}
                        onClick={() => handleTransition(targetStatus)}
                      >
                        Move to {DESIGN_JOB_STATUS_LABELS[targetStatus]}
                      </Button>
                    ))}
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          {/* Creative Brief Card */}
          <Card>
            <CardHeader>
              <CardTitle>Creative Brief & Specifications</CardTitle>
              <CardDescription>
                Copy, sizing, platform target, and operational notes.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {isEditing ? (
                <form onSubmit={handleSaveEdits} className="space-y-4">
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
                    value={formValues.title}
                    onChange={(e) => handleFieldChange('title', e.target.value)}
                    error={fieldErrors.title}
                    disabled={isSaving}
                  />

                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                    <div className="space-y-1.5">
                      <label
                        htmlFor="edit-design-category"
                        className="block text-xs font-medium text-[#24212B]"
                      >
                        Category
                      </label>
                      <select
                        id="edit-design-category"
                        value={formValues.category}
                        onChange={(e) =>
                          handleFieldChange(
                            'category',
                            e.target.value as DesignCategory
                          )
                        }
                        disabled={isSaving}
                        className="h-9.5 w-full rounded-lg border border-[#E8E5ED] bg-white px-3 text-sm text-[#24212B]"
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
                        htmlFor="edit-design-priority"
                        className="block text-xs font-medium text-[#24212B]"
                      >
                        Priority
                      </label>
                      <select
                        id="edit-design-priority"
                        value={formValues.priority}
                        onChange={(e) =>
                          handleFieldChange(
                            'priority',
                            e.target.value as DesignPriority
                          )
                        }
                        disabled={isSaving}
                        className="h-9.5 w-full rounded-lg border border-[#E8E5ED] bg-white px-3 text-sm text-[#24212B]"
                      >
                        {DESIGN_PRIORITIES.map((priority) => (
                          <option key={priority} value={priority}>
                            {DESIGN_PRIORITY_LABELS[priority]}
                          </option>
                        ))}
                      </select>
                    </div>

                    <Input
                      label="Due Date"
                      type="date"
                      value={formValues.dueDate}
                      onChange={(e) =>
                        handleFieldChange('dueDate', e.target.value)
                      }
                      error={fieldErrors.dueDate}
                      disabled={isSaving}
                    />
                  </div>

                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <label
                        htmlFor="edit-design-member"
                        className="block text-xs font-medium text-[#24212B]"
                      >
                        {formValues.category === 'BIRTHDAY_FLYER'
                          ? 'Linked Member *'
                          : 'Linked Member'}
                      </label>
                      <select
                        id="edit-design-member"
                        value={formValues.memberId}
                        onChange={(e) =>
                          handleFieldChange('memberId', e.target.value)
                        }
                        disabled={isSaving}
                        className="h-9.5 w-full rounded-lg border border-[#E8E5ED] bg-white px-3 text-sm text-[#24212B]"
                      >
                        <option value="">No member linked</option>
                        {memberOptions.map((member) => (
                          <option key={member.id} value={member.id}>
                            {member.fullName}
                          </option>
                        ))}
                      </select>
                      {fieldErrors.memberId && (
                        <p className="text-xs font-medium text-[#DC2626]">
                          {fieldErrors.memberId}
                        </p>
                      )}
                    </div>

                    <Input
                      label="Target Platform"
                      value={formValues.targetPlatform}
                      onChange={(e) =>
                        handleFieldChange('targetPlatform', e.target.value)
                      }
                      disabled={isSaving}
                    />
                  </div>

                  {formValues.category === 'BIRTHDAY_FLYER' && (
                    <Input
                      label="Birthday Target Year *"
                      placeholder="e.g., 2026"
                      value={formValues.birthdayTargetYear}
                      onChange={(e) =>
                        handleFieldChange('birthdayTargetYear', e.target.value)
                      }
                      error={fieldErrors.birthdayTargetYear}
                      helperText="Changing the member or target year updates the linked birthday preparation record."
                      disabled={isSaving}
                    />
                  )}

                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <Input
                      label="Dimensions"
                      value={formValues.dimensions}
                      onChange={(e) =>
                        handleFieldChange('dimensions', e.target.value)
                      }
                      disabled={isSaving}
                    />
                    <Input
                      label="Preferred Template Note"
                      value={formValues.preferredTemplateNote}
                      onChange={(e) =>
                        handleFieldChange(
                          'preferredTemplateNote',
                          e.target.value
                        )
                      }
                      disabled={isSaving}
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label
                      htmlFor="edit-required-text"
                      className="block text-xs font-medium text-[#24212B]"
                    >
                      Required Artwork Copy
                    </label>
                    <textarea
                      id="edit-required-text"
                      rows={3}
                      value={formValues.requiredText}
                      onChange={(e) =>
                        handleFieldChange('requiredText', e.target.value)
                      }
                      disabled={isSaving}
                      className="w-full rounded-lg border border-[#E8E5ED] bg-white px-3 py-2 text-sm text-[#24212B]"
                    />
                  </div>

                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <label
                        htmlFor="edit-reference-notes"
                        className="block text-xs font-medium text-[#24212B]"
                      >
                        Reference Direction
                      </label>
                      <textarea
                        id="edit-reference-notes"
                        rows={2}
                        value={formValues.referenceNotes}
                        onChange={(e) =>
                          handleFieldChange('referenceNotes', e.target.value)
                        }
                        disabled={isSaving}
                        className="w-full rounded-lg border border-[#E8E5ED] bg-white px-3 py-2 text-sm text-[#24212B]"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label
                        htmlFor="edit-design-notes"
                        className="block text-xs font-medium text-[#24212B]"
                      >
                        Operational Notes
                      </label>
                      <textarea
                        id="edit-design-notes"
                        rows={2}
                        value={formValues.notes}
                        onChange={(e) =>
                          handleFieldChange('notes', e.target.value)
                        }
                        disabled={isSaving}
                        className="w-full rounded-lg border border-[#E8E5ED] bg-white px-3 py-2 text-sm text-[#24212B]"
                      />
                    </div>
                  </div>

                  <div className="flex items-center justify-end gap-2 pt-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={isSaving}
                      onClick={() => setIsEditing(false)}
                    >
                      Cancel
                    </Button>
                    <Button
                      type="submit"
                      variant="primary"
                      size="sm"
                      isLoading={isSaving}
                    >
                      Save Brief Changes
                    </Button>
                  </div>
                </form>
              ) : (
                <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2 text-sm">
                  <div>
                    <dt className="text-xs font-medium text-[#77727F]">
                      Target Platform
                    </dt>
                    <dd className="mt-1 text-[#24212B]">
                      {job.targetPlatform ?? 'Not specified'}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs font-medium text-[#77727F]">
                      Dimensions
                    </dt>
                    <dd className="mt-1 text-[#24212B]">
                      {job.dimensions ?? 'Not specified'}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs font-medium text-[#77727F]">
                      Preferred Template
                    </dt>
                    <dd className="mt-1 text-[#24212B]">
                      {job.preferredTemplateNote ?? 'None specified'}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs font-medium text-[#77727F]">
                      Due Date
                    </dt>
                    <dd className="mt-1 inline-flex items-center gap-1.5 text-[#24212B]">
                      <Calendar className="h-3.5 w-3.5 text-[#77727F]" />
                      {formatCivilIsoDisplay(job.dueDate)}
                    </dd>
                  </div>
                  <div className="sm:col-span-2">
                    <dt className="text-xs font-medium text-[#77727F]">
                      Required Artwork Copy
                    </dt>
                    <dd className="mt-1 whitespace-pre-wrap rounded-lg border border-[#E8E5ED] bg-[#F8F7FA] p-3 text-xs text-[#24212B]">
                      {job.requiredText ?? 'No artwork copy recorded yet.'}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs font-medium text-[#77727F]">
                      Reference Direction
                    </dt>
                    <dd className="mt-1 whitespace-pre-wrap text-xs text-[#24212B]">
                      {job.referenceNotes ?? 'No reference notes.'}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs font-medium text-[#77727F]">
                      Operational Notes
                    </dt>
                    <dd className="mt-1 whitespace-pre-wrap text-xs text-[#24212B]">
                      {job.notes ?? 'No operational notes.'}
                    </dd>
                  </div>
                </dl>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Side Column: Linked Member & Immutable History */}
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <UserRound className="h-4 w-4 text-[#6541A5]" />
                <CardTitle>Linked Member</CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              {job.member ? (
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <MemberAvatar
                      memberId={job.member.id}
                      fullName={job.member.fullName}
                      hasPhoto={job.member.hasPhoto}
                      photoUpdatedAt={job.member.photoUpdatedAt}
                      size="md"
                    />
                    <div>
                      <p className="text-sm font-semibold text-[#24212B]">
                        {job.member.fullName}
                      </p>
                      <p className="text-xs text-[#77727F]">
                        {job.birthdayTargetYear !== null
                          ? `Birthday Year ${job.birthdayTargetYear}`
                          : job.member.isActive
                            ? 'Active member'
                            : 'Archived member'}
                      </p>
                    </div>
                  </div>
                  <Link
                    href={`/members/${job.member.id}`}
                    className="text-xs font-medium text-[#6541A5] hover:underline"
                  >
                    Profile
                  </Link>
                </div>
              ) : (
                <p className="text-xs text-[#77727F]">
                  No member linked to this design job.
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <Clock className="h-4 w-4 text-[#6541A5]" />
                <CardTitle>Status Audit History</CardTitle>
              </div>
              <CardDescription>
                Immutable timeline of status transitions.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {job.history.length === 0 ? (
                <p className="text-xs text-[#77727F]">No history entries yet.</p>
              ) : (
                <ol className="space-y-3">
                  {job.history.map((entry) => (
                    <li
                      key={entry.id}
                      className="rounded-lg border border-[#E8E5ED] bg-[#F8F7FA]/60 p-3 text-xs"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold text-[#24212B]">
                          {entry.previousStatus
                            ? `${DESIGN_JOB_STATUS_LABELS[entry.previousStatus]} -> ${DESIGN_JOB_STATUS_LABELS[entry.newStatus]}`
                            : `Created as ${DESIGN_JOB_STATUS_LABELS[entry.newStatus]}`}
                        </span>
                      </div>
                      {entry.note && (
                        <p className="mt-1 text-[#24212B]">{entry.note}</p>
                      )}
                      <p className="mt-1.5 text-[11px] text-[#77727F]">
                        {entry.changedByName ?? 'Workspace Owner'} ·{' '}
                        {formatMemberTimestamp(entry.createdAt)}
                      </p>
                    </li>
                  ))}
                </ol>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

