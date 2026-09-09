'use server';

/**
 * `/owner-queue` ("Decisions Desk") server actions — PASS 2: real decision
 * control.
 *
 * Every action mirrors the load-bearing write path established in
 * `/review/actions.ts`:
 *   1. `requireAuthContext()` — auth via the SSR client, org via the admin
 *      client (so we never trust a client-supplied org id).
 *   2. `loadOwnedProposal()` — load the proposal with the ADMIN client and
 *      assert `row.organization_id === ctx.organizationId` (the cross-org
 *      guard is non-negotiable; a missing row or org mismatch is refused).
 *   3. Mutate via the ADMIN client only — `commitProposal`/`recordOutcome`
 *      both receive the admin client, never the SSR client.
 *   4. `revalidatePath('/owner-queue')`.
 *
 * COMMITTING IS REAL AND DANGEROUS. `commitProposal` fires the side effect for
 * the action_type: `send_tenant_message` → SMS, `request_rent_payment` →
 * Stripe link + SMS, `update_rent`/`set_lease_terms` → lease write.
 * `dispatch_vendor` commit is a no-op (records the decision only). The UI MUST
 * route message/money/lease approvals through the preview drawer + an explicit
 * in-drawer confirm before calling `approveDecision`/`saveAndApproveDecision`;
 * these actions assume that gate has already been crossed. Decline records an
 * owner decision too, so it is owner-only even though it has no external side
 * effect.
 *
 * Saving owner edits NEVER commits: `saveDecisionEdits` re-validates the merged
 * payload against the per-type Zod schema (fail-closed) and writes it back with
 * an `edit_diff`, leaving the proposal pending for an explicit later approval.
 */

import { revalidatePath } from 'next/cache';

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';

import {
  can,
  FORBIDDEN_MESSAGE,
  proposalCommitCapability,
} from '@/lib/authz/policy';
import { createServerClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  commitProposal,
  ProposalCommitError,
  ProposalBlockedError,
} from '@/lib/agent/proposals/commit';
import { recordOutcome } from '@/lib/agent/proposals/outcome';
import {
  WORKER_PAYLOAD_SCHEMAS,
  type WorkerActionType,
} from '@/lib/agent/worker/types';
import { requiresHumanReview } from '@/lib/agent/worker/commit-gate';
import { isCommitCapableActionType } from '@/lib/owner-queue/queries';
import { updateRulebook } from '@/app/(dashboard)/properties/[id]/actions';
import type { ReviewActionResult } from '@/lib/review/types';

type AdminClient = SupabaseClient<Database>;

/** Max owner-guidance length, matching `properties.rules_text`'s 4k ceiling. */
const RULES_TEXT_MAX = 4000;

// ---------------------------------------------------------------------------
// Auth + ownership
// ---------------------------------------------------------------------------

interface AuthCtx {
  userId: string;
  organizationId: string;
  /** users.role of the caller; role gates fail closed on null/unknown. */
  role: string | null;
}

/**
 * Resolves the caller's user + organization. Auth is read from the SSR client
 * (the session cookie); the organization is read from the `users` table via the
 * ADMIN client — never trusted from the request — mirroring `/review/actions.ts`.
 *
 * @returns `{ ok: true, ctx }` when authenticated with an org, else `{ ok: false, error }`.
 */
async function requireAuthContext(): Promise<
  { ok: true; ctx: AuthCtx } | { ok: false; error: string }
> {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Unauthorized' };

  const admin = createAdminClient();
  const { data: row } = await admin
    .from('users')
    .select('organization_id, role')
    .eq('id', user.id)
    .single();
  if (!row?.organization_id) {
    return { ok: false, error: 'User has no organization' };
  }

  return {
    ok: true,
    ctx: {
      userId: user.id,
      organizationId: row.organization_id,
      role: row.role ?? null,
    },
  };
}

/**
 * Owner-only gate for sensitive proposal commits. Internal records retain the
 * existing member behavior; the VA workspace adds its own earlier boundary.
 *
 * @returns null when allowed, else the caller-visible Forbidden error.
 */
