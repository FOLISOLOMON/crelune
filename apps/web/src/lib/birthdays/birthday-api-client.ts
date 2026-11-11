import type {
  BirthdayOverviewQuery,
  BirthdayOverviewResponse,
  BirthdayPreferencesUpdateInput,
  BirthdayPrepStatus,
  BirthdayPrepStatusUpdateInput,
  BirthdaySyncSummary,
  NotificationListQuery,
  NotificationListResponse,
  OwnerBirthdayPreferencesDto,
} from '@crelune/shared';

export class BirthdayApiError extends Error {
  public readonly status: number;
  public readonly code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = 'BirthdayApiError';
    this.status = status;
    this.code = code;
  }
}

async function readJsonSafely(res: Response): Promise<Record<string, unknown>> {
  try {
    const data = await res.json();
    if (data && typeof data === 'object') {
      return data as Record<string, unknown>;
    }
    return {};
  } catch {
    return {};
  }
}

function buildError(
  res: Response,
  body: Record<string, unknown>,
  fallback: string
): BirthdayApiError {
  const message =
    typeof body.error === 'string' && body.error.trim().length > 0
      ? body.error
      : fallback;
  const code = typeof body.code === 'string' ? body.code : undefined;
  return new BirthdayApiError(message, res.status, code);
}

export async function fetchBirthdayOverview(
  query: Partial<BirthdayOverviewQuery>,
  signal?: AbortSignal
): Promise<BirthdayOverviewResponse> {
  const params = new URLSearchParams();
  if (query.month !== undefined) params.set('month', String(query.month));
  if (query.year !== undefined) params.set('year', String(query.year));
  if (query.q && query.q.trim().length > 0) params.set('q', query.q.trim());
  if (query.prepStatus) params.set('prepStatus', query.prepStatus);

  const qs = params.toString();
  const res = await fetch(qs ? `/api/birthdays?${qs}` : '/api/birthdays', {
    method: 'GET',
    credentials: 'same-origin',
    signal,
  });
  const body = await readJsonSafely(res);
  if (!res.ok) {
    throw buildError(res, body, 'Failed to load birthday schedule.');
  }
  return body as unknown as BirthdayOverviewResponse;
}

export async function updateBirthdayPrepStatusRequest(
  memberId: string,
  targetYear: number,
  payload: BirthdayPrepStatusUpdateInput
): Promise<{
  id: string;
  memberId: string;
  targetYear: number;
  status: BirthdayPrepStatus;
  notes: string | null;
  statusUpdatedAt: string;
}> {
  const res = await fetch(
    `/api/birthdays/${encodeURIComponent(memberId)}/${targetYear}/status`,
    {
      method: 'PATCH',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }
  );
  const body = await readJsonSafely(res);
  if (!res.ok) {
    throw buildError(res, body, 'Unable to update preparation status.');
  }
  return body.preparation as {
    id: string;
    memberId: string;
    targetYear: number;
    status: BirthdayPrepStatus;
    notes: string | null;
    statusUpdatedAt: string;
  };
}

export async function syncBirthdaysRequest(): Promise<BirthdaySyncSummary> {
  const res = await fetch('/api/birthdays/sync', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  const body = await readJsonSafely(res);
  if (!res.ok) {
    throw buildError(res, body, 'Failed to synchronize birthday reminders.');
  }
  return body.summary as BirthdaySyncSummary;
}

export async function fetchNotificationsRequest(
  query: Partial<NotificationListQuery>,
  signal?: AbortSignal
): Promise<NotificationListResponse> {
  const params = new URLSearchParams();
  if (query.unreadOnly !== undefined) {
    params.set('unreadOnly', String(query.unreadOnly));
  }
  if (query.page !== undefined) params.set('page', String(query.page));
  if (query.limit !== undefined) params.set('limit', String(query.limit));

  const qs = params.toString();
  const res = await fetch(qs ? `/api/notifications?${qs}` : '/api/notifications', {
    method: 'GET',
    credentials: 'same-origin',
    signal,
  });
  const body = await readJsonSafely(res);
  if (!res.ok) {
    throw buildError(res, body, 'Failed to load notifications.');
  }
  return body as unknown as NotificationListResponse;
}

export async function markNotificationReadRequest(
  notificationId: string
): Promise<{
  notification: { id: string; isRead: boolean; readAt: string | null };
  changed: boolean;
}> {
  const res = await fetch(
    `/api/notifications/${encodeURIComponent(notificationId)}/read`,
    {
      method: 'PATCH',
      credentials: 'same-origin',
    }
  );
  const body = await readJsonSafely(res);
  if (!res.ok) {
    throw buildError(res, body, 'Unable to mark notification as read.');
  }
  return body as {
    notification: { id: string; isRead: boolean; readAt: string | null };
    changed: boolean;
  };
}

export async function markAllNotificationsReadRequest(): Promise<{
  updatedCount: number;
  unreadCount: number;
}> {
  const res = await fetch('/api/notifications/read-all', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  const body = await readJsonSafely(res);
  if (!res.ok) {
    throw buildError(res, body, 'Unable to mark notifications as read.');
  }
  return body as { updatedCount: number; unreadCount: number };
}

export async function updateBirthdayPreferencesRequest(
  payload: BirthdayPreferencesUpdateInput
): Promise<{
  preferences: OwnerBirthdayPreferencesDto;
  reconciliation: BirthdaySyncSummary;
}> {
  const res = await fetch('/api/settings/birthdays', {
    method: 'PATCH',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const body = await readJsonSafely(res);
  if (!res.ok) {
    throw buildError(res, body, 'Unable to update birthday preferences.');
  }
  return body as {
    preferences: OwnerBirthdayPreferencesDto;
    reconciliation: BirthdaySyncSummary;
  };
}

