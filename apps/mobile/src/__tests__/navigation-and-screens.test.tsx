import React from 'react';
import { Text } from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import type { DashboardSnapshotResponse } from '@crelune/shared';
import type {
  CredentialStorageAdapter,
  StoredMobileCredentials,
} from '@/auth/secure-store';
import { SessionManager } from '@/auth/session-manager';
import { mobileApiClient } from '@/auth/runtime';
import { AuthNavigationGate } from '@/components/navigation/AuthNavigationGate';
import { OfflineBar } from '@/components/ui/OfflineBar';
import { AuthProvider } from '@/providers/AuthProvider';
import { NetworkProvider } from '@/providers/NetworkProvider';
import LoginScreen from '../../app/(auth)/login';
import HomeScreen from '../../app/(tabs)/index';
import CalendarTabScreen from '../../app/(tabs)/calendar';
import MoreTabScreen from '../../app/(tabs)/more';

const mockRouter = {
  replace: jest.fn(),
  push: jest.fn(),
  back: jest.fn(),
};
let mockSegments: string[] = ['(tabs)'];

jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  useSegments: () => mockSegments,
}));

const INITIAL_METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 44, left: 0, right: 0, bottom: 34 },
};

function makeCredentials(): StoredMobileCredentials {
  return {
    accessToken: 'cln_mob_at.payload_nav.sig_nav',
    accessTokenExpiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
    refreshToken: `cln_mob_rt_${'c'.repeat(64)}`,
    refreshTokenExpiresAt: new Date(Date.now() + 30 * 86_400_000).toISOString(),
    tokenType: 'Bearer',
    device: {
      id: 'dev_nav_0001',
      platform: 'ANDROID',
      deviceName: 'Pixel Emulator',
      osVersion: 'Android 16',
      appVersion: '0.1.0',
      hasPushToken: false,
      pushPermissionStatus: null,
      pushEnabled: true,
      status: 'ACTIVE',
      activeSessionCount: 1,
      lastSeenAt: '2026-11-24T04:00:00.000Z',
      revokedAt: null,
      revocationReason: null,
      createdAt: '2026-11-24T04:00:00.000Z',
    },
    user: {
      id: 'usr_nav_0001',
      email: 'owner@crelune.test',
      firstName: 'Foli',
      lastName: 'Solomon',
      role: 'OWNER',
      organisationId: 'org_nav_0001',
      organisationName: 'CRELUNE Operations',
      timezone: 'Africa/Accra',
    },
  };
}

function makeStorage(initial: StoredMobileCredentials | null): CredentialStorageAdapter {
  let stored = initial;
  return {
    saveCredentials: jest.fn(async (creds) => {
      stored = creds;
    }),
    loadCredentials: jest.fn(async () => stored),
    clearCredentials: jest.fn(async () => {
      stored = null;
    }),
    getOrCreateDeviceInstallId: jest.fn(
      async () => 'cln_dev_99998888777766665555444433332222'
    ),
  };
}

function makeManager(
  initial: StoredMobileCredentials | null,
  fetchImpl?: jest.Mock
) {
  return new SessionManager({
    storage: makeStorage(initial),
    getApiBaseUrl: () => 'https://api.crelune.test',
    buildDeviceMetadata: (deviceInstallId) => ({
      deviceInstallId,
      platform: 'ANDROID',
      deviceName: 'Pixel Emulator',
      osVersion: 'Android 16',
      appVersion: '0.1.0',
    }),
    fetchImpl: (fetchImpl ?? jest.fn()) as unknown as typeof fetch,
  });
}

function renderWithProviders(
  ui: React.ReactElement,
  sessionManager: SessionManager
) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
    },
  });

  return render(
    <SafeAreaProvider initialMetrics={INITIAL_METRICS}>
      <QueryClientProvider client={queryClient}>
        <NetworkProvider>
          <AuthProvider sessionManager={sessionManager}>{ui}</AuthProvider>
        </NetworkProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}

