/**
 * voice_calls persistence — the only module that reads/writes the table.
 *
 * WHY a thin store instead of queries inline in routes:
 *   - The session lives in a jsonb column with no DB-level shape guarantee.
 *     Every read-back goes through callSessionSchema here (safeParse with a
 *     fresh-session fallback on corrupt data), so the pure engine never sees
 *     malformed state and routes never hand-roll the trust boundary.
 *   - Retell re-delivers webhooks: upsertCallStarted is idempotent on
 *     retell_call_id — a duplicate call_started returns the EXISTING session
 *     untouched rather than resetting a live call.
 *   - appendCallAction is deliberately best-effort (never throws, no-ops when
 *     the call row is absent): existing tool-endpoints e2e posts tool calls
 *     without a live call row, and an action-log miss must never fail the
 *     tool response the agent is waiting on.
 *
 * All state transitions go through the pure reducer (call-state.ts); this
 * file is I/O only.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Json } from '@/types/database';
import { createSession, reduceCallEvent } from './call-state';
import type { ResolvedCaller } from './resolve-caller';
import {
  callerKindSchema,
  callOutcomeSchema,
  callSessionSchema,
  type CallOutcome,
  type CallSession,
  type VoiceActionLogEntry,
} from './types';

type Db = SupabaseClient<Database>;

const ROW_COLUMNS =
  'id, organization_id, status, property_id, conversation_id, ended_at, session, retell_call_id, direction, from_number, to_number, caller_kind, tenant_id, vendor_id, unit_id, started_at';

interface StoredRow {
  id: string;
  organization_id: string;
  status: string;
  property_id: string | null;
  conversation_id: string | null;
  ended_at: string | null;
  session: Json;
  retell_call_id: string;
  direction: string;
  from_number: string;
  to_number: string;
  caller_kind: string;
  tenant_id: string | null;
  vendor_id: string | null;
  unit_id: string | null;
  started_at: string;
}

/** Parse the jsonb session; on corrupt data rebuild a fresh session from row scalars. */
function sessionFromRow(row: StoredRow): CallSession {
  const parsed = callSessionSchema.safeParse(row.session);
  if (parsed.success) return parsed.data as CallSession;

  const fresh = createSession({
    retellCallId: row.retell_call_id,
    organizationId: row.organization_id,
    direction: row.direction === 'outbound' ? 'outbound' : 'inbound',
    fromNumber: row.from_number,
    toNumber: row.to_number,
    startedAt: row.started_at,
  });
  const kind = callerKindSchema.safeParse(row.caller_kind);
  return reduceCallEvent(fresh, {
    type: 'caller_resolved',
    at: row.started_at,
    callerKind: kind.success ? kind.data : 'unknown_caller',
    tenantId: row.tenant_id,
    vendorId: row.vendor_id,
    propertyId: row.property_id,
    unitId: row.unit_id,
  });
}

async function fetchRow(db: Db, retellCallId: string): Promise<StoredRow | null> {
  const { data, error } = await db
    .from('voice_calls')
    .select(ROW_COLUMNS)
    .eq('retell_call_id', retellCallId)
    .maybeSingle();
  if (error) throw new Error(`voice_calls load failed: ${error.message}`);
  return data;
}

/**
 * Create the voice_calls row for a starting call, or return the existing
 * session untouched when Retell re-delivers call_started.
 *
 * @returns The live CallSession (fresh, or existing on re-delivery).
 */
export async function upsertCallStarted(
  db: Db,
  init: {
    retellCallId: string;
    direction: 'inbound' | 'outbound';
    fromNumber: string;
    toNumber: string;
    startedAt: string;
    resolved: ResolvedCaller;
  },
): Promise<CallSession> {
  const existing = await fetchRow(db, init.retellCallId);
  if (existing) return sessionFromRow(existing);

  const session = reduceCallEvent(
    createSession({
      retellCallId: init.retellCallId,
      organizationId: init.resolved.organizationId,
      direction: init.direction,
      fromNumber: init.fromNumber,
      toNumber: init.toNumber,
      startedAt: init.startedAt,
    }),
    {
      type: 'caller_resolved',
      at: init.startedAt,
      callerKind: init.resolved.callerKind,
      tenantId: init.resolved.tenantId,
      vendorId: init.resolved.vendorId,
      propertyId: init.resolved.propertyId,
      unitId: init.resolved.unitId,
    },
  );

  const { error } = await db.from('voice_calls').upsert(
    {
      retell_call_id: init.retellCallId,
      organization_id: init.resolved.organizationId,
      direction: init.direction,
      from_number: init.fromNumber,
      to_number: init.toNumber,
      caller_kind: init.resolved.callerKind,
      tenant_id: init.resolved.tenantId,
      vendor_id: init.resolved.vendorId,
      property_id: init.resolved.propertyId,
      unit_id: init.resolved.unitId,
      started_at: init.startedAt,
      status: 'active',
      session: session as unknown as Json,
    },
    // ignoreDuplicates: a concurrent re-delivery must not reset the row.
    { onConflict: 'retell_call_id', ignoreDuplicates: true },
  );
  if (error) throw new Error(`voice_calls upsert failed: ${error.message}`);

  // Re-read to cover the lost race (another delivery inserted first).
  const row = await fetchRow(db, init.retellCallId);
  return row ? sessionFromRow(row) : session;
}

