import { notificationListQuerySchema } from '@crelune/shared';
import { requireAuthenticatedOwnerApi } from '@/lib/auth/api-owner-guard';
import {
  birthdayValidationErrorResponse,
  handleBirthdayRouteError,
  privateJsonResponse,
} from '@/lib/birthdays/birthday-http';
import { listOwnerNotifications } from '@/lib/notifications/notification-service';

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

  const parsedQuery = notificationListQuerySchema.safeParse(rawQuery);
  if (!parsedQuery.success) {
    return birthdayValidationErrorResponse(parsedQuery.error);
  }

  try {
    const result = await listOwnerNotifications(
      {
        userId: auth.owner.profile.id,
        organisationId: auth.owner.profile.organisationId,
      },
      parsedQuery.data
    );
    return privateJsonResponse(result, 200);
  } catch (err) {
    return handleBirthdayRouteError(err, 'GET /api/notifications');
  }
}

