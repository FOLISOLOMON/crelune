/**
 * CRELUNE — Stage 6.1 Mobile Authentication, Rotation, Concurrency, Replay & Revocation
 * Real Neon Development PostgreSQL Integration Tests
 *
 * Strictly executes against Neon `development` (`br-nameless-silence-bexjp44k`),
 * creates isolated synthetic `__pg_m61_*` records, and cleans up all test artifacts.
 */

import crypto from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { prisma } from '@crelune/database';
import { MOBILE_REFRESH_MAX_LIFETIME_SECONDS } from '@crelune/shared';
import {
  getOwnerNotificationPreferences,
  listMobileDevices,
  loginMobileOwner,
  logoutMobileSession,
  MobileAuthError,
  refreshMobileSession,
  revokeMobileDevice,
  updateOwnerNotificationPreferences,
} from '@/lib/auth/mobile-auth-service';
import { hashMobileRefreshToken } from '@/lib/auth/mobile-token';
import { hashPassword } from '@/lib/auth/password';
import { createSessionToken } from '@/lib/auth/session';
import { requireAuthenticatedOwnerApi } from '@/lib/auth/api-owner-guard';
import { GET as dashboardGet } from '@/app/api/dashboard/route';
import { GET as meGet } from '@/app/api/auth/me/route';
import { GET as membersGet } from '@/app/api/members/route';
import { assertSafeDevDatabaseEnvironment } from './assert-dev-db';

const mockCookieJar = vi.hoisted(() => ({
  values: new Map<string, string>(),
}));

vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({
    get: (name: string) => {
      const value = mockCookieJar.values.get(name);
      return value !== undefined ? { name, value } : undefined;
    },
    set: (name: string, value: string, opts?: { maxAge?: number }) => {
      if (opts?.maxAge === 0) {
        mockCookieJar.values.delete(name);
      } else {
        mockCookieJar.values.set(name, value);
      }
    },
    delete: (name: string) => {
      mockCookieJar.values.delete(name);
    },
  })),
}));

const RUN_ID = `m61_${crypto.randomBytes(6).toString('hex')}`;
const PASSWORD_A = 'StrongMobilePass!2026#A';
const PASSWORD_B = 'StrongMobilePass!2026#B';

