import { NextResponse } from 'next/server';
import { requireAuthenticatedOwnerApi } from '@/lib/auth/api-owner-guard';

export async function GET(request: Request) {
  const auth = await requireAuthenticatedOwnerApi(request);
  if (!auth.ok) {
    return auth.response;
  }

  const { profile } = auth.owner;
  return NextResponse.json(
    {
      authenticated: true,
      authMethod: auth.owner.authMethod ?? 'cookie',
      ...(auth.owner.mobileContext
        ? { deviceId: auth.owner.mobileContext.deviceId }
        : {}),
      user: {
        userId: profile.id,
        email: profile.email,
        firstName: profile.firstName,
        lastName: profile.lastName,
        role: profile.role,
        organisationId: profile.organisationId,
        organisationName: profile.organisationName,
      },
    },
    { headers: { 'Cache-Control': 'private, no-store' } }
  );
}
