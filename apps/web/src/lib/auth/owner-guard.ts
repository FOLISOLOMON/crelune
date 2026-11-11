/**
 * CRELUNE — Server-Side Active Owner Verification & Revocation Guard
 *
 * Enforces real-time database account status (`isActive === true`), `role === 'OWNER'`,
 * organisation match, and `sessionVersion` parity on every protected server render and API route.
 *
 * Never relies exclusively on stateless cookie verification for account status.
 */

import { prisma } from '@crelune/database';
import type { OwnerSession, OwnerProfile } from '@crelune/shared';
import { getSession } from './session';

export interface AuthenticatedOwner {
  session: OwnerSession;
  profile: OwnerProfile;
  preferences: {
    theme: string;
    dateFormat: string;
    timezone: string;
    leadTimeDaysBirthday: number;
    leadTimeDaysEvent: number;
    defaultExportFormat: string;
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
          }
        : null,
    },
  };
}