/**
 * Load the live session + the row scalars callers key decisions off.
 *
 * @returns null when no call row exists for `retellCallId`.
 */
export async function loadSession(
  db: Db,
  retellCallId: string,
): Promise<{
  session: CallSession;
  row: {
    id: string;
    organization_id: string;
    status: string;
    property_id: string | null;
    conversation_id: string | null;
    ended_at: string | null;
  };
} | null> {
  const row = await fetchRow(db, retellCallId);
  if (!row) return null;
  return {
    session: sessionFromRow(row),
    row: {
      id: row.id,
      organization_id: row.organization_id,
      status: row.status,
      property_id: row.property_id,
      conversation_id: row.conversation_id,
      ended_at: row.ended_at,
    },
  };
}

/** Persist the session jsonb and mirror the linkable scalars it carries. */
export async function saveSession(db: Db, retellCallId: string, session: CallSession): Promise<void> {
  const valid = callSessionSchema.parse(session) as CallSession;
  const { error } = await db
    .from('voice_calls')
    .update({
      session: valid as unknown as Json,
      caller_kind: valid.callerKind,
      tenant_id: valid.tenantId ?? null,
      vendor_id: valid.vendorId ?? null,
      property_id: valid.propertyId ?? null,
      unit_id: valid.unitId ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq('retell_call_id', retellCallId);
  if (error) throw new Error(`voice_calls save failed: ${error.message}`);
}

/**
 * Append one action-log entry to the session. BEST-EFFORT by contract:
 * never throws, silent no-op when the call row is absent or the id is
 * missing — a logging miss must never fail a live tool response.
 */
export async function appendCallAction(
  db: Db,
  retellCallId: string | null | undefined,
  entry: VoiceActionLogEntry,
): Promise<void> {
  try {
    if (!retellCallId) return;
    const loaded = await loadSession(db, retellCallId);
    if (!loaded) return;
    const next = reduceCallEvent(loaded.session, { type: 'action_taken', at: entry.at, entry });
    await saveSession(db, retellCallId, next);
  } catch (err) {
    console.error(
      `[voice] appendCallAction best-effort failure for ${retellCallId}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
}

/** Mark the call completed and write the compiled, schema-validated outcome. */
export async function finalizeCallArtifacts(
  db: Db,
  retellCallId: string,
  args: {
    session: CallSession;
    transcript: string | null;
    summary: string;
    outcome: CallOutcome;
    endedAt: string;
    messageBody: string;
    needsReview: boolean;
    propertyId: string | null;
    tenantId: string | null;
    proposalPayload: Json | null;
    proposalReasoning: string | null;
    richness: number;
  },
): Promise<{
  duplicate: boolean;
  conversationId: string;
  messageId: string;
  proposalId: string | null;
  summary: string;
}> {
  const session = callSessionSchema.parse({ ...args.session, endedAt: args.endedAt }) as CallSession;
  const outcome = callOutcomeSchema.parse(args.outcome) as CallOutcome;
  const { data, error } = await db.rpc('finalize_retell_call_artifacts', {
    p_retell_call_id: retellCallId,
    p_session: session as unknown as Json,
    p_transcript: args.transcript,
    p_summary: args.summary,
    p_outcome: outcome as unknown as Json,
    p_message_body: args.messageBody,
    p_ended_at: args.endedAt,
    p_needs_review: args.needsReview,
    p_property_id: args.propertyId,
    p_tenant_id: args.tenantId,
    p_proposal_payload: args.proposalPayload,
    p_proposal_reasoning: args.proposalReasoning,
    p_richness: args.richness,
  });
  if (error || !data) {
    throw new Error(`voice_calls atomic finalize failed: ${error?.message ?? 'no result'}`);
  }
  const result = data as unknown as {
    duplicate: boolean;
    conversation_id: string;
    message_id: string;
    proposal_id: string | null;
    summary: string;
  };
  return {
    duplicate: result.duplicate,
    conversationId: result.conversation_id,
    messageId: result.message_id,
    proposalId: result.proposal_id,
    summary: result.summary,
  };
}
