import { NextResponse } from 'next/server';
import { clearSessionCookie } from '@/lib/auth/session';

export async function POST() {
  await clearSessionCookie();
  return NextResponse.json({ success: true, message: 'Logged out successfully' });
}

export async function GET(request: Request) {
  await clearSessionCookie();
  return NextResponse.redirect(new URL('/login', request.url));
}
