import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import crypto from 'node:crypto';
import {
  SESSION_TTL_SECONDS,
  MAX_CLOCK_SKEW_SECONDS,
} from '@crelune/shared';
import { createSessionToken, verifySessionToken, getSecretKey } from './session';
import { verifySessionTokenEdge } from './edge-session';

function encodeB64Url(input: Buffer | string): string {
  const buf = typeof input === 'string' ? Buffer.from(input, 'utf8') : input;
  return buf
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function signPayload(payloadObj: unknown, secret: string): string {
  const payloadEncoded = encodeB64Url(JSON.stringify(payloadObj));
  const sig = encodeB64Url(
    crypto.createHmac('sha256', secret).update(payloadEncoded, 'utf8').digest()
  );
  return `${payloadEncoded}.${sig}`;
}

describe('Cryptographic Session Management & Security Hardening', () => {
  const TEST_SECRET = 'a'.repeat(32);
  const originalSecret = process.env.SESSION_SECRET;

  const mockUser = {
    id: 'usr_cln_123456789',
    organisationId: 'org_cln_987654321',
    sessionVersion: 2,
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
      expect(() => getSecretKey()).toThrow(
        'SESSION_SECRET environment variable is missing or less than 32 characters'
      );
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
    it('creates a token containing minimal claims including ver and zero PII', () => {
      const token = createSessionToken(mockUser);
      expect(token).toContain('.');

      const [payloadEncoded] = token.split('.');
      const decodedJson = JSON.parse(Buffer.from(payloadEncoded, 'base64').toString('utf8'));

      expect(decodedJson).toEqual({
        sub: mockUser.id,
        role: 'OWNER',
        org: mockUser.organisationId,
        ver: 2,
        iat: expect.any(Number),
        exp: expect.any(Number),
      });

      expect(decodedJson).not.toHaveProperty('firstName');
      expect(decodedJson).not.toHaveProperty('lastName');
      expect(decodedJson).not.toHaveProperty('email');
      expect(decodedJson).not.toHaveProperty('passwordHash');
    });

    it('verifies a valid token identically in Node.js and Web Crypto Edge runtimes', async () => {
      const token = createSessionToken(mockUser);
      const nodeSession = verifySessionToken(token);
      const edgeSession = await verifySessionTokenEdge(token, TEST_SECRET);

      expect(nodeSession).not.toBeNull();
      expect(edgeSession).toEqual(nodeSession);
      expect(edgeSession?.ver).toBe(2);
    });
  });

  describe('Node & Edge Parity: Integrity, Malformed Tokens & Lifetime Boundaries', () => {
    it('rejects tampered payloads in both Node and Edge', async () => {
      const token = createSessionToken(mockUser);
      const [payload, sig] = token.split('.');

      const decoded = JSON.parse(Buffer.from(payload, 'base64').toString('utf8'));
      decoded.ver = 999;

      const tamperedToken = `${encodeB64Url(JSON.stringify(decoded))}.${sig}`;
      expect(verifySessionToken(tamperedToken)).toBeNull();
      expect(await verifySessionTokenEdge(tamperedToken, TEST_SECRET)).toBeNull();
    });

    it('rejects tampered signatures and wrong-length signatures in both Node and Edge', async () => {
      const token = createSessionToken(mockUser);
      const [payload] = token.split('.');

      const wrongSig = encodeB64Url(Buffer.alloc(32, 0xff));
      const shortSig = encodeB64Url(Buffer.alloc(16, 0xaa));
      const nonBase64UrlSig = 'invalid+sig/with=padding!';

      for (const bad of [wrongSig, shortSig, nonBase64UrlSig]) {
        expect(verifySessionToken(`${payload}.${bad}`)).toBeNull();
        expect(await verifySessionTokenEdge(`${payload}.${bad}`, TEST_SECRET)).toBeNull();
      }
    });

    it('rejects structurally malformed tokens in both Node and Edge', async () => {
      const malformed = [
        undefined,
        '',
        'single-part',
        'a.b.c',
        '.sig',
        'payload.',
        'not!base64.' + encodeB64Url(Buffer.alloc(32, 1)),
      ];

      for (const tok of malformed) {
        expect(verifySessionToken(tok)).toBeNull();
        expect(await verifySessionTokenEdge(tok, TEST_SECRET)).toBeNull();
      }
    });

    it('rejects tokens with invalid JSON or extra PII fields in both Node and Edge', async () => {
      const now = Math.floor(Date.now() / 1000);
      const badJsonPayload = encodeB64Url('{not-valid-json');
      const badJsonSig = encodeB64Url(
        crypto.createHmac('sha256', TEST_SECRET).update(badJsonPayload).digest()
      );
      const badJsonToken = `${badJsonPayload}.${badJsonSig}`;

      const extraClaimToken = signPayload(
        {
          sub: mockUser.id,
          role: 'OWNER',
          org: mockUser.organisationId,
          ver: 1,
          iat: now,
          exp: now + 3600,
          email: 'leak@example.com',
        },
        TEST_SECRET
      );

      for (const tok of [badJsonToken, extraClaimToken]) {
        expect(verifySessionToken(tok, now)).toBeNull();
        expect(await verifySessionTokenEdge(tok, TEST_SECRET, now)).toBeNull();
      }
    });

    it('rejects expired tokens (including exact exp === now boundary) in both Node and Edge', async () => {
      const now = 1700000000;
      const expiredPast = signPayload(
        { sub: 'u', role: 'OWNER', org: 'o', ver: 1, iat: now - 200, exp: now - 1 },
        TEST_SECRET
      );
      const expiredBoundary = signPayload(
        { sub: 'u', role: 'OWNER', org: 'o', ver: 1, iat: now - 200, exp: now },
        TEST_SECRET
      );

      for (const tok of [expiredPast, expiredBoundary]) {
        expect(verifySessionToken(tok, now)).toBeNull();
        expect(await verifySessionTokenEdge(tok, TEST_SECRET, now)).toBeNull();
      }
    });

    it('rejects exp <= iat in both Node and Edge', async () => {
      const now = 1700000000;
      const equalLifetime = signPayload(
        { sub: 'u', role: 'OWNER', org: 'o', ver: 1, iat: now + 10, exp: now + 10 },
        TEST_SECRET
      );
      const invertedLifetime = signPayload(
        { sub: 'u', role: 'OWNER', org: 'o', ver: 1, iat: now + 20, exp: now + 10 },
        TEST_SECRET
      );

      for (const tok of [equalLifetime, invertedLifetime]) {
        expect(verifySessionToken(tok, now)).toBeNull();
        expect(await verifySessionTokenEdge(tok, TEST_SECRET, now)).toBeNull();
      }
    });

    it('enforces maximum configured SESSION_TTL_SECONDS in both Node and Edge', async () => {
      const now = 1700000000;
      const exactTtlToken = signPayload(
        {
          sub: 'u',
          role: 'OWNER',
          org: 'o',
          ver: 1,
          iat: now,
          exp: now + SESSION_TTL_SECONDS,
        },
        TEST_SECRET
      );
      const excessiveTtlToken = signPayload(
        {
          sub: 'u',
          role: 'OWNER',
          org: 'o',
          ver: 1,
          iat: now,
          exp: now + SESSION_TTL_SECONDS + 1,
        },
        TEST_SECRET
      );

      expect(verifySessionToken(exactTtlToken, now)).not.toBeNull();
      expect(await verifySessionTokenEdge(exactTtlToken, TEST_SECRET, now)).not.toBeNull();

      expect(verifySessionToken(excessiveTtlToken, now)).toBeNull();
      expect(await verifySessionTokenEdge(excessiveTtlToken, TEST_SECRET, now)).toBeNull();
    });

    it('enforces MAX_CLOCK_SKEW_SECONDS for future iat in both Node and Edge', async () => {
      const now = 1700000000;
      const acceptableSkew = signPayload(
        {
          sub: 'u',
          role: 'OWNER',
          org: 'o',
          ver: 1,
          iat: now + MAX_CLOCK_SKEW_SECONDS,
          exp: now + 3600,
        },
        TEST_SECRET
      );
      const excessiveSkew = signPayload(
        {
          sub: 'u',
          role: 'OWNER',
          org: 'o',
          ver: 1,
          iat: now + MAX_CLOCK_SKEW_SECONDS + 1,
          exp: now + 3600,
        },
        TEST_SECRET
      );

      expect(verifySessionToken(acceptableSkew, now)).not.toBeNull();
      expect(await verifySessionTokenEdge(acceptableSkew, TEST_SECRET, now)).not.toBeNull();

      expect(verifySessionToken(excessiveSkew, now)).toBeNull();
      expect(await verifySessionTokenEdge(excessiveSkew, TEST_SECRET, now)).toBeNull();
    });

    it('rejects non-OWNER role claims in both Node and Edge', async () => {
      const now = 1700000000;
      const nonOwner = signPayload(
        {
          sub: mockUser.id,
          role: 'DESIGNER',
          org: mockUser.organisationId,
          ver: 1,
          iat: now,
          exp: now + 3600,
        },
        TEST_SECRET
      );

      expect(verifySessionToken(nonOwner, now)).toBeNull();
      expect(await verifySessionTokenEdge(nonOwner, TEST_SECRET, now)).toBeNull();
    });
  });
});
