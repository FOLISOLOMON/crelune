import { registerCreativeAgentSchema } from '@crelune/shared';
import {
  parseJsonBodyWithLimit,
  requireAuthenticatedOwnerApi,
} from '@/lib/auth/api-owner-guard';
import {
  agentJsonResponse,
  agentValidationErrorResponse,
  handleAgentRouteError,
} from '@/lib/agents/agent-http';
import {
  listCreativeAgents,
  registerCreativeAgent,
} from '@/lib/agents/agent-service';

export async function GET(request: Request) {
  const auth = await requireAuthenticatedOwnerApi(request);
  if (!auth.ok) {
    return auth.response;
  }

  try {
    const agents = await listCreativeAgents(auth.owner.profile.organisationId);
    return agentJsonResponse({ agents }, 200);
  } catch (err) {
    return handleAgentRouteError(err, 'GET /api/agents');
  }
}

export async function POST(request: Request) {
  const auth = await requireAuthenticatedOwnerApi(request, { verifyCsrf: true });
  if (!auth.ok) {
    return auth.response;
  }

  const bodyResult = await parseJsonBodyWithLimit(request);
  if (!bodyResult.ok) {
    return bodyResult.response;
  }

  const parsed = registerCreativeAgentSchema.safeParse(bodyResult.data);
  if (!parsed.success) {
    return agentValidationErrorResponse(parsed.error);
  }

  try {
    const result = await registerCreativeAgent(
      {
        userId: auth.owner.profile.id,
        organisationId: auth.owner.profile.organisationId,
      },
      parsed.data
    );
    return agentJsonResponse(result, 201);
  } catch (err) {
    return handleAgentRouteError(err, 'POST /api/agents');
  }
}
