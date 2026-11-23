// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MobileDeviceSummary } from '@crelune/shared';
import { MobileDevicesCard } from './MobileDevicesCard';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('MobileDevicesCard (Stage 6.1 Web Settings Visibility & Revocation)', () => {
  const sampleDevices: MobileDeviceSummary[] = [
    {
      id: 'mdev_pixel_01',
      platform: 'ANDROID',
      deviceName: 'Pixel 9 Pro',
      osVersion: 'Android 16',
      appVersion: '0.1.0',
      hasPushToken: false,
      pushPermissionStatus: null,
      pushEnabled: true,
      status: 'ACTIVE',
      activeSessionCount: 1,
      lastSeenAt: '2026-11-23T12:00:00.000Z',
      revokedAt: null,
      revocationReason: null,
      createdAt: '2026-11-23T10:00:00.000Z',
    },
  ];

  it('renders empty state when no mobile devices have signed in yet', () => {
    render(<MobileDevicesCard initialDevices={[]} />);
    expect(screen.getByText(/No mobile devices have signed in yet/i)).toBeTruthy();
  });

  it('displays active mobile devices and revokes immediately via same-origin POST', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          device: {
            ...sampleDevices[0],
            status: 'REVOKED',
            activeSessionCount: 0,
            revokedAt: '2026-11-23T13:00:00.000Z',
            revocationReason: 'Revoked by workspace owner from Web Settings.',
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    );
    vi.stubGlobal('fetch', fetchMock);

    render(<MobileDevicesCard initialDevices={sampleDevices} />);
    expect(screen.getByText('Pixel 9 Pro')).toBeTruthy();
    expect(screen.getByText('ANDROID')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /Revoke Device/i }));

    await waitFor(() => {
      expect(screen.getByText(/Mobile device revoked immediately/i)).toBeTruthy();
    });

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/mobile/devices/mdev_pixel_01/revoke',
      expect.objectContaining({
        method: 'POST',
        credentials: 'same-origin',
      })
    );
    expect(screen.queryByRole('button', { name: /Revoke Device/i })).toBeNull();
  });
});
