/**
 * Owner Queue — real Supabase queries for the `/owner-queue` "Decisions Desk".
 *
 * Drop-in replacement for the VALUE exports of
 * `src/lib/owner-queue/mock-decisions.ts`. The page imports these instead of
 * the mock; the `Decision` / `DecisionSummary` / `MetricChip` / `Consideration`
 * TYPES still come from the mock module (this file re-uses them so the
 * owner-queue components render unchanged).
 *
 * Source of truth: the `action_proposals` table (RLS-scoped to the caller's
 * organization via `createServerClient()`). Following
 * `@/lib/properties/queries.ts`: explicit column selection (never
 * `select('*')`), and the property → name join decomposed into a follow-up
 * `in()` query rather than a PostgREST embed.
 *
 * Mapping (action_proposals → Decision), confirmed against the mock semantics
 * and the established `src/lib/open-items/queries.ts` adapter:
 *
 *   id              ← action_proposals.id
 *   recommendation  ← current safety policy + stored gate. Consequential
 *                     legacy 'auto' rows become 'hold'; 'block' remains
 *                     'decline'; only currently safe 'auto' rows are routine.
 *   type            ← humanized action_type, uppercased (eyebrow category)
 *   location        ← properties.name (resolved from property_id), else "Portfolio"
 *   title           ← humanized action_type (Title Case)
 *   odesaLine       ← reasoning (PLAIN TEXT — escaped to neutralize the inline
 *                     <b> the components render via dangerouslySetInnerHTML)
 *   metricChips     ← derived from generic columns (confidence) + safe payload
 *                     money fields when present (money chip relabelled via
 *                     financialLabelFor); otherwise empty
 *   impact          ← short payload/confidence-derived line, else ""
 *   sources         ← [] (legacy free-text list; superseded by sourceFacts)
 *   considerations  ← [] (no real structured-reasoning column yet)
 *   sourceNote      ← "" (no real provenance column yet)
 *   askPlaceholder  ← generic per-card placeholder
 *   askSuggestions  ← [] (reserved for future per-card scope)
 *
 * Decision-control adapter fields (Pass 1 — presentation only, never a
 * mutation). All derived from REAL columns via the pure maps in
 * `decision-actions.ts`; nothing is fabricated:
 *   actionType         ← action_type
 *   propertyId         ← property_id
 *   gateReason         ← gateReasonFor(gate_decision, action_type)
 *   boundary           ← boundaryCopyFor(action_type)
 *   ifIgnored          ← ifIgnoredCopyFor(action_type, gate_decision)
 *   primaryActionLabel ← actionLabelFor(action_type, recommendation)
 *   financialLabel     ← financialLabelFor(action_type) — ONLY when a real
 *                        money figure exists on the payload; else null
 *   editKind           ← editKindFor(action_type)
 *   whyFacts           ← reasoning text split into a few short factual lines
 *                        (no synthesized alternatives/risk); [] when absent
 *   state              ← 'recommended' (Pass 1 default)
 *   sourceFacts        ← context_fact_ids → memory_facts.fact_type, normalized
 *                        via normalizeSourceLabel; OMITTED when none resolve
 *
 * Pending = `status === 'proposed'` (mirrors the `idx_action_proposals_status`
 * partial index and the mock, whose page only ever renders pending rows).
 *
 * Following `@/lib/properties/queries.ts`: explicit column selection (never
 * `select('*')`), and BOTH joins (property name, memory facts) decomposed into
 * follow-up `in()` queries rather than PostgREST embeds. The memory-fact join
 * maps ONLY `id`/`fact_type` (never the raw `content`), and no tenant/vendor id
 * from `routing` is ever placed in a presentational field.
 */

import { createServerClient } from '@/lib/supabase/server';
import {
  WORKER_ACTION_TYPES,
  type WorkerActionType,
} from '@/lib/agent/worker/types';
import { requiresHumanReview } from '@/lib/agent/worker/commit-gate';
import type {
  Consideration,
  Decision,
  DecisionEditDraft,
  DecisionRecommendation,
  DecisionSummary,
  MetricChip,
} from '@/lib/owner-queue/mock-decisions';
import {
  actionLabelFor,
  boundaryCopyFor,
  editKindFor,
  financialLabelFor,
  gateReasonFor,
  ifIgnoredCopyFor,
  normalizeSourceLabel,
} from '@/lib/owner-queue/decision-actions';
import {
  cleanReasoning,
  deriveOwnerReasoning,
} from '@/lib/owner-queue/owner-reasoning';

