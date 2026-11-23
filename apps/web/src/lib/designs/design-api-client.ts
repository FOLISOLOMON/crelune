import type {
  ApproveExportForPublishInput,
  CreateCreativeJobDispatchInput,
  CreateDesignJobInput,
  CreateExportRecordInput,
  CreateExportUploadIntentInput,
  CreativeJobDispatchSummary,
  CreativeUploadIntentSummary,
  DesignJobDetail,
  DesignJobListQuery,
  DesignJobPreparationSnapshot,
  DesignJobStatus,
  DesignJobSummary,
  ExportRecordSummary,
  JobPrepManifest,
  MemberPaginationMeta,
  PresignedUploadTarget,
  TransitionDesignJobInput,
  UpdateDesignJobInput,
} from '@crelune/shared';

export class DesignApiError extends Error {
  public readonly status: number;
  public readonly code?: string;
  public readonly fieldErrors?: Record<string, string>;

  constructor(
    message: string,
    status: number,
    options?: { code?: string; fieldErrors?: Record<string, string> }
  ) {
    super(message);
    this.name = 'DesignApiError';
    this.status = status;
    this.code = options?.code;
    this.fieldErrors = options?.fieldErrors;
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
): DesignApiError {
  const message =
    typeof body.error === 'string' && body.error.trim().length > 0
      ? body.error
      : fallback;
  const code = typeof body.code === 'string' ? body.code : undefined;
  const fieldErrors: Record<string, string> = {};
  if (Array.isArray(body.issues)) {
    for (const issue of body.issues as Array<{ path?: string; message?: string }>) {
      if (issue?.path && issue?.message && !fieldErrors[issue.path]) {
        fieldErrors[issue.path] = issue.message;
      }
    }
  }
  return new DesignApiError(message, res.status, { code, fieldErrors });
}

export interface DesignJobListResponse {
  jobs: DesignJobSummary[];
  pagination: MemberPaginationMeta;
  statusCounts: Record<DesignJobStatus, number>;
}

export async function fetchDesignJobsRequest(
  query: Partial<DesignJobListQuery>,
  signal?: AbortSignal
): Promise<DesignJobListResponse> {
  const params = new URLSearchParams();
  if (query.q && query.q.trim().length > 0) params.set('q', query.q.trim());
  if (query.status) params.set('status', query.status);
  if (query.category) params.set('category', query.category);
  if (query.priority) params.set('priority', query.priority);
  if (query.memberId) params.set('memberId', query.memberId);
  if (query.page !== undefined) params.set('page', String(query.page));
  if (query.limit !== undefined) params.set('limit', String(query.limit));

  const qs = params.toString();
  const res = await fetch(qs ? `/api/designs?${qs}` : '/api/designs', {
    method: 'GET',
    credentials: 'same-origin',
    signal,
  });
  const body = await readJsonSafely(res);
  if (!res.ok) {
    throw buildError(res, body, 'Failed to load design jobs.');
  }
  return body as unknown as DesignJobListResponse;
}

export async function createDesignJobRequest(
  payload: CreateDesignJobInput
): Promise<DesignJobDetail> {
  const res = await fetch('/api/designs', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const body = await readJsonSafely(res);
  if (!res.ok) {
    throw buildError(res, body, 'Unable to create design job.');
  }
  return body.job as DesignJobDetail;
}

export async function updateDesignJobRequest(
  jobId: string,
  payload: UpdateDesignJobInput
): Promise<DesignJobDetail> {
  const res = await fetch(`/api/designs/${encodeURIComponent(jobId)}`, {
    method: 'PATCH',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const body = await readJsonSafely(res);
  if (!res.ok) {
    throw buildError(res, body, 'Unable to update design job.');
  }
  return body.job as DesignJobDetail;
}

export async function transitionDesignJobRequest(
  jobId: string,
  payload: TransitionDesignJobInput
): Promise<DesignJobDetail> {
  const res = await fetch(
    `/api/designs/${encodeURIComponent(jobId)}/transition`,
    {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }
  );
  const body = await readJsonSafely(res);
  if (!res.ok) {
    throw buildError(res, body, 'Unable to update design job status.');
  }
  return body.job as DesignJobDetail;
}

export async function fetchDesignJobPreparationRequest(
  jobId: string,
  signal?: AbortSignal
): Promise<DesignJobPreparationSnapshot> {
  const res = await fetch(
    `/api/designs/${encodeURIComponent(jobId)}/preparation`,
    {
      method: 'GET',
      credentials: 'same-origin',
      signal,
    }
  );
  const body = await readJsonSafely(res);
  if (!res.ok) {
    throw buildError(res, body, 'Unable to load job preparation snapshot.');
  }
  return body.preparation as DesignJobPreparationSnapshot;
}

export async function createCreativeDispatchRequest(
  jobId: string,
  payload: CreateCreativeJobDispatchInput
): Promise<{
  dispatch: CreativeJobDispatchSummary;
  manifest: JobPrepManifest;
  idempotentReplay: boolean;
}> {
  const res = await fetch(
    `/api/designs/${encodeURIComponent(jobId)}/dispatches`,
    {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }
  );
  const body = await readJsonSafely(res);
  if (!res.ok) {
    throw buildError(res, body, 'Unable to prepare creative job dispatch.');
  }
  return body as {
    dispatch: CreativeJobDispatchSummary;
    manifest: JobPrepManifest;
    idempotentReplay: boolean;
  };
}

export async function cancelCreativeDispatchRequest(
  jobId: string,
  dispatchId: string,
  reason?: string
): Promise<CreativeJobDispatchSummary> {
  const res = await fetch(
    `/api/designs/${encodeURIComponent(jobId)}/dispatches/${encodeURIComponent(
      dispatchId
    )}/cancel`,
    {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(reason ? { reason } : {}),
    }
  );
  const body = await readJsonSafely(res);
  if (!res.ok) {
    throw buildError(res, body, 'Unable to cancel creative dispatch.');
  }
  return body.dispatch as CreativeJobDispatchSummary;
}

export async function recoverCreativeDispatchRequest(
  jobId: string,
  dispatchId: string,
  reason: string
): Promise<CreativeJobDispatchSummary> {
  const res = await fetch(
    `/api/designs/${encodeURIComponent(jobId)}/dispatches/${encodeURIComponent(
      dispatchId
    )}/recover`,
    {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        reason,
        confirmPreserveLocalWork: true,
      }),
    }
  );
  const body = await readJsonSafely(res);
  if (!res.ok) {
    throw buildError(res, body, 'Unable to release and requeue creative dispatch.');
  }
  return body.dispatch as CreativeJobDispatchSummary;
}

export async function createExportUploadIntentRequest(
  jobId: string,
  payload: CreateExportUploadIntentInput
): Promise<{
  intent: CreativeUploadIntentSummary;
  upload: PresignedUploadTarget;
}> {
  const res = await fetch(
    `/api/designs/${encodeURIComponent(jobId)}/exports/upload-intents`,
    {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }
  );
  const body = await readJsonSafely(res);
  if (!res.ok) {
    throw buildError(res, body, 'Unable to initialize export upload.');
  }
  return body as {
    intent: CreativeUploadIntentSummary;
    upload: PresignedUploadTarget;
  };
}

export async function completeExportRecordRequest(
  jobId: string,
  payload: CreateExportRecordInput
): Promise<{ exportRecord: ExportRecordSummary; idempotentReplay: boolean }> {
  const res = await fetch(`/api/designs/${encodeURIComponent(jobId)}/exports`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const body = await readJsonSafely(res);
  if (!res.ok) {
    throw buildError(res, body, 'Unable to verify and register export file.');
  }
  return body as { exportRecord: ExportRecordSummary; idempotentReplay: boolean };
}

export async function setExportPublishApprovalRequest(
  jobId: string,
  exportId: string,
  payload: ApproveExportForPublishInput
): Promise<ExportRecordSummary> {
  const res = await fetch(
    `/api/designs/${encodeURIComponent(jobId)}/exports/${encodeURIComponent(
      exportId
    )}/approval`,
    {
      method: 'PATCH',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }
  );
  const body = await readJsonSafely(res);
  if (!res.ok) {
    throw buildError(res, body, 'Unable to update publish approval.');
  }
  return body.exportRecord as ExportRecordSummary;
}

