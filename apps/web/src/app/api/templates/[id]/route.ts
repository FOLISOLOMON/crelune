import { updateTemplateSchema } from '@crelune/shared';
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
import {
  getTemplateDetail,
  updateTemplate,
} from '@/lib/templates/template-service';

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuthenticatedOwnerApi(request);
  if (!auth.ok) {
    return auth.response;
  }

  const { id: rawId } = await context.params;
  const idResult = parseTemplateScopedIdOrError(rawId);
  if (!idResult.ok) {
    return idResult.response;
  }

  try {
    const template = await getTemplateDetail(
      auth.owner.profile.organisationId,
      idResult.id
    );
    return templateJsonResponse({ template }, 200);
  } catch (err) {
    return handleTemplateRouteError(err, 'GET /api/templates/[id]');
  }
}

export async function PATCH(
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

  const bodyResult = await parseJsonBodyWithLimit(request);
  if (!bodyResult.ok) {
    return bodyResult.response;
  }

  const parsed = updateTemplateSchema.safeParse(bodyResult.data);
  if (!parsed.success) {
    return templateValidationErrorResponse(parsed.error);
  }

  try {
    const template = await updateTemplate(
      {
        userId: auth.owner.profile.id,
        organisationId: auth.owner.profile.organisationId,
      },
      idResult.id,
      parsed.data
    );
    return templateJsonResponse({ template }, 200);
  } catch (err) {
    return handleTemplateRouteError(err, 'PATCH /api/templates/[id]');
  }
}

