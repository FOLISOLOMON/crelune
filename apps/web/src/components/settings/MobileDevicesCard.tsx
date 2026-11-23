'use client';

import React, { useState } from 'react';
import { AlertCircle, CheckCircle2, ShieldOff, Smartphone } from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@crelune/ui';
import type { MobileDeviceSummary } from '@crelune/shared';
import { formatDateTimeDisplay } from '@/lib/templates/template-ui-utils';

export interface MobileDevicesCardProps {
  initialDevices: MobileDeviceSummary[];
}

export function MobileDevicesCard({ initialDevices }: MobileDevicesCardProps) {
  const [devices, setDevices] = useState<MobileDeviceSummary[]>(initialDevices);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const handleRevoke = async (deviceId: string) => {
    if (revokingId) return;
    setRevokingId(deviceId);
    setError(null);
    setStatusMessage(null);

    try {
      const res = await fetch(
        `/api/mobile/devices/${encodeURIComponent(deviceId)}/revoke`,
        {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            reason: 'Revoked by workspace owner from Web Settings.',
          }),
        }
      );

      const body = (await res.json().catch(() => ({}))) as {
        device?: MobileDeviceSummary;
        error?: string;
      };

      if (!res.ok || !body.device) {
        setError(body.error ?? 'Unable to revoke mobile device.');
        return;
      }

      setDevices((prev) =>
        prev.map((item) => (item.id === deviceId ? body.device! : item))
      );
      setStatusMessage(
        'Mobile device revoked immediately. All active mobile sessions and push tokens for that device have been invalidated.'
      );
    } catch {
      setError('Unable to reach server while revoking mobile device.');
    } finally {
      setRevokingId(null);
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Smartphone className="w-4 h-4 text-[#6541A5]" />
          <CardTitle>Connected Mobile Devices</CardTitle>
        </div>
        <CardDescription>
          Manage Android and iOS devices signed in to CRELUNE Mobile. Refresh tokens are stored server-side as single-use SHA-256 hashes (30-day maximum lifetime); revoking a lost phone immediately blocks API access.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {statusMessage && (
          <div
            role="status"
            className="flex items-center gap-2 rounded-lg border border-[#BBF7D0] bg-[#F0FDF4] px-3.5 py-2.5 text-xs font-medium text-[#166534]"
          >
            <CheckCircle2 className="h-4 w-4 shrink-0 text-[#16A34A]" />
            <span>{statusMessage}</span>
          </div>
        )}

        {error && (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-lg border border-[#FECACA] bg-[#FEF2F2] p-3 text-xs text-[#991B1B]"
          >
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-[#DC2626]" />
            <span>{error}</span>
          </div>
        )}

        {devices.length === 0 ? (
          <p className="text-xs text-[#77727F]">
            No mobile devices have signed in yet. Once you sign in from CRELUNE Mobile on Android or iOS, each device appears here with independent revocation controls.
          </p>
        ) : (
          <ul className="space-y-2.5">
            {devices.map((device) => (
              <li
                key={device.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#E8E5ED] bg-white px-4 py-3 text-xs"
              >
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-[#24212B]">
                      {device.deviceName || `${device.platform} Device`}
                    </span>
                    <Badge
                      variant={device.status === 'ACTIVE' ? 'success' : 'error'}
                      size="sm"
                    >
                      {device.status}
                    </Badge>
                    <Badge variant="default" size="sm">
                      {device.platform}
                    </Badge>
                  </div>
                  <p className="text-[11px] text-[#77727F]">
                    OS: <strong className="text-[#24212B]">{device.osVersion ?? 'Unknown'}</strong> ·
                    App v{device.appVersion ?? 'unreported'} · Active sessions:{' '}
                    <strong className="text-[#24212B]">{device.activeSessionCount}</strong> ·
                    Last active: {formatDateTimeDisplay(device.lastSeenAt)}
                  </p>
                  {device.revokedAt && (
                    <p className="text-[11px] text-[#991B1B]">
                      Revoked {formatDateTimeDisplay(device.revokedAt)}
                      {device.revocationReason ? ` — ${device.revocationReason}` : ''}
                    </p>
                  )}
                </div>

                {device.status === 'ACTIVE' && (
                  <Button
                    type="button"
                    variant="danger"
                    size="sm"
                    isLoading={revokingId === device.id}
                    onClick={() => handleRevoke(device.id)}
                  >
                    <ShieldOff className="h-3.5 w-3.5 mr-1" />
                    Revoke Device
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
