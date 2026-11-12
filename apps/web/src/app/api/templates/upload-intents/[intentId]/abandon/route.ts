import { requireAuthenticatedOwnerApi } from '@/lib/auth/api-owner-guard';
import {
  handleTemplateRouteError,
  parseTemplateScopedIdOrError,
  templateJsonResponse,
} from '@/lib/templates/template-http';
import { abandonUploadIntent } from '@/lib/templates/template-service';

export async function POST(
  request: Request,
  context: { params: Promise<{ intentId: string }> }
) {
  const auth = await requireAuthenticatedOwnerApi(request, { verifyCsrf: true });
  if (!auth.ok) {
    return auth.response;
  }

  const { intentId: rawIntentId } = await context.params;
  const intentIdResult = parseTemplateScopedIdOrError(rawIntentId);
  if (!intentIdResult.ok) {
    return intentIdResult.response;
  }

  try {
    const intent = await abandonUploadIntent(
      {
        userId: auth.owner.profile.id,
        organisationId: auth.owner.profile.organisationId,
      },
      intentIdResult.id
    );
    return templateJsonResponse({ intent }, 200);
  } catch (err) {
    return handleTemplateRouteError(
      err,
      'POST /api/templates/upload-intents/[intentId]/abandon'
    );
  }
}

