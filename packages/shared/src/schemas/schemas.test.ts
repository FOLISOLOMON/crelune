import { describe, it, expect } from 'vitest';
import { loginSchema, sessionTokenPayloadSchema } from './auth.js';
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
      iat: 1700000000,
      exp: 1700604800,
    };
    const result = sessionTokenPayloadSchema.safeParse(invalidPayload);
    expect(result.success).toBe(false);
  });

  it('rejects a session token payload with missing sub or org', () => {
    const missingSub = {
      role: 'OWNER',
      org: 'org_123',
      iat: 1700000000,
      exp: 1700604800,
    };
    expect(sessionTokenPayloadSchema.safeParse(missingSub).success).toBe(false);
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
