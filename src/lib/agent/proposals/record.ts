/**
 * Persist an `ActionProposal` produced by a property worker.
 *
 * Flow:
 *   1. Caller (spawn.ts) hands us the worker's `PropertyWorkerOutput`
 *      plus the property + worker_model identifier.
 *   2. We call `gateProposal()` to compute the gate decision against
 *      the property's current autonomy + privacy mode.
 *   3. We INSERT into `action_proposals` with `status='proposed'` and
 *      the gate decision stamped.
 *   4. Caller receives the persisted row's id (uuid) plus the
 *      decision so it can either dispatch immediately (auto) or queue
 *      for review.
 *
 * We touch Supabase here, but do NOT execute the proposal's side
 * effect — that lives in `commit.ts`. Splitting record/commit is what
 * lets the gate hold a proposal in `proposed` state while the owner
 * reviews it without losing the audit trail.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Json } from '@/types/database';

import {
  WORKER_ACTION_TYPES,
  type ActionProposal,
  type ContextFact,
  type ProposalRouting,
  type WorkerActionType,
  type WorkerActionPayload,
} from '@/lib/agent/worker/types';
import {
  gateProposal,
  type GateDecision,
  type GateOutcome,
  type PrivacyMode,
} from '@/lib/agent/worker/commit-gate';

// Source-of-truth row shape from the generated Database type. Keeps
// us in sync with migrations-eng without re-declaring columns. The
// regenerated database.ts (post-`6bd7ef6`) now carries action_proposals
// fully — we just alias here for terseness in mapper signatures.
export type ProposalRow = Database['public']['Tables']['action_proposals']['Row'];

// ---------------------------------------------------------------------------
// Public input shape
// ---------------------------------------------------------------------------

export interface RecordProposalInput {
  organizationId: string;
  propertyId: string;
  /** Identifier of the model that produced the output (e.g. 'haiku-4-5'). */
  workerModel: string;
  /** Action verb the worker chose. */
  actionType: WorkerActionType;
  /** Per-action payload — schema-validated upstream in spawn.ts. */
  payload: WorkerActionPayload;
  reasoning: string;
  /** 0..1, supplied by the worker. */
  confidence: number;
  /** memory_facts.id values that informed this proposal. */
  contextFactIds: ReadonlyArray<string>;
  /** Read off the property row at spawn time. */
  autonomyLevel: number;
  /** Read off the property row at spawn time. */
  privacyMode: PrivacyMode;
  /**
   * Active memory_facts the worker had loaded when generating this
   * proposal. Optional — passed through to gateProposal's citation
   * validator so reasoning that name-mentions a fact-shaped claim must
   * cite a real fact (or get routed to review under
   * ODESA_CITATION_ENFORCEMENT). Callers that don't have the fact set
   * in scope can omit — the validator still runs (defaulting to an
   * empty fact set), so every record path gets shadow validation, not
   * just the operator path. `validateCitations` only reads reasoning +
   * cited ids today; fact contents are forward-compat (see types.ts).
   */
  contextFacts?: ReadonlyArray<ContextFact>;
  /**
   * Deterministic safety override (Phase A4 — numeric grounding). When
   * present, a gate outcome of 'auto' is demoted to 'review' with the
   * given reason recorded in the gate reasoning. 'review' and 'block'
   * outcomes are unchanged — this can only tighten, never loosen, and
   * never escalates to 'block'.
   */
  forceReview?: { reason: string };
  /**
   * Ambient orchestrator routing context (tenantId, conversationId,
   * workOrderId, vendorId, weeklyReportId) the call site already
   * resolved before spawning the worker. Pass `null` for action_types
   * that don't dispatch a side effect from commit (classify_intent,
   * confirm_emergency, update_rulebook). Stored as a sibling of
   * `payload` so model output stays audit-pure — privacy-mode
   * invariant: tenant UUIDs never round-trip through model output.
   */
  routing: ProposalRouting | null;
  /** Durable provider-origin key; unique when supplied. */
  retellArtifactKey?: string | null;
}