type SupabaseServerClient = Awaited<ReturnType<typeof createServerClient>>;

/** Proposals in this status are awaiting an owner decision. */
const PENDING_STATUS = 'proposed' as const;

/**
 * The closed set of action_types a worker can actually propose — and the ONLY
 * ones `commitProposal` can dispatch. Sourced from the worker contract
 * (`WORKER_ACTION_TYPES`) so this filter stays in lockstep with the gate matrix
 * and the commit dispatch switch.
 *
 * Pre-existing `seed.sql` legacy rows use non-schema verbs
 * (`offer_payment_plan` / `send_rent_reminder` / `draft_lease_renewal` /
 * `escalate_collections`) that would fail a real commit. We DROP them in-query
 * (never delete the DB rows) so the live queue only ever offers commit-capable
 * decisions.
 */
const COMMIT_CAPABLE_ACTION_TYPES: ReadonlySet<string> = new Set(
  WORKER_ACTION_TYPES,
);

/**
 * True iff `actionType` is a commit-capable worker action verb (member of
 * `WORKER_ACTION_TYPES`). Exported so the legacy-row exclusion is unit-testable
 * without a live DB, mirroring the other pure exports in this module.
 */
export function isCommitCapableActionType(
  actionType: string,
): actionType is WorkerActionType {
  return COMMIT_CAPABLE_ACTION_TYPES.has(actionType);
}

/** Max source chips rendered per card so the provenance strip never sprawls. */
const MAX_SOURCE_FACTS = 4;

/** Max "Why this?" lines derived from the real reasoning text. */
const MAX_WHY_FACTS = 4;

/** A single resolved provenance chip ({ id, label }) for a card. */
type SourceFact = NonNullable<Decision['sourceFacts']>[number];

/**
 * Minimal shape we read off each `action_proposals` row. Explicit so the
 * select stays auditable and never drifts to `select('*')`.
 */
interface ProposalRow {
  id: string;
  property_id: string;
  action_type: string;
  status: string;
  gate_decision: string;
  confidence: number | null;
  reasoning: string | null;
  payload: unknown;
  edit_diff?: unknown;
  routing: unknown;
  context_fact_ids: string[] | null;
  created_at: string;
}

/**
 * Minimal shape we read off each `memory_facts` row referenced by a proposal's
 * `context_fact_ids`. `content` is selected for parity with the table but only
 * `id`/`fact_type` feed the (label-only) source chips — never the raw content.
 */
interface MemoryFactRow {
  id: string;
  fact_type: string;
  content: unknown;
}

// =====================================================================
// Public entry points — same names / shapes the page consumes.
// =====================================================================

/**
 * Returns every pending owner decision (status 'proposed'), newest first,
 * mapped to the `Decision` shape. Empty array when the org has no pending
 * proposals (the common case today).
 */
export async function getDecisions(): Promise<Decision[]> {
  const supabase = await createServerClient();

  const { data } = await supabase
    .from('action_proposals')
    .select(
      'id, property_id, action_type, status, gate_decision, confidence, reasoning, payload, edit_diff, routing, context_fact_ids, created_at',
    )
    .eq('status', PENDING_STATUS)
    .order('created_at', { ascending: false });

  // Keep only commit-capable proposals. Legacy seed.sql rows carry non-schema
  // action_types that real commit can't dispatch — filtering here means the
  // summary, judgment, and routine views (all built on getDecisions) inherit
  // the same commit-capable-only guarantee.
  const rows = ((data ?? []) as ProposalRow[]).filter((row) =>
    isCommitCapableActionType(row.action_type),
  );
  if (rows.length === 0) return [];

  // Resolve the two decomposed `in()` joins (property names, memory facts) the
  // same way `fetchPropertyNameMap` does — never a PostgREST embed.
  const [propertyMap, factMap] = await Promise.all([
    fetchPropertyNameMap(supabase, uniq(rows.map((r) => r.property_id))),
    fetchMemoryFactMap(supabase, uniq(rows.flatMap((r) => r.context_fact_ids ?? []))),
  ]);

  return rows.map((row) =>
    toDecision(
      row,
      propertyMap.get(row.property_id) ?? null,
      sourceFactsFor(row.context_fact_ids, factMap),
    ),
  );
}

