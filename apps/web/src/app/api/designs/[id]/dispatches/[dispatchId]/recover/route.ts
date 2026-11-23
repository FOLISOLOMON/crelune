import { recoverCreativeJobDispatchSchema } from '@crelune/shared';
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
import { recoverCreativeJobDispatch } from '@/lib/designs/job-preparation-service';

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string; dispatchId: string }> }
) {
  const auth = await requireAuthenticatedOwnerApi(request, { verifyCsrf: true });
  if (!auth.ok) {
    return auth.response;
  }

  const { id: rawJobId, dispatchId: rawDispatchId } = await context.params;
  const jobIdResult = parseDesignJobIdOrError(rawJobId);
  if (!jobIdResult.ok) {
    return jobIdResult.response;
  }
  const dispatchIdResult = parseDesignJobIdOrError(rawDispatchId);
  if (!dispatchIdResult.ok) {
    return dispatchIdResult.response;
  }

  const bodyResult = await parseJsonBodyWithLimit(request);
  if (!bodyResult.ok) {
    return bodyResult.response;
  }

  const parsed = recoverCreativeJobDispatchSchema.safeParse(bodyResult.data);
  if (!parsed.success) {
    return designValidationErrorResponse(parsed.error);
  }

  try {
    const dispatch = await recoverCreativeJobDispatch(
      {
        userId: auth.owner.profile.id,
        organisationId: auth.owner.profile.organisationId,
      },
      jobIdResult.id,
      dispatchIdResult.id,
      parsed.data
    );
    return designJsonResponse({ dispatch }, 200);
  } catch (err) {
    return handleDesignRouteError(
      err,
      'POST /api/designs/[id]/dispatches/[dispatchId]/recover'
    );
  }
}
