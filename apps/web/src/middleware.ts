import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { verifySessionTokenEdge, SESSION_COOKIE_NAME } from './lib/auth/edge-session';

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // 1. Strict whitelist for Next.js internal static assets
  if (
    pathname.startsWith('/_next/static') ||
    pathname.startsWith('/_next/image') ||
    pathname === '/favicon.ico'
  ) {
    return NextResponse.next();
  }

  // 2. Cryptographic configuration check (Fail closed)
  const secretKey = process.env.SESSION_SECRET;
  if (!secretKey || secretKey.length < 32) {
    if (pathname.startsWith('/api/')) {
      return NextResponse.json(
        { error: 'Service Unavailable: Missing cryptographic configuration' },
        { status: 503 }
      );
    }
    // For web pages, redirect to login with configuration alert
    return NextResponse.redirect(new URL('/login?error=server_configuration', request.url));
  }

  // 3. Verify session token using Web Crypto
  const sessionCookie = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  const session = await verifySessionTokenEdge(sessionCookie, secretKey);

  // 4. Exact public route matching with method validation
  const isPublicRoute =
    pathname === '/login' ||
    (pathname === '/api/auth/login' && request.method === 'POST') ||
    (pathname === '/api/auth/logout' && request.method === 'POST') ||
    (pathname === '/api/health' && request.method === 'GET');

  // 5. If already authenticated and accessing login, redirect to dashboard
  if (pathname === '/login') {
    if (session) {
      return NextResponse.redirect(new URL('/', request.url));
    }
    return NextResponse.next();
  }

  // 6. Whitelisted public endpoints
  if (isPublicRoute) {
    return NextResponse.next();
  }

  // 7. Protect all other routes (including dotted private API endpoints like /api/export.json)
  if (!session) {
    if (pathname.startsWith('/api/')) {
      return NextResponse.json(
        { error: 'Unauthorized: Owner authentication required' },
        { status: 401 }
      );
    }

    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('callbackUrl', pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
