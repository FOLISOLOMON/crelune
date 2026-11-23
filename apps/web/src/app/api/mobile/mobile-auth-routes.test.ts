import crypto from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MOBILE_ACCESS_TOKEN_WIRE_PREFIX,
  MOBILE_ACCESS_TTL_SECONDS,
  MOBILE_TOKEN_AUDIENCE,
  MOBILE_TOKEN_ISSUER,
  MOBILE_TOKEN_TYPE,
} from '@crelune/shared';
import { verifyMobileAccessTokenEdge } from '@/lib/auth/edge-session';
import {
  createMobileAccessToken,
  generateMobileRefreshToken,
  hashMobileRefreshToken,
  MOBILE_ACCESS_SIGNING_DOMAIN,
  verifyMobileAccessToken,
} from '@/lib/auth/mobile-token';
import { createSessionToken } from '@/lib/auth/session';

const TEST_SECRET =
  'crelune_stage_6_1_mobile_auth_unit_test_secret_64_bytes_minimum!';

const mockGuard = vi.hoisted(() => ({
  requireAuthenticatedOwnerApi: vi.fn(),
  loginMobileOwner: vi.fn(),
  refreshMobileSession: vi.fn(),
  logoutMobileSession: vi.fn(),
  listMobileDevices: vi.fn(),
  revokeMobileDevice: vi.fn(),
  getOwnerNotificationPreferences: vi.fn(),
  updateOwnerNotificationPreferences: vi.fn(),
  getDashboardSnapshot: vi.fn(),
}));

vi.mock('@/lib/auth/api-owner-guard', async () => {
  const actual = await vi.importActual<
    typeof import('@/lib/auth/api-owner-guard')
  >('@/lib/auth/api-owner-guard');
  return {
    ...actual,
    requireAuthenticatedOwnerApi: mockGuard.requireAuthenticatedOwnerApi,
  };
});

vi.mock('@/lib/auth/mobile-auth-service', async () => {
  const actual = await vi.importActual<
    typeof import('@/lib/auth/mobile-auth-service')
  >('@/lib/auth/mobile-auth-service');
  return {
    ...actual,
    loginMobileOwner: mockGuard.loginMobileOwner,
    refreshMobileSession: mockGuard.refreshMobileSession,
    logoutMobileSession: mockGuard.logoutMobileSession,
    listMobileDevices: mockGuard.listMobileDevices,
    revokeMobileDevice: mockGuard.revokeMobileDevice,
    getOwnerNotificationPreferences: mockGuard.getOwnerNotificationPreferences,
    updateOwnerNotificationPreferences:
      mockGuard.updateOwnerNotificationPreferences,
  };
});

vi.mock('@/lib/dashboard/dashboard-service', () => ({
  getDashboardSnapshot: mockGuard.getDashboardSnapshot,
}));

import { POST as mobileLoginPost } from './auth/login/route';
import { POST as mobileRefreshPost } from './auth/refresh/route';
import { POST as mobileLogoutPost } from './auth/logout/route';
import { GET as mobileDevicesGet } from './devices/route';
import { POST as mobileDeviceRevokePost } from './devices/[id]/revoke/route';
import { GET as dashboardGet } from '../dashboard/route';
import {
  GET as notifPrefsGet,
  PATCH as notifPrefsPatch,
} from '../settings/notifications/route';
import { MobileAuthError } from '@/lib/auth/mobile-auth-service';

function signCustomMobileToken(payload: Record<string, unknown>, secret: string): string {
  const payloadEncoded = Buffer.from(JSON.stringify(payload), 'utf8')
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
  const sig = crypto
    .createHmac('sha256', secret)
    .update(`${MOBILE_ACCESS_SIGNING_DOMAIN}.${payloadEncoded}`, 'utf8')
    .digest()
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
  return `${MOBILE_ACCESS_TOKEN_WIRE_PREFIX}.${payloadEncoded}.${sig}`;
}

