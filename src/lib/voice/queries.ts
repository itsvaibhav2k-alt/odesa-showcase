/**
 * Voice-call activity counts + list/detail reads for the /calls surface and
 * the Today card.
 *
 * Read-only, RLS server client (org scoping comes from RLS; the optional
 * organizationId narrows explicitly for service-role callers). Volumes are
 * tiny (calls per org per day), so rows are fetched and counted/mapped in JS.
 *
 * The one piece of real logic — `deriveCallReview` — is pure and unit-tested
 * in __tests__/queries.test.ts. It is THE single source of truth for a call's
 * review status, used by `countActivity` (header stats) AND the list mapper
 * (row chips) so the two can never disagree. Every jsonb read is defensive:
 * `voice_calls.outcome` has no DB-level shape guarantee.
 */

import type { createServerClient } from "@/lib/supabase/server";
import type { Json } from "@/types/database";
import { callOutcomeSchema } from "./types";

type SupabaseServerClient = Awaited<ReturnType<typeof createServerClient>>;

// ---------------------------------------------------------------------------
// Defensive jsonb readers (outcome is untyped jsonb)
// ---------------------------------------------------------------------------

function isRecordObject(
  value: Json | null | undefined,
): value is Record<string, Json | undefined> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Read a string[] field defensively from untyped outcome jsonb. */
function stringsOf(outcome: Json | null, key: string): string[] {
  if (!isRecordObject(outcome)) return [];
  const value = outcome[key];
  return Array.isArray(value)
    ? value.filter((v): v is string => typeof v === "string")
    : [];
}

/** Read an array field (of any element shape) defensively. */
function arrayField(outcome: Json | null, key: string): Json[] {
  if (!isRecordObject(outcome)) return [];
  const value = outcome[key];
  return Array.isArray(value) ? value : [];
}

/** outcome.recordsCreated — the canonical, compiler-deduped created-record truth. */
function recordsCreatedOf(
  outcome: Json | null,
): Array<{ kind: string; id: string }> {
  return arrayField(outcome, "recordsCreated").flatMap((entry) => {
    if (!isRecordObject(entry)) return [];
    const { kind, id } = entry;
    return typeof kind === "string" && typeof id === "string"
      ? [{ kind, id }]
      : [];
  });
}

/**
 * outcome.autonomousActions — executed tier<=2 actions only (misses drafts,
 * by design of the compiler). Returns the action verb + its created-record ids.
 */
function autonomousActionsOf(
  outcome: Json | null,
): Array<{ action: string; ids: Record<string, string> }> {
  return arrayField(outcome, "autonomousActions").flatMap((entry) => {
    if (!isRecordObject(entry)) return [];
    const action = entry.action;
    if (typeof action !== "string") return [];
    const ids: Record<string, string> = {};
    if (isRecordObject(entry.ids)) {
      for (const [k, v] of Object.entries(entry.ids)) {
        if (typeof v === "string") ids[k] = v;
      }
    }
    return [{ action, ids }];
  });
}

const CALL_REASON_LABELS: Record<string, string> = {
  owner_decision_on_fee_request: "Owner decision needed on the fee request",
  financial_concession: "Potential financial concession",
  payment_claim_ledger_conflict: "Payment claim does not match the rent ledger",
  unknown_caller_needs_review: "Caller identity could not be verified",
  tier4_action_attempted: "A prohibited action was blocked",
  payment_dispute: "Payment dispute",
  upset_caller: "Caller needs careful follow-up",
};

/** Human-facing label for internal compiler reasons; unknown ids stay private. */
export function humanizeCallReason(reason: string): string {
  return CALL_REASON_LABELS[reason] ?? "Additional review detail recorded";
}

// ---------------------------------------------------------------------------
// deriveCallReview — single source of truth for a call's review status
// ---------------------------------------------------------------------------

export type CallStatusTone = "green" | "clay" | "gold" | "neutral";

export interface CallReview {
  needsReview: boolean;
  resolvedAutomatically: boolean;
  approvalCount: number;
  riskFlagCount: number;
  unresolvedCount: number;
  /** Human phrases scoped to call evidence and Owner Queue review work. */
  reviewReasons: string[];
  statusTone: CallStatusTone;
  statusLabel: string;
}

/**
 * Pure review derivation from a call's status + raw outcome jsonb.
 *
 * Semantics (honest by construction):
 *   - needsReview = a pending approval OR a risk flag exists. Unresolved facts
 *     are surfaced (unresolvedCount) but do NOT gate review — a missing fact is
 *     info, not an owner action.
 *   - resolvedAutomatically requires a completed call whose outcome validates
 *     as the canonical compiled CallOutcome artifact AND needs no review. A
 *     partial/malformed/string/null outcome is NEVER green-resolved — it
 *     renders neutral "Outcome unavailable".
 *
 * @param status - voice_calls.status ('active' | 'completed' | 'failed' | ...).
 * @param outcome - Raw jsonb from voice_calls.outcome (untrusted shape).
 */
