/**
 * Record the outcome of a proposal — closing the loop on the trust
 * graduation cycle.
 *
 * `recordOutcome(db, proposalId, outcome)`:
 *   1. Loads the proposal (we need gate_decision + property_id +
 *      organization_id to graduate trust correctly).
 *   2. Updates `action_proposals.outcome` JSONB and `status` to match
 *      the outcome kind (committed / rejected / edited / expired).
 *      For `edited`, also stamps `edit_diff` with the structural
 *      delta the caller provides.
 *   3. Calls `graduateAutonomy()` against the property's CURRENT
 *      autonomy_level and persists the new value to `properties`.
 *   4. Fires the memory-extract hook (`extractFactsFromOutcome`)
 *      fire-and-forget — the reflection loop will rerun nightly so a
 *      missed extraction is not load-bearing here, but doing it
 *      synchronously gives us a cheap immediate signal in the worker
 *      tests.
 *
 * Memory-extract hook integration: the memory module exposes
 * `extractFactsFromOutcome(input)` from `@/lib/agent/memory/extract`.
 * As of this writing memory-eng has the extractor stubbed, so we
 * defensively guard the import via a dependency override (see the
 * `memoryHook` parameter on `recordOutcome`). When memory-eng's
 * extract.ts lands, the default is wired by the integration layer
 * (task #8) without touching this module's public surface.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Json } from '@/types/database';

import type { ActionProposal } from '@/lib/agent/worker/types';
import {
  graduateAutonomy,
  resolveOutcomeKind,
  type GraduateAutonomyResult,
  type ProposalOutcomeKind,
} from '@/lib/agent/worker/trust';
import { rowToActionProposal } from './record';

// ---------------------------------------------------------------------------
// Public input
// ---------------------------------------------------------------------------

export type RecordOutcomeKind =
  | { kind: 'committed' }
  | { kind: 'rejected'; reason?: string }
  | { kind: 'edited'; editDiff: Record<string, unknown> }
  | { kind: 'expired' };

export interface RecordOutcomeInput {
  proposalId: string;
  outcome: RecordOutcomeKind;
  /**
   * Optional structured outcome metadata persisted to
   * `action_proposals.outcome` JSONB. Use for things the reflection
   * loop will mine ("tenant replied with thanks", "vendor declined").
   */
  outcomeMeta?: Record<string, unknown>;
}

export interface RecordOutcomeResult {
  proposal: ActionProposal;
  graduation: GraduateAutonomyResult;
  outcomeKind: ProposalOutcomeKind;
  /** True iff `properties.autonomy_level` was updated by this call. */
  autonomyPersisted: boolean;
}

// ---------------------------------------------------------------------------
// Memory hook — pluggable so tests + integration phases can wire it
// without this module hard-importing memory/* (which is owned by
// memory-eng on a parallel track).
// ---------------------------------------------------------------------------

export interface MemoryExtractInput {
  proposal: ActionProposal;
  outcome: RecordOutcomeKind;
  outcomeMeta: Record<string, unknown>;
}

/**
 * Fire-and-forget hook. Implementations write into `memory_facts`.
 * The default is a no-op so this module is decoupled from memory-eng
 * during parallel development. Task #8 (integration) wires the real
 * hook (`extractFactsFromOutcome` from `@/lib/agent/memory/extract`).
 */
export type MemoryExtractHook = (
  db: SupabaseClient<Database>,
  input: MemoryExtractInput,
) => Promise<void>;

const NOOP_MEMORY_HOOK: MemoryExtractHook = async () => {
  /* default — wired by integration phase */
};

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class OutcomeRecordError extends Error {
  readonly cause: unknown;

  constructor(message: string, cause: unknown) {
    super(message);
    this.name = 'OutcomeRecordError';
    this.cause = cause;
  }
}

export class OutcomeProposalNotFoundError extends OutcomeRecordError {
  constructor(proposalId: string) {
    super(`proposal ${proposalId} not found while recording outcome`, null);
    this.name = 'OutcomeProposalNotFoundError';
  }
}

// ---------------------------------------------------------------------------
// recordOutcome
// ---------------------------------------------------------------------------

/**
 * Persist the outcome and graduate autonomy in one logical step.
 *
 * The two updates (action_proposals + properties) are NOT wrapped in
 * a SQL transaction here — Supabase's PostgREST surface doesn't
 * expose explicit transactions. Instead we order them so a partial
 * failure mode is recoverable: outcome persists first; autonomy
 * second. If autonomy update fails, the next outcome on the same
 * property will still graduate from the latest persisted level. We
 * surface either failure as `OutcomeRecordError` so the caller can
 * decide whether to retry.
 */
