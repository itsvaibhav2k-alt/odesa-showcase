import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/supabase/server', () => ({ createServerClient: vi.fn() }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));
vi.mock('@/lib/authz/context', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/authz/context')>();
  return { ...actual, requireAccessContext: vi.fn() };
});
vi.mock('@/lib/messaging/canonical-draft', () => ({
  lookupCanonicalProposalForMessage: vi.fn(async () => ({
    ok: true,
    linked: false,
  })),
}));

import { requireAccessContext, type AccessContext } from '@/lib/authz/context';
import { createAdminClient } from '@/lib/supabase/admin';
import { createServerClient } from '@/lib/supabase/server';
import { PATCH } from '../[id]/edit/route';

const DRAFT_ID = '22222222-2222-4222-8222-222222222222';
const CONVERSATION_ID = '33333333-3333-4333-8333-333333333333';
const PROPERTY_ID = '44444444-4444-4444-8444-444444444444';
const ORG_ID = '11111111-1111-4111-8111-111111111111';

const accessMock = vi.mocked(requireAccessContext);
const adminMock = vi.mocked(createAdminClient);
const serverMock = vi.mocked(createServerClient);

function context(overrides: Partial<AccessContext> = {}): AccessContext {
  return {
    userId: 'user-1',
    membershipId: 'membership-1',
    organizationId: ORG_ID,
    role: 'manager',
    capabilities: new Set(['draft_messages']),
    propertyScope: [PROPERTY_ID],
    ...overrides,
  };
}

function request(body = 'Edited draft'): NextRequest {
  return new NextRequest(`http://localhost/api/messaging/drafts/${DRAFT_ID}/edit`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ body }),
  });
}

function installAdmin(options: {
  draft?: Record<string, unknown> | null;
  conversation?: Record<string, unknown> | null;
} = {}) {
  const draft = options.draft === undefined
    ? {
        id: DRAFT_ID,
        organization_id: ORG_ID,
        conversation_id: CONVERSATION_ID,
        draft_status: 'pending_review',
        retell_artifact_key: null,
      }
    : options.draft;
  const conversation = options.conversation === undefined
    ? { id: CONVERSATION_ID, organization_id: ORG_ID, property_id: PROPERTY_ID }
    : options.conversation;
  const updateEqs: Array<[string, unknown]> = [];
  const update = vi.fn(() => {
    const chain = {
      eq: vi.fn((column: string, value: unknown) => {
        updateEqs.push([column, value]);
        return chain;
      }),
      select: vi.fn(() => chain),
      maybeSingle: vi.fn(async () => ({ data: { id: DRAFT_ID }, error: null })),
    };
    return chain;
  });
  const from = vi.fn((table: string) => {
    if (table === 'messages') {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            maybeSingle: vi.fn(async () => ({ data: draft, error: null })),
          })),
        })),
        update,
      };
    }
    if (table === 'conversations') {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            maybeSingle: vi.fn(async () => ({ data: conversation, error: null })),
          })),
        })),
      };
    }
    throw new Error(`unexpected table ${table}`);
  });
  adminMock.mockReturnValue({ from } as never);
  return { from, update, updateEqs };
}

beforeEach(() => {
  vi.clearAllMocks();
  serverMock.mockResolvedValue({} as never);
  accessMock.mockResolvedValue({ ok: true, context: context() });
});

describe('PATCH /api/messaging/drafts/[id]/edit authorization', () => {
  it('fails closed for inactive membership and missing capability before admin access', async () => {
    accessMock.mockResolvedValueOnce({ ok: false, status: 403, error: 'Forbidden' });
    expect((await PATCH(request(), { params: Promise.resolve({ id: DRAFT_ID }) })).status).toBe(403);
    expect(adminMock).not.toHaveBeenCalled();

    accessMock.mockResolvedValueOnce({
      ok: true,
      context: context({ capabilities: new Set() }),
    });
    expect((await PATCH(request(), { params: Promise.resolve({ id: DRAFT_ID }) })).status).toBe(403);
    expect(adminMock).not.toHaveBeenCalled();
  });

  it.each([
    { conversation: null },
    { conversation: { id: CONVERSATION_ID, organization_id: ORG_ID, property_id: null } },
    { conversation: { id: CONVERSATION_ID, organization_id: 'other-org', property_id: PROPERTY_ID } },
  ])('fails closed when conversation linkage is unavailable or inconsistent', async ({ conversation }) => {
    const admin = installAdmin({ conversation });
    const response = await PATCH(request(), { params: Promise.resolve({ id: DRAFT_ID }) });
    expect(response.status).toBe(403);
    expect(admin.update).not.toHaveBeenCalled();
  });

  it('denies a draft outside the exact property grant', async () => {
    accessMock.mockResolvedValueOnce({
      ok: true,
      context: context({ propertyScope: ['another-property'] }),
    });
    const admin = installAdmin();
    const response = await PATCH(request(), { params: Promise.resolve({ id: DRAFT_ID }) });
    expect(response.status).toBe(403);
    expect(admin.update).not.toHaveBeenCalled();
  });

  it('edits an exact granted draft with defense-in-depth CAS filters', async () => {
    const admin = installAdmin();
    const response = await PATCH(request('  Safe edit  '), {
      params: Promise.resolve({ id: DRAFT_ID }),
    });

    expect(response.status).toBe(200);
    expect(admin.update).toHaveBeenCalledWith({
      body: 'Safe edit',
      draft_status: 'pending_review',
    });
    expect(admin.updateEqs).toEqual([
      ['id', DRAFT_ID],
      ['organization_id', ORG_ID],
      ['conversation_id', CONVERSATION_ID],
      ['draft_status', 'pending_review'],
    ]);
  });
});
