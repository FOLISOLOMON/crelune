import { createExportUploadIntentSchema } from '@crelune/shared';
import { parseJsonBodyWithLimit } from '@/lib/auth/api-owner-guard';
import { verifyAgentBearerRequest } from '@/lib/agents/agent-auth';
import {
  agentJsonResponse,
  agentValidationErrorResponse,
  handleAgentRouteError,
  parseAgentScopedIdOrError,
} from '@/lib/agents/agent-http';
import { createAgentExportUploadIntent } from '@/lib/agents/agent-service';

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

  const rawBody = bodyResult.data;
  if (
    typeof rawBody !== 'object' ||
    rawBody === null ||
    Array.isArray(rawBody)
  ) {
    return agentJsonResponse(
      { error: 'Request body must be a JSON object.' },
      400
    );
  }

  const parsed = createExportUploadIntentSchema.safeParse({
    ...(rawBody as Record<string, unknown>),
    dispatchId: idResult.id,
  });
  if (!parsed.success) {
    return agentValidationErrorResponse(parsed.error);
  }

  try {
    const result = await createAgentExportUploadIntent(
      auth.agent,
      idResult.id,
      parsed.data
    );
    return agentJsonResponse(result, 201);
  } catch (err) {
    return handleAgentRouteError(
      err,
      'POST /api/agent/dispatches/[dispatchId]/exports/upload-intents'
    );
  }
}
