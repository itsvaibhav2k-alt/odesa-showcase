/**
 * Unit tests for `notifyTenant` → `send()` in notify.ts.
 *
 * The A2 invariant under test is insert-before-send: the conversation
 * + 'sending' message row (the durable outbound intent) must be
 * written BEFORE `sendWithFailover` is invoked, then promoted to
 * 'auto_sent' on provider success or demoted to 'pending_review' on
 * failure. Call order is asserted with a recording mock.
 */

import { describe, expect, it, vi, afterEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';

vi.mock('../send-with-failover', () => ({
  sendWithFailover: vi.fn(),
}));

vi.mock('@/lib/inngest/client', () => ({
  inngest: { send: vi.fn() },
}));

import { inngest } from '@/lib/inngest/client';
import { sendWithFailover } from '../send-with-failover';
import { notifyLandlord, notifyTenant } from '../notify';
import { NOTIFY_LANDLORD_DEFERRED_EVENT } from '@/lib/inngest/events';

const mockSend = vi.mocked(sendWithFailover);
const mockInngestSend = vi.mocked(inngest.send);

const ORG = '00000000-0000-0000-0000-000000000001';
const TENANT = '00000000-0000-0000-0000-000000000002';
const CONV_ID = 'conv-1';
const MSG_ID = 'msg-1';

interface RecordedDb {
  db: SupabaseClient<Database>;
  /** Ordered operation log, e.g. 'insert:messages', 'send'. */
  calls: string[];
  inserts: Array<{ table: string; values: Record<string, unknown> }>;
  updates: Array<{ table: string; values: Record<string, unknown> }>;
}

function buildDb(opts: { promoteFailures?: number; failConvInsert?: boolean } = {}): RecordedDb {
  const calls: string[] = [];
  const inserts: RecordedDb['inserts'] = [];
  const updates: RecordedDb['updates'] = [];
  let updateFailuresLeft = opts.promoteFailures ?? 0;

  const from = vi.fn((table: string) => {
    if (table === 'organizations') {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            single: vi.fn(async () => ({
              data: {
                odesa_phone_number: '+15550000000',
                timezone: 'America/New_York',
              },
              error: null,
            })),
          })),
        })),
      };
    }
    if (table === 'users') {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            eq: vi.fn(() => ({
              not: vi.fn(() => ({
                limit: vi.fn(() => ({
                  maybeSingle: vi.fn(async () => ({
                    data: { phone_e164: '+15552222222' },
                    error: null,
                  })),
                })),
              })),
            })),
          })),
        })),
      };
    }
    if (table === 'tenants') {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            single: vi.fn(async () => ({
              data: { phone_e164: '+15551111111' },
              error: null,
            })),
          })),
        })),
      };
    }
    if (table === 'conversations') {
      return {
        insert: vi.fn((values: Record<string, unknown>) => {
          calls.push('insert:conversations');
          inserts.push({ table, values });
          return {
            select: vi.fn(() => ({
              single: vi.fn(async () => ({
                data: opts.failConvInsert ? null : { id: CONV_ID },
                error: opts.failConvInsert ? { message: 'boom' } : null,
              })),
            })),
          };
        }),
      };
    }
    if (table === 'messages') {
      return {
        insert: vi.fn((values: Record<string, unknown>) => {
          calls.push('insert:messages');
          inserts.push({ table, values });
          return {
            select: vi.fn(() => ({
              single: vi.fn(async () => ({ data: { id: MSG_ID }, error: null })),
            })),
          };
        }),
        update: vi.fn((values: Record<string, unknown>) => {
          calls.push('update:messages');
          updates.push({ table, values });
          return {
            eq: vi.fn(async () => ({
              error:
                updateFailuresLeft-- > 0 ? { message: 'update failed' } : null,
            })),
          };
        }),
      };
    }
    throw new Error(`unexpected from(${table})`);
  });

  return {
    db: { from } as unknown as SupabaseClient<Database>,
    calls,
    inserts,
    updates,
  };
}

function stubProviderSuccess(calls: string[]): void {
  mockSend.mockImplementation(async () => {
    calls.push('send');
    return {
      ok: true,
      provider: 'twilio',
      providerMessageId: 'pm-99',
      attempted: ['twilio'],
      failedOver: false,
    };
  });
}

