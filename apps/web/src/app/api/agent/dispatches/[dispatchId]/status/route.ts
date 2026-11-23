import { updateCreativeDispatchStatusSchema } from '@crelune/shared';
import { parseJsonBodyWithLimit } from '@/lib/auth/api-owner-guard';
import { verifyAgentBearerRequest } from '@/lib/agents/agent-auth';
import {
  agentJsonResponse,
  agentValidationErrorResponse,
  handleAgentRouteError,
  parseAgentScopedIdOrError,
} from '@/lib/agents/agent-http';
import { updateAgentDispatchStatus } from '@/lib/agents/agent-service';

export async function POST(
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

  const bodyResult = await parseJsonBodyWithLimit(request);
  if (!bodyResult.ok) {
    return bodyResult.response;
  }

  const parsed = updateCreativeDispatchStatusSchema.safeParse(bodyResult.data);
  if (!parsed.success) {
    return agentValidationErrorResponse(parsed.error);
  }

  try {
    const result = await updateAgentDispatchStatus(
      auth.agent,
      idResult.id,
      parsed.data
    );
    return agentJsonResponse(result, 200);
  } catch (err) {
    return handleAgentRouteError(
      err,
      'POST /api/agent/dispatches/[dispatchId]/status'
    );
  }
}