export function deriveCallReview(
  status: string,
  outcome: Json | null,
): CallReview {
  const hasCanonicalOutcome = callOutcomeSchema.safeParse(outcome).success;
  const approvalCount = stringsOf(outcome, "approvalsNeeded").length;
  const riskFlags = stringsOf(outcome, "riskFlags");
  const riskFlagCount = riskFlags.length;
  const unresolvedCount = stringsOf(outcome, "unresolved").length;

  const needsReview = approvalCount > 0 || riskFlagCount > 0;
  const resolvedAutomatically =
    status === "completed" && hasCanonicalOutcome && !needsReview;

  const reviewReasons: string[] = [];
  if (needsReview) {
    if (approvalCount > 0) {
      reviewReasons.push(
        approvalCount === 1
          ? "1 review item for Owner Queue"
          : `${approvalCount} review items for Owner Queue`,
      );
    }
    if (riskFlagCount > 0) {
      const named = riskFlags.slice(0, 3).map(humanizeCallReason).join(", ");
      const head =
        riskFlagCount === 1 ? "1 risk flag" : `${riskFlagCount} risk flags`;
      reviewReasons.push(`${head}: ${named}`);
    }
  }

  let statusTone: CallStatusTone;
  let statusLabel: string;
  if (needsReview) {
    statusTone = "clay";
    statusLabel = "Needs review";
  } else if (resolvedAutomatically) {
    statusTone = "green";
    statusLabel = "Outcome recorded";
  } else if (status === "active") {
    statusTone = "neutral";
    statusLabel = "Call in progress";
  } else {
    statusTone = "neutral";
    statusLabel = "Outcome unavailable";
  }

  return {
    needsReview,
    resolvedAutomatically,
    approvalCount,
    riskFlagCount,
    unresolvedCount,
    reviewReasons,
    statusTone,
    statusLabel,
  };
}

// ---------------------------------------------------------------------------
// Today card activity
// ---------------------------------------------------------------------------

export interface VoiceCallActivity {
  callsToday: number;
  resolvedAutomatically: number;
  needsReview: number;
  /** @deprecated compat alias for needsReview — do not add new usages. */
  awaitingApproval: number;
  /** Total executed tier<=2 actions across today's calls (honest sum). */
  actionsTaken: number;
  /** Total canonical records created across today's calls. */
  recordsCreated: number;
}

interface ActivityRow {
  status: string;
  outcome: Json | null;
}

/**
 * Pure counting core over today's rows. Review status flows through
 * `deriveCallReview` so the Today card can never disagree with a row chip.
 * Active/malformed calls count only in callsToday (never resolved).
 */
export function countActivity(rows: readonly ActivityRow[]): VoiceCallActivity {
  let resolvedAutomatically = 0;
  let needsReview = 0;
  let actionsTaken = 0;
  let recordsCreated = 0;
  for (const row of rows) {
    const review = deriveCallReview(row.status, row.outcome);
    if (review.needsReview) needsReview += 1;
    else if (review.resolvedAutomatically) resolvedAutomatically += 1;
    actionsTaken += autonomousActionsOf(row.outcome).length;
    recordsCreated += recordsCreatedOf(row.outcome).length;
  }
  return {
    callsToday: rows.length,
    resolvedAutomatically,
    needsReview,
    awaitingApproval: needsReview,
    actionsTaken,
    recordsCreated,
  };
}

/** Voice calls started today (UTC). Returns zeros on query error so the Today page never breaks. */
export async function getVoiceCallActivity(
  db: SupabaseServerClient,
  organizationId?: string,
): Promise<VoiceCallActivity> {
  const startOfTodayUtc = `${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`;

  let query = db
    .from("voice_calls")
    .select("id, status, outcome")
    .gte("started_at", startOfTodayUtc);
  if (organizationId) query = query.eq("organization_id", organizationId);

  const { data, error } = await query;
  if (error) {
    console.error(`[voice] getVoiceCallActivity failed: ${error.message}`);
    return {
      callsToday: 0,
      resolvedAutomatically: 0,
      needsReview: 0,
      awaitingApproval: 0,
      actionsTaken: 0,
      recordsCreated: 0,
    };
  }
  return countActivity(data ?? []);
}

// ---------------------------------------------------------------------------
// /calls surface
// ---------------------------------------------------------------------------

const CALL_LIST_COLUMNS =
  "id, retell_call_id, caller_kind, from_number, status, started_at, ended_at, " +
  "summary, transcript, outcome, conversation_id, tenant_id, vendor_id, " +
  "tenants!voice_calls_tenant_id_fkey(full_name), " +
  "vendors!voice_calls_vendor_id_fkey(name)";

