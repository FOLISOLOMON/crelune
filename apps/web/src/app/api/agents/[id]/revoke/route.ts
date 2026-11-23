import { revokeCreativeAgentSchema } from '@crelune/shared';
import {
  parseJsonBodyWithLimit,
  requireAuthenticatedOwnerApi,
} from '@/lib/auth/api-owner-guard';
import {
  agentJsonResponse,
  agentValidationErrorResponse,
  handleAgentRouteError,
  parseAgentScopedIdOrError,
} from '@/lib/agents/agent-http';
import { revokeCreativeAgent } from '@/lib/agents/agent-service';

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuthenticatedOwnerApi(request, { verifyCsrf: true });
  if (!auth.ok) {
    return auth.response;
  }

  const { id: rawId } = await context.params;
  const idResult = parseAgentScopedIdOrError(rawId);
  if (!idResult.ok) {
    return idResult.response;
  }

  const bodyResult = await parseJsonBodyWithLimit(request);
  if (!bodyResult.ok) {
    return bodyResult.response;
  }

  const parsed = revokeCreativeAgentSchema.safeParse(bodyResult.data);
  if (!parsed.success) {
    return agentValidationErrorResponse(parsed.error);
  }

  try {
    const agent = await revokeCreativeAgent(
      {
        userId: auth.owner.profile.id,
        organisationId: auth.owner.profile.organisationId,
      },
      idResult.id,
      parsed.data
    );
    return agentJsonResponse({ agent }, 200);
  } catch (err) {
    return handleAgentRouteError(err, 'POST /api/agents/[id]/revoke');
  }
}