/**
 * Routine decisions safe to batch-approve — `gate_decision === 'auto'`,
 * surfaced with recommendation 'approve' (mirrors the mock's
 * `recommendation === 'approve'` routine split).
 */
export async function getRoutineDecisions(): Promise<Decision[]> {
  const decisions = await getDecisions();
  return decisions.filter((d) => d.recommendation === 'approve');
}

/**
 * Decisions excluded from bulk approval — need owner judgment. These are the
 * 'review'/'block'-gated proposals (recommendation 'hold' / 'decline').
 */
export async function getJudgmentDecisions(): Promise<Decision[]> {
  const decisions = await getDecisions();
  return decisions.filter((d) => d.recommendation !== 'approve');
}

/**
 * Page-level summary for the top bar + banner. Derived from the live pending
 * set so an empty queue yields a zeroed, crash-free summary:
 *   { pendingCount: 0, totalAtStake: '$0', timeSensitiveCount: 0, routineTotal: '$0' }
 *
 * - pendingCount       → count of pending proposals
 * - totalAtStake       → sum of every pending proposal's dollar estimate
 * - timeSensitiveCount → judgment decisions (review/block) needing a closer look
 * - routineTotal       → sum of the routine (auto) batch's dollar estimate
 */
export async function getDecisionSummary(): Promise<DecisionSummary> {
  const decisions = await getDecisions();

  const totalAtStakeCents = decisions.reduce(
    (sum, d) => sum + decisionDollarsCents(d),
    0,
  );
  const routine = decisions.filter((d) => d.recommendation === 'approve');
  const routineTotalCents = routine.reduce(
    (sum, d) => sum + decisionDollarsCents(d),
    0,
  );
  const timeSensitiveCount = decisions.filter(
    (d) => d.recommendation !== 'approve',
  ).length;

  return {
    pendingCount: decisions.length,
    totalAtStake: formatDollarsFromCents(totalAtStakeCents),
    timeSensitiveCount,
    routineTotal: formatDollarsFromCents(routineTotalCents),
  };
}

// =====================================================================
// Row → Decision mapping (pure)
// =====================================================================

/**
 * Maps one `action_proposals` row (plus its already-resolved property name and
 * source-fact chips) onto a `Decision`. PURE — all IO (property/memory-fact
 * joins) happens upstream in `getDecisions`, so this stays unit-testable and
 * can never fabricate provenance it wasn't handed.
 *
 * Evidence-only contract: `sourceFacts`/`whyFacts` are derived strictly from
 * real columns (`context_fact_ids` → `memory_facts`, and the `reasoning` text);
 * `financialLabel` is set only when a real money figure exists; `considerations`
 * stays empty (no structured-reasoning column exists). No spend caps, ETAs, or
 * risk scores are ever synthesized.
 *
 * @param row - The raw pending proposal row.
 * @param propertyName - Resolved owning-property name, or null for "Portfolio".
 * @param sourceFacts - Normalized provenance chips; empty when none exist.
 * @returns The presentational `Decision` the desk renders.
 */
