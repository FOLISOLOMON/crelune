import { NextResponse } from 'next/server';
import { requireAuthenticatedOwnerApi } from '@/lib/auth/api-owner-guard';
import {
  handleTemplateRouteError,
  parseTemplateScopedIdOrError,
} from '@/lib/templates/template-http';
import { getTemplateVersionPreview } from '@/lib/templates/template-service';

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string; versionId: string }> }
) {
  const auth = await requireAuthenticatedOwnerApi(request);
  if (!auth.ok) {
    return auth.response;
  }

  const { id: rawId, versionId: rawVersionId } = await context.params;
  const idResult = parseTemplateScopedIdOrError(rawId);
  if (!idResult.ok) {
    return idResult.response;
  }

  const versionIdResult = parseTemplateScopedIdOrError(rawVersionId);
  if (!versionIdResult.ok) {
    return versionIdResult.response;
  }

  try {
    const preview = await getTemplateVersionPreview(
      auth.owner.profile.organisationId,
      idResult.id,
      versionIdResult.id
    );

    return new NextResponse(Buffer.from(preview.body), {
      status: 200,
      headers: {
        'Content-Type': preview.mimeType,
        'Content-Length': String(preview.byteSize),
        'Content-Disposition': 'inline',
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
        'X-Robots-Tag': 'noindex, nofollow, noarchive',
      },
    });
  } catch (err) {
    return handleTemplateRouteError(
      err,
      'GET /api/templates/[id]/versions/[versionId]/preview'
    );
  }
}

