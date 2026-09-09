/**
 * Phase A4 — currency grounding wired into the tenant-SMS draft path.
 *
 * `generateDraftForTenant` runs `validateNumericGrounding` on the
 * worker's draft body before `recordProposal`. An ungrounded dollar
 * amount must add a deterministic review reason (forceReview). Tenant-facing
 * drafts are review-only regardless of numeric grounding, so neither case may
 * auto-send.
 *
 * spawnPropertyWorker and commitProposal are module-mocked; the real
 * recordProposal + gate run against a hand-rolled Supabase mock so the
 * test asserts the actual persisted gate_decision.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';

import type { ActionProposal, WorkerModelProvider } from '@/lib/agent/worker/types';

vi.mock('@/lib/agent/worker/spawn', () => ({
  spawnPropertyWorker: vi.fn(),
}));
vi.mock('@/lib/agent/worker/providers/select', () => ({
  selectProvider: vi.fn(),
}));
vi.mock('@/lib/agent/proposals/commit', () => ({
  commitProposal: vi.fn(async () => null),
}));
vi.mock('../resolve-property', () => ({
  resolveTenantProperty: vi.fn(),
}));

import { spawnPropertyWorker } from '@/lib/agent/worker/spawn';
import { selectProvider } from '@/lib/agent/worker/providers/select';
import { commitProposal } from '@/lib/agent/proposals/commit';
import { resolveTenantProperty } from '../resolve-property';
import { generateDraftForTenant } from '../claude-draft';

const mockSpawn = vi.mocked(spawnPropertyWorker);
const mockSelectProvider = vi.mocked(selectProvider);
const mockCommit = vi.mocked(commitProposal);
const mockResolve = vi.mocked(resolveTenantProperty);

const ORG = '00000000-0000-0000-0000-000000000001';
const PROP = '00000000-0000-0000-0000-000000000002';
const PROPOSAL_ID = '00000000-0000-0000-0000-000000000003';
const TENANT = '00000000-0000-0000-0000-000000000004';
const CONV = '00000000-0000-0000-0000-000000000005';

const provider: WorkerModelProvider = {
  name: 'mock-worker',
  supportsPromptCaching: () => false,
  // Never invoked — spawnPropertyWorker is module-mocked.
  call: vi.fn(async () => {
    throw new Error('provider.call should not run in this test');
  }),
  healthCheck: vi.fn(async () => ({ ok: true, latencyMs: 1 })),
};

function inMemoryProposal(body: string): ActionProposal {
  return {
    id: null,
    organizationId: ORG,
    propertyId: PROP,
    workerModel: 'mock-worker',
    action_type: 'draft_sms_reply',
    payload: { body, tone: 'neutral' },
    routing: null,
    reasoning: 'tenant asked about rent',
    confidence: 0.9,
    context_fact_ids: [],
    gate_decision: null,
    status: 'proposed',
    createdAt: '2026-06-10T00:00:00.000Z',
  };
}

interface InsertCapture {
  row: Record<string, unknown> | null;
}

/**
 * Minimal admin-client mock covering the tables generateDraftForTenant
 * touches: properties (gating), tenants (summary), leases (rent texts,
 * awaited as a thenable list), action_proposals (insert → row back).
 */
