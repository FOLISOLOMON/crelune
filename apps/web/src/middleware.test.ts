import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { middleware } from './middleware';
import { createSessionToken } from './lib/auth/session';

describe('Middleware Route Protection & Edge Security (Milestone 2.1)', () => {
  const TEST_SECRET = 'a'.repeat(32);
  const originalSecret = process.env.SESSION_SECRET;

  const mockUser = {
    id: 'usr_cln_123',
    organisationId: 'org_cln_123',
    role: 'OWNER' as const,
  };

  beforeEach(() => {
    process.env.SESSION_SECRET = TEST_SECRET;
  });

  afterEach(() => {
    process.env.SESSION_SECRET = originalSecret;
  });

  function createMockRequest(path: string, options: { method?: string; cookie?: string; headers?: Record<string, string> } = {}) {
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

  describe('Cryptographic Configuration Failure (Fail Closed)', () => {
    it('returns 503 for APIs if SESSION_SECRET is missing', async () => {
      delete process.env.SESSION_SECRET;
      const req = createMockRequest('/api/members');
      const res = await middleware(req);
      expect(res.status).toBe(503);
      const json = await res.json();
      expect(json.error).toContain('Missing cryptographic configuration');
    });

    it('redirects to /login?error=server_configuration for pages if SESSION_SECRET is missing', async () => {
      delete process.env.SESSION_SECRET;
      const req = createMockRequest('/members');
      const res = await middleware(req);
      expect(res.status).toBe(307);
      expect(res.headers.get('location')).toContain('error=server_configuration');
    });
  });
});
