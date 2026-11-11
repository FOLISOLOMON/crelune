/**
 * CRELUNE — Web Crypto Universal Session Verifier
 *
 * Compatible with Next.js Middleware Edge and Node.js runtimes.
 * Uses Web Crypto `crypto.subtle.verify()` for cryptographic HMAC-SHA256 verification.
 */

import type { OwnerSession } from '@crelune/shared';
import { validateSessionPayload } from '@crelune/shared';

export const SESSION_COOKIE_NAME = 'crelune_session';

const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;
const HMAC_SHA256_BYTES = 32;

function decodeBase64UrlStrict(str: string): Uint8Array | null {
  if (!str || !BASE64URL_PATTERN.test(str)) {
    return null;
  }

  let padded = str.replace(/-/g, '+').replace(/_/g, '/');
  const remainder = padded.length % 4;
  if (remainder === 1) {
    return null;
  }
  while (padded.length % 4) {
    padded += '=';
  }

  try {
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  } catch {
    return null;
  }
}

/**
 * Verifies a session token using Web Crypto `crypto.subtle.verify()`.
 * Fails closed (returns null) if secretKey is missing, shorter than 32 characters,
 * signature verification fails, or payload/lifetime constraints are violated.
 */
export async function verifySessionTokenEdge(
  token: string | undefined,
  secretKey: string | undefined,
  nowSeconds?: number
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
  if (!BASE64URL_PATTERN.test(payloadEncoded)) return null;

  const signatureBytes = decodeBase64UrlStrict(signature);
  if (!signatureBytes || signatureBytes.byteLength !== HMAC_SHA256_BYTES) {
    return null;
  }

  try {
    const encoder = new TextEncoder();
    const keyData = encoder.encode(secretKey);

    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      keyData,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify']
    );

    const signedData = encoder.encode(payloadEncoded);
    const isValidSignature = await crypto.subtle.verify(
      'HMAC',
      cryptoKey,
      signatureBytes as BufferSource,
      signedData
    );

    if (!isValidSignature) {
      return null;
    }

    const payloadBytes = decodeBase64UrlStrict(payloadEncoded);
    if (!payloadBytes) {
      return null;
    }

    const payloadJson = new TextDecoder('utf-8', { fatal: true }).decode(payloadBytes);
    const parsed = JSON.parse(payloadJson);

    return validateSessionPayload(parsed, nowSeconds);
  } catch {
    return null;
  }
}
