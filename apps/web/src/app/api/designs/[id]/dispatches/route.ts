import { createCreativeJobDispatchSchema } from '@crelune/shared';
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
import { createCreativeJobDispatch } from '@/lib/designs/job-preparation-service';

export async function POST(
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

  const rawBody = bodyResult.data;
  if (
    typeof rawBody !== 'object' ||
    rawBody === null ||
    Array.isArray(rawBody)
  ) {
    return designJsonResponse(
      { error: 'Request body must be a JSON object.' },
      400
    );
  }

  const record = rawBody as Record<string, unknown>;
  if (
    typeof record.designJobId === 'string' &&
    record.designJobId.trim().length > 0 &&
    record.designJobId.trim() !== idResult.id
  ) {
    return designJsonResponse(
      { error: 'designJobId in body does not match route design job id.' },
      400
    );
  }

  const parsed = createCreativeJobDispatchSchema.safeParse({
    ...record,
    designJobId: idResult.id,
  });
  if (!parsed.success) {
    return designValidationErrorResponse(parsed.error);
  }

  try {
    const result = await createCreativeJobDispatch(
      {
        userId: auth.owner.profile.id,
        organisationId: auth.owner.profile.organisationId,
      },
      idResult.id,
      parsed.data
    );
    return designJsonResponse(
      result,
      result.idempotentReplay ? 200 : 201
    );
  } catch (err) {
    return handleDesignRouteError(err, 'POST /api/designs/[id]/dispatches');
  }
}
