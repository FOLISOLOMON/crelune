import * as SecureStore from 'expo-secure-store';
import {
  CREDENTIALS_STORAGE_KEY,
  DEVICE_INSTALL_ID_STORAGE_KEY,
  SecureStoragePersistenceError,
  createExpoSecureCredentialStorage,
  type StoredMobileCredentials,
} from '@/auth/secure-store';
import {
  MobileConfigError,
  getDefaultDevApiBaseUrl,
  validateApiBaseUrl,
} from '@/config/env';
import { colors, touchTarget } from '@/theme/tokens';

const mockSecureStore = SecureStore as typeof SecureStore & {
  __resetMockStore: () => void;
  __getMockStore: () => Map<string, string>;
};

function makeSampleCredentials(
  overrides: Partial<StoredMobileCredentials> = {}
): StoredMobileCredentials {
  return {
    accessToken: 'cln_mob_at.eyJ0eXAiOiJtb2JpbGVfYWNjZXNzIn0.sig_1',
    accessTokenExpiresAt: '2026-11-24T05:00:00.000Z',
    refreshToken: `cln_mob_rt_${'a'.repeat(64)}`,
    refreshTokenExpiresAt: '2026-12-24T04:00:00.000Z',
    tokenType: 'Bearer',
    device: {
      id: 'dev_0123456789',
      platform: 'ANDROID',
      deviceName: 'Pixel 9 Pro',
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
      id: 'usr_0123456789',
      email: 'owner@crelune.test',
      firstName: 'Foli',
      lastName: 'Solomon',
      role: 'OWNER',
      organisationId: 'org_0123456789',
      organisationName: 'CRELUNE Studio',
      timezone: 'Africa/Accra',
    },
    ...overrides,
  };
}

describe('CRELUNE Mobile — Theme Tokens, Transport Security & SecureStore', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSecureStore.__resetMockStore();
  });

  it('consumes canonical CRELUNE brand hex palette from @crelune/ui/colors and enforces >= 48dp touch targets', () => {
    expect(colors.primary.DEFAULT).toBe('#6541A5');
    expect(colors.lavender.DEFAULT).toBe('#A99AD1');
    expect(colors.background).toBe('#F8F7FA');
    expect(colors.surface.DEFAULT).toBe('#FFFFFF');
    expect(colors.text.primary).toBe('#24212B');
    expect(colors.text.secondary).toBe('#77727F');
    expect(colors.border.DEFAULT).toBe('#E8E5ED');
    expect(touchTarget.min).toBeGreaterThanOrEqual(48);
  });

  it('enforces HTTPS strictly in release builds and restricts dev HTTP to local hosts only', () => {
    expect(
      validateApiBaseUrl('https://api.crelune.app/', { isDev: false })
    ).toBe('https://api.crelune.app');

    expect(() =>
      validateApiBaseUrl('http://api.crelune.app', { isDev: false })
    ).toThrow(MobileConfigError);

    expect(() =>
      validateApiBaseUrl('http://10.0.2.2:3000', { isDev: false })
    ).toThrow(MobileConfigError);

    // Dev allows emulator host, loopback, and private LAN IPs
    expect(
      validateApiBaseUrl('http://10.0.2.2:3000/', { isDev: true })
    ).toBe('http://10.0.2.2:3000');
    expect(
      validateApiBaseUrl('http://192.168.1.25:3000', { isDev: true })
    ).toBe('http://192.168.1.25:3000');

    // Dev STILL rejects cleartext public hosts and embedded credentials
    expect(() =>
      validateApiBaseUrl('http://api.crelune.app', { isDev: true })
    ).toThrow(MobileConfigError);
    expect(() =>
      validateApiBaseUrl('https://user:pass@api.crelune.app', { isDev: true })
    ).toThrow(MobileConfigError);

    expect(getDefaultDevApiBaseUrl('android')).toBe('http://10.0.2.2:3000');
    expect(getDefaultDevApiBaseUrl('ios')).toBe('http://localhost:3000');
  });

  it('persists and hydrates credentials in SecureStore, clears corrupted data, and retains deviceInstallId on logout', async () => {
    const storage = createExpoSecureCredentialStorage();
    const creds = makeSampleCredentials();

    const installId = await storage.getOrCreateDeviceInstallId();
    expect(installId).toMatch(/^cln_dev_[a-f0-9]{32}$/);
    expect(await storage.getOrCreateDeviceInstallId()).toBe(installId);

    await storage.saveCredentials(creds);
    expect(SecureStore.setItemAsync).toHaveBeenCalledWith(
      CREDENTIALS_STORAGE_KEY,
      expect.any(String),
      { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY }
    );

    const hydrated = await storage.loadCredentials();
    expect(hydrated).toEqual(creds);

    // Clearing credentials leaves deviceInstallId intact so physical device rebinds cleanly
    await storage.clearCredentials();
    expect(await storage.loadCredentials()).toBeNull();
    expect(mockSecureStore.__getMockStore().get(DEVICE_INSTALL_ID_STORAGE_KEY)).toBe(
      installId
    );

    // Corrupted JSON is safely purged and returns null
    mockSecureStore.__getMockStore().set(CREDENTIALS_STORAGE_KEY, '{broken_json');
    expect(await storage.loadCredentials()).toBeNull();
    expect(mockSecureStore.__getMockStore().has(CREDENTIALS_STORAGE_KEY)).toBe(false);
  });

  it('throws SecureStoragePersistenceError when OS SecureStore write fails', async () => {
    const storage = createExpoSecureCredentialStorage();
    jest
      .spyOn(SecureStore, 'setItemAsync')
      .mockRejectedValueOnce(new Error('Keystore locked'));

    await expect(
      storage.saveCredentials(makeSampleCredentials())
    ).rejects.toBeInstanceOf(SecureStoragePersistenceError);
  });
});
