/**
 * Action-proposal mutations — wave 3 inbox functional layer.
 *
 * Shared core used by both the dashboard server actions
 * (`src/app/(dashboard)/inbox/actions.ts`) and the public API routes
 * (`src/app/api/action-proposals/[id]/{commit,reject,edit}/route.ts`).
 *
 * Callers are responsible for the auth gate (verifying the signed-in
 * user belongs to the proposal's organization) BEFORE invoking these
 * helpers. Each function takes a service-role admin client + the
 * proposal id + the current user's organization id; the org id is the
 * authorisation boundary.
 *
 * v1 only commits `action_type='draft_sms_reply'` proposals. Other
 * action_types return an error envelope without mutating any rows —
 * see playbook §Stage 1 A2.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

import {
  commitActorForbidden,
  FORBIDDEN_MESSAGE,
  type CommitActor,
} from '@/lib/authz/policy';
import { requiresHumanReview } from '@/lib/agent/worker/commit-gate';
import { sendWithFailover } from '@/lib/messaging/send-with-failover';
import type { Database, MessagingProviderChoice } from '@/types/database';

type AdminSupabase = SupabaseClient<Database>;

export interface MutationOk<T> {
  ok: true;
  data: T;
}

export interface MutationErr {
  ok: false;
  error: string;
}

export type MutationResult<T> = MutationOk<T> | MutationErr;

export interface CommitProposalSuccess {
  proposalId: string;
  messageId: string;
  provider: MessagingProviderChoice;
  providerMessageId: string;
  failedOver: boolean;
  attempted: MessagingProviderChoice[];
  sentAt: string;
}

export interface RejectProposalSuccess {
  proposalId: string;
}

export interface EditProposalSuccess {
  proposalId: string;
  bodyBefore: string;
  bodyAfter: string;
  editedAt: string;
}

const SUPPORTED_COMMIT_ACTION_TYPE = 'draft_sms_reply';

interface ProposalRow {
  id: string;
  organization_id: string;
  action_type: string;
  payload: Record<string, unknown> | null;
  routing: Record<string, unknown> | null;
  status: string;
  edit_diff: unknown | null;
}

const MAX_EDITED_BODY_LENGTH = 2000;
const MALFORMED_EDIT_ERROR =
  'Proposal edit_diff.body_after must be a non-empty string of at most 2000 characters';

/**
 * Loads a proposal by id and verifies it belongs to the caller's org.
 *
 * Returns the canonical row for further mutations. Surface errors
 * collapse to a typed envelope so callers can return uniform JSON.
 */
async function loadProposalForOrg(
  admin: AdminSupabase,
  id: string,
  organizationId: string,
): Promise<MutationResult<ProposalRow>> {
  const { data, error } = await admin
    .from('action_proposals')
    .select(
      'id, organization_id, action_type, payload, routing, status, edit_diff',
    )
    .eq('id', id)
    .maybeSingle();

  if (error) {
    return { ok: false, error: 'Failed to load proposal' };
  }
  if (!data) {
    return { ok: false, error: 'Proposal not found' };
  }
  if (data.organization_id !== organizationId) {
    return { ok: false, error: 'Forbidden' };
  }
  return {
    ok: true,
    data: {
      id: data.id,
      organization_id: data.organization_id,
      action_type: data.action_type,
      payload: (data.payload as Record<string, unknown> | null) ?? null,
      routing: (data.routing as Record<string, unknown> | null) ?? null,
      status: data.status,
      edit_diff: data.edit_diff ?? null,
    },
  };
}

function readPayloadString(
  payload: Record<string, unknown> | null,
  key: string,
): string | null {
  if (!payload) return null;
  const raw = payload[key];
  return typeof raw === 'string' && raw.length > 0 ? raw : null;
}

function readRoutingString(
  routing: Record<string, unknown> | null,
  key: string,
): string | null {
  if (!routing) return null;
  const raw = routing[key];
  return typeof raw === 'string' && raw.length > 0 ? raw : null;
}

/**
 * Resolve the exact tenant-facing text for a draft commit.
 *
 * `payload` is immutable model-output evidence. Once a human edit exists,
 * `edit_diff.body_after` is authoritative and we never fall back to the model
 * text if that edit is malformed. Falling back would make the preview say one
 * thing while the provider receives another.
 */
