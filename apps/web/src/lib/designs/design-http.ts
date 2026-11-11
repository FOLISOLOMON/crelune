/**
 * CRELUNE — Shared HTTP Helpers for Design Management API Routes
 */

import { NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { designJobIdParamSchema } from '@crelune/shared';
import {
  DesignJobNotFoundError,
  DesignJobTransitionError,
  DesignJobValidationError,
} from '@/lib/designs/design-job-service';
import { MemberNotFoundError } from '@/lib/members/member-service';

const PRIVATE_NO_STORE_HEADERS = {
  'Cache-Control': 'private, no-store',
};

export function designJsonResponse(
  body: unknown,
  status: number = 200
): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: PRIVATE_NO_STORE_HEADERS,
  });
}

export function designValidationErrorResponse(error: ZodError): NextResponse {
  const firstIssue = error.issues[0];
  return designJsonResponse(
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

export function parseDesignJobIdOrError(
  rawId: string
): { ok: true; id: string } | { ok: false; response: NextResponse } {
  const parsed = designJobIdParamSchema.safeParse(rawId);
  if (!parsed.success) {
    return { ok: false, response: designValidationErrorResponse(parsed.error) };
  }
  return { ok: true, id: parsed.data };
}

export function handleDesignRouteError(
  err: unknown,
  context: string
): NextResponse {
  if (err instanceof DesignJobNotFoundError) {
    return designJsonResponse({ error: 'Design job not found' }, 404);
  }

  if (err instanceof MemberNotFoundError) {
    return designJsonResponse({ error: 'Linked member not found' }, 404);
  }

  if (err instanceof DesignJobValidationError) {
    return designJsonResponse(
      { error: err.message, code: 'VALIDATION_ERROR' },
      400
    );
  }

  if (err instanceof DesignJobTransitionError) {
    return designJsonResponse(
      {
        error: err.message,
        code: 'INVALID_STATUS_TRANSITION',
        currentStatus: err.currentStatus,
        attemptedStatus: err.attemptedStatus,
      },
      409
    );
  }

  console.error(
    `Design API failure (${context}):`,
    err instanceof Error ? err.name : 'UnknownError'
  );
  return designJsonResponse(
    { error: 'An unexpected server error occurred.' },
    500
  );
}

