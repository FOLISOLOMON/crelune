import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createSessionToken, verifySessionToken } from './session';
import { verifySessionTokenEdge } from './edge-session';
import type { OwnerUser } from '@crelune/shared';

describe('Cryptographic Session Management', () => {
  const TEST_SECRET = 'a'.repeat(32);
  const originalSecret = process.env.SESSION_SECRET;

  const mockUser: OwnerUser = {
    id: 'user_123',
    organisationId: 'org_123',
    email: 'owner@crelune.app',
    firstName: 'Solomon',
    lastName: 'Foli',
    role: 'OWNER',
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(() => {
    process.env.SESSION_SECRET = TEST_SECRET;
  });

  afterEach(() => {
    process.env.SESSION_SECRET = originalSecret;
  });

  it('creates and verifies a valid session token', () => {
    const token = createSessionToken(mockUser);
    expect(token).toContain('.');

    const session = verifySessionToken(token);
    expect(session).not.toBeNull();
    expect(session?.userId).toBe(mockUser.id);
    expect(session?.email).toBe(mockUser.email);
    expect(session?.role).toBe('OWNER');
  });

  it('verifies seamlessly with Web Crypto Edge runtime verifier', async () => {
    const token = createSessionToken(mockUser);
    const session = await verifySessionTokenEdge(token, TEST_SECRET);

    expect(session).not.toBeNull();
    expect(session?.userId).toBe(mockUser.id);
    expect(session?.email).toBe(mockUser.email);
  });

  it('rejects tampered session tokens', () => {
    const token = createSessionToken(mockUser);
    const [payload, sig] = token.split('.');

    // Tamper payload (e.g. elevate role or change email)
    const tamperedPayload = Buffer.from(
      JSON.stringify({ ...JSON.parse(Buffer.from(payload, 'base64').toString()), role: 'SUPER_ADMIN' })
    ).toString('base64');

    const tamperedToken = `${tamperedPayload}.${sig}`;
    expect(verifySessionToken(tamperedToken)).toBeNull();
  });

  it('rejects tampered signatures', () => {
    const token = createSessionToken(mockUser);
    const [payload] = token.split('.');
    const invalidSignature = 'invalidSignature12345678901234567890123456789012';

    const tamperedToken = `${payload}.${invalidSignature}`;
    expect(verifySessionToken(tamperedToken)).toBeNull();
  });

  it('rejects expired tokens', () => {
    const token = createSessionToken(mockUser);
    const [payload] = token.split('.');

    // Decode and set expiresAt to the past
    const decoded = JSON.parse(Buffer.from(payload, 'base64').toString());
    decoded.expiresAt = Math.floor(Date.now() / 1000) - 100;

    const expiredPayload = Buffer.from(JSON.stringify(decoded))
      .toString('base64')
      .replace(/=/g, '')
      .replace(/\+/g, '-')
      .replace(/\//g, '_');

    // Sign the expired payload with correct secret
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
});
