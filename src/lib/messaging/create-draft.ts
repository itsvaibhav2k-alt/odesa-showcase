/**
 * Shared voice-originated SMS draft helper — Voice Operator V1.
 *
 * WHY this exists: the Retell tool routes (`send_sms_followup` when the
 * body classifies unsafe, and `create_followup_sms_draft` always) must
 * park an outbound SMS for owner review instead of sending. "Draft" in
 * Odesa is two rows, not one:
 *
 *   1. an outbound `messages` row with `draft_status='pending_review'`
 *      (provider 'retell' so the inbox shows the voice origin), and
 *   2. a `draft_sms_reply` action_proposal via `recordProposal` so the
 *      owner-queue approve route can flip + send it — the SAME approval
 *      surface as inbound-SMS drafts (claude-draft.ts). We go through
 *      recordProposal, never around it, so the audit trail and gate
 *      stamping stay uniform.
 *
 * The proposal is ALWAYS forced to review (`forceReview`): the content
 * came out of a live phone call the owner did not witness, so no
 * autonomy level may auto-send it. Deterministic policy decides — the
 * LLM only proposed the words.
 *
 * `action_proposals.property_id` is NOT NULL, so when no property
 * resolved for the caller (unknown caller, tenant without a lease) we
 * skip the proposal entirely and return `proposalId: null` — the draft
 * message row still lands in the open voice conversation, which is the
 * review surface for unknown callers. Nothing is ever sent from here.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';

import { recordProposal } from '@/lib/agent/proposals/record';
import type { DraftSmsReplyPayload } from '@/lib/agent/worker/types';

type Db = SupabaseClient<Database>;

/**
 * Sentinel worker_model for drafts assembled by deterministic voice
 * tooling rather than a spawned property worker (same pattern as
 * 'system-health-check' in src/lib/health/generate.ts).
 */
const VOICE_DRAFT_WORKER_MODEL = 'retell-voice-operator';

export interface CreateSmsDraftArgs {
  organizationId: string;
  tenantId: string | null;
  propertyId: string | null;
  /** Reuse this conversation when the caller already has one open. */
  conversationId?: string | null;
  body: string;
  /** Human-readable why (classifier category / intent) for the audit trail. */
  reason: string;
  source: 'retell_voice';
  /** voice_calls.retell_call_id linkage, recorded in proposal reasoning. */
  callId?: string | null;
  /** Prefix shared by every durable artifact created for one Retell invocation. */
  retellArtifactKey?: string | null;
  /** Ownership fence checked before each new durable artifact. */
  assertOwnership?: () => Promise<void>;
}

export interface CreateSmsDraftResult {
  conversationId: string;
  messageId: string;
  /** Null when no property resolved (action_proposals.property_id is NOT NULL). */
  proposalId: string | null;
}

/**
 * Insert a pending-review outbound SMS draft (+ its approval proposal
 * when a property is known). Never sends. Throws on insert failure so
 * tool routes fail loud instead of claiming a draft exists.
 *
 * @param db - service/admin Supabase client (tool routes are unauthenticated).
 * @param args - draft content + resolved caller linkage.
 * @returns conversation/message ids plus the proposal id (or null).
 */