export interface RecordProposalResult {
  proposal: ActionProposal;
  decision: GateDecision;
}

// ---------------------------------------------------------------------------
// recordProposal
// ---------------------------------------------------------------------------

/**
 * Insert a fresh proposal into `action_proposals`, gated.
 *
 * Returns the persisted `ActionProposal` (with `id` filled) and the
 * `GateDecision`. Callers (`commit.ts` for auto, the drafts-queue UI
 * for review) consume both.
 *
 * Throws if the insert fails so the worker pipeline fails loud rather
 * than returning a half-persisted proposal. The caller is expected to
 * surface this as a user-facing error and emit a Sentry breadcrumb.
 */
export async function recordProposal(
  db: SupabaseClient<Database>,
  input: RecordProposalInput,
): Promise<RecordProposalResult> {
  // Citation input is built UNCONDITIONALLY (contextFacts defaults to
  // []) so the shadow validator runs on every record path — tenant-SMS
  // (claude-draft.ts) and scheduled (spawn-for-schedule.ts) included,
  // not just the operator path (mcps/spawn.ts) that has real facts in
  // scope. `payload` rides along so the gate can exempt safe-listed
  // classify_intent results (commit-gate's intent safe list).
  const gateDecision = gateProposal(
    {
      action_type: input.actionType,
      confidence: input.confidence,
      payload: input.payload,
    },
    input.autonomyLevel,
    input.privacyMode,
    {
      reasoning: input.reasoning,
      contextFactIds: input.contextFactIds,
      contextFacts: input.contextFacts ?? [],
    },
  );
  const decision = applyForceReview(gateDecision, input.forceReview);

  // Build the insert row. `routing` is included via an `unknown` cast
  // on the assembled object because the regenerated database.ts type
  // for `action_proposals` doesn't surface the `routing` JSONB column
  // until migrations-eng's task #12 lands. The runtime column either
  // exists (and the insert succeeds) or doesn't (and Postgres errors
  // with a clear "column does not exist" message that points at the
  // pending migration). Either path is safe — we never silently drop.
  const insertRow = {
    organization_id: input.organizationId,
    property_id: input.propertyId,
    worker_model: input.workerModel,
    action_type: input.actionType,
    // Closed WorkerActionPayload union → open Json (postgres JSONB).
    // `unknown` bridge is required and intentional: TS won't accept
    // a discriminated union as an arbitrary recursive Json shape
    // without it. spawn.ts has already validated `input.payload`
    // against the per-action zod schema, so the value is safe.
    payload: input.payload as unknown as Json,
    reasoning: input.reasoning,
    confidence: input.confidence,
    context_fact_ids:
      input.contextFactIds.length > 0 ? [...input.contextFactIds] : null,
    gate_decision: decision.outcome,
    status: 'proposed',
    routing: input.routing as unknown as Json,
    retell_artifact_key: input.retellArtifactKey ?? null,
  };

  const { data, error } = await db
    .from('action_proposals')
    .insert(insertRow as Database['public']['Tables']['action_proposals']['Insert'])
    .select()
    .single();

  if (error || !data) {
    throw new ProposalRecordError(
      `failed to insert action_proposal: ${error?.message ?? 'no row returned'}`,
      error ?? null,
    );
  }

  return {
    decision,
    proposal: rowToActionProposal(data, input.payload),
  };
}

/**
 * Apply the caller's `forceReview` override to a gate decision.
 *
 * Pure function. Demotes 'auto' to 'review' only — a 'review' or
 * 'block' outcome passes through untouched (the override can tighten,
 * never loosen, and never escalates to 'block'). The forced reason is
 * recorded in the decision reasoning alongside the base reason so the
 * proposals UI shows why an otherwise-auto proposal parked for review.
 */
