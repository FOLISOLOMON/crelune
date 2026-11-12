import { requireAuthenticatedOwnerApi } from '@/lib/auth/api-owner-guard';
import {
  handleTemplateRouteError,
  parseTemplateScopedIdOrError,
  templateJsonResponse,
} from '@/lib/templates/template-http';
import { getTemplateVersionDetail } from '@/lib/templates/template-service';

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string; versionId: string }> }
) {
  const auth = await requireAuthenticatedOwnerApi(request);
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

  try {
    const version = await getTemplateVersionDetail(
      auth.owner.profile.organisationId,
      idResult.id,
      versionIdResult.id
    );
    return templateJsonResponse({ version }, 200);
  } catch (err) {
    return handleTemplateRouteError(
      err,
      'GET /api/templates/[id]/versions/[versionId]'
    );
  }
}

