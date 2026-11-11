import { updateDesignJobSchema } from '@crelune/shared';
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
import {
  getDesignJobById,
  updateDesignJob,
} from '@/lib/designs/design-job-service';

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuthenticatedOwnerApi(request);
  if (!auth.ok) {
    return auth.response;
  }

  const { id: rawId } = await context.params;
  const idResult = parseDesignJobIdOrError(rawId);
  if (!idResult.ok) {
    return idResult.response;
  }

  try {
    const job = await getDesignJobById(
      auth.owner.profile.organisationId,
      idResult.id
    );
    return designJsonResponse({ job }, 200);
  } catch (err) {
    return handleDesignRouteError(err, 'GET /api/designs/[id]');
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
  const idResult = parseDesignJobIdOrError(rawId);
  if (!idResult.ok) {
    return idResult.response;
  }

  const bodyResult = await parseJsonBodyWithLimit(request);
  if (!bodyResult.ok) {
    return bodyResult.response;
  }

  const parsedBody = updateDesignJobSchema.safeParse(bodyResult.data);
  if (!parsedBody.success) {
    return designValidationErrorResponse(parsedBody.error);
  }

  try {
    const job = await updateDesignJob(
      {
        userId: auth.owner.profile.id,
        organisationId: auth.owner.profile.organisationId,
      },
      idResult.id,
      parsedBody.data
    );
    return designJsonResponse({ job }, 200);
  } catch (err) {
    return handleDesignRouteError(err, 'PATCH /api/designs/[id]');
  }
}