describe('CRELUNE Mobile — Auth Navigation Gate, Login, Offline & Native Tab Screens', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSegments = ['(tabs)'];
    (NetInfo.fetch as jest.Mock).mockResolvedValue({
      isConnected: true,
      isInternetReachable: true,
    });
  });

  it('shows hydration state first, redirects unauthenticated users once to /(auth)/login, and transitions authenticated users to /(tabs)', async () => {
    let resolveHydrate!: (value: StoredMobileCredentials | null) => void;
    const deferredStorage: CredentialStorageAdapter = {
      saveCredentials: jest.fn(async () => undefined),
      loadCredentials: jest.fn(
        () =>
          new Promise<StoredMobileCredentials | null>((resolve) => {
            resolveHydrate = resolve;
          })
      ),
      clearCredentials: jest.fn(async () => undefined),
      getOrCreateDeviceInstallId: jest.fn(
        async () => 'cln_dev_99998888777766665555444433332222'
      ),
    };
    const manager = new SessionManager({
      storage: deferredStorage,
      getApiBaseUrl: () => 'https://api.crelune.test',
      buildDeviceMetadata: (deviceInstallId) => ({
        deviceInstallId,
        platform: 'ANDROID',
        deviceName: 'Pixel Emulator',
        osVersion: 'Android 16',
        appVersion: '0.1.0',
      }),
      fetchImpl: jest.fn() as unknown as typeof fetch,
    });

    const { getByTestId, rerender } = await renderWithProviders(
      <AuthNavigationGate>
        <Text>Protected Shell</Text>
      </AuthNavigationGate>,
      manager
    );

    expect(getByTestId('auth-hydrating-screen')).toBeTruthy();

    await act(async () => {
      resolveHydrate(null);
    });

    await waitFor(() => {
      expect(mockRouter.replace).toHaveBeenCalledTimes(1);
      expect(mockRouter.replace).toHaveBeenCalledWith('/(auth)/login');
    });

    // Simulate route updated to (auth) and owner signs in
    mockSegments = ['(auth)', 'login'];
    const creds = makeCredentials();
    const loginFetch = jest.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => creds,
    }));
    const authedManager = makeManager(null, loginFetch);
    await authedManager.hydrate();
    mockRouter.replace.mockClear();

    await rerender(
      <SafeAreaProvider initialMetrics={INITIAL_METRICS}>
        <QueryClientProvider
          client={new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })}
        >
          <NetworkProvider>
            <AuthProvider sessionManager={authedManager}>
              <AuthNavigationGate>
                <Text>Auth Group</Text>
              </AuthNavigationGate>
            </AuthProvider>
          </NetworkProvider>
        </QueryClientProvider>
      </SafeAreaProvider>
    );

    await act(async () => {
      await authedManager.login('owner@crelune.test', 'StrongPass!2026');
    });

    await waitFor(() => {
      expect(mockRouter.replace).toHaveBeenCalledTimes(1);
      expect(mockRouter.replace).toHaveBeenCalledWith('/(tabs)');
    });
  });

  it('renders terminal expiry banner on LoginScreen, validates input, and submits credentials', async () => {
    const creds = makeCredentials();
    const fetchMock = jest.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => creds,
    }));
    const manager = makeManager(creds, fetchMock);
    await manager.hydrate();
    await manager.handleTerminalAuthFailure(
      'DEVICE_REVOKED',
      'This device was revoked from CRELUNE Settings. Sign in again to reconnect.'
    );

    const { getByTestId, getByText } = await renderWithProviders(
      <LoginScreen />,
      manager
    );

    expect(getByTestId('session-notice-banner')).toBeTruthy();
    expect(getByText(/device was revoked/i)).toBeTruthy();

    // Invalid email triggers client-side Zod validation before hitting network
    await fireEvent.changeText(getByTestId('login-email-input'), 'not-an-email');
    await fireEvent.changeText(getByTestId('login-password-input'), 'short');
    await fireEvent.press(getByTestId('login-submit-button'));

    await waitFor(() => {
      expect(getByTestId('login-error-banner')).toBeTruthy();
    });
    expect(fetchMock).not.toHaveBeenCalled();

    // Valid credentials authenticate cleanly
    await fireEvent.changeText(getByTestId('login-email-input'), 'owner@crelune.test');
    await fireEvent.changeText(getByTestId('login-password-input'), 'StrongPass!2026');
    await fireEvent.press(getByTestId('login-submit-button'));

    await waitFor(() => {
      expect(manager.getSnapshot().status).toBe('authenticated');
    });
  });

  it('displays OfflineBar when network connectivity is lost', async () => {
    (NetInfo.fetch as jest.Mock).mockResolvedValue({
      isConnected: false,
      isInternetReachable: false,
    });
    const manager = makeManager(makeCredentials());
    await manager.hydrate();

    const { findByTestId } = await renderWithProviders(<OfflineBar />, manager);
    expect(await findByTestId('offline-status-bar')).toBeTruthy();
  });

  it('renders live Home studio metrics from GET /api/dashboard and surfaces error retry cleanly', async () => {
    const creds = makeCredentials();
    const manager = makeManager(creds);
    await manager.hydrate();

    const snapshot: DashboardSnapshotResponse = {
      activeMembersCount: 42,
      activeTemplatesCount: 7,
      birthdayCounts: {
        totalWithBirthday: 38,
        todayCount: 1,
        weekCount: 3,
        monthCount: 6,
        upcomingCount: 8,
        awaitingPrepCount: 2,
      },
      upcomingBirthdays: [
        {
          memberId: 'mem_01',
          fullName: 'Kofi Mensah',
          preferredName: null,
          birthDay: 26,
          birthMonth: 11,
          birthYear: null,
          hasPhoto: false,
          photoUpdatedAt: null,
          targetYear: 2026,
          celebratedDateIso: '2026-11-26',
          celebratedMonth: 11,
          celebratedDay: 26,
          daysUntil: 2,
          isToday: false,
          isLeapDayAdjusted: false,
          prepId: null,
          prepStatus: 'PREPARATION_PENDING',
          prepNotes: null,
          designJobId: null,
          designJobTitle: null,
          designJobStatus: null,
        },
      ],
      unreadNotificationsCount: 2,
      recentNotifications: [],
      activeDesignJobsCount: 4,
      awaitingReviewCount: 1,
      recentDesignJobs: [],
      dbHealth: { connected: true, latencyMs: 18 },
    };

    const spy = jest
      .spyOn(mobileApiClient, 'fetchDashboardSnapshot')
      .mockRejectedValueOnce(new Error('Temporary outage'))
      .mockResolvedValueOnce(snapshot);

    const { findByTestId, findByText } = await renderWithProviders(
      <HomeScreen />,
      manager
    );

    expect(await findByTestId('home-error-banner')).toBeTruthy();
    await fireEvent.press(await findByTestId('home-retry-button'));

    expect(await findByText('42')).toBeTruthy();
    expect(await findByText('Kofi Mensah')).toBeTruthy();
    expect(await findByText('2 unread notifications')).toBeTruthy();
    spy.mockRestore();
  });

  it('renders honest Milestone 7 roadmap notice on Calendar and executes Sign Out on More tab', async () => {
    const creds = makeCredentials();
    const logoutFetch = jest.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ success: true, revokedSessions: 1 }),
    }));
    const manager = makeManager(creds, logoutFetch);
    await manager.hydrate();

    const calView = await renderWithProviders(<CalendarTabScreen />, manager);
    expect(calView.getByText(/Stage 6\.4 & Milestone 7/i)).toBeTruthy();

    const moreView = await renderWithProviders(<MoreTabScreen />, manager);
    expect(moreView.getByText('Foli Solomon')).toBeTruthy();
    expect(moreView.getByText('Events & Programmes')).toBeTruthy();
    expect(moreView.getByText('Asset Library')).toBeTruthy();

    await fireEvent.press(moreView.getByTestId('more-sign-out-button'));
    await waitFor(() => {
      expect(manager.getSnapshot().status).toBe('unauthenticated');
    });
  });
});