function stubProviderFailure(calls: string[]): void {
  mockSend.mockImplementation(async () => {
    calls.push('send');
    return {
      ok: false,
      attempted: ['linq', 'twilio'],
      errors: [
        { provider: 'linq', error: 'linq down' },
        { provider: 'twilio', error: 'twilio down' },
      ],
    };
  });
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('notifyTenant', () => {
  describe('send ordering', () => {
    it('should insert the conversation and sending row BEFORE calling the provider', async () => {
      const { db, calls, inserts } = buildDb();
      stubProviderSuccess(calls);

      const result = await notifyTenant({
        db,
        organizationId: ORG,
        tenantId: TENANT,
        body: 'hi there',
      });

      expect(calls).toEqual([
        'insert:conversations',
        'insert:messages',
        'send',
        'update:messages',
      ]);
      const msgInsert = inserts.find((i) => i.table === 'messages');
      expect(msgInsert?.values).toMatchObject({
        direction: 'outbound',
        draft_status: 'sending',
        sent_at: null,
        body: 'hi there',
      });
      expect(result.ok).toBe(true);
    });

    it('should never call the provider when the conversation insert fails', async () => {
      const { db, calls } = buildDb({ failConvInsert: true });
      stubProviderSuccess(calls);

      const result = await notifyTenant({
        db,
        organizationId: ORG,
        tenantId: TENANT,
        body: 'hi there',
      });

      expect(result.ok).toBe(false);
      expect(result.error).toBe('conversation insert failed');
      expect(mockSend).not.toHaveBeenCalled();
    });
  });

  describe('provider success', () => {
    it('should promote the row to auto_sent with the actual provider and provider_message_id', async () => {
      const { db, calls, updates } = buildDb();
      stubProviderSuccess(calls);

      const result = await notifyTenant({
        db,
        organizationId: ORG,
        tenantId: TENANT,
        body: 'rent due friday',
      });

      expect(updates).toHaveLength(1);
      expect(updates[0].values).toMatchObject({
        draft_status: 'auto_sent',
        provider: 'twilio',
        provider_message_id: 'pm-99',
      });
      expect(updates[0].values.sent_at).toEqual(expect.any(String));
      expect(result).toMatchObject({
        ok: true,
        conversationId: CONV_ID,
        messageId: MSG_ID,
        provider: 'twilio',
        error: null,
      });
    });

    it('should retry promotion once and report unverified durable state as failure', async () => {
      const { db, calls, updates } = buildDb({ promoteFailures: 2 });
      stubProviderSuccess(calls);
      const errorSpy = vi
        .spyOn(console, 'error')
        .mockImplementation(() => undefined);

      const result = await notifyTenant({
        db,
        organizationId: ORG,
        tenantId: TENANT,
        body: 'hi',
      });

      // One attempt + one retry. Provider acceptance without verified durable
      // state must never be reported as successful or retried as another send.
      expect(updates).toHaveLength(2);
      expect(updates[1].values).toMatchObject({ draft_status: 'auto_sent' });
      expect(result).toMatchObject({
        ok: false,
        messageId: MSG_ID,
        error: expect.stringContaining('durable delivery state could not be verified'),
      });
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('pm-99'),
      );
      errorSpy.mockRestore();
    });
  });

  describe('provider failure', () => {
    it('should preserve rejected delivery-failure evidence without blind retry', async () => {
      const { db, calls, updates } = buildDb();
      stubProviderFailure(calls);

      const result = await notifyTenant({
        db,
        organizationId: ORG,
        tenantId: TENANT,
        body: 'hi',
      });

      expect(calls).toEqual([
        'insert:conversations',
        'insert:messages',
        'send',
        'update:messages',
      ]);
      expect(updates).toHaveLength(1);
      expect(updates[0].values).toEqual({
        draft_status: 'rejected',
        delivery_status: 'failed',
        delivery_error: 'All providers rejected the send',
      });
      expect(result).toMatchObject({
        ok: false,
        conversationId: CONV_ID,
        messageId: MSG_ID,
        provider: null,
        error: 'linq down; twilio down',
      });
    });
  });
});

describe('notifyLandlord', () => {
  describe('quiet hours', () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    function freezeAt(iso: string): void {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date(iso));
    }

    it('should defer to next 9am org-local instead of sending at 4am', async () => {
      freezeAt('2026-06-11T08:00:00Z'); // 04:00 EDT
      const { db, calls } = buildDb();
      stubProviderSuccess(calls);

      const result = await notifyLandlord({
        db,
        organizationId: ORG,
        body: '[RENT 7+ DAYS LATE] Hannah Ito hasn’t paid.',
      });

      expect(mockInngestSend).toHaveBeenCalledExactlyOnceWith({
        name: NOTIFY_LANDLORD_DEFERRED_EVENT,
        data: {
          organizationId: ORG,
          body: '[RENT 7+ DAYS LATE] Hannah Ito hasn’t paid.',
          deliverAt: '2026-06-11T13:00:00.000Z',
        },
      });
      // No durable rows, no provider call — delivery happens at 9am.
      expect(calls).toEqual([]);
      expect(result).toMatchObject({
        ok: true,
        messageId: null,
        deferredUntil: '2026-06-11T13:00:00.000Z',
      });
    });

    it('should send immediately inside the 9am-9pm window', async () => {
      freezeAt('2026-06-11T15:00:00Z'); // 11:00 EDT
      const { db, calls } = buildDb();
      stubProviderSuccess(calls);

      const result = await notifyLandlord({
        db,
        organizationId: ORG,
        body: 'morning update',
      });

      expect(mockInngestSend).not.toHaveBeenCalled();
      expect(calls).toEqual([
        'insert:conversations',
        'insert:messages',
        'send',
        'update:messages',
      ]);
      expect(result.ok).toBe(true);
      expect(result.deferredUntil).toBeUndefined();
    });

    it('should bypass quiet hours when urgent', async () => {
      freezeAt('2026-06-11T08:00:00Z'); // 04:00 EDT
      const { db, calls } = buildDb();
      stubProviderSuccess(calls);

      const result = await notifyLandlord({
        db,
        organizationId: ORG,
        body: 'tenant on a live call escalating',
        urgent: true,
      });

      expect(mockInngestSend).not.toHaveBeenCalled();
      expect(calls).toContain('send');
      expect(result.ok).toBe(true);
    });

    it('should fall back to immediate delivery when the deferral event fails', async () => {
      freezeAt('2026-06-11T08:00:00Z'); // 04:00 EDT
      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      try {
        mockInngestSend.mockRejectedValueOnce(new Error('inngest down'));
        const { db, calls } = buildDb();
        stubProviderSuccess(calls);

        const result = await notifyLandlord({
          db,
          organizationId: ORG,
          body: 'better at 4am than never',
        });

        expect(calls).toContain('send');
        expect(result.ok).toBe(true);
        expect(result.deferredUntil).toBeUndefined();
      } finally {
        errSpy.mockRestore();
      }
    });
  });
});
