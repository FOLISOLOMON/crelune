import { NextResponse } from 'next/server';
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

    if (!preparation.manifestPreview) {
      return designJsonResponse(
        {
          error:
            preparation.issues[0]?.message ??
            'Design job is not ready to generate a preparation manifest.',
          code: 'JOB_PREPARATION_INVALID',
          preparationIssues: preparation.issues,
        },
        400
      );
    }

    const payload = JSON.stringify(preparation.manifestPreview, null, 2);
    return new NextResponse(payload, {
      status: 200,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename="crelune-job-manifest-${idResult.id}.json"`,
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
        'X-Robots-Tag': 'noindex, nofollow, noarchive',
      },
    });
  } catch (err) {
    return handleDesignRouteError(
      err,
      'GET /api/designs/[id]/preparation/manifest'
    );
  }
}
