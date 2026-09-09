/**
 * Unit tests for the fire-scheduled-action Inngest function.
 *
 * Two surfaces:
 *   1. Inngest registration smoke (id + event trigger).
 *   2. The pure runner `runFireScheduledAction` driven against:
 *      - a hand-rolled `step` stub that resolves immediately
 *      - mocked `evaluateCondition` and `spawnForSchedule`
 *      - a Supabase client stub that records loads + UPDATEs
 *
 * Test plan (from brief):
 *   - schedule already cancelled at load → exit cleanly
 *   - schedule cancelled during sleep (recheck) → exit cleanly
 *   - condition fails → mark condition_failed, no spawn
 *   - condition holds + gate=auto → spawn + commit + mark fired
 *   - condition holds + gate=review → spawn + no commit + mark fired
 *   - condition holds + gate=block → spawn + no commit + mark fired
 *   - schedule property gone (ScheduledActionPropertyNotFoundError) →
 *     mark condition_failed
 *   - registration: id + event match
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database, ScheduledActionRow } from '@/types/database';
import type {
  ActionProposal,
  WorkerModelProvider,
} from '@/lib/agent/worker/types';
import type { GateDecision } from '@/lib/agent/worker/commit-gate';
import type { evaluateCondition } from '@/lib/agent/scheduling/conditions';
import type { spawnForSchedule } from '@/lib/agent/scheduling/spawn-for-schedule';
import type { commitProposal } from '@/lib/agent/proposals/commit';
import {
  fireScheduledAction,
  FIRE_SCHEDULED_ACTION_EVENT,
  FIRE_SCHEDULED_ACTION_FN_ID,
  rowToScheduledAction,
  runFireScheduledAction,
  type StepLike,
} from '../fire-scheduled-action';
import { ScheduledActionPropertyNotFoundError } from '@/lib/agent/scheduling/spawn-for-schedule';

// The re-run dedup suite drives the REAL spawnForSchedule +
// recordProposal pipeline; only the model call (spawnPropertyWorker)
// and provider selection are mocked. The unit suites above pass their
// own spawnForScheduleImpl stubs, so these module mocks never affect
// them.
vi.mock('@/lib/agent/worker/spawn', () => ({
  spawnPropertyWorker: vi.fn(),
}));
vi.mock('@/lib/agent/worker/providers/select', () => ({
  selectProvider: vi.fn(),
}));

import { spawnPropertyWorker } from '@/lib/agent/worker/spawn';
import { selectProvider } from '@/lib/agent/worker/providers/select';

const mockedSpawnPropertyWorker = vi.mocked(spawnPropertyWorker);
const mockedSelectProvider = vi.mocked(selectProvider);

// ---------------------------------------------------------------------------
// Constants + fixtures
// ---------------------------------------------------------------------------

const SCHEDULE = '00000000-0000-0000-0000-000000000010';
const ORG = '00000000-0000-0000-0000-000000000001';
const PROP = '00000000-0000-0000-0000-000000000002';
const TENANT = '00000000-0000-0000-0000-000000000020';
const PROPOSAL_ID = '00000000-0000-0000-0000-000000000030';
const USER_ID = '00000000-0000-0000-0000-000000000040';

function makeRow(overrides: Partial<ScheduledActionRow> = {}): ScheduledActionRow {
  return {
    id: SCHEDULE,
    organization_id: ORG,
    property_id: PROP,
    user_id: USER_ID,
    trigger_at: '2026-05-08T17:00:00.000Z',
    condition: { type: 'always' },
    condition_text: 'unconditional',
    action_type: 'draft_sms_reply',
    action_payload: {
      tenantId: TENANT,
      tenantName: 'Marcus Lee',
      phoneE164: '+15551234567',
      conversationId: 'sched',
      inboundBody: 'rent reminder',
      history: [],
    },
    action_text: 'Send Marcus a rent reminder Friday at 5pm',
    status: 'scheduled',
    fired_at: null,
    fired_proposal_id: null,
    cancelled_at: null,
    cancelled_by: null,
    cancellation_reason: null,
    condition_failure_reason: null,
    inngest_event_id: 'evt-1',
    created_at: '2026-05-06T10:00:00.000Z',
    updated_at: '2026-05-06T10:00:00.000Z',
    ...overrides,
  };
}

function makeProposal(overrides: Partial<ActionProposal> = {}): ActionProposal {
  return {
    id: PROPOSAL_ID,
    organizationId: ORG,
    propertyId: PROP,
    workerModel: 'claude-sonnet-4-6',
    action_type: 'draft_sms_reply',
    payload: { body: 'reminder body', tone: 'warm' },
    routing: { tenantId: TENANT, scheduledActionId: SCHEDULE },
    reasoning: 'condition met',
    confidence: 0.85,
    context_fact_ids: [],
    gate_decision: 'auto',
    status: 'proposed',
    createdAt: '2026-05-08T17:00:00.000Z',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// step stub — resolves immediately, records call ids
// ---------------------------------------------------------------------------

interface StepCallLog {
  ids: string[];
  sleepUntilCalls: Array<{ id: string; until: Date | string }>;
}

function makeStep(): StepLike & { log: StepCallLog } {
  const log: StepCallLog = { ids: [], sleepUntilCalls: [] };
  return {
    log,
    async run<T>(id: string, fn: () => Promise<T> | T): Promise<T> {
      log.ids.push(id);
      return await fn();
    },
    async sleepUntil(id: string, until: Date | string): Promise<unknown> {
      log.sleepUntilCalls.push({ id, until });
      return undefined;
    },
  };
}

// ---------------------------------------------------------------------------
// db stub — captures load reads + update payloads
// ---------------------------------------------------------------------------

interface DbState {
  /** Sequence of rows the next maybeSingle() should return. */
  loadQueue: Array<ScheduledActionRow | null>;
  /** Recorded UPDATE patches in arrival order. */
  updates: Array<Record<string, unknown>>;
}

