import {
  extractDispatchClaimToken,
  verifyAgentBearerRequest,
} from '@/lib/agents/agent-auth';
import {
  agentJsonResponse,
  handleAgentRouteError,
  parseAgentScopedIdOrError,
} from '@/lib/agents/agent-http';
import { renewAgentDispatchLease } from '@/lib/agents/agent-service';

export async function POST(
  request: Request,
  context: { params: Promise<{ dispatchId: string }> }
) {
  const auth = await verifyAgentBearerRequest(request);
  if (!auth.ok) {
    return auth.response;
  }

  const claim = extractDispatchClaimToken(request);
  if (!claim.ok) {
    return claim.response;
  }

  const { dispatchId: rawDispatchId } = await context.params;
  const idResult = parseAgentScopedIdOrError(rawDispatchId);
  if (!idResult.ok) {
    return idResult.response;
  }

  try {
    const result = await renewAgentDispatchLease(
      auth.agent,
      idResult.id,
      claim.claimToken
    );
    return agentJsonResponse(result, 200);
  } catch (err) {
    return handleAgentRouteError(
      err,
      'POST /api/agent/dispatches/[dispatchId]/lease'
    );
  }
}
