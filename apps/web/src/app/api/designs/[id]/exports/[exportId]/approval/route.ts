import { approveExportForPublishSchema } from '@crelune/shared';
import {
  parseJsonBodyWithLimit,
  requireAuthenticatedOwnerApi,
} from '@/lib/auth/api-owner-guard';
import {
  designJsonResponse,
  designValidationErrorResponse,
  handleDesignRouteError,
  parseDesignJobIdOrError,
} from '@/lib/designs/design-http';
import { setExportPublishApproval } from '@/lib/designs/job-preparation-service';

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string; exportId: string }> }
) {
  const auth = await requireAuthenticatedOwnerApi(request, { verifyCsrf: true });
  if (!auth.ok) {
    return auth.response;
  }

  const { id: rawId, exportId: rawExportId } = await context.params;
  const idResult = parseDesignJobIdOrError(rawId);
  if (!idResult.ok) {
    return idResult.response;
  }
  const exportIdResult = parseDesignJobIdOrError(rawExportId);
  if (!exportIdResult.ok) {
    return exportIdResult.response;
  }

  const bodyResult = await parseJsonBodyWithLimit(request);
  if (!bodyResult.ok) {
    return bodyResult.response;
  }

  const parsed = approveExportForPublishSchema.safeParse(bodyResult.data);
  if (!parsed.success) {
    return designValidationErrorResponse(parsed.error);
  }

  try {
    const exportRecord = await setExportPublishApproval(
      {
        userId: auth.owner.profile.id,
        organisationId: auth.owner.profile.organisationId,
      },
      idResult.id,
      exportIdResult.id,
      parsed.data
    );
    return designJsonResponse({ exportRecord }, 200);
  } catch (err) {
    return handleDesignRouteError(
      err,
      'PATCH /api/designs/[id]/exports/[exportId]/approval'
    );
  }
}
