import { describe, it, expect, beforeEach, vi } from 'vitest';
import sharp from 'sharp';
import { MAX_MEMBER_PHOTO_BYTES } from '@crelune/shared';
import type { OwnerAuthState } from '@/lib/auth/owner-guard';
import type { ObjectStorageProvider } from '@/lib/storage/object-storage';
import {
  createDecodablePng,
  createDecodableWebp,
  createSyntheticExifGpsJpeg,
  createSyntheticPng,
} from '@/test/synthetic-images';

const mockState = vi.hoisted(() => ({
  authResult: { status: 'unauthenticated', owner: null } as OwnerAuthState,
  clearCookieCalls: 0,
  members: new Map<
    string,
    {
      id: string;
      organisationId: string;
      fullName: string;
      preferredName: string | null;
      normalizedName: string;
      birthDay: number | null;
      birthMonth: number | null;
      birthYear: number | null;
      phone: string | null;
      normalizedPhone: string | null;
      email: string | null;
      notes: string | null;
      photoStorageKey: string | null;
      photoMimeType: string | null;
      photoByteSize: number | null;
      photoUpdatedAt: Date | null;
      archivedAt: Date | null;
      createdAt: Date;
      updatedAt: Date;
    }
  >(),
  objects: new Map<string, { body: Uint8Array; contentType: string }>(),
  auditLogs: [] as Array<Record<string, unknown>>,
  pendingCleanups: new Map<string, Record<string, unknown>>(),
  forceStorageErrorMessage: null as string | null,
  forceDbFailure: false,
}));

const mockStorageProvider = vi.hoisted<ObjectStorageProvider>(() => ({
  envPrefix: 'development',
  async putPrivateObject({ key, body, contentType }) {
    if (mockState.forceStorageErrorMessage) {
      throw new Error(mockState.forceStorageErrorMessage);
    }
    mockState.objects.set(key, { body: new Uint8Array(body), contentType });
  },
  async headObject(key) {
    const obj = mockState.objects.get(key);
    if (!obj) return { exists: false };
    return {
      exists: true,
      contentLength: obj.body.byteLength,
      contentType: obj.contentType,
    };
  },
  async getObject(key) {
    const obj = mockState.objects.get(key);
    if (!obj) throw new Error('NoSuchKey');
    return {
      body: new Uint8Array(obj.body),
      contentLength: obj.body.byteLength,
      contentType: obj.contentType,
    };
  },
  async deleteObject(key) {
    mockState.objects.delete(key);
  },
}));

vi.mock('@/lib/auth/owner-guard', () => ({
  resolveAuthenticatedOwner: vi.fn(async () => mockState.authResult),
}));

vi.mock('@/lib/auth/session', () => ({
  clearSessionCookie: vi.fn(async () => {
    mockState.clearCookieCalls += 1;
  }),
}));

vi.mock('@/lib/storage/object-storage', () => ({
  createObjectStorageProvider: vi.fn(() => mockStorageProvider),
}));

