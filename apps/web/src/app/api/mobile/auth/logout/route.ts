import { NextResponse } from 'next/server';
import { requireAuthenticatedOwnerApi } from '@/lib/auth/api-owner-guard';
import { logoutMobileSession } from '@/lib/auth/mobile-auth-service';

const NO_STORE_HEADERS = { 'Cache-Control': 'private, no-store' } as const;

export async function POST(request: Request) {
  const auth = await requireAuthenticatedOwnerApi(request, {
    allowedAuthMethods: ['mobile_bearer'],
  });
  if (!auth.ok) {
    return auth.response;
  }

  const mobile = auth.owner.mobileContext;
  if (!mobile) {
    return NextResponse.json(
      { error: 'Unauthorized: Mobile session context required.' },
      { status: 401, headers: NO_STORE_HEADERS }
    );
  }

  try {
    const result = await logoutMobileSession({
      userId: auth.owner.profile.id,
      organisationId: auth.owner.profile.organisationId,
      deviceId: mobile.deviceId,
      sessionId: mobile.sessionId,
      familyId: mobile.familyId,
    });

    return NextResponse.json(
      {
        success: true,
        revokedSessions: result.revokedSessions,
      },
      { status: 200, headers: NO_STORE_HEADERS }
    );
  } catch (err) {
    console.error(
      'Mobile logout error:',
      err instanceof Error ? err.name : 'UnknownError'
    );
    return NextResponse.json(
      { error: 'An unexpected error occurred while signing out.' },
      { status: 500, headers: NO_STORE_HEADERS }
    );
  }
}
