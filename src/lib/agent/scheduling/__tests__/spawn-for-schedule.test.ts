/**
 * Unit tests for spawnForSchedule.
 *
 * spawnPropertyWorker, recordProposal, and selectProvider are mocked;
 * the property-row lookup is exercised against a hand-rolled Supabase
 * stub. Test plan:
 *   - happy path: reads property privacy/autonomy, picks provider for
 *     the action_type, persists with routing.scheduledActionId
 *   - condition with rent_unpaid → routing also carries tenantId
 *   - condition=null (always) → routing has scheduledActionId only
 *   - propertyId=null → ScheduledActionPropertyNotFoundError
 *   - property row missing → ScheduledActionPropertyNotFoundError
 *   - decision='review' propagated correctly
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '@/types/database';
import type {
  ActionProposal,
  WorkerModelProvider,
} from '@/lib/agent/worker/types';
import type { GateDecision } from '@/lib/agent/worker/commit-gate';
import type { ScheduledAction } from '../types';

vi.mock('@/lib/agent/worker/spawn', () => ({
  spawnPropertyWorker: vi.fn(),
}));
// Keep the real rowToActionProposal (the dedup short-circuit maps DB
// rows through it); only the insert path is mocked.
vi.mock('@/lib/agent/proposals/record', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/agent/proposals/record')>();
  return {
    ...actual,
    recordProposal: vi.fn(),
  };
});
vi.mock('@/lib/agent/worker/providers/select', () => ({
  selectProvider: vi.fn(),
}));

import { spawnPropertyWorker } from '@/lib/agent/worker/spawn';
import { recordProposal } from '@/lib/agent/proposals/record';
import { selectProvider } from '@/lib/agent/worker/providers/select';
import {
  ScheduledActionPropertyNotFoundError,
  spawnForSchedule,
} from '../spawn-for-schedule';

const mockedSpawnPropertyWorker = vi.mocked(spawnPropertyWorker);
const mockedRecordProposal = vi.mocked(recordProposal);
const mockedSelectProvider = vi.mocked(selectProvider);

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ORG = '00000000-0000-0000-0000-000000000001';
const PROP = '00000000-0000-0000-0000-000000000002';
const SCHEDULE = '00000000-0000-0000-0000-000000000010';
const TENANT = '00000000-0000-0000-0000-000000000020';
const PROPOSAL_ID = '00000000-0000-0000-0000-000000000030';
const USER_ID = '00000000-0000-0000-0000-000000000040';

function makeSchedule(overrides: Partial<ScheduledAction> = {}): ScheduledAction {
  return {
    id: SCHEDULE,
    organizationId: ORG,
    propertyId: PROP,
    userId: USER_ID,
    triggerAt: '2026-05-08T17:00:00.000Z',
    condition: { type: 'always' },
    conditionText: 'unconditional',
    actionType: 'draft_sms_reply',
    actionPayload: {
      tenantId: TENANT,
      tenantName: 'Marcus Lee',
      phoneE164: '+15551234567',
      conversationId: 'sched',
      inboundBody: 'rent reminder',
      history: [],
    },
    actionText: 'Send Marcus a rent reminder Friday at 5pm',
    status: 'scheduled',
    firedAt: null,
    firedProposalId: null,
    cancelledAt: null,
    cancelledBy: null,
    cancellationReason: null,
    conditionFailureReason: null,
    inngestEventId: 'evt-1',
    createdAt: '2026-05-06T10:00:00.000Z',
    updatedAt: '2026-05-06T10:00:00.000Z',
    ...overrides,
  };
}

function makeInMemoryProposal(
  overrides: Partial<ActionProposal> = {},
): ActionProposal {
  return {
    id: null,
    organizationId: ORG,
    propertyId: PROP,
    workerModel: 'claude-sonnet-4-6',
    action_type: 'draft_sms_reply',
    payload: { body: 'reminder body', tone: 'warm' },
    routing: null,
    reasoning: 'tenant pattern + rent due',
    confidence: 0.82,
    context_fact_ids: ['fact-1'],
    gate_decision: null,
    status: 'proposed',
    createdAt: '2026-05-08T17:00:00.000Z',
    ...overrides,
  };
}

function makePersistedProposal(
  overrides: Partial<ActionProposal> = {},
): ActionProposal {
  return {
    ...makeInMemoryProposal(),
    id: PROPOSAL_ID,
    gate_decision: 'auto',
    routing: { tenantId: TENANT, scheduledActionId: SCHEDULE },
    ...overrides,
  };
}

function makeProvider(name = 'mock-sonnet'): WorkerModelProvider {
  return {
    name,
    supportsPromptCaching: () => true,
    call: vi.fn(),
    healthCheck: vi.fn(async () => ({ ok: true, latencyMs: 1 })),
  };
}

interface PropertyRow {
  privacy_mode: string;
  ollama_host: string | null;
  autonomy_level: number;
}

type ProposalRow = Database['public']['Tables']['action_proposals']['Row'];

interface MakeDbOpts {
  error?: { message: string };
  /** Row the action_proposals dedup lookup returns (default: none). */
  existingProposalRow?: ProposalRow | null;
  /** Captures the dedup lookup's .filter() args for assertions. */
  proposalFilterCalls?: Array<unknown[]>;
}

