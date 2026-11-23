/**
 * CRELUNE — Authoritative Mobile Authentication, Rotating Refresh Session & Device Service (Stage 6.1)
 *
 * Security & Concurrency Invariants:
 * - Global lock order: L0 `users` (FOR SHARE) -> L1 `mobile_devices` (FOR UPDATE) ->
 *   L2 `mobile_sessions` (ORDER BY id ASC FOR UPDATE) to guarantee deadlock-free execution.
 * - Login enforces the exact same `AuthThrottle` rate limits and constant-time dummy
 *   `scrypt` verification as Web login (zero account enumeration).
 * - Refresh tokens are 256-bit cryptographically random secrets (`cln_mob_rt_<64-hex>`)
 *   persisted exclusively as SHA-256 hex hashes (`refresh_token_hash`).
 * - Single-use atomic refresh rotation: concurrent refreshes on the same token serialize
 *   on `L0 -> L1 -> L2`. At most ONE rotation succeeds; any replay of a previously rotated
 *   token atomically revokes the ENTIRE `familyId` (committed via non-throwing tx return!)
 *   and logs `MOBILE_SESSION_REUSE_DETECTED`.
 * - Hard 30-day session family lifetime (`familyExpiresAt`) is inherited across rotations
 *   and never extended without fresh owner password authentication.
 * - Independent device revocation immediately revokes all sessions and clears push token.
 */

import crypto from 'node:crypto';
import { prisma, type MobilePlatform } from '@crelune/database';
import {
  MOBILE_ACCESS_TTL_SECONDS,
  MOBILE_REFRESH_MAX_LIFETIME_SECONDS,
  type MobileAuthSessionResponse,
  type MobileDeviceSummary,
  type MobileLoginInput,
  type MobileRefreshInput,
  type NotificationPreferencesDto,
  type NotificationPreferencesUpdateInput,
  type RevokeMobileDeviceInput,
} from '@crelune/shared';
import * as auditService from '@/lib/audit/audit-service';
import {
  createMobileAccessToken,
  generateMobileRefreshToken,
  hashMobileRefreshToken,
} from './mobile-token';
import { verifyPassword } from './password';
import {
  checkLoginThrottle,
  clearIpAccountThrottle,
  recordFailedLoginAttempt,
} from './rate-limit';

const DUMMY_HASH = '0123456789abcdef0123456789abcdef:' + 'a'.repeat(128);

export type MobileAuthErrorCode =
  | 'INVALID_CREDENTIALS'
  | 'TOO_MANY_REQUESTS'
  | 'INVALID_REFRESH_TOKEN'
  | 'REFRESH_TOKEN_REUSE_DETECTED'
  | 'DEVICE_REVOKED'
  | 'SESSION_EXPIRED'
  | 'MOBILE_DEVICE_NOT_FOUND';

export class MobileAuthError extends Error {
  public readonly code: MobileAuthErrorCode;
  public readonly statusCode: number;