vi.mock('@crelune/database', () => {
  const txClient = {
    $executeRaw: vi.fn(async () => 1),
    member: {
      findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
        for (const m of mockState.members.values()) {
          if (where.id && m.id !== where.id) continue;
          if (where.organisationId && m.organisationId !== where.organisationId) continue;
          if (where.photoStorageKey && m.photoStorageKey !== where.photoStorageKey) continue;
          return { ...m };
        }
        return null;
      }),
      update: vi.fn(
        async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
          if (mockState.forceDbFailure) {
            throw new Error(
              'postgresql://neondb_owner:secret_leak@ep-bad.neon.tech/neondb update failed'
            );
          }
          const existing = mockState.members.get(where.id);
          if (!existing) throw new Error('Record not found');
          const updated = { ...existing, ...data, updatedAt: new Date() };
          mockState.members.set(where.id, updated);
          return { ...updated };
        }
      ),
    },
    auditLog: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const entry = { id: `aud_${mockState.auditLogs.length + 1}`, ...data };
        mockState.auditLogs.push(entry);
        return entry;
      }),
    },
    pendingStorageCleanup: {
      upsert: vi.fn(
        async ({
          where,
          create,
          update,
        }: {
          where: { storageKey: string };
          create: Record<string, unknown>;
          update: Record<string, unknown>;
        }) => {
          const existing = mockState.pendingCleanups.get(where.storageKey);
          const next = existing ? { ...existing, ...update } : { id: `cln_${mockState.pendingCleanups.size + 1}`, ...create };
          mockState.pendingCleanups.set(where.storageKey, next);
          return next;
        }
      ),
      findMany: vi.fn(async () => Array.from(mockState.pendingCleanups.values())),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
  };

  return {
    prisma: {
      member: txClient.member,
      pendingStorageCleanup: txClient.pendingStorageCleanup,
      $transaction: vi.fn(async (cb: (tx: typeof txClient) => Promise<unknown>) => cb(txClient)),
    },
  };
});

import { MAX_MULTIPART_CONTENT_LENGTH } from '@/lib/storage/bounded-multipart';
import { DELETE, GET, POST } from './route';

function ownerAuth(organisationId: string = 'org_owner'): OwnerAuthState {
  return {
    status: 'authenticated',
    owner: {
      session: {
        sub: 'usr_owner',
        role: 'OWNER',
        org: organisationId,
        ver: 1,
        iat: Math.floor(Date.now() / 1000) - 10,
        exp: Math.floor(Date.now() / 1000) + 3600,
      },
      profile: {
        id: 'usr_owner',
        firstName: 'Foli',
        lastName: 'Admin',
        email: 'owner@crelune.test',
        role: 'OWNER',
        organisationId,
        organisationName: 'CRELUNE Test',
        timezone: 'Africa/Accra',
      },
      preferences: null,
    },
  };
}

function buildUploadRequest(params: {
  url?: string;
  origin?: string | null;
  bytes?: Uint8Array;
  mimeType?: string;
  filename?: string;
  extraFields?: Record<string, string>;
  declaredContentLength?: string;
}): Request {
  const form = new FormData();
  if (params.bytes !== undefined) {
    const file = new File(
      [Buffer.from(params.bytes)],
      params.filename ?? 'photo.png',
      { type: params.mimeType ?? 'image/png' }
    );
    form.set('file', file);
  }
  if (params.extraFields) {
    for (const [k, v] of Object.entries(params.extraFields)) {
      form.set(k, v);
    }
  }
  const headers = new Headers({
    host: 'localhost:3000',
  });
  if (params.origin !== null) {
    headers.set('origin', params.origin ?? 'http://localhost:3000');
  }
  if (params.declaredContentLength !== undefined) {
    headers.set('content-length', params.declaredContentLength);
  }
  return new Request(params.url ?? 'http://localhost:3000/api/members/mem_1/photo', {
    method: 'POST',
    headers,
    body: form,
  });
}