function resolveOutboundBody(
  proposal: Pick<ProposalRow, 'payload' | 'edit_diff'>,
): MutationResult<string> {
  if (proposal.edit_diff !== null) {
    if (
      typeof proposal.edit_diff !== 'object' ||
      Array.isArray(proposal.edit_diff)
    ) {
      return { ok: false, error: MALFORMED_EDIT_ERROR };
    }

    const bodyAfter = (proposal.edit_diff as Record<string, unknown>).body_after;
    if (
      typeof bodyAfter !== 'string' ||
      bodyAfter.trim().length < 1 ||
      bodyAfter.length > MAX_EDITED_BODY_LENGTH
    ) {
      return { ok: false, error: MALFORMED_EDIT_ERROR };
    }
    return { ok: true, data: bodyAfter };
  }

  const body =
    readPayloadString(proposal.payload, 'body') ??
    readPayloadString(proposal.payload, 'sms_body');
  return body
    ? { ok: true, data: body }
    : { ok: false, error: 'Proposal payload missing body' };
}

/**
 * Commit a proposal: CAS-claims the row, mints an outbound message
 * row, sends via the messaging provider with failover, then marks the
 * proposal committed.
 *
 * Idempotency / concurrency: only proposals in `status='proposed'` are
 * eligible. All validation is pure reads; the conditional UPDATE
 * 'proposed' → 'committing' is the concurrency boundary and happens
 * BEFORE any side effect (message insert + provider send). Two
 * concurrent commit clicks race on that claim — exactly one wins; the
 * loser gets a 409-shaped claim-miss error and triggers no send.
 *
 * Caller MUST have already verified org ownership, and MUST declare its
 * actor: user actors are role-gated (fail closed) BEFORE the claim and any
 * send; system actors own their own gate.
 */
