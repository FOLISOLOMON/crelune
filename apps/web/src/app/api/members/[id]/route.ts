import { updateMemberSchema } from '@crelune/shared';
import {
  parseJsonBodyWithLimit,
  requireAuthenticatedOwnerApi,
} from '@/lib/auth/api-owner-guard';
import {
  handleMemberRouteError,
  memberJsonResponse,
  parseMemberIdOrError,
  zodValidationErrorResponse,
} from '@/lib/members/member-http';
import { getMemberById, updateMember } from '@/lib/members/member-service';

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuthenticatedOwnerApi(request);
  if (!auth.ok) {
    return auth.response;
  }

  const { id: rawId } = await context.params;
  const idResult = parseMemberIdOrError(rawId);
  if (!idResult.ok) {
    return idResult.response;
  }

  try {
    const member = await getMemberById(
      auth.owner.profile.organisationId,
      idResult.id
    );
    return memberJsonResponse({ member }, 200);
  } catch (err) {
    return handleMemberRouteError(err, 'GET /api/members/[id]');
  }
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuthenticatedOwnerApi(request, { verifyCsrf: true });
  if (!auth.ok) {
    return auth.response;
  }

  const { id: rawId } = await context.params;
  const idResult = parseMemberIdOrError(rawId);
  if (!idResult.ok) {
    return idResult.response;
  }

  const bodyResult = await parseJsonBodyWithLimit(request);
  if (!bodyResult.ok) {
    return bodyResult.response;
  }

  const parsedInput = updateMemberSchema.safeParse(bodyResult.data);
  if (!parsedInput.success) {
    return zodValidationErrorResponse(parsedInput.error);
  }

  try {
    const member = await updateMember(
      {
        userId: auth.owner.profile.id,
        organisationId: auth.owner.profile.organisationId,
      },
      idResult.id,
      parsedInput.data
    );
    return memberJsonResponse({ member }, 200);
  } catch (err) {
    return handleMemberRouteError(err, 'PATCH /api/members/[id]');
  }
}