function buildStreamingMultipartRequest(params: {
  totalBytesToEmit: number;
  declaredContentLength?: string | null;
  chunkSize?: number;
}): { request: Request; getBytesReadFromStream: () => number; wasCancelled: () => boolean } {
  const boundary = '----creluneStreamBoundary12345';
  const chunkSize = params.chunkSize ?? 512 * 1024;
  let emitted = 0;
  let cancelled = false;

  const stream = new ReadableStream<Uint8Array>(
    {
      start(controller) {
        const preamble = Buffer.from(
          `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="huge.png"\r\nContent-Type: image/png\r\n\r\n`,
          'utf8'
        );
        emitted += preamble.byteLength;
        controller.enqueue(preamble);
      },
      pull(controller) {
        if (emitted >= params.totalBytesToEmit) {
          const epilogue = Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8');
          emitted += epilogue.byteLength;
          controller.enqueue(epilogue);
          controller.close();
          return;
        }
        const nextSize = Math.min(chunkSize, params.totalBytesToEmit - emitted);
        emitted += nextSize;
        controller.enqueue(new Uint8Array(nextSize));
      },
      cancel() {
        cancelled = true;
      },
    },
    new CountQueuingStrategy({ highWaterMark: 0 })
  );

  const headers = new Headers({
    host: 'localhost:3000',
    origin: 'http://localhost:3000',
    'content-type': `multipart/form-data; boundary=${boundary}`,
  });
  if (params.declaredContentLength) {
    headers.set('content-length', params.declaredContentLength);
  }

  const request = new Request('http://localhost:3000/api/members/mem_1/photo', {
    method: 'POST',
    headers,
    body: stream,
    duplex: 'half',
  } as RequestInit);

  return {
    request,
    getBytesReadFromStream: () => emitted,
    wasCancelled: () => cancelled,
  };
}

