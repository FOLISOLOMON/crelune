import { nonFilesystemTextSchema } from '@crelune/shared';
import { z } from 'zod';
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
import { cancelCreativeJobDispatch } from '@/lib/designs/job-preparation-service';

const cancelBodySchema = z
  .object({
    reason: nonFilesystemTextSchema(300).nullable().optional(),
  })
  .strict();

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string; dispatchId: string }> }
) {
  const auth = await requireAuthenticatedOwnerApi(request, { verifyCsrf: true });
  if (!auth.ok) {
    return auth.response;
  }

  const { id: rawId, dispatchId: rawDispatchId } = await context.params;
  const idResult = parseDesignJobIdOrError(rawId);
  if (!idResult.ok) {
    return idResult.response;
  }
  const dispatchIdResult = parseDesignJobIdOrError(rawDispatchId);
  if (!dispatchIdResult.ok) {
    return dispatchIdResult.response;
  }

  let reason: string | null = null;
  const contentLength = request.headers.get('content-length');
  if (contentLength && Number(contentLength) > 0) {
    const bodyResult = await parseJsonBodyWithLimit(request);
    if (!bodyResult.ok) {
      return bodyResult.response;
    }
    const parsed = cancelBodySchema.safeParse(bodyResult.data);
    if (!parsed.success) {
      return designValidationErrorResponse(parsed.error);
    }
    reason = parsed.data.reason ?? null;
  }

  try {
    const dispatch = await cancelCreativeJobDispatch(
      {
        userId: auth.owner.profile.id,
        organisationId: auth.owner.profile.organisationId,
      },
      idResult.id,
      dispatchIdResult.id,
      reason
    );
    return designJsonResponse({ dispatch }, 200);
  } catch (err) {
    return handleDesignRouteError(
      err,
      'POST /api/designs/[id]/dispatches/[dispatchId]/cancel'
    );
  }
}
