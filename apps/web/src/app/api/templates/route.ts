import { createTemplateSchema, templateListQuerySchema } from '@crelune/shared';
import {
  parseJsonBodyWithLimit,
  requireAuthenticatedOwnerApi,
} from '@/lib/auth/api-owner-guard';
import {
  handleTemplateRouteError,
  templateJsonResponse,
  templateValidationErrorResponse,
} from '@/lib/templates/template-http';
import { createTemplate, listTemplates } from '@/lib/templates/template-service';

export async function GET(request: Request) {
  const auth = await requireAuthenticatedOwnerApi(request);
  if (!auth.ok) {
    return auth.response;
  }

  const url = new URL(request.url);
  const rawQuery: Record<string, string> = {};
  for (const [key, value] of url.searchParams.entries()) {
    rawQuery[key] = value;
  }

  const parsed = templateListQuerySchema.safeParse(rawQuery);
  if (!parsed.success) {
    return templateValidationErrorResponse(parsed.error);
  }

  try {
    const result = await listTemplates(
      auth.owner.profile.organisationId,
      parsed.data
    );
    return templateJsonResponse(result, 200);
  } catch (err) {
    return handleTemplateRouteError(err, 'GET /api/templates');
  }
}

export async function POST(request: Request) {
  const auth = await requireAuthenticatedOwnerApi(request, { verifyCsrf: true });
  if (!auth.ok) {
    return auth.response;
  }

  const bodyResult = await parseJsonBodyWithLimit(request);
  if (!bodyResult.ok) {
    return bodyResult.response;
  }

  const parsed = createTemplateSchema.safeParse(bodyResult.data);
  if (!parsed.success) {
    return templateValidationErrorResponse(parsed.error);
  }

  try {
    const template = await createTemplate(
      {
        userId: auth.owner.profile.id,
        organisationId: auth.owner.profile.organisationId,
      },
      parsed.data
    );
    return templateJsonResponse({ template }, 201);
  } catch (err) {
    return handleTemplateRouteError(err, 'POST /api/templates');
  }
}

