/**
 * Execute a proposed action — the side-effect layer of the proposals
 * pipeline.
 *
 * `commitProposal(db, proposalId, actor)`:
 *   1. Loads the proposal row.
 *   1b. Role-gates USER actors and refuses system commits for every explicit
 *      human-review disposition BEFORE the claim.
 *   2. Verifies status='proposed' (idempotency: a second call no-ops)
 *      and refuses gate_decision='block'.
 *   3. CAS-claims the row 'proposed' → 'committing' via a conditional
 *      UPDATE — exactly one concurrent committer wins; losers take the
 *      idempotent no-op path.
 *   4. Dispatches the action_type to the right side-effect helper:
 *        - draft_sms_reply  → notifyTenant() in src/lib/messaging/notify.ts
 *        - polish_briefing  → write to weekly_reports.briefing_text
 *        - everything else  → no-op (caller takes downstream action)
 *   5. Updates status='committed' and stamps committed_at on success.
 *      If dispatch THROWS the row stays at 'committing' (fail closed:
 *      we can't know whether the send fired — stuck rows are flagged
 *      for reconciliation, never blind-retried). Explicit dispatch
 *      failures persist as failed/unsupported evidence, never success.
 *
 * IMPORTANT: This module re-checks the stored gate and the current explicit
 * safety disposition. A stale/mistaken `gate_decision='auto'` can therefore
 * never let a system actor commit a tenant, money, lease, vendor, calendar,
 * archival, or policy action.
 *
 * No autonomy graduation happens here. That belongs in `outcome.ts`,
 * which fires after the side effect has either succeeded or been
 * confirmed by the recipient (e.g. tenant replied). Commit + outcome
 * are intentionally split so we can emit auto-commit telemetry before
 * we know the tenant's response.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';

import type {
  ActionProposal,
  DraftSmsReplyPayload,
  PolishBriefingPayload,
  WorkerActionPayload,
  WorkerActionType,
} from '@/lib/agent/worker/types';
import { WORKER_PAYLOAD_SCHEMAS } from '@/lib/agent/worker/types';
import { requiresHumanReview } from '@/lib/agent/worker/commit-gate';
import {
  WORKER_HANDLERS,
  isHandlerAction,
  type HandlerActionType,
  type HandlerResult,
} from '@/lib/agent/worker/handlers';
import { rowToActionProposal } from './record';
import { notifyTenant, type NotifyResult } from '@/lib/messaging/notify';
import {
  commitActorForbidden,
  FORBIDDEN_MESSAGE,
  type CommitActor,
} from '@/lib/authz/policy';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type CommitDispatch =
  | { kind: 'sms'; result: NotifyResult }
  | { kind: 'briefing'; weekStartDate: string; rowsAffected: number }
  | { kind: 'noop'; action_type: ActionProposal['action_type'] }
  | {
      kind: 'handler';
      action_type: HandlerActionType;
      result: HandlerResult;
    };

export interface CommitProposalResult {
  proposal: ActionProposal;
  dispatch: CommitDispatch;
  /** True iff this call moved status from 'proposed' to 'committed'. */
  changed: boolean;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class ProposalCommitError extends Error {
  readonly cause: unknown;

  constructor(message: string, cause: unknown) {
    super(message);
    this.name = 'ProposalCommitError';
    this.cause = cause;
  }
}

export class ProposalNotFoundError extends ProposalCommitError {
  constructor(proposalId: string) {
    super(`proposal ${proposalId} not found`, null);
    this.name = 'ProposalNotFoundError';
  }
}

export class ProposalBlockedError extends ProposalCommitError {
  constructor(proposalId: string) {
    super(`proposal ${proposalId} has gate_decision='block' and cannot commit`, null);
    this.name = 'ProposalBlockedError';
  }
}

export class ProposalReviewRequiredError extends ProposalCommitError {
  constructor(proposalId: string) {
    super(`proposal ${proposalId} requires explicit human review`, null);
    this.name = 'ProposalReviewRequiredError';
  }
}

export class ProposalMalformedEditError extends ProposalCommitError {
  constructor(proposalId: string) {
    super(
      `proposal ${proposalId} edit_diff.body_after must be a non-empty string of at most 2000 characters`,
      null,
    );
    this.name = 'ProposalMalformedEditError';
  }
}

/** Thrown when a user actor's role may not commit this action_type. */
export class ProposalForbiddenError extends ProposalCommitError {
  constructor() {
    super(FORBIDDEN_MESSAGE, null);
    this.name = 'ProposalForbiddenError';
  }
}

