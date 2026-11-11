import {
  birthdayPrepStatusUpdateSchema,
  birthdayPrepTargetYearParamSchema,
  memberIdParamSchema,
} from '@crelune/shared';
import {
  parseJsonBodyWithLimit,
  requireAuthenticatedOwnerApi,
} from '@/lib/auth/api-owner-guard';
import {
  birthdayValidationErrorResponse,
  handleBirthdayRouteError,
  privateJsonResponse,
} from '@/lib/birthdays/birthday-http';
import { updateBirthdayPreparationStatus } from '@/lib/birthdays/birthday-overview-service';

export async function PATCH(
  request: Request,
  context: { params: Promise<{ memberId: string; targetYear: string }> }
) {
  const auth = await requireAuthenticatedOwnerApi(request, { verifyCsrf: true });
  if (!auth.ok) {
    return auth.response;
  }

  const { memberId: rawMemberId, targetYear: rawTargetYear } =
    await context.params;

  const memberIdCheck = memberIdParamSchema.safeParse(rawMemberId);
  if (!memberIdCheck.success) {
    return birthdayValidationErrorResponse(memberIdCheck.error);
  }

  const targetYearCheck =
    birthdayPrepTargetYearParamSchema.safeParse(rawTargetYear);
  if (!targetYearCheck.success) {
    return birthdayValidationErrorResponse(targetYearCheck.error);
  }

  const bodyResult = await parseJsonBodyWithLimit(request);
  if (!bodyResult.ok) {
    return bodyResult.response;
  }

  const parsedInput = birthdayPrepStatusUpdateSchema.safeParse(bodyResult.data);
  if (!parsedInput.success) {
    return birthdayValidationErrorResponse(parsedInput.error);
  }

  try {
    const preparation = await updateBirthdayPreparationStatus(
      {
        userId: auth.owner.profile.id,
        organisationId: auth.owner.profile.organisationId,
      },
      memberIdCheck.data,
      targetYearCheck.data,
      parsedInput.data
    );

    return privateJsonResponse({ preparation }, 200);
  } catch (err) {
    return handleBirthdayRouteError(
      err,
      'PATCH /api/birthdays/[memberId]/[targetYear]/status'
    );
  }
}