function commitRoleError(
  role: string | null,
  actionType: string,
): string | null {
  if (
    isCommitCapableActionType(actionType) &&
    requiresHumanReview(actionType) &&
    role !== 'owner'
  ) {
    return FORBIDDEN_MESSAGE;
  }
  const capability = proposalCommitCapability(actionType);
  if (capability && !can(role, capability)) return FORBIDDEN_MESSAGE;
  return null;
}

/** The minimal proposal columns the owner-queue actions read + cross-org gate. */
interface OwnedProposal {
  id: string;
  organizationId: string;
  actionType: string;
  payload: Record<string, unknown>;
  editDiff: unknown | null;
  status: string;
  gateDecision: string | null;
}

/**
 * Loads a proposal with the ADMIN client and enforces the cross-org guard.
 *
 * The admin client bypasses RLS, so the org check here is the ONLY thing
 * preventing one organization from acting on another's proposal — it is
 * non-negotiable. A missing row and an org mismatch return the same generic
 * error so the action never confirms a foreign id exists.
 *
 * @param admin - Service-role Supabase client.
 * @param id - `action_proposals.id`.
 * @param orgId - The caller's organization id (from `requireAuthContext`).
 * @returns `{ ok: true, proposal }` when owned, else `{ ok: false, error }`.
 */
async function loadOwnedProposal(
  admin: AdminClient,
  id: string,
  orgId: string,
): Promise<
  { ok: true; proposal: OwnedProposal } | { ok: false; error: string }
> {
  const { data: row } = await admin
    .from('action_proposals')
    .select(
      'id, organization_id, action_type, payload, edit_diff, status, gate_decision',
    )
    .eq('id', id)
    .maybeSingle();

  if (!row || row.organization_id !== orgId) {
    return { ok: false, error: 'Decision not found' };
  }

  return {
    ok: true,
    proposal: {
      id: row.id,
      organizationId: row.organization_id,
      actionType: row.action_type,
      payload: asRecord(row.payload),
      editDiff: row.edit_diff ?? null,
      status: row.status,
      gateDecision: row.gate_decision,
    },
  };
}

// ---------------------------------------------------------------------------
// approveDecision — commit a proposal (REAL side effect).
// ---------------------------------------------------------------------------

/**
 * Commits a single proposal via `commitProposal` (admin client). This fires the
 * real side effect for the action_type, so the UI must only call it AFTER the
 * preview/confirm gate for message/money/lease decisions.
 *
 * @param id - `action_proposals.id` to commit.
 * @returns `ReviewActionResult` — `ok: true` with the committed status, or a
 *   mapped `ok: false` error (blocked / commit failure / not owned).
 */
export async function approveDecision(id: string): Promise<ReviewActionResult> {
  const auth = await requireAuthContext();
  if (!auth.ok) return { ok: false, error: auth.error };

  if (auth.ctx.role !== 'owner') {
    return { ok: false, error: FORBIDDEN_MESSAGE };
  }

  const admin = createAdminClient();
  const owned = await loadOwnedProposal(admin, id, auth.ctx.organizationId);
  if (!owned.ok) return { ok: false, error: owned.error };

  // Owner-only role gate BEFORE the commit fires any side effect.
  const roleError = commitRoleError(auth.ctx.role, owned.proposal.actionType);
  if (roleError) return { ok: false, error: roleError };

  return commitOwned(admin, id, auth.ctx.role);
}

// ---------------------------------------------------------------------------
// declineDecision — record a rejected outcome (SAFE).
// ---------------------------------------------------------------------------

/**
 * Declines a proposal by recording a `rejected` outcome via `recordOutcome`
 * (admin client). No tenant/vendor/money side effect ever fires — this is the
 * safe path.
 *
 * @param id - `action_proposals.id` to decline.
 * @param reason - Optional free-text reason persisted to the outcome.
 * @returns `ReviewActionResult` — `ok: true` with status 'rejected', or a
 *   mapped `ok: false` error.
 */