export function toDecision(
  row: ProposalRow,
  propertyName: string | null,
  sourceFacts: SourceFact[],
): Decision {
  const recommendation = recommendationFor(
    row.gate_decision,
    row.action_type,
  );
  const dollarsCents = payloadDollarsCents(row.payload);
  // Humanize the reasoning for DISPLAY only — voice/policy proposals embed raw
  // classifier + source enum tokens (e.g. 'payment_cleared_claim (source:
  // retell_voice, call …)') that must never surface as the owner-facing copy.
  const cleanedReasoning = cleanReasoning(row.reasoning);
  // Set the money-chip label only when a real figure is actually present, so
  // the relabel can never imply a number the proposal doesn't carry.
  const financialLabel =
    dollarsCents != null && dollarsCents > 0
      ? financialLabelFor(row.action_type)
      : null;

  return {
    id: row.id,
    recommendation,
    type:
      OWNER_FACING_LABELS[row.action_type]?.eyebrow ??
      upperEyebrow(row.action_type),
    location: propertyName ?? 'Portfolio',
    title:
      OWNER_FACING_LABELS[row.action_type]?.title ??
      (humaniseActionType(row.action_type) || 'Owner decision'),
    metricChips: buildMetricChips(row, dollarsCents, financialLabel),
    // reasoning is real text; the card renders odesaLine via
    // dangerouslySetInnerHTML, so escape it to neutralize any markup. It is
    // ALSO humanized (cleanReasoning) so no raw enum/source token leaks into
    // the primary "Odesa recommends" line.
    odesaLine: escapeHtml(cleanedReasoning),
    impact: buildImpact(recommendation, dollarsCents),
    // No real provenance / structured-reasoning columns exist yet.
    sources: [],
    considerations: [] as Consideration[],
    sourceNote: '',
    askPlaceholder: 'Ask Odesa about this decision…',
    askSuggestions: [],

    // ----- Decision-control adapter fields (Pass 1, presentation only) -----
    actionType: row.action_type,
    propertyId: row.property_id,
    gateReason: gateReasonFor(row.gate_decision, row.action_type),
    boundary: boundaryCopyFor(row.action_type),
    ifIgnored: ifIgnoredCopyFor(row.action_type, row.gate_decision),
    primaryActionLabel: actionLabelFor(row.action_type, recommendation),
    financialLabel,
    editKind: editKindFor(row.action_type),
    // "Why this?" lines come ONLY from the real reasoning text — never
    // synthesized alternatives or risk. Humanized (cleanReasoning) so tokens
    // never leak. Empty when there's no reasoning.
    whyFacts: splitWhyFacts(cleanedReasoning),
    // Structured six-section owner-dossier copy, humanized from real fields.
    reasoningSections: deriveOwnerReasoning({
      reasoning: row.reasoning,
      actionType: row.action_type,
      gate: row.gate_decision,
      recommendation,
      sourceLabels: sourceFacts.map((f) => f.label),
    }),
    // Raw reasoning remains on action_proposals for internal audit; it is not
    // copied into the customer-facing dossier.
    rawReasoning: undefined,
    state: 'recommended',
    // Omit the Sources row entirely when no provenance exists (don't fabricate).
    sourceFacts: sourceFacts.length > 0 ? sourceFacts : undefined,
    // Pre-fill the edit drawer from the proposal's real drafted payload so it
    // never opens blank. Omitted when the payload carries nothing editable.
    editDraft: buildEditDraft(row),
  };
}

/** Stored gate + today's explicit safety disposition → recommendation. */
function recommendationFor(
  gate: string,
  actionType: string,
): DecisionRecommendation {
  if (gate === 'block') return 'decline';
  // A legacy/stale auto row for a now-consequential action is judgment work,
  // never routine. The server action applies the same current-policy guard.
  if (
    !isCommitCapableActionType(actionType) ||
    requiresHumanReview(actionType)
  ) {
    return 'hold';
  }
  switch (gate) {
    case 'auto':
      return 'approve';
    case 'review':
    default:
      return 'hold';
  }
}

/**
 * Builds the metric-chip strip from the generic columns available on every
 * proposal: a money chip when the payload carries a dollar estimate, plus a
 * confidence chip. The money chip is labelled with the action-specific
 * `financialLabel` (e.g. "Estimated vendor cost") when one applies, falling
 * back to the neutral "Amount". Returns at most the mock's 4-chip ceiling;
 * empty when nothing meaningful is derivable.
 */
function buildMetricChips(
  row: ProposalRow,
  dollarsCents: number | null,
  financialLabel: string | null,
): MetricChip[] {
  const chips: MetricChip[] = [];

  if (dollarsCents != null && dollarsCents > 0) {
    chips.push({
      label: financialLabel ?? 'Amount',
      value: formatDollarsFromCents(dollarsCents),
    });
  }

  const confidencePct = confidenceToPct(row.confidence);
  if (confidencePct != null) {
    chips.push({ label: 'Confidence', value: `${confidencePct}%` });
  }

  return chips.slice(0, 4);
}

function buildImpact(
  recommendation: DecisionRecommendation,
  dollarsCents: number | null,
): string {
  if (dollarsCents != null && dollarsCents > 0) {
    return `${formatDollarsFromCents(dollarsCents)} ${
      recommendation === 'approve' ? 'one-time' : 'at stake'
    }`;
  }
  return '';
}

