import { createTemplateUploadIntentRequestSchema } from '@crelune/shared';
import {
  parseJsonBodyWithLimit,
  requireAuthenticatedOwnerApi,
} from '@/lib/auth/api-owner-guard';
import { consumeUploadIntentRateLimit } from '@/lib/auth/rate-limit';
import {
  handleTemplateRouteError,
  parseTemplateScopedIdOrError,
  templateJsonResponse,
  templateValidationErrorResponse,
} from '@/lib/templates/template-http';
import { createTemplateUploadIntent } from '@/lib/templates/template-service';

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuthenticatedOwnerApi(request, { verifyCsrf: true });
  if (!auth.ok) {
    return auth.response;
  }

  const { id: rawId } = await context.params;
  const idResult = parseTemplateScopedIdOrError(rawId);
  if (!idResult.ok) {
    return idResult.response;
  }

  const rateLimit = await consumeUploadIntentRateLimit(
    auth.owner.profile.organisationId,
    auth.owner.profile.id
  );
  if (!rateLimit.allowed) {
    return templateJsonResponse(
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
    return templateJsonResponse(
      { error: 'Request body must be a JSON object.' },
      400
    );
  }

  const record = rawBody as Record<string, unknown>;
  if (
    typeof record.templateId === 'string' &&
    record.templateId.trim().length > 0 &&
    record.templateId.trim() !== idResult.id
  ) {
    return templateJsonResponse(
      { error: 'templateId in body does not match route template id.' },
      400
    );
  }

  const parsed = createTemplateUploadIntentRequestSchema.safeParse({
    ...record,
    templateId: idResult.id,
  });
  if (!parsed.success) {
    return templateValidationErrorResponse(parsed.error);
  }

  try {
    const result = await createTemplateUploadIntent(
      {
        userId: auth.owner.profile.id,
        organisationId: auth.owner.profile.organisationId,
      },
      parsed.data
    );
    return templateJsonResponse(result, 201);
  } catch (err) {
    return handleTemplateRouteError(
      err,
      'POST /api/templates/[id]/upload-intents'
    );
  }
}