// ---------------------------------------------------------------------------
// commitProposal
// ---------------------------------------------------------------------------

/**
 * Optional commit-time hooks. Provided primarily for tests / call
 * sites that need to swap the briefing target row. Defaults wire to
 * the production helpers.
 */
export interface CommitProposalDeps {
  /** Override the SMS dispatch path (default: notifyTenant from notify.ts). */
  notifyTenantImpl?: typeof notifyTenant;
  /** When set, briefing text writes to weekly_reports row at this week_start_date. */
  briefingWeekStartDate?: string;
  /** Focused test seam; production uses WORKER_HANDLERS. */
  handlerImpl?: (args: {
    admin: SupabaseClient<Database>;
    organizationId: string;
    payload: unknown;
    proposalId?: string;
  }) => Promise<HandlerResult>;
}

export async function commitProposal(
  db: SupabaseClient<Database>,
  proposalId: string,
  actor: CommitActor,
  deps: CommitProposalDeps = {},
): Promise<CommitProposalResult> {
  const proposal = await loadProposal(db, proposalId);

  // An explicit owner-review disposition is owner-only at commit time. This
  // check is independent of the narrower capability map below so newly added
  // consequential actions cannot accidentally become manager-committable.
  // Keep it before the CAS claim and every side effect.
  if (
    actor.kind === 'user' &&
    requiresHumanReview(proposal.action_type) &&
    actor.role !== 'owner'
  ) {
    throw new ProposalForbiddenError();
  }

  // Role gate — BEFORE the claim and any side effect. User actors need the
  // sensitive capability for this action_type and fail closed on a
  // missing/unknown role. System actors face the disposition check below.
  if (commitActorForbidden(actor, proposal.action_type)) {
    throw new ProposalForbiddenError();
  }

  // Idempotency: if the proposal already moved past 'proposed', return
  // its current state and a noop dispatch. This makes commit safe to
  // retry from the cron / UI.
  if (proposal.status !== 'proposed') {
    return {
      proposal,
      dispatch: { kind: 'noop', action_type: proposal.action_type },
      changed: false,
    };
  }

  // Defense-in-depth: refuse blocked proposals BEFORE claiming so a
  // 'block' row can never even enter 'committing'.
  if (proposal.gate_decision === 'block') {
    throw new ProposalBlockedError(proposalId);
  }

  // A system actor is never a substitute for human confirmation. Check both
  // the persisted decision and today's policy so legacy/stale auto rows cannot
  // bypass review-first safety after a policy change.
  if (
    actor.kind === 'system' &&
    (proposal.gate_decision !== 'auto' ||
      requiresHumanReview(proposal.action_type))
  ) {
    throw new ProposalReviewRequiredError(proposalId);
  }

  // Validate an edited tenant-facing body before taking the CAS claim. A
  // malformed overlay never falls back to immutable model output.
  if (proposal.action_type === 'draft_sms_reply') {
    resolveSmsBody(proposal);
  }

  // CAS claim: 'proposed' → 'committing'. The conditional update is
  // the concurrency boundary — exactly one caller wins the row; a
  // concurrent committer (or a retry racing the first commit) gets no
  // row back and takes the idempotent no-op path below.
  const claimed = await claimProposal(db, proposalId);
  if (!claimed) {
    // Claim miss: someone else holds (or already finished) the
    // proposal. Re-load to preserve the idempotent no-op contract
    // (and ProposalNotFoundError when the row vanished).
    const current = await loadProposal(db, proposalId);
    return {
      proposal: current,
      dispatch: { kind: 'noop', action_type: current.action_type },
      changed: false,
    };
  }

  // If dispatchAction THROWS we deliberately leave the row at
  // 'committing' (fail closed): we cannot know whether the side
  // effect (e.g. the provider send) fired before the throw, so
  // reverting to 'proposed' could re-arm a double-send. Stuck
  // 'committing' rows are a first-class "needs reconciliation"
  // state — the watchdog flags them; never blind-retry.
  // notifyTenant returns ok:false for known failure/reconciliation states;
  // those are persisted below as failure evidence, never as committed.
  const dispatch = await dispatchAction(db, claimed, deps);
  const failure = dispatchFailure(dispatch);
  if (failure) {
    const updated = await markExecutionFailure(db, proposalId, claimed.payload, failure);
    return { proposal: updated, dispatch, changed: false };
  }
  const updated = await markCommitted(db, proposalId, claimed.payload);

  return {
    proposal: updated,
    dispatch,
    changed: true,
  };
}

