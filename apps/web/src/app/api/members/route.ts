import {
  createMemberSchema,
  memberListQuerySchema,
} from '@crelune/shared';
import {
  parseJsonBodyWithLimit,
  requireAuthenticatedOwnerApi,
} from '@/lib/auth/api-owner-guard';
import {
  handleMemberRouteError,
  memberJsonResponse,
  zodValidationErrorResponse,
} from '@/lib/members/member-http';
import { createMember, listMembers } from '@/lib/members/member-service';

export async function GET(request: Request) {
  const auth = await requireAuthenticatedOwnerApi(request);
  if (!auth.ok) {
    return auth.response;
  }

  const url = new URL(request.url);
  const rawQuery: Record<string, string> = {};
  for (const [key, value] of url.searchParams.entries()) {
    rawQuery[key] = value;
  }

  const parsedQuery = memberListQuerySchema.safeParse(rawQuery);
  if (!parsedQuery.success) {
    return zodValidationErrorResponse(parsedQuery.error);
  }

  try {
    const result = await listMembers(
      auth.owner.profile.organisationId,
      parsedQuery.data
    );
    return memberJsonResponse(result, 200);
  } catch (err) {
    return handleMemberRouteError(err, 'GET /api/members');
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

  const parsedInput = createMemberSchema.safeParse(bodyResult.data);
  if (!parsedInput.success) {
    return zodValidationErrorResponse(parsedInput.error);
  }

  try {
    const member = await createMember(
      {
        userId: auth.owner.profile.id,
        organisationId: auth.owner.profile.organisationId,
      },
      parsedInput.data
    );

    return memberJsonResponse({ member }, 201);
  } catch (err) {
    return handleMemberRouteError(err, 'POST /api/members');
  }
}
