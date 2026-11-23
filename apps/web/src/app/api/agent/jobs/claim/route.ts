import { verifyAgentBearerRequest } from '@/lib/agents/agent-auth';
import {
  agentJsonResponse,
  handleAgentRouteError,
} from '@/lib/agents/agent-http';
import { claimNextCreativeDispatch } from '@/lib/agents/agent-service';

export async function POST(request: Request) {
  const auth = await verifyAgentBearerRequest(request);
  if (!auth.ok) {
    return auth.response;
  }

  try {
    const result = await claimNextCreativeDispatch(auth.agent);
    return agentJsonResponse(result, 200);
  } catch (err) {
    return handleAgentRouteError(err, 'POST /api/agent/jobs/claim');
  }
}
