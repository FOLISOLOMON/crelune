import { NextResponse } from 'next/server';
import { requireAuthenticatedOwnerApi } from '@/lib/auth/api-owner-guard';
import {
  handleDesignRouteError,
  parseDesignJobIdOrError,
} from '@/lib/designs/design-http';
import { getExportDeliverableFile } from '@/lib/designs/job-preparation-service';

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string; exportId: string }> }
) {
  const auth = await requireAuthenticatedOwnerApi(request);
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

  try {
    const file = await getExportDeliverableFile(
      auth.owner.profile.organisationId,
      idResult.id,
      exportIdResult.id
    );

    return new NextResponse(Buffer.from(file.body), {
      status: 200,
      headers: {
        'Content-Type': file.mimeType,
        'Content-Length': String(file.byteSize),
        'Content-Disposition': `inline; filename="${file.filename}"`,
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
        'X-Robots-Tag': 'noindex, nofollow, noarchive',
      },
    });
  } catch (err) {
    return handleDesignRouteError(
      err,
      'GET /api/designs/[id]/exports/[exportId]/file'
    );
  }
}
