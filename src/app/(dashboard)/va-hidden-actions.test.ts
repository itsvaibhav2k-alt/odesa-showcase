import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({ redirect: vi.fn() }));
vi.mock('@sentry/nextjs', () => ({
  startSpan: vi.fn(
    (_context: unknown, callback: () => unknown) => callback(),
  ),
}));
vi.mock('@/lib/supabase/server', () => ({ createServerClient: vi.fn() }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));
vi.mock('@/lib/documents/upload', () => ({ uploadDocument: vi.fn() }));
vi.mock('@/lib/agent/worker/handlers/add-appliance', () => ({
  handleAddAppliance: vi.fn(),
}));
vi.mock('@/lib/agent/worker/handlers/update-appliance', () => ({
  handleUpdateAppliance: vi.fn(),
}));
vi.mock('@/lib/agent/worker/handlers/set-property-vendor', () => ({
  handleSetPropertyVendor: vi.fn(),
}));
vi.mock('@/lib/agent/worker/handlers/update-tenant-preference', () => ({
  handleUpdateTenantPreference: vi.fn(),
}));
vi.mock('@/lib/messaging/send-with-failover', () => ({
  sendWithFailover: vi.fn(),
}));
vi.mock('@/lib/messaging/provisioning', () => ({
  maybeCapturePoolLowAlert: vi.fn(),
}));

import { createAdminClient } from '@/lib/supabase/admin';
import { createServerClient } from '@/lib/supabase/server';
import { uploadDocument } from '@/lib/documents/upload';
import { handleAddAppliance } from '@/lib/agent/worker/handlers/add-appliance';
import { handleUpdateAppliance } from '@/lib/agent/worker/handlers/update-appliance';
import { handleSetPropertyVendor } from '@/lib/agent/worker/handlers/set-property-vendor';
import { handleUpdateTenantPreference } from '@/lib/agent/worker/handlers/update-tenant-preference';
import { sendWithFailover } from '@/lib/messaging/send-with-failover';
import type { UserRole } from '@/types/database';

import { uploadDocumentAction } from './documents/actions';
import {
  createPortfolioProperty,
  deletePortfolioProperty,
} from './properties/actions';
import {
  addApplianceAction,
  confirmApplianceAction,
} from './properties/[id]/appliances/actions';
import {
  assignVendorAction,
  confirmVendorAction,
} from './properties/[id]/vendors/actions';
import { updateTenantPreferencesAction } from './properties/[id]/units/[unitId]/actions';
import {
  createLeaseAction,
  createPropertyAction,
  createTenantAction,
  createUnitAction,
} from './onboarding/actions';
import {
  assignNumberAction,
  sendTestSmsAction,
  setAssistantNameAction,
} from './onboarding/messaging/actions';
import { setVoiceEnabledAction } from './onboarding/voice/actions';
import { POST as createTestCall } from '../api/retell/test-call/route';
import { PATCH as editMessageDraft } from '../api/messaging/drafts/[id]/edit/route';
import { PATCH as editActionProposal } from '../api/action-proposals/[id]/edit/route';
import { GET as startGoogleOauth } from '../api/oauth/google/start/route';
import {
  createVendor,
  deleteVendor,
} from './settings/actions';
import {
  createApiKey,
  disconnectGoogleCalendar,
  requestPhoneVerification,
  revokeApiKey,
} from './settings/integrations/actions';

const FORBIDDEN = { success: false, error: 'Forbidden' };
let currentRole: UserRole | null = 'va';

function buildServerClient() {
  return {
    auth: {
      getUser: vi.fn(async () => ({
        data: { user: { id: 'user-1', email: 'operator@example.test' } },
        error: null,
      })),
    },
    from: vi.fn((table: string) => {
      if (table === 'organization_memberships') {
        return {
          select: vi.fn(() => {
            const builder = {
              eq: vi.fn(() => builder),
              single: vi.fn(async () => ({
                data: {
                  id: 'membership-1',
                  organization_id: 'org-1',
                  role: currentRole,
                  all_properties: false,
                  membership_capability_overrides: [
                    { capability: 'draft_messages', effect: 'deny' },
                  ],
                  membership_property_grants: [],
                },
                error: null,
              })),
            };
            return builder;
          }),
        };
      }
      if (table !== 'users') {
        throw new Error(`Unexpected pre-guard table access: ${table}`);
      }
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            single: vi.fn(async () => ({
              data: { organization_id: 'org-1', role: currentRole },
              error: null,
            })),
          })),
        })),
      };
    }),
  } as unknown as Awaited<ReturnType<typeof createServerClient>>;
}

