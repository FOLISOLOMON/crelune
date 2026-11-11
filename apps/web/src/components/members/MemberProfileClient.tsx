'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import {
  AlertCircle,
  Archive,
  ArrowLeft,
  Calendar,
  CheckCircle2,
  Mail,
  Pencil,
  Phone,
  RotateCcw,
} from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@crelune/ui';
import type { MemberDetail } from '@crelune/shared';
import {
  archiveMemberRequest,
  MemberApiError,
  restoreMemberRequest,
  updateMemberRequest,
} from '@/lib/members/member-api-client';
import {
  buildUpdateMemberPayload,
  formatMemberBirthday,
  formatMemberTimestamp,
  memberDetailToFormValues,
  type MemberFieldErrors,
  type MemberFormField,
  type MemberFormValues,
} from '@/lib/members/member-form-utils';
import { MemberAvatar } from './MemberAvatar';
import { MemberFormFields } from './MemberFormFields';
import { MemberPhotoManager } from './MemberPhotoManager';

export interface MemberProfileClientProps {
  initialMember: MemberDetail;
}

export function MemberProfileClient({
  initialMember,
}: MemberProfileClientProps) {
  const [member, setMember] = useState<MemberDetail>(initialMember);
  const [isEditing, setIsEditing] = useState(false);
  const [formValues, setFormValues] = useState<MemberFormValues>(() =>
    memberDetailToFormValues(initialMember)
  );
  const [fieldErrors, setFieldErrors] = useState<MemberFieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const [confirmingArchive, setConfirmingArchive] = useState(false);
  const [isLifecycleBusy, setIsLifecycleBusy] = useState(false);
  const [lifecycleError, setLifecycleError] = useState<string | null>(null);
  const [statusBanner, setStatusBanner] = useState<string | null>(null);

  const birthdayText = formatMemberBirthday(member);
  const hasBirthdayWithoutYear =
    member.birthMonth !== null &&
    member.birthDay !== null &&
    member.birthYear === null;

  const beginEdit = () => {
    setFormValues(memberDetailToFormValues(member));
    setFieldErrors({});
    setFormError(null);
    setStatusBanner(null);
    setIsEditing(true);
  };

  const cancelEdit = () => {
    if (isSaving) return;
    setFormValues(memberDetailToFormValues(member));
    setFieldErrors({});
    setFormError(null);
    setIsEditing(false);
  };

  const handleFieldChange = (field: MemberFormField, value: string) => {
    setFormValues((prev) => ({ ...prev, [field]: value }));
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

  const handleSaveEdit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (isSaving) return;

    const built = buildUpdateMemberPayload(member, formValues);
    if (!built.success) {
      setFieldErrors(built.fieldErrors);
      setFormError(built.formError ?? 'Please review the highlighted fields.');
      return;
    }

    if (!built.hasChanges) {
      setIsEditing(false);
      setStatusBanner('No changes needed — member record is up to date.');
      return;
    }

    setFieldErrors({});
    setFormError(null);
    setStatusBanner(null);
    setIsSaving(true);

    try {
      const updated = await updateMemberRequest(member.id, built.data);
      setMember(updated);
      setFormValues(memberDetailToFormValues(updated));
      setIsEditing(false);
      setStatusBanner('Member profile updated.');
    } catch (err) {
      if (err instanceof MemberApiError) {
        if (err.fieldErrors && Object.keys(err.fieldErrors).length > 0) {
          setFieldErrors(err.fieldErrors);
        }
        setFormError(err.message);
      } else {
        setFormError('Failed to update member details. Please try again.');
      }
    } finally {
      setIsSaving(false);
    }
  };

  const handleArchiveConfirmed = async () => {
    if (isLifecycleBusy || !member.isActive) return;

    setLifecycleError(null);
    setStatusBanner(null);
    setIsLifecycleBusy(true);

    try {
      const result = await archiveMemberRequest(member.id);
      setMember(result.member);
      setConfirmingArchive(false);
      setStatusBanner(
        `${result.member.fullName} has been archived. Their records are preserved and can be restored anytime.`
      );
    } catch (err) {
      setLifecycleError(
        err instanceof Error ? err.message : 'Unable to archive member.'
      );
    } finally {
      setIsLifecycleBusy(false);
    }
  };

  const handleRestore = async () => {
    if (isLifecycleBusy || member.isActive) return;

    setLifecycleError(null);
    setStatusBanner(null);
    setIsLifecycleBusy(true);

    try {
      const result = await restoreMemberRequest(member.id);
      setMember(result.member);
      setStatusBanner(`${result.member.fullName} has been restored to the active directory.`);
    } catch (err) {
      setLifecycleError(
        err instanceof Error ? err.message : 'Unable to restore member.'
      );
    } finally {
      setIsLifecycleBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <Link
          href="/members"
          className="inline-flex items-center gap-1.5 text-xs font-medium text-[#77727F] hover:text-[#6541A5] transition-colors"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to Members Directory
        </Link>
      </div>

      {/* Member Summary Header Card */}
      <Card>
        <CardContent className="p-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-center gap-4 min-w-0">
              <MemberAvatar
                memberId={member.id}
                fullName={member.fullName}
                hasPhoto={member.hasPhoto}
                photoUpdatedAt={member.photoUpdatedAt}
                size="lg"
              />
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2.5">
                  <h1 className="text-xl sm:text-2xl font-semibold tracking-tight text-[#24212B] truncate">
                    {member.fullName}
                  </h1>
                  <Badge
                    variant={member.isActive ? 'success' : 'warning'}
                    size="sm"
                  >
                    {member.isActive ? 'Active' : 'Archived'}
                  </Badge>
                </div>

                {member.preferredName && (
                  <p className="mt-0.5 text-sm text-[#77727F]">
                    Preferred name: {member.preferredName}
                  </p>
                )}

                <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[#77727F] tabular-nums">
                  <span className="inline-flex items-center gap-1.5">
                    <Calendar className="h-3.5 w-3.5 text-[#6541A5]" />
                    Birthday: {birthdayText}
                  </span>
                  <span>Added {formatMemberTimestamp(member.createdAt)}</span>
                  <span>Updated {formatMemberTimestamp(member.updatedAt)}</span>
                </div>
              </div>
            </div>

            {!isEditing && (
              <div className="flex shrink-0 items-center gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={beginEdit}
                >
                  <Pencil className="mr-1.5 h-3.5 w-3.5" />
                  Edit Profile
                </Button>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {statusBanner && (
        <div
          role="status"
          className="flex items-center gap-2 rounded-lg border border-[#A7F3D0] bg-[#ECFDF5] px-4 py-3 text-xs text-[#047857]"
        >
          <CheckCircle2 className="h-4 w-4 shrink-0 text-[#059669]" />
          <span>{statusBanner}</span>
        </div>
      )}

      {!member.isActive && (
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-lg border border-[#FDE68A] bg-[#FFFBEB] px-4 py-3 text-xs text-[#92400E]">
          <div>
            <strong>Archived record</strong>
            {member.archivedAt
              ? ` · Archived on ${formatMemberTimestamp(member.archivedAt)}. `
              : '. '}
            This member is hidden from active directory searches and active birthday reminder schedules.
          </div>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            isLoading={isLifecycleBusy}
            disabled={isLifecycleBusy}
            onClick={handleRestore}
            className="shrink-0"
          >
            <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
            Restore Member
          </Button>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left / Main Column: Details + Edit Form + Lifecycle */}
        <div className="lg:col-span-2 space-y-6">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between gap-2">
                <div>
                  <CardTitle>
                    {isEditing ? 'Edit Member Details' : 'Member Information'}
                  </CardTitle>
                  <CardDescription>
                    {isEditing
                      ? 'Update personal details, date-only birthday, contact details, or private notes.'
                      : 'Stored member profile and private owner notes.'}
                  </CardDescription>
                </div>
              </div>
            </CardHeader>

            <CardContent>
              {isEditing ? (
                <form onSubmit={handleSaveEdit} noValidate className="space-y-5">
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
                    values={formValues}
                    errors={fieldErrors}
                    disabled={isSaving}
                    onChange={handleFieldChange}
                  />

                  <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2.5 border-t border-[#E8E5ED] pt-4">
                    <Button
                      type="button"
                      variant="secondary"
                      size="md"
                      disabled={isSaving}
                      onClick={cancelEdit}
                    >
                      Cancel
                    </Button>
                    <Button
                      type="submit"
                      variant="primary"
                      size="md"
                      isLoading={isSaving}
                      disabled={isSaving}
                    >
                      Save Changes
                    </Button>
                  </div>
                </form>
              ) : (
                <div className="space-y-5">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                    <div>
                      <p className="text-xs font-medium text-[#77727F]">
                        Full Name
                      </p>
                      <p className="mt-1 text-sm font-semibold text-[#24212B]">
                        {member.fullName}
                      </p>
                    </div>

                    <div>
                      <p className="text-xs font-medium text-[#77727F]">
                        Preferred Name
                      </p>
                      <p className="mt-1 text-sm text-[#24212B]">
                        {member.preferredName ?? (
                          <span className="text-[#77727F]">Not specified</span>
                        )}
                      </p>
                    </div>

                    <div>
                      <p className="text-xs font-medium text-[#77727F]">
                        Birthday
                      </p>
                      <p className="mt-1 text-sm text-[#24212B] tabular-nums">
                        {birthdayText}
                      </p>
                      {hasBirthdayWithoutYear && (
                        <p className="mt-0.5 text-[11px] text-[#77727F]">
                          Birth year omitted (stored as day and month only)
                        </p>
                      )}
                    </div>

                    <div>
                      <p className="text-xs font-medium text-[#77727F]">
                        Record Status
                      </p>
                      <p className="mt-1 text-sm text-[#24212B]">
                        {member.isActive ? 'Active directory member' : 'Archived'}
                      </p>
                    </div>

                    <div>
                      <p className="text-xs font-medium text-[#77727F]">
                        Phone Number
                      </p>
                      <p className="mt-1 text-sm text-[#24212B] tabular-nums inline-flex items-center gap-1.5">
                        {member.phone ? (
                          <>
                            <Phone className="h-3.5 w-3.5 text-[#77727F]" />
                            {member.phone}
                          </>
                        ) : (
                          <span className="text-[#77727F]">Not provided</span>
                        )}
                      </p>
                    </div>

                    <div>
                      <p className="text-xs font-medium text-[#77727F]">
                        Email Address
                      </p>
                      <p className="mt-1 text-sm text-[#24212B] inline-flex items-center gap-1.5 break-all">
                        {member.email ? (
                          <>
                            <Mail className="h-3.5 w-3.5 shrink-0 text-[#77727F]" />
                            {member.email}
                          </>
                        ) : (
                          <span className="text-[#77727F]">Not provided</span>
                        )}
                      </p>
                    </div>
                  </div>

                  <div className="border-t border-[#E8E5ED] pt-4">
                    <p className="text-xs font-medium text-[#77727F]">
                      Private Owner Notes
                    </p>
                    {member.notes ? (
                      <p className="mt-1.5 whitespace-pre-wrap rounded-md border border-[#E8E5ED] bg-[#F8F7FA] p-3 text-sm text-[#24212B] leading-relaxed">
                        {member.notes}
                      </p>
                    ) : (
                      <p className="mt-1 text-sm text-[#77727F]">
                        No private notes recorded.
                      </p>
                    )}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Archive / Restore Lifecycle Controls */}
          <Card>
            <CardHeader>
              <CardTitle>Record Lifecycle</CardTitle>
              <CardDescription>
                Members are archived rather than permanently deleted so historical records and past designs stay safe.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {lifecycleError && (
                <div
                  role="alert"
                  className="flex items-start gap-2 rounded-lg border border-[#FECACA] bg-[#FEF2F2] p-3 text-xs text-[#991B1B]"
                >
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-[#DC2626]" />
                  <span>{lifecycleError}</span>
                </div>
              )}

              {member.isActive ? (
                confirmingArchive ? (
                  <div className="rounded-lg border border-[#FDE68A] bg-[#FFFBEB] p-4 space-y-3">
                    <p className="text-xs font-semibold text-[#92400E]">
                      Archive {member.fullName}?
                    </p>
                    <p className="text-xs text-[#92400E] leading-relaxed">
                      Archiving hides this member from the default active directory and cancels pending future birthday reminders. It does not permanently delete their profile or uploaded photo, and you can restore them at any time.
                    </p>
                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        type="button"
                        variant="danger"
                        size="sm"
                        isLoading={isLifecycleBusy}
                        disabled={isLifecycleBusy}
                        onClick={handleArchiveConfirmed}
                      >
                        Yes, Archive Member
                      </Button>
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        disabled={isLifecycleBusy}
                        onClick={() => setConfirmingArchive(false)}
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <p className="text-xs text-[#77727F]">
                      Archive inactive members to keep your active creative directory focused.
                    </p>
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      disabled={isLifecycleBusy}
                      onClick={() => {
                        setLifecycleError(null);
                        setConfirmingArchive(true);
                      }}
                    >
                      <Archive className="mr-1.5 h-3.5 w-3.5" />
                      Archive Member
                    </Button>
                  </div>
                )
              ) : (
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <p className="text-xs text-[#77727F]">
                    Restore this archived member to include them in the active directory again.
                  </p>
                  <Button
                    type="button"
                    variant="primary"
                    size="sm"
                    isLoading={isLifecycleBusy}
                    disabled={isLifecycleBusy}
                    onClick={handleRestore}
                  >
                    <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
                    Restore Member
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Right Column: Private Photo Manager */}
        <div className="space-y-6">
          <MemberPhotoManager
            member={member}
            onMemberUpdated={(updated) => setMember(updated)}
          />
        </div>
      </div>
    </div>
  );
}
