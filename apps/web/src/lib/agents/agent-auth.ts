/**
 * CRELUNE — Windows Creative Agent Machine Bearer Authentication (Stage 5.5)
 *
 * Validates per-machine revocable Bearer tokens (`cln_agent_<64-hex>`) using
 * SHA-256 hash lookup and constant-time comparison against PostgreSQL `creative_agents`.
 * Never accepts query-string tokens, never echoes secrets, and fails closed on
 * revoked or unknown credentials.
 */

import crypto from 'node:crypto';
import { NextResponse } from 'next/server';
import { prisma } from '@crelune/database';
import {
  DISPATCH_CLAIM_HEADER,
  DISPATCH_CLAIM_TOKEN_REGEX,
} from '@crelune/shared';

const PRIVATE_NO_STORE_HEADERS = {
  'Cache-Control': 'private, no-store',
};

export const AGENT_TOKEN_PREFIX = 'cln_agent_';
export { DISPATCH_CLAIM_HEADER };

export interface AuthenticatedCreativeAgent {
  id: string;
  organisationId: string;
  name: string;
  machineLabel: string;
}

export type AgentAuthResult =
  | { ok: true; agent: AuthenticatedCreativeAgent }
  | { ok: false; response: NextResponse };

export function hashAgentSecret(rawToken: string): string {
  return crypto.createHash('sha256').update(rawToken, 'utf8').digest('hex');
}

export function generateCreativeAgentToken(): {
  rawToken: string;
  tokenHash: string;
  tokenPrefix: string;
} {
  const randomHex = crypto.randomBytes(32).toString('hex');
  const rawToken = `${AGENT_TOKEN_PREFIX}${randomHex}`;
  const tokenHash = hashAgentSecret(rawToken);
  const tokenPrefix = rawToken.slice(0, 18); // e.g. cln_agent_a1b2c3d4
  return { rawToken, tokenHash, tokenPrefix };
}

export function constantTimeEqualHex(aHex: string, bHex: string): boolean {
  if (aHex.length !== bHex.length || aHex.length === 0) {
    return false;
  }
  const bufA = Buffer.from(aHex, 'utf8');
  const bufB = Buffer.from(bHex, 'utf8');
  if (bufA.byteLength !== bufB.byteLength) {
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

export function generateDispatchClaimToken(): {
  claimToken: string;
  claimTokenHash: string;
} {
  const claimToken = `clm_${crypto.randomBytes(24).toString('hex')}`;
  const claimTokenHash = hashAgentSecret(claimToken);
  return { claimToken, claimTokenHash };
}

export function isValidDispatchClaimToken(rawToken: string): boolean {
  return DISPATCH_CLAIM_TOKEN_REGEX.test(rawToken);
}

export type DispatchClaimHeaderResult =
  | { ok: true; claimToken: string }
  | { ok: false; response: NextResponse };

/**
 * Extracts and validates the mandatory dispatch claim fencing token from the
 * `X-Crelune-Dispatch-Claim` HTTP header. Never accepts query parameters and
 * never echoes raw token values in errors.
 */
export function extractDispatchClaimToken(
  request: Request
): DispatchClaimHeaderResult {
  const rawHeader = request.headers.get(DISPATCH_CLAIM_HEADER);
  if (!rawHeader || rawHeader.trim().length === 0) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          error: `Forbidden: Missing required ${DISPATCH_CLAIM_HEADER} header.`,
          code: 'DISPATCH_CLAIM_REQUIRED',
        },
        { status: 403, headers: PRIVATE_NO_STORE_HEADERS }
      ),
    };
  }

  const trimmed = rawHeader.trim();
  if (!isValidDispatchClaimToken(trimmed)) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          error: `Forbidden: Malformed ${DISPATCH_CLAIM_HEADER} token.`,
          code: 'DISPATCH_CLAIM_INVALID',
        },
        { status: 403, headers: PRIVATE_NO_STORE_HEADERS }
      ),
    };
  }

  return { ok: true, claimToken: trimmed };
}

export async function verifyAgentBearerRequest(
  request: Request
): Promise<AgentAuthResult> {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(request.url);
  } catch {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'Invalid request URL.' },
        { status: 400, headers: PRIVATE_NO_STORE_HEADERS }
      ),
    };
  }

  // Never permit credentials or arbitrary query parameters on machine endpoints
  if (parsedUrl.search.length > 0) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          error:
            'Unauthorized: Query parameters are not permitted on creative agent endpoints.',
        },
        { status: 401, headers: PRIVATE_NO_STORE_HEADERS }
      ),
    };
  }

  const authHeader = request.headers.get('authorization');
  if (!authHeader) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'Unauthorized: Missing agent bearer credentials.' },
        { status: 401, headers: PRIVATE_NO_STORE_HEADERS }
      ),
    };
  }

  const match = /^Bearer\s+(\S+)$/i.exec(authHeader.trim());
  const rawToken = match?.[1];
  if (
    !rawToken ||
    !rawToken.startsWith(AGENT_TOKEN_PREFIX) ||
    rawToken.length < AGENT_TOKEN_PREFIX.length + 32 ||
    rawToken.length > 200
  ) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'Unauthorized: Invalid or revoked creative agent credentials.' },
        { status: 401, headers: PRIVATE_NO_STORE_HEADERS }
      ),
    };
  }

  const providedHash = hashAgentSecret(rawToken);
  const record = await prisma.creativeAgent.findUnique({
    where: { tokenHash: providedHash },
    select: {
      id: true,
      organisationId: true,
      name: true,
      machineLabel: true,
      tokenHash: true,
      status: true,
      revokedAt: true,
    },
  });

  if (
    !record ||
    !constantTimeEqualHex(providedHash, record.tokenHash) ||
    record.status !== 'ACTIVE' ||
    record.revokedAt !== null
  ) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'Unauthorized: Invalid or revoked creative agent credentials.' },
        { status: 401, headers: PRIVATE_NO_STORE_HEADERS }
      ),
    };
  }

  return {
    ok: true,
    agent: {
      id: record.id,
      organisationId: record.organisationId,
      name: record.name,
      machineLabel: record.machineLabel,
    },
  };
}
