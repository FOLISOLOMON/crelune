import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { middleware } from './middleware';
import { createMobileAccessToken } from './lib/auth/mobile-token';
import { createSessionToken } from './lib/auth/session';

describe('Middleware Route Protection & Edge Security (Milestone 2.1 & 2.1.1)', () => {
  const TEST_SECRET = 'a'.repeat(32);
  const originalSecret = process.env.SESSION_SECRET;

  const mockUser = {
    id: 'usr_cln_123',
    organisationId: 'org_cln_123',
    sessionVersion: 1,
  };

  beforeEach(() => {
    process.env.SESSION_SECRET = TEST_SECRET;
  });

  afterEach(() => {
    process.env.SESSION_SECRET = originalSecret;
  });

  function createMockRequest(
    path: string,
    options: { method?: string; cookie?: string; headers?: Record<string, string> } = {}
  ) {
    const url = `http://localhost:3000${path}`;
    const headers = new Headers(options.headers || {});
    if (options.cookie) {
      headers.set('cookie', `crelune_session=${options.cookie}`);
    }
    return new NextRequest(url, {
      method: options.method || 'GET',
      headers,
    });
  }

  describe('Static Assets & Next.js Internals Whitelist', () => {
    it('allows /_next/static without authentication', async () => {
      const req = createMockRequest('/_next/static/chunks/main.js');
      const res = await middleware(req);
      expect(res.status).toBe(200);
      expect(res.headers.get('location')).toBeNull();
    });

    it('allows /_next/image without authentication', async () => {
      const req = createMockRequest('/_next/image?url=%2Flogo.png&w=128&q=75');
      const res = await middleware(req);
      expect(res.status).toBe(200);
    });

    it('allows /favicon.ico without authentication', async () => {
      const req = createMockRequest('/favicon.ico');
      const res = await middleware(req);
      expect(res.status).toBe(200);
    });
  });

  describe('Dotted Private Path Interception (Elimination of pathname.includes(".") bypass)', () => {
    it('intercepts /api/export.json and returns 401 when unauthenticated', async () => {
      const req = createMockRequest('/api/export.json');
      const res = await middleware(req);
      expect(res.status).toBe(401);
      const json = await res.json();
      expect(json.error).toContain('Owner authentication required');
    });

    it('intercepts /api/members.csv and returns 401 when unauthenticated', async () => {
      const req = createMockRequest('/api/members.csv');
      const res = await middleware(req);
      expect(res.status).toBe(401);
    });

    it('intercepts /api/backup.sqlite and returns 401 when unauthenticated', async () => {
      const req = createMockRequest('/api/backup.sqlite');
      const res = await middleware(req);
      expect(res.status).toBe(401);
    });

    it('allows /api/export.json when authenticated with valid session', async () => {
      const token = createSessionToken(mockUser);
      const req = createMockRequest('/api/export.json', { cookie: token });
      const res = await middleware(req);
      expect(res.status).toBe(200);
    });
  });

  describe('Public Routes & Method Whitelisting', () => {
    it('allows GET /login when unauthenticated', async () => {
      const req = createMockRequest('/login');
      const res = await middleware(req);
      expect(res.status).toBe(200);
    });

    it('redirects /login to / when already authenticated', async () => {
      const token = createSessionToken(mockUser);
      const req = createMockRequest('/login', { cookie: token });
      const res = await middleware(req);
      expect(res.status).toBe(307);
      expect(res.headers.get('location')).toBe('http://localhost:3000/');
    });

    it('allows POST /api/auth/login without authentication', async () => {
      const req = createMockRequest('/api/auth/login', { method: 'POST' });
      const res = await middleware(req);
      expect(res.status).toBe(200);
    });

    it('rejects GET /api/auth/login with 401 when unauthenticated', async () => {
      const req = createMockRequest('/api/auth/login', { method: 'GET' });
      const res = await middleware(req);
      expect(res.status).toBe(401);
    });

    it('allows GET /api/health without authentication', async () => {
      const req = createMockRequest('/api/health', { method: 'GET' });
      const res = await middleware(req);
      expect(res.status).toBe(200);
    });

    it('rejects POST /api/health with 401 when unauthenticated', async () => {
      const req = createMockRequest('/api/health', { method: 'POST' });
      const res = await middleware(req);
      expect(res.status).toBe(401);
    });

    it('passes POST /api/cron/birthday-reminders through to route CRON_SECRET verification while rejecting GET without session', async () => {
      const cronPost = await middleware(
        createMockRequest('/api/cron/birthday-reminders', { method: 'POST' })
      );
      expect(cronPost.status).toBe(200);

      const cronGet = await middleware(
        createMockRequest('/api/cron/birthday-reminders', { method: 'GET' })
      );
      expect(cronGet.status).toBe(401);

      const syncPost = await middleware(
        createMockRequest('/api/birthdays/sync', { method: 'POST' })
      );
      expect(syncPost.status).toBe(401);

      const notifGet = await middleware(
        createMockRequest('/api/notifications', { method: 'GET' })
      );
      expect(notifGet.status).toBe(401);
    });

    it('passes exact /api/agent/* machine routes through to Bearer verification while blocking wrong methods and dotted/unknown paths', async () => {
      const allowedCases: Array<[string, string]> = [
        ['/api/agent/heartbeat', 'POST'],
        ['/api/agent/jobs/claim', 'POST'],
        ['/api/agent/dispatches/disp_abc123/status', 'POST'],
        ['/api/agent/dispatches/disp_abc123/lease', 'POST'],
        ['/api/agent/dispatches/disp_abc123/template', 'GET'],
        ['/api/agent/dispatches/disp_abc123/assets/mem_123', 'GET'],
        ['/api/agent/dispatches/disp_abc123/exports/upload-intents', 'POST'],
        ['/api/agent/dispatches/disp_abc123/exports', 'POST'],
      ];
      for (const [path, method] of allowedCases) {
        const res = await middleware(createMockRequest(path, { method }));
        expect(res.status).toBe(200);
      }

      const blockedCases: Array<[string, string]> = [
        ['/api/agent/heartbeat', 'GET'],
        ['/api/agent/jobs/claim', 'GET'],
        ['/api/agent/dispatches/disp_abc123/lease', 'GET'],
        ['/api/agent/dispatches/disp_abc123/template', 'POST'],
        ['/api/agent/dispatches/disp.evil/template', 'GET'],
        ['/api/agent/secrets.json', 'GET'],
        ['/api/agents', 'GET'],
      ];
      for (const [path, method] of blockedCases) {
        const res = await middleware(createMockRequest(path, { method }));
        expect(res.status).toBe(401);
      }
    });
  });

  describe('Protected Pages Redirection', () => {
    it('redirects unauthenticated /settings to /login?callbackUrl=%2Fsettings', async () => {
      const req = createMockRequest('/settings');
      const res = await middleware(req);
      expect(res.status).toBe(307);
      expect(res.headers.get('location')).toBe('http://localhost:3000/login?callbackUrl=%2Fsettings');
    });

    it('allows authenticated access to /settings', async () => {
      const token = createSessionToken(mockUser);
      const req = createMockRequest('/settings', { cookie: token });
      const res = await middleware(req);
      expect(res.status).toBe(200);
    });
  });

  describe('Cryptographic Configuration Failure (Fail Closed with Zero Redirect Loop)', () => {
    it('returns 503 JSON for private APIs and auth endpoints if SESSION_SECRET is missing', async () => {
      delete process.env.SESSION_SECRET;
      for (const path of ['/api/members', '/api/auth/me', '/api/auth/login']) {
        const req = createMockRequest(path, { method: path.endsWith('/login') ? 'POST' : 'GET' });
        const res = await middleware(req);
        expect(res.status).toBe(503);
        expect(res.headers.get('cache-control')).toBe('no-store');
        const json = await res.json();
        expect(json.error).toContain('cryptographic configuration');
      }
    });

    it('returns static 503 HTML for /login without redirecting to itself (no redirect loop)', async () => {
      delete process.env.SESSION_SECRET;
      const req = createMockRequest('/login');
      const res = await middleware(req);

      expect(res.status).toBe(503);
      expect(res.headers.get('location')).toBeNull();
      expect(res.headers.get('content-type')).toContain('text/html');
      expect(res.headers.get('cache-control')).toBe('no-store');
      const body = await res.text();
      expect(body).toContain('Authentication Configuration Error');
    });

    it('returns static 503 HTML for protected pages when SESSION_SECRET is short or missing', async () => {
      process.env.SESSION_SECRET = 'too-short';
      for (const path of ['/', '/settings', '/members']) {
        const req = createMockRequest(path);
        const res = await middleware(req);
        expect(res.status).toBe(503);
        expect(res.headers.get('location')).toBeNull();
      }
    });

    it('deliberately allows GET /api/health liveness endpoint while blocking POST /api/health when SESSION_SECRET is missing', async () => {
      delete process.env.SESSION_SECRET;
      const getHealth = await middleware(createMockRequest('/api/health', { method: 'GET' }));
      expect(getHealth.status).toBe(200);

      const postHealth = await middleware(createMockRequest('/api/health', { method: 'POST' }));
      expect(postHealth.status).toBe(503);
    });

    it('returns 503 JSON for mobile auth endpoints when SESSION_SECRET is missing', async () => {
      delete process.env.SESSION_SECRET;
      for (const path of ['/api/mobile/auth/login', '/api/mobile/auth/refresh']) {
        const res = await middleware(createMockRequest(path, { method: 'POST' }));
        expect(res.status).toBe(503);
        expect(res.headers.get('cache-control')).toBe('no-store');
      }
    });
  });

  describe('Stage 6.1 Mobile Bearer Authentication & Transport Separation', () => {
    function mintValidMobileAccess(overrides: Partial<Parameters<typeof createMobileAccessToken>[0]> = {}) {
      return createMobileAccessToken({
        userId: 'usr_owner_123456',
        organisationId: 'org_cln_123456',
        sessionVersion: 1,
        mobileDeviceId: 'mdev_1234567890',
        mobileSessionId: 'mses_1234567890',
        ...overrides,
      }).token;
    }

    it('allows POST /api/mobile/auth/login and POST /api/mobile/auth/refresh without session, while blocking GET', async () => {
      expect(
        (await middleware(createMockRequest('/api/mobile/auth/login', { method: 'POST' }))).status
      ).toBe(200);
      expect(
        (await middleware(createMockRequest('/api/mobile/auth/refresh', { method: 'POST' }))).status
      ).toBe(200);
      expect(
        (await middleware(createMockRequest('/api/mobile/auth/login', { method: 'GET' }))).status
      ).toBe(401);
      expect(
        (await middleware(createMockRequest('/api/mobile/auth/refresh', { method: 'GET' }))).status
      ).toBe(401);
    });

    it('accepts valid Mobile Bearer access token on protected owner API routes and mobile logout', async () => {
      const mobileToken = mintValidMobileAccess();
      const routes: Array<[string, string]> = [
        ['/api/dashboard', 'GET'],
        ['/api/members', 'GET'],
        ['/api/mobile/devices', 'GET'],
        ['/api/mobile/devices/mdev_1234567890/revoke', 'POST'],
        ['/api/settings/notifications', 'PATCH'],
        ['/api/mobile/auth/logout', 'POST'],
      ];
      for (const [route, method] of routes) {
        const res = await middleware(
          createMockRequest(route, {
            method,
            headers: { authorization: `Bearer ${mobileToken}` },
          })
        );
        expect(res.status).toBe(200);
      }
    });

    it('rejects Mobile Bearer on HTML web pages, rejects Web cookie on mobile logout, and blocks cross-transport token replay', async () => {
      const mobileToken = mintValidMobileAccess();
      const webCookie = createSessionToken(mockUser);

      // Mobile Bearer MUST NOT authenticate HTML dashboard pages
      const htmlRes = await middleware(
        createMockRequest('/settings', {
          headers: { authorization: `Bearer ${mobileToken}` },
        })
      );
      expect(htmlRes.status).toBe(307);
      expect(htmlRes.headers.get('location')).toBe(
        'http://localhost:3000/login?callbackUrl=%2Fsettings'
      );

      // Web cookie MUST NOT call POST /api/mobile/auth/logout
      const webLogoutRes = await middleware(
        createMockRequest('/api/mobile/auth/logout', {
          method: 'POST',
          cookie: webCookie,
        })
      );
      expect(webLogoutRes.status).toBe(401);

      // Web cookie token presented as Authorization: Bearer MUST be rejected
      const webInBearer = await middleware(
        createMockRequest('/api/dashboard', {
          headers: { authorization: `Bearer ${webCookie}` },
        })
      );
      expect(webInBearer.status).toBe(401);

      // Mobile access token presented as crelune_session cookie MUST be rejected
      const mobileInCookie = await middleware(
        createMockRequest('/api/dashboard', {
          cookie: mobileToken,
        })
      );
      expect(mobileInCookie.status).toBe(401);

      // Query-string token MUST never authenticate
      const queryToken = await middleware(
        createMockRequest(`/api/dashboard?token=${encodeURIComponent(mobileToken)}`)
      );
      expect(queryToken.status).toBe(401);
    });

    it('rejects ambiguous mixed Cookie + Authorization Bearer headers with 400 and rejects expired or malformed Bearer tokens with 401', async () => {
      const mobileToken = mintValidMobileAccess();
      const webCookie = createSessionToken(mockUser);

      const mixedRes = await middleware(
        createMockRequest('/api/dashboard', {
          cookie: webCookie,
          headers: { authorization: `Bearer ${mobileToken}` },
        })
      );
      expect(mixedRes.status).toBe(400);
      expect((await mixedRes.json()).code).toBe('AMBIGUOUS_AUTH_CREDENTIALS');

      const expiredToken = mintValidMobileAccess({
        nowSeconds: Math.floor(Date.now() / 1000) - 1000,
        ttlSeconds: 900,
      });
      const expiredRes = await middleware(
        createMockRequest('/api/dashboard', {
          headers: { authorization: `Bearer ${expiredToken}` },
        })
      );
      expect(expiredRes.status).toBe(401);

      const malformedRes = await middleware(
        createMockRequest('/api/dashboard', {
          headers: { authorization: 'Basic dXNlcjpwYXNz' },
        })
      );
      expect(malformedRes.status).toBe(401);
    });
  });
});
