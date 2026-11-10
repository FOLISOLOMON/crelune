import { NextResponse } from 'next/server';
import { clearSessionCookie } from '@/lib/auth/session';
import { isAllowedOrigin } from '@/lib/auth/csrf';

export async function POST(request: Request) {
  const host = request.headers.get('host');
  const origin = request.headers.get('origin');
  const referer = request.headers.get('referer');

  // Verify Origin / Referer matches Host header for CSRF mitigation
  if (process.env.NODE_ENV !== 'test') {
    if (!isAllowedOrigin(origin, referer, host)) {
      return NextResponse.json(
        { error: 'Forbidden: Cross-site request rejected' },
        { status: 403 }
      );
    }
  }

  await clearSessionCookie();
  return NextResponse.json({ success: true, message: 'Logged out successfully' });
}
