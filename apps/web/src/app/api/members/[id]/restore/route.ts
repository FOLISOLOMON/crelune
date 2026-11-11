import { requireAuthenticatedOwnerApi } from '@/lib/auth/api-owner-guard';
import {
  handleMemberRouteError,
  memberJsonResponse,
  parseMemberIdOrError,
} from '@/lib/members/member-http';
import { restoreMember } from '@/lib/members/member-service';

export async function POST(
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

  try {
    const result = await restoreMember(
      {
        userId: auth.owner.profile.id,
        organisationId: auth.owner.profile.organisationId,
      },
      idResult.id
    );
    return memberJsonResponse(result, 200);
  } catch (err) {
    return handleMemberRouteError(err, 'POST /api/members/[id]/restore');
  }
}
