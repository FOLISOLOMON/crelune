import { verifyCronBearerRequest } from '@/lib/auth/cron-auth';
import { runScheduledBirthdayRemindersForActiveOwners } from '@/lib/birthdays/birthday-engine-service';
import {
  handleBirthdayRouteError,
  parseStrictEmptyBodyOrError,
  privateJsonResponse,
} from '@/lib/birthdays/birthday-http';

export async function POST(request: Request) {
  const cronAuth = verifyCronBearerRequest(request);
  if (!cronAuth.ok) {
    return cronAuth.response;
  }

  const bodyCheck = await parseStrictEmptyBodyOrError(request);
  if (!bodyCheck.ok) {
    return bodyCheck.response;
  }

  try {
    const summary = await runScheduledBirthdayRemindersForActiveOwners();
    return privateJsonResponse({ ok: true, ...summary }, 200);
  } catch (err) {
    return handleBirthdayRouteError(err, 'POST /api/cron/birthday-reminders');
  }
}

