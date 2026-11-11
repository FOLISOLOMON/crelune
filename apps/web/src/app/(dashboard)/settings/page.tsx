import React from 'react';
import { redirect } from 'next/navigation';
import { resolveAuthenticatedOwner } from '@/lib/auth/owner-guard';
import { checkDatabaseConnection } from '@crelune/database';
import { Header, Card, CardHeader, CardTitle, CardDescription, CardContent, Badge } from '@crelune/ui';
import { Shield, Database, User, Sliders } from 'lucide-react';
import { SessionRevokedNotice } from '@/components/auth/SessionRevokedNotice';

export default async function SettingsPage() {
  const auth = await resolveAuthenticatedOwner();

  if (auth.status === 'unauthenticated') {
    redirect('/login');
  }

  if (auth.status === 'revoked') {
    return <SessionRevokedNotice />;
  }

  const dbHealth = await checkDatabaseConnection();
  const { profile, preferences } = auth.owner;

  return (
    <div className="space-y-6">
      <Header
        title="Settings & Workspace Configuration"
        description="Owner profile, infrastructure status, security controls, and application preferences"
      />

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
              <CardTitle>Database Infrastructure</CardTitle>
            </div>
            <CardDescription>
              Neon Lakebase Postgres connection state and telemetry.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-[#77727F]">Connection Status</p>
                <p className="text-sm font-medium text-[#24212B]">
                  {dbHealth.connected ? 'Operational' : 'Disconnected'}
                </p>
              </div>
              <Badge variant={dbHealth.connected ? 'success' : 'error'} size="sm">
                {dbHealth.connected ? 'Connected' : 'Unavailable'}
              </Badge>
            </div>
            {dbHealth.latencyMs !== undefined && (
              <div>
                <p className="text-xs text-[#77727F]">Database Latency</p>
                <p className="text-xs font-mono text-[#77727F]">
                  {dbHealth.latencyMs} ms
                </p>
              </div>
            )}
            <div>
              <p className="text-xs text-[#77727F]">Provider & Topology</p>
              <p className="text-xs text-[#24212B]">
                Neon Lakebase Serverless Postgres (Direct & Pooled Endpoints)
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Security & Access Protocols */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Shield className="w-4 h-4 text-[#6541A5]" />
              <CardTitle>Security & Access Architecture</CardTitle>
            </div>
            <CardDescription>
              Owner authentication parameters and credential protocols.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-xs text-[#77727F]">
            <p>
              • <strong className="text-[#24212B]">Single-Owner Architecture:</strong> Public self-registration and invitation endpoints are disabled.
            </p>
            <p>
              • <strong className="text-[#24212B]">Session Protection:</strong> Cookies are secured with <code className="font-mono text-[11px] bg-[#F3F2F6] px-1 py-0.5 rounded">HttpOnly</code>, <code className="font-mono text-[11px] bg-[#F3F2F6] px-1 py-0.5 rounded">SameSite=Lax</code>, and cryptographic HMAC-SHA256 signatures with minimal claims (zero PII in cookies) plus server-side account status &amp; version verification.
            </p>
            <p>
              • <strong className="text-[#24212B]">Credential Provisioning:</strong> Account passwords can only be created or rotated locally via the verified CLI script (<code className="font-mono text-[11px] bg-[#F3F2F6] px-1 py-0.5 rounded">scripts/create-owner.mjs</code>). CLI argument passing of passwords is strictly prohibited.
            </p>
          </CardContent>
        </Card>

        {/* Creative Operations Preferences */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Sliders className="w-4 h-4 text-[#6541A5]" />
              <CardTitle>Default Creative Preferences</CardTitle>
            </div>
            <CardDescription>
              Baseline parameters applied to newly generated jobs and reminders.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <p className="text-xs text-[#77727F]">Timezone</p>
              <p className="text-sm font-medium text-[#24212B]">
                {preferences?.timezone || 'Africa/Accra'}
              </p>
            </div>
            <div>
              <p className="text-xs text-[#77727F]">Birthday Reminder Lead Time</p>
              <p className="text-sm font-medium text-[#24212B]">
                {preferences?.leadTimeDaysBirthday ?? 14} days prior to birthday
              </p>
            </div>
            <div>
              <p className="text-xs text-[#77727F]">Event Flyer Lead Time</p>
              <p className="text-sm font-medium text-[#24212B]">
                {preferences?.leadTimeDaysEvent ?? 21} days prior to event
              </p>
            </div>
            <div>
              <p className="text-xs text-[#77727F]">Default Affinity Export Preset</p>
              <p className="text-sm font-medium text-[#24212B]">
                {preferences?.defaultExportFormat || 'PNG'} (Lossless 24-bit sRGB)
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