export async function declineDecision(
  id: string,
  reason?: string,
): Promise<ReviewActionResult> {
  const auth = await requireAuthContext();
  if (!auth.ok) return { ok: false, error: auth.error };

  if (auth.ctx.role !== 'owner') {
    return { ok: false, error: FORBIDDEN_MESSAGE };
  }

  const admin = createAdminClient();
  const owned = await loadOwnedProposal(admin, id, auth.ctx.organizationId);
  if (!owned.ok) return { ok: false, error: owned.error };

  const trimmed = (reason ?? '').trim();
  try {
    await recordOutcome(admin, {
      proposalId: id,
      outcome: trimmed
        ? { kind: 'rejected', reason: trimmed }
        : { kind: 'rejected' },
    });
  } catch (err) {
    return { ok: false, error: messageFor(err, 'Failed to decline decision') };
  }

  revalidatePath('/owner-queue');
  return { ok: true, data: { status: 'rejected' } };
}

// ---------------------------------------------------------------------------
// saveDecisionEdits — re-validate + persist edits, NO commit.
// ---------------------------------------------------------------------------

/**
 * Deep-merges `patch` into the proposal's payload, re-validates the result
 * against the action_type's Zod schema (FAIL CLOSED — a bad patch returns the
 * schema's own message and writes nothing), then persists the new payload plus
 * an `edit_diff` recording the patch. NEVER commits — the proposal stays
 * pending so the owner can explicitly approve the edited recommendation later.
 *
 * @param id - `action_proposals.id` to edit.
 * @param patch - A partial payload to merge over the existing payload.
 * @returns `ReviewActionResult` — `ok: true` with `status: 'edited'` on success,
 *   or `ok: false` with the validation/persistence error.
 */
export async function saveDecisionEdits(
  id: string,
  patch: Record<string, unknown>,
): Promise<ReviewActionResult> {
  const auth = await requireAuthContext();
  if (!auth.ok) return { ok: false, error: auth.error };

  const admin = createAdminClient();
  const owned = await loadOwnedProposal(admin, id, auth.ctx.organizationId);
  if (!owned.ok) return { ok: false, error: owned.error };

  const result = await persistEdits(
    admin,
    owned.proposal,
    patch,
    auth.ctx.userId,
  );
  if (!result.ok) return result;

  revalidatePath('/owner-queue');
  return { ok: true, data: { status: 'edited' } };
}

// ---------------------------------------------------------------------------
// saveAndApproveDecision — save edits then commit (REAL side effect).
// ---------------------------------------------------------------------------

/**
 * Runs the `saveDecisionEdits` validation + persistence, then immediately
 * commits the edited proposal via `commitProposal`. The same danger applies as
 * `approveDecision`: the UI must gate message/money/lease commits behind the
 * preview drawer's explicit confirm before calling this.
 *
 * @param id - `action_proposals.id` to edit + commit.
 * @param patch - A partial payload to merge over the existing payload.
 * @returns `ReviewActionResult` — `ok: true` with the committed status, or a
 *   mapped `ok: false` error (validation, blocked, commit failure, not owned).
 */
export async function saveAndApproveDecision(
  id: string,
  patch: Record<string, unknown>,
): Promise<ReviewActionResult> {
  const auth = await requireAuthContext();
  if (!auth.ok) return { ok: false, error: auth.error };

  if (auth.ctx.role !== 'owner') {
    return { ok: false, error: FORBIDDEN_MESSAGE };
  }

  const admin = createAdminClient();
  const owned = await loadOwnedProposal(admin, id, auth.ctx.organizationId);
  if (!owned.ok) return { ok: false, error: owned.error };

  // Owner-only role gate BEFORE any write — this path ends in a commit, so a
  // non-owner may not even persist the edit through it (saveDecisionEdits
  // remains the member-accessible way to prepare edits).
  const roleError = commitRoleError(auth.ctx.role, owned.proposal.actionType);
  if (roleError) return { ok: false, error: roleError };

  const saved = await persistEdits(
    admin,
    owned.proposal,
    patch,
    auth.ctx.userId,
  );
  if (!saved.ok) return saved;

  return commitOwned(admin, id, auth.ctx.role);
}

// ---------------------------------------------------------------------------
// batchApprove — commit many auto-gated proposals; per-id partial success.
// ---------------------------------------------------------------------------

/** Per-id result of a `batchApprove` run. */
export interface BatchApproveItemResult {
  id: string;
  ok: boolean;
  error?: string;
}