// =====================================================================
// Edit-draft mapping (pure)
// =====================================================================

/** The four tones the message drawer accepts (mirrors `draftSmsReplyPayloadSchema`). */
const VALID_TONES: ReadonlySet<string> = new Set([
  'neutral',
  'firm',
  'warm',
  'apologetic',
]);

/**
 * Builds the drawer's editable initial values (`editDraft`) from a proposal's
 * REAL model `payload` plus the separate human edit overlay, so the owner-queue
 * edit drawer pre-fills with the exact reviewed content while the model output
 * remains immutable.
 *
 * Each field maps 1:1 to a real worker payload key (see `WORKER_PAYLOAD_SCHEMAS`
 * / `DecisionEditDraft`); nothing is fabricated. Only keys with a real value are
 * set, and the whole draft is OMITTED (returns undefined) when the payload
 * carries no editable content — a non-editable proposal (health flag, rulebook)
 * never produces a phantom draft.
 *
 * PRIVACY INVARIANT: the recipient label is a presentational NAME only, drawn
 * solely from `payload.tenantRef.tenantName` / `payload.leaseRef.tenantName`.
 * This NEVER reads `row.routing` (or any *Id field), so no tenant/vendor/
 * work-order id can leak into the UI.
 *
 * @param row - The raw pending proposal row.
 * @returns The drawer's initial values, or undefined when nothing is editable.
 */
function buildEditDraft(row: ProposalRow): DecisionEditDraft | undefined {
  if (!row.payload || typeof row.payload !== 'object') return undefined;
  const p = effectivePayloadForDisplay(row);

  const draft: DecisionEditDraft = {};

  // message (draft_sms_reply / send_tenant_message)
  const body = p.body;
  if (isNonEmptyString(body)) draft.body = body;
  const tone = p.tone;
  if (typeof tone === 'string' && VALID_TONES.has(tone)) {
    draft.tone = tone as DecisionEditDraft['tone'];
  }

  // dispatch (dispatch_vendor)
  const smsBody = p.smsBody;
  if (isNonEmptyString(smsBody)) draft.smsBody = smsBody;

  // rent_payment (request_rent_payment)
  const amountCents = p.amountCents;
  if (isPositiveFinite(amountCents)) draft.amountCents = Math.round(amountCents);
  const dueDate = p.dueDate;
  if (isNonEmptyString(dueDate)) draft.dueDate = dueDate;

  // lease (update_rent / set_lease_terms)
  const rentAmount = p.rentAmount;
  if (isPositiveFinite(rentAmount)) draft.rentAmount = Math.round(rentAmount);
  const rentDueDay = p.rentDueDay;
  if (isPositiveFinite(rentDueDay)) draft.rentDueDay = Math.round(rentDueDay);
  const startDate = p.startDate;
  if (isNonEmptyString(startDate)) draft.startDate = startDate;
  const endDate = p.endDate;
  if (isNonEmptyString(endDate)) draft.endDate = endDate;

  // No substantive payload field → nothing to edit; omit the draft entirely.
  if (Object.keys(draft).length === 0) return undefined;

  // Presentational companions for the preview block. recipientLabel is a NAME
  // only (never an id); channel is the fixed SMS preview channel.
  draft.recipientLabel = recipientLabelFrom(p);
  draft.channel = 'SMS';
  if (editKindFor(row.action_type) === 'lease') {
    draft.isFullLease = row.action_type === 'set_lease_terms';
  }

  return draft;
}

/** Apply only the recognized draft edit overlay for presentation. */
function effectivePayloadForDisplay(row: ProposalRow): Record<string, unknown> {
  const payload = { ...(row.payload as Record<string, unknown>) };
  if (row.action_type !== 'draft_sms_reply' || !isPlainObject(row.edit_diff)) {
    return payload;
  }

  const patch = isPlainObject(row.edit_diff.patch)
    ? row.edit_diff.patch
    : row.edit_diff;
  if (typeof patch.tone === 'string') payload.tone = patch.tone;
  if (typeof patch.body === 'string') payload.body = patch.body;
  if (typeof row.edit_diff.body_after === 'string') {
    payload.body = row.edit_diff.body_after;
  }
  return payload;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value)
  );
}

