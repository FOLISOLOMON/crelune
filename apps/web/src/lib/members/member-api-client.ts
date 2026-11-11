import type {
  CreateMemberInput,
  DuplicateCandidateSummary,
  MemberDetail,
  MemberDirectoryItem,
  MemberListQuery,
  MemberPaginationMeta,
  MemberPhotoSummary,
  UpdateMemberInput,
} from '@crelune/shared';
import {
  mapServerIssuesToFieldErrors,
  type MemberFieldErrors,
} from './member-form-utils';

export class MemberApiError extends Error {
  public readonly status: number;
  public readonly code?: string;
  public readonly fieldErrors?: MemberFieldErrors;

  constructor(
    message: string,
    status: number,
    options?: {
      code?: string;
      fieldErrors?: MemberFieldErrors;
    }
  ) {
    super(message);
    this.name = 'MemberApiError';
    this.status = status;
    this.code = options?.code;
    this.fieldErrors = options?.fieldErrors;
  }
}

export interface MembersListResponse {
  members: MemberDirectoryItem[];
  pagination: MemberPaginationMeta;
}

export type CreateMemberResult =
  | { status: 'created'; member: MemberDetail }
  | {
      status: 'duplicate';
      message: string;
      duplicateCandidates: DuplicateCandidateSummary[];
    };

async function readJsonSafely(res: Response): Promise<Record<string, unknown>> {
  try {
    const body = await res.json();
    if (body && typeof body === 'object') {
      return body as Record<string, unknown>;
    }
    return {};
  } catch {
    return {};
  }
}

function buildApiError(res: Response, body: Record<string, unknown>, fallback: string): MemberApiError {
  const message =
    typeof body.error === 'string' && body.error.trim().length > 0
      ? body.error
      : fallback;
  const code = typeof body.code === 'string' ? body.code : undefined;
  const issues = Array.isArray(body.issues)
    ? (body.issues as Array<{ path: string; message: string }>)
    : undefined;

  return new MemberApiError(message, res.status, {
    code,
    fieldErrors: mapServerIssuesToFieldErrors(issues),
  });
}

export async function fetchMembersDirectory(
  query: Partial<MemberListQuery>,
  signal?: AbortSignal
): Promise<MembersListResponse> {
  const params = new URLSearchParams();

  if (query.q && query.q.trim().length > 0) {
    params.set('q', query.q.trim());
  }
  if (query.status) {
    params.set('status', query.status);
  }
  if (query.birthMonth !== undefined) {
    params.set('birthMonth', String(query.birthMonth));
  }
  if (query.sort) {
    params.set('sort', query.sort);
  }
  if (query.page !== undefined) {
    params.set('page', String(query.page));
  }
  if (query.limit !== undefined) {
    params.set('limit', String(query.limit));
  }

  const queryString = params.toString();
  const url = queryString ? `/api/members?${queryString}` : '/api/members';

  const res = await fetch(url, {
    method: 'GET',
    credentials: 'same-origin',
    signal,
  });
  const body = await readJsonSafely(res);

  if (!res.ok) {
    throw buildApiError(res, body, 'Failed to load member directory.');
  }

  return {
    members: (body.members as MemberDirectoryItem[]) ?? [],
    pagination: body.pagination as MemberPaginationMeta,
  };
}

export async function createMemberRequest(
  payload: CreateMemberInput
): Promise<CreateMemberResult> {
  const res = await fetch('/api/members', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  const body = await readJsonSafely(res);

  if (res.status === 409 && body.code === 'POTENTIAL_DUPLICATE_MEMBER') {
    return {
      status: 'duplicate',
      message:
        typeof body.error === 'string'
          ? body.error
          : 'A similar member already exists in your directory.',
      duplicateCandidates: Array.isArray(body.duplicateCandidates)
        ? (body.duplicateCandidates as DuplicateCandidateSummary[])
        : [],
    };
  }

  if (!res.ok) {
    throw buildApiError(res, body, 'Unable to create member record.');
  }

  return {
    status: 'created',
    member: body.member as MemberDetail,
  };
}

export async function updateMemberRequest(
  memberId: string,
  payload: UpdateMemberInput
): Promise<MemberDetail> {
  const res = await fetch(`/api/members/${encodeURIComponent(memberId)}`, {
    method: 'PATCH',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  const body = await readJsonSafely(res);
  if (!res.ok) {
    throw buildApiError(res, body, 'Unable to save member changes.');
  }

  return body.member as MemberDetail;
}

export async function archiveMemberRequest(
  memberId: string
): Promise<{ member: MemberDetail; changed: boolean }> {
  const res = await fetch(
    `/api/members/${encodeURIComponent(memberId)}/archive`,
    {
      method: 'POST',
      credentials: 'same-origin',
    }
  );

  const body = await readJsonSafely(res);
  if (!res.ok) {
    throw buildApiError(res, body, 'Unable to archive member.');
  }

  return {
    member: body.member as MemberDetail,
    changed: Boolean(body.changed),
  };
}

export async function restoreMemberRequest(
  memberId: string
): Promise<{ member: MemberDetail; changed: boolean }> {
  const res = await fetch(
    `/api/members/${encodeURIComponent(memberId)}/restore`,
    {
      method: 'POST',
      credentials: 'same-origin',
    }
  );

  const body = await readJsonSafely(res);
  if (!res.ok) {
    throw buildApiError(res, body, 'Unable to restore member.');
  }

  return {
    member: body.member as MemberDetail,
    changed: Boolean(body.changed),
  };
}

export async function uploadMemberPhotoRequest(
  memberId: string,
  file: File
): Promise<{ member: MemberDetail; photo: MemberPhotoSummary }> {
  const formData = new FormData();
  formData.append('file', file);

  const res = await fetch(
    `/api/members/${encodeURIComponent(memberId)}/photo`,
    {
      method: 'POST',
      credentials: 'same-origin',
      body: formData,
    }
  );

  const body = await readJsonSafely(res);
  if (!res.ok) {
    throw buildApiError(res, body, 'Unable to upload member photo.');
  }

  return {
    member: body.member as MemberDetail,
    photo: body.photo as MemberPhotoSummary,
  };
}

export async function removeMemberPhotoRequest(
  memberId: string
): Promise<{ member: MemberDetail; removed: boolean }> {
  const res = await fetch(
    `/api/members/${encodeURIComponent(memberId)}/photo`,
    {
      method: 'DELETE',
      credentials: 'same-origin',
    }
  );

  const body = await readJsonSafely(res);
  if (!res.ok) {
    throw buildApiError(res, body, 'Unable to remove member photo.');
  }

  return {
    member: body.member as MemberDetail,
    removed: Boolean(body.removed),
  };
}

