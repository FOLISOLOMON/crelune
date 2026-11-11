import { NextResponse } from 'next/server';
import { clearSessionCookie } from '@/lib/auth/session';
import { resolveAuthenticatedOwner } from '@/lib/auth/owner-guard';

export async function GET() {
  const auth = await resolveAuthenticatedOwner();

  if (auth.status === 'revoked') {
    await clearSessionCookie();
    return NextResponse.json({ error: 'Unauthorized: Session inactive or revoked' }, { status: 401 });
  }

  if (auth.status !== 'authenticated') {
    return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
  }

  const { profile } = auth.owner;

  return NextResponse.json({
    authenticated: true,
    user: {
      userId: profile.id,
      email: profile.email,
      firstName: profile.firstName,
      lastName: profile.lastName,
      role: profile.role,
      organisationId: profile.organisationId,
      organisationName: profile.organisationName,
    },
  });
}