/**
 * The presentational recipient label for the preview block — a NAME only, drawn
 * from `payload.tenantRef.tenantName` / `payload.leaseRef.tenantName`, falling
 * back to "Tenant". Never reads an id (tenantId/leaseId), so nothing routable
 * can leak into the UI.
 */
function recipientLabelFrom(payload: Record<string, unknown>): string {
  return refTenantName(payload.tenantRef) ?? refTenantName(payload.leaseRef) ?? 'Tenant';
}

/** Reads the presentational `tenantName` off a tenant/lease ref; null otherwise. */
function refTenantName(ref: unknown): string | null {
  if (!ref || typeof ref !== 'object') return null;
  const name = (ref as Record<string, unknown>).tenantName;
  return isNonEmptyString(name) ? name : null;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isPositiveFinite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

// =====================================================================
// Shared lookups
// =====================================================================

async function fetchPropertyNameMap(
  supabase: SupabaseServerClient,
  propertyIds: readonly string[],
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (propertyIds.length === 0) return map;
  const { data } = await supabase
    .from('properties')
    .select('id, name')
    .in('id', propertyIds);
  for (const p of data ?? []) map.set(p.id, p.name);
  return map;
}

/**
 * Resolves the `memory_facts` referenced by proposals' `context_fact_ids` into
 * an `id → fact_type` map. Decomposed `in()` join (mirrors
 * `fetchPropertyNameMap`), never a PostgREST embed. `content` is selected for
 * table parity but intentionally NOT mapped — only the fact type feeds the
 * label-only source chips, so no raw fact content can leak into the UI.
 */
async function fetchMemoryFactMap(
  supabase: SupabaseServerClient,
  factIds: readonly string[],
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (factIds.length === 0) return map;
  const { data } = await supabase
    .from('memory_facts')
    .select('id, fact_type, content')
    .in('id', factIds);
  for (const f of (data ?? []) as MemoryFactRow[]) map.set(f.id, f.fact_type);
  return map;
}

// =====================================================================
// Money helpers
// =====================================================================

/**
 * Best-effort dollar amount (in cents) for a decision, used by the summary
 * totals. Re-reads the chip-level estimate so totals and chips stay
 * consistent. The money chip is now labelled by `financialLabel` (e.g.
 * "Estimated vendor cost"), so we match by a `$`-prefixed value rather than a
 * fixed label. Returns 0 when no dollar figure is derivable.
 */
function decisionDollarsCents(decision: Decision): number {
  const chip = decision.metricChips.find((c) => c.value.trim().startsWith('$'));
  if (!chip) return 0;
  return parseDollarStringToCents(chip.value) ?? 0;
}

/**
 * Pulls a dollar estimate (in cents) out of a proposal payload. The payload
 * shape is action_type-specific, so we probe a small set of well-known money
 * keys used across the worker payload schemas (e.g. `rentAmount` is whole
 * dollars; `amountCents` is already cents). Returns null when none are present.
 */
function payloadDollarsCents(payload: unknown): number | null {
  if (!payload || typeof payload !== 'object') return null;
  const p = payload as Record<string, unknown>;

  const cents = firstFiniteNumber([p.amountCents, p.amount_cents, p.costCents]);
  if (cents != null) return Math.round(cents);

  const dollars = firstFiniteNumber([
    p.rentAmount,
    p.rent_amount,
    p.amount,
    p.cost,
    p.estimate,
    p.estimatedCost,
  ]);
  if (dollars != null) return Math.round(dollars * 100);

  return null;
}

function firstFiniteNumber(values: readonly unknown[]): number | null {
  for (const v of values) {
    if (typeof v === 'number' && Number.isFinite(v) && v > 0) return v;
  }
  return null;
}

/** 0.82 → 82; clamps to [0,100]; null when not a finite number. */
function confidenceToPct(confidence: number | null): number | null {
  if (confidence == null || !Number.isFinite(Number(confidence))) return null;
  const pct = Math.round(Number(confidence) * 100);
  return Math.max(0, Math.min(100, pct));
}

/** Cents → "$1,850" (whole dollars, en-US grouping). */
function formatDollarsFromCents(cents: number): string {
  const dollars = Math.round(cents / 100);
  return `$${dollars.toLocaleString('en-US')}`;
}

/** "$1,850" → 185000 cents; null when unparseable. */
function parseDollarStringToCents(value: string): number | null {
  const cleaned = value.replace(/[^0-9.]/g, '');
  if (!cleaned) return null;
  const dollars = Number(cleaned);
  if (!Number.isFinite(dollars)) return null;
  return Math.round(dollars * 100);
}

// =====================================================================
// Text helpers (pure)
// =====================================================================

/** "dispatch_vendor" → "Dispatch Vendor". */
function humaniseActionType(actionType: string): string {
  return actionType
    .split('_')
    .map((part) => (part.length === 0 ? part : part[0].toUpperCase() + part.slice(1)))
    .join(' ')
    .trim();
}

/** "dispatch_vendor" → "DISPATCH VENDOR" (eyebrow category). */
function upperEyebrow(actionType: string): string {
  return actionType.replace(/_/g, ' ').toUpperCase().trim() || 'DECISION';
}

/**
 * Owner-facing overrides for action_types whose mechanical humanization reads
 * as internal jargon. `health_flag` is produced by the deterministic daily
 * health-check (stale work orders, lease ending soon, vacancy, stale rent
 * escalation) — "Health Flag" is internal phrasing, so an owner sees a calm,
 * accurate category and title instead. Presentation only; never affects which
 * proposals surface or how they commit.
 */
const OWNER_FACING_LABELS: Record<string, { eyebrow: string; title: string }> = {
  health_flag: {
    eyebrow: 'PORTFOLIO HEALTH',
    title: 'Portfolio follow-up needed',
  },
  // Voice Operator V1 — "Voice Call Review" is internal phrasing; the
  // owner sees what it is: a call Odesa handled that needs their eyes.
  voice_call_review: {
    eyebrow: 'VOICE CALL',
    title: 'Call needs your review',
  },
};

/**
 * Escapes HTML so real `reasoning` text rendered via the card's
 * `dangerouslySetInnerHTML` can't inject markup. The mock copy used trusted
 * inline <b>; real worker reasoning is untrusted plain text, so we neutralize
 * all angle brackets / ampersands.
 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Builds the normalized source chips for a proposal from its `context_fact_ids`
 * and the resolved `id → fact_type` map. Each chip is `{ id, label }` where the
 * label is `normalizeSourceLabel(fact_type)`. PURE. Preserves the proposal's
 * `context_fact_ids` order, skips ids with no resolved fact (provenance we
 * can't honestly back), and caps the strip. Returns `[]` when there is no real
 * provenance — the caller then omits the Sources row entirely (never fabricate).
 *
 * @param contextFactIds - Raw `action_proposals.context_fact_ids`.
 * @param factMap - Resolved `memory_facts` id → fact_type map.
 * @returns Ordered, de-duplicated source chips; empty when none resolve.
 */
export function sourceFactsFor(
  contextFactIds: string[] | null | undefined,
  factMap: Map<string, string>,
): SourceFact[] {
  if (!contextFactIds || contextFactIds.length === 0) return [];

  const chips: SourceFact[] = [];
  const seen = new Set<string>();

  for (const id of contextFactIds) {
    if (seen.has(id)) continue;
    const factType = factMap.get(id);
    if (factType == null) continue; // unresolved fact → no honest chip
    seen.add(id);
    chips.push({ id, label: normalizeSourceLabel(factType) });
    if (chips.length >= MAX_SOURCE_FACTS) break;
  }

  return chips;
}

/**
 * Splits the REAL `reasoning` text into a few short factual "Why this?" lines.
 * Sentence-segments on terminal punctuation, trims, drops empties, and caps the
 * count. PURE and lossless of meaning — it ONLY reshapes the worker's own prose;
 * it never adds alternatives, risk, or any claim the reasoning didn't make.
 * Returns `[]` when reasoning is absent so the caller omits the section.
 *
 * @param reasoning - Raw `action_proposals.reasoning`.
 * @returns Up to {@link MAX_WHY_FACTS} short factual lines.
 */
export function splitWhyFacts(reasoning: string | null | undefined): string[] {
  const text = (reasoning ?? '').trim();
  if (text.length === 0) return [];

  return text
    .split(/(?<=[.!?])\s+/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .slice(0, MAX_WHY_FACTS);
}

function uniq(values: readonly string[]): string[] {
  return Array.from(new Set(values));
}
