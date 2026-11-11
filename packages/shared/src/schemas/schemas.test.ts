import { describe, it, expect } from 'vitest';
import {
  loginSchema,
  sessionTokenPayloadSchema,
  validateSessionPayload,
  SESSION_TTL_SECONDS,
  MAX_CLOCK_SKEW_SECONDS,
} from './auth.js';
import { envSchema, validateEnv } from './env.js';

describe('Auth Validation Schemas', () => {
  it('validates a correct login payload', () => {
    const valid = { email: 'owner@crelune.app', password: 'securePassword123' };
    const result = loginSchema.safeParse(valid);
    expect(result.success).toBe(true);
  });

  it('rejects invalid email formats', () => {
    const invalid = { email: 'not-an-email', password: 'securePassword123' };
    const result = loginSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  it('rejects short passwords', () => {
    const invalid = { email: 'owner@crelune.app', password: 'short' };
    const result = loginSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  it('validates a valid session token payload', () => {
    const validPayload = {
      sub: 'usr_123',
      role: 'OWNER',
      org: 'org_123',
      ver: 1,
      iat: 1700000000,
      exp: 1700604800,
    };
    const result = sessionTokenPayloadSchema.safeParse(validPayload);
    expect(result.success).toBe(true);
  });

  it('rejects a session token payload with non-OWNER role', () => {
    const invalidPayload = {
      sub: 'usr_123',
      role: 'ADMIN',
      org: 'org_123',
      ver: 1,
      iat: 1700000000,
      exp: 1700604800,
    };
    const result = sessionTokenPayloadSchema.safeParse(invalidPayload);
    expect(result.success).toBe(false);
  });

  it('rejects a session token payload with missing sub, org, or ver', () => {
    const missingVer = {
      sub: 'usr_123',
      role: 'OWNER',
      org: 'org_123',
      iat: 1700000000,
      exp: 1700604800,
    };
    expect(sessionTokenPayloadSchema.safeParse(missingVer).success).toBe(false);
  });

  it('rejects extra unexpected fields in session token payload', () => {
    const withPii = {
      sub: 'usr_123',
      role: 'OWNER',
      org: 'org_123',
      ver: 1,
      iat: 1700000000,
      exp: 1700604800,
      email: 'owner@crelune.app',
    };
    expect(sessionTokenPayloadSchema.safeParse(withPii).success).toBe(false);
  });

  describe('validateSessionPayload lifetime boundaries', () => {
    const NOW = 1700000000;

    it('accepts a token exactly at the configured SESSION_TTL_SECONDS boundary', () => {
      const payload = {
        sub: 'usr_123',
        role: 'OWNER',
        org: 'org_123',
        ver: 1,
        iat: NOW,
        exp: NOW + SESSION_TTL_SECONDS,
      };
      expect(validateSessionPayload(payload, NOW)).not.toBeNull();
    });

    it('rejects a token exceeding configured SESSION_TTL_SECONDS by 1 second', () => {
      const payload = {
        sub: 'usr_123',
        role: 'OWNER',
        org: 'org_123',
        ver: 1,
        iat: NOW,
        exp: NOW + SESSION_TTL_SECONDS + 1,
      };
      expect(validateSessionPayload(payload, NOW)).toBeNull();
    });

    it('rejects a token where exp === iat or exp < iat', () => {
      expect(
        validateSessionPayload(
          { sub: 'u', role: 'OWNER', org: 'o', ver: 1, iat: NOW, exp: NOW },
          NOW - 10
        )
      ).toBeNull();
      expect(
        validateSessionPayload(
          { sub: 'u', role: 'OWNER', org: 'o', ver: 1, iat: NOW, exp: NOW - 5 },
          NOW - 10
        )
      ).toBeNull();
    });

    it('rejects a token at exact expiration second (exp === now)', () => {
      expect(
        validateSessionPayload(
          { sub: 'u', role: 'OWNER', org: 'o', ver: 1, iat: NOW - 100, exp: NOW },
          NOW
        )
      ).toBeNull();
    });

    it('accepts iat within clock skew and rejects beyond MAX_CLOCK_SKEW_SECONDS', () => {
      expect(
        validateSessionPayload(
          {
            sub: 'u',
            role: 'OWNER',
            org: 'o',
            ver: 1,
            iat: NOW + MAX_CLOCK_SKEW_SECONDS,
            exp: NOW + 3600,
          },
          NOW
        )
      ).not.toBeNull();

      expect(
        validateSessionPayload(
          {
            sub: 'u',
            role: 'OWNER',
            org: 'o',
            ver: 1,
            iat: NOW + MAX_CLOCK_SKEW_SECONDS + 1,
            exp: NOW + 3600,
          },
          NOW
        )
      ).toBeNull();
    });
  });
});

describe('Environment Validation Schemas', () => {
  it('validates a complete environment configuration', () => {
    const valid = {
      DATABASE_URL: 'postgresql://user:pass@ep-pooler.neon.tech/neondb',
      DATABASE_URL_UNPOOLED: 'postgresql://user:pass@ep-direct.neon.tech/neondb',
      SESSION_SECRET: 'a'.repeat(32),
      NODE_ENV: 'development',
    };
    const result = envSchema.safeParse(valid);
    expect(result.success).toBe(true);
  });

  it('rejects when SESSION_SECRET is too short', () => {
    const invalid = {
      DATABASE_URL: 'postgresql://user:pass@ep-pooler.neon.tech/neondb',
      DATABASE_URL_UNPOOLED: 'postgresql://user:pass@ep-direct.neon.tech/neondb',
      SESSION_SECRET: 'too-short',
    };
    expect(() => validateEnv(invalid)).toThrow('CRELUNE Environment Configuration Failure');
  });
});
