import React from 'react';
import { redirect } from 'next/navigation';
import { resolveAuthenticatedOwner } from '@/lib/auth/owner-guard';
import { checkDatabaseConnection, prisma } from '@crelune/database';
import {
  Header,
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  Badge,
} from '@crelune/ui';
import { Shield, Database, User, Sliders } from 'lucide-react';
import { SessionRevokedNotice } from '@/components/auth/SessionRevokedNotice';
import { BirthdayPreferencesCard } from '@/components/settings/BirthdayPreferencesCard';
import { loadOwnerBirthdayPreferences } from '@/lib/birthdays/birthday-preferences';

export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  const auth = await resolveAuthenticatedOwner();

  if (auth.status === 'unauthenticated') {
    redirect('/login');
  }

  if (auth.status === 'revoked') {
    return <SessionRevokedNotice />;
  }

  const { profile, preferences } = auth.owner;
  const [dbHealth, birthdayPreferences] = await Promise.all([
    checkDatabaseConnection(),
    loadOwnerBirthdayPreferences(prisma, profile.id),
  ]);

  return (
    <div className="space-y-6">
      <Header
        title="Settings & Workspace Configuration"
        description="Owner profile, infrastructure status, birthday scheduling rules, and application preferences"
      />

      {/* Interactive Birthday & Reminder Preferences */}
      <BirthdayPreferencesCard initialPreferences={birthdayPreferences} />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Owner Profile Card */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <User className="w-4 h-4 text-[#6541A5]" />
              <CardTitle>Workspace Owner</CardTitle>
            </div>
            <CardDescription>
              Authenticated owner account details for single-owner operations.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <p className="text-xs text-[#77727F]">Full Name</p>
              <p className="text-sm font-semibold text-[#24212B]">
                {profile.firstName} {profile.lastName}
              </p>
            </div>
            <div>
              <p className="text-xs text-[#77727F]">Email Address</p>
              <p className="text-sm font-semibold text-[#24212B]">
                {profile.email}
              </p>
            </div>
            <div>
              <p className="text-xs text-[#77727F]">Role</p>
              <Badge variant="primary" size="sm" className="mt-0.5">
                {profile.role}
              </Badge>
            </div>
            <div>
              <p className="text-xs text-[#77727F]">Organisation</p>
              <p className="text-xs font-mono text-[#77727F] truncate">
                {profile.organisationName} ({profile.organisationId})
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Database & Infrastructure Status */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Database className="w-4 h-4 text-[#6541A5]" />
              <CardTitle>Database &amp; Environment Status</CardTitle>
            </div>
            <CardDescription>
              Live Neon Postgres diagnostic and connectivity status.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-[#77727F]">Connection State</span>
              <Badge variant={dbHealth.connected ? 'success' : 'error'} size="sm">
                {dbHealth.connected ? 'Healthy & Connected' : 'Disconnected'}
              </Badge>
            </div>
            {dbHealth.latencyMs !== undefined && (
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-[#77727F]">Query Latency</span>
                <span className="text-xs font-mono text-[#24212B]">
                  {dbHealth.latencyMs}ms
                </span>
              </div>
            )}
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-[#77727F]">Runtime Environment</span>
              <span className="text-xs font-mono text-[#24212B]">
                {process.env.NODE_ENV || 'development'}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-[#77727F]">Workspace Access Model</span>
              <Badge variant="default" size="sm">Single Owner Mode</Badge>
            </div>
          </CardContent>
        </Card>

        {/* Security Controls Card */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Shield className="w-4 h-4 text-[#6541A5]" />
              <CardTitle>Security &amp; Session Policy</CardTitle>
            </div>
            <CardDescription>
              Authentication controls protecting creative files and pastoral data.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-xs text-[#77727F] leading-relaxed">
            <p>
              • <strong className="text-[#24212B]">Session Protection:</strong> Cookies are secured with <code className="font-mono text-[11px] bg-[#F3F2F6] px-1 py-0.5 rounded">HttpOnly</code>, <code className="font-mono text-[11px] bg-[#F3F2F6] px-1 py-0.5 rounded">SameSite=Lax</code>, and cryptographic HMAC-SHA256 signatures with minimal claims (zero PII in cookies) plus server-side account status &amp; version verification.
            </p>
            <p>
              • <strong className="text-[#24212B]">Credential Provisioning:</strong> Account passwords can only be created or rotated locally via the verified CLI script (<code className="font-mono text-[11px] bg-[#F3F2F6] px-1 py-0.5 rounded">scripts/create-owner.mjs</code>). CLI argument passing of passwords is strictly prohibited.
            </p>
          </CardContent>
        </Card>

        {/* Creative Operations Defaults */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Sliders className="w-4 h-4 text-[#6541A5]" />
              <CardTitle>Creative Export &amp; Future Milestone Defaults</CardTitle>
            </div>
            <CardDescription>
              Baseline parameters reserved for event programmes and Affinity automation.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <p className="text-xs text-[#77727F]">Event Flyer Lead Time</p>
              <p className="text-sm font-medium text-[#24212B]">
                {preferences?.leadTimeDaysEvent ?? 21} days prior to event (Milestone 7)
              </p>
            </div>
            <div>
              <p className="text-xs text-[#77727F]">Default Affinity Export Preset</p>
              <p className="text-sm font-medium text-[#24212B]">
                {preferences?.defaultExportFormat || 'PNG'} (Milestone 5)
              </p>
            </div>
            <div>
              <p className="text-xs text-[#77727F]">Date Display Format</p>
              <p className="text-sm font-medium text-[#24212B]">
                {preferences?.dateFormat || 'DD/MM/YYYY'} (Date-only)
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
