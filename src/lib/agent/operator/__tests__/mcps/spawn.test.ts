/**
 * Unit tests for the spawn MCP. The wrapped functions
 * (spawnPropertyWorker / recordProposal / commitProposal /
 * selectProvider) are mocked; we drive the full handler to verify:
 *   - tenant/vendor name resolution (single, ambiguous, miss)
 *   - per-action_type payload data is built against the real
 *     WORKER_PAYLOAD_SCHEMAS via the proposal returned by the worker
 *     mock — guards against PAYLOAD_DEFAULTS drift (memory feedback)
 *   - gate routing: safe auto → commit; consequential actions remain in
 *     review even if a mocked/stale gate result says auto
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createSpawnMcp,
  resolveTenant,
  resolveVendor,
  type CreateSpawnMcpDeps,
} from '../../mcps/spawn';
import type {
  ActionProposal,
  PropertyContext,
  WorkerActionPayload,
  WorkerModelProvider,
} from '@/lib/agent/worker/types';
import { WORKER_PAYLOAD_SCHEMAS } from '@/lib/agent/worker/types';
import type { OrganizationContext } from '../../org-context';
import type { Database } from '@/types/database';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { DispatcherEvent } from '../../types';

vi.mock('@/lib/agent/worker/spawn', () => ({
  spawnPropertyWorker: vi.fn(),
}));
vi.mock('@/lib/agent/proposals/record', () => ({
  recordProposal: vi.fn(),
}));
vi.mock('@/lib/agent/proposals/commit', () => ({
  commitProposal: vi.fn(),
}));
vi.mock('@/lib/agent/worker/providers/select', () => ({
  selectProvider: vi.fn(() => ({
    name: 'test-provider',
    supportsPromptCaching: () => false,
    call: vi.fn(),
    healthCheck: vi.fn(),
  })),
}));

import { spawnPropertyWorker } from '@/lib/agent/worker/spawn';
import { recordProposal } from '@/lib/agent/proposals/record';
import { commitProposal } from '@/lib/agent/proposals/commit';
import { selectProvider } from '@/lib/agent/worker/providers/select';

const mockSpawn = vi.mocked(spawnPropertyWorker);
const mockRecord = vi.mocked(recordProposal);
const mockCommit = vi.mocked(commitProposal);
const mockSelectProvider = vi.mocked(selectProvider);

interface ToolDefShape {
  name?: string;
  handler: (
    args: Record<string, unknown>,
    extra: unknown,
  ) => Promise<{ content: Array<{ type: 'text'; text: string }> }>;
}
interface McpServerShape {
  instance?: { _registeredTools?: Record<string, ToolDefShape> };
  tools?: ToolDefShape[];
}

function getHandler(server: unknown, name: string): ToolDefShape['handler'] {
  const s = server as McpServerShape;
  return (
    s.instance?._registeredTools?.[name]?.handler ??
    s.tools?.find((t) => t.name === name)?.handler ??
    (() => {
      throw new Error(`${name} handler not found`);
    })()
  );
}

function makeContext(
  overrides: Partial<PropertyContext['property']> = {},
): PropertyContext {
  return {
    property: {
      id: 'prop-1',
      organizationId: 'org-1',
      name: 'Galaxy A',
      addressLine: null,
      timezone: 'America/New_York',
      rulesText: 'Be polite. Late fees apply after grace.',
      autonomyLevel: 0.5,
      privacyMode: 'hosted',
      ...overrides,
    },
    facts: [],
    recentTurns: [],
    vendors: [
      {
        id: 'v1',
        name: 'Acme Plumbing',
        category: 'plumber',
        acceptanceRate: 0.9,
      },
      {
        id: 'v2',
        name: 'Quick Plumb',
        category: 'plumber',
        acceptanceRate: 0.7,
      },
      { id: 'v3', name: 'Cool HVAC', category: 'hvac', acceptanceRate: 0.85 },
    ],
    tenants: [
      {
        id: 't1',
        fullName: 'Jane Doe',
        unitLabel: 'Apt 4',
        rentStatus: 'paid',
        rentAmount: 1800,
      },
      {
        id: 't2',
        fullName: 'Jane Smith',
        unitLabel: 'Apt 7',
        rentStatus: 'late',
        rentAmount: 2100,
      },
      {
        id: 't3',
        fullName: 'John Smith',
        unitLabel: 'Apt 9',
        rentStatus: 'paid',
        rentAmount: null,
      },
    ],
    loadedAt: '2026-05-02T00:00:00Z',
  };
}

function makeOrgContext(): OrganizationContext {
  return {
    organization: {
      id: 'org-1',
      name: 'Galaxy Estates',
      assistantName: 'Odesa',
    },
    properties: [
      {
        id: 'prop-1',
        name: 'Galaxy A',
        address: '1 Main St',
        timezone: 'America/New_York',
        autonomyLevel: 0.5,
        privacyMode: 'hosted',
      },
    ],
    loadedAt: '2026-05-04T00:00:00Z',
  };
}

function makeDeps(overrides: Partial<CreateSpawnMcpDeps> = {}): {
  deps: CreateSpawnMcpDeps;
  emitted: DispatcherEvent[];
} {
  const emitted: DispatcherEvent[] = [];
  const provider: WorkerModelProvider = {
    name: 'test-haiku',
    supportsPromptCaching: () => false,
    call: vi.fn(),
    healthCheck: vi.fn(),
  };
  const propertyContextCache = new Map<string, Promise<PropertyContext>>();
  // Pre-populate the cache so tool calls don't need loadPropertyContext.
  propertyContextCache.set('prop-1', Promise.resolve(makeContext()));
  const deps: CreateSpawnMcpDeps = {
    admin: {} as SupabaseClient<Database>,
    organizationId: 'org-1',
    orgContext: makeOrgContext(),
    propertyContextCache,
    emit: (ev) => {
      emitted.push(ev);
    },
    commitActor: { kind: 'system' },
    provider,
    ...overrides,
  };
  return { deps, emitted };
}

function smsPayload(): WorkerActionPayload {
  return { body: 'reminder: rent is due', tone: 'firm' };
}

function workerProposal(
  actionType: ActionProposal['action_type'],
  payload: WorkerActionPayload,
  confidence = 0.9,
): ActionProposal {
  return {
    id: null,
    organizationId: 'org-1',
    propertyId: 'prop-1',
    workerModel: 'test-haiku',
    action_type: actionType,
    payload,
    routing: null,
    reasoning: 'late on rent',
    confidence,
    context_fact_ids: [],
    gate_decision: null,
    status: 'proposed',
    createdAt: '2026-05-02T00:00:00Z',
  };
}

function recordedProposal(
  proposal: ActionProposal,
  outcome: 'auto' | 'review' | 'block',
): { proposal: ActionProposal; decision: { outcome: typeof outcome } } {
  return {
    proposal: { ...proposal, id: 'persisted-id', gate_decision: outcome },
    decision: { outcome },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('resolveTenant / resolveVendor', () => {
  it('should return unique match on a clear substring', () => {
    const ctx = makeContext();
    expect(resolveTenant(ctx, 'jane doe').kind).toBe('unique');
    expect(resolveVendor(ctx, 'acme').kind).toBe('unique');
  });

  it('should return ambiguous when multiple tenants match', () => {
    const ctx = makeContext();
    const r = resolveTenant(ctx, 'jane');
    expect(r.kind).toBe('ambiguous');
    if (r.kind === 'ambiguous') {
      expect(r.candidates).toHaveLength(2);
    }
  });

  it('should return ambiguous when multiple vendors match', () => {
    const ctx = makeContext();
    const r = resolveVendor(ctx, 'plumb');
    expect(r.kind).toBe('ambiguous');
  });

  it('should return miss when no tenant matches', () => {
    expect(resolveTenant(makeContext(), 'nobody').kind).toBe('miss');
    expect(resolveVendor(makeContext(), 'electric').kind).toBe('miss');
  });
});

describe('spawn_property_worker tool', () => {
  describe('name resolution', () => {
    it('should reject ambiguous tenantName with candidate list', async () => {
      const { deps } = makeDeps();
      const server = createSpawnMcp(deps);
      const handler = getHandler(server, 'spawn_property_worker');
      const res = await handler(
        {
          propertyName: 'Galaxy A',
          action_type: 'draft_sms_reply',
          prompt: 'remind',
          tenantName: 'jane',
        },
        {},
      );
      expect(res.content[0]?.text).toContain("Multiple tenants match 'jane'");
      expect(res.content[0]?.text).toContain('Jane Doe');
      expect(res.content[0]?.text).toContain('Jane Smith');
      expect(mockSpawn).not.toHaveBeenCalled();
    });

    it('should reject zero-match tenantName', async () => {
      const { deps } = makeDeps();
      const server = createSpawnMcp(deps);
      const handler = getHandler(server, 'spawn_property_worker');
      const res = await handler(
        {
          propertyName: 'Galaxy A',
          action_type: 'draft_sms_reply',
          prompt: 'x',
          tenantName: 'nobody',
        },
        {},
      );
      expect(res.content[0]?.text).toContain("No tenant named 'nobody'");
    });

    it('should reject ambiguous vendorName', async () => {
      const { deps } = makeDeps();
      const server = createSpawnMcp(deps);
      const handler = getHandler(server, 'spawn_property_worker');
      const res = await handler(
        {
          propertyName: 'Galaxy A',
          action_type: 'dispatch_vendor',
          prompt: 'fix leak',
          vendorName: 'plumb',
          workOrderRef: 'wo-1',
        },
        {},
      );
      expect(res.content[0]?.text).toContain('Multiple vendors match');
    });

    it('should return clarification string when propertyName matches none', async () => {
      const { deps } = makeDeps();
      const server = createSpawnMcp(deps);
      const handler = getHandler(server, 'spawn_property_worker');
      const res = await handler(
        {
          propertyName: 'unknown place',
          action_type: 'draft_sms_reply',
          prompt: 'test',
          tenantName: 'doe',
        },
        {},
      );
      expect(res.content[0]?.text).toMatch(/No property/i);
      expect(mockSpawn).not.toHaveBeenCalled();
    });
  });

  describe('payload construction (drift guard)', () => {
    it('passes the configured property Ollama host to the on-prem provider', async () => {
      const propertyContextCache = new Map<string, Promise<PropertyContext>>();
      propertyContextCache.set(
        'prop-1',
        Promise.resolve(makeContext({ privacyMode: 'on_prem' })),
      );
      const query = {
        select: vi.fn(() => query),
        eq: vi.fn(() => query),
        maybeSingle: vi.fn(async () => ({
          data: { ollama_host: '  http://ollama.internal:11434  ' },
          error: null,
        })),
      };
      const admin = {
        from: vi.fn(() => query),
      } as unknown as SupabaseClient<Database>;
      const { deps } = makeDeps({
        admin,
        provider: undefined,
        propertyContextCache,
      });
      const proposal = workerProposal('classify_intent', {
        intent: 'maintenance',
        reasoning: 'leak reported',
      });
      mockSpawn.mockResolvedValue(proposal);
      mockRecord.mockResolvedValue(recordedProposal(proposal, 'review') as never);

      const handler = getHandler(
        createSpawnMcp(deps),
        'spawn_property_worker',
      );
      await handler(
        {
          propertyName: 'Galaxy A',
          action_type: 'classify_intent',
          prompt: 'There is a leak under the sink.',
        },
        {},
      );

      expect(admin.from).toHaveBeenCalledWith('properties');
      expect(query.eq).toHaveBeenCalledWith('organization_id', 'org-1');
      expect(query.eq).toHaveBeenCalledWith('id', 'prop-1');
      expect(mockSelectProvider).toHaveBeenCalledWith(
        {
          privacyMode: 'on_prem',
          ollamaHost: 'http://ollama.internal:11434',
        },
        { actionType: 'classify_intent' },
      );
    });

    it('should build a draft_sms_reply payload that passes the real WORKER_PAYLOAD_SCHEMAS', async () => {
      const { deps } = makeDeps();
      const proposal = workerProposal('draft_sms_reply', smsPayload());
      mockSpawn.mockResolvedValue(proposal);
      mockRecord.mockResolvedValue(recordedProposal(proposal, 'auto') as never);
      mockCommit.mockResolvedValue({
        proposal: { ...proposal, id: 'persisted-id', status: 'committed' },
        dispatch: { kind: 'sms', result: { ok: true } },
        changed: true,
      } as never);

      const server = createSpawnMcp(deps);
      const handler = getHandler(server, 'spawn_property_worker');
      await handler(
        {
          propertyName: 'Galaxy A',
          action_type: 'draft_sms_reply',
          prompt: 'remind that rent is two days late',
          tenantName: 'doe',
        },
        {},
      );
      // Worker received a DraftSmsReplyInput-shaped data block.
      const callArgs = mockSpawn.mock.calls[0]![0];
      expect(callArgs.action_type).toBe('draft_sms_reply');
      const data = callArgs.data as { tenantId: string; inboundBody: string };
      expect(data.tenantId).toBe('t1');
      expect(data.inboundBody).toContain('rent');
      // Validate payload survives the real schema (drift guard).
      const schema = WORKER_PAYLOAD_SCHEMAS.draft_sms_reply;
      expect(schema.safeParse(smsPayload()).success).toBe(true);
    });

    it('should keep the documented waive_rent payload in sync with the real schema (drift guard)', () => {
      // The spawn tool description documents waive_rent={leaseRef,cycleMonth?,reason?}.
      const schema = WORKER_PAYLOAD_SCHEMAS.waive_rent;
      expect(
        schema.safeParse({
          leaseRef: { leaseId: '66666666-6666-4666-8666-666666666601' },
          cycleMonth: '2026-07',
          reason: 'Unit uninhabitable during repairs',
        }).success,
      ).toBe(true);
      expect(
        schema.safeParse({ leaseRef: { tenantName: 'Hannah Ito' } }).success,
      ).toBe(true);
      expect(schema.safeParse({ cycleMonth: 'July' }).success).toBe(false);
    });

    it('should require tenantName for draft_sms_reply', async () => {
      const { deps } = makeDeps();
      const server = createSpawnMcp(deps);
      const handler = getHandler(server, 'spawn_property_worker');
      const res = await handler(
        {
          propertyName: 'Galaxy A',
          action_type: 'draft_sms_reply',
          prompt: 'send a note',
        },
        {},
      );
      expect(res.content[0]?.text).toContain('A tenant name is required');
      expect(res.content[0]?.text).not.toContain('draft_sms_reply');
      expect(mockSpawn).not.toHaveBeenCalled();
    });

    it('should require vendorName + workOrderRef for dispatch_vendor', async () => {
      const { deps } = makeDeps();
      const server = createSpawnMcp(deps);
      const handler = getHandler(server, 'spawn_property_worker');
      const res = await handler(
        {
          propertyName: 'Galaxy A',
          action_type: 'dispatch_vendor',
          prompt: 'leak',
          vendorName: 'acme',
        },
        {},
      );
      expect(res.content[0]?.text).toContain('existing work order');
      expect(res.content[0]?.text).not.toContain('dispatch_vendor');
      expect(res.content[0]?.text).not.toContain('workOrderRef');
    });

    it('should pass routing.tenantId on draft_sms_reply', async () => {
      const { deps } = makeDeps();
      const proposal = workerProposal('draft_sms_reply', smsPayload());
      mockSpawn.mockResolvedValue(proposal);
      mockRecord.mockResolvedValue(
        recordedProposal(proposal, 'review') as never,
      );

      const server = createSpawnMcp(deps);
      const handler = getHandler(server, 'spawn_property_worker');
      await handler(
        {
          propertyName: 'Galaxy A',
          action_type: 'draft_sms_reply',
          prompt: 'x',
          tenantName: 'doe',
        },
        {},
      );
      const recordArgs = mockRecord.mock.calls[0]![1];
      expect(recordArgs.routing).toEqual({ tenantId: 't1' });
    });
  });

  describe('gate routing', () => {
    it('commits and emits proposal.committed for a safe automatic action', async () => {
      const { deps, emitted } = makeDeps();
      const proposal = workerProposal('polish_briefing', {
        prose: 'Briefing prose',
      });
      mockSpawn.mockResolvedValue(proposal);
      mockRecord.mockResolvedValue(recordedProposal(proposal, 'auto') as never);
      mockCommit.mockResolvedValue({
        proposal: { ...proposal, id: 'persisted-id', status: 'committed' },
        dispatch: { kind: 'briefing', weekStartDate: '2026-05-04', rowsAffected: 1 },
        changed: true,
      } as never);

      const server = createSpawnMcp(deps);
      const handler = getHandler(server, 'spawn_property_worker');
      const res = await handler(
        {
          propertyName: 'Galaxy A',
          action_type: 'polish_briefing',
          prompt: 'x',
        },
        {},
      );
      expect(mockCommit).toHaveBeenCalledWith(deps.admin, 'persisted-id', {
        kind: 'system',
      });
      expect(emitted.map((e) => e.type)).toEqual([
        'proposal.recorded',
        'proposal.committed',
      ]);
      expect(res.content[0]?.text).toContain('completed automatically');
    });

    it('allows an authenticated owner to auto-capture a safe internal action', async () => {
      const { deps, emitted } = makeDeps({
        commitActor: { kind: 'user', role: 'owner' },
      });
      const proposal = workerProposal('polish_briefing', {
        prose: 'Briefing prose',
      });
      mockSpawn.mockResolvedValue(proposal);
      mockRecord.mockResolvedValue(recordedProposal(proposal, 'auto') as never);
      mockCommit.mockResolvedValue({
        proposal: { ...proposal, id: 'persisted-id', status: 'committed' },
        dispatch: { kind: 'briefing', weekStartDate: '2026-05-04', rowsAffected: 1 },
        changed: true,
      } as never);

      const server = createSpawnMcp(deps);
      const handler = getHandler(server, 'spawn_property_worker');
      await handler(
        {
          propertyName: 'Galaxy A',
          action_type: 'polish_briefing',
          prompt: 'x',
        },
        {},
      );

      expect(mockCommit).toHaveBeenCalledWith(deps.admin, 'persisted-id', {
        kind: 'user',
        role: 'owner',
      });
      expect(emitted.some((event) => event.type === 'proposal.committed')).toBe(
        true,
      );
    });

    it('should emit proposal.review_required with reviewUrl on review', async () => {
      const { deps, emitted } = makeDeps();
      const proposal = workerProposal('draft_sms_reply', smsPayload());
      mockSpawn.mockResolvedValue(proposal);
      mockRecord.mockResolvedValue(
        recordedProposal(proposal, 'review') as never,
      );

      const server = createSpawnMcp(deps);
      const handler = getHandler(server, 'spawn_property_worker');
      const res = await handler(
        {
          propertyName: 'Galaxy A',
          action_type: 'draft_sms_reply',
          prompt: 'x',
          tenantName: 'doe',
        },
        {},
      );
      expect(mockCommit).not.toHaveBeenCalled();
      const review = emitted.find((e) => e.type === 'proposal.review_required');
      expect(review).toBeDefined();
      if (review && review.type === 'proposal.review_required') {
        expect(review.reviewUrl).toBe('/owner-queue');
      }
      expect(res.content[0]?.text).toContain('needs review');
    });

    it('routes a sensitive auto proposal to owner review for a VA actor', async () => {
      const { deps, emitted } = makeDeps({
        commitActor: { kind: 'user', role: 'va' },
      });
      const proposal = workerProposal('draft_sms_reply', smsPayload());
      mockSpawn.mockResolvedValue(proposal);
      mockRecord.mockResolvedValue(recordedProposal(proposal, 'auto') as never);

      const server = createSpawnMcp(deps);
      const handler = getHandler(server, 'spawn_property_worker');
      const res = await handler(
        {
          propertyName: 'Galaxy A',
          action_type: 'draft_sms_reply',
          prompt: 'x',
          tenantName: 'doe',
        },
        {},
      );

      expect(mockCommit).not.toHaveBeenCalled();
      expect(emitted.map((event) => event.type)).toEqual([
        'proposal.recorded',
        'proposal.review_required',
      ]);
      const review = emitted.find(
        (event) => event.type === 'proposal.review_required',
      );
      expect(review).toMatchObject({
        reviewUrl: '/escalations?proposal=persisted-id',
      });
      expect(res.content[0]?.text).toContain('needs review');
    });

    it('routes a VA rulebook update to owner review instead of auto-committing it', async () => {
      const { deps, emitted } = makeDeps({
        commitActor: { kind: 'user', role: 'va' },
      });
      const proposal = workerProposal('update_rulebook', {
        newRulebook: 'Keep the existing rules until the owner reviews changes.',
        diffSummary: 'Prepared one rulebook clarification.',
      });
      mockSpawn.mockResolvedValue(proposal);
      mockRecord.mockResolvedValue(recordedProposal(proposal, 'auto') as never);

      const server = createSpawnMcp(deps);
      const handler = getHandler(server, 'spawn_property_worker');
      const res = await handler(
        {
          propertyName: 'Galaxy A',
          action_type: 'update_rulebook',
          prompt: 'Prepare a rulebook clarification for owner review.',
        },
        {},
      );

      expect(mockCommit).not.toHaveBeenCalled();
      expect(emitted.map((event) => event.type)).toEqual([
        'proposal.recorded',
        'proposal.review_required',
      ]);
      expect(emitted.at(-1)).toMatchObject({
        reviewUrl: '/escalations?proposal=persisted-id',
      });
      expect(res.content[0]?.text).toContain('needs review');
    });

    it('should honour buildReviewUrl override with (propertyId, proposalId) => string signature', async () => {
      const { deps, emitted } = makeDeps({
        buildReviewUrl: (propertyId, proposalId) =>
          `/custom/${propertyId}/${proposalId}`,
      });
      const proposal = workerProposal('draft_sms_reply', smsPayload());
      mockSpawn.mockResolvedValue(proposal);
      mockRecord.mockResolvedValue(
        recordedProposal(proposal, 'review') as never,
      );

      const server = createSpawnMcp(deps);
      const handler = getHandler(server, 'spawn_property_worker');
      await handler(
        {
          propertyName: 'Galaxy A',
          action_type: 'draft_sms_reply',
          prompt: 'x',
          tenantName: 'doe',
        },
        {},
      );
      const review = emitted.find((e) => e.type === 'proposal.review_required');
      if (review && review.type === 'proposal.review_required') {
        expect(review.reviewUrl).toBe('/custom/prop-1/persisted-id');
      }
    });

    it('should emit tool.error on block', async () => {
      const { deps, emitted } = makeDeps();
      const proposal = workerProposal('draft_sms_reply', smsPayload());
      mockSpawn.mockResolvedValue(proposal);
      mockRecord.mockResolvedValue(
        recordedProposal(proposal, 'block') as never,
      );

      const server = createSpawnMcp(deps);
      const handler = getHandler(server, 'spawn_property_worker');
      const res = await handler(
        {
          propertyName: 'Galaxy A',
          action_type: 'draft_sms_reply',
          prompt: 'x',
          tenantName: 'doe',
        },
        {},
      );
      const errorEv = emitted.find((e) => e.type === 'tool.error');
      expect(errorEv).toBeDefined();
      expect(res.content[0]?.text).toContain('current safety policy');
    });

    it('should preserve provider failure in audit evidence but keep customer copy humane', async () => {
      const { deps, emitted } = makeDeps();
      mockSpawn.mockRejectedValue(new Error('model down'));

      const server = createSpawnMcp(deps);
      const handler = getHandler(server, 'spawn_property_worker');
      const res = await handler(
        {
          propertyName: 'Galaxy A',
          action_type: 'draft_sms_reply',
          prompt: 'x',
          tenantName: 'doe',
        },
        {},
      );
      const errorEv = emitted.find((e) => e.type === 'tool.error');
      expect(errorEv).toEqual(
        expect.objectContaining({ type: 'tool.error', message: 'model down' }),
      );
      expect(res.content[0]?.text).toBe(
        'The tenant reply draft could not be prepared. No action was completed.',
      );
      expect(res.content[0]?.text).not.toContain('model down');
      expect(res.content[0]?.text).not.toContain('spawn_property_worker');
    });

    it('emits tool.error when a safe automatic commit fails', async () => {
      const { deps, emitted } = makeDeps();
      const proposal = workerProposal('polish_briefing', {
        prose: 'Briefing prose',
      });
      mockSpawn.mockResolvedValue(proposal);
      mockRecord.mockResolvedValue(recordedProposal(proposal, 'auto') as never);
      mockCommit.mockRejectedValue(new Error('blocked at db'));

      const server = createSpawnMcp(deps);
      const handler = getHandler(server, 'spawn_property_worker');
      const res = await handler(
        {
          propertyName: 'Galaxy A',
          action_type: 'polish_briefing',
          prompt: 'x',
        },
        {},
      );
      const errorEv = emitted.find((e) => e.type === 'tool.error');
      expect(errorEv).toBeDefined();
      expect(res.content[0]?.text).toContain('needs reconciliation');
    });
  });

  // -------------------------------------------------------------------
  // Write actions — payload forgiveness + handlerOutcome propagation
  // -------------------------------------------------------------------
  //
  // Bug 1 (LLM emits a flat `{ propertyName, label, ... }` payload
  // without a `propertyRef` wrapper): the schema preprocess step hoists
  // it back into nested form, so handleWriteAction validates it and
  // proceeds. Handler failures never emit proposal.committed.

  describe('write actions / Sonnet 4.6 payload forgiveness', () => {
    it('keeps malformed model output and raw action names out of customer copy', async () => {
      const { deps, emitted } = makeDeps();
      const server = createSpawnMcp(deps);
      const handler = getHandler(server, 'spawn_property_worker');

      const res = await handler(
        { action_type: 'update_rent', payload: {} },
        {},
      );

      expect(res.content[0]?.text).toBe(
        'The rent change request was malformed. No action was completed.',
      );
      expect(res.content[0]?.text).not.toContain('update_rent');
      expect(res.content[0]?.text).not.toContain('leaseRef');
      expect(emitted).toContainEqual(
        expect.objectContaining({
          type: 'tool.error',
          message: expect.stringContaining('Invalid update_rent payload'),
        }),
      );
    });

    it('coerces a flat add_unit payload (propertyName at root) into a valid record', async () => {
      const { deps, emitted } = makeDeps();
      const proposal = workerProposal('add_unit', {
        propertyRef: { propertyName: 'Galaxy A' },
        label: '1',
        bedrooms: 3,
        bathrooms: 2,
      } as WorkerActionPayload);
      mockRecord.mockResolvedValue(recordedProposal(proposal, 'auto') as never);
      mockCommit.mockResolvedValue({
        proposal: { ...proposal, status: 'committed' },
        dispatch: {
          kind: 'handler',
          action_type: 'add_unit',
          result: {
            ok: true,
            data: { id: 'u1', label: '1' },
            confidence: 0.8,
            reasoning: 'inserted unit 1',
          },
        },
        changed: true,
      } as never);

      const server = createSpawnMcp(deps);
      const handler = getHandler(server, 'spawn_property_worker');
      const res = await handler(
        {
          action_type: 'add_unit',
          // NOTE: flat shape — propertyName is hoisted to top-level,
          // no `propertyRef` wrapper. The bug we're guarding against.
          payload: {
            propertyName: 'Galaxy A',
            label: '1',
            bedrooms: 3,
            bathrooms: 2,
          },
        },
        {},
      );
      // No "Invalid payload" error returned — schema coerced the shape.
      expect(res.content[0]?.text).not.toContain('Invalid payload');
      expect(res.content[0]?.text).toContain('automatically');
      expect(emitted.some((e) => e.type === 'proposal.committed')).toBe(true);
      // mockSpawn (the per-property worker LLM) is NOT called for write actions.
      expect(mockSpawn).not.toHaveBeenCalled();
    });

    it('routes a sensitive auto write to owner review for a VA actor', async () => {
      const { deps, emitted } = makeDeps({
        commitActor: { kind: 'user', role: 'va' },
      });
      const payload = {
        leaseRef: { tenantName: 'Jane Doe' },
        rentAmount: 2400,
        rentDueDay: 1,
        startDate: '2026-06-01',
      } as WorkerActionPayload;
      const proposal = workerProposal('set_lease_terms', payload);
      mockRecord.mockResolvedValue(recordedProposal(proposal, 'auto') as never);

      const server = createSpawnMcp(deps);
      const handler = getHandler(server, 'spawn_property_worker');
      const res = await handler(
        {
          action_type: 'set_lease_terms',
          payload,
        },
        {},
      );

      expect(mockCommit).not.toHaveBeenCalled();
      expect(emitted.map((event) => event.type)).toEqual([
        'proposal.recorded',
        'proposal.review_required',
      ]);
      expect(res.content[0]?.text).toContain('needs review');
    });

    it.each([
      ['add_tenant', { fullName: 'Sam Doe', phoneE164: '+15555550123' }],
      [
        'set_lease_terms',
        {
          leaseRef: { tenantName: 'Jane Doe' },
          rentAmount: 2400,
          rentDueDay: 1,
          startDate: '2026-06-01',
        },
      ],
      [
        'update_rent',
        { leaseRef: { tenantName: 'Jane Doe' }, rentAmount: 2500 },
      ],
      [
        'waive_rent',
        {
          leaseRef: { tenantName: 'Jane Doe' },
          cycleMonth: '2026-08',
          reason: 'Owner decision required',
        },
      ],
      [
        'send_tenant_message',
        {
          tenantRef: { tenantName: 'Jane Doe' },
          body: 'Prepared tenant message',
        },
      ],
      [
        'update_property_rules',
        {
          propertyRef: { propertyName: 'Galaxy A' },
          rulesText: 'Prepared rulebook change',
        },
      ],
      [
        'archive_lease',
        { leaseRef: { tenantName: 'Jane Doe' }, reason: 'Move-out' },
      ],
      [
        'set_property_vendor',
        {
          propertyRef: { propertyName: 'Galaxy A' },
          category: 'plumbing',
          vendorRef: { vendorName: 'Acme Plumbing' },
        },
      ],
      [
        'update_tenant_preference',
        {
          tenantRef: { tenantName: 'Jane Doe' },
          preferredChannel: 'email',
        },
      ],
      [
        'request_rent_payment',
        { tenantRef: { tenantName: 'Jane Doe' }, amountCents: 180000 },
      ],
      [
        'schedule_calendar_event',
        {
          summary: 'Unit inspection',
          startIso: '2026-08-07T14:00:00-04:00',
          endIso: '2026-08-07T15:00:00-04:00',
        },
      ],
      ['cancel_calendar_event', { eventId: 'calendar-event-1' }],
    ] as const)(
      'keeps dispatcher-direct %s in review at autonomy 0 even if persistence returns auto',
      async (actionType, payload) => {
        const orgContext = makeOrgContext();
        orgContext.properties[0]!.autonomyLevel = 0;
        const { deps, emitted } = makeDeps({ orgContext });
        const proposal = workerProposal(
          actionType,
          payload as WorkerActionPayload,
        );
        mockRecord.mockResolvedValue(recordedProposal(proposal, 'auto') as never);

        const server = createSpawnMcp(deps);
        const handler = getHandler(server, 'spawn_property_worker');
        const res = await handler(
          { action_type: actionType, payload },
          {},
        );

        expect(mockRecord.mock.calls[0]?.[1].autonomyLevel).toBe(0);
        expect(mockCommit).not.toHaveBeenCalled();
        expect(emitted.map((event) => event.type)).toEqual([
          'proposal.recorded',
          'proposal.review_required',
        ]);
        expect(res.content[0]?.text).toContain('needs review');
      },
    );

    it.each([
      [
        'create_property',
        {
          name: 'Prepared Property',
          addressStreet: '100 Test Way',
          addressCity: 'Baltimore',
          addressState: 'MD',
          addressZip: '21201',
        },
      ],
      [
        'add_unit',
        {
          propertyRef: { propertyName: 'Galaxy A' },
          label: 'Prepared Unit',
          bedrooms: 1,
          bathrooms: 1,
        },
      ],
      [
        'add_tenant',
        { fullName: 'Sam Doe', phoneE164: '+15555550123' },
      ],
      [
        'archive_lease',
        { leaseRef: { tenantName: 'Jane Doe' }, reason: 'Move-out confirmed' },
      ],
      [
        'log_maintenance_ticket',
        {
          unitRef: { unitLabel: 'Apt 4' },
          summary: 'Prepare a maintenance intake for owner review.',
          severity: 'medium',
        },
      ],
      [
        'update_property_rules',
        {
          propertyRef: { name: 'Oak Street' },
          rulesText: 'Owner review is required before changing house rules.',
        },
      ],
      [
        'add_appliance',
        {
          propertyRef: { propertyName: 'Galaxy A' },
          type: 'water_heater',
          notes: 'Prepared from the known record.',
        },
      ],
      [
        'update_appliance',
        {
          applianceRef: {
            propertyName: 'Galaxy A',
            type: 'water_heater',
          },
          notes: 'Prepared update for owner review.',
        },
      ],
      [
        'set_property_vendor',
        {
          propertyRef: { propertyName: 'Galaxy A' },
          category: 'plumbing',
          vendorRef: { vendorName: 'Acme Plumbing' },
        },
      ],
      [
        'update_tenant_preference',
        {
          tenantRef: { tenantName: 'Jane Doe' },
          preferredChannel: 'email',
        },
      ],
      [
        'schedule_calendar_event',
        {
          summary: 'Unit inspection',
          startIso: '2026-08-04T14:00:00-04:00',
          endIso: '2026-08-04T15:00:00-04:00',
        },
      ],
      ['cancel_calendar_event', { eventId: 'calendar-event-1' }],
    ] as const)(
      'routes VA %s auto execution to an owner handoff',
      async (actionType, payload) => {
        const { deps, emitted } = makeDeps({
          commitActor: { kind: 'user', role: 'va' },
        });
        const proposal = workerProposal(
          actionType,
          payload as WorkerActionPayload,
        );
        mockRecord.mockResolvedValue(
          recordedProposal(proposal, 'auto') as never,
        );

        const server = createSpawnMcp(deps);
        const handler = getHandler(server, 'spawn_property_worker');
        const res = await handler(
          { action_type: actionType, payload },
          {},
        );

        expect(mockCommit).not.toHaveBeenCalled();
        expect(emitted.map((event) => event.type)).toEqual([
          'proposal.recorded',
          'proposal.review_required',
        ]);
        expect(emitted.at(-1)).toMatchObject({
          reviewUrl: '/escalations?proposal=persisted-id',
        });
        expect(res.content[0]?.text).toContain('needs review');
      },
    );

    it('keeps a manager handoff linked to the specific proposal', async () => {
      const { deps, emitted } = makeDeps({
        commitActor: { kind: 'user', role: 'manager' },
      });
      const payload = {
        propertyRef: { propertyName: 'Oak Street' },
        rulesText: 'Owner review remains attached to this proposal.',
      } as WorkerActionPayload;
      const proposal = workerProposal('update_property_rules', payload);
      mockRecord.mockResolvedValue(recordedProposal(proposal, 'auto') as never);

      const server = createSpawnMcp(deps);
      const handler = getHandler(server, 'spawn_property_worker');
      await handler(
        { action_type: 'update_property_rules', payload },
        {},
      );

      expect(mockCommit).not.toHaveBeenCalled();
      expect(emitted.at(-1)).toMatchObject({
        type: 'proposal.review_required',
        reviewUrl: '/owner-queue',
      });
    });
  });

  describe('write actions / handlerOutcome propagation', () => {
    it('never emits proposal.committed on soft handler failure', async () => {
      const { deps, emitted } = makeDeps();
      const proposal = workerProposal('add_unit', {
        propertyRef: { propertyName: 'Galaxy A' },
        label: '2',
        bedrooms: 1,
        bathrooms: 1,
      } as WorkerActionPayload);
      mockRecord.mockResolvedValue(recordedProposal(proposal, 'auto') as never);
      mockCommit.mockResolvedValue({
        proposal: { ...proposal, status: 'failed' },
        dispatch: {
          kind: 'handler',
          action_type: 'add_unit',
          result: {
            ok: false,
            error: 'database_write_failed',
            confidence: 0,
          },
        },
        changed: false,
      } as never);

      const server = createSpawnMcp(deps);
      const handler = getHandler(server, 'spawn_property_worker');
      const res = await handler(
        {
          action_type: 'add_unit',
          payload: {
            propertyRef: { propertyName: 'Galaxy A' },
            label: '2',
            bedrooms: 1,
            bathrooms: 1,
          },
        },
        {},
      );

      expect(emitted.some((e) => e.type === 'proposal.committed')).toBe(false);
      expect(emitted).toContainEqual(
        expect.objectContaining({
          type: 'tool.error',
          message: expect.stringContaining('database_write_failed'),
        }),
      );
      // Internal error detail stays in the durable tool.error event; customer
      // text gives a humane reconciliation state without raw tool/database copy.
      expect(res.content[0]?.text).toContain('needs reconciliation');
      expect(res.content[0]?.text).not.toContain('database_write_failed');
    });

    it('attaches handlerOutcome.ok=true on success', async () => {
      const { deps, emitted } = makeDeps();
      const proposal = workerProposal('add_unit', {
        propertyRef: { propertyName: 'Galaxy A' },
        label: '2',
        bedrooms: 1,
        bathrooms: 1,
      } as WorkerActionPayload);
      mockRecord.mockResolvedValue(recordedProposal(proposal, 'auto') as never);
      mockCommit.mockResolvedValue({
        proposal: { ...proposal, status: 'committed' },
        dispatch: {
          kind: 'handler',
          action_type: 'add_unit',
          result: {
            ok: true,
            data: { id: 'u2', label: '2' },
            confidence: 1.0,
            reasoning: 'inserted tenant',
          },
        },
        changed: true,
      } as never);

      const server = createSpawnMcp(deps);
      const handler = getHandler(server, 'spawn_property_worker');
      await handler(
        {
          action_type: 'add_unit',
          payload: {
            propertyRef: { propertyName: 'Galaxy A' },
            label: '2',
            bedrooms: 1,
            bathrooms: 1,
          },
        },
        {},
      );

      const committed = emitted.find((e) => e.type === 'proposal.committed');
      expect(committed).toBeDefined();
      if (committed && committed.type === 'proposal.committed') {
        expect(committed.handlerOutcome?.ok).toBe(true);
      }
    });
  });
});