/**
 * Commits each id in turn, guarding ownership per id and continuing past
 * failures so one bad id never aborts the batch.
 *
 * SERVER-SIDE BULK GUARD — the UI only enumerates auto-gated routine ids, but
 * that is not trusted here: every id is re-checked against the proposal row
 * itself. Only commit-capable (`isCommitCapableActionType`) proposals with
 * `gate_decision = 'auto'` may batch-commit; anything review/block-gated (or a
 * legacy non-schema verb) fails per-id without aborting the rest. Bulk
 * approval of judgment items is therefore disabled at the action path, not
 * merely hidden in the UI. An empty id list is a safe no-op.
 *
 * @param ids - `action_proposals.id` values to commit.
 * @returns `{ ok, results }` where `ok` is true iff every id committed; each
 *   entry in `results` reports that id's outcome for partial-success rendering.
 */
export async function batchApprove(
  ids: string[],
): Promise<{ ok: boolean; results: BatchApproveItemResult[] }> {
  // Safe no-op on an empty list — nothing to authorize, nothing to commit.
  if (ids.length === 0) {
    return { ok: true, results: [] };
  }

  const auth = await requireAuthContext();
  if (!auth.ok) {
    return {
      ok: false,
      results: ids.map((id) => ({ id, ok: false, error: auth.error })),
    };
  }

  if (auth.ctx.role !== 'owner') {
    return {
      ok: false,
      results: ids.map((id) => ({ id, ok: false, error: FORBIDDEN_MESSAGE })),
    };
  }

  const admin = createAdminClient();
  const results: BatchApproveItemResult[] = [];

  for (const id of ids) {
    const owned = await loadOwnedProposal(admin, id, auth.ctx.organizationId);
    if (!owned.ok) {
      results.push({ id, ok: false, error: owned.error });
      continue;
    }

    // Owner-only role gate per item — a batch can never bypass it.
    const roleError = commitRoleError(auth.ctx.role, owned.proposal.actionType);
    if (roleError) {
      results.push({ id, ok: false, error: roleError });
      continue;
    }

    // Bulk approval is for routine decisions only: commit-capable action
    // types gated 'auto'. Review/block-gated proposals need an individual,
    // explicit decision and can never ride a batch.
    if (
      !isCommitCapableActionType(owned.proposal.actionType) ||
      owned.proposal.gateDecision !== 'auto' ||
      requiresHumanReview(owned.proposal.actionType)
    ) {
      results.push({
        id,
        ok: false,
        error: 'Only routine (auto-approved) decisions can be batch-approved',
      });
      continue;
    }

    const committed = await commitOwned(admin, id, auth.ctx.role);
    results.push(
      committed.ok
        ? { id, ok: true }
        : { id, ok: false, error: committed.error },
    );
  }

  // Revalidate once after the whole batch so the desk reflects every commit.
  revalidatePath('/owner-queue');
  return { ok: results.every((r) => r.ok), results };
}

// ---------------------------------------------------------------------------
// saveDecisionAsOwnerRule — append guidance to properties.rules_text.
// ---------------------------------------------------------------------------

/**
 * Appends a line of owner guidance to a property's `rules_text` via the
 * existing `updateRulebook` write path (which is org-scoped through the SSR
 * client + RLS). De-dupes against the current text (skips when the exact line
 * is already present) and refuses to append past the 4k character ceiling.
 * This is GUIDANCE, not an enforced rule — Odesa uses it when drafting future
 * recommendations.
 *
 * @param propertyId - The owning property's id.
 * @param ruleText - The guidance line to append.
 * @returns `ReviewActionResult` — `ok: true` (also when a duplicate is skipped),
 *   or `ok: false` with the validation/persistence error.
 */
