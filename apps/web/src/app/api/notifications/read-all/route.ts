import { requireAuthenticatedOwnerApi } from '@/lib/auth/api-owner-guard';
import {
  handleBirthdayRouteError,
  parseStrictEmptyBodyOrError,
  privateJsonResponse,
} from '@/lib/birthdays/birthday-http';
import { markAllNotificationsAsRead } from '@/lib/notifications/notification-service';

export async function POST(request: Request) {
  const auth = await requireAuthenticatedOwnerApi(request, { verifyCsrf: true });
  if (!auth.ok) {
    return auth.response;
  }

  const bodyCheck = await parseStrictEmptyBodyOrError(request);
  if (!bodyCheck.ok) {
    return bodyCheck.response;
  }

  try {
    const result = await markAllNotificationsAsRead({
      userId: auth.owner.profile.id,
      organisationId: auth.owner.profile.organisationId,
    });
    return privateJsonResponse(result, 200);
  } catch (err) {
    return handleBirthdayRouteError(err, 'POST /api/notifications/read-all');
  }
}

