/**
 * Unit tests for handleSendTenantMessage.
 *
 * Covers: happy path INSERT + sendWithFailover, tenant not found,
 * ambiguous tenant, send failure leaves row pending_review,
 * idempotency window, and RLS scoping.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/messaging/send-with-failover', () => ({
  sendWithFailover: vi.fn(),
}));

import { sendWithFailover } from '@/lib/messaging/send-with-failover';

import { handleSendTenantMessage } from '../send-tenant-message';
import { ORG_ID, TENANT_ID, makeAdmin } from './__helpers';

const mockSendWithFailover = vi.mocked(sendWithFailover);

const CONVERSATION_ID = '77777777-7777-4777-8777-777777777777';
const MESSAGE_ID = '88888888-8888-4888-8888-888888888888';

const TENANT_ROW = {
  id: TENANT_ID,
  full_name: 'Jessica Ramirez',
  phone_e164: '+15551234567',
};

const ORG_ROW = {
  id: ORG_ID,
  odesa_phone_number: '+18005551111',
  messaging_primary: 'linq',
};

beforeEach(() => {
  mockSendWithFailover.mockReset();
});

describe('handleSendTenantMessage', () => {
  it('inserts outbound row, calls sendWithFailover, and updates sent_at on success', async () => {
    mockSendWithFailover.mockResolvedValue({
      ok: true,
      provider: 'linq',
      providerMessageId: 'lq_abc123',
      attempted: ['linq'],
      failedOver: false,
    });

    const { admin, calls } = makeAdmin({
      tenants: [
        { data: { id: TENANT_ID }, error: null }, // tenantRef verify
        { data: TENANT_ROW, error: null }, // tenant fetch
      ],
      organizations: [{ data: ORG_ROW, error: null }],
      conversations: [
        { data: { id: CONVERSATION_ID }, error: null }, // find
        // (update at end is fire-and-forget; queue extra response)
        { data: null, error: null },
      ],
      messages: [
        { data: [], error: null }, // idempotency lookup → empty
        { data: { id: MESSAGE_ID }, error: null }, // insert
        { data: null, error: null }, // update sent_at
      ],
    });

    const result = await handleSendTenantMessage({
      admin,
      organizationId: ORG_ID,
      payload: {
        tenantRef: { tenantId: TENANT_ID },
        body: 'Hi Jessica, your rent is due tomorrow.',
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.confidence).toBe(1.0);
    expect(result.data).toMatchObject({
      messageId: MESSAGE_ID,
      tenantPhone: TENANT_ROW.phone_e164,
      conversationId: CONVERSATION_ID,
      full_name: TENANT_ROW.full_name,
    });

    expect(mockSendWithFailover).toHaveBeenCalledTimes(1);
    expect(mockSendWithFailover).toHaveBeenCalledWith(ORG_ID, {
      toE164: TENANT_ROW.phone_e164,
      fromE164: ORG_ROW.odesa_phone_number,
      body: 'Hi Jessica, your rent is due tomorrow.',
      idempotencyKey: `message:${MESSAGE_ID}`,
      messageId: MESSAGE_ID,
    });

    const insertCall = calls.find(
      (c) => c.table === 'messages' && c.op === 'insert',
    );
    expect(insertCall?.insertValues).toMatchObject({
      organization_id: ORG_ID,
      conversation_id: CONVERSATION_ID,
      direction: 'outbound',
      provider: 'linq',
      body: 'Hi Jessica, your rent is due tomorrow.',
      draft_status: 'auto_sent',
      sent_at: null,
    });

    const updateCall = calls.find(
      (c) => c.table === 'messages' && c.op === 'update',
    );
    expect(updateCall?.updateValues).toMatchObject({
      provider: 'linq',
      provider_message_id: 'lq_abc123',
    });
    expect(updateCall?.updateValues?.sent_at).toEqual(expect.any(String));
  });

  it('returns tenant_not_found when tenantRef UUID is unknown', async () => {
    const { admin } = makeAdmin({
      tenants: [{ data: null, error: null }], // ref verify miss
    });

    const result = await handleSendTenantMessage({
      admin,
      organizationId: ORG_ID,
      payload: {
        tenantRef: { tenantId: TENANT_ID },
        body: 'Hello',
      },
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('tenant_not_found');
    expect(result.confidence).toBe(0);
    expect(mockSendWithFailover).not.toHaveBeenCalled();
  });

  it('returns ambiguous_tenant when name matches multiple tenants', async () => {
    const { admin } = makeAdmin({
      tenants: [
        // resolveTenant ilike → 2 rows.
        { data: [{ id: TENANT_ID }, { id: 't2' }], error: null },
      ],
    });

    const result = await handleSendTenantMessage({
      admin,
      organizationId: ORG_ID,
      payload: {
        tenantRef: { tenantName: 'Jessica' },
        body: 'Hello',
      },
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('ambiguous_tenant');
    expect(result.confidence).toBe(0.2);
    expect(mockSendWithFailover).not.toHaveBeenCalled();
  });

  it('flips message to pending_review and reports send_failed when provider rejects', async () => {
    mockSendWithFailover.mockResolvedValue({
      ok: false,
      attempted: ['linq', 'twilio'],
      errors: [
        { provider: 'linq', error: 'rate_limited' },
        { provider: 'twilio', error: 'invalid_to_number' },
      ],
    });

    const { admin, calls } = makeAdmin({
      tenants: [
        { data: { id: TENANT_ID }, error: null },
        { data: TENANT_ROW, error: null },
      ],
      organizations: [{ data: ORG_ROW, error: null }],
      conversations: [{ data: { id: CONVERSATION_ID }, error: null }],
      messages: [
        { data: [], error: null }, // idempotency miss
        { data: { id: MESSAGE_ID }, error: null }, // insert
        { data: null, error: null }, // pending_review update
      ],
    });

    const result = await handleSendTenantMessage({
      admin,
      organizationId: ORG_ID,
      payload: {
        tenantRef: { tenantId: TENANT_ID },
        body: 'Hello',
      },
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/^send_failed: /);
    expect(result.confidence).toBe(0.5);

    const updateCall = calls.find(
      (c) => c.table === 'messages' && c.op === 'update',
    );
    expect(updateCall?.updateValues).toMatchObject({
      draft_status: 'pending_review',
    });
  });

  it('returns idempotent: true when same body sent within window', async () => {
    const { admin } = makeAdmin({
      tenants: [
        { data: { id: TENANT_ID }, error: null },
        { data: TENANT_ROW, error: null },
      ],
      organizations: [{ data: ORG_ROW, error: null }],
      conversations: [{ data: { id: CONVERSATION_ID }, error: null }],
      messages: [
        // idempotency lookup returns a recent dup.
        { data: [{ id: MESSAGE_ID, sent_at: '2026-05-07T10:00:00Z' }], error: null },
      ],
    });

    const result = await handleSendTenantMessage({
      admin,
      organizationId: ORG_ID,
      payload: {
        tenantRef: { tenantId: TENANT_ID },
        body: 'Hello',
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.idempotent).toBe(true);
    expect((result.data as { messageId: string }).messageId).toBe(MESSAGE_ID);
    expect(mockSendWithFailover).not.toHaveBeenCalled();
  });

  it('scopes every query by organization_id', async () => {
    mockSendWithFailover.mockResolvedValue({
      ok: true,
      provider: 'linq',
      providerMessageId: 'lq_x',
      attempted: ['linq'],
      failedOver: false,
    });

    const { admin, calls } = makeAdmin({
      tenants: [
        { data: { id: TENANT_ID }, error: null },
        { data: TENANT_ROW, error: null },
      ],
      organizations: [{ data: ORG_ROW, error: null }],
      conversations: [
        { data: { id: CONVERSATION_ID }, error: null },
        { data: null, error: null },
      ],
      messages: [
        { data: [], error: null },
        { data: { id: MESSAGE_ID }, error: null },
        { data: null, error: null },
      ],
    });

    await handleSendTenantMessage({
      admin,
      organizationId: ORG_ID,
      payload: {
        tenantRef: { tenantId: TENANT_ID },
        body: 'Hello',
      },
    });

    const orgScopedTables = new Set([
      'tenants',
      'messages',
      'conversations',
    ]);
    for (const call of calls) {
      if (orgScopedTables.has(call.table)) {
        const hasOrg = call.eqs.some(
          ([col, val]) => col === 'organization_id' && val === ORG_ID,
        );
        const hasOrgInInsert = call.insertValues?.organization_id === ORG_ID;
        expect(hasOrg || hasOrgInInsert).toBe(true);
      }
    }
  });
});