function applyForceReview(
  decision: GateDecision,
  forceReview: RecordProposalInput['forceReview'],
): GateDecision {
  if (!forceReview || decision.outcome !== 'auto') return decision;
  return {
    outcome: 'review',
    reason: `forced review: ${forceReview.reason} (base: ${decision.reason})`,
    appliedThreshold: decision.appliedThreshold,
  };
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class ProposalRecordError extends Error {
  readonly cause: unknown;

  constructor(message: string, cause: unknown) {
    super(message);
    this.name = 'ProposalRecordError';
    this.cause = cause;
  }
}

// ---------------------------------------------------------------------------
// Mapper — DB row → ActionProposal in worker types
// ---------------------------------------------------------------------------
//
// Exported for use in `outcome.ts` / `commit.ts` / tests. The mapper is
// total over the Row shape: any string outside the action_type /
// status enums will throw because we mirror the SQL CHECK
// constraints in the type system.

export function rowToActionProposal(
  row: ProposalRow,
  /**
   * Optional override for the strongly-typed payload, used when the
   * caller already holds the validated `WorkerActionPayload` (saving
   * a round-trip through `Json` casting). When omitted, the row's
   * `payload` is cast through `unknown` since it has been validated
   * upstream by the per-action zod schema.
   */
  payloadOverride?: WorkerActionPayload,
): ActionProposal {
  // `routing` is read off the row through an `unknown` cast because
  // the regen Database type for `action_proposals` doesn't surface
  // the `routing` JSONB column until migrations-eng's task #12 lands.
  // Once it does, this can become `row.routing` directly. Treat
  // `undefined` (key absent on test fixtures or pre-migration rows)
  // and `null` (column NULL on a real row) the same way.
  const rawRouting = (row as unknown as { routing?: Json | null }).routing;
  const routing =
    rawRouting == null ? null : (rawRouting as unknown as ProposalRouting);
  const editDiff = (row as unknown as { edit_diff?: Json | null }).edit_diff;

  return {
    id: row.id,
    organizationId: row.organization_id,
    propertyId: row.property_id,
    workerModel: row.worker_model,
    action_type: assertWorkerActionType(row.action_type),
    payload:
      payloadOverride ?? (row.payload as unknown as WorkerActionPayload),
    editDiff: editDiff ?? null,
    reasoning: row.reasoning,
    confidence: row.confidence,
    context_fact_ids: row.context_fact_ids ?? [],
    gate_decision: assertGateOutcome(row.gate_decision),
    status: assertStatus(row.status),
    createdAt: row.created_at,
    routing,
  };
}

// Single source of truth: the action_type union from worker/types.ts.
// Keeping the validator wired to that constant means a new action_type
// added to the union is immediately accepted at the persistence
// boundary — no dual-write to a local list to maintain.
const VALID_ACTION_TYPES: ReadonlySet<WorkerActionType> = new Set<WorkerActionType>(
  WORKER_ACTION_TYPES,
);

function assertWorkerActionType(v: string): WorkerActionType {
  if (!VALID_ACTION_TYPES.has(v as WorkerActionType)) {
    throw new ProposalRecordError(
      `unknown action_type "${v}" returned from action_proposals`,
      null,
    );
  }
  return v as WorkerActionType;
}

const VALID_GATE_OUTCOMES: ReadonlySet<GateOutcome> = new Set([
  'auto',
  'review',
  'block',
]);

function assertGateOutcome(v: string): GateOutcome {
  if (!VALID_GATE_OUTCOMES.has(v as GateOutcome)) {
    throw new ProposalRecordError(
      `unknown gate_decision "${v}" returned from action_proposals`,
      null,
    );
  }
  return v as GateOutcome;
}

const VALID_STATUSES: ReadonlySet<ActionProposal['status']> = new Set([
  'proposed',
  'committing',
  'committed',
  'failed',
  'unsupported',
  'rejected',
  'edited',
  'expired',
]);

function assertStatus(v: string): ActionProposal['status'] {
  if (!VALID_STATUSES.has(v as ActionProposal['status'])) {
    throw new ProposalRecordError(
      `unknown status "${v}" returned from action_proposals`,
      null,
    );
  }
  return v as ActionProposal['status'];
}
