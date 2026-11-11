import { birthdayPreferencesUpdateSchema } from '@crelune/shared';
import {
  parseJsonBodyWithLimit,
  requireAuthenticatedOwnerApi,
} from '@/lib/auth/api-owner-guard';
import {
  birthdayValidationErrorResponse,
  handleBirthdayRouteError,
  privateJsonResponse,
} from '@/lib/birthdays/birthday-http';
import { updateOwnerBirthdayPreferences } from '@/lib/birthdays/birthday-overview-service';

export async function PATCH(request: Request) {
  const auth = await requireAuthenticatedOwnerApi(request, { verifyCsrf: true });
  if (!auth.ok) {
    return auth.response;
  }

  const bodyResult = await parseJsonBodyWithLimit(request);
  if (!bodyResult.ok) {
    return bodyResult.response;
  }

  const parsedInput = birthdayPreferencesUpdateSchema.safeParse(
    bodyResult.data
  );
  if (!parsedInput.success) {
    return birthdayValidationErrorResponse(parsedInput.error);
  }

  try {
    const result = await updateOwnerBirthdayPreferences(
      {
        userId: auth.owner.profile.id,
        organisationId: auth.owner.profile.organisationId,
      },
      parsedInput.data
    );

    return privateJsonResponse(result, 200);
  } catch (err) {
    return handleBirthdayRouteError(err, 'PATCH /api/settings/birthdays');
  }
}

