/**
 * CRELUNE — Shared HTTP Helpers for Creative Agent API Routes
 */

import { NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { memberIdParamSchema } from '@crelune/shared';
import {
  CreativeAgentAssetNotFoundError,
  CreativeAgentClaimError,
  CreativeAgentForbiddenError,
  CreativeAgentNotFoundError,
  CreativeAgentRevokedError,
  CreativeAgentUnsupportedAssetError,
} from '@/lib/agents/agent-errors';
import { DesignJobValidationError } from '@/lib/designs/design-job-service';
import {
  DispatchNotFoundError,
  JobPreparationConflictError,
} from '@/lib/designs/job-preparation-service';
import { StorageKeyViolationError } from '@/lib/storage/storage-config';

const PRIVATE_NO_STORE_HEADERS = {
  'Cache-Control': 'private, no-store',
};

export function agentJsonResponse(
  body: unknown,
  status: number = 200
): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: PRIVATE_NO_STORE_HEADERS,
  });
}

export function agentValidationErrorResponse(error: ZodError): NextResponse {
  const firstIssue = error.issues[0];
  return agentJsonResponse(
    {
      error: firstIssue?.message ?? 'Validation failed',
      code: 'VALIDATION_ERROR',
      issues: error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
    },
    400
  );
}

export function parseAgentScopedIdOrError(
  rawId: string
): { ok: true; id: string } | { ok: false; response: NextResponse } {
  const parsed = memberIdParamSchema.safeParse(rawId);
  if (!parsed.success) {
    return { ok: false, response: agentValidationErrorResponse(parsed.error) };
  }
  return { ok: true, id: parsed.data };
}

export function handleAgentRouteError(
  err: unknown,
  context: string
): NextResponse {
  if (err instanceof CreativeAgentNotFoundError) {
    return agentJsonResponse({ error: 'Creative agent not found.' }, 404);
  }
  if (err instanceof DispatchNotFoundError) {
    return agentJsonResponse({ error: 'Creative job dispatch not found.' }, 404);
  }
  if (err instanceof CreativeAgentAssetNotFoundError) {
    return agentJsonResponse({ error: err.message }, 404);
  }
  if (err instanceof CreativeAgentRevokedError) {
    return agentJsonResponse(
      { error: err.message, code: 'AGENT_REVOKED' },
      401
    );
  }
  if (err instanceof CreativeAgentClaimError) {
    return agentJsonResponse({ error: err.message, code: err.code }, 403);
  }
  if (err instanceof CreativeAgentForbiddenError) {
    return agentJsonResponse({ error: err.message, code: 'FORBIDDEN' }, 403);
  }
  if (err instanceof CreativeAgentUnsupportedAssetError) {
    return agentJsonResponse(
      { error: err.message, code: 'UNSUPPORTED_ASSET_KIND' },
      400
    );
  }
  if (
    err instanceof DesignJobValidationError ||
    err instanceof StorageKeyViolationError
  ) {
    return agentJsonResponse(
      { error: err.message, code: 'VALIDATION_ERROR' },
      400
    );
  }
  if (err instanceof JobPreparationConflictError) {
    return agentJsonResponse({ error: err.message, code: err.code }, 409);
  }

  console.error(
    `Agent API failure (${context}):`,
    err instanceof Error ? err.name : 'UnknownError'
  );
  return agentJsonResponse(
    { error: 'An unexpected server error occurred.' },
    500
  );
}