export async function commitProposal(
  admin: AdminSupabase,
  proposalId: string,
  _userId: string,
  organizationId: string,
  actor: CommitActor,
): Promise<MutationResult<CommitProposalSuccess>> {
  const loaded = await loadProposalForOrg(admin, proposalId, organizationId);
  if (!loaded.ok) return loaded;
  const proposal = loaded.data;

  // This legacy send primitive overlaps the canonical proposal pipeline. A
  // system actor must never substitute for the explicit Owner Queue review
  // required by a tenant-facing draft, even if an old row says `auto`.
  if (
    actor.kind === 'system' &&
    requiresHumanReview(SUPPORTED_COMMIT_ACTION_TYPE)
  ) {
    return { ok: false, error: 'Proposal requires owner review' };
  }

  // Role gate — BEFORE the CAS claim, the message insert, and the send.
  if (commitActorForbidden(actor, proposal.action_type)) {
    return { ok: false, error: FORBIDDEN_MESSAGE };
  }

  if (proposal.status !== 'proposed') {
    return {
      ok: false,
      error: `Proposal status is '${proposal.status}', expected 'proposed'`,
    };
  }

  if (proposal.action_type !== SUPPORTED_COMMIT_ACTION_TYPE) {
    const { data: unsupported, error: persistError } = await admin
      .from('action_proposals')
      .update({
        status: 'unsupported',
        committed_at: null,
        retryable: false,
        last_attempted_at: new Date().toISOString(),
        execution_evidence: {
          outcome: 'unsupported',
          action_type: proposal.action_type,
          error: 'handler_not_supported',
        },
      })
      .eq('id', proposalId)
      .eq('status', 'proposed')
      .select('id')
      .maybeSingle();
    if (persistError) {
      return { ok: false, error: `Failed to persist unsupported proposal: ${persistError.message}` };
    }
    if (!unsupported) {
      return { ok: false, error: 'Proposal claim missed while persisting unsupported state' };
    }
    return {
      ok: false,
      error: `Unsupported proposal action_type: ${proposal.action_type}`,
    };
  }

  // Validate the tenant-facing body before the claim. A non-null malformed
  // edit fails closed; it must never silently re-arm the original model text.
  const loadedBody = resolveOutboundBody(proposal);
  if (!loadedBody.ok) return loadedBody;

  // Resolve conversation id from routing (preferred) or payload.
  const conversationId =
    readRoutingString(proposal.routing, 'conversationId') ??
    readPayloadString(proposal.payload, 'conversation_id');
  if (!conversationId) {
    return { ok: false, error: 'Proposal missing conversation_id' };
  }

  // Resolve recipient phone — prefer payload, fall back to tenant via routing.
  let recipientPhone = readPayloadString(proposal.payload, 'recipient_phone');
  const tenantId = readRoutingString(proposal.routing, 'tenantId');

  if (!recipientPhone && tenantId) {
    const { data: tenant } = await admin
      .from('tenants')
      .select('phone_e164')
      .eq('id', tenantId)
      .single();
    recipientPhone = tenant?.phone_e164 ?? null;
  }
  if (!recipientPhone) {
    return { ok: false, error: 'Proposal missing recipient phone' };
  }

  // Resolve org messaging primary + odesa phone number.
  const { data: org, error: orgErr } = await admin
    .from('organizations')
    .select('odesa_phone_number, messaging_primary')
    .eq('id', organizationId)
    .single();
  if (orgErr || !org) {
    return { ok: false, error: 'Organization not found' };
  }
  if (!org.odesa_phone_number) {
    return { ok: false, error: 'Organization missing odesa_phone_number' };
  }

  // CAS claim: 'proposed' → 'committing'. The conditional update is
  // the concurrency boundary — two concurrent commit clicks race here
  // and exactly one wins; the loser takes the idempotent claim-miss
  // path below without inserting a message row or sending. Mirrors
  // src/lib/agent/proposals/commit.ts.
  const { data: claimed, error: claimErr } = await admin
    .from('action_proposals')
    .update({ status: 'committing' })
    .eq('id', proposalId)
    .eq('status', 'proposed')
    .select('id, payload, edit_diff')
    .maybeSingle();

  if (claimErr) {
    return { ok: false, error: 'Failed to claim proposal' };
  }
  if (!claimed) {
    return { ok: false, error: 'Proposal is already being committed' };
  }

  // Resolve from the row returned by the CAS claim, not the earlier read. An
  // edit that won immediately before the claim is therefore authoritative.
  // editProposal's status-conditioned write prevents an edit from landing
  // after this claim and falsely reporting success.
  const claimedBody = resolveOutboundBody({
    payload: (claimed.payload as Record<string, unknown> | null) ?? null,
    edit_diff: claimed.edit_diff ?? null,
  });
  if (!claimedBody.ok) return claimedBody;
  const body = claimedBody.data;

  // From here on, if anything THROWS we deliberately leave the row at
  // 'committing' (fail closed): we cannot know whether the provider
  // send fired before the throw, so reverting to 'proposed' could
  // re-arm a double-send. Stuck 'committing' rows are a first-class
  // "needs reconciliation" state — never blind-retried.

  // Insert the outbound `messages` row first so the send is auditable
  // even if Sendblue 5xxs after the row exists.
  const { data: inserted, error: insertErr } = await admin
    .from('messages')
    .insert({
      organization_id: organizationId,
      conversation_id: conversationId,
      direction: 'outbound',
      provider: org.messaging_primary,
      body,
      // The proposal is the only review ledger. This row is durable outbound
      // intent/evidence after the proposal claim, not a second approvable draft.
      draft_status: 'sending',
    })
    .select('id')
    .single();

  if (insertErr || !inserted) {
    return { ok: false, error: 'Failed to record outbound message' };
  }

  const messageId = inserted.id;

  const sendResult = await sendWithFailover(organizationId, {
    toE164: recipientPhone,
    fromE164: org.odesa_phone_number,
    body,
    messageId,
    idempotencyKey: `message:${messageId}`,
  });

  if (!sendResult.ok) {
    if (sendResult.status === 'failed' || sendResult.status === undefined) {
      // Explicit provider failure is durable evidence, not a success and not a
      // silent reset to proposed. A fresh operator retry requires a new proposal
      // or reconciliation decision; the same commit cannot blind-resend.
      const { data: failed, error: persistError } = await admin
        .from('action_proposals')
        .update({
          status: 'failed',
          committed_at: null,
          retryable: false,
          last_attempted_at: new Date().toISOString(),
          execution_evidence: {
            outcome: 'failed',
            error: 'all_providers_failed',
            attempted: sendResult.attempted,
            provider_errors: sendResult.errors,
            message_id: messageId,
          },
        })
        .eq('id', proposalId)
        .eq('status', 'committing')
        .select('id')
        .maybeSingle();
      if (persistError) {
        return { ok: false, error: `Failed to persist provider failure: ${persistError.message}` };
      }
      if (!failed) {
        return { ok: false, error: 'Proposal claim missed while persisting provider failure' };
      }
      await admin
        .from('messages')
        .update({
          draft_status: 'rejected',
          delivery_status: 'failed',
          delivery_error: 'All providers rejected the send',
        })
        .eq('id', messageId)
        .eq('draft_status', 'sending');
      return { ok: false, error: 'All providers failed' };
    }

    // Suppression is a distinct, certain no-send outcome. Ambiguous and
    // in-flight outcomes may have sent. All remain claimed for explicit
    // reconciliation and are never re-armed for a blind retry.
    return {
      ok: false,
      error: sendResult.status === 'suppressed'
        ? 'Recipient has opted out; message suppressed'
        : 'Provider outcome requires reconciliation',
    };
  }

  const sentAtIso = new Date().toISOString();

  const { error: updateMsgErr } = await admin
    .from('messages')
    .update({
      draft_status: 'sent_by_human',
      sent_at: sentAtIso,
      provider: sendResult.provider,
      provider_message_id: sendResult.providerMessageId,
    })
    .eq('id', messageId);

  if (updateMsgErr) {
    // The send DID fire — leave the row at 'committing' (fail closed)
    // so a retry cannot double-send; reconciliation picks it up.
    return { ok: false, error: 'Failed to record send' };
  }

  // Final flip conditioned on 'committing' — only the claim winner can
  // complete its own claim, and a CAS miss is surfaced rather than reported
  // as a canonical success.
  const { data: committed, error: updateProposalErr } = await admin
    .from('action_proposals')
    .update({ status: 'committed', committed_at: sentAtIso })
    .eq('id', proposalId)
    .eq('status', 'committing')
    .select('id')
    .maybeSingle();

  if (updateProposalErr) {
    return { ok: false, error: 'Failed to mark proposal committed' };
  }
  if (!committed) {
    return { ok: false, error: 'Proposal claim missed while marking committed' };
  }

  return {
    ok: true,
    data: {
      proposalId,
      messageId,
      provider: sendResult.provider,
      providerMessageId: sendResult.providerMessageId,
      failedOver: sendResult.failedOver,
      attempted: sendResult.attempted,
      sentAt: sentAtIso,
    },
  };
}