function makeDb(
  propertyRow: PropertyRow | null,
  opts: MakeDbOpts = {},
): SupabaseClient<Database> {
  const propertyBuilder = {
    select: vi.fn(() => propertyBuilder),
    eq: vi.fn(() => propertyBuilder),
    maybeSingle: vi.fn(async () => ({
      data: propertyRow,
      error: opts.error ?? null,
    })),
  };
  const proposalBuilder = {
    select: vi.fn(() => proposalBuilder),
    filter: vi.fn((...args: unknown[]) => {
      opts.proposalFilterCalls?.push(args);
      return proposalBuilder;
    }),
    order: vi.fn(() => proposalBuilder),
    limit: vi.fn(() => proposalBuilder),
    maybeSingle: vi.fn(async () => ({
      data: opts.existingProposalRow ?? null,
      error: null,
    })),
  };
  return {
    from: vi.fn((table: string) =>
      table === 'action_proposals' ? proposalBuilder : propertyBuilder,
    ),
  } as unknown as SupabaseClient<Database>;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('spawnForSchedule', () => {
  beforeEach(() => {
    mockedSpawnPropertyWorker.mockReset();
    mockedRecordProposal.mockReset();
    mockedSelectProvider.mockReset();
    mockedSelectProvider.mockReturnValue(makeProvider('claude-sonnet-4-6'));
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('happy path: picks provider for the action_type, persists proposal with routing.scheduledActionId', async () => {
    const db = makeDb({
      privacy_mode: 'hosted',
      ollama_host: null,
      autonomy_level: 0.7,
    });

    const inMemory = makeInMemoryProposal();
    mockedSpawnPropertyWorker.mockResolvedValue(inMemory);

    const persisted = makePersistedProposal({
      gate_decision: 'auto',
      routing: { tenantId: TENANT, scheduledActionId: SCHEDULE },
    });
    const decision: GateDecision = {
      outcome: 'auto',
      reason: 'autonomy threshold',
    } as GateDecision;
    mockedRecordProposal.mockResolvedValue({
      proposal: persisted,
      decision,
    });

    const result = await spawnForSchedule(makeSchedule(), { db });

    // Provider picked with hosted privacy mode and the schedule's action_type.
    expect(mockedSelectProvider).toHaveBeenCalledWith(
      { privacyMode: 'hosted', ollamaHost: null },
      { actionType: 'draft_sms_reply' },
    );

    // Worker spawned with the schedule's payload as data.
    const spawnArgs = mockedSpawnPropertyWorker.mock.calls[0]![0];
    expect(spawnArgs.propertyId).toBe(PROP);
    expect(spawnArgs.action_type).toBe('draft_sms_reply');
    expect(spawnArgs.data).toEqual(
      expect.objectContaining({ tenantName: 'Marcus Lee' }),
    );

    // Proposal persisted with routing carrying scheduledActionId AND
    // mirrored autonomy/privacy from the property row.
    const recordArgs = mockedRecordProposal.mock.calls[0]![1];
    expect(recordArgs.organizationId).toBe(ORG);
    expect(recordArgs.propertyId).toBe(PROP);
    expect(recordArgs.autonomyLevel).toBe(0.7);
    expect(recordArgs.privacyMode).toBe('hosted');
    expect(recordArgs.routing).toEqual({
      scheduledActionId: SCHEDULE,
    });

    expect(result.proposal).toBe(persisted);
    expect(result.decision).toBe('auto');
  });

  it('mirrors tenantId into routing when condition pins to a tenant', async () => {
    const db = makeDb({
      privacy_mode: 'hosted',
      ollama_host: null,
      autonomy_level: 0.5,
    });

    mockedSpawnPropertyWorker.mockResolvedValue(makeInMemoryProposal());
    mockedRecordProposal.mockResolvedValue({
      proposal: makePersistedProposal({ gate_decision: 'review' }),
      decision: { outcome: 'review', reason: 'autonomy below threshold' } as GateDecision,
    });

    await spawnForSchedule(
      makeSchedule({
        condition: {
          type: 'rent_unpaid',
          tenantId: TENANT,
          asOf: 'trigger_at',
        },
      }),
      { db },
    );

    const recordArgs = mockedRecordProposal.mock.calls[0]![1];
    expect(recordArgs.routing).toEqual({
      tenantId: TENANT,
      scheduledActionId: SCHEDULE,
    });
  });

  it('on_prem orgs route through the on_prem provider with their ollama host', async () => {
    const db = makeDb({
      privacy_mode: 'on_prem',
      ollama_host: 'http://10.0.0.5:11434',
      autonomy_level: 0.4,
    });

    mockedSpawnPropertyWorker.mockResolvedValue(makeInMemoryProposal());
    mockedRecordProposal.mockResolvedValue({
      proposal: makePersistedProposal({ gate_decision: 'auto' }),
      decision: { outcome: 'auto', reason: 'auto' } as GateDecision,
    });

    await spawnForSchedule(makeSchedule(), { db });

    expect(mockedSelectProvider).toHaveBeenCalledWith(
      { privacyMode: 'on_prem', ollamaHost: 'http://10.0.0.5:11434' },
      { actionType: 'draft_sms_reply' },
    );
  });

  it('throws ScheduledActionPropertyNotFoundError when schedule.propertyId is null', async () => {
    const db = makeDb(null);

    await expect(
      spawnForSchedule(
        makeSchedule({ propertyId: null }),
        { db },
      ),
    ).rejects.toBeInstanceOf(ScheduledActionPropertyNotFoundError);

    expect(mockedSpawnPropertyWorker).not.toHaveBeenCalled();
    expect(mockedRecordProposal).not.toHaveBeenCalled();
  });

  it('throws ScheduledActionPropertyNotFoundError when the property row is missing', async () => {
    const db = makeDb(null);

    await expect(spawnForSchedule(makeSchedule(), { db })).rejects.toBeInstanceOf(
      ScheduledActionPropertyNotFoundError,
    );

    expect(mockedSpawnPropertyWorker).not.toHaveBeenCalled();
  });

  it("propagates a 'review' gate decision through to the result", async () => {
    const db = makeDb({
      privacy_mode: 'hosted',
      ollama_host: null,
      autonomy_level: 0.2,
    });

    mockedSpawnPropertyWorker.mockResolvedValue(makeInMemoryProposal());

    const persisted = makePersistedProposal({ gate_decision: 'review' });
    mockedRecordProposal.mockResolvedValue({
      proposal: persisted,
      decision: {
        outcome: 'review',
        reason: 'autonomy below threshold for action',
      } as GateDecision,
    });

    const result = await spawnForSchedule(makeSchedule(), { db });
    expect(result.decision).toBe('review');
    expect(result.proposal).toBe(persisted);
  });

  it('short-circuits without a model call when a proposal already exists for the schedule', async () => {
    const filterCalls: Array<unknown[]> = [];
    const existingRow: ProposalRow = {
      id: PROPOSAL_ID,
      organization_id: ORG,
      property_id: PROP,
      worker_model: 'claude-sonnet-4-6',
      action_type: 'draft_sms_reply',
      payload: { body: 'reminder body', tone: 'warm' } as unknown as ProposalRow['payload'],
      reasoning: 'tenant pattern + rent due',
      confidence: 0.82,
      context_fact_ids: ['fact-1'],
      gate_decision: 'review',
      status: 'proposed',
      created_at: '2026-05-08T17:00:01.000Z',
      committed_at: null,
      rejected_at: null,
      edit_diff: null,
      execution_evidence: null,
      outcome: null,
      routing: { tenantId: TENANT, scheduledActionId: SCHEDULE } as unknown as ProposalRow['routing'],
      retell_artifact_key: null,
      retryable: false,
      last_attempted_at: null,
    };

    const db = makeDb(
      { privacy_mode: 'hosted', ollama_host: null, autonomy_level: 0.7 },
      { existingProposalRow: existingRow, proposalFilterCalls: filterCalls },
    );

    const result = await spawnForSchedule(makeSchedule(), { db });

    // Existing row reused verbatim — no provider, no model call, no
    // second insert.
    expect(mockedSelectProvider).not.toHaveBeenCalled();
    expect(mockedSpawnPropertyWorker).not.toHaveBeenCalled();
    expect(mockedRecordProposal).not.toHaveBeenCalled();

    // Looked up by the jsonb routing linkage.
    expect(filterCalls).toEqual([
      ['routing->>scheduledActionId', 'eq', SCHEDULE],
    ]);

    expect(result.proposal.id).toBe(PROPOSAL_ID);
    expect(result.proposal.routing).toEqual({
      tenantId: TENANT,
      scheduledActionId: SCHEDULE,
    });
    expect(result.decision).toBe('review');
  });

  it('surfaces a worker validation error from spawnPropertyWorker', async () => {
    const db = makeDb({
      privacy_mode: 'hosted',
      ollama_host: null,
      autonomy_level: 0.5,
    });

    mockedSpawnPropertyWorker.mockRejectedValue(
      new Error('worker output validation failed'),
    );

    await expect(spawnForSchedule(makeSchedule(), { db })).rejects.toThrow(
      'worker output validation failed',
    );

    expect(mockedRecordProposal).not.toHaveBeenCalled();
  });
});
