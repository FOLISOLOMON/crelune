import { NextResponse } from 'next/server';
import { requireAuthenticatedOwnerApi } from '@/lib/auth/api-owner-guard';
import { listMobileDevices } from '@/lib/auth/mobile-auth-service';

const NO_STORE_HEADERS = { 'Cache-Control': 'private, no-store' } as const;

export async function GET(request: Request) {
  const auth = await requireAuthenticatedOwnerApi(request);
  if (!auth.ok) {
    return auth.response;
  }

  try {
    const devices = await listMobileDevices({
      userId: auth.owner.profile.id,
      organisationId: auth.owner.profile.organisationId,
    });

    return NextResponse.json(
      {
        devices,
        currentDeviceId: auth.owner.mobileContext?.deviceId ?? null,
      },
      { status: 200, headers: NO_STORE_HEADERS }
    );
  } catch (err) {
    console.error(
      'GET /api/mobile/devices error:',
      err instanceof Error ? err.name : 'UnknownError'
    );
    return NextResponse.json(
      { error: 'Failed to load connected mobile devices.' },
      { status: 500, headers: NO_STORE_HEADERS }
    );
  }
}
