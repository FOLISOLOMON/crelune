import { requireAuthenticatedOwnerApi } from '@/lib/auth/api-owner-guard';
import {
  handleBirthdayRouteError,
  parseNotificationIdOrError,
  parseStrictEmptyBodyOrError,
  privateJsonResponse,
} from '@/lib/birthdays/birthday-http';
import { markNotificationAsRead } from '@/lib/notifications/notification-service';

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuthenticatedOwnerApi(request, { verifyCsrf: true });
  if (!auth.ok) {
    return auth.response;
  }

  const { id } = await context.params;
  const parsedId = parseNotificationIdOrError(id);
  if (!parsedId.ok) {
    return parsedId.response;
  }

  const bodyCheck = await parseStrictEmptyBodyOrError(request);
  if (!bodyCheck.ok) {
    return bodyCheck.response;
  }

  try {
    const result = await markNotificationAsRead(
      {
        userId: auth.owner.profile.id,
        organisationId: auth.owner.profile.organisationId,
      },
      parsedId.id
    );
    return privateJsonResponse(result, 200);
  } catch (err) {
    return handleBirthdayRouteError(err, 'PATCH /api/notifications/[id]/read');
  }
}