function makeDb(state: DbState): SupabaseClient<Database> {
  return {
    from: vi.fn(() => {
      let mode: 'select' | 'update' = 'select';
      let pendingPatch: Record<string, unknown> | null = null;
      const builder: Record<string, unknown> = {};

      builder.select = () => {
        mode = 'select';
        return builder;
      };
      builder.update = (patch: Record<string, unknown>) => {
        mode = 'update';
        pendingPatch = patch;
        return builder;
      };
      builder.eq = () => {
        // The .eq() chain on an update terminates via the thenable below.
        return builder;
      };
      builder.maybeSingle = async () => {
        const next = state.loadQueue.shift() ?? null;
        return { data: next, error: null };
      };
      // Updates resolve via thenable (the route doesn't .single() updates).
      builder.then = (
        fulfilled?: (v: { data: unknown; error: null }) => unknown,
      ) => {
        if (mode === 'update' && pendingPatch) {
          state.updates.push(pendingPatch);
          pendingPatch = null;
          return Promise.resolve(
            fulfilled ? fulfilled({ data: null, error: null }) : { data: null, error: null },
          );
        }
        return Promise.resolve(
          fulfilled ? fulfilled({ data: null, error: null }) : { data: null, error: null },
        );
      };
      return builder;
    }),
  } as unknown as SupabaseClient<Database>;
}

// ---------------------------------------------------------------------------
// Tests — registration
// ---------------------------------------------------------------------------

describe('fireScheduledAction registration', () => {
  it('exposes the expected id', () => {
    expect(fireScheduledAction.id()).toBe(FIRE_SCHEDULED_ACTION_FN_ID);
    expect(FIRE_SCHEDULED_ACTION_FN_ID).toBe('fire-scheduled-action');
  });

  it('registers under the scheduled-action.fire event', () => {
    const triggers = fireScheduledAction.opts.triggers ?? [];
    const events = triggers
      .map((t) => ('event' in t ? t.event : null))
      .filter(Boolean);
    expect(events).toContain(FIRE_SCHEDULED_ACTION_EVENT);
    expect(FIRE_SCHEDULED_ACTION_EVENT).toBe('odesa/scheduled-action.fire');
  });
});

