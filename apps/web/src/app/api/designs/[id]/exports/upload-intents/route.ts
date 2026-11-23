import { createExportUploadIntentSchema } from '@crelune/shared';
import {
  parseJsonBodyWithLimit,
  requireAuthenticatedOwnerApi,
} from '@/lib/auth/api-owner-guard';
import { consumeUploadIntentRateLimit } from '@/lib/auth/rate-limit';
import {
  designJsonResponse,
  designValidationErrorResponse,
  handleDesignRouteError,
  parseDesignJobIdOrError,
} from '@/lib/designs/design-http';
import { createExportDeliverableUploadIntent } from '@/lib/designs/job-preparation-service';

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuthenticatedOwnerApi(request, { verifyCsrf: true });
  if (!auth.ok) {
    return auth.response;
  }

  const { id: rawId } = await context.params;
  const idResult = parseDesignJobIdOrError(rawId);
  if (!idResult.ok) {
    return idResult.response;
  }

  const rateLimit = await consumeUploadIntentRateLimit(
    auth.owner.profile.organisationId,
    auth.owner.profile.id
  );
  if (!rateLimit.allowed) {
    return designJsonResponse(
      {
        error:
          'Too many upload intent requests. Please wait briefly before trying again.',
        blockedUntil: rateLimit.blockedUntil?.toISOString() ?? null,
      },
      429
    );
  }

  const bodyResult = await parseJsonBodyWithLimit(request);
  if (!bodyResult.ok) {
    return bodyResult.response;
  }

  const rawBody = bodyResult.data;
  if (
    typeof rawBody !== 'object' ||
    rawBody === null ||
    Array.isArray(rawBody)
  ) {
    return designJsonResponse(
      { error: 'Request body must be a JSON object.' },
      400
    );
  }

  const parsed = createExportUploadIntentSchema.safeParse({
    ...(rawBody as Record<string, unknown>),
    designJobId: idResult.id,
  });
  if (!parsed.success) {
    return designValidationErrorResponse(parsed.error);
  }

  try {
    const result = await createExportDeliverableUploadIntent(
      {
        organisationId: auth.owner.profile.organisationId,
        userId: auth.owner.profile.id,
      },
      parsed.data
    );
    return designJsonResponse(result, 201);
  } catch (err) {
    return handleDesignRouteError(
      err,
      'POST /api/designs/[id]/exports/upload-intents'
    );
  }
}
