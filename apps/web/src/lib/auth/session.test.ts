import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createSessionToken, verifySessionToken, getSecretKey } from './session';
import { verifySessionTokenEdge } from './edge-session';

describe('Cryptographic Session Management & Security Hardening', () => {
  const TEST_SECRET = 'a'.repeat(32);
  const originalSecret = process.env.SESSION_SECRET;

  const mockUser = {
    id: 'usr_cln_123456789',
    organisationId: 'org_cln_987654321',
    role: 'OWNER' as const,
  };

  beforeEach(() => {
    process.env.SESSION_SECRET = TEST_SECRET;
  });

  afterEach(() => {
    process.env.SESSION_SECRET = originalSecret;
  });

  describe('Secret Key Enforcement (Fail Closed)', () => {
    it('throws if SESSION_SECRET is completely missing', () => {
      delete process.env.SESSION_SECRET;
      expect(() => getSecretKey()).toThrow('SESSION_SECRET environment variable is missing');
    });

    it('throws if SESSION_SECRET is shorter than 32 characters', () => {
      process.env.SESSION_SECRET = 'short-secret-key-123';
      expect(() => getSecretKey()).toThrow('SESSION_SECRET environment variable is missing or less than 32 characters');
    });

    it('fails closed in verifySessionToken if SESSION_SECRET is missing', () => {
      const token = createSessionToken(mockUser);
      delete process.env.SESSION_SECRET;
      expect(verifySessionToken(token)).toBeNull();
    });

    it('fails closed in Edge verifier if secretKey is missing or too short', async () => {
      const token = createSessionToken(mockUser);
      expect(await verifySessionTokenEdge(token, undefined)).toBeNull();
      expect(await verifySessionTokenEdge(token, '')).toBeNull();
      expect(await verifySessionTokenEdge(token, 'short-key')).toBeNull();
    });
  });

  describe('Minimized Payload & Cryptographic Signing', () => {
    it('creates a token containing minimal claims without PII', () => {
      const token = createSessionToken(mockUser);
      expect(token).toContain('.');

      const [payloadEncoded] = token.split('.');
      const decodedJson = JSON.parse(Buffer.from(payloadEncoded, 'base64').toString('utf8'));

      expect(decodedJson).toHaveProperty('sub', mockUser.id);
      expect(decodedJson).toHaveProperty('role', 'OWNER');
      expect(decodedJson).toHaveProperty('org', mockUser.organisationId);
      expect(decodedJson).toHaveProperty('iat');
      expect(decodedJson).toHaveProperty('exp');

      // Zero PII leakage in cookie
      expect(decodedJson).not.toHaveProperty('firstName');
      expect(decodedJson).not.toHaveProperty('lastName');
      expect(decodedJson).not.toHaveProperty('email');
      expect(decodedJson).not.toHaveProperty('passwordHash');
    });

    it('verifies a valid token in Node.js runtime', () => {
      const token = createSessionToken(mockUser);
      const session = verifySessionToken(token);

      expect(session).not.toBeNull();
      expect(session?.sub).toBe(mockUser.id);
      expect(session?.org).toBe(mockUser.organisationId);
      expect(session?.role).toBe('OWNER');
    });

    it('verifies a valid token in Edge Web Crypto runtime', async () => {
      const token = createSessionToken(mockUser);
      const session = await verifySessionTokenEdge(token, TEST_SECRET);

      expect(session).not.toBeNull();
      expect(session?.sub).toBe(mockUser.id);
      expect(session?.org).toBe(mockUser.organisationId);
      expect(session?.role).toBe('OWNER');
    });
  });

  describe('Integrity & Tamper Rejection', () => {
    it('rejects tampered session payloads', () => {
      const token = createSessionToken(mockUser);
      const [payload, sig] = token.split('.');

      const decoded = JSON.parse(Buffer.from(payload, 'base64').toString('utf8'));
      decoded.role = 'ADMIN'; // Attempt unauthorized role modification

      const tamperedPayload = Buffer.from(JSON.stringify(decoded))
        .toString('base64')
        .replace(/=/g, '')
        .replace(/\+/g, '-')
        .replace(/\//g, '_');

      const tamperedToken = `${tamperedPayload}.${sig}`;
      expect(verifySessionToken(tamperedToken)).toBeNull();
    });

    it('rejects tampered signatures', () => {
      const token = createSessionToken(mockUser);
      const [payload] = token.split('.');
      const fakeSig = 'fakeSignature12345678901234567890123456789012';

      expect(verifySessionToken(`${payload}.${fakeSig}`)).toBeNull();
    });

    it('rejects expired tokens', () => {
      const token = createSessionToken(mockUser);
      const [payload] = token.split('.');

      const decoded = JSON.parse(Buffer.from(payload, 'base64').toString('utf8'));
      decoded.exp = Math.floor(Date.now() / 1000) - 100; // Expired 100 seconds ago

      const expiredPayload = Buffer.from(JSON.stringify(decoded))
        .toString('base64')
        .replace(/=/g, '')
        .replace(/\+/g, '-')
        .replace(/\//g, '_');

      const crypto = require('node:crypto');
      const sig = crypto
        .createHmac('sha256', TEST_SECRET)
        .update(expiredPayload)
        .digest('base64')
        .replace(/=/g, '')
        .replace(/\+/g, '-')
        .replace(/\//g, '_');

      const expiredToken = `${expiredPayload}.${sig}`;
      expect(verifySessionToken(expiredToken)).toBeNull();
    });

    it('rejects future tokens beyond acceptable clock skew', () => {
      const token = createSessionToken(mockUser);
      const [payload] = token.split('.');

      const decoded = JSON.parse(Buffer.from(payload, 'base64').toString('utf8'));
      decoded.iat = Math.floor(Date.now() / 1000) + 120; // 2 minutes in future
      decoded.exp = decoded.iat + 3600;

      const futurePayload = Buffer.from(JSON.stringify(decoded))
        .toString('base64')
        .replace(/=/g, '')
        .replace(/\+/g, '-')
        .replace(/\//g, '_');

      const crypto = require('node:crypto');
      const sig = crypto
        .createHmac('sha256', TEST_SECRET)
        .update(futurePayload)
        .digest('base64')
        .replace(/=/g, '')
        .replace(/\+/g, '-')
        .replace(/\//g, '_');

      const futureToken = `${futurePayload}.${sig}`;
      expect(verifySessionToken(futureToken)).toBeNull();
    });

    it('rejects non-OWNER role claims', () => {
      const nonOwnerPayload = {
        sub: mockUser.id,
        role: 'DESIGNER',
        org: mockUser.organisationId,
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 3600,
      };

      const payloadEncoded = Buffer.from(JSON.stringify(nonOwnerPayload))
        .toString('base64')
        .replace(/=/g, '')
        .replace(/\+/g, '-')
        .replace(/\//g, '_');

      const crypto = require('node:crypto');
      const sig = crypto
        .createHmac('sha256', TEST_SECRET)
        .update(payloadEncoded)
        .digest('base64')
        .replace(/=/g, '')
        .replace(/\+/g, '-')
        .replace(/\//g, '_');

      expect(verifySessionToken(`${payloadEncoded}.${sig}`)).toBeNull();
    });
  });
});