export interface VoiceCallListItem {
  id: string;
  callerKind: string;
  callerLabel: string;
  fromNumber: string;
  status: string;
  startedAt: string;
  endedAt: string | null;
  summary: string | null;
  /** Short transcript excerpt for the index card; full text lives on /calls/[id]. */
  transcriptPreview: string | null;
  intents: string[];
  approvalsNeeded: number;
  riskFlags: number;
  conversationId: string | null;
  /** Property this call resolved to (null for unknown callers) — governs owner-queue eligibility. */
  propertyId: string | null;
  /** Full derived review status — header and rows share this exact shape. */
  review: CallReview;
  /** Count of executed tier<=2 actions (autonomousActions.length). */
  actionsTaken: number;
  /** Action verbs from autonomousActions[].action — feeds namedActions(). */
  actionIds: string[];
  /** Canonical created records (compiler-deduped). */
  recordsCreated: Array<{ kind: string; id: string }>;
  /** These are MESSAGE IDs, not bodies — surface as counts only, never rendered as text. */
  smsSentCount: number;
  smsDraftedCount: number;
  /** Created-record ids grouped by kind from autonomousActions[].ids, for drilldown links. */
  drilldownIds: Record<string, string[]>;
}

interface CallRowShape {
  id: string;
  caller_kind: string;
  from_number: string;
  status: string;
  started_at: string;
  ended_at: string | null;
  summary: string | null;
  transcript: string | null;
  outcome: Json | null;
  conversation_id: string | null;
  tenants: { full_name: string } | null;
  vendors: { name: string } | null;
}

function transcriptPreviewOf(transcript: string | null): string | null {
  const text = transcript?.replace(/\s+/g, " ").trim();
  if (!text) return null;
  return text.length > 220 ? `${text.slice(0, 217)}…` : text;
}

function toListItem(row: CallRowShape): VoiceCallListItem {
  const actions = autonomousActionsOf(row.outcome);
  const drilldownIds: Record<string, string[]> = {};
  for (const { ids } of actions) {
    for (const [kind, id] of Object.entries(ids)) {
      (drilldownIds[kind] ??= []).push(id);
    }
  }
  const propertyId =
    isRecordObject(row.outcome) && typeof row.outcome.propertyId === "string"
      ? row.outcome.propertyId
      : null;

  return {
    id: row.id,
    callerKind: row.caller_kind,
    callerLabel: row.tenants?.full_name ?? row.vendors?.name ?? row.from_number,
    fromNumber: row.from_number,
    status: row.status,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    summary: row.summary,
    transcriptPreview: transcriptPreviewOf(row.transcript),
    intents: stringsOf(row.outcome, "intentsHandled"),
    approvalsNeeded: stringsOf(row.outcome, "approvalsNeeded").length,
    riskFlags: stringsOf(row.outcome, "riskFlags").length,
    conversationId: row.conversation_id,
    propertyId,
    review: deriveCallReview(row.status, row.outcome),
    actionsTaken: actions.length,
    actionIds: actions.map((a) => a.action),
    recordsCreated: recordsCreatedOf(row.outcome),
    smsSentCount: stringsOf(row.outcome, "smsSent").length,
    smsDraftedCount: stringsOf(row.outcome, "smsDrafted").length,
    drilldownIds,
  };
}

/**
 * All calls, newest first. RLS scopes every batch to the caller's org.
 *
 * The overview is a real paginated register, so its source cannot silently stop
 * at an arbitrary "recent 50" window. Supabase/PostgREST responses are fetched
 * in bounded batches until the org's register is exhausted. Callers may still
 * pass an explicit limit for deliberately bounded secondary surfaces.
 */
export async function listVoiceCalls(
  db: SupabaseServerClient,
  limit?: number,
): Promise<VoiceCallListItem[]> {
  const batchSize = 500;
  const target = limit ?? Number.POSITIVE_INFINITY;
  const rows: CallRowShape[] = [];
  let offset = 0;

  while (rows.length < target) {
    const requested = Math.min(batchSize, target - rows.length);
    const { data, error } = await db
      .from("voice_calls")
      .select(CALL_LIST_COLUMNS)
      .order("started_at", { ascending: false })
      .order("id", { ascending: false })
      .range(offset, offset + requested - 1);

    if (error) {
      console.error(`[voice] listVoiceCalls failed: ${error.message}`);
      return [];
    }

    const batch = (data ?? []) as unknown as CallRowShape[];
    rows.push(...batch);
    if (batch.length < requested) break;
    offset += batch.length;
  }

  return rows.slice(0, limit).map(toListItem);
}

export interface VoiceCallDetail extends VoiceCallListItem {
  retellCallId: string;
  transcript: string | null;
  outcome: Json | null;
}

/** One call with transcript + raw outcome jsonb; null when absent (or other org). */
export async function getVoiceCallDetail(
  db: SupabaseServerClient,
  id: string,
): Promise<VoiceCallDetail | null> {
  const { data, error } = await db
    .from("voice_calls")
    .select(`${CALL_LIST_COLUMNS}, transcript`)
    .eq("id", id)
    .maybeSingle();
  if (error || !data) {
    if (error)
      console.error(`[voice] getVoiceCallDetail failed: ${error.message}`);
    return null;
  }
  const row = data as unknown as CallRowShape & {
    retell_call_id: string;
    transcript: string | null;
  };
  return {
    ...toListItem(row),
    retellCallId: row.retell_call_id,
    transcript: row.transcript,
    outcome: row.outcome,
  };
}