function makeAdminMock(capture: InsertCapture): SupabaseClient<Database> {
  const propertyRow = {
    privacy_mode: 'hosted',
    ollama_host: null,
    autonomy_level: 0.8,
    rules_text: 'Grace period 5 days. Quiet hours after 10pm.',
  };
  const tenantRow = { full_name: 'Jane Doe', phone_e164: '+15550001111' };
  const leaseRows = [{ rent_amount: 1200, units: { property_id: PROP } }];

  function builderFor(table: string): unknown {
    const builder: Record<string, unknown> = {
      select: () => builder,
      eq: () => builder,
      in: () => builder,
      order: () => builder,
      limit: () => builder,
      maybeSingle: async () => {
        if (table === 'properties') return { data: propertyRow, error: null };
        if (table === 'tenants') return { data: tenantRow, error: null };
        return { data: null, error: null };
      },
      insert: (row: Record<string, unknown>) => {
        capture.row = row;
        return {
          select: () => ({
            single: async () => ({
              data: {
                id: PROPOSAL_ID,
                organization_id: ORG,
                property_id: PROP,
                worker_model: 'mock-worker',
                action_type: 'draft_sms_reply',
                payload: row.payload,
                reasoning: row.reasoning,
                confidence: row.confidence,
                context_fact_ids: null,
                gate_decision: row.gate_decision,
                status: 'proposed',
                created_at: '2026-06-10T00:00:00.000Z',
                committed_at: null,
                rejected_at: null,
                edit_diff: null,
                outcome: null,
                routing: row.routing ?? null,
              },
              error: null,
            }),
          }),
        };
      },
      then: (
        onfulfilled?: ((value: unknown) => unknown) | null,
      ): Promise<unknown> => {
        const result =
          table === 'leases'
            ? { data: leaseRows, error: null }
            : { data: [], error: null };
        return Promise.resolve(onfulfilled ? onfulfilled(result) : result);
      },
    };
    return builder;
  }

  return {
    from: (table: string) => builderFor(table),
  } as unknown as SupabaseClient<Database>;
}

describe('generateDraftForTenant', () => {
  describe('numeric grounding', () => {
    let prevRealAi: string | undefined;

    beforeEach(() => {
      prevRealAi = process.env.ODESA_USE_REAL_AI;
      process.env.ODESA_USE_REAL_AI = 'true';
      mockResolve.mockResolvedValue({
        propertyId: PROP,
        organizationId: ORG,
        leaseId: 'lease-1',
        unitId: 'unit-1',
      });
      mockSelectProvider.mockReturnValue(provider);
      mockCommit.mockClear();
    });

    afterEach(() => {
      if (prevRealAi === undefined) {
        delete process.env.ODESA_USE_REAL_AI;
      } else {
        process.env.ODESA_USE_REAL_AI = prevRealAi;
      }
      vi.clearAllMocks();
    });

    it('should demote to review when the draft states an ungrounded amount', async () => {
      // $1,450 appears nowhere: inbound, history, lease rent (1200), rulebook.
      mockSpawn.mockResolvedValue(
        inMemoryProposal('Your rent is $1,450, due Friday.'),
      );
      const capture: InsertCapture = { row: null };
      const admin = makeAdminMock(capture);

      const result = await generateDraftForTenant({
        admin,
        tenantId: TENANT,
        conversationId: CONV,
        history: [{ role: 'tenant', body: 'hey, quick question' }],
        latestInbound: 'when is my rent due?',
        provider,
      });

      expect(result.fromWorker).toBe(true);
      expect(result.autoCommitted).toBe(false);
      expect(mockCommit).not.toHaveBeenCalled();
      expect(capture.row).not.toBeNull();
      expect(capture.row!.gate_decision).toBe('review');
    });

    it('should still require owner review when the amount is grounded', async () => {
      // 1200 matches the mocked lease rent_amount — grounded.
      mockSpawn.mockResolvedValue(
        inMemoryProposal('Your rent is $1,200, due on the 1st.'),
      );
      const capture: InsertCapture = { row: null };
      const admin = makeAdminMock(capture);

      const result = await generateDraftForTenant({
        admin,
        tenantId: TENANT,
        conversationId: CONV,
        history: [],
        latestInbound: 'when is my rent due?',
        provider,
      });

      expect(result.fromWorker).toBe(true);
      expect(result.autoCommitted).toBe(false);
      expect(mockCommit).not.toHaveBeenCalled();
      expect(capture.row!.gate_decision).toBe('review');
    });

    it('selects the draft_sms_reply action policy when no provider is injected', async () => {
      mockSpawn.mockResolvedValue(inMemoryProposal('We received your request.'));
      const capture: InsertCapture = { row: null };
      const admin = makeAdminMock(capture);

      await generateDraftForTenant({
        admin,
        tenantId: TENANT,
        conversationId: CONV,
        history: [],
        latestInbound: 'Can you follow up?',
      });

      expect(mockSelectProvider).toHaveBeenCalledWith(
        { privacyMode: 'hosted', ollamaHost: null },
        { actionType: 'draft_sms_reply' },
      );
    });
  });
});
