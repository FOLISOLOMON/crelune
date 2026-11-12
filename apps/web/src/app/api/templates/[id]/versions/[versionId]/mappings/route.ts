import { upsertTemplateFieldMappingsSchema } from '@crelune/shared';
import {
  parseJsonBodyWithLimit,
  requireAuthenticatedOwnerApi,
} from '@/lib/auth/api-owner-guard';
import {
  handleTemplateRouteError,
  parseTemplateScopedIdOrError,
  templateJsonResponse,
  templateValidationErrorResponse,
} from '@/lib/templates/template-http';
import { upsertTemplateFieldMappings } from '@/lib/templates/template-service';

export async function PUT(
  request: Request,
  context: { params: Promise<{ id: string; versionId: string }> }
) {
  const auth = await requireAuthenticatedOwnerApi(request, { verifyCsrf: true });
  if (!auth.ok) {
    return auth.response;
  }

  const { id: rawId, versionId: rawVersionId } = await context.params;
  const idResult = parseTemplateScopedIdOrError(rawId);
  if (!idResult.ok) {
    return idResult.response;
  }

  const versionIdResult = parseTemplateScopedIdOrError(rawVersionId);
  if (!versionIdResult.ok) {
    return versionIdResult.response;
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
    typeof record.templateVersionId === 'string' &&
    record.templateVersionId.trim().length > 0 &&
    record.templateVersionId.trim() !== versionIdResult.id
  ) {
    return templateJsonResponse(
      {
        error:
          'templateVersionId in body does not match route templateVersionId.',
      },
      400
    );
  }

  const parsed = upsertTemplateFieldMappingsSchema.safeParse({
    ...record,
    templateVersionId: versionIdResult.id,
  });
  if (!parsed.success) {
    return templateValidationErrorResponse(parsed.error);
  }

  try {
    const mappings = await upsertTemplateFieldMappings(
      {
        userId: auth.owner.profile.id,
        organisationId: auth.owner.profile.organisationId,
      },
      idResult.id,
      parsed.data
    );
    return templateJsonResponse({ mappings }, 200);
  } catch (err) {
    return handleTemplateRouteError(
      err,
      'PUT /api/templates/[id]/versions/[versionId]/mappings'
    );
  }
}