describe('Member Photo API Routes (/api/members/[id]/photo)', () => {
  beforeEach(() => {
    mockState.authResult = ownerAuth('org_owner');
    mockState.clearCookieCalls = 0;
    mockState.members.clear();
    mockState.objects.clear();
    mockState.auditLogs.length = 0;
    mockState.pendingCleanups.clear();
    mockState.forceStorageErrorMessage = null;
    mockState.forceDbFailure = false;

    const now = new Date('2026-11-11T04:00:00Z');
    mockState.members.set('mem_1', {
      id: 'mem_1',
      organisationId: 'org_owner',
      fullName: 'Akosua Mensah',
      preferredName: null,
      normalizedName: 'akosua mensah',
      birthDay: 14,
      birthMonth: 10,
      birthYear: 1995,
      phone: null,
      normalizedPhone: null,
      email: null,
      notes: null,
      photoStorageKey: null,
      photoMimeType: null,
      photoByteSize: null,
      photoUpdatedAt: null,
      archivedAt: null,
      createdAt: now,
      updatedAt: now,
    });
    mockState.members.set('mem_other_org', {
      id: 'mem_other_org',
      organisationId: 'org_other',
      fullName: 'Other Org Member',
      preferredName: null,
      normalizedName: 'other org member',
      birthDay: 5,
      birthMonth: 6,
      birthYear: null,
      phone: null,
      normalizedPhone: null,
      email: null,
      notes: null,
      photoStorageKey:
        'development/organisations/org_other/members/mem_other_org/photos/existing.png',
      photoMimeType: 'image/png',
      photoByteSize: 64,
      photoUpdatedAt: now,
      archivedAt: null,
      createdAt: now,
      updatedAt: now,
    });
    mockState.objects.set(
      'development/organisations/org_other/members/mem_other_org/photos/existing.png',
      { body: createSyntheticPng(4, 4), contentType: 'image/png' }
    );
  });

  it('rejects unauthenticated, revoked, CSRF-failing, and cross-organisation requests', async () => {
    const routeCtx = { params: Promise.resolve({ id: 'mem_1' }) };

    mockState.authResult = { status: 'unauthenticated', owner: null };
    expect(
      (await GET(new Request('http://localhost:3000/api/members/mem_1/photo'), routeCtx)).status
    ).toBe(401);
    expect((await POST(buildUploadRequest({ bytes: createSyntheticPng() }), routeCtx)).status).toBe(
      401
    );
    expect(
      (
        await DELETE(
          new Request('http://localhost:3000/api/members/mem_1/photo', {
            method: 'DELETE',
            headers: { host: 'localhost:3000', origin: 'http://localhost:3000' },
          }),
          routeCtx
        )
      ).status
    ).toBe(401);

    mockState.authResult = { status: 'revoked', owner: null };
    const revokedRes = await GET(
      new Request('http://localhost:3000/api/members/mem_1/photo'),
      routeCtx
    );
    expect(revokedRes.status).toBe(401);
    expect(mockState.clearCookieCalls).toBe(1);

    mockState.authResult = ownerAuth('org_owner');
    expect(
      (
        await POST(
          buildUploadRequest({ origin: null, bytes: createSyntheticPng() }),
          routeCtx
        )
      ).status
    ).toBe(403);
    expect(
      (
        await DELETE(
          new Request('http://localhost:3000/api/members/mem_1/photo', {
            method: 'DELETE',
            headers: { host: 'localhost:3000', origin: 'https://evil.example.com' },
          }),
          routeCtx
        )
      ).status
    ).toBe(403);

    const otherCtx = { params: Promise.resolve({ id: 'mem_other_org' }) };
    expect(
      (
        await GET(
          new Request('http://localhost:3000/api/members/mem_other_org/photo'),
          otherCtx
        )
      ).status
    ).toBe(404);
    expect(
      (
        await POST(
          buildUploadRequest({
            url: 'http://localhost:3000/api/members/mem_other_org/photo',
            bytes: createSyntheticPng(),
          }),
          otherCtx
        )
      ).status
    ).toBe(404);
    expect(
      (
        await DELETE(
          new Request('http://localhost:3000/api/members/mem_other_org/photo', {
            method: 'DELETE',
            headers: { host: 'localhost:3000', origin: 'http://localhost:3000' },
          }),
          otherCtx
        )
      ).status
    ).toBe(404);
  });

  it('enforces pre-parse request-body limits even when Content-Length is missing or falsely small, and rejects malformed multipart', async () => {
    const routeCtx = { params: Promise.resolve({ id: 'mem_1' }) };

    // 1. Missing Content-Length on normal valid upload succeeds cleanly
    const validPng = await createDecodablePng(10, 10);
    const validBoundary = '----creluneValidBoundary';
    const validPayload = Buffer.concat([
      Buffer.from(
        `--${validBoundary}\r\nContent-Disposition: form-data; name="file"; filename="ok.png"\r\nContent-Type: image/png\r\n\r\n`,
        'utf8'
      ),
      Buffer.from(validPng),
      Buffer.from(`\r\n--${validBoundary}--\r\n`, 'utf8'),
    ]);
    const noContentLenReq = new Request('http://localhost:3000/api/members/mem_1/photo', {
      method: 'POST',
      headers: {
        host: 'localhost:3000',
        origin: 'http://localhost:3000',
        'content-type': `multipart/form-data; boundary=${validBoundary}`,
      },
      body: new ReadableStream({
        start(c) {
          c.enqueue(validPayload);
          c.close();
        },
      }),
      duplex: 'half',
    } as RequestInit);
    expect((await POST(noContentLenReq, routeCtx)).status).toBe(200);

    // 2. Missing Content-Length on huge stream (> 10.25 MB) cancels stream mid-flight with 413
    const hugeNoHeader = buildStreamingMultipartRequest({
      totalBytesToEmit: 32 * 1024 * 1024,
      declaredContentLength: null,
      chunkSize: 512 * 1024,
    });
    const hugeNoHeaderRes = await POST(hugeNoHeader.request, routeCtx);
    expect(hugeNoHeaderRes.status).toBe(413);
    expect(hugeNoHeader.wasCancelled()).toBe(true);
    expect(hugeNoHeader.getBytesReadFromStream()).toBeLessThanOrEqual(
      MAX_MULTIPART_CONTENT_LENGTH + 512 * 1024
    );

    // 3. Falsely small Content-Length (128 bytes) on 20 MB stream STILL aborts at limit with 413
    const spoofedSmallHeader = buildStreamingMultipartRequest({
      totalBytesToEmit: 20 * 1024 * 1024,
      declaredContentLength: '128',
      chunkSize: 512 * 1024,
    });
    const spoofedRes = await POST(spoofedSmallHeader.request, routeCtx);
    expect(spoofedRes.status).toBe(413);
    expect(spoofedSmallHeader.wasCancelled()).toBe(true);
    expect(spoofedSmallHeader.getBytesReadFromStream()).toBeLessThanOrEqual(
      MAX_MULTIPART_CONTENT_LENGTH + 512 * 1024
    );

    // 4. Body within MAX_MULTIPART_CONTENT_LENGTH but inner Blob > 10 MB still rejected with 413
    const overImageCap = new Uint8Array(MAX_MEMBER_PHOTO_BYTES + 64);
    const overImageRes = await POST(
      buildUploadRequest({
        bytes: overImageCap,
      }),
      routeCtx
    );
    expect(overImageRes.status).toBe(413);

    // 5. Body above MAX_MULTIPART_CONTENT_LENGTH with large Content-Length rejected before read
    const declaredHugeRes = await POST(
      buildUploadRequest({
        bytes: validPng,
        declaredContentLength: String(MAX_MEMBER_PHOTO_BYTES + 1024 * 1024),
      }),
      routeCtx
    );
    expect(declaredHugeRes.status).toBe(413);

    // 6. Malformed multipart boundary / truncated multipart body -> 400
    const malformedReq = new Request('http://localhost:3000/api/members/mem_1/photo', {
      method: 'POST',
      headers: {
        host: 'localhost:3000',
        origin: 'http://localhost:3000',
        'content-type': 'multipart/form-data; boundary=----badBoundary',
      },
      body: 'not-even-a-valid-multipart-frame',
    });
    expect((await POST(malformedReq, routeCtx)).status).toBe(400);
  });

  it('rejects client-supplied object keys, SVG/spoofed uploads, and leaks zero internal secrets', async () => {
    const routeCtx = { params: Promise.resolve({ id: 'mem_1' }) };
    const pngBytes = await createDecodablePng(8, 8);

    const arbitraryKeyRes = await POST(
      buildUploadRequest({
        bytes: pngBytes,
        extraFields: { storageKey: 'production/organisations/hack/evil.png' },
      }),
      routeCtx
    );
    expect(arbitraryKeyRes.status).toBe(400);

    const arbitraryBucketRes = await POST(
      buildUploadRequest({
        bytes: pngBytes,
        extraFields: { bucket: 'other-bucket' },
      }),
      routeCtx
    );
    expect(arbitraryBucketRes.status).toBe(400);

    const svgRes = await POST(
      buildUploadRequest({
        bytes: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'),
        mimeType: 'image/jpeg',
        filename: 'avatar.jpg',
      }),
      routeCtx
    );
    expect(svgRes.status).toBe(400);

    mockState.forceStorageErrorMessage =
      'S3 Error against https://br-withered-moon.storage.neon.tech using AWS_SECRET_ACCESS_KEY=nsk_live_secret';
    const failRes = await POST(
      buildUploadRequest({
        bytes: pngBytes,
      }),
      routeCtx
    );
    expect(failRes.status).toBe(500);
    const failText = await failRes.text();
    expect(failText).not.toContain('nsk_live_secret');
    expect(failText).not.toContain('br-withered-moon');
  });

  it('strips EXIF/GPS, stores re-encoded bytes, streams private photo, enforces archival policy, and removes idempotently', async () => {
    const routeCtx = { params: Promise.resolve({ id: 'mem_1' }) };
    const exifJpeg = await createSyntheticExifGpsJpeg({
      width: 24,
      height: 16,
      orientation: '6',
    });

    // 1. Upload EXIF+GPS rotated JPEG
    const uploadRes = await POST(
      buildUploadRequest({
        bytes: exifJpeg,
        mimeType: 'image/jpeg',
        filename: 'original-camera-name.jpg',
      }),
      routeCtx
    );
    expect(uploadRes.status).toBe(200);
    const uploadJson = await uploadRes.json();
    expect(uploadJson.member.hasPhoto).toBe(true);
    // Upright rotated dimensions: 16x24
    expect(uploadJson.photo).toMatchObject({
      url: '/api/members/mem_1/photo',
      mimeType: 'image/jpeg',
      width: 16,
      height: 24,
    });
    const uploadText = JSON.stringify(uploadJson);
    expect(uploadText).not.toContain('original-camera-name');
    expect(uploadText).not.toContain('development/organisations');

    const storedAfterUpload = mockState.members.get('mem_1')!;
    const firstKey = storedAfterUpload.photoStorageKey!;
    expect(firstKey).toMatch(
      /^development\/organisations\/org_owner\/members\/mem_1\/photos\/[a-zA-Z0-9-]+\.jpg$/
    );

    // 2. Private retrieval streams re-encoded bytes with ZERO EXIF/GPS/XMP/COM metadata
    const getRes = await GET(
      new Request('http://localhost:3000/api/members/mem_1/photo'),
      routeCtx
    );
    expect(getRes.status).toBe(200);
    expect(getRes.headers.get('content-type')).toBe('image/jpeg');
    expect(getRes.headers.get('cache-control')).toBe('private, no-store');
    expect(getRes.headers.get('x-content-type-options')).toBe('nosniff');
    expect(getRes.headers.get('x-robots-tag')).toBe('noindex, nofollow, noarchive');

    const streamedBuf = Buffer.from(await getRes.arrayBuffer());
    expect(streamedBuf).not.toEqual(Buffer.from(exifJpeg));
    expect(streamedBuf.toString('latin1')).not.toContain('SecretGPSLocation');
    expect(streamedBuf.toString('latin1')).not.toContain('SyntheticCam');
    const streamedMeta = await sharp(streamedBuf).metadata();
    expect(streamedMeta.exif).toBeUndefined();
    expect(streamedMeta.width).toBe(16);
    expect(streamedMeta.height).toBe(24);

    // 3. Replacement with WebP removes previous JPEG object
    const webpBytes = await createDecodableWebp(20, 20);
    const replaceRes = await POST(
      buildUploadRequest({
        bytes: webpBytes,
        mimeType: 'image/webp',
        filename: 'new.webp',
      }),
      routeCtx
    );
    expect(replaceRes.status).toBe(200);
    const newKey = mockState.members.get('mem_1')!.photoStorageKey!;
    expect(newKey).not.toBe(firstKey);
    expect(mockState.objects.has(oldKey(firstKey))).toBe(false);
    expect(mockState.objects.has(newKey)).toBe(true);

    // 4. Archived member policy: GET & DELETE permitted, POST rejected (409)
    mockState.members.get('mem_1')!.archivedAt = new Date();
    expect(
      (await GET(new Request('http://localhost:3000/api/members/mem_1/photo'), routeCtx)).status
    ).toBe(200);
    expect(
      (
        await POST(
          buildUploadRequest({
            bytes: await createDecodablePng(),
            filename: 'archived.png',
          }),
          routeCtx
        )
      ).status
    ).toBe(409);

    // 5. Removal + idempotent second DELETE
    const delRes = await DELETE(
      new Request('http://localhost:3000/api/members/mem_1/photo', {
        method: 'DELETE',
        headers: { host: 'localhost:3000', origin: 'http://localhost:3000' },
      }),
      routeCtx
    );
    expect(delRes.status).toBe(200);
    expect((await delRes.json()).removed).toBe(true);
    expect(mockState.objects.has(newKey)).toBe(false);

    const delAgainRes = await DELETE(
      new Request('http://localhost:3000/api/members/mem_1/photo', {
        method: 'DELETE',
        headers: { host: 'localhost:3000', origin: 'http://localhost:3000' },
      }),
      routeCtx
    );
    expect(delAgainRes.status).toBe(200);
    expect((await delAgainRes.json()).removed).toBe(false);
  });
});

function oldKey(k: string): string {
  return k;
}
