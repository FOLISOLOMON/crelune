import { creativeAgentHeartbeatSchema } from '@crelune/shared';
import { parseJsonBodyWithLimit } from '@/lib/auth/api-owner-guard';
import { verifyAgentBearerRequest } from '@/lib/agents/agent-auth';
import {
  agentJsonResponse,
  agentValidationErrorResponse,
  handleAgentRouteError,
} from '@/lib/agents/agent-http';
import { recordAgentHeartbeat } from '@/lib/agents/agent-service';

export async function POST(request: Request) {
  const auth = await verifyAgentBearerRequest(request);
  if (!auth.ok) {
    return auth.response;
  }

  const bodyResult = await parseJsonBodyWithLimit(request);
  if (!bodyResult.ok) {
    return bodyResult.response;
  }

  const parsed = creativeAgentHeartbeatSchema.safeParse(bodyResult.data);
  if (!parsed.success) {
    return agentValidationErrorResponse(parsed.error);
  }

  try {
    const agent = await recordAgentHeartbeat(auth.agent, parsed.data);
    return agentJsonResponse({ agent, serverTime: new Date().toISOString() }, 200);
  } catch (err) {
    return handleAgentRouteError(err, 'POST /api/agent/heartbeat');
  }
}
