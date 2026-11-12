import type {
  CreateTemplateInput,
  CreateTemplateUploadIntentRequest,
  PresignedUploadTarget,
  TemplateDetail,
  TemplateListQuery,
  TemplateSummary,
  TemplateVersionDetail,
  UpdateTemplateInput,
  UpsertTemplateFieldMappingsInput,
} from '@crelune/shared';

export class TemplateApiError extends Error {
  public readonly status: number;
  public readonly code?: string;
  public readonly fieldErrors?: Record<string, string>;
  public readonly blockedUntil?: string | null;

  constructor(
    message: string,
    status: number,
    options?: {
      code?: string;
      fieldErrors?: Record<string, string>;
      blockedUntil?: string | null;
    }
  ) {
    super(message);
    this.name = 'TemplateApiError';
    this.status = status;
    this.code = options?.code;
    this.fieldErrors = options?.fieldErrors;
    this.blockedUntil = options?.blockedUntil;
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
): TemplateApiError {
  const message =
    typeof body.error === 'string' && body.error.trim().length > 0
      ? body.error
      : fallback;
  const code = typeof body.code === 'string' ? body.code : undefined;
  const blockedUntil =
    typeof body.blockedUntil === 'string' ? body.blockedUntil : null;
  const fieldErrors: Record<string, string> = {};
  if (Array.isArray(body.issues)) {
    for (const issue of body.issues as Array<{ path?: string; message?: string }>) {
      if (issue?.path && issue?.message && !fieldErrors[issue.path]) {
        fieldErrors[issue.path] = issue.message;
      }
    }
  }
  return new TemplateApiError(message, res.status, {
    code,
    fieldErrors,
    blockedUntil,
  });
}

export interface TemplateListResponse {
  items: TemplateSummary[];
  total: number;
  page: number;
  pageSize: number;
}

export async function fetchTemplatesRequest(
  query: Partial<TemplateListQuery>,
  signal?: AbortSignal
): Promise<TemplateListResponse> {
  const params = new URLSearchParams();
  if (query.q && query.q.trim().length > 0) params.set('q', query.q.trim());
  if (query.category) params.set('category', query.category);
  if (query.studioType) params.set('studioType', query.studioType);
  if (query.includeArchived !== undefined) {
    params.set('includeArchived', String(query.includeArchived));
  }
  if (query.page !== undefined) params.set('page', String(query.page));
  if (query.pageSize !== undefined) params.set('pageSize', String(query.pageSize));

  const qs = params.toString();
  const res = await fetch(qs ? `/api/templates?${qs}` : '/api/templates', {
    method: 'GET',
    credentials: 'same-origin',
    signal,
  });
  const body = await readJsonSafely(res);
  if (!res.ok) {
    throw buildError(res, body, 'Failed to load templates.');
  }
  return body as unknown as TemplateListResponse;
}

export async function fetchTemplateDetailRequest(
  templateId: string,
  signal?: AbortSignal
): Promise<TemplateDetail> {
  const res = await fetch(`/api/templates/${encodeURIComponent(templateId)}`, {
    method: 'GET',
    credentials: 'same-origin',
    signal,
  });
  const body = await readJsonSafely(res);
  if (!res.ok) {
    throw buildError(res, body, 'Failed to load template details.');
  }
  return (body as { template: TemplateDetail }).template;
}

export async function createTemplateRequest(
  payload: CreateTemplateInput
): Promise<TemplateDetail> {
  const res = await fetch('/api/templates', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const body = await readJsonSafely(res);
  if (!res.ok) {
    throw buildError(res, body, 'Failed to create template.');
  }
  return (body as { template: TemplateDetail }).template;
}

export async function updateTemplateRequest(
  templateId: string,
  payload: UpdateTemplateInput
): Promise<TemplateDetail> {
  const res = await fetch(`/api/templates/${encodeURIComponent(templateId)}`, {
    method: 'PATCH',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const body = await readJsonSafely(res);
  if (!res.ok) {
    throw buildError(res, body, 'Failed to update template.');
  }
  return (body as { template: TemplateDetail }).template;
}

export async function archiveTemplateRequest(
  templateId: string
): Promise<TemplateDetail> {
  const res = await fetch(`/api/templates/${encodeURIComponent(templateId)}/archive`, {
    method: 'POST',
    credentials: 'same-origin',
  });
  const body = await readJsonSafely(res);
  if (!res.ok) {
    throw buildError(res, body, 'Failed to archive template.');
  }
  return (body as { template: TemplateDetail }).template;
}

export async function restoreTemplateRequest(
  templateId: string
): Promise<TemplateDetail> {
  const res = await fetch(`/api/templates/${encodeURIComponent(templateId)}/restore`, {
    method: 'POST',
    credentials: 'same-origin',
  });
  const body = await readJsonSafely(res);
  if (!res.ok) {
    throw buildError(res, body, 'Failed to restore template.');
  }
  return (body as { template: TemplateDetail }).template;
}

export async function createTemplateUploadIntentRequest(
  templateId: string,
  payload: CreateTemplateUploadIntentRequest
): Promise<{
  intent: {
    id: string;
    kind: string;
    status: string;
    storageBucket: string;
    storageKey: string;
    expectedMimeType: string;
    expectedByteSize: number;
    maxAllowedBytes: number;
    expiresAt: string;
  };
  upload: PresignedUploadTarget;
}> {
  const res = await fetch(
    `/api/templates/${encodeURIComponent(templateId)}/upload-intents`,
    {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }
  );
  const body = await readJsonSafely(res);
  if (!res.ok) {
    throw buildError(res, body, 'Failed to create upload intent.');
  }
  return body as {
    intent: {
      id: string;
      kind: string;
      status: string;
      storageBucket: string;
      storageKey: string;
      expectedMimeType: string;
      expectedByteSize: number;
      maxAllowedBytes: number;
      expiresAt: string;
    };
    upload: PresignedUploadTarget;
  };
}

export async function uploadBytesToPresignedUrl(
  target: PresignedUploadTarget,
  fileBytes: Uint8Array,
  signal?: AbortSignal
): Promise<void> {
  const res = await fetch(target.url, {
    method: target.method,
    headers: target.requiredHeaders,
    body: Buffer.from(fileBytes),
    signal,
  });
  if (!res.ok) {
    throw new TemplateApiError(
      `Failed to upload file bytes to secure storage (HTTP ${res.status}).`,
      res.status
    );
  }
}

export async function completeTemplateVersionUploadRequest(
  templateId: string,
  payload: {
    uploadIntentId: string;
    previewUploadIntentId?: string | null;
    widthPx?: number | null;
    heightPx?: number | null;
    activateImmediately?: boolean;
  }
): Promise<{
  version: {
    template: TemplateDetail;
    version: TemplateVersionDetail;
    inspection: null;
    editabilityVerified: false;
  };
}> {
  const res = await fetch(
    `/api/templates/${encodeURIComponent(templateId)}/versions`,
    {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }
  );
  const body = await readJsonSafely(res);
  if (!res.ok) {
    throw buildError(res, body, 'Failed to register template version.');
  }
  return body as {
    version: {
      template: TemplateDetail;
      version: TemplateVersionDetail;
      inspection: null;
      editabilityVerified: false;
    };
  };
}

export async function abandonUploadIntentRequest(
  intentId: string
): Promise<void> {
  const res = await fetch(
    `/api/templates/upload-intents/${encodeURIComponent(intentId)}/abandon`,
    {
      method: 'POST',
      credentials: 'same-origin',
    }
  );
  const body = await readJsonSafely(res);
  if (!res.ok) {
    throw buildError(res, body, 'Failed to abandon upload intent.');
  }
}

export async function upsertTemplateFieldMappingsRequest(
  templateId: string,
  versionId: string,
  payload: UpsertTemplateFieldMappingsInput
): Promise<TemplateDetail['activeMappings']> {
  const res = await fetch(
    `/api/templates/${encodeURIComponent(templateId)}/versions/${encodeURIComponent(
      versionId
    )}/mappings`,
    {
      method: 'PUT',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }
  );
  const body = await readJsonSafely(res);
  if (!res.ok) {
    throw buildError(res, body, 'Failed to update field mappings.');
  }
  return (body as { mappings: TemplateDetail['activeMappings'] }).mappings;
}

export async function fetchTemplateVersionDetailRequest(
  templateId: string,
  versionId: string,
  signal?: AbortSignal
): Promise<TemplateVersionDetail> {
  const res = await fetch(
    `/api/templates/${encodeURIComponent(templateId)}/versions/${encodeURIComponent(
      versionId
    )}`,
    {
      method: 'GET',
      credentials: 'same-origin',
      signal,
    }
  );
  const body = await readJsonSafely(res);
  if (!res.ok) {
    throw buildError(res, body, 'Failed to load version details.');
  }
  return (body as { version: TemplateVersionDetail }).version;
}
