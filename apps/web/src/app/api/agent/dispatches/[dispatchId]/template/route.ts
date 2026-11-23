import { NextResponse } from 'next/server';
import { verifyAgentBearerRequest } from '@/lib/agents/agent-auth';
import {
  handleAgentRouteError,
  parseAgentScopedIdOrError,
} from '@/lib/agents/agent-http';
import { streamAgentDispatchTemplateMaster } from '@/lib/agents/agent-service';

export async function GET(
  request: Request,
  context: { params: Promise<{ dispatchId: string }> }
) {
  const auth = await verifyAgentBearerRequest(request);
  if (!auth.ok) {
    return auth.response;
  }

  const { dispatchId: rawDispatchId } = await context.params;
  const idResult = parseAgentScopedIdOrError(rawDispatchId);
  if (!idResult.ok) {
    return idResult.response;
  }

  try {
    const master = await streamAgentDispatchTemplateMaster(
      auth.agent,
      idResult.id
    );
    return new NextResponse(Buffer.from(master.body), {
      status: 200,
      headers: {
        'Content-Type': master.mimeType,
        'Content-Length': String(master.byteSize),
        'X-Content-SHA256': master.sha256,
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
        'X-Robots-Tag': 'noindex, nofollow, noarchive',
      },
    });
  } catch (err) {
    return handleAgentRouteError(
      err,
      'GET /api/agent/dispatches/[dispatchId]/template'
    );
  }
}
