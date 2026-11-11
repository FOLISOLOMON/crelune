import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { MemberDetail, MemberDirectoryItem } from '@crelune/shared';
import type { OwnerAuthState } from '@/lib/auth/owner-guard';

const mockState = vi.hoisted(() => ({
  auth: { status: 'unauthenticated', owner: null } as OwnerAuthState,
  listResult: {
    members: [] as MemberDirectoryItem[],
    pagination: {
      page: 1,
      limit: 25,
      total: 0,
      totalPages: 0,
      hasNextPage: false,
      hasPreviousPage: false,
    },
  },
  memberDetail: null as MemberDetail | null,
}));

vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children: React.ReactNode;
    className?: string;
    target?: string;
    rel?: string;
  }) => React.createElement('a', { href, ...rest }, children),
}));

vi.mock('next/navigation', () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
  usePathname: () => '/members',
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

vi.mock('@/lib/auth/owner-guard', () => ({
  resolveAuthenticatedOwner: vi.fn(async () => mockState.auth),
}));

vi.mock('@/lib/members/member-service', async () => {
  const actual = await vi.importActual<
    typeof import('@/lib/members/member-service')
  >('@/lib/members/member-service');
  return {
    ...actual,
    listMembers: vi.fn(async () => mockState.listResult),
    getMemberById: vi.fn(async () => {
      if (!mockState.memberDetail) {
        throw new actual.MemberNotFoundError();
      }
      return mockState.memberDetail;
    }),
  };
});

import { MemberDirectoryClient } from './MemberDirectoryClient';
import { MemberProfileClient } from './MemberProfileClient';
import { DuplicateMemberDialog } from './DuplicateMemberDialog';
import { MemberPhotoManager } from './MemberPhotoManager';
import { AddMemberModal } from './AddMemberModal';
import MembersPage from '@/app/(dashboard)/members/page';
import MemberProfilePage from '@/app/(dashboard)/members/[id]/page';

function sampleDirectoryItem(
  overrides: Partial<MemberDirectoryItem> = {}
): MemberDirectoryItem {
  return {
    id: 'mem_01',
    fullName: 'Amara Osei',
    preferredName: 'Amy',
    birthDay: 14,
    birthMonth: 10,
    birthYear: null,
    phone: '+233240000111',
    email: 'amara@example.com',
    hasPhoto: true,
    photoUpdatedAt: '2026-06-01T12:00:00.000Z',
    isActive: true,
    archivedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function sampleMemberDetail(overrides: Partial<MemberDetail> = {}): MemberDetail {
  return {
    ...sampleDirectoryItem(),
    notes: 'Private pastoral note — must stay out of directory list.',
    ...overrides,
  };
}

function makeAuthenticatedOwnerState(): OwnerAuthState {
  return {
    status: 'authenticated',
    owner: {
      session: {
        sub: 'usr_1',
        role: 'OWNER',
        org: 'org_1',
        ver: 1,
        iat: 1000,
        exp: 9999999999,
      },
      profile: {
        id: 'usr_1',
        email: 'owner@crelune.app',
        firstName: 'Workspace',
        lastName: 'Owner',
        role: 'OWNER',
        organisationId: 'org_1',
        organisationName: 'CRELUNE Studio',
      },
      preferences: {
        theme: 'light',
        dateFormat: 'dd/MM/yyyy',
        timezone: 'Africa/Accra',
        leadTimeDaysBirthday: 7,
        leadTimeDaysEvent: 14,
        defaultExportFormat: 'PNG',
      },
    },
  };
}

describe('Member Directory & Profile UI components', () => {
  beforeEach(() => {
    mockState.auth = makeAuthenticatedOwnerState();
  });

  it('renders directory rows with private photo stream URL and omits private notes', () => {
    const html = renderToStaticMarkup(
      <MemberDirectoryClient
        initialMembers={[
          sampleDirectoryItem(),
          sampleDirectoryItem({
            id: 'mem_02',
            fullName: 'Kwesi Boateng',
            preferredName: null,
            hasPhoto: false,
            photoUpdatedAt: null,
            isActive: false,
            archivedAt: '2026-02-01T00:00:00.000Z',
          }),
        ]}
        initialPagination={{
          page: 1,
          limit: 25,
          total: 2,
          totalPages: 1,
          hasNextPage: false,
          hasPreviousPage: false,
        }}
      />
    );

    expect(html).toContain('Members Directory');
    expect(html).toContain('Amara Osei');
    expect(html).toContain('Preferred: Amy');
    expect(html).toContain('14 Oct');
    expect(html).toContain('/api/members/mem_01/photo?v=2026-06-01T12%3A00%3A00.000Z');
    expect(html).toContain('/members/mem_01');
    expect(html).toContain('Kwesi Boateng');
    expect(html).toContain('Archived');
    expect(html).toContain('Add Member');
    expect(html).not.toContain('crelune-dev-member-photos');
    expect(html).not.toContain('Private pastoral note');
  });

  it('renders clean empty state when directory has zero members', () => {
    const html = renderToStaticMarkup(
      <MemberDirectoryClient
        initialMembers={[]}
        initialPagination={{
          page: 1,
          limit: 25,
          total: 0,
          totalPages: 0,
          hasNextPage: false,
          hasPreviousPage: false,
        }}
      />
    );

    expect(html).toContain('Your member directory is empty');
    expect(html).toContain('Add your first member');
  });

  it('renders Add Member form with optional birthYear label and photo picker', () => {
    const html = renderToStaticMarkup(
      <AddMemberModal
        open={true}
        onClose={() => undefined}
        onMemberCreated={() => undefined}
      />
    );

    expect(html).toContain('Add Member');
    expect(html).toContain('Full Name *');
    expect(html).toContain('Birth Year (Optional)');
    expect(html).toContain('Initial Profile Photo (Optional)');
    expect(html).toContain('Create Member');
  });

  it('renders duplicate confirmation dialog candidates clearly', () => {
    const html = renderToStaticMarkup(
      <DuplicateMemberDialog
        open={true}
        message="Potential duplicate member detected."
        isConfirming={false}
        onCancel={() => undefined}
        onConfirmCreate={() => undefined}
        candidates={[
          {
            id: 'mem_dup',
            fullName: 'Amara Osei',
            preferredName: 'Amy',
            birthMonth: 10,
            birthDay: 14,
            isArchived: true,
            matchReason: 'PHONE_AND_NAME',
          },
        ]}
      />
    );

    expect(html).toContain('Possible Duplicate Member Found');
    expect(html).toContain('Amara Osei');
    expect(html).toContain('Archived');
    expect(html).toContain('Matches both phone number and full name');
    expect(html).toContain('/members/mem_dup');
    expect(html).toContain('Yes, Create Separate Member');
    expect(html).toContain('Cancel &amp; Review Form');
  });

  it('renders member profile details including notes, optional year label, and archive without permanent delete', () => {
    const activeHtml = renderToStaticMarkup(
      <MemberProfileClient initialMember={sampleMemberDetail()} />
    );

    expect(activeHtml).toContain('Amara Osei');
    expect(activeHtml).toContain('Private pastoral note');
    expect(activeHtml).toContain('Birth year omitted');
    expect(activeHtml).toContain('Edit Profile');
    expect(activeHtml).toContain('Archive Member');
    expect(activeHtml).not.toContain('Delete Member');

    const archivedHtml = renderToStaticMarkup(
      <MemberProfileClient
        initialMember={sampleMemberDetail({
          isActive: false,
          archivedAt: '2026-04-02T00:00:00.000Z',
        })}
      />
    );

    expect(archivedHtml).toContain('Archived record');
    expect(archivedHtml).toContain('Restore Member');
    expect(archivedHtml).toContain('Restore the member before uploading, replacing, or removing their photo');
  });

  it('renders private photo controls for active member with and without a photo', () => {
    const withoutPhoto = renderToStaticMarkup(
      <MemberPhotoManager
        member={sampleMemberDetail({ hasPhoto: false, photoUpdatedAt: null })}
        onMemberUpdated={() => undefined}
      />
    );
    expect(withoutPhoto).toContain('Choose Photo');
    expect(withoutPhoto).not.toContain('Remove');

    const withPhoto = renderToStaticMarkup(
      <MemberPhotoManager
        member={sampleMemberDetail({ hasPhoto: true })}
        onMemberUpdated={() => undefined}
      />
    );
    expect(withPhoto).toContain('Replace Photo');
    expect(withPhoto).toContain('Remove');
  });

  it('enforces server-component authentication guard and not-found handling cleanly', async () => {
    mockState.auth = { status: 'unauthenticated', owner: null };
    await expect(MembersPage()).rejects.toThrow('NEXT_REDIRECT:/login');
    await expect(
      MemberProfilePage({ params: Promise.resolve({ id: 'mem_01' }) })
    ).rejects.toThrow('NEXT_REDIRECT:/login');

    mockState.auth = { status: 'revoked', owner: null };
    const revokedHtml = renderToStaticMarkup(await MembersPage());
    expect(revokedHtml).toContain('Session');

    mockState.auth = makeAuthenticatedOwnerState();

    mockState.memberDetail = null;
    const notFoundHtml = renderToStaticMarkup(
      await MemberProfilePage({ params: Promise.resolve({ id: 'missing_id' }) })
    );
    expect(notFoundHtml).toContain('Member Record Not Found');
  });
});