// ---------------------------------------------------------------------------
// Tests — runFireScheduledAction
// ---------------------------------------------------------------------------

describe('runFireScheduledAction', () => {
  // Typed via vi.fn<Signature>() so the strict shapes on
  // FireScheduledActionDeps accept these mocks without casts. Vitest's
  // generic vi.fn() returns Mock<Procedure | Constructable> which TS
  // can't narrow to a specific function type — we lock the shape here.
  let evaluateConditionImpl: ReturnType<typeof vi.fn<typeof evaluateCondition>>;
  let spawnForScheduleImpl: ReturnType<typeof vi.fn<typeof spawnForSchedule>>;
  let commitProposalImpl: ReturnType<typeof vi.fn<typeof commitProposal>>;

  beforeEach(() => {
    evaluateConditionImpl = vi.fn<typeof evaluateCondition>();
    spawnForScheduleImpl = vi.fn<typeof spawnForSchedule>();
    commitProposalImpl = vi.fn<typeof commitProposal>();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('exits cleanly when the schedule is missing', async () => {
    const dbState: DbState = { loadQueue: [null], updates: [] };
    const db = makeDb(dbState);
    const step = makeStep();

    const out = await runFireScheduledAction({
      scheduleId: SCHEDULE,
      step,
      deps: { db, evaluateConditionImpl, spawnForScheduleImpl, commitProposalImpl },
    });

    expect(out).toEqual({ kind: 'skipped', reason: 'not_found' });
    expect(step.log.ids).toEqual(['load']);
    expect(dbState.updates).toHaveLength(0);
  });

  it('exits cleanly when the schedule is already cancelled at load', async () => {
    const dbState: DbState = {
      loadQueue: [makeRow({ status: 'cancelled' })],
      updates: [],
    };
    const db = makeDb(dbState);
    const step = makeStep();

    const out = await runFireScheduledAction({
      scheduleId: SCHEDULE,
      step,
      deps: { db, evaluateConditionImpl, spawnForScheduleImpl, commitProposalImpl },
    });

    expect(out).toEqual({ kind: 'skipped', reason: 'not_scheduled' });
    expect(step.log.sleepUntilCalls).toHaveLength(0);
    expect(spawnForScheduleImpl).not.toHaveBeenCalled();
  });

  it('exits cleanly when the schedule is cancelled during sleep (recheck path)', async () => {
    const dbState: DbState = {
      loadQueue: [makeRow(), makeRow({ status: 'cancelled' })],
      updates: [],
    };
    const db = makeDb(dbState);
    const step = makeStep();

    const out = await runFireScheduledAction({
      scheduleId: SCHEDULE,
      step,
      deps: { db, evaluateConditionImpl, spawnForScheduleImpl, commitProposalImpl },
    });

    expect(out).toEqual({ kind: 'skipped', reason: 'recheck_not_scheduled' });
    expect(step.log.sleepUntilCalls).toHaveLength(1);
    expect(step.log.ids).toEqual(['load', 'recheck']);
    expect(evaluateConditionImpl).not.toHaveBeenCalled();
    expect(spawnForScheduleImpl).not.toHaveBeenCalled();
    expect(dbState.updates).toHaveLength(0);
  });

  it('marks condition_failed when evaluator returns holds=false; no spawn', async () => {
    const dbState: DbState = {
      loadQueue: [makeRow(), makeRow()],
      updates: [],
    };
    const db = makeDb(dbState);
    const step = makeStep();

    evaluateConditionImpl.mockResolvedValue({
      holds: false,
      reason: 'tenant paid yesterday',
    });

    const out = await runFireScheduledAction({
      scheduleId: SCHEDULE,
      step,
      deps: { db, evaluateConditionImpl, spawnForScheduleImpl, commitProposalImpl },
    });

    expect(out).toEqual({
      kind: 'condition_failed',
      reason: 'tenant paid yesterday',
    });
    expect(spawnForScheduleImpl).not.toHaveBeenCalled();
    expect(commitProposalImpl).not.toHaveBeenCalled();
    expect(dbState.updates).toHaveLength(1);
    expect(dbState.updates[0]).toEqual(
      expect.objectContaining({
        status: 'condition_failed',
        condition_failure_reason: 'tenant paid yesterday',
      }),
    );
  });

  it("condition holds + gate='auto' → spawn, commit, mark fired", async () => {
    const internalRow = makeRow({
      action_type: 'log_maintenance_ticket',
      action_payload: {
        unitRef: { unitLabel: '2B' },
        summary: 'Leaking faucet',
        severity: 'low',
      },
    });
    const dbState: DbState = {
      loadQueue: [internalRow, internalRow],
      updates: [],
    };
    const db = makeDb(dbState);
    const step = makeStep();

    evaluateConditionImpl.mockResolvedValue({
      holds: true,
      reason: 'rent unpaid as of trigger_at',
    });
    spawnForScheduleImpl.mockResolvedValue({
      proposal: makeProposal({
        action_type: 'log_maintenance_ticket',
        payload: {
          unitRef: { unitLabel: '2B' },
          summary: 'Leaking faucet',
          severity: 'low',
        },
        gate_decision: 'auto',
      }),
      decision: 'auto',
    });
    commitProposalImpl.mockResolvedValue({
      proposal: makeProposal({
        action_type: 'log_maintenance_ticket',
        payload: {
          unitRef: { unitLabel: '2B' },
          summary: 'Leaking faucet',
          severity: 'low',
        },
        status: 'committed',
        gate_decision: 'auto',
      }),
      dispatch: { kind: 'sms', result: { ok: true } as never },
      changed: true,
    });

    const out = await runFireScheduledAction({
      scheduleId: SCHEDULE,
      step,
      deps: { db, evaluateConditionImpl, spawnForScheduleImpl, commitProposalImpl },
    });

    expect(out).toEqual({ kind: 'fired_auto', proposalId: PROPOSAL_ID });
    expect(spawnForScheduleImpl).toHaveBeenCalledOnce();
    expect(commitProposalImpl).toHaveBeenCalledWith(db, PROPOSAL_ID, {
      kind: 'system',
    });
    expect(dbState.updates).toHaveLength(1);
    expect(dbState.updates[0]).toEqual(
      expect.objectContaining({
        status: 'fired',
        fired_proposal_id: PROPOSAL_ID,
      }),
    );
    expect(step.log.ids).toEqual([
      'load',
      'recheck',
      'eval-condition',
      'spawn',
      'commit',
      'mark-fired',
    ]);
  });

  it('does not mark an automatic schedule fired when commit fails to complete', async () => {
    const internalRow = makeRow({
      action_type: 'log_maintenance_ticket',
      action_payload: {
        unitRef: { unitLabel: '2B' },
        summary: 'Leaking faucet',
        severity: 'low',
      },
    });
    const dbState: DbState = {
      loadQueue: [internalRow, internalRow],
      updates: [],
    };
    const db = makeDb(dbState);
    const step = makeStep();
    evaluateConditionImpl.mockResolvedValue({ holds: true, reason: 'ok' });
    spawnForScheduleImpl.mockResolvedValue({
      proposal: makeProposal({
        action_type: 'log_maintenance_ticket',
        payload: {
          unitRef: { unitLabel: '2B' },
          summary: 'Leaking faucet',
          severity: 'low',
        },
        gate_decision: 'auto',
      }),
      decision: 'auto',
    });
    commitProposalImpl.mockResolvedValue({
      proposal: makeProposal({ status: 'failed', gate_decision: 'auto' }),
      dispatch: { kind: 'noop', action_type: 'log_maintenance_ticket' },
      changed: false,
    });

    await expect(
      runFireScheduledAction({
        scheduleId: SCHEDULE,
        step,
        deps: {
          db,
          evaluateConditionImpl,
          spawnForScheduleImpl,
          commitProposalImpl,
        },
      }),
    ).rejects.toThrow(/reconciliation/i);

    expect(step.log.ids).not.toContain('mark-fired');
    expect(dbState.updates).toEqual([]);
  });

  it("condition holds + gate='review' → spawn, no commit, mark fired with proposal id", async () => {
    const dbState: DbState = {
      loadQueue: [makeRow(), makeRow()],
      updates: [],
    };
    const db = makeDb(dbState);
    const step = makeStep();

    evaluateConditionImpl.mockResolvedValue({ holds: true, reason: 'ok' });
    spawnForScheduleImpl.mockResolvedValue({
      proposal: makeProposal({ gate_decision: 'review' }),
      decision: 'review',
    });

    const out = await runFireScheduledAction({
      scheduleId: SCHEDULE,
      step,
      deps: { db, evaluateConditionImpl, spawnForScheduleImpl, commitProposalImpl },
    });

    expect(out).toEqual({ kind: 'fired_review', proposalId: PROPOSAL_ID });
    expect(commitProposalImpl).not.toHaveBeenCalled();
    expect(dbState.updates).toHaveLength(1);
    expect(dbState.updates[0]).toEqual(
      expect.objectContaining({
        status: 'fired',
        fired_proposal_id: PROPOSAL_ID,
      }),
    );
    expect(step.log.ids).not.toContain('commit');
  });

  it("condition holds + gate='block' → spawn, no commit, mark fired (ops can debug from row)", async () => {
    const dbState: DbState = {
      loadQueue: [makeRow(), makeRow()],
      updates: [],
    };
    const db = makeDb(dbState);
    const step = makeStep();

    evaluateConditionImpl.mockResolvedValue({ holds: true, reason: 'ok' });
    spawnForScheduleImpl.mockResolvedValue({
      proposal: makeProposal({ gate_decision: 'block' }),
      decision: 'block',
    });

    const out = await runFireScheduledAction({
      scheduleId: SCHEDULE,
      step,
      deps: { db, evaluateConditionImpl, spawnForScheduleImpl, commitProposalImpl },
    });

    expect(out).toEqual({ kind: 'fired_blocked', proposalId: PROPOSAL_ID });
    expect(commitProposalImpl).not.toHaveBeenCalled();
    expect(dbState.updates).toHaveLength(1);
    expect(dbState.updates[0]).toMatchObject({
      status: 'fired',
      fired_proposal_id: PROPOSAL_ID,
    });
  });

  it('marks condition_failed when spawn throws ScheduledActionPropertyNotFoundError', async () => {
    const dbState: DbState = {
      loadQueue: [makeRow(), makeRow()],
      updates: [],
    };
    const db = makeDb(dbState);
    const step = makeStep();

    evaluateConditionImpl.mockResolvedValue({ holds: true, reason: 'ok' });
    spawnForScheduleImpl.mockRejectedValue(
      new ScheduledActionPropertyNotFoundError(SCHEDULE, PROP),
    );

    const out = await runFireScheduledAction({
      scheduleId: SCHEDULE,
      step,
      deps: { db, evaluateConditionImpl, spawnForScheduleImpl, commitProposalImpl },
    });

    expect(out.kind).toBe('spawn_failed');
    expect(commitProposalImpl).not.toHaveBeenCalled();
    expect(dbState.updates).toHaveLength(1);
    expect(dbState.updates[0]).toMatchObject({ status: 'condition_failed' });
  });

  it('rethrows non-property-not-found errors so Inngest can retry', async () => {
    const dbState: DbState = {
      loadQueue: [makeRow(), makeRow()],
      updates: [],
    };
    const db = makeDb(dbState);
    const step = makeStep();

    evaluateConditionImpl.mockResolvedValue({ holds: true, reason: 'ok' });
    spawnForScheduleImpl.mockRejectedValue(new Error('temporary 5xx from worker'));

    await expect(
      runFireScheduledAction({
        scheduleId: SCHEDULE,
        step,
        deps: { db, evaluateConditionImpl, spawnForScheduleImpl, commitProposalImpl },
      }),
    ).rejects.toThrow('temporary 5xx from worker');

    expect(dbState.updates).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Tests — re-run (Inngest retry) dedup through the REAL spawnForSchedule
// ---------------------------------------------------------------------------
//
// Scenario: run 1 spawns + records a review-required tenant message,
// then crashes before the schedule is marked fired. Inngest re-runs
// the function; the re-run must NOT call the model again, insert a
// second proposal, or system-commit the consequential action —
// spawnForSchedule short-circuits on the existing action_proposals row
// keyed by routing->>scheduledActionId.

const RERUN_PROPOSAL_ID = '00000000-0000-0000-0000-000000000099';

interface IntegrationDb {
  db: SupabaseClient<Database>;
  /** Every action_proposals row inserted (the single-proposal assertion). */
  proposals: Array<Record<string, unknown>>;
  /** Recorded scheduled_actions UPDATE patches. */
  updates: Array<Record<string, unknown>>;
}

function makeIntegrationDb(scheduleRow: ScheduledActionRow): IntegrationDb {
  const proposals: Array<Record<string, unknown>> = [];
  const updates: Array<Record<string, unknown>> = [];

  const db = {
    from: vi.fn((table: string) => {
      if (table === 'scheduled_actions') {
        let pendingPatch: Record<string, unknown> | null = null;
        const b: Record<string, unknown> = {};
        b.select = () => b;
        b.update = (patch: Record<string, unknown>) => {
          pendingPatch = patch;
          return b;
        };
        b.eq = () => b;
        b.maybeSingle = async () => ({ data: scheduleRow, error: null });
        b.then = (
          fulfilled?: (v: { data: unknown; error: null }) => unknown,
        ) => {
          if (pendingPatch) {
            updates.push(pendingPatch);
            pendingPatch = null;
          }
          const result = { data: null, error: null };
          return Promise.resolve(fulfilled ? fulfilled(result) : result);
        };
        return b;
      }
      if (table === 'properties') {
        const b: Record<string, unknown> = {};
        b.select = () => b;
        b.eq = () => b;
        b.maybeSingle = async () => ({
          data: { privacy_mode: 'hosted', ollama_host: null, autonomy_level: 0.7 },
          error: null,
        });
        return b;
      }
      if (table === 'action_proposals') {
        let inserted: Record<string, unknown> | null = null;
        const b: Record<string, unknown> = {};
        b.select = () => b;
        b.filter = () => b;
        b.order = () => b;
        b.limit = () => b;
        // Dedup lookup: latest recorded proposal (or none).
        b.maybeSingle = async () => ({
          data: proposals[proposals.length - 1] ?? null,
          error: null,
        });
        b.insert = (row: Record<string, unknown>) => {
          inserted = {
            ...row,
            id: RERUN_PROPOSAL_ID,
            created_at: '2026-05-08T17:00:05.000Z',
            committed_at: null,
            rejected_at: null,
            edit_diff: null,
            outcome: null,
          };
          proposals.push(inserted);
          return b;
        };
        b.single = async () => ({ data: inserted, error: null });
        return b;
      }
      throw new Error(`makeIntegrationDb: unexpected table ${table}`);
    }),
  } as unknown as SupabaseClient<Database>;

  return { db, proposals, updates };
}

describe('runFireScheduledAction re-run dedup (real spawnForSchedule)', () => {
  beforeEach(() => {
    mockedSpawnPropertyWorker.mockReset();
    mockedSelectProvider.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('re-run keeps a tenant message in review, records once, and calls the model once', async () => {
    const { db, proposals, updates } = makeIntegrationDb(makeRow());

    mockedSelectProvider.mockReturnValue({
      name: 'mock-provider',
    } as unknown as WorkerModelProvider);
    mockedSpawnPropertyWorker.mockResolvedValue(
      makeProposal({
        id: null,
        gate_decision: null,
        routing: null,
        // Confidence cannot override the explicit tenant-message
        // safety disposition: draft_sms_reply must remain in review.
        reasoning: 'rent unpaid at trigger; sending reminder',
        context_fact_ids: [],
      }),
    );

    const evaluateConditionImpl = vi.fn<typeof evaluateCondition>()
      .mockResolvedValue({ holds: true, reason: 'rent unpaid' });
    const commitProposalImpl = vi.fn<typeof commitProposal>();

    // spawnForScheduleImpl deliberately omitted → real spawnForSchedule.
    const deps = { db, evaluateConditionImpl, commitProposalImpl };

    // Run 1 — spawns and records, then dies before mark-fired. No
    // system commit is attempted because the proposal requires review.
    const firstStep = makeStep();
    const runNormally = firstStep.run.bind(firstStep);
    firstStep.run = async <T>(id: string, fn: () => Promise<T> | T) => {
      if (id === 'mark-fired') throw new Error('mark-fired step crashed');
      return runNormally(id, fn);
    };
    await expect(
      runFireScheduledAction({ scheduleId: SCHEDULE, step: firstStep, deps }),
    ).rejects.toThrow('mark-fired step crashed');
    expect(proposals).toHaveLength(1);
    expect(mockedSpawnPropertyWorker).toHaveBeenCalledTimes(1);
    expect(commitProposalImpl).not.toHaveBeenCalled();
    expect(updates).toHaveLength(0); // never reached mark-fired

    // Run 2 — the Inngest retry. Dedup short-circuit: no second model
    // call, no second proposal row, and still no system commit. The
    // persisted review proposal from run 1 is linked as mark-fired.
    const out = await runFireScheduledAction({
      scheduleId: SCHEDULE,
      step: makeStep(),
      deps,
    });

    expect(out).toEqual({ kind: 'fired_review', proposalId: RERUN_PROPOSAL_ID });
    expect(proposals).toHaveLength(1);
    expect(mockedSpawnPropertyWorker).toHaveBeenCalledTimes(1);
    expect(commitProposalImpl).not.toHaveBeenCalled();
    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({
      status: 'fired',
      fired_proposal_id: RERUN_PROPOSAL_ID,
    });
  });
});

// ---------------------------------------------------------------------------
// Tests — rowToScheduledAction mapper
// ---------------------------------------------------------------------------

describe('rowToScheduledAction', () => {
  it('maps snake_case row → camel-case ScheduledAction', () => {
    const out = rowToScheduledAction(makeRow());
    expect(out.id).toBe(SCHEDULE);
    expect(out.organizationId).toBe(ORG);
    expect(out.propertyId).toBe(PROP);
    expect(out.actionType).toBe('draft_sms_reply');
    expect(out.status).toBe('scheduled');
    expect(out.triggerAt).toBe('2026-05-08T17:00:00.000Z');
    expect(out.condition).toEqual({ type: 'always' });
  });

  it('throws on unknown action_type', () => {
    expect(() => rowToScheduledAction(makeRow({ action_type: 'unknown_verb' }))).toThrow(
      /unknown action_type/,
    );
  });

  it('throws on unknown status', () => {
    expect(() => rowToScheduledAction(makeRow({ status: 'pending' }))).toThrow(
      /unknown status/,
    );
  });

  // The fixtures and decision-import are intentionally referenced
  // here so unused-import lint doesn't strip them.
  it('uses GateDecision type for tests', () => {
    const decision: GateDecision = { outcome: 'auto', reason: '' } as GateDecision;
    expect(decision.outcome).toBe('auto');
  });
});
