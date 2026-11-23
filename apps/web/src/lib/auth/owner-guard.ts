/**
 * CRELUNE — Server-Side Active Owner Verification & Revocation Guard
 *
 * Enforces real-time database account status (`isActive === true`), `role === 'OWNER'`,
 * organisation match, and `sessionVersion` parity on every protected server render and API route.
 *
 * Never relies exclusively on stateless cookie verification for account status.
 */

import { prisma } from '@crelune/database';
import type {
  MobileAccessTokenPayload,
  OwnerSession,
  OwnerProfile,
} from '@crelune/shared';
import { getSession } from './session';

export type OwnerAuthMethod = 'cookie' | 'mobile_bearer';

export interface MobileAuthContext {
  deviceId: string;
  sessionId: string;
  familyId: string;
}

export interface AuthenticatedOwner {
  session: OwnerSession;
  profile: OwnerProfile;
  authMethod?: OwnerAuthMethod;
  mobileContext?: MobileAuthContext;
  preferences: {
    theme: string;
    dateFormat: string;
    timezone: string;
    leadTimeDaysBirthday: number;
    leadTimeDaysEvent: number;
    defaultExportFormat: string;
    pushNotificationsEnabled?: boolean;
    pushBirthdayReminders?: boolean;
    pushDesignUpdates?: boolean;
  } | null;
}

export type OwnerAuthState =
  | { status: 'authenticated'; owner: AuthenticatedOwner }
  | { status: 'unauthenticated'; owner: null }
  | { status: 'revoked'; owner: null };

/**
 * Resolves the authoritative server-side owner state from the database.
 * Rejects deactivated accounts (`isActive === false`), mismatched roles/orgs,
 * and stale `sessionVersion` tokens.
 */
export async function resolveAuthenticatedOwner(): Promise<OwnerAuthState> {
  const session = await getSession();
  if (!session) {
    return { status: 'unauthenticated', owner: null };
  }

  return verifyActiveOwnerInDatabase(session);
}

/**
 * Pure database verification helper for unit/integration testing and shared enforcement.
 */
export async function verifyActiveOwnerInDatabase(
  session: OwnerSession
): Promise<OwnerAuthState> {
  const user = await prisma.user.findUnique({
    where: { id: session.sub },
    include: {
      organisation: true,
      preferences: true,
    },
  });

  if (
    !user ||
    !user.isActive ||
    user.role !== 'OWNER' ||
    user.organisationId !== session.org ||
    user.sessionVersion !== session.ver
  ) {
    return { status: 'revoked', owner: null };
  }

  return {
    status: 'authenticated',
    owner: {
      session,
      authMethod: 'cookie',
      profile: {
        id: user.id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        role: user.role,
        organisationId: user.organisationId,
        organisationName: user.organisation?.name || 'CRELUNE Operations',
        timezone: user.preferences?.timezone || 'Africa/Accra',
      },
      preferences: user.preferences
        ? {
            theme: user.preferences.theme,
            dateFormat: user.preferences.dateFormat,
            timezone: user.preferences.timezone,
            leadTimeDaysBirthday: user.preferences.leadTimeDaysBirthday,
            leadTimeDaysEvent: user.preferences.leadTimeDaysEvent,
            defaultExportFormat: user.preferences.defaultExportFormat,
            pushNotificationsEnabled: user.preferences.pushNotificationsEnabled,
            pushBirthdayReminders: user.preferences.pushBirthdayReminders,
            pushDesignUpdates: user.preferences.pushDesignUpdates,
          }
        : null,
    },
  };
}

/**
 * Authoritative PostgreSQL verification for a signed Mobile Bearer access token.
 * Enforces active owner status, sessionVersion parity, unrevoked MobileDevice binding,
 * and active unrotated/unexpired MobileSession binding (including the 30-day family cap).
 */
export async function verifyActiveMobileOwnerInDatabase(
  mobileToken: MobileAccessTokenPayload,
  now: Date = new Date()
): Promise<OwnerAuthState> {
  const mobileSession = await prisma.mobileSession.findUnique({
    where: { id: mobileToken.sid },
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

  if (!mobileSession) {
    return { status: 'revoked', owner: null };
  }

  const { mobileDevice, user } = mobileSession;

  if (
    mobileSession.revokedAt !== null ||
    mobileSession.replacedBySessionId !== null ||
    mobileSession.expiresAt <= now ||
    mobileSession.familyExpiresAt <= now ||
    mobileSession.organisationId !== mobileToken.org ||
    mobileSession.userId !== mobileToken.sub ||
    mobileSession.mobileDeviceId !== mobileToken.dev ||
    mobileSession.sessionVersion !== mobileToken.ver ||
    !mobileDevice ||
    mobileDevice.revokedAt !== null ||
    mobileDevice.organisationId !== mobileToken.org ||
    mobileDevice.userId !== mobileToken.sub ||
    !user ||
    !user.isActive ||
    user.role !== 'OWNER' ||
    user.organisationId !== mobileToken.org ||
    user.sessionVersion !== mobileToken.ver
  ) {
    return { status: 'revoked', owner: null };
  }

  return {
    status: 'authenticated',
    owner: {
      session: {
        sub: mobileToken.sub,
        role: mobileToken.role,
        org: mobileToken.org,
        ver: mobileToken.ver,
        iat: mobileToken.iat,
        exp: mobileToken.exp,
      },
      authMethod: 'mobile_bearer',
      mobileContext: {
        deviceId: mobileDevice.id,
        sessionId: mobileSession.id,
        familyId: mobileSession.familyId,
      },
      profile: {
        id: user.id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        role: user.role,
        organisationId: user.organisationId,
        organisationName: user.organisation?.name || 'CRELUNE Operations',
        timezone: user.preferences?.timezone || 'Africa/Accra',
      },
      preferences: user.preferences
        ? {
            theme: user.preferences.theme,
            dateFormat: user.preferences.dateFormat,
            timezone: user.preferences.timezone,
            leadTimeDaysBirthday: user.preferences.leadTimeDaysBirthday,
            leadTimeDaysEvent: user.preferences.leadTimeDaysEvent,
            defaultExportFormat: user.preferences.defaultExportFormat,
            pushNotificationsEnabled: user.preferences.pushNotificationsEnabled,
            pushBirthdayReminders: user.preferences.pushBirthdayReminders,
            pushDesignUpdates: user.preferences.pushDesignUpdates,
          }
        : null,
    },
  };
}
