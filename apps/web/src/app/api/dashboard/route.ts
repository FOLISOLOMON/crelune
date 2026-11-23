import { NextResponse } from 'next/server';
import { requireAuthenticatedOwnerApi } from '@/lib/auth/api-owner-guard';
import { getDashboardSnapshot } from '@/lib/dashboard/dashboard-service';

const NO_STORE_HEADERS = { 'Cache-Control': 'private, no-store' } as const;

export async function GET(request: Request) {
  const auth = await requireAuthenticatedOwnerApi(request);
  if (!auth.ok) {
    return auth.response;
  }

  try {
    const snapshot = await getDashboardSnapshot(
      auth.owner.profile.organisationId,
      auth.owner.profile.id
    );
    return NextResponse.json(snapshot, {
      status: 200,
      headers: NO_STORE_HEADERS,
    });
  } catch (err) {
    console.error(
      'GET /api/dashboard error:',
      err instanceof Error ? err.name : 'UnknownError'
    );
    return NextResponse.json(
      { error: 'Failed to load dashboard overview.' },
      { status: 500, headers: NO_STORE_HEADERS }
    );
  }
}