export async function saveDecisionAsOwnerRule(
  propertyId: string,
  ruleText: string,
): Promise<ReviewActionResult> {
  const auth = await requireAuthContext();
  if (!auth.ok) return { ok: false, error: auth.error };

  if (auth.ctx.role !== 'owner') {
    return { ok: false, error: FORBIDDEN_MESSAGE };
  }

  const trimmed = (ruleText ?? '').trim();
  if (trimmed.length === 0) {
    return { ok: false, error: 'Guidance text is empty' };
  }

  // Read the current text via the admin client (org-guarded explicitly) so we
  // can dedupe + measure the cap before delegating the write.
  const admin = createAdminClient();
  const { data: property } = await admin
    .from('properties')
    .select('id, organization_id, rules_text')
    .eq('id', propertyId)
    .maybeSingle();

  if (!property || property.organization_id !== auth.ctx.organizationId) {
    return { ok: false, error: 'Property not found' };
  }

  const current = (property.rules_text ?? '').trim();

  // Dedupe: skip silently (success) when the exact guidance line already
  // exists, so repeated saves are idempotent and never grow the text.
  if (lineAlreadyPresent(current, trimmed)) {
    revalidatePath('/owner-queue');
    return { ok: true, data: { status: 'duplicate' } };
  }

  const next = current.length === 0 ? trimmed : `${current}\n${trimmed}`;
  if (next.length > RULES_TEXT_MAX) {
    return {
      ok: false,
      error: `Guidance would exceed the ${RULES_TEXT_MAX}-character limit`,
    };
  }

  // Persist through the established rulebook path (revalidates the property
  // page; org-scoped via RLS) rather than writing rules_text from here.
  const updated = await updateRulebook({ propertyId, rulesText: next });
  if (!updated.success) {
    return { ok: false, error: updated.error };
  }

  revalidatePath('/owner-queue');
  return { ok: true, data: { status: 'saved' } };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Commits an already-owned proposal and maps `commitProposal`'s errors onto the
 * `ReviewActionResult` shape. Assumes ownership has been verified by the caller.
 */
async function commitOwned(
  admin: AdminClient,
  id: string,
  role: string | null,
): Promise<ReviewActionResult> {
  try {
    const result = await commitProposal(admin, id, { kind: 'user', role });
    if (result.proposal.status !== 'committed') {
      return {
        ok: false,
        error: 'The decision was not completed and needs reconciliation',
      };
    }
    revalidatePath('/owner-queue');
    return { ok: true, data: { status: result.proposal.status } };
  } catch (err) {
    if (err instanceof ProposalBlockedError) {
      return { ok: false, error: 'This decision is not recommended and cannot be approved' };
    }
    if (err instanceof ProposalCommitError) {
      return { ok: false, error: messageFor(err, 'Failed to approve decision') };
    }
    return { ok: false, error: messageFor(err, 'Failed to approve decision') };
  }
}

/**
 * Deep-merges `patch` over the currently reviewed representation and
 * re-validates against the per-type Zod schema (fail closed).
 * `draft_sms_reply` keeps the model payload immutable and stores the reviewed
 * text in `edit_diff.body_after`; legacy handler actions retain their existing
 * payload-patch behavior in this focused convergence wave.
 */
async function persistEdits(
  admin: AdminClient,
  proposal: OwnedProposal,
  patch: Record<string, unknown>,
  editorUserId: string,
): Promise<ReviewActionResult> {
  const schema = WORKER_PAYLOAD_SCHEMAS[proposal.actionType as WorkerActionType];
  if (!schema) {
    return { ok: false, error: 'This decision type cannot be edited' };
  }

  const currentPayload =
    proposal.actionType === 'draft_sms_reply'
      ? applyDraftSmsEdit(proposal.payload, proposal.editDiff)
      : proposal.payload;
  const merged = deepMerge(currentPayload, patch);

  // Re-validate the merged payload exactly as commit time would. Failing closed
  // (returning the schema's own message) is safer than persisting a shape that
  // commit would later reject against a stale row.
  const parsed = schema.safeParse(merged);
  if (!parsed.success) {
    return { ok: false, error: firstZodMessage(parsed.error) };
  }

  if (
    proposal.actionType === 'draft_sms_reply' &&
    (typeof asRecord(parsed.data).body !== 'string' ||
      (asRecord(parsed.data).body as string).trim().length === 0)
  ) {
    return { ok: false, error: 'Edited message body is invalid' };
  }

  const update =
    proposal.actionType === 'draft_sms_reply'
      ? draftSmsEditUpdate(proposal, parsed.data, patch, editorUserId)
      : {
          payload:
            parsed.data as Database['public']['Tables']['action_proposals']['Update']['payload'],
          edit_diff:
            patch as Database['public']['Tables']['action_proposals']['Update']['edit_diff'],
        };

  const { data: updated, error } = await admin
    .from('action_proposals')
    .update(update)
    .eq('id', proposal.id)
    .eq('status', 'proposed')
    .select('id')
    .maybeSingle();

  if (error) {
    return { ok: false, error: 'Failed to save decision edits' };
  }
  if (!updated) {
    return {
      ok: false,
      error: 'This decision is no longer editable because its status changed',
    };
  }

  return { ok: true, data: { status: 'edited' } };
}

/** Apply a valid prior draft overlay so repeated edits compose predictably. */
function applyDraftSmsEdit(
  payload: Record<string, unknown>,
  editDiff: unknown,
): Record<string, unknown> {
  if (!isPlainObject(editDiff)) return payload;

  const storedPatch = isPlainObject(editDiff.patch)
    ? editDiff.patch
    : legacyDraftPatch(editDiff);
  const effective = deepMerge(payload, storedPatch);
  if (typeof editDiff.body_after === 'string') {
    effective.body = editDiff.body_after;
  }
  return effective;
}

/**
 * Build the audit overlay for a draft without changing immutable model output.
 * `body_after` is always present, even for a tone-only edit, so commit can
 * distinguish a valid reviewed overlay from malformed state.
 */
function draftSmsEditUpdate(
  proposal: OwnedProposal,
  parsedPayload: unknown,
  patch: Record<string, unknown>,
  editorUserId: string,
): Database['public']['Tables']['action_proposals']['Update'] {
  const parsed = asRecord(parsedPayload);
  const bodyAfter = parsed.body as string;

  const priorPatch = isPlainObject(proposal.editDiff)
    ? isPlainObject(proposal.editDiff.patch)
      ? proposal.editDiff.patch
      : legacyDraftPatch(proposal.editDiff)
    : {};
  const combinedPatch = deepMerge(priorPatch, patch);

  return {
    edit_diff: {
      patch: combinedPatch,
      body_before:
        typeof proposal.payload.body === 'string' ? proposal.payload.body : '',
      body_after: bodyAfter,
      edited_by: editorUserId,
      edited_at: new Date().toISOString(),
    } as unknown as Database['public']['Tables']['action_proposals']['Update']['edit_diff'],
  };
}

/** Read the pre-overlay Owner Queue shape for compatibility with existing rows. */
function legacyDraftPatch(editDiff: Record<string, unknown>): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  if (typeof editDiff.body === 'string') patch.body = editDiff.body;
  if (typeof editDiff.tone === 'string') patch.tone = editDiff.tone;
  return patch;
}