function dispatchFailure(dispatch: CommitDispatch): {
  status: 'failed' | 'unsupported';
  retryable: boolean;
  evidence: Record<string, unknown>;
} | null {
  if (dispatch.kind === 'sms' && !dispatch.result.ok) {
    return {
      status: 'failed',
      // NotifyResult does not carry enough certainty to prove that a provider
      // side effect did not happen. Reconciliation must be explicit.
      retryable: false,
      evidence: {
        outcome: 'failed',
        action: 'draft_sms_reply',
        error: dispatch.result.error,
        conversation_id: dispatch.result.conversationId,
        message_id: dispatch.result.messageId,
      },
    };
  }
  if (dispatch.kind === 'briefing' && dispatch.rowsAffected < 1) {
    return {
      status: 'failed',
      retryable: false,
      evidence: {
        outcome: 'failed',
        action: 'polish_briefing',
        error: 'target_report_not_found',
      },
    };
  }
  if (dispatch.kind === 'handler' && !dispatch.result.ok) {
    const unsupported = dispatch.result.error === 'handler_not_implemented';
    return {
      status: unsupported ? 'unsupported' : 'failed',
      // Handler errors do not yet expose a definitive-no-side-effect contract.
      // Consequential handlers may have crossed a provider boundary before an
      // error surfaced, so never advertise a blind retry.
      retryable: false,
      evidence: {
        outcome: unsupported ? 'unsupported' : 'failed',
        action: dispatch.action_type,
        error: dispatch.result.error,
        confidence: dispatch.result.confidence,
      },
    };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Internal — dispatch by action_type
// ---------------------------------------------------------------------------

async function dispatchAction(
  db: SupabaseClient<Database>,
  proposal: ActionProposal,
  deps: CommitProposalDeps,
): Promise<CommitDispatch> {
  // Wave-6 write actions: validate via Zod, then defer to the
  // handler registry. Foundation ships stubs that return
  // `handler_not_implemented`; Stream B/C swap real handlers in.
  if (isHandlerAction(proposal.action_type)) {
    return dispatchHandler(db, proposal, deps);
  }

  switch (proposal.action_type) {
    case 'draft_sms_reply':
      return dispatchSms(db, proposal, deps);
    case 'polish_briefing':
      return dispatchBriefing(db, proposal, deps);
    case 'classify_intent':
    case 'confirm_emergency':
    case 'dispatch_vendor':
    case 'update_rulebook':
      // Intentional no-op:
      //   - classify_intent / confirm_emergency: pure inferences;
      //     caller writes the outcome elsewhere (whitelist.ts /
      //     emergency.ts hand the answer back to the call site).
      //   - dispatch_vendor: no vendor is contacted here. There is NO
      //     provider-dispatch pipeline yet — committing the proposal only
      //     RECORDS the owner's approval (status → 'committed'). Every
      //     owner-facing surface must reflect that (e.g. the MCP summary
      //     says "Dispatch approval recorded", never "Dispatched vendor").
      //     When a real dispatch pipeline lands it will consume the
      //     committed proposal row; until then this stays a truthful no-op.
      //   - update_rulebook: the actual rulebook write lives behind a
      //     Server Action in the property page (so the owner sees the
      //     change in the UI flow); committing the proposal records
      //     "approved" without overwriting properties.rules_text from
      //     a background context.
      return { kind: 'noop', action_type: proposal.action_type };
    case 'health_flag':
      // Intentional no-op (Feature 5): a health flag is a pure
      // acknowledge verb. Owner approve → commitProposal's CAS
      // ('proposed' → 'committing' → 'committed') records the
      // acknowledgement; decline → recordOutcome {kind:'rejected'}
      // dismisses it. There is no side effect to dispatch, and
      // committing/rejecting frees the (kind, subject) dedupe slot
      // (uq_action_proposals_open_health_flag keys on
      // status='proposed') so the daily-health-check cron may
      // re-flag the same subject on a later sweep if it is still
      // unhealthy.
      return { kind: 'noop', action_type: proposal.action_type };
    case 'voice_call_review':
      // Intentional no-op (Voice Operator V1): a call review is a pure
      // acknowledge verb, same pattern as health_flag. The call outcome
      // already happened — the artifact lives in voice_calls +
      // conversations/messages. Owner approve → CAS records the
      // acknowledgement; decline → recordOutcome dismisses it. There
      // is no side effect to dispatch.
      return { kind: 'noop', action_type: proposal.action_type };
  }

  // Defensive default: unknown action_type. Should be unreachable as
  // long as WorkerActionType stays exhaustive across the registry +
  // switch above. Returning a noop keeps commit.ts side-effect-free
  // when a future action_type lands without a wired branch.
  return {
    kind: 'noop',
    action_type: proposal.action_type as WorkerActionType,
  };
}

async function dispatchHandler(
  db: SupabaseClient<Database>,
  proposal: ActionProposal,
  deps: CommitProposalDeps,
): Promise<CommitDispatch> {
  const action = proposal.action_type as HandlerActionType;
  const schema = WORKER_PAYLOAD_SCHEMAS[action];
  // Re-validate at commit time — the proposal row may have been
  // hand-edited by an owner during review. Failing closed (low-conf
  // error) is safer than mutating against a stale shape.
  const parsed = schema.safeParse(proposal.payload);
  if (!parsed.success) {
    return {
      kind: 'handler',
      action_type: action,
      result: {
        ok: false,
        error: `payload_validation_failed: ${parsed.error.message}`,
        confidence: 0,
      },
    };
  }

  const handler = deps.handlerImpl ?? WORKER_HANDLERS[action];
  const result = await handler({
    admin: db,
    organizationId: proposal.organizationId,
    payload: parsed.data,
    proposalId: proposal.id ?? undefined,
  });
  return { kind: 'handler', action_type: action, result };
}

async function dispatchSms(
  db: SupabaseClient<Database>,
  proposal: ActionProposal,
  deps: CommitProposalDeps,
): Promise<CommitDispatch> {
  const body = resolveSmsBody(proposal);
  // tenantId lives on `proposal.routing`, NOT on `payload`. The model
  // never sees or echoes routing IDs (privacy-mode invariant — Ollama
  // on-prem deployments must not have tenant UUIDs in worker output).
  // The orchestrator at the call site populates `routing` at
  // recordProposal() time from its own conversation lookup.
  const tenantId = proposal.routing?.tenantId ?? null;
  if (!tenantId) {
    throw new ProposalCommitError(
      `draft_sms_reply proposal ${proposal.id} missing routing.tenantId`,
      null,
    );
  }
  const notify = deps.notifyTenantImpl ?? notifyTenant;
  const result = await notify({
    db,
    organizationId: proposal.organizationId,
    tenantId,
    body,
  });
  return { kind: 'sms', result };
}

const MAX_EDITED_BODY_LENGTH = 2000;

function resolveSmsBody(proposal: ActionProposal): string {
  if (proposal.editDiff != null) {
    if (
      typeof proposal.editDiff !== 'object' ||
      Array.isArray(proposal.editDiff)
    ) {
      throw new ProposalMalformedEditError(proposal.id ?? 'unknown');
    }

    const diff = proposal.editDiff as Record<string, unknown>;
    if (
      Object.hasOwn(diff, 'body_after') ||
      Object.hasOwn(diff, 'body_before') ||
      Object.hasOwn(diff, 'edited_at') ||
      Object.hasOwn(diff, 'patch')
    ) {
      return validateEditedSmsBody(diff.body_after, proposal.id);
    }

    // Compatibility with Owner Queue rows written before the canonical
    // body_before/body_after overlay landed. Those rows stored the raw patch
    // and also overwrote payload; prefer the patch's body when it exists.
    if (Object.hasOwn(diff, 'body')) {
      return validateEditedSmsBody(diff.body, proposal.id);
    }

    // A legacy tone-only edit did not alter tenant-facing text. Accept only
    // the exact historical shape; `{}` and invalid tone values are malformed
    // overlays and must never silently fall back to model output.
    const keys = Object.keys(diff);
    if (
      keys.length === 1 &&
      keys[0] === 'tone' &&
      typeof diff.tone === 'string' &&
      LEGACY_SMS_TONES.has(diff.tone)
    ) {
      return payloadSmsBody(proposal);
    }

    throw new ProposalMalformedEditError(proposal.id ?? 'unknown');
  }

  return payloadSmsBody(proposal);
}

const LEGACY_SMS_TONES = new Set([
  'neutral',
  'firm',
  'warm',
  'apologetic',
]);

function validateEditedSmsBody(value: unknown, proposalId: string | null): string {
  if (
    typeof value !== 'string' ||
    value.trim().length < 1 ||
    value.length > MAX_EDITED_BODY_LENGTH
  ) {
    throw new ProposalMalformedEditError(proposalId ?? 'unknown');
  }
  return value;
}

function payloadSmsBody(proposal: ActionProposal): string {
  const payload = proposal.payload as DraftSmsReplyPayload;
  if (typeof payload.body !== 'string' || payload.body.length < 1) {
    throw new ProposalCommitError(
      `draft_sms_reply proposal ${proposal.id} missing payload.body`,
      null,
    );
  }
  return payload.body;
}

async function dispatchBriefing(
  db: SupabaseClient<Database>,
  proposal: ActionProposal,
  deps: CommitProposalDeps,
): Promise<CommitDispatch> {
  const payload = proposal.payload as PolishBriefingPayload;
  const weekStartDate =
    deps.briefingWeekStartDate ?? mondayOfWeekISO(new Date());

  const { data, error } = await db
    .from('weekly_reports')
    .update({ briefing_text: payload.prose })
    .eq('organization_id', proposal.organizationId)
    .eq('week_start_date', weekStartDate)
    .select('id');

  if (error) {
    throw new ProposalCommitError(
      `failed to write briefing prose for week ${weekStartDate}: ${error.message}`,
      error,
    );
  }

  return {
    kind: 'briefing',
    weekStartDate,
    rowsAffected: data?.length ?? 0,
  };
}

// ---------------------------------------------------------------------------
// Internal — load + mark
// ---------------------------------------------------------------------------

async function loadProposal(
  db: SupabaseClient<Database>,
  proposalId: string,
): Promise<ActionProposal> {
  const { data, error } = await db
    .from('action_proposals')
    .select()
    .eq('id', proposalId)
    .maybeSingle();
  if (error) {
    throw new ProposalCommitError(
      `failed to load proposal ${proposalId}: ${error.message}`,
      error,
    );
  }
  if (!data) throw new ProposalNotFoundError(proposalId);
  return rowToActionProposal(data);
}

/**
 * CAS claim: conditionally move 'proposed' → 'committing'. Returns the
 * claimed proposal, or null when the conditional update matched no row
 * (someone else claimed/finished it first, or the id is gone).
 */
async function claimProposal(
  db: SupabaseClient<Database>,
  proposalId: string,
): Promise<ActionProposal | null> {
  const { data, error } = await db
    .from('action_proposals')
    .update({ status: 'committing' })
    .eq('id', proposalId)
    .eq('status', 'proposed')
    .select()
    .maybeSingle();

  if (error) {
    throw new ProposalCommitError(
      `failed to claim proposal ${proposalId} for commit: ${error.message}`,
      error,
    );
  }
  if (!data) return null;
  return rowToActionProposal(data);
}

async function markCommitted(
  db: SupabaseClient<Database>,
  proposalId: string,
  payload: WorkerActionPayload,
): Promise<ActionProposal> {
  const { data, error } = await db
    .from('action_proposals')
    .update({
      status: 'committed',
      committed_at: new Date().toISOString(),
    })
    .eq('id', proposalId)
    .eq('status', 'committing')
    .select()
    .single();

  if (error || !data) {
    throw new ProposalCommitError(
      `failed to mark proposal ${proposalId} committed: ${error?.message ?? 'no row returned'}`,
      error ?? null,
    );
  }
  return rowToActionProposal(data, payload);
}

async function markExecutionFailure(
  db: SupabaseClient<Database>,
  proposalId: string,
  payload: WorkerActionPayload,
  failure: {
    status: 'failed' | 'unsupported';
    retryable: boolean;
    evidence: Record<string, unknown>;
  },
): Promise<ActionProposal> {
  const { data, error } = await db
    .from('action_proposals')
    .update({
      status: failure.status,
      committed_at: null,
      retryable: failure.retryable,
      execution_evidence: failure.evidence as unknown as Database['public']['Tables']['action_proposals']['Update']['execution_evidence'],
      last_attempted_at: new Date().toISOString(),
    })
    .eq('id', proposalId)
    .eq('status', 'committing')
    .select()
    .single();

  if (error || !data) {
    throw new ProposalCommitError(
      `failed to persist proposal ${proposalId} execution failure: ${error?.message ?? 'no row returned'}`,
      error ?? null,
    );
  }
  return rowToActionProposal(data, payload);
}

// ---------------------------------------------------------------------------
// Date helper — Monday-of-week ISO date string ('YYYY-MM-DD')
// ---------------------------------------------------------------------------
//
// Mirrors src/lib/briefing/persist.ts:mondayOfWeek to avoid a cross-
// module import (briefing depends on commit.ts indirectly through
// proposals; pulling persist.ts here would deepen that). Kept tiny
// so duplication is acceptable.
function mondayOfWeekISO(date: Date): string {
  const d = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
  const dow = d.getUTCDay();
  const distance = dow === 0 ? 6 : dow - 1;
  d.setUTCDate(d.getUTCDate() - distance);
  return d.toISOString().slice(0, 10);
}
