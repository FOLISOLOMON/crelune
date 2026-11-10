/**
 * CRELUNE — Web Crypto Universal Session Verifier
 *
 * Compatible with Next.js Middleware Edge and Node.js runtimes.
 */

import type { OwnerSession } from '@crelune/shared';

export const SESSION_COOKIE_NAME = 'crelune_session';

function base64UrlDecode(str: string): string {
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4) {
    str += '=';
  }
  return atob(str);
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

export async function verifySessionTokenEdge(
  token: string | undefined,
  secretKey: string
): Promise<OwnerSession | null> {
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

    if (signature !== expectedSignature) {
      return null;
    }

    const payloadJson = base64UrlDecode(payloadEncoded);
    const session: OwnerSession = JSON.parse(payloadJson);

    const now = Math.floor(Date.now() / 1000);
    if (session.expiresAt && session.expiresAt < now) {
      return null;
    }

    return session;
  } catch {
    return null;
  }
}