/**
 * Recursively merges `patch` over `base`, returning a NEW object (never mutates
 * either input). Plain-object values merge key-by-key; everything else (arrays,
 * primitives, null) is replaced wholesale by the patch value.
 */
function deepMerge(
  base: Record<string, unknown>,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    const existing = out[key];
    if (isPlainObject(existing) && isPlainObject(value)) {
      out[key] = deepMerge(existing, value);
    } else {
      out[key] = value;
    }
  }
  return out;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value)
  );
}

/** Narrows an unknown JSONB payload to a record (empty when not an object). */
function asRecord(payload: unknown): Record<string, unknown> {
  return isPlainObject(payload) ? payload : {};
}

/** The first Zod issue's message (with its path when present). */
function firstZodMessage(error: {
  issues: ReadonlyArray<{ path: ReadonlyArray<PropertyKey>; message: string }>;
}): string {
  const first = error.issues[0];
  if (!first) return 'Validation failed';
  const path = first.path.map(String).join('.');
  return path ? `${path}: ${first.message}` : first.message;
}

/** A safe user-facing message from an unknown thrown value. */
function messageFor(err: unknown, fallback: string): string {
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}

/**
 * True when `line` already appears as its own trimmed line within `text`.
 * Line-level match (not substring) so a longer rule containing the new text as
 * a fragment doesn't suppress a legitimately distinct guidance line.
 */
function lineAlreadyPresent(text: string, line: string): boolean {
  if (text.length === 0) return false;
  return text
    .split('\n')
    .map((l) => l.trim())
    .includes(line);
}
