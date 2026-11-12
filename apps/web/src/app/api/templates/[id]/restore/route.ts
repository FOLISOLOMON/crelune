import { requireAuthenticatedOwnerApi } from '@/lib/auth/api-owner-guard';
import {
  handleTemplateRouteError,
  parseTemplateScopedIdOrError,
  templateJsonResponse,
} from '@/lib/templates/template-http';
import { restoreTemplate } from '@/lib/templates/template-service';

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

  try {
    const template = await restoreTemplate(
      {
        userId: auth.owner.profile.id,
        organisationId: auth.owner.profile.organisationId,
      },
      idResult.id
    );
    return templateJsonResponse({ template }, 200);
  } catch (err) {
    return handleTemplateRouteError(err, 'POST /api/templates/[id]/restore');
  }
}