export async function createSmsDraft(
  db: Db,
  args: CreateSmsDraftArgs,
): Promise<CreateSmsDraftResult> {
  const conversationId =
    args.conversationId ?? (await resolveConversation(db, args));

  const messageKey = args.retellArtifactKey ? `${args.retellArtifactKey}:message` : null;
  let { data: message } = messageKey
    ? await db.from('messages').select('id').eq('retell_artifact_key', messageKey).maybeSingle()
    : { data: null };
  if (!message) {
    await args.assertOwnership?.();
    const inserted = await db
    .from('messages')
    .insert({
      organization_id: args.organizationId,
      conversation_id: conversationId,
      direction: 'outbound',
      provider: 'retell',
      body: args.body,
      draft_status: 'pending_review',
      sent_at: null,
      retell_artifact_key: messageKey,
    })
    .select('id')
    .single();
    message = inserted.data;
    if (inserted.error && messageKey) {
      ({ data: message } = await db.from('messages').select('id').eq('retell_artifact_key', messageKey).maybeSingle());
    }
  }
  if (!message) {
    throw new Error(
      'voice draft message insert failed: no row returned',
    );
  }

  // action_proposals.property_id is NOT NULL — no property, no proposal.
  // The pending_review message in the voice conversation remains the
  // (only) review artifact for unknown callers.
  if (!args.propertyId) {
    return { conversationId, messageId: message.id, proposalId: null };
  }

  const payload: DraftSmsReplyPayload = { body: args.body, tone: 'neutral' };
  const proposalKey = args.retellArtifactKey ? `${args.retellArtifactKey}:proposal` : null;
  let { data: existingProposal } = proposalKey
    ? await db.from('action_proposals').select('id').eq('retell_artifact_key', proposalKey).maybeSingle()
    : { data: null };
  if (!existingProposal) {
    await args.assertOwnership?.();
    try {
      const { proposal } = await recordProposal(db, {
    organizationId: args.organizationId,
    propertyId: args.propertyId,
    workerModel: VOICE_DRAFT_WORKER_MODEL,
    actionType: 'draft_sms_reply',
    payload,
    reasoning: args.callId
      ? `${args.reason} (source: ${args.source}, call ${args.callId})`
      : `${args.reason} (source: ${args.source})`,
    // Deterministic assembly, not model self-assessment — but the gate
    // outcome is irrelevant: forceReview below pins the decision.
    confidence: 1,
    contextFactIds: [],
    autonomyLevel: 0,
    privacyMode: 'hosted',
    forceReview: {
      reason: 'voice-originated SMS draft always requires owner review',
    },
    routing: {
      conversationId,
      ...(args.tenantId ? { tenantId: args.tenantId } : {}),
    },
        retellArtifactKey: proposalKey,
      });
      if (!proposal.id) throw new Error('voice draft proposal returned no id');
      existingProposal = { id: proposal.id };
    } catch (error) {
      if (!proposalKey) throw error;
      ({ data: existingProposal } = await db.from('action_proposals').select('id').eq('retell_artifact_key', proposalKey).maybeSingle());
      if (!existingProposal) throw error;
    }
  }

  if (!existingProposal) throw new Error('voice draft proposal recovery returned no row');
  return { conversationId, messageId: message.id, proposalId: existingProposal.id };
}

/**
 * Find the caller's open voice conversation, else create one. Channel
 * is 'voice' because the draft originates from a phone call — the inbox
 * groups it with the call artifact, not the SMS thread.
 */
async function resolveConversation(
  db: Db,
  args: CreateSmsDraftArgs,
): Promise<string> {
  const artifactKey = args.retellArtifactKey ? `${args.retellArtifactKey}:conversation` : null;
  if (artifactKey) {
    const { data: existing } = await db.from('conversations').select('id').eq('retell_artifact_key', artifactKey).maybeSingle();
    if (existing) return existing.id;
  }
  // Invocation-owned drafts never reuse an unrelated open conversation: the
  // unique artifact key is the recovery anchor for every partial execution.
  if (!artifactKey && args.tenantId) {
    const { data: open } = await db
      .from('conversations')
      .select('id')
      .eq('organization_id', args.organizationId)
      .eq('tenant_id', args.tenantId)
      .eq('channel', 'voice')
      .eq('status', 'open')
      .order('last_message_at', { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle();
    if (open) return open.id;
  }

  await args.assertOwnership?.();
  const inserted = await db
    .from('conversations')
    .insert({
      organization_id: args.organizationId,
      tenant_id: args.tenantId,
      property_id: args.propertyId,
      channel: 'voice',
      status: 'open',
      retell_artifact_key: artifactKey,
    })
    .select('id')
    .single();
  let created = inserted.data;
  const { error } = inserted;
  if (error && artifactKey) {
    ({ data: created } = await db.from('conversations').select('id').eq('retell_artifact_key', artifactKey).maybeSingle());
  }
  if (!created) {
    throw new Error(
      `voice draft conversation insert failed: ${error?.message ?? 'no row returned'}`,
    );
  }
  return created.id;
}
