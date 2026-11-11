'use client';

import React, { useId } from 'react';
import { Input } from '@crelune/ui';
import {
  MEMBER_EMAIL_MAX_LENGTH,
  MEMBER_NAME_MAX_LENGTH,
  MEMBER_NOTES_MAX_LENGTH,
  MEMBER_PHONE_MAX_LENGTH,
  MEMBER_PREFERRED_NAME_MAX_LENGTH,
} from '@crelune/shared';
import {
  MONTH_OPTIONS,
  type MemberFieldErrors,
  type MemberFormField,
  type MemberFormValues,
} from '@/lib/members/member-form-utils';

export interface MemberFormFieldsProps {
  values: MemberFormValues;
  errors: MemberFieldErrors;
  disabled?: boolean;
  onChange: (field: MemberFormField, value: string) => void;
}

export function MemberFormFields({
  values,
  errors,
  disabled = false,
  onChange,
}: MemberFormFieldsProps) {
  const baseId = useId();
  const monthId = `${baseId}-birth-month`;
  const dayId = `${baseId}-birth-day`;
  const yearId = `${baseId}-birth-year`;
  const notesId = `${baseId}-notes`;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Input
          label="Full Name *"
          type="text"
          required
          maxLength={MEMBER_NAME_MAX_LENGTH}
          placeholder="e.g. Amara Osei"
          value={values.fullName}
          error={errors.fullName}
          disabled={disabled}
          onChange={(e) => onChange('fullName', e.target.value)}
        />

        <Input
          label="Preferred Name (Optional)"
          type="text"
          maxLength={MEMBER_PREFERRED_NAME_MAX_LENGTH}
          placeholder="e.g. Amy"
          value={values.preferredName}
          error={errors.preferredName}
          helperText="Used casually if different from full name"
          disabled={disabled}
          onChange={(e) => onChange('preferredName', e.target.value)}
        />
      </div>

      <fieldset className="rounded-lg border border-[#E8E5ED] bg-[#F8F7FA]/60 p-4 space-y-3">
        <legend className="px-1 text-xs font-semibold text-[#24212B]">
          Birthday (Date-Only — Year Optional)
        </legend>
        <p className="text-xs text-[#77727F]">
          Leave birth year blank if unknown. Day and month are stored without timezone shifting.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor={monthId}
              className="text-xs font-medium text-[#24212B]"
            >
              Birth Month
            </label>
            <select
              id={monthId}
              value={values.birthMonth}
              disabled={disabled}
              aria-invalid={Boolean(errors.birthMonth)}
              onChange={(e) => onChange('birthMonth', e.target.value)}
              className={`h-9 rounded-md border bg-white px-3 text-sm text-[#24212B] focus:outline-none focus:ring-2 focus:ring-[#6541A5]/20 focus:border-[#6541A5] transition-colors ${
                errors.birthMonth ? 'border-[#DC2626]' : 'border-[#E8E5ED]'
              }`}
            >
              <option value="">Not specified</option>
              {MONTH_OPTIONS.map((month) => (
                <option key={month.value} value={String(month.value)}>
                  {month.label}
                </option>
              ))}
            </select>
            {errors.birthMonth && (
              <span className="text-xs text-[#DC2626]">{errors.birthMonth}</span>
            )}
          </div>

          <Input
            id={dayId}
            label="Birth Day"
            type="text"
            inputMode="numeric"
            placeholder="1–31"
            value={values.birthDay}
            error={errors.birthDay}
            disabled={disabled}
            onChange={(e) => onChange('birthDay', e.target.value)}
          />

          <Input
            id={yearId}
            label="Birth Year (Optional)"
            type="text"
            inputMode="numeric"
            placeholder="e.g. 1994"
            value={values.birthYear}
            error={errors.birthYear}
            disabled={disabled}
            onChange={(e) => onChange('birthYear', e.target.value)}
          />
        </div>
      </fieldset>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Input
          label="Phone Number (Optional)"
          type="tel"
          maxLength={MEMBER_PHONE_MAX_LENGTH}
          placeholder="e.g. +233 24 000 0000"
          value={values.phone}
          error={errors.phone}
          disabled={disabled}
          onChange={(e) => onChange('phone', e.target.value)}
        />

        <Input
          label="Email Address (Optional)"
          type="email"
          maxLength={MEMBER_EMAIL_MAX_LENGTH}
          placeholder="e.g. amara@example.com"
          value={values.email}
          error={errors.email}
          disabled={disabled}
          onChange={(e) => onChange('email', e.target.value)}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between">
          <label
            htmlFor={notesId}
            className="text-xs font-medium text-[#24212B]"
          >
            Private Pastoral / Creative Notes (Optional)
          </label>
          <span className="text-[11px] text-[#77727F] tabular-nums">
            {values.notes.length}/{MEMBER_NOTES_MAX_LENGTH}
          </span>
        </div>
        <textarea
          id={notesId}
          rows={3}
          maxLength={MEMBER_NOTES_MAX_LENGTH}
          placeholder="Private context only visible on this member's profile..."
          value={values.notes}
          disabled={disabled}
          aria-invalid={Boolean(errors.notes)}
          onChange={(e) => onChange('notes', e.target.value)}
          className={`w-full rounded-md border bg-white px-3 py-2 text-sm text-[#24212B] placeholder:text-[#77727F]/60 focus:outline-none focus:ring-2 focus:ring-[#6541A5]/20 focus:border-[#6541A5] transition-colors ${
            errors.notes ? 'border-[#DC2626]' : 'border-[#E8E5ED]'
          }`}
        />
        {errors.notes ? (
          <span className="text-xs text-[#DC2626]">{errors.notes}</span>
        ) : (
          <span className="text-xs text-[#77727F]">
            Notes stay private to your profile view and are never shown in directory cards.
          </span>
        )}
      </div>
    </div>
  );
}

