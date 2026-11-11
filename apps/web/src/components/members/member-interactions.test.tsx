// @vitest-environment jsdom

import React from 'react';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  MemberDetail,
  MemberDirectoryItem,
  MemberPaginationMeta,
} from '@crelune/shared';
import { MemberDirectoryClient } from './MemberDirectoryClient';
import { MemberProfileClient } from './MemberProfileClient';

const { routerRefreshMock } = vi.hoisted(() => ({
  routerRefreshMock: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    refresh: routerRefreshMock,
    push: vi.fn(),
  }),
}));

const BASE_PAGINATION: MemberPaginationMeta = {
  page: 1,
  limit: 25,
  total: 1,
  totalPages: 1,
  hasNextPage: false,
  hasPreviousPage: false,
};

const SAMPLE_MEMBER_ITEM: MemberDirectoryItem = {
  id: '11111111-1111-4111-8111-111111111111',
  fullName: 'Grace Mensah',
  preferredName: 'Gracie',
  phone: '+233201112222',
  email: 'grace@example.com',
  birthDay: 14,
  birthMonth: 11,
  birthYear: null,
  hasPhoto: false,
  photoUpdatedAt: null,
  isActive: true,
  archivedAt: null,
  createdAt: '2026-11-01T10:00:00.000Z',
  updatedAt: '2026-11-01T10:00:00.000Z',
};

const SAMPLE_MEMBER_DETAIL: MemberDetail = {
  ...SAMPLE_MEMBER_ITEM,
  notes: 'Choir lead alto',
};

describe('Member Directory & Profile DOM Workflows (Stage 3.5 + M4)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('prevents duplicate SSR mount fetch and handles 409 duplicate confirmation then retry on MemberDirectoryClient', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/members' && init?.method === 'POST') {
        const body = JSON.parse(String(init.body));
        if (!body.confirmDuplicate) {
          return new Response(
            JSON.stringify({
              error: 'A similar member already exists.',
              code: 'POTENTIAL_DUPLICATE_MEMBER',
              duplicateCandidates: [
                {
                  id: SAMPLE_MEMBER_ITEM.id,
                  fullName: 'Grace Mensah',
                  preferredName: 'Gracie',
                  phone: '+233201112222',
                  birthDay: 14,
                  birthMonth: 11,
                  birthYear: null,
                  isArchived: false,
                  matchReason: 'EXACT_NAME',
                },
              ],
            }),
            { status: 409, headers: { 'Content-Type': 'application/json' } }
          );
        }

        return new Response(
          JSON.stringify({
            member: {
              ...SAMPLE_MEMBER_ITEM,
              id: '22222222-2222-4222-8222-222222222222',
              fullName: body.fullName,
              notes: null,
              archivedAt: null,
            },
          }),
          { status: 201, headers: { 'Content-Type': 'application/json' } }
        );
      }

      if (url.startsWith('/api/members?')) {
        return new Response(
          JSON.stringify({
            members: [
              SAMPLE_MEMBER_ITEM,
              {
                ...SAMPLE_MEMBER_ITEM,
                id: '22222222-2222-4222-8222-222222222222',
                fullName: 'Grace Mensah',
              },
            ],
            pagination: { ...BASE_PAGINATION, total: 2 },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <MemberDirectoryClient
        initialMembers={[SAMPLE_MEMBER_ITEM]}
        initialPagination={BASE_PAGINATION}
      />
    );

    // Defect A1 verification: initial SSR state must NOT trigger a redundant GET on mount
    expect(fetchMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /add member/i }));

    fireEvent.change(screen.getByLabelText(/full name/i), {
      target: { value: 'Grace Mensah' },
    });

    fireEvent.click(screen.getByRole('button', { name: /^create member$/i }));

    // 409 shows explicit duplicate confirmation prompt while keeping modal values editable
    await screen.findByText(/possible duplicate member found/i);

    fireEvent.click(
      screen.getByRole('button', { name: /yes, create separate member/i })
    );

    await waitFor(() => {
      const postCalls = fetchMock.mock.calls.filter(
        ([url, init]) => url === '/api/members' && init?.method === 'POST'
      );
      expect(postCalls).toHaveLength(2);
      expect(JSON.parse(String(postCalls[1]?.[1]?.body))).toMatchObject({
        fullName: 'Grace Mensah',
        confirmDuplicate: true,
      });
    });

    await screen.findByText(/was added to your directory/i);
  });

  it('supports archiving, restoring, and launching a linked Design Job from MemberProfileClient', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/archive') && init?.method === 'POST') {
        return new Response(
          JSON.stringify({
            member: {
              ...SAMPLE_MEMBER_DETAIL,
              isActive: false,
              archivedAt: '2026-11-11T10:15:00.000Z',
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      if (url.endsWith('/restore') && init?.method === 'POST') {
        return new Response(
          JSON.stringify({
            member: {
              ...SAMPLE_MEMBER_DETAIL,
              isActive: true,
              archivedAt: null,
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      if (url === '/api/designs' && init?.method === 'POST') {
        const body = JSON.parse(String(init.body));
        return new Response(
          JSON.stringify({
            job: {
              id: '66666666-6666-4666-8666-666666666666',
              title: body.title,
              category: body.category,
              status: body.initialStatus,
              priority: body.priority,
              memberId: SAMPLE_MEMBER_DETAIL.id,
              member: {
                id: SAMPLE_MEMBER_DETAIL.id,
                fullName: SAMPLE_MEMBER_DETAIL.fullName,
                preferredName: SAMPLE_MEMBER_DETAIL.preferredName,
                hasPhoto: false,
                photoUpdatedAt: null,
                isActive: true,
              },
              birthdayTargetYear: null,
              targetPlatform: null,
              dimensions: null,
              dueDate: null,
              approvedAt: null,
              exportedAt: null,
              publishedAt: null,
              cancelledAt: null,
              createdAt: '2026-11-11T10:20:00.000Z',
              updatedAt: '2026-11-11T10:20:00.000Z',
              requiredText: null,
              preferredTemplateNote: null,
              referenceNotes: null,
              notes: null,
              history: [],
            },
          }),
          { status: 201, headers: { 'Content-Type': 'application/json' } }
        );
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<MemberProfileClient initialMember={SAMPLE_MEMBER_DETAIL} />);

    // Create a linked Design Job directly from the Member Profile
    fireEvent.click(screen.getByRole('button', { name: /new design job/i }));
    await screen.findByRole('dialog');
    fireEvent.click(screen.getByRole('button', { name: /create design job/i }));

    await screen.findByText(/^created linked design job/i);

    // Archive requires explicit confirmation step
    fireEvent.click(screen.getByRole('button', { name: /^archive member$/i }));
    await screen.findByText(/archive grace mensah\?/i);

    fireEvent.click(screen.getByRole('button', { name: /yes, archive member/i }));
    const restoreButtons = await screen.findAllByRole('button', {
      name: /restore member/i,
    });
    expect(restoreButtons.length).toBeGreaterThan(0);

    // Restore brings member back to active directory
    fireEvent.click(restoreButtons[0]!);
    const archiveButtons = await screen.findAllByRole('button', {
      name: /^archive member$/i,
    });
    expect(archiveButtons.length).toBeGreaterThan(0);
  });
});