  constructor(code: MobileAuthErrorCode, statusCode: number, message: string) {
    super(message);
    this.name = 'MobileAuthError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

export interface MobileActor {
  userId: string;
  organisationId: string;
}

export interface MobileLogoutActor extends MobileActor {
  deviceId: string;
  sessionId: string;
  familyId: string;
}

function serializeMobileDevice(device: {
  id: string;
  platform: MobilePlatform;
  deviceName: string | null;
  osVersion: string | null;
  appVersion: string | null;
  expoPushToken: string | null;
  pushPermissionStatus: string | null;
  pushEnabled: boolean;
  lastSeenAt: Date;
  revokedAt: Date | null;
  revocationReason: string | null;
  createdAt: Date;
  _count?: { sessions: number };
}): MobileDeviceSummary {
  return {
    id: device.id,
    platform: device.platform,
    deviceName: device.deviceName,
    osVersion: device.osVersion,
    appVersion: device.appVersion,
    hasPushToken: Boolean(device.expoPushToken),
    pushPermissionStatus: device.pushPermissionStatus,
    pushEnabled: device.pushEnabled,
    status: device.revokedAt ? 'REVOKED' : 'ACTIVE',
    activeSessionCount: device._count?.sessions ?? 0,
    lastSeenAt: device.lastSeenAt.toISOString(),
    revokedAt: device.revokedAt ? device.revokedAt.toISOString() : null,
    revocationReason: device.revocationReason,
    createdAt: device.createdAt.toISOString(),
  };
}

function computeCappedAccessTtlSeconds(now: Date, familyExpiresAt: Date): number {
  const remainingSec = Math.floor(
    (familyExpiresAt.getTime() - now.getTime()) / 1000
  );
  if (remainingSec < 1) {
    return 0;
  }
  return Math.min(MOBILE_ACCESS_TTL_SECONDS, remainingSec);
}

/**
 * Authenticates the workspace owner for a native mobile device using the shared
 * scrypt + PostgreSQL AuthThrottle pipeline, binds a `MobileDevice`, creates a
 * fresh 30-day session family with a single-use SHA-256-hashed refresh token,
 * and mints a short-lived 15-minute signed mobile access token.
 */
export async function loginMobileOwner(
  input: MobileLoginInput,
  clientIp: string | null,
  options: { now?: Date } = {}
): Promise<MobileAuthSessionResponse> {
  const now = options.now ?? new Date();
  const normalizedEmail = input.email.toLowerCase();
  const { password } = input;

  // 1. Durable PostgreSQL throttle check BEFORE credential lookup
  const throttle = await checkLoginThrottle(clientIp, normalizedEmail);
  if (throttle.ipBlocked) {
    await verifyPassword(password, DUMMY_HASH);
    throw new MobileAuthError(
      'TOO_MANY_REQUESTS',
      429,
      'Too many requests. Please try again later.'
    );
  }
  if (throttle.accountBlocked) {
    await verifyPassword(password, DUMMY_HASH);
    throw new MobileAuthError(
      'INVALID_CREDENTIALS',
      401,
      'Invalid email or password'
    );
  }

  // 2. Lookup owner & run constant-time dummy verification on missing/inactive accounts
  const candidate = await prisma.user.findUnique({
    where: { email: normalizedEmail },
    include: {
      organisation: true,
      preferences: true,
    },
  });

  if (!candidate || !candidate.isActive || candidate.role !== 'OWNER') {
    await verifyPassword(password, DUMMY_HASH);
    await recordFailedLoginAttempt(clientIp, normalizedEmail);
    throw new MobileAuthError(
      'INVALID_CREDENTIALS',
      401,
      'Invalid email or password'
    );
  }

  const passwordMatch = await verifyPassword(password, candidate.passwordHash);
  if (!passwordMatch) {
    await recordFailedLoginAttempt(clientIp, normalizedEmail);
    throw new MobileAuthError(
      'INVALID_CREDENTIALS',
      401,
      'Invalid email or password'
    );
  }

  await clearIpAccountThrottle(clientIp, normalizedEmail);

  const familyId = crypto.randomUUID();
  const familyExpiresAt = new Date(
    now.getTime() + MOBILE_REFRESH_MAX_LIFETIME_SECONDS * 1000
  );
  const { rawToken: refreshToken, tokenHash: refreshTokenHash } =
    generateMobileRefreshToken();

  // 3. Atomically bind device, supersede prior sessions on this device, create new session & audit
  const created = await prisma.$transaction(
    async (tx) => {
      // L0: Lock user FOR SHARE to guard against concurrent deactivation / sessionVersion bump
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${candidate.id} FOR SHARE`;

      const freshUser = await tx.user.findUnique({
        where: { id: candidate.id },
        include: {
          organisation: true,
          preferences: true,
        },
      });

      if (
        !freshUser ||
        !freshUser.isActive ||
        freshUser.role !== 'OWNER' ||
        freshUser.organisationId !== candidate.organisationId
      ) {
        return null;
      }

      const upsertedDevice = await tx.mobileDevice.upsert({
        where: {
          organisationId_userId_deviceInstallId: {
            organisationId: freshUser.organisationId,
            userId: freshUser.id,
            deviceInstallId: input.device.deviceInstallId,
          },
        },
        create: {
          organisationId: freshUser.organisationId,
          userId: freshUser.id,
          deviceInstallId: input.device.deviceInstallId,
          platform: input.device.platform,
          deviceName: input.device.deviceName ?? null,
          osVersion: input.device.osVersion ?? null,
          appVersion: input.device.appVersion ?? null,
          lastSeenAt: now,
        },
        update: {
          platform: input.device.platform,
          deviceName: input.device.deviceName ?? undefined,
          osVersion: input.device.osVersion ?? undefined,
          appVersion: input.device.appVersion ?? undefined,
          lastSeenAt: now,
          revokedAt: null,
          revokedByUserId: null,
          revocationReason: null,
        },
      });

      // L1: Lock the bound MobileDevice row FOR UPDATE
      await tx.$queryRaw`
        SELECT id FROM mobile_devices
         WHERE id = ${upsertedDevice.id}
           AND organisation_id = ${freshUser.organisationId}
         FOR UPDATE
      `;

      // L2: Lock & supersede any existing unrevoked sessions on this same device
      await tx.$queryRaw`
        SELECT id FROM mobile_sessions
         WHERE mobile_device_id = ${upsertedDevice.id}
           AND organisation_id = ${freshUser.organisationId}
           AND revoked_at IS NULL
         ORDER BY id ASC
         FOR UPDATE
      `;

      await tx.mobileSession.updateMany({
        where: {
          mobileDeviceId: upsertedDevice.id,
          organisationId: freshUser.organisationId,
          revokedAt: null,
        },
        data: {
          revokedAt: now,
          revocationReason: 'SUPERSEDED_BY_NEW_LOGIN',
        },
      });

      const session = await tx.mobileSession.create({
        data: {
          organisationId: freshUser.organisationId,
          userId: freshUser.id,
          mobileDeviceId: upsertedDevice.id,
          familyId,
          sessionVersion: freshUser.sessionVersion,
          refreshTokenHash,
          familyExpiresAt,
          expiresAt: familyExpiresAt,
          lastUsedAt: now,
          createdAt: now,
        },
      });

      await auditService.recordAuditEvent(tx, {
        organisationId: freshUser.organisationId,
        actorUserId: freshUser.id,
        action: auditService.AUDIT_ACTIONS.MOBILE_LOGIN,
        entityType: 'MobileDevice',
        entityId: upsertedDevice.id,
        metadata: {
          platform: upsertedDevice.platform,
          hasDeviceName: Boolean(upsertedDevice.deviceName),
          familyId,
        },
      });

      return {
        user: freshUser,
        device: {
          ...upsertedDevice,
          _count: { sessions: 1 },
        },
        session,
      };
    },
    { maxWait: 15_000, timeout: 25_000 }
  );

  if (!created) {
    throw new MobileAuthError(
      'INVALID_CREDENTIALS',
      401,
      'Invalid email or password'
    );
  }

  const access = createMobileAccessToken({
    userId: created.user.id,
    organisationId: created.user.organisationId,
    sessionVersion: created.user.sessionVersion,
    mobileDeviceId: created.device.id,
    mobileSessionId: created.session.id,
    nowSeconds: Math.floor(now.getTime() / 1000),
    ttlSeconds: computeCappedAccessTtlSeconds(now, familyExpiresAt),
  });

  return {
    accessToken: access.token,
    accessTokenExpiresAt: access.expiresAt.toISOString(),
    refreshToken,
    refreshTokenExpiresAt: familyExpiresAt.toISOString(),
    tokenType: 'Bearer',
    device: serializeMobileDevice(created.device),
    user: {
      id: created.user.id,
      email: created.user.email,
      firstName: created.user.firstName,
      lastName: created.user.lastName,
      role: created.user.role,
      organisationId: created.user.organisationId,
      organisationName: created.user.organisation.name,
      timezone: created.user.preferences?.timezone ?? 'Africa/Accra',
    },
  };
}

type RefreshTxOutcome =
  | { ok: true; response: MobileAuthSessionResponse }
  | { ok: false; code: MobileAuthErrorCode; message: string };

/**
 * Atomically rotates a single-use mobile refresh token under strict `L0 -> L1 -> L2`
 * PostgreSQL row locks.
 *
 * - Concurrent refresh requests on the same token serialize deterministically:
 *   strictly ONE succeeds; the loser observes `replacedBySessionId !== null` and
 *   triggers atomic token-family revocation (`REFRESH_TOKEN_REUSE_DETECTED`).
 * - Inherits immutable 30-day `familyExpiresAt` without extending maximum lifetime.
 * - Validates user active status, role, `sessionVersion`, unrevoked device, and
 *   exact `deviceInstallId` binding.
 */
export async function refreshMobileSession(
  input: MobileRefreshInput,
  options: {
    now?: Date;
    /** Deterministic concurrency test hook invoked right before acquiring TX locks. */
    beforeLockTransaction?: () => Promise<void>;
  } = {}
): Promise<MobileAuthSessionResponse> {
  const now = options.now ?? new Date();
  const presentedHash = hashMobileRefreshToken(input.refreshToken);

  const lookup = await prisma.mobileSession.findUnique({
    where: { refreshTokenHash: presentedHash },
    select: {
      id: true,
      organisationId: true,
      userId: true,
      mobileDeviceId: true,
      familyId: true,
    },
  });

  if (!lookup) {
    throw new MobileAuthError(
      'INVALID_REFRESH_TOKEN',
      401,
      'Unauthorized: Refresh token is invalid or expired.'
    );
  }

  if (options.beforeLockTransaction) {
    await options.beforeLockTransaction();
  }

  const nextRefresh = generateMobileRefreshToken();

  const outcome = await prisma.$transaction<RefreshTxOutcome>(
    async (tx) => {
      // L0: Lock user row FOR SHARE
      await tx.$queryRaw`
        SELECT id FROM users
         WHERE id = ${lookup.userId}
         FOR SHARE
      `;

      // L1: Lock bound MobileDevice row FOR UPDATE
      await tx.$queryRaw`
        SELECT id FROM mobile_devices
         WHERE id = ${lookup.mobileDeviceId}
           AND organisation_id = ${lookup.organisationId}
         FOR UPDATE
      `;

      // L2: Lock ALL sessions in this token family in deterministic ID order FOR UPDATE
      await tx.$queryRaw`
        SELECT id FROM mobile_sessions
         WHERE family_id = ${lookup.familyId}
           AND organisation_id = ${lookup.organisationId}
         ORDER BY id ASC
         FOR UPDATE
      `;

      const session = await tx.mobileSession.findUnique({
        where: { id: lookup.id },
        include: {
          mobileDevice: true,
          user: {
            include: {
              organisation: true,
              preferences: true,
            },
          },
        },
      });

      if (!session || session.organisationId !== lookup.organisationId) {
        return {
          ok: false,
          code: 'INVALID_REFRESH_TOKEN',
          message: 'Unauthorized: Refresh token is invalid or expired.',
        };
      }

      const { mobileDevice, user } = session;

      // 1. CONFIRMED REFRESH TOKEN REUSE / REPLAY -> Revoke ENTIRE family & commit!
      if (session.replacedBySessionId !== null) {
        const revoked = await tx.mobileSession.updateMany({
          where: {
            familyId: session.familyId,
            organisationId: session.organisationId,
            revokedAt: null,
          },
          data: {
            revokedAt: now,
            revocationReason: 'REFRESH_TOKEN_REUSE_DETECTED',
          },
        });

        await auditService.recordAuditEvent(tx, {
          organisationId: session.organisationId,
          actorUserId: session.userId,
          action: auditService.AUDIT_ACTIONS.MOBILE_SESSION_REUSE_DETECTED,
          entityType: 'MobileSession',
          entityId: session.id,
          metadata: {
            mobileDeviceId: session.mobileDeviceId,
            familyId: session.familyId,
            revokedSessionCount: revoked.count,
          },
        });

        return {
          ok: false,
          code: 'REFRESH_TOKEN_REUSE_DETECTED',
          message:
            'Unauthorized: Refresh token reuse detected; session family revoked. Please sign in again.',
        };
      }

      // 2. Account security checks (deactivation, role change, or sessionVersion bump)
      if (
        !user ||
        !user.isActive ||
        user.role !== 'OWNER' ||
        user.organisationId !== session.organisationId ||
        user.sessionVersion !== session.sessionVersion
      ) {
        await tx.mobileSession.updateMany({
          where: {
            familyId: session.familyId,
            organisationId: session.organisationId,
            revokedAt: null,
          },
          data: {
            revokedAt: now,
            revocationReason: 'ACCOUNT_SESSION_INVALIDATED',
          },
        });

        return {
          ok: false,
          code: 'INVALID_REFRESH_TOKEN',
          message: 'Unauthorized: Session is no longer valid.',
        };
      }

      // 3. Device active status & explicit deviceInstallId binding
      if (
        !mobileDevice ||
        mobileDevice.organisationId !== session.organisationId ||
        mobileDevice.userId !== session.userId ||
        mobileDevice.revokedAt !== null
      ) {
        return {
          ok: false,
          code: 'DEVICE_REVOKED',
          message: 'Unauthorized: Mobile device has been revoked.',
        };
      }

      if (mobileDevice.deviceInstallId !== input.deviceInstallId) {
        return {
          ok: false,
          code: 'INVALID_REFRESH_TOKEN',
          message: 'Unauthorized: Refresh token is invalid or expired.',
        };
      }

      // 4. Session revocation & 30-day hard maximum lifetime cap check
      const remainingAccessTtl = computeCappedAccessTtlSeconds(
        now,
        session.familyExpiresAt
      );
      if (
        session.revokedAt !== null ||
        session.expiresAt <= now ||
        session.familyExpiresAt <= now ||
        remainingAccessTtl < 1
      ) {
        return {
          ok: false,
          code: 'SESSION_EXPIRED',
          message: 'Unauthorized: Mobile session has expired. Please sign in again.',
        };
      }

      // 5. Atomic single-use rotation inheriting immutable 30-day familyExpiresAt
      const nextSession = await tx.mobileSession.create({
        data: {
          organisationId: session.organisationId,
          userId: session.userId,
          mobileDeviceId: mobileDevice.id,
          familyId: session.familyId,
          sessionVersion: user.sessionVersion,
          refreshTokenHash: nextRefresh.tokenHash,
          familyExpiresAt: session.familyExpiresAt,
          expiresAt: session.familyExpiresAt,
          lastUsedAt: now,
          createdAt: now,
        },
      });

      await tx.mobileSession.update({
        where: { id: session.id },
        data: {
          replacedBySessionId: nextSession.id,
          revokedAt: now,
          revocationReason: 'ROTATED',
          lastUsedAt: now,
        },
      });

      const updatedDevice = await tx.mobileDevice.update({
        where: { id: mobileDevice.id },
        data: { lastSeenAt: now },
      });

      const access = createMobileAccessToken({
        userId: user.id,
        organisationId: user.organisationId,
        sessionVersion: user.sessionVersion,
        mobileDeviceId: updatedDevice.id,
        mobileSessionId: nextSession.id,
        nowSeconds: Math.floor(now.getTime() / 1000),
        ttlSeconds: remainingAccessTtl,
      });

      return {
        ok: true,
        response: {
          accessToken: access.token,
          accessTokenExpiresAt: access.expiresAt.toISOString(),
          refreshToken: nextRefresh.rawToken,
          refreshTokenExpiresAt: session.familyExpiresAt.toISOString(),
          tokenType: 'Bearer',
          device: serializeMobileDevice({
            ...updatedDevice,
            _count: { sessions: 1 },
          }),
          user: {
            id: user.id,
            email: user.email,
            firstName: user.firstName,
            lastName: user.lastName,
            role: user.role,
            organisationId: user.organisationId,
            organisationName: user.organisation.name,
            timezone: user.preferences?.timezone ?? 'Africa/Accra',
          },
        },
      };
    },
    { maxWait: 15_000, timeout: 25_000 }
  );

  if (!outcome.ok) {
    throw new MobileAuthError(outcome.code, 401, outcome.message);
  }

  return outcome.response;
}

/**
 * Logs out the current mobile session family and clears that device's push token
 * so a signed-out phone immediately stops receiving private notifications.
 */
export async function logoutMobileSession(
  actor: MobileLogoutActor,
  options: { now?: Date } = {}
): Promise<{ revokedSessions: number }> {
  const now = options.now ?? new Date();

  return prisma.$transaction(
    async (tx) => {
      await tx.$queryRaw`
        SELECT id FROM mobile_devices
         WHERE id = ${actor.deviceId}
           AND organisation_id = ${actor.organisationId}
         FOR UPDATE
      `;

      await tx.$queryRaw`
        SELECT id FROM mobile_sessions
         WHERE family_id = ${actor.familyId}
           AND organisation_id = ${actor.organisationId}
         ORDER BY id ASC
         FOR UPDATE
      `;

      const revoked = await tx.mobileSession.updateMany({
        where: {
          familyId: actor.familyId,
          organisationId: actor.organisationId,
          userId: actor.userId,
          revokedAt: null,
        },
        data: {
          revokedAt: now,
          revocationReason: 'USER_LOGOUT',
        },
      });

      await tx.mobileDevice.updateMany({
        where: {
          id: actor.deviceId,
          organisationId: actor.organisationId,
          userId: actor.userId,
        },
        data: {
          expoPushToken: null,
          lastSeenAt: now,
        },
      });

      await auditService.recordAuditEvent(tx, {
        organisationId: actor.organisationId,
        actorUserId: actor.userId,
        action: auditService.AUDIT_ACTIONS.MOBILE_LOGOUT,
        entityType: 'MobileDevice',
        entityId: actor.deviceId,
        metadata: {
          familyId: actor.familyId,
          revokedSessionCount: revoked.count,
        },
      });

      return { revokedSessions: revoked.count };
    },
    { maxWait: 15_000, timeout: 25_000 }
  );
}

/**
 * Lists all mobile devices registered to the authenticated owner in their organisation.
 * Never exposes client `deviceInstallId` or plaintext push/refresh tokens.
 */
export async function listMobileDevices(
  actor: MobileActor,
  now: Date = new Date()
): Promise<MobileDeviceSummary[]> {
  const devices = await prisma.mobileDevice.findMany({
    where: {
      organisationId: actor.organisationId,
      userId: actor.userId,
    },
    orderBy: [{ revokedAt: 'asc' }, { lastSeenAt: 'desc' }, { createdAt: 'desc' }],
    include: {
      _count: {
        select: {
          sessions: {
            where: {
              revokedAt: null,
              replacedBySessionId: null,
              expiresAt: { gt: now },
            },
          },
        },
      },
    },
  });

  return devices.map(serializeMobileDevice);
}

/**
 * Independently revokes a single mobile device, immediately invalidating all of
 * its active access and refresh sessions and clearing its push token.
 * Does not reveal whether a device ID exists in another organisation or user account.
 */
export async function revokeMobileDevice(
  actor: MobileActor,
  deviceId: string,
  input: RevokeMobileDeviceInput = {},
  options: { now?: Date } = {}
): Promise<MobileDeviceSummary> {
  const now = options.now ?? new Date();

  const updated = await prisma.$transaction(
    async (tx) => {
      await tx.$queryRaw`
        SELECT id FROM mobile_devices
         WHERE id = ${deviceId}
           AND organisation_id = ${actor.organisationId}
         FOR UPDATE
      `;

      const existing = await tx.mobileDevice.findFirst({
        where: {
          id: deviceId,
          organisationId: actor.organisationId,
          userId: actor.userId,
        },
      });

      if (!existing) {
        return null;
      }

      await tx.$queryRaw`
        SELECT id FROM mobile_sessions
         WHERE mobile_device_id = ${existing.id}
           AND organisation_id = ${actor.organisationId}
           AND revoked_at IS NULL
         ORDER BY id ASC
         FOR UPDATE
      `;

      const revokedSessions = await tx.mobileSession.updateMany({
        where: {
          mobileDeviceId: existing.id,
          organisationId: actor.organisationId,
          revokedAt: null,
        },
        data: {
          revokedAt: now,
          revocationReason: 'DEVICE_REVOKED',
        },
      });

      const device = await tx.mobileDevice.update({
        where: { id: existing.id },
        data: {
          revokedAt: existing.revokedAt ?? now,
          revokedByUserId: existing.revokedByUserId ?? actor.userId,
          revocationReason:
            input.reason ?? existing.revocationReason ?? 'Revoked by workspace owner.',
          expoPushToken: null,
          pushEnabled: false,
        },
      });

      await auditService.recordAuditEvent(tx, {
        organisationId: actor.organisationId,
        actorUserId: actor.userId,
        action: auditService.AUDIT_ACTIONS.MOBILE_DEVICE_REVOKED,
        entityType: 'MobileDevice',
        entityId: device.id,
        metadata: {
          platform: device.platform,
          revokedSessionCount: revokedSessions.count,
          alreadyRevoked: existing.revokedAt !== null,
        },
      });

      return {
        ...device,
        _count: { sessions: 0 },
      };
    },
    { maxWait: 15_000, timeout: 25_000 }
  );

  if (!updated) {
    throw new MobileAuthError(
      'MOBILE_DEVICE_NOT_FOUND',
      404,
      'Mobile device not found.'
    );
  }

  return serializeMobileDevice(updated);
}

/**
 * Loads owner mobile push notification preferences (defaulting to enabled when
 * no UserPreference row exists yet).
 */
export async function getOwnerNotificationPreferences(
  userId: string
): Promise<NotificationPreferencesDto> {
  const row = await prisma.userPreference.findUnique({
    where: { userId },
    select: {
      pushNotificationsEnabled: true,
      pushBirthdayReminders: true,
      pushDesignUpdates: true,
    },
  });

  if (!row) {
    return {
      pushNotificationsEnabled: true,
      pushBirthdayReminders: true,
      pushDesignUpdates: true,
    };
  }

  return {
    pushNotificationsEnabled: row.pushNotificationsEnabled,
    pushBirthdayReminders: row.pushBirthdayReminders,
    pushDesignUpdates: row.pushDesignUpdates,
  };
}

/**
 * Updates owner push notification preference toggles transactionally with audit logging.
 */
export async function updateOwnerNotificationPreferences(
  actor: MobileActor,
  input: NotificationPreferencesUpdateInput
): Promise<NotificationPreferencesDto> {
  return prisma.$transaction(
    async (tx) => {
      const updated = await tx.userPreference.upsert({
        where: { userId: actor.userId },
        create: {
          userId: actor.userId,
          pushNotificationsEnabled: input.pushNotificationsEnabled,
          pushBirthdayReminders: input.pushBirthdayReminders,
          pushDesignUpdates: input.pushDesignUpdates,
        },
        update: {
          pushNotificationsEnabled: input.pushNotificationsEnabled,
          pushBirthdayReminders: input.pushBirthdayReminders,
          pushDesignUpdates: input.pushDesignUpdates,
        },
        select: {
          id: true,
          pushNotificationsEnabled: true,
          pushBirthdayReminders: true,
          pushDesignUpdates: true,
        },
      });

      await auditService.recordAuditEvent(tx, {
        organisationId: actor.organisationId,
        actorUserId: actor.userId,
        action: auditService.AUDIT_ACTIONS.NOTIFICATION_PREFERENCES_UPDATED,
        entityType: 'UserPreference',
        entityId: updated.id,
        metadata: {
          pushNotificationsEnabled: updated.pushNotificationsEnabled,
          pushBirthdayReminders: updated.pushBirthdayReminders,
          pushDesignUpdates: updated.pushDesignUpdates,
        },
      });

      return {
        pushNotificationsEnabled: updated.pushNotificationsEnabled,
        pushBirthdayReminders: updated.pushBirthdayReminders,
        pushDesignUpdates: updated.pushDesignUpdates,
      };
    },
    { maxWait: 15_000, timeout: 25_000 }
  );
}