describe('VA guards for controls hidden by the role-aware shell', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    currentRole = 'va';
    vi.mocked(createServerClient).mockImplementation(async () =>
      buildServerClient(),
    );
  });

  it('blocks document and portfolio configuration before any write', async () => {
    await expect(uploadDocumentAction(new FormData())).resolves.toEqual(
      FORBIDDEN,
    );
    await expect(
      createPortfolioProperty({
        name: '',
        propertyType: 'single-family',
        addressStreet: '',
        addressCity: '',
        addressState: '',
        addressZip: '',
        unitCount: 1,
      }),
    ).resolves.toEqual(FORBIDDEN);
    await expect(
      deletePortfolioProperty({ propertyId: 'not-a-property-id' }),
    ).resolves.toEqual(FORBIDDEN);

    expect(uploadDocument).not.toHaveBeenCalled();
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it('blocks owner-authored property details before admin handlers run', async () => {
    const propertyId = 'property-1';
    const emptyForm = new FormData();

    await expect(
      addApplianceAction({ propertyId }, emptyForm),
    ).resolves.toEqual(FORBIDDEN);
    await confirmApplianceAction({ propertyId, applianceId: 'appliance-1' });
    await expect(
      assignVendorAction({ propertyId, category: 'plumbing' }, emptyForm),
    ).resolves.toEqual(FORBIDDEN);
    await confirmVendorAction({ propertyId, category: 'plumbing' });
    await expect(
      updateTenantPreferencesAction(
        { propertyId, unitId: 'unit-1', tenantId: 'tenant-1' },
        emptyForm,
      ),
    ).resolves.toEqual(FORBIDDEN);

    expect(createAdminClient).not.toHaveBeenCalled();
    expect(handleAddAppliance).not.toHaveBeenCalled();
    expect(handleUpdateAppliance).not.toHaveBeenCalled();
    expect(handleSetPropertyVendor).not.toHaveBeenCalled();
    expect(handleUpdateTenantPreference).not.toHaveBeenCalled();
  });

  it('blocks onboarding configuration before local or provider mutations', async () => {
    const emptyForm = new FormData();

    await expect(createPropertyAction(emptyForm)).resolves.toEqual(FORBIDDEN);
    await expect(createUnitAction(emptyForm)).resolves.toEqual(FORBIDDEN);
    await expect(createTenantAction(emptyForm)).resolves.toEqual(FORBIDDEN);
    await expect(createLeaseAction(emptyForm)).resolves.toEqual(FORBIDDEN);
    await expect(assignNumberAction()).resolves.toEqual(FORBIDDEN);
    await expect(
      setAssistantNameAction({ name: 'Odesa' }),
    ).resolves.toEqual(FORBIDDEN);
    await expect(sendTestSmsAction('not-a-request-id')).resolves.toEqual(
      FORBIDDEN,
    );
    await expect(setVoiceEnabledAction(true)).resolves.toEqual(FORBIDDEN);

    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it('returns 403 before creating a test-call artifact', async () => {
    const response = await createTestCall(
      new Request('http://localhost/api/retell/test-call', {
        method: 'POST',
        body: JSON.stringify({ scenario: 'maintenance_clean' }),
      }),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual(FORBIDDEN);
  });

  it('returns 403 from direct hidden edit and provider endpoints before validation or access', async () => {
    const invalidEditRequest = () =>
      new NextRequest('http://localhost/api/hidden/edit', {
        method: 'PATCH',
        body: JSON.stringify({ body: '' }),
        headers: { 'content-type': 'application/json' },
      });

    const messageResponse = await editMessageDraft(invalidEditRequest(), {
      params: Promise.resolve({ id: 'message-1' }),
    });
    const proposalResponse = await editActionProposal(invalidEditRequest(), {
      params: Promise.resolve({ id: 'proposal-1' }),
    });

    const previousClientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
    const previousRedirect = process.env.GOOGLE_OAUTH_REDIRECT_URI;
    process.env.GOOGLE_OAUTH_CLIENT_ID = 'local-test-client';
    process.env.GOOGLE_OAUTH_REDIRECT_URI =
      'http://localhost:3100/api/oauth/google/callback';
    let oauthResponse: Response;
    try {
      oauthResponse = await startGoogleOauth();
    } finally {
      if (previousClientId === undefined) {
        delete process.env.GOOGLE_OAUTH_CLIENT_ID;
      } else {
        process.env.GOOGLE_OAUTH_CLIENT_ID = previousClientId;
      }
      if (previousRedirect === undefined) {
        delete process.env.GOOGLE_OAUTH_REDIRECT_URI;
      } else {
        process.env.GOOGLE_OAUTH_REDIRECT_URI = previousRedirect;
      }
    }

    for (const response of [messageResponse, proposalResponse, oauthResponse]) {
      expect(response.status).toBe(403);
      await expect(response.json()).resolves.toEqual(FORBIDDEN);
    }

    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it('blocks hidden settings mutations before validation or provider access', async () => {
    await expect(
      createVendor({ name: '', category: 'plumbing' }),
    ).resolves.toEqual(FORBIDDEN);
    await expect(
      deleteVendor({ id: 'not-a-vendor-id' }),
    ).resolves.toEqual(FORBIDDEN);
    await expect(createApiKey({ label: '' })).resolves.toEqual(FORBIDDEN);
    await expect(
      revokeApiKey({ id: 'not-an-api-key-id' }),
    ).resolves.toEqual(FORBIDDEN);
    await expect(
      requestPhoneVerification({ phoneE164: 'not-a-phone-number' }),
    ).resolves.toEqual(FORBIDDEN);
    await expect(disconnectGoogleCalendar()).resolves.toEqual(FORBIDDEN);

    expect(createAdminClient).not.toHaveBeenCalled();
    expect(sendWithFailover).not.toHaveBeenCalled();
  });

  it('preserves manager validation behavior on VA-only guards', async () => {
    currentRole = 'manager';

    const documentResult = await uploadDocumentAction(new FormData());
    const propertyResult = await createPropertyAction(new FormData());

    expect(documentResult).toEqual({
      success: false,
      error: 'Choose a file to upload.',
    });
    expect(propertyResult).not.toEqual(FORBIDDEN);
    expect(propertyResult.success).toBe(false);
  });
});
