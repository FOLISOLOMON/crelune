import { requireAuthenticatedOwnerApi } from '@/lib/auth/api-owner-guard';
import {
  designJsonResponse,
  handleDesignRouteError,
  parseDesignJobIdOrError,
} from '@/lib/designs/design-http';
import { getDesignJobPreparationSnapshot } from '@/lib/designs/job-preparation-service';

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
    const preparation = await getDesignJobPreparationSnapshot(
      {
        userId: auth.owner.profile.id,
        organisationId: auth.owner.profile.organisationId,
      },
      idResult.id
    );
    return designJsonResponse({ preparation }, 200);
  } catch (err) {
    return handleDesignRouteError(err, 'GET /api/designs/[id]/preparation');
  }
}
