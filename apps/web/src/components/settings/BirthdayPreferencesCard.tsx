'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { AlertCircle, CheckCircle2, Sliders } from 'lucide-react';
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
} from '@crelune/ui';
import {
  birthdayPreferencesUpdateSchema,
  type LeapDayPolicy,
  type OwnerBirthdayPreferencesDto,
} from '@crelune/shared';
import {
  BirthdayApiError,
  updateBirthdayPreferencesRequest,
} from '@/lib/birthdays/birthday-api-client';

export interface BirthdayPreferencesCardProps {
  initialPreferences: OwnerBirthdayPreferencesDto;
}

const COMMON_TIMEZONES = [
  'Africa/Accra',
  'Africa/Lagos',
  'Africa/Johannesburg',
  'Africa/Nairobi',
  'Europe/London',
  'Europe/Paris',
  'America/New_York',
  'America/Chicago',
  'America/Los_Angeles',
  'Asia/Dubai',
  'Asia/Singapore',
  'UTC',
];

const STANDARD_REMINDER_OPTIONS: Array<{ day: number; label: string }> = [
  { day: 14, label: '14 days before' },
  { day: 7, label: '7 days before' },
  { day: 3, label: '3 days before' },
  { day: 1, label: '1 day before' },
  { day: 0, label: 'On the birthday (same day)' },
];

