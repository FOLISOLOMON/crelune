import { NextResponse } from 'next/server';
import { MAX_MEMBER_PHOTO_BYTES } from '@crelune/shared';
import { requireAuthenticatedOwnerApi } from '@/lib/auth/api-owner-guard';
import {
  handleMemberRouteError,
  memberJsonResponse,
  parseMemberIdOrError,
} from '@/lib/members/member-http';
import {
  deleteMemberPhoto,
  getMemberPhoto,
  uploadMemberPhoto,
} from '@/lib/members/member-photo-service';
import { validateUploadedMemberPhoto } from '@/lib/storage/image-validator';

// Allow small multipart boundary/header overhead around the 10 MB image cap
const MAX_MULTIPART_CONTENT_LENGTH = MAX_MEMBER_PHOTO_BYTES + 256 * 1024;
const FORBIDDEN_MULTIPART_FIELDS = new Set([
  'storagekey',
  'photostoragekey',
  'objectkey',
  'key',
  'bucket',
  'path',
  'envprefix',
  'organisationid',
]);

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuthenticatedOwnerApi(request);
  if (!auth.ok) {
    return auth.response;
  }

  const { id: rawId } = await context.params;
  const idResult = parseMemberIdOrError(rawId);
  if (!idResult.ok) {
    return idResult.response;
  }

  try {
    const photo = await getMemberPhoto(
      auth.owner.profile.organisationId,
      idResult.id
    );

    const headers: Record<string, string> = {
      'Content-Type': photo.contentType,
      'Content-Length': String(photo.byteSize),
      'Content-Disposition': 'inline',
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
      'X-Robots-Tag': 'noindex, nofollow, noarchive',
    };
    if (photo.updatedAt) {
      headers['Last-Modified'] = photo.updatedAt.toUTCString();
    }

    return new NextResponse(Buffer.from(photo.body), {
      status: 200,
      headers,
    });
  } catch (err) {
    return handleMemberRouteError(err, 'GET /api/members/[id]/photo');
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuthenticatedOwnerApi(request, { verifyCsrf: true });
  if (!auth.ok) {
    return auth.response;
  }

  const { id: rawId } = await context.params;
  const idResult = parseMemberIdOrError(rawId);
  if (!idResult.ok) {
    return idResult.response;
  }

  const contentType = request.headers.get('content-type') || '';
  if (!contentType.toLowerCase().includes('multipart/form-data')) {
    return memberJsonResponse(
      {
        error: 'Upload request must use multipart/form-data.',
        code: 'INVALID_CONTENT_TYPE',
      },
      400
    );
  }

  const contentLengthHeader = request.headers.get('content-length');
  if (contentLengthHeader) {
    const declaredLength = Number.parseInt(contentLengthHeader, 10);
    if (Number.isFinite(declaredLength) && declaredLength > MAX_MULTIPART_CONTENT_LENGTH) {
      return memberJsonResponse(
        {
          error: 'Uploaded photo exceeds the 10 MB maximum limit.',
          code: 'FILE_TOO_LARGE',
        },
        413
      );
    }
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return memberJsonResponse(
      { error: 'Invalid multipart upload payload.', code: 'INVALID_UPLOAD_BODY' },
      400
    );
  }

  for (const fieldName of formData.keys()) {
    if (FORBIDDEN_MULTIPART_FIELDS.has(fieldName.trim().toLowerCase())) {
      return memberJsonResponse(
        {
          error: 'Client-supplied storage locations or object keys are not permitted.',
          code: 'FORBIDDEN_UPLOAD_FIELD',
        },
        400
      );
    }
  }

  const fileEntries = formData.getAll('file');
  if (fileEntries.length !== 1 || !(fileEntries[0] instanceof Blob)) {
    return memberJsonResponse(
      {
        error: 'A single image file field named "file" is required.',
        code: 'INVALID_UPLOAD_FIELD',
      },
      400
    );
  }

  const uploadedBlob = fileEntries[0];
  if (uploadedBlob.size > MAX_MEMBER_PHOTO_BYTES) {
    return memberJsonResponse(
      {
        error: 'Uploaded photo exceeds the 10 MB maximum limit.',
        code: 'FILE_TOO_LARGE',
      },
      413
    );
  }

  const bytes = new Uint8Array(await uploadedBlob.arrayBuffer());
  const filename =
    'name' in uploadedBlob && typeof uploadedBlob.name === 'string'
      ? uploadedBlob.name
      : undefined;

  try {
    const validatedPhoto = validateUploadedMemberPhoto({
      bytes,
      declaredMimeType: uploadedBlob.type,
      filename,
    });

    const result = await uploadMemberPhoto(
      {
        userId: auth.owner.profile.id,
        organisationId: auth.owner.profile.organisationId,
      },
      idResult.id,
      validatedPhoto
    );

    return memberJsonResponse(result, 200);
  } catch (err) {
    return handleMemberRouteError(err, 'POST /api/members/[id]/photo');
  }
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuthenticatedOwnerApi(request, { verifyCsrf: true });
  if (!auth.ok) {
    return auth.response;
  }

  const { id: rawId } = await context.params;
  const idResult = parseMemberIdOrError(rawId);
  if (!idResult.ok) {
    return idResult.response;
  }

  try {
    const result = await deleteMemberPhoto(
      {
        userId: auth.owner.profile.id,
        organisationId: auth.owner.profile.organisationId,
      },
      idResult.id
    );
    return memberJsonResponse(result, 200);
  } catch (err) {
    return handleMemberRouteError(err, 'DELETE /api/members/[id]/photo');
  }
}

