import { NextResponse } from 'next/server';
import { clearSessionCookie } from '@/lib/auth/session';
import { validateRequestOrigin } from '@/lib/auth/csrf';

export async function POST(request: Request) {
  const originCheck = validateRequestOrigin(request);
  if (!originCheck.allowed) {
    return NextResponse.json(
      { error: 'Forbidden: Cross-site request rejected' },
      { status: 403 }
    );
  }

  await clearSessionCookie();
  return NextResponse.json({ success: true, message: 'Logged out successfully' });
}
