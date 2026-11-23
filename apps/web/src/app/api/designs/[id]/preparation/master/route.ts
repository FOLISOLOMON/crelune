import { NextResponse } from 'next/server';
import { requireAuthenticatedOwnerApi } from '@/lib/auth/api-owner-guard';
import {
  handleDesignRouteError,
  parseDesignJobIdOrError,
} from '@/lib/designs/design-http';
import { getPinnedTemplateMasterForDesignJob } from '@/lib/designs/job-preparation-service';

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
    const master = await getPinnedTemplateMasterForDesignJob(
      auth.owner.profile.organisationId,
      idResult.id
    );

    return new NextResponse(Buffer.from(master.body), {
      status: 200,
      headers: {
        'Content-Type': master.mimeType,
        'Content-Length': String(master.byteSize),
        'Content-Disposition': `attachment; filename="${master.filename}"`,
        'X-Content-SHA256': master.sha256,
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
        'X-Robots-Tag': 'noindex, nofollow, noarchive',
      },
    });
  } catch (err) {
    return handleDesignRouteError(
      err,
      'GET /api/designs/[id]/preparation/master'
    );
  }
}
