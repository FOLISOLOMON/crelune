import { requireAuthenticatedOwnerApi } from '@/lib/auth/api-owner-guard';
import { runOrganisationBirthdayCycle } from '@/lib/birthdays/birthday-engine-service';
import {
  handleBirthdayRouteError,
  parseStrictEmptyBodyOrError,
  privateJsonResponse,
} from '@/lib/birthdays/birthday-http';

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
    const summary = await runOrganisationBirthdayCycle(
      auth.owner.profile.organisationId,
      auth.owner.profile.id
    );
    return privateJsonResponse(summary, 200);
  } catch (err) {
    return handleBirthdayRouteError(err, 'POST /api/birthdays/sync');
  }
}