/**
 * Mark a proposal rejected. Records `rejected_at` so the reflection
 * loop can learn from rejection rate per action_type.
 */
export async function rejectProposal(
  admin: AdminSupabase,
  proposalId: string,
  _userId: string,
  organizationId: string,
): Promise<MutationResult<RejectProposalSuccess>> {
  const loaded = await loadProposalForOrg(admin, proposalId, organizationId);
  if (!loaded.ok) return loaded;
  const proposal = loaded.data;

  if (proposal.status !== 'proposed') {
    return {
      ok: false,
      error: `Proposal status is '${proposal.status}', expected 'proposed'`,
    };
  }

  const nowIso = new Date().toISOString();
  const { data: rejected, error } = await admin
    .from('action_proposals')
    .update({ status: 'rejected', rejected_at: nowIso })
    .eq('id', proposalId)
    .eq('status', 'proposed')
    .select('id')
    .maybeSingle();

  if (error) {
    return { ok: false, error: 'Failed to reject proposal' };
  }
  if (!rejected) {
    return { ok: false, error: 'Proposal is already being decided' };
  }

  return { ok: true, data: { proposalId } };
}

/**
 * Edit a proposal's drafted body. The change is recorded in the
 * `edit_diff` JSONB column so the worker reflection loop can learn
 * from operator edits. We do NOT mutate `payload` directly: it is a
 * model output snapshot, kept as-is for audit; `edit_diff` is the
 * authoritative human-edited body once present.
 */
export async function editProposal(
  admin: AdminSupabase,
  proposalId: string,
  _userId: string,
  organizationId: string,
  newBody: string,
): Promise<MutationResult<EditProposalSuccess>> {
  const trimmed = newBody.trim();
  if (trimmed.length < 1 || trimmed.length > MAX_EDITED_BODY_LENGTH) {
    return { ok: false, error: 'Body must be 1-2000 characters' };
  }

  const loaded = await loadProposalForOrg(admin, proposalId, organizationId);
  if (!loaded.ok) return loaded;
  const proposal = loaded.data;

  if (proposal.status !== 'proposed') {
    return {
      ok: false,
      error: `Proposal status is '${proposal.status}', expected 'proposed'`,
    };
  }

  let previousEditedBody: string | null = null;
  if (
    proposal.edit_diff !== null &&
    typeof proposal.edit_diff === 'object' &&
    !Array.isArray(proposal.edit_diff)
  ) {
    const raw = (proposal.edit_diff as Record<string, unknown>).body_after;
    if (typeof raw === 'string') previousEditedBody = raw;
  }
  const previousBody =
    previousEditedBody ||
    readPayloadString(proposal.payload, 'body') ||
    readPayloadString(proposal.payload, 'sms_body') ||
    '';

  const editedAt = new Date().toISOString();
  const nextDiff = {
    body_before: previousBody,
    body_after: trimmed,
    edited_at: editedAt,
  };

  const { data: updated, error } = await admin
    .from('action_proposals')
    .update({ edit_diff: nextDiff })
    .eq('id', proposalId)
    .eq('status', 'proposed')
    .select('id')
    .maybeSingle();

  if (error) {
    return { ok: false, error: 'Failed to update proposal' };
  }
  if (!updated) {
    return {
      ok: false,
      error: 'Proposal changed before the edit could be saved',
    };
  }

  return {
    ok: true,
    data: {
      proposalId,
      bodyBefore: previousBody,
      bodyAfter: trimmed,
      editedAt,
    },
  };
}