describe('Stage 6.1 Mobile Auth, Rotation, Replay & Device Revocation (Neon Development PG)', () => {
  let orgAId = '';
  let userAId = '';
  let emailA = '';

  let orgBId = '';
  let emailB = '';

  const throttleKeysToClean: string[] = [];

  beforeAll(async () => {
    assertSafeDevDatabaseEnvironment();
    if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32) {
      process.env.SESSION_SECRET =
        'crelune_stage61_pg_integration_test_secret_64_bytes_minimum_key!';
    }

    emailA = `__pg_${RUN_ID}_owner_a@crelune.test`;
    emailB = `__pg_${RUN_ID}_owner_b@crelune.test`;

    const [hashA, hashB] = await Promise.all([
      hashPassword(PASSWORD_A),
      hashPassword(PASSWORD_B),
    ]);

    const orgA = await prisma.organisation.create({
      data: {
        name: `__pg_${RUN_ID}_org_a`,
        slug: `__pg-${RUN_ID}-org-a`,
      },
    });
    orgAId = orgA.id;

    const userA = await prisma.user.create({
      data: {
        organisationId: orgAId,
        email: emailA,
        passwordHash: hashA,
        firstName: 'Mobile',
        lastName: 'OwnerA',
        role: 'OWNER',
        isActive: true,
        sessionVersion: 1,
      },
    });
    userAId = userA.id;

    const orgB = await prisma.organisation.create({
      data: {
        name: `__pg_${RUN_ID}_org_b`,
        slug: `__pg-${RUN_ID}-org-b`,
      },
    });
    orgBId = orgB.id;

    await prisma.user.create({
      data: {
        organisationId: orgBId,
        email: emailB,
        passwordHash: hashB,
        firstName: 'Mobile',
        lastName: 'OwnerB',
        role: 'OWNER',
        isActive: true,
        sessionVersion: 1,
      },
    });
  });

  afterAll(async () => {
    mockCookieJar.values.clear();
    const orgIds = [orgAId, orgBId].filter(Boolean);
    if (orgIds.length > 0) {
      await prisma.pushDelivery.deleteMany({
        where: { organisationId: { in: orgIds } },
      });
      await prisma.mobileSession.deleteMany({
        where: { organisationId: { in: orgIds } },
      });
      await prisma.mobileDevice.deleteMany({
        where: { organisationId: { in: orgIds } },
      });
      await prisma.auditLog.deleteMany({
        where: { organisationId: { in: orgIds } },
      });
      await prisma.user.deleteMany({
        where: { organisationId: { in: orgIds } },
      });
      await prisma.organisation.deleteMany({
        where: { id: { in: orgIds } },
      });
    }
    if (throttleKeysToClean.length > 0) {
      await prisma.authThrottle.deleteMany({
        where: { bucketKey: { in: throttleKeysToClean } },
      });
    }
  });

  it('enforces SHA-256-only refresh storage, PostgreSQL CHECK constraints, unified Bearer/Cookie-CSRF auth, Dashboard API & notification preferences', async () => {
    const installId = `install_${RUN_ID}_android_01`;

    // Wrong password & unknown account both return uniform 401
    await expect(
      loginMobileOwner(
        {
          email: emailA,
          password: 'WrongPassword!2026',
          device: {
            deviceInstallId: installId,
            platform: 'ANDROID',
            deviceName: 'Pixel 9 Pro',
          },
        },
        null
      )
    ).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS', statusCode: 401 });

    // Clean throttle created for null-IP test email
    const noIpKey = `acct_noip:${crypto
      .createHash('sha256')
      .update(emailA.toLowerCase())
      .digest('hex')}`;
    throttleKeysToClean.push(noIpKey);

    // Valid mobile login
    const loginNow = new Date();
    const session = await loginMobileOwner(
      {
        email: emailA,
        password: PASSWORD_A,
        device: {
          deviceInstallId: installId,
          platform: 'ANDROID',
          deviceName: 'Pixel 9 Pro',
          osVersion: 'Android 16',
          appVersion: '0.1.0',
        },
      },
      null,
      { now: loginNow }
    );

    expect(session.tokenType).toBe('Bearer');
    expect(session.accessToken.startsWith('cln_mob_at.')).toBe(true);
    expect(session.refreshToken).toMatch(/^cln_mob_rt_[a-f0-9]{64}$/);
    expect(session.device.platform).toBe('ANDROID');
    expect(session.device.status).toBe('ACTIVE');

    // Verify DB stores ONLY SHA-256 hash — NEVER plaintext refresh token
    const storedHash = hashMobileRefreshToken(session.refreshToken);
    const dbSession = await prisma.mobileSession.findUnique({
      where: { refreshTokenHash: storedHash },
    });
    expect(dbSession).not.toBeNull();
    expect(dbSession!.refreshTokenHash).toBe(storedHash);
    expect(dbSession!.refreshTokenHash).not.toBe(session.refreshToken);

    // Verify PostgreSQL CHECK constraint blocks plaintext refresh token insertion directly at DB level
    await expect(
      prisma.mobileSession.create({
        data: {
          organisationId: orgAId,
          userId: userAId,
          mobileDeviceId: session.device.id,
          familyId: crypto.randomUUID(),
          sessionVersion: 1,
          refreshTokenHash: `cln_mob_rt_${'f'.repeat(64)}`, // Plaintext -> MUST fail PG CHECK!
          familyExpiresAt: new Date(
            loginNow.getTime() + MOBILE_REFRESH_MAX_LIFETIME_SECONDS * 1000
          ),
          expiresAt: new Date(
            loginNow.getTime() + MOBILE_REFRESH_MAX_LIFETIME_SECONDS * 1000
          ),
        },
      })
    ).rejects.toThrow(/chk_mobile_sessions_refresh_hash_sha256|check constraint/i);

    // Verify PostgreSQL CHECK constraint blocks sessions exceeding 30-day hard cap
    await expect(
      prisma.mobileSession.create({
        data: {
          organisationId: orgAId,
          userId: userAId,
          mobileDeviceId: session.device.id,
          familyId: crypto.randomUUID(),
          sessionVersion: 1,
          refreshTokenHash: 'b'.repeat(64),
          familyExpiresAt: new Date(
            loginNow.getTime() + (MOBILE_REFRESH_MAX_LIFETIME_SECONDS + 3600) * 1000
          ),
          expiresAt: new Date(
            loginNow.getTime() + (MOBILE_REFRESH_MAX_LIFETIME_SECONDS + 3600) * 1000
          ),
        },
      })
    ).rejects.toThrow(/chk_mobile_sessions_lifetime_cap|check constraint/i);

    // Mobile Bearer works across existing /api/members, /api/dashboard, and /api/auth/me without CSRF Origin
    const bearerHeaders = { authorization: `Bearer ${session.accessToken}` };
    const dashRes = await dashboardGet(
      new Request('https://crelune.test/api/dashboard', { headers: bearerHeaders })
    );
    expect(dashRes.status).toBe(200);
    const dashJson = await dashRes.json();
    expect(dashJson.activeMembersCount).toBe(0);
    expect(dashJson.dbHealth.connected).toBe(true);

    const membersRes = await membersGet(
      new Request('https://crelune.test/api/members', { headers: bearerHeaders })
    );
    expect(membersRes.status).toBe(200);

    const meRes = await meGet(
      new Request('https://crelune.test/api/auth/me', { headers: bearerHeaders })
    );
    expect(meRes.status).toBe(200);
    const meJson = await meRes.json();
    expect(meJson.authMethod).toBe('mobile_bearer');
    expect(meJson.deviceId).toBe(session.device.id);

    // Existing Web Cookie + CSRF enforcement stays 100% intact (403 without Origin on mutation!)
    const webCookie = createSessionToken({
      id: userAId,
      organisationId: orgAId,
      sessionVersion: 1,
    });
    mockCookieJar.values.set('crelune_session', webCookie);
    const noOriginGuard = await requireAuthenticatedOwnerApi(
      new Request('https://crelune.test/api/members', {
        method: 'POST',
        headers: { host: 'crelune.test' },
      }),
      { verifyCsrf: true }
    );
    expect(noOriginGuard.ok).toBe(false);
    if (!noOriginGuard.ok) {
      expect(noOriginGuard.response.status).toBe(403);
    }

    // Ambiguous Cookie header + Bearer header rejected fail-closed with 400
    const mixedGuard = await requireAuthenticatedOwnerApi(
      new Request('https://crelune.test/api/dashboard', {
        headers: {
          cookie: `crelune_session=${webCookie}`,
          authorization: `Bearer ${session.accessToken}`,
        },
      })
    );
    expect(mixedGuard.ok).toBe(false);
    if (!mixedGuard.ok) {
      expect(mixedGuard.response.status).toBe(400);
    }
    mockCookieJar.values.clear();

    // Notification preferences default & update round-trip
    expect(await getOwnerNotificationPreferences(userAId)).toEqual({
      pushNotificationsEnabled: true,
      pushBirthdayReminders: true,
      pushDesignUpdates: true,
    });
    const updatedPrefs = await updateOwnerNotificationPreferences(
      { userId: userAId, organisationId: orgAId },
      {
        pushNotificationsEnabled: true,
        pushBirthdayReminders: true,
        pushDesignUpdates: false,
      }
    );
    expect(updatedPrefs.pushDesignUpdates).toBe(false);

    // AuditLog recorded MOBILE_LOGIN without ever storing any token material
    const audits = await prisma.auditLog.findMany({
      where: { organisationId: orgAId, action: 'MOBILE_LOGIN' },
    });
    expect(audits.length).toBeGreaterThanOrEqual(1);
    expect(JSON.stringify(audits)).not.toContain(session.refreshToken);
    expect(JSON.stringify(audits)).not.toContain(session.accessToken);
  }, 45_000);

  it('rotates single-use refresh tokens atomically under concurrency, enforces 30-day hard cap, and revokes entire family on replay', async () => {
    const installId = `install_${RUN_ID}_race_01`;
    const loginTime = new Date(Date.now() - 10 * 60_000);
    const initial = await loginMobileOwner(
      {
        email: emailA,
        password: PASSWORD_A,
        device: {
          deviceInstallId: installId,
          platform: 'IOS',
          deviceName: 'iPhone Test Profile',
        },
      },
      null,
      { now: loginTime }
    );

    // Wrong deviceInstallId MUST fail with 401 without rotating
    await expect(
      refreshMobileSession(
        {
          refreshToken: initial.refreshToken,
          deviceInstallId: `install_${RUN_ID}_wrong_device`,
        },
        { now: new Date(loginTime.getTime() + 60_000) }
      )
    ).rejects.toMatchObject({ code: 'INVALID_REFRESH_TOKEN', statusCode: 401 });

    // Sequential rotation R1 -> R2 inherits exact immutable 30-day familyExpiresAt
    const rot1Time = new Date(loginTime.getTime() + 5 * 60_000);
    const rotated = await refreshMobileSession(
      {
        refreshToken: initial.refreshToken,
        deviceInstallId: installId,
      },
      { now: rot1Time }
    );
    expect(rotated.refreshToken).not.toBe(initial.refreshToken);
    expect(rotated.refreshTokenExpiresAt).toBe(initial.refreshTokenExpiresAt);

    // Old access token from rotated session S1 is IMMEDIATELY invalidated on API call
    const oldAccessCheck = await requireAuthenticatedOwnerApi(
      new Request('https://crelune.test/api/dashboard', {
        headers: { authorization: `Bearer ${initial.accessToken}` },
      })
    );
    expect(oldAccessCheck.ok).toBe(false);
    if (!oldAccessCheck.ok) {
      expect(oldAccessCheck.response.status).toBe(401);
    }

    // New access token from S2 succeeds (iat = 5m ago, exp = 10m ahead)
    const newAccessCheck = await requireAuthenticatedOwnerApi(
      new Request('https://crelune.test/api/dashboard', {
        headers: { authorization: `Bearer ${rotated.accessToken}` },
      })
    );
    expect(newAccessCheck.ok).toBe(true);

    // CONCURRENT REFRESH RACE: Two simultaneous refreshes of R2 synchronized right before TX locks
    let arrived = 0;
    let releaseBoth!: () => void;
    const barrier = new Promise<void>((resolve) => {
      releaseBoth = resolve;
    });
    const waitAtBarrier = async () => {
      arrived += 1;
      if (arrived === 2) {
        releaseBoth();
      }
      await barrier;
    };

    const raceTime = new Date();
    const outcomes = await Promise.allSettled([
      refreshMobileSession(
        { refreshToken: rotated.refreshToken, deviceInstallId: installId },
        { now: raceTime, beforeLockTransaction: waitAtBarrier }
      ),
      refreshMobileSession(
        { refreshToken: rotated.refreshToken, deviceInstallId: installId },
        { now: raceTime, beforeLockTransaction: waitAtBarrier }
      ),
    ]);

    const fulfilled = outcomes.filter(
      (o): o is PromiseFulfilledResult<Awaited<ReturnType<typeof refreshMobileSession>>> =>
        o.status === 'fulfilled'
    );
    const rejected = outcomes.filter(
      (o): o is PromiseRejectedResult => o.status === 'rejected'
    );

    // Strictly ONE rotation succeeded and ONE detected reuse & revoked the entire family!
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]!.reason).toBeInstanceOf(MobileAuthError);
    expect((rejected[0]!.reason as MobileAuthError).code).toBe(
      'REFRESH_TOKEN_REUSE_DETECTED'
    );

    // Because reuse revoked the ENTIRE family, the winner's new R3 and access token are BOTH now revoked!
    const winner = fulfilled[0]!.value;
    await expect(
      refreshMobileSession(
        { refreshToken: winner.refreshToken, deviceInstallId: installId },
        { now: new Date(raceTime.getTime() + 5_000) }
      )
    ).rejects.toMatchObject({ statusCode: 401 });

    const winnerAccessCheck = await requireAuthenticatedOwnerApi(
      new Request('https://crelune.test/api/dashboard', {
        headers: { authorization: `Bearer ${winner.accessToken}` },
      })
    );
    expect(winnerAccessCheck.ok).toBe(false);

    // AuditLog recorded MOBILE_SESSION_REUSE_DETECTED with zero token leakage
    const reuseAudits = await prisma.auditLog.findMany({
      where: {
        organisationId: orgAId,
        action: 'MOBILE_SESSION_REUSE_DETECTED',
      },
    });
    expect(reuseAudits.length).toBeGreaterThanOrEqual(1);
    expect(JSON.stringify(reuseAudits)).not.toContain(rotated.refreshToken);
    expect(JSON.stringify(reuseAudits)).not.toContain(winner.refreshToken);

    // Hard 30-day session lifetime expiry test (no sliding past 30 days)
    const freshLogin = await loginMobileOwner(
      {
        email: emailA,
        password: PASSWORD_A,
        device: {
          deviceInstallId: installId,
          platform: 'IOS',
        },
      },
      null,
      { now: loginTime }
    );
    const after30Days = new Date(
      loginTime.getTime() + (MOBILE_REFRESH_MAX_LIFETIME_SECONDS + 10) * 1000
    );
    await expect(
      refreshMobileSession(
        { refreshToken: freshLogin.refreshToken, deviceInstallId: installId },
        { now: after30Days }
      )
    ).rejects.toMatchObject({ code: 'SESSION_EXPIRED', statusCode: 401 });
  }, 60_000);

  it('supports independent device revocation, cross-organisation isolation, logout cleanup, and account sessionVersion global revocation', async () => {
    const devAInstall = `install_${RUN_ID}_indep_a`;
    const devBInstall = `install_${RUN_ID}_indep_b`;
    const orgBInstall = `install_${RUN_ID}_org_b_dev`;

    const [sessA, sessB, sessOrgB] = await Promise.all([
      loginMobileOwner(
        {
          email: emailA,
          password: PASSWORD_A,
          device: {
            deviceInstallId: devAInstall,
            platform: 'ANDROID',
            deviceName: 'Owner Android Phone',
          },
        },
        null
      ),
      loginMobileOwner(
        {
          email: emailA,
          password: PASSWORD_A,
          device: {
            deviceInstallId: devBInstall,
            platform: 'IOS',
            deviceName: 'Owner iPad',
          },
        },
        null
      ),
      loginMobileOwner(
        {
          email: emailB,
          password: PASSWORD_B,
          device: {
            deviceInstallId: orgBInstall,
            platform: 'ANDROID',
            deviceName: 'Other Org Device',
          },
        },
        null
      ),
    ]);

    // Simulate push token present on Device A & Device B so revocation/logout clearing is proven
    await prisma.mobileDevice.update({
      where: { id: sessA.device.id },
      data: { expoPushToken: `ExponentPushToken[${RUN_ID}_a]` },
    });
    await prisma.mobileDevice.update({
      where: { id: sessB.device.id },
      data: { expoPushToken: `ExponentPushToken[${RUN_ID}_b]` },
    });

    // Cross-organisation isolation: Owner A cannot see or revoke Owner B's device (generic 404)
    const ownerADevices = await listMobileDevices({
      userId: userAId,
      organisationId: orgAId,
    });
    expect(ownerADevices.some((d) => d.id === sessOrgB.device.id)).toBe(false);

    await expect(
      revokeMobileDevice(
        { userId: userAId, organisationId: orgAId },
        sessOrgB.device.id,
        { reason: 'Cross-org attempt' }
      )
    ).rejects.toMatchObject({ code: 'MOBILE_DEVICE_NOT_FOUND', statusCode: 404 });

    // Independent revocation of Device A invalidates ONLY Device A; Device B remains active!
    const revokedA = await revokeMobileDevice(
      { userId: userAId, organisationId: orgAId },
      sessA.device.id,
      { reason: 'Phone misplaced.' }
    );
    expect(revokedA.status).toBe('REVOKED');
    expect(revokedA.hasPushToken).toBe(false);
    expect(revokedA.activeSessionCount).toBe(0);

    const devAAccess = await requireAuthenticatedOwnerApi(
      new Request('https://crelune.test/api/dashboard', {
        headers: { authorization: `Bearer ${sessA.accessToken}` },
      })
    );
    expect(devAAccess.ok).toBe(false);
    await expect(
      refreshMobileSession({
        refreshToken: sessA.refreshToken,
        deviceInstallId: devAInstall,
      })
    ).rejects.toMatchObject({ code: 'DEVICE_REVOKED', statusCode: 401 });

    // Device B stays 100% active!
    const devBAccess = await requireAuthenticatedOwnerApi(
      new Request('https://crelune.test/api/dashboard', {
        headers: { authorization: `Bearer ${sessB.accessToken}` },
      })
    );
    expect(devBAccess.ok).toBe(true);

    // Explicit logout on Device B revokes Device B's session & clears push token
    expect(devBAccess.ok && devBAccess.owner.mobileContext).toBeTruthy();
    if (devBAccess.ok && devBAccess.owner.mobileContext) {
      await logoutMobileSession({
        userId: userAId,
        organisationId: orgAId,
        deviceId: devBAccess.owner.mobileContext.deviceId,
        sessionId: devBAccess.owner.mobileContext.sessionId,
        familyId: devBAccess.owner.mobileContext.familyId,
      });
    }

    const devBAfterLogout = await requireAuthenticatedOwnerApi(
      new Request('https://crelune.test/api/dashboard', {
        headers: { authorization: `Bearer ${sessB.accessToken}` },
      })
    );
    expect(devBAfterLogout.ok).toBe(false);
    const devBRow = await prisma.mobileDevice.findUnique({
      where: { id: sessB.device.id },
      select: { expoPushToken: true },
    });
    expect(devBRow?.expoPushToken).toBeNull();

    // Account-security revocation: incrementing User.sessionVersion invalidates active mobile sessions immediately!
    const reloginB = await loginMobileOwner(
      {
        email: emailA,
        password: PASSWORD_A,
        device: { deviceInstallId: devBInstall, platform: 'IOS' },
      },
      null
    );
    await prisma.user.update({
      where: { id: userAId },
      data: { sessionVersion: { increment: 1 } },
    });

    const staleVerAccess = await requireAuthenticatedOwnerApi(
      new Request('https://crelune.test/api/dashboard', {
        headers: { authorization: `Bearer ${reloginB.accessToken}` },
      })
    );
    expect(staleVerAccess.ok).toBe(false);
    await expect(
      refreshMobileSession({
        refreshToken: reloginB.refreshToken,
        deviceInstallId: devBInstall,
      })
    ).rejects.toMatchObject({ statusCode: 401 });
  }, 60_000);
});
