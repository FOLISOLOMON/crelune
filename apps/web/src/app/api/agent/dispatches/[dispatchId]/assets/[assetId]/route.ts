import { NextResponse } from 'next/server';
import {
  extractDispatchClaimToken,
  verifyAgentBearerRequest,
} from '@/lib/agents/agent-auth';
import {
  handleAgentRouteError,
  parseAgentScopedIdOrError,
} from '@/lib/agents/agent-http';
import { streamAgentDispatchAsset } from '@/lib/agents/agent-service';

export async function GET(
  request: Request,
  context: { params: Promise<{ dispatchId: string; assetId: string }> }
) {
  const auth = await verifyAgentBearerRequest(request);
  if (!auth.ok) {
    return auth.response;
  }

  const claim = extractDispatchClaimToken(request);
  if (!claim.ok) {
    return claim.response;
  }

  const { dispatchId: rawDispatchId, assetId: rawAssetId } =
    await context.params;
  const dispatchResult = parseAgentScopedIdOrError(rawDispatchId);
  if (!dispatchResult.ok) {
    return dispatchResult.response;
  }
  const assetResult = parseAgentScopedIdOrError(rawAssetId);
  if (!assetResult.ok) {
    return assetResult.response;
  }

  try {
    const asset = await streamAgentDispatchAsset(
      auth.agent,
      dispatchResult.id,
      assetResult.id,
      claim.claimToken
    );
    return new NextResponse(Buffer.from(asset.body), {
      status: 200,
      headers: {
        'Content-Type': asset.mimeType,
        'Content-Length': String(asset.byteSize),
        'X-Content-SHA256': asset.sha256,
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
        'X-Robots-Tag': 'noindex, nofollow, noarchive',
      },
    });
  } catch (err) {
    return handleAgentRouteError(
      err,
      'GET /api/agent/dispatches/[dispatchId]/assets/[assetId]'
    );
  }
}
