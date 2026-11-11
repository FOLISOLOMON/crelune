import { birthdayOverviewQuerySchema } from '@crelune/shared';
import { requireAuthenticatedOwnerApi } from '@/lib/auth/api-owner-guard';
import {
  birthdayValidationErrorResponse,
  handleBirthdayRouteError,
  privateJsonResponse,
} from '@/lib/birthdays/birthday-http';
import { getBirthdayOverview } from '@/lib/birthdays/birthday-overview-service';

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

  const parsedQuery = birthdayOverviewQuerySchema.safeParse(rawQuery);
  if (!parsedQuery.success) {
    return birthdayValidationErrorResponse(parsedQuery.error);
  }

  try {
    const overview = await getBirthdayOverview(
      auth.owner.profile.organisationId,
      auth.owner.profile.id,
      parsedQuery.data
    );
    return privateJsonResponse(overview, 200);
  } catch (err) {
    return handleBirthdayRouteError(err, 'GET /api/birthdays');
  }
}