export async function recordOutcome(
  db: SupabaseClient<Database>,
  input: RecordOutcomeInput,
  memoryHook: MemoryExtractHook = NOOP_MEMORY_HOOK,
): Promise<RecordOutcomeResult> {
  const proposal = await loadProposalForOutcome(db, input.proposalId);

  // Blocked proposals never had a side effect; there is no observation
  // worth persisting and no signal to graduate trust against. Refuse
  // outright rather than synthesize a fake 'auto' outcome (which would
  // contaminate the trust curve). Caller should not be reaching here
  // for blocked rows in the first place.
  if (proposal.gate_decision === 'block') {
    throw new OutcomeRecordError(
      `proposal ${proposal.id} was blocked at the gate — no outcome to record`,
      null,
    );
  }

  // proposal.gate_decision is typed nullable because pre-persist
  // proposals carry null. Persisted rows always have a value (NOT
  // NULL CHECK). After ruling out 'block' above, the remaining union
  // is 'auto' | 'review' | null — null is impossible for loaded rows
  // so we narrow with a runtime guard for safety.
  const persistedDecision = proposal.gate_decision;
  if (persistedDecision === null) {
    throw new OutcomeRecordError(
      `proposal ${proposal.id} has null gate_decision — corrupted row`,
      null,
    );
  }

  // Outcomes are decisions on a pending proposal, not a general status
  // rewrite primitive. In particular, a late reject must never overwrite a
  // committed/failed proposal after its side effect or reconciliation record.
  if (proposal.status !== 'proposed') {
    throw new OutcomeRecordError(
      `proposal ${proposal.id} is no longer pending (status=${proposal.status})`,
      null,
    );
  }

  const updated = await persistOutcome(db, proposal, input);
  const outcomeKind = resolveOutcomeKind(
    persistedDecision,
    statusForOutcome(input.outcome.kind),
  );

  const graduation = await graduateAndPersistAutonomy(
    db,
    proposal.propertyId,
    proposal.organizationId,
    outcomeKind,
  );

  // Fire-and-forget the memory extract. We await but swallow errors
  // so a flaky memory write does not roll back the outcome record.
  // Reflection (nightly) will catch up on misses.
  try {
    await memoryHook(db, {
      proposal: updated,
      outcome: input.outcome,
      outcomeMeta: input.outcomeMeta ?? {},
    });
  } catch {
    // intentionally swallowed; nightly reflection backstops this.
  }

  return {
    proposal: updated,
    graduation,
    outcomeKind,
    autonomyPersisted: graduation.delta !== 0,
  };
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

async function loadProposalForOutcome(
  db: SupabaseClient<Database>,
  proposalId: string,
): Promise<ActionProposal> {
  const { data, error } = await db
    .from('action_proposals')
    .select()
    .eq('id', proposalId)
    .maybeSingle();
  if (error) {
    throw new OutcomeRecordError(
      `failed to load proposal ${proposalId}: ${error.message}`,
      error,
    );
  }
  if (!data) throw new OutcomeProposalNotFoundError(proposalId);
  return rowToActionProposal(data);
}

async function persistOutcome(
  db: SupabaseClient<Database>,
  proposal: ActionProposal,
  input: RecordOutcomeInput,
): Promise<ActionProposal> {
  const now = new Date().toISOString();
  const update: {
    status: 'committed' | 'rejected' | 'edited' | 'expired';
    outcome: Json;
    committed_at?: string;
    rejected_at?: string;
    edit_diff?: Json;
  } = {
    status: statusForOutcome(input.outcome.kind),
    // Closed RecordOutcomeKind + outcomeMeta object → open Json
    // (postgres JSONB column). The `unknown` bridge is required and
    // intentional: TS will not accept a structurally-typed object
    // literal as the recursive `Json` union without it. The outcome
    // shape is internally constructed here, not user-supplied, so
    // it's safe at this boundary.
    outcome: ({
      kind: input.outcome.kind,
      ...(input.outcome.kind === 'rejected' && input.outcome.reason
        ? { reason: input.outcome.reason }
        : {}),
      ...(input.outcomeMeta ?? {}),
    } as unknown) as Json,
  };

  if (input.outcome.kind === 'committed') {
    update.committed_at = now;
  } else if (input.outcome.kind === 'rejected') {
    update.rejected_at = now;
  } else if (input.outcome.kind === 'edited') {
    // Same Json bridge as above: edit_diff is caller-supplied
    // structured data destined for an open JSONB column.
    update.edit_diff = input.outcome.editDiff as unknown as Json;
  }

  const { data, error } = await db
    .from('action_proposals')
    .update(update)
    .eq('id', proposal.id ?? '')
    // Optimistic concurrency boundary: an approve/reject race must not let
    // this outcome overwrite `committing` or `committed` after a side effect.
    .eq('status', proposal.status)
    .select()
    .maybeSingle();

  if (error || !data) {
    throw new OutcomeRecordError(
      `failed to update outcome for ${proposal.id}: ${error?.message ?? 'proposal changed while being decided'}`,
      error ?? null,
    );
  }
  return rowToActionProposal(data);
}

function statusForOutcome(
  kind: RecordOutcomeKind['kind'],
): 'committed' | 'rejected' | 'edited' | 'expired' {
  return kind;
}

async function graduateAndPersistAutonomy(
  db: SupabaseClient<Database>,
  propertyId: string,
  organizationId: string,
  outcomeKind: ProposalOutcomeKind,
): Promise<GraduateAutonomyResult> {
  const { data: prop, error: loadErr } = await db
    .from('properties')
    .select('autonomy_level')
    .eq('id', propertyId)
    .eq('organization_id', organizationId)
    .maybeSingle();

  if (loadErr) {
    throw new OutcomeRecordError(
      `failed to load autonomy_level for property ${propertyId}: ${loadErr.message}`,
      loadErr,
    );
  }
  if (!prop) {
    throw new OutcomeRecordError(
      `property ${propertyId} not found while graduating autonomy`,
      null,
    );
  }

  const result = graduateAutonomy(prop.autonomy_level, outcomeKind);

  if (result.delta === 0) {
    return result;
  }

  const { error: updErr } = await db
    .from('properties')
    .update({ autonomy_level: result.next })
    .eq('id', propertyId)
    .eq('organization_id', organizationId);

  if (updErr) {
    throw new OutcomeRecordError(
      `failed to persist autonomy_level for property ${propertyId}: ${updErr.message}`,
      updErr,
    );
  }
  return result;
}
