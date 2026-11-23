import { describe, expect, it } from 'vitest';
import {
  MOBILE_ACCESS_TTL_SECONDS,
  MOBILE_REFRESH_MAX_LIFETIME_SECONDS,
  MOBILE_TOKEN_AUDIENCE,
  MOBILE_TOKEN_ISSUER,
  MOBILE_TOKEN_TYPE,
  mobileDeepLinkPayloadSchema,
  mobileLoginSchema,
  mobileRefreshSchema,
  notificationPreferencesUpdateSchema,
  revokeMobileDeviceSchema,
  validateMobileAccessPayload,
} from './mobile.js';

describe('Stage 6.1 Shared Mobile Schemas & Access Token Validation', () => {
  const now = 1_760_000_000;

  function validAccessPayload(overrides: Record<string, unknown> = {}) {
    return {
      typ: MOBILE_TOKEN_TYPE,
      iss: MOBILE_TOKEN_ISSUER,
      aud: MOBILE_TOKEN_AUDIENCE,
      sub: 'usr_owner_123456',
      role: 'OWNER',
      org: 'org_crelune_1234',
      ver: 1,
      dev: 'mdev_1234567890',
      sid: 'mses_1234567890',
      jti: 'jti_0123456789abcdef',
      iat: now,
      exp: now + MOBILE_ACCESS_TTL_SECONDS,
      ...overrides,
    };
  }

  it('enforces exact 15-minute access TTL and 30-day max refresh lifetime constants', () => {
    expect(MOBILE_ACCESS_TTL_SECONDS).toBe(900);
    expect(MOBILE_REFRESH_MAX_LIFETIME_SECONDS).toBe(2_592_000);
  });

  it('accepts valid mobile access token payloads and rejects wrong typ, iss, aud, lifetime, expiry, skew, or extra PII fields', () => {
    expect(validateMobileAccessPayload(validAccessPayload(), now)).not.toBeNull();

    // Wrong token type / issuer / audience
    expect(
      validateMobileAccessPayload(validAccessPayload({ typ: 'web_session' }), now)
    ).toBeNull();
    expect(
      validateMobileAccessPayload(validAccessPayload({ iss: 'evil-issuer' }), now)
    ).toBeNull();
    expect(
      validateMobileAccessPayload(validAccessPayload({ aud: 'crelune-web' }), now)
    ).toBeNull();

    // Exceeds 15-minute max TTL
    expect(
      validateMobileAccessPayload(
        validAccessPayload({ exp: now + MOBILE_ACCESS_TTL_SECONDS + 1 }),
        now
      )
    ).toBeNull();

    // Expired or inverted lifetime
    expect(
      validateMobileAccessPayload(validAccessPayload({ exp: now }), now)
    ).toBeNull();
    expect(
      validateMobileAccessPayload(validAccessPayload({ exp: now - 10 }), now)
    ).toBeNull();

    // Future clock skew > 60s
    expect(
      validateMobileAccessPayload(
        validAccessPayload({ iat: now + 61, exp: now + 61 + 300 }),
        now
      )
    ).toBeNull();

    // Extra PII claim rejected by strict schema
    expect(
      validateMobileAccessPayload(
        validAccessPayload({ email: 'owner@crelune.test' }),
        now
      )
    ).toBeNull();
  });

  it('validates mobile login, refresh, revoke, and notification preference schemas strictly', () => {
    const login = mobileLoginSchema.safeParse({
      email: 'owner@crelune.test',
      password: 'StrongPassword!2026',
      device: {
        deviceInstallId: 'install_1234567890abcdef',
        platform: 'ANDROID',
        deviceName: 'Pixel 9 Pro',
        osVersion: 'Android 16',
        appVersion: '0.1.0',
      },
    });
    expect(login.success).toBe(true);

    // Rejects short/unsafe deviceInstallId and unknown platforms
    expect(
      mobileLoginSchema.safeParse({
        email: 'owner@crelune.test',
        password: 'StrongPassword!2026',
        device: {
          deviceInstallId: '../bad',
          platform: 'WINDOWS',
        },
      }).success
    ).toBe(false);

    // Refresh requires valid prefixed 64-hex token + deviceInstallId
    expect(
      mobileRefreshSchema.safeParse({
        refreshToken: `cln_mob_rt_${'a'.repeat(64)}`,
        deviceInstallId: 'install_1234567890abcdef',
      }).success
    ).toBe(true);
    expect(
      mobileRefreshSchema.safeParse({
        refreshToken: 'not-a-valid-refresh-token',
        deviceInstallId: 'install_1234567890abcdef',
      }).success
    ).toBe(false);

    expect(
      revokeMobileDeviceSchema.safeParse({ reason: 'Lost phone on bus.' }).success
    ).toBe(true);
    expect(
      notificationPreferencesUpdateSchema.safeParse({
        pushNotificationsEnabled: true,
        pushBirthdayReminders: true,
        pushDesignUpdates: false,
      }).success
    ).toBe(true);
  });

  it('accepts safe typed deep-link payloads and rejects arbitrary paths or external URLs', () => {
    expect(
      mobileDeepLinkPayloadSchema.safeParse({
        version: 1,
        kind: 'BIRTHDAY_REMINDER',
        target: 'member',
        memberId: 'mem_1234567890',
        notificationId: 'ntf_1234567890',
      }).success
    ).toBe(true);

    expect(
      mobileDeepLinkPayloadSchema.safeParse({
        version: 1,
        kind: 'BIRTHDAY_REMINDER',
        target: 'member',
        memberId: '../../evil',
      }).success
    ).toBe(false);

    expect(
      mobileDeepLinkPayloadSchema.safeParse({
        version: 1,
        kind: 'SYSTEM',
        target: 'https://evil.example',
      }).success
    ).toBe(false);
  });
});
