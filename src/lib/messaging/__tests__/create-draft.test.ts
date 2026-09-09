/**
 * Unit tests for createSmsDraft's property-null guard (Voice Operator
 * V1). `action_proposals.property_id` is NOT NULL, so a draft for a
 * caller without a resolved property must skip `recordProposal`
 * entirely and return `proposalId: null` — while still landing the
 * pending_review message row. Mock-supabase pattern mirrors
 * handle-inbound.test.ts (table-keyed response queues).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createSmsDraft } from '../create-draft';
import type { Database } from '@/types/database';
import type { SupabaseClient } from '@supabase/supabase-js';

vi.mock('@/lib/agent/proposals/record', () => ({
  recordProposal: vi.fn(),
}));

import { recordProposal } from '@/lib/agent/proposals/record';

const mockRecordProposal = vi.mocked(recordProposal);

interface StubResponse {
  data: unknown;
  error: { code?: string; message?: string } | null;
}

function makeDb(
  queues: Record<string, StubResponse[]>,
): SupabaseClient<Database> {
  const makeChain = (table: string): Record<string, unknown> => {
    const next = (): StubResponse => {
      const queue = queues[table];
      if (!queue || queue.length === 0) {
        throw new Error(`No stub response queued for table "${table}"`);
      }
      return queue.shift()!;
    };
    const chain: Record<string, unknown> = {};
    for (const method of ['select', 'insert', 'update', 'eq', 'order', 'limit']) {
      chain[method] = vi.fn(() => chain);
    }
    chain['maybeSingle'] = vi.fn(async () => next());
    chain['single'] = vi.fn(async () => next());
    return chain;
  };
  const from = vi.fn((table: string) => makeChain(table));
  return { from } as unknown as SupabaseClient<Database>;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('createSmsDraft', () => {
  describe('property-null guard', () => {
    it('should return null proposalId and skip recordProposal when propertyId is null', async () => {
      const db = makeDb({
        messages: [{ data: { id: 'm-1' }, error: null }],
      });

      const result = await createSmsDraft(db, {
        organizationId: 'org-1',
        tenantId: null,
        propertyId: null,
        conversationId: 'c-1',
        body: 'Thanks for calling — the owner will follow up.',
        reason: 'unknown caller follow-up',
        source: 'retell_voice',
        callId: 'call-1',
      });

      expect(result).toEqual({
        conversationId: 'c-1',
        messageId: 'm-1',
        proposalId: null,
      });
      expect(mockRecordProposal).not.toHaveBeenCalled();
    });

    it('should record a forced-review proposal when propertyId is present', async () => {
      const db = makeDb({
        messages: [{ data: { id: 'm-2' }, error: null }],
      });
      mockRecordProposal.mockResolvedValue({
        proposal: { id: 'p-1' },
        decision: { outcome: 'review' },
      } as Awaited<ReturnType<typeof recordProposal>>);

      const result = await createSmsDraft(db, {
        organizationId: 'org-1',
        tenantId: 't-1',
        propertyId: 'prop-1',
        conversationId: 'c-2',
        body: 'The ledger currently shows late for June.',
        reason: 'rent dispute proof request',
        source: 'retell_voice',
      });

      expect(result).toEqual({
        conversationId: 'c-2',
        messageId: 'm-2',
        proposalId: 'p-1',
      });
      expect(mockRecordProposal).toHaveBeenCalledTimes(1);
      const input = mockRecordProposal.mock.calls[0][1];
      expect(input.actionType).toBe('draft_sms_reply');
      expect(input.forceReview).toBeDefined();
      expect(input.routing).toEqual({ conversationId: 'c-2', tenantId: 't-1' });
    });
  });
});
