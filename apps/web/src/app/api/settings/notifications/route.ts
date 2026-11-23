import { NextResponse } from 'next/server';
import { notificationPreferencesUpdateSchema } from '@crelune/shared';
import {
  parseJsonBodyWithLimit,
  requireAuthenticatedOwnerApi,
} from '@/lib/auth/api-owner-guard';
import {
  getOwnerNotificationPreferences,
  updateOwnerNotificationPreferences,
} from '@/lib/auth/mobile-auth-service';

const NO_STORE_HEADERS = { 'Cache-Control': 'private, no-store' } as const;

export async function GET(request: Request) {
  const auth = await requireAuthenticatedOwnerApi(request);
  if (!auth.ok) {
    return auth.response;
  }

  try {
    const preferences = await getOwnerNotificationPreferences(
      auth.owner.profile.id
    );
    return NextResponse.json(
      { preferences },
      { status: 200, headers: NO_STORE_HEADERS }
    );
  } catch (err) {
    console.error(
      'GET /api/settings/notifications error:',
      err instanceof Error ? err.name : 'UnknownError'
    );
    return NextResponse.json(
      { error: 'Failed to load notification preferences.' },
      { status: 500, headers: NO_STORE_HEADERS }
    );
  }
}

export async function PATCH(request: Request) {
  const auth = await requireAuthenticatedOwnerApi(request, { verifyCsrf: true });
  if (!auth.ok) {
    return auth.response;
  }

  const bodyResult = await parseJsonBodyWithLimit(request, 4096);
  if (!bodyResult.ok) {
    return bodyResult.response;
  }

  const parsed = notificationPreferencesUpdateSchema.safeParse(bodyResult.data);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: 'Invalid notification preferences payload.',
        code: 'VALIDATION_ERROR',
      },
      { status: 400, headers: NO_STORE_HEADERS }
    );
  }

  try {
    const preferences = await updateOwnerNotificationPreferences(
      {
        userId: auth.owner.profile.id,
        organisationId: auth.owner.profile.organisationId,
      },
      parsed.data
    );
    return NextResponse.json(
      { preferences },
      { status: 200, headers: NO_STORE_HEADERS }
    );
  } catch (err) {
    console.error(
      'PATCH /api/settings/notifications error:',
      err instanceof Error ? err.name : 'UnknownError'
    );
    return NextResponse.json(
      { error: 'Failed to save notification preferences.' },
      { status: 500, headers: NO_STORE_HEADERS }
    );
  }
}
