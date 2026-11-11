import {
  createDesignJobSchema,
  designJobListQuerySchema,
} from '@crelune/shared';
import {
  parseJsonBodyWithLimit,
  requireAuthenticatedOwnerApi,
} from '@/lib/auth/api-owner-guard';
import {
  designJsonResponse,
  designValidationErrorResponse,
  handleDesignRouteError,
} from '@/lib/designs/design-http';
import {
  createDesignJob,
  listDesignJobs,
} from '@/lib/designs/design-job-service';

export async function GET(request: Request) {
  const auth = await requireAuthenticatedOwnerApi(request);
  if (!auth.ok) {
    return auth.response;
  }

  const url = new URL(request.url);
  const rawQuery: Record<string, string> = {};
  for (const [key, value] of url.searchParams.entries()) {
    rawQuery[key] = value;
  }

  const parsedQuery = designJobListQuerySchema.safeParse(rawQuery);
  if (!parsedQuery.success) {
    return designValidationErrorResponse(parsedQuery.error);
  }

  try {
    const result = await listDesignJobs(
      auth.owner.profile.organisationId,
      parsedQuery.data
    );
    return designJsonResponse(result, 200);
  } catch (err) {
    return handleDesignRouteError(err, 'GET /api/designs');
  }
}

export async function POST(request: Request) {
  const auth = await requireAuthenticatedOwnerApi(request, { verifyCsrf: true });
  if (!auth.ok) {
    return auth.response;
  }

  const bodyResult = await parseJsonBodyWithLimit(request);
  if (!bodyResult.ok) {
    return bodyResult.response;
  }

  const parsedBody = createDesignJobSchema.safeParse(bodyResult.data);
  if (!parsedBody.success) {
    return designValidationErrorResponse(parsedBody.error);
  }

  try {
    const job = await createDesignJob(
      {
        userId: auth.owner.profile.id,
        organisationId: auth.owner.profile.organisationId,
      },
      parsedBody.data
    );
    return designJsonResponse({ job }, 201);
  } catch (err) {
    return handleDesignRouteError(err, 'POST /api/designs');
  }
}

