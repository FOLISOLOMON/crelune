import { completeTemplateVersionUploadSchema } from '@crelune/shared';
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
import { completeTemplateVersionUpload } from '@/lib/templates/template-service';

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

  const bodyResult = await parseJsonBodyWithLimit(request);
  if (!bodyResult.ok) {
    return bodyResult.response;
  }

  const parsed = completeTemplateVersionUploadSchema.safeParse(bodyResult.data);
  if (!parsed.success) {
    return templateValidationErrorResponse(parsed.error);
  }

  try {
    const version = await completeTemplateVersionUpload(
      {
        userId: auth.owner.profile.id,
        organisationId: auth.owner.profile.organisationId,
      },
      idResult.id,
      parsed.data
    );
    return templateJsonResponse({ version }, 201);
  } catch (err) {
    return handleTemplateRouteError(err, 'POST /api/templates/[id]/versions');
  }
}

