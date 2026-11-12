/**
 * CRELUNE — Shared HTTP Helpers for Template Backend API Routes
 */

import { NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { templateIdParamSchema } from '@crelune/shared';
import { StorageKeyViolationError } from '@/lib/storage/storage-config';
import {
  TemplateConflictError,
  TemplateNotFoundError,
  TemplateValidationError,
  TemplateVersionNotFoundError,
  UploadIntentConflictError,
  UploadIntentExpiredError,
  UploadIntentNotFoundError,
} from '@/lib/templates/template-service';

const PRIVATE_NO_STORE_HEADERS = {
  'Cache-Control': 'private, no-store',
};

export function templateJsonResponse(
  body: unknown,
  status: number = 200
): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: PRIVATE_NO_STORE_HEADERS,
  });
}

export function templateValidationErrorResponse(error: ZodError): NextResponse {
  const firstIssue = error.issues[0];
  return templateJsonResponse(
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

export function parseTemplateScopedIdOrError(
  rawId: string
): { ok: true; id: string } | { ok: false; response: NextResponse } {
  const parsed = templateIdParamSchema.safeParse(rawId);
  if (!parsed.success) {
    return { ok: false, response: templateValidationErrorResponse(parsed.error) };
  }
  return { ok: true, id: parsed.data };
}

export function handleTemplateRouteError(
  err: unknown,
  context: string
): NextResponse {
  if (err instanceof TemplateNotFoundError) {
    return templateJsonResponse({ error: 'Template not found' }, 404);
  }

  if (err instanceof TemplateVersionNotFoundError) {
    return templateJsonResponse({ error: 'Template version not found' }, 404);
  }

  if (err instanceof UploadIntentNotFoundError) {
    return templateJsonResponse({ error: 'Upload intent not found' }, 404);
  }

  if (err instanceof UploadIntentExpiredError) {
    return templateJsonResponse(
      { error: err.message, code: 'UPLOAD_INTENT_EXPIRED' },
      410
    );
  }

  if (err instanceof TemplateValidationError) {
    return templateJsonResponse(
      { error: err.message, code: err.code },
      400
    );
  }

  if (
    err instanceof TemplateConflictError ||
    err instanceof UploadIntentConflictError
  ) {
    return templateJsonResponse(
      { error: err.message, code: err.code },
      409
    );
  }

  if (err instanceof StorageKeyViolationError) {
    return templateJsonResponse(
      { error: 'Invalid creative storage scope', code: 'STORAGE_SCOPE_ERROR' },
      400
    );
  }

  console.error(
    `Template API failure (${context}):`,
    err instanceof Error ? err.name : 'UnknownError'
  );
  return templateJsonResponse(
    { error: 'An unexpected server error occurred.' },
    500
  );
}

