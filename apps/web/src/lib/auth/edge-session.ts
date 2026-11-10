/**
 * CRELUNE — Web Crypto Universal Session Verifier
 *
 * Compatible with Next.js Middleware Edge and Node.js runtimes.
 * Cryptographically verifies HMAC-SHA256 session token signatures.
 */

import type { OwnerSession } from '@crelune/shared';

export const SESSION_COOKIE_NAME = 'crelune_session';

function base64UrlDecode(str: string): string {
  let padded = str.replace(/-/g, '+').replace(/_/g, '/');
  while (padded.length % 4) {
    padded += '=';
  }
  return atob(padded);
}

function base64UrlEncodeBytes(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary)
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

/**
 * Verifies a session token using Web Crypto API.
 * Fails closed (returns null) if secretKey is missing or shorter than 32 characters.
 */
export async function verifySessionTokenEdge(
  token: string | undefined,
  secretKey: string | undefined
): Promise<OwnerSession | null> {
  // Fail closed if secret key is missing or shorter than 32 characters
  if (!secretKey || secretKey.length < 32) {
    return null;
  }

  if (!token || typeof token !== 'string') return null;

  const parts = token.split('.');
  if (parts.length !== 2) return null;

  const [payloadEncoded, signature] = parts;
  if (!payloadEncoded || !signature) return null;

  try {
    const encoder = new TextEncoder();
    const keyData = encoder.encode(secretKey);

    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      keyData,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify', 'sign']
    );

    const signedData = encoder.encode(payloadEncoded);
    const expectedSigBytes = await crypto.subtle.sign('HMAC', cryptoKey, signedData);
    const expectedSignature = base64UrlEncodeBytes(new Uint8Array(expectedSigBytes));

    // Constant-time check: Web Crypto subtle.verify could be used, or byte comparison
    if (signature !== expectedSignature) {
      return null;
    }

    const payloadJson = base64UrlDecode(payloadEncoded);
    const parsed = JSON.parse(payloadJson);

    // Validate structure strictly matching sessionTokenPayloadSchema
    if (
      !parsed ||
      typeof parsed !== 'object' ||
      typeof parsed.sub !== 'string' ||
      !parsed.sub ||
      parsed.role !== 'OWNER' ||
      typeof parsed.org !== 'string' ||
      !parsed.org ||
      typeof parsed.iat !== 'number' ||
      !Number.isInteger(parsed.iat) ||
      typeof parsed.exp !== 'number' ||
      !Number.isInteger(parsed.exp)
    ) {
      return null;
    }

    const now = Math.floor(Date.now() / 1000);
    // exp > iat, exp >= now, iat <= now + 60
    if (parsed.exp <= parsed.iat) return null;
    if (parsed.exp < now) return null;
    if (parsed.iat > now + 60) return null;

    return parsed as OwnerSession;
  } catch {
    return null;
  }
}
