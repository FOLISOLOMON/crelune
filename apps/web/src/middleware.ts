import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { isValidCallbackUrl } from '@crelune/shared';
import {
  extractBearerTokenEdge,
  SESSION_COOKIE_NAME,
  verifyMobileAccessTokenEdge,
  verifySessionTokenEdge,
} from './lib/auth/edge-session';

const CONFIGURATION_ERROR_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>CRELUNE — Configuration Required</title>
  <style>
    body { font-family: system-ui, -apple-system, sans-serif; background: #F8F7FA; color: #24212B; margin: 0; display: flex; align-items: center; justify-content: center; min-height: 100vh; padding: 1.5rem; }
    .card { max-width: 28rem; background: #FFFFFF; border: 1px solid #E8E5ED; border-radius: 1rem; padding: 2rem; box-shadow: 0 4px 12px rgba(36,33,43,0.06); }
    .badge { display: inline-block; font-size: 0.75rem; font-weight: 600; color: #991B1B; background: #FEF2F2; border: 1px solid #FECACA; padding: 0.25rem 0.625rem; border-radius: 9999px; margin-bottom: 1rem; }
    h1 { font-size: 1.125rem; margin: 0 0 0.5rem 0; }
    p { font-size: 0.875rem; color: #77727F; line-height: 1.5; margin: 0; }
  </style>
</head>
<body>
  <main class="card" role="alert">
    <span class="badge">503 Service Unavailable</span>
    <h1>Authentication Configuration Error</h1>
    <p>CRELUNE cannot start secure owner sessions because the server cryptographic session secret is missing or invalid. Please verify environment configuration and restart the server.</p>
  </main>
</body>
</html>`;

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

  // 2. Deliberate public liveness health endpoint (GET only; returns minimal ok without diagnostics when unauthenticated)
  if (pathname === '/api/health' && request.method === 'GET') {
    return NextResponse.next();
  }

  // 3. Cryptographic configuration check (Fail closed with zero redirect loop)
  const secretKey = process.env.SESSION_SECRET;
  if (!secretKey || secretKey.length < 32) {
    if (pathname.startsWith('/api/')) {
      return NextResponse.json(
        { error: 'Service Unavailable: Missing or invalid cryptographic configuration' },
        {
          status: 503,
          headers: { 'Cache-Control': 'no-store' },
        }
      );
    }

    return new NextResponse(CONFIGURATION_ERROR_HTML, {
      status: 503,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
      },
    });
  }

  // 4. Verify web cookie session and mobile Bearer access token strictly at Edge
  const sessionCookie = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  const cookiePresent = Boolean(sessionCookie && sessionCookie.length > 0);
  const bearer = extractBearerTokenEdge(request.headers.get('authorization'));
  const session = cookiePresent
    ? await verifySessionTokenEdge(sessionCookie, secretKey)
    : null;

  // 5. Exact public & machine-authenticated route matching with strict method validation
  const isAgentMachineRoute =
    (pathname === '/api/agent/heartbeat' && request.method === 'POST') ||
    (pathname === '/api/agent/jobs/claim' && request.method === 'POST') ||
    (request.method === 'POST' &&
      /^\/api\/agent\/dispatches\/[a-zA-Z0-9_-]{1,80}\/status$/.test(pathname)) ||
    (request.method === 'POST' &&
      /^\/api\/agent\/dispatches\/[a-zA-Z0-9_-]{1,80}\/lease$/.test(pathname)) ||
    (request.method === 'GET' &&
      /^\/api\/agent\/dispatches\/[a-zA-Z0-9_-]{1,80}\/template$/.test(pathname)) ||
    (request.method === 'GET' &&
      /^\/api\/agent\/dispatches\/[a-zA-Z0-9_-]{1,80}\/assets\/[a-zA-Z0-9_-]{1,80}$/.test(
        pathname
      )) ||
    (request.method === 'POST' &&
      /^\/api\/agent\/dispatches\/[a-zA-Z0-9_-]{1,80}\/exports\/upload-intents$/.test(
        pathname
      )) ||
    (request.method === 'POST' &&
      /^\/api\/agent\/dispatches\/[a-zA-Z0-9_-]{1,80}\/exports$/.test(pathname));

  const isMobilePublicAuthRoute =
    (pathname === '/api/mobile/auth/login' && request.method === 'POST') ||
    (pathname === '/api/mobile/auth/refresh' && request.method === 'POST');

  const isPublicRoute =
    pathname === '/login' ||
    (pathname === '/api/auth/login' && request.method === 'POST') ||
    (pathname === '/api/auth/logout' && request.method === 'POST') ||
    (pathname === '/api/cron/birthday-reminders' && request.method === 'POST') ||
    isAgentMachineRoute ||
    isMobilePublicAuthRoute;

  // 6. If already authenticated with valid web cookie and accessing login, redirect to dashboard
  if (pathname === '/login') {
    if (session) {
      return NextResponse.redirect(new URL('/', request.url));
    }
    return NextResponse.next();
  }

  // 7. Whitelisted public / machine-authenticated endpoints
  if (isPublicRoute) {
    return NextResponse.next();
  }

  // 8. Protect all other routes:
  //    - Web HTML routes accept ONLY verified web session cookies (never Mobile Bearer tokens).
  //    - Protected owner API routes accept EITHER a verified web cookie OR a verified Mobile
  //      Bearer access token (never both simultaneously, and never via query parameters).
  if (pathname.startsWith('/api/')) {
    if (cookiePresent && bearer.present) {
      return NextResponse.json(
        {
          error:
            'Bad Request: Ambiguous authentication credentials; send either a session cookie or a Bearer token, not both.',
          code: 'AMBIGUOUS_AUTH_CREDENTIALS',
        },
        { status: 400, headers: { 'Cache-Control': 'no-store' } }
      );
    }

    const isMobileLogoutRoute =
      pathname === '/api/mobile/auth/logout' && request.method === 'POST';

    if (bearer.present) {
      const mobileSession =
        !bearer.malformed && bearer.token
          ? await verifyMobileAccessTokenEdge(bearer.token, secretKey)
          : null;
      if (!mobileSession) {
        return NextResponse.json(
          { error: 'Unauthorized: Invalid or expired mobile access token' },
          { status: 401, headers: { 'Cache-Control': 'no-store' } }
        );
      }
      return NextResponse.next();
    }

    if (isMobileLogoutRoute) {
      return NextResponse.json(
        { error: 'Unauthorized: Mobile Bearer authentication required' },
        { status: 401, headers: { 'Cache-Control': 'no-store' } }
      );
    }

    if (!session) {
      return NextResponse.json(
        { error: 'Unauthorized: Owner authentication required' },
        { status: 401 }
      );
    }

    return NextResponse.next();
  }

  if (!session) {
    const loginUrl = new URL('/login', request.url);
    if (isValidCallbackUrl(pathname)) {
      loginUrl.searchParams.set('callbackUrl', pathname);
    }
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