describe('Stage 6.1 Mobile Access Token Cryptography & Edge Parity', () => {
  const originalSecret = process.env.SESSION_SECRET;

  beforeEach(() => {
    process.env.SESSION_SECRET = TEST_SECRET;
  });

  afterEach(() => {
    process.env.SESSION_SECRET = originalSecret;
  });

  it('mints 15-minute domain-separated mobile access tokens verified identically in Node and Web Crypto Edge', async () => {
    const now = 1_760_000_000;
    const created = createMobileAccessToken({
      userId: 'usr_owner_123456',
      organisationId: 'org_crelune_1234',
      sessionVersion: 3,
      mobileDeviceId: 'mdev_1234567890',
      mobileSessionId: 'mses_1234567890',
      nowSeconds: now,
    });

    expect(created.token.startsWith(`${MOBILE_ACCESS_TOKEN_WIRE_PREFIX}.`)).toBe(
      true
    );
    expect(created.payload.exp - created.payload.iat).toBe(
      MOBILE_ACCESS_TTL_SECONDS
    );
    expect(created.payload.typ).toBe(MOBILE_TOKEN_TYPE);
    expect(created.payload.iss).toBe(MOBILE_TOKEN_ISSUER);
    expect(created.payload.aud).toBe(MOBILE_TOKEN_AUDIENCE);

    const nodeVerified = verifyMobileAccessToken(created.token, now + 60);
    const edgeVerified = await verifyMobileAccessTokenEdge(
      created.token,
      TEST_SECRET,
      now + 60
    );
    expect(nodeVerified).toEqual(created.payload);
    expect(edgeVerified).toEqual(created.payload);

    // Rejects expired token in both Node and Edge
    expect(
      verifyMobileAccessToken(created.token, now + MOBILE_ACCESS_TTL_SECONDS)
    ).toBeNull();
    expect(
      await verifyMobileAccessTokenEdge(
        created.token,
        TEST_SECRET,
        now + MOBILE_ACCESS_TTL_SECONDS
      )
    ).toBeNull();

    // Rejects tampered payload/signature
    const parts = created.token.split('.');
    const tampered = `${parts[0]}.${parts[1]}.${parts[2]!.slice(0, -2)}AA`;
    expect(verifyMobileAccessToken(tampered, now + 10)).toBeNull();
    expect(
      await verifyMobileAccessTokenEdge(tampered, TEST_SECRET, now + 10)
    ).toBeNull();

    // Rejects web cookie token presented as mobile access token
    const webToken = createSessionToken({
      id: 'usr_owner_123456',
      organisationId: 'org_crelune_1234',
      sessionVersion: 3,
    });
    expect(verifyMobileAccessToken(webToken, now)).toBeNull();
    expect(await verifyMobileAccessTokenEdge(webToken, TEST_SECRET, now)).toBeNull();
  });

  it('rejects wrong issuer, audience, token type, excessive TTL (>15m), and missing/short secrets (zero fallback)', async () => {
    const now = 1_760_000_000;
    const base = {
      typ: MOBILE_TOKEN_TYPE,
      iss: MOBILE_TOKEN_ISSUER,
      aud: MOBILE_TOKEN_AUDIENCE,
      sub: 'usr_owner_123456',
      role: 'OWNER',
      org: 'org_crelune_1234',
      ver: 1,
      dev: 'mdev_1234567890',
      sid: 'mses_1234567890',
      jti: '0123456789abcdef0123456789abcdef',
      iat: now,
      exp: now + 900,
    };

    const badTokens = [
      signCustomMobileToken({ ...base, iss: 'other-api' }, TEST_SECRET),
      signCustomMobileToken({ ...base, aud: 'crelune-web' }, TEST_SECRET),
      signCustomMobileToken({ ...base, typ: 'refresh' }, TEST_SECRET),
      signCustomMobileToken({ ...base, exp: now + 901 }, TEST_SECRET),
    ];

    for (const bad of badTokens) {
      expect(verifyMobileAccessToken(bad, now + 5)).toBeNull();
      expect(await verifyMobileAccessTokenEdge(bad, TEST_SECRET, now + 5)).toBeNull();
    }

    // Fail-closed when SESSION_SECRET is missing or < 32 chars
    const valid = createMobileAccessToken({
      userId: 'usr_owner_123456',
      organisationId: 'org_crelune_1234',
      sessionVersion: 1,
      mobileDeviceId: 'mdev_1234567890',
      mobileSessionId: 'mses_1234567890',
      nowSeconds: now,
    }).token;

    delete process.env.SESSION_SECRET;
    expect(verifyMobileAccessToken(valid, now + 5)).toBeNull();
    expect(await verifyMobileAccessTokenEdge(valid, undefined, now + 5)).toBeNull();
    expect(() =>
      createMobileAccessToken({
        userId: 'usr_owner_123456',
        organisationId: 'org_crelune_1234',
        sessionVersion: 1,
        mobileDeviceId: 'mdev_1234567890',
        mobileSessionId: 'mses_1234567890',
      })
    ).toThrow(/SESSION_SECRET/);
  });

  it('generates 256-bit prefixed refresh tokens and deterministic 64-hex SHA-256 hashes', () => {
    const a = generateMobileRefreshToken();
    const b = generateMobileRefreshToken();
    expect(a.rawToken).toMatch(/^cln_mob_rt_[a-f0-9]{64}$/);
    expect(a.tokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(a.tokenHash).toBe(hashMobileRefreshToken(a.rawToken));
    expect(a.rawToken).not.toBe(b.rawToken);
    expect(a.tokenHash).not.toBe(b.tokenHash);
  });
});

describe('Stage 6.1 Mobile Auth, Device, Dashboard & Notification Preference Routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.SESSION_SECRET = TEST_SECRET;
  });

  it('rejects oversized (>4KB) login/refresh payloads with 413 and never echoes refresh tokens on 401 errors', async () => {
    const huge = 'x'.repeat(5000);
    const loginRes = await mobileLoginPost(
      new Request('https://crelune.test/api/mobile/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: huge,
      })
    );
    expect(loginRes.status).toBe(413);

    const sampleRefresh = `cln_mob_rt_${'b'.repeat(64)}`;
    mockGuard.refreshMobileSession.mockRejectedValueOnce(
      new MobileAuthError(
        'REFRESH_TOKEN_REUSE_DETECTED',
        401,
        'Unauthorized: Refresh token reuse detected; session family revoked. Please sign in again.'
      )
    );
    const refreshRes = await mobileRefreshPost(
      new Request('https://crelune.test/api/mobile/auth/refresh', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          refreshToken: sampleRefresh,
          deviceInstallId: 'install_1234567890abcdef',
        }),
      })
    );
    expect(refreshRes.status).toBe(401);
    expect(refreshRes.headers.get('cache-control')).toBe('private, no-store');
    const text = await refreshRes.text();
    expect(text).not.toContain(sampleRefresh);
    expect(text).toContain('REFRESH_TOKEN_REUSE_DETECTED');
  });

  it('wires mobile logout strictly to mobile_bearer, device revoke with verifyCsrf, dashboard GET, and notification preferences', async () => {
    const ownerAuth = {
      ok: true as const,
      owner: {
        authMethod: 'mobile_bearer' as const,
        mobileContext: {
          deviceId: 'mdev_1234567890',
          sessionId: 'mses_1234567890',
          familyId: 'fam_123',
        },
        session: {
          sub: 'usr_owner_123456',
          role: 'OWNER' as const,
          org: 'org_crelune_1234',
          ver: 1,
          iat: 1_760_000_000,
          exp: 1_760_000_900,
        },
        profile: {
          id: 'usr_owner_123456',
          firstName: 'Foli',
          lastName: 'Solomon',
          email: 'owner@crelune.test',
          role: 'OWNER',
          organisationId: 'org_crelune_1234',
          organisationName: 'CRELUNE Operations',
        },
        preferences: null,
      },
    };
    mockGuard.requireAuthenticatedOwnerApi.mockResolvedValue(ownerAuth);

    mockGuard.logoutMobileSession.mockResolvedValueOnce({ revokedSessions: 1 });
    const logoutRes = await mobileLogoutPost(
      new Request('https://crelune.test/api/mobile/auth/logout', { method: 'POST' })
    );
    expect(logoutRes.status).toBe(200);
    expect(mockGuard.requireAuthenticatedOwnerApi).toHaveBeenCalledWith(
      expect.any(Request),
      { allowedAuthMethods: ['mobile_bearer'] }
    );

    mockGuard.listMobileDevices.mockResolvedValueOnce([]);
    const devicesRes = await mobileDevicesGet(
      new Request('https://crelune.test/api/mobile/devices')
    );
    expect(devicesRes.status).toBe(200);
    expect((await devicesRes.json()).currentDeviceId).toBe('mdev_1234567890');

    mockGuard.revokeMobileDevice.mockResolvedValueOnce({
      id: 'mdev_1234567890',
      status: 'REVOKED',
    });
    const revokeRes = await mobileDeviceRevokePost(
      new Request('https://crelune.test/api/mobile/devices/mdev_1234567890/revoke', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ reason: 'Lost phone' }),
      }),
      { params: Promise.resolve({ id: 'mdev_1234567890' }) }
    );
    expect(revokeRes.status).toBe(200);
    expect(mockGuard.requireAuthenticatedOwnerApi).toHaveBeenCalledWith(
      expect.any(Request),
      { verifyCsrf: true }
    );

    mockGuard.getDashboardSnapshot.mockResolvedValueOnce({
      activeMembersCount: 4,
      activeTemplatesCount: 2,
      birthdayCounts: {
        totalWithBirthday: 4,
        todayCount: 1,
        weekCount: 1,
        monthCount: 2,
        upcomingCount: 2,
        awaitingPrepCount: 1,
      },
      upcomingBirthdays: [],
      unreadNotificationsCount: 1,
      recentNotifications: [],
      activeDesignJobsCount: 2,
      awaitingReviewCount: 1,
      recentDesignJobs: [],
      dbHealth: { connected: true, latencyMs: 4 },
    });
    const dashRes = await dashboardGet(
      new Request('https://crelune.test/api/dashboard')
    );
    expect(dashRes.status).toBe(200);
    expect(dashRes.headers.get('cache-control')).toBe('private, no-store');
    expect((await dashRes.json()).activeMembersCount).toBe(4);

    mockGuard.getOwnerNotificationPreferences.mockResolvedValueOnce({
      pushNotificationsEnabled: true,
      pushBirthdayReminders: true,
      pushDesignUpdates: false,
    });
    const prefGetRes = await notifPrefsGet(
      new Request('https://crelune.test/api/settings/notifications')
    );
    expect(prefGetRes.status).toBe(200);

    mockGuard.updateOwnerNotificationPreferences.mockResolvedValueOnce({
      pushNotificationsEnabled: false,
      pushBirthdayReminders: false,
      pushDesignUpdates: false,
    });
    const prefPatchRes = await notifPrefsPatch(
      new Request('https://crelune.test/api/settings/notifications', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          pushNotificationsEnabled: false,
          pushBirthdayReminders: false,
          pushDesignUpdates: false,
        }),
      })
    );
    expect(prefPatchRes.status).toBe(200);
    expect(mockGuard.requireAuthenticatedOwnerApi).toHaveBeenLastCalledWith(
      expect.any(Request),
      { verifyCsrf: true }
    );
  });
});