export function BirthdayPreferencesCard({
  initialPreferences,
}: BirthdayPreferencesCardProps) {
  const router = useRouter();
  const [timezone, setTimezone] = useState(initialPreferences.timezone);
  const [leapDayPolicy, setLeapDayPolicy] = useState<LeapDayPolicy>(
    initialPreferences.leapDayPolicy
  );
  const [selectedDays, setSelectedDays] = useState<number[]>(
    initialPreferences.birthdayReminderDays
  );

  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [statusBanner, setStatusBanner] = useState<string | null>(null);

  const isKnownPresetZone = COMMON_TIMEZONES.includes(timezone);

  const toggleLeadDay = (day: number) => {
    setStatusBanner(null);
    setErrorMessage(null);
    setSelectedDays((prev) =>
      prev.includes(day)
        ? prev.filter((item) => item !== day)
        : [...prev, day].sort((a, b) => b - a)
    );
  };

  const handleSave = async (event: React.FormEvent) => {
    event.preventDefault();
    if (isSaving) return;

    const parsed = birthdayPreferencesUpdateSchema.safeParse({
      timezone: timezone.trim(),
      leapDayPolicy,
      birthdayReminderDays: selectedDays,
    });

    if (!parsed.success) {
      setErrorMessage(
        parsed.error.issues[0]?.message ??
          'Please verify your birthday preferences.'
      );
      return;
    }

    setIsSaving(true);
    setErrorMessage(null);
    setStatusBanner(null);

    try {
      const result = await updateBirthdayPreferencesRequest(parsed.data);
      setTimezone(result.preferences.timezone);
      setLeapDayPolicy(result.preferences.leapDayPolicy);
      setSelectedDays(result.preferences.birthdayReminderDays);
      router.refresh();
      setStatusBanner(
        `Preferences saved. Pending reminder schedules reconciled (${result.reconciliation.schedulesCreated} created, ${result.reconciliation.schedulesUpdated} updated, ${result.reconciliation.schedulesCancelled} cancelled).`
      );
    } catch (error) {
      setErrorMessage(
        error instanceof BirthdayApiError
          ? error.message
          : 'Unable to save birthday preferences.'
      );
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Sliders className="h-4 w-4 text-[#6541A5]" />
          <CardTitle>Birthday & Reminder Preferences</CardTitle>
        </div>
        <CardDescription>
          Configure your timezone, leap-day policy, and active reminder intervals. Saving updates pending future schedules without altering past delivered notifications.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSave} className="space-y-5">
          {statusBanner && (
            <div
              role="status"
              className="flex items-start gap-2 rounded-lg border border-[#BBF7D0] bg-[#F0FDF4] p-3 text-xs text-[#166534]"
            >
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[#16A34A]" />
              <span>{statusBanner}</span>
            </div>
          )}

          {errorMessage && (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-lg border border-[#FECACA] bg-[#FEF2F2] p-3 text-xs text-[#991B1B]"
            >
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-[#DC2626]" />
              <span>{errorMessage}</span>
            </div>
          )}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label
                htmlFor="pref-timezone-preset"
                className="block text-xs font-medium text-[#24212B]"
              >
                Common Timezones
              </label>
              <select
                id="pref-timezone-preset"
                value={isKnownPresetZone ? timezone : '__custom__'}
                onChange={(e) => {
                  if (e.target.value !== '__custom__') {
                    setTimezone(e.target.value);
                  }
                  setStatusBanner(null);
                  setErrorMessage(null);
                }}
                disabled={isSaving}
                className="h-9.5 w-full rounded-lg border border-[#E8E5ED] bg-white px-3 text-sm text-[#24212B]"
              >
                {COMMON_TIMEZONES.map((zone) => (
                  <option key={zone} value={zone}>
                    {zone}
                  </option>
                ))}
                {!isKnownPresetZone && (
                  <option value="__custom__">Custom ({timezone})</option>
                )}
              </select>
            </div>

            <Input
              label="IANA Timezone Identifier"
              value={timezone}
              onChange={(e) => {
                setTimezone(e.target.value);
                setStatusBanner(null);
                setErrorMessage(null);
              }}
              placeholder="e.g., Africa/Accra"
              helperText="Must be a valid IANA zone such as Africa/Accra or Europe/London."
              disabled={isSaving}
            />
          </div>

          <div className="space-y-2">
            <span className="block text-xs font-medium text-[#24212B]">
              Leap-Day Policy (February 29 Birthdays)
            </span>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-[#E8E5ED] bg-[#F8F7FA]/60 p-3 text-xs">
                <input
                  type="radio"
                  name="leapDayPolicy"
                  value="FEB_28"
                  checked={leapDayPolicy === 'FEB_28'}
                  onChange={() => setLeapDayPolicy('FEB_28')}
                  disabled={isSaving}
                  className="mt-0.5 accent-[#6541A5]"
                />
                <span>
                  <strong className="block text-[#24212B]">
                    February 28 (Default)
                  </strong>
                  <span className="text-[#77727F]">
                    Observe Feb 29 birthdays on Feb 28 in non-leap years.
                  </span>
                </span>
              </label>

              <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-[#E8E5ED] bg-[#F8F7FA]/60 p-3 text-xs">
                <input
                  type="radio"
                  name="leapDayPolicy"
                  value="MAR_1"
                  checked={leapDayPolicy === 'MAR_1'}
                  onChange={() => setLeapDayPolicy('MAR_1')}
                  disabled={isSaving}
                  className="mt-0.5 accent-[#6541A5]"
                />
                <span>
                  <strong className="block text-[#24212B]">March 1</strong>
                  <span className="text-[#77727F]">
                    Observe Feb 29 birthdays on March 1 in non-leap years.
                  </span>
                </span>
              </label>
            </div>
          </div>

          <div className="space-y-2">
            <span className="block text-xs font-medium text-[#24212B]">
              Reminder Lead Intervals
            </span>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {STANDARD_REMINDER_OPTIONS.map((option) => (
                <label
                  key={option.day}
                  className="flex cursor-pointer items-center gap-2.5 rounded-lg border border-[#E8E5ED] px-3 py-2 text-xs text-[#24212B]"
                >
                  <input
                    type="checkbox"
                    checked={selectedDays.includes(option.day)}
                    onChange={() => toggleLeadDay(option.day)}
                    disabled={isSaving}
                    className="accent-[#6541A5]"
                  />
                  <span>{option.label}</span>
                </label>
              ))}
            </div>
            <p className="text-[11px] text-[#77727F]">
              Unchecking all intervals disables automatic reminder scheduling until re-enabled.
            </p>
          </div>

          <div className="flex justify-end border-t border-[#E8E5ED] pt-4">
            <Button type="submit" variant="primary" isLoading={isSaving}>
              Save Birthday Preferences
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

