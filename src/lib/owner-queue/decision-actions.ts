/**
 * Owner Queue — pure decision-control maps.
 *
 * Keyed on a proposal's `action_type` and `gate_decision`, these helpers turn
 * raw `action_proposals` columns into the calm, honest copy the Decisions Desk
 * renders. They are intentionally PURE (no IO, no React, no Supabase) so they
 * stay trivially unit-testable and shareable between the server adapter
 * (`queries.ts`) and the client cards.
 *
 * HARD RULES (this is a property-management product — false confidence is worse
 * than an empty state):
 *   - Never fabricate. No spend caps, ETAs, legal/risk scores, alternatives,
 *     audit history, or enforced rules. Only ever produce copy for fields the
 *     proposal actually has.
 *   - Display language is fixed: gate `auto` → "Recommended", `review` →
 *     "Owner review required", `block` → "Not recommended".
 *   - NEVER emit "Hold", "Switch now", or "Authorize". `dispatch_vendor`'s
 *     primary label is "Record dispatch approval" (committing it does NOT contact the
 *     vendor). Owner-taught guidance is "Save as owner guidance", never an
 *     "enforced rule".
 */

/** Worker `gate_decision` values that map to display language. */
export type Gate = 'auto' | 'review' | 'block';

/** Same recommendation union the mock/page already speaks. */
export type Recommendation = 'approve' | 'hold' | 'decline';

/** Per-type edit form the drawer opens (Pass 2); null when not editable. */
export type EditKind = 'message' | 'dispatch' | 'rent_payment' | 'lease' | null;

/**
 * The only two ways a card click is allowed to commit a proposal WITHOUT first
 * opening the edit drawer (see {@link directCommitKindFor}). 'acknowledge' is a
 * pure no-op record (health flags); 'dispatch' records a vendor approval.
 */
export type DirectCommitKind = 'acknowledge' | 'dispatch';

// ---------------------------------------------------------------------------
// Action types we render purpose-built copy for. Anything outside this set
// falls back to conservative generic copy (never invented specifics).
// ---------------------------------------------------------------------------

const TENANT_FACING_TYPES = new Set<string>([
  'draft_sms_reply',
  'send_tenant_message',
]);

const LEASE_TYPES = new Set<string>(['set_lease_terms', 'update_rent']);

// ---------------------------------------------------------------------------
// directCommitKindFor — the SAFETY BOUNDARY for committing straight from a
// card click, with no edit drawer in between.
// ---------------------------------------------------------------------------

/**
 * The kind of direct (drawer-less) commit a card click may perform for a
 * proposal, or null when the type must NOT direct-commit.
 *
 * This is a deliberate ALLOW-LIST, never a deny-list. Only three action types
 * may ever commit straight from the card:
 *   - 'health_flag'        → 'acknowledge' (a pure no-op record; nothing is
 *                            sent and no property data changes)
 *   - 'voice_call_review'  → 'acknowledge' (same honest no-op: the call already
 *                            happened; acknowledging records that the owner
 *                            reviewed its outcome)
 *   - 'dispatch_vendor'    → 'dispatch'    (records the owner's approval; does
 *                            NOT contact the vendor)
 *
 * EVERYTHING ELSE returns null. Message / money / lease types carry a non-null
 * {@link editKindFor} and must open the drawer to preview before committing;
 * informational or unknown types ('update_rulebook', and any verb we don't
 * recognize) must NEVER silently commit. Because this is an allow-list, an
 * unmapped or newly added action_type fails closed (null) — it can never
 * accidentally inherit direct-commit power. This is the boundary that prevents
 * the misleading silent-commit bug.
 *
 * @param actionType - Raw `action_proposals.action_type`.
 * @returns 'acknowledge' | 'dispatch', or null when direct commit is forbidden.
 */
export function directCommitKindFor(
  actionType: string,
): DirectCommitKind | null {
  if (actionType === 'health_flag') return 'acknowledge';
  if (actionType === 'voice_call_review') return 'acknowledge';
  if (actionType === 'dispatch_vendor') return 'dispatch';
  return null;
}

// ---------------------------------------------------------------------------
// actionLabelFor — the FINAL primary-action button label.
// ---------------------------------------------------------------------------

/**
 * The primary-action button label for a proposal.
 *
 * - A `block` gate ("Not recommended") always reads "Decline".
 * - `dispatch_vendor` → "Record dispatch approval" (never "Authorize"; committing it
 *   records the approval but does NOT contact the vendor).
 * - `health_flag` / `voice_call_review` → "Acknowledge" (a pure no-op record;
 *   the only honest verb for an informational flag — nothing is sent and no
 *   property data changes).
 * - `update_rulebook` → "Review guidance" (a non-committing, drawer-bound label;
 *   it must never read as a one-click write).
 * - lease/rent money writes and `request_rent_payment` → "Edit terms" (the money
 *   drawer opens for preview before anything is requested or changed).
 * - tenant-facing messages → "Preview + approve" (preview before any send).
 * - lease-renewal drafting → "Draft renewal".
 * - anything we want a human to look at without a purpose-built verb →
 *   "Escalate to owner".
 *
 * @param actionType - Raw `action_proposals.action_type`.
 * @param recommendation - Mock recommendation derived from the gate.
 * @returns The button label; never "Hold", "Switch now", or "Authorize".
 */
export function actionLabelFor(
  actionType: string | null | undefined,
  recommendation: Recommendation,
): string {
  if (recommendation === 'decline') return 'Decline';

  const type = actionType ?? '';

  if (type === 'dispatch_vendor') return 'Record dispatch approval';
  if (type === 'health_flag') return 'Acknowledge';
  if (type === 'voice_call_review') return 'Acknowledge';
  if (type === 'update_rulebook') return 'Review guidance';
  if (LEASE_TYPES.has(type)) return 'Edit terms';
  if (type === 'request_rent_payment') return 'Edit terms';
  if (TENANT_FACING_TYPES.has(type)) return 'Preview + approve';
  if (type === 'archive_lease') return 'Draft renewal';
  if (type === 'log_maintenance_ticket') return 'Log ticket';

  return 'Escalate to owner';
}

// ---------------------------------------------------------------------------
// boundaryCopyFor — conservative consequence copy ("what this does NOT do").
// ---------------------------------------------------------------------------

/**
 * Calm "what this action does and does not do" copy, so an owner is never
 * surprised by a side effect.
 *
 * @param actionType - Raw `action_proposals.action_type`.
 * @returns Boundary sentence; an empty string when no specific boundary applies.
 */
export function boundaryCopyFor(actionType: string | null | undefined): string {
  const type = actionType ?? '';

  if (type === 'dispatch_vendor') {
    return 'Vendor is not contacted from this action — Odesa records your approval for the dispatch workflow.';
  }
  if (TENANT_FACING_TYPES.has(type)) {
    return 'No tenant-facing message sends until you approve it.';
  }
  if (type === 'request_rent_payment') {
    return 'No payment request sends until you approve it.';
  }
  if (LEASE_TYPES.has(type)) {
    return 'Lease terms only change once you approve them.';
  }
  if (type === 'log_maintenance_ticket') {
    return 'Creates an internal work-order record — no tenant or vendor is contacted.';
  }
  if (type === 'health_flag') {
    return 'Records that you reviewed this flag — nothing is sent and no property data changes.';
  }
  if (type === 'voice_call_review') {
    return 'Records that you reviewed this call — nothing is sent and no property data changes.';
  }

  return 'Draft only — nothing sends until approved.';
}

// ---------------------------------------------------------------------------
// ifIgnoredCopyFor — honest "what happens if you do nothing" copy.
// ---------------------------------------------------------------------------

/**
 * Calm, honest "if you do nothing" consequence copy for a proposal, so the
 * owner always knows what inaction means. Like {@link boundaryCopyFor}, this is
 * a PURE map keyed only on the action's nature — it never invents deadlines,
 * fees, or escalations the proposal doesn't carry.
 *
 * @param actionType - Raw `action_proposals.action_type`.
 * @param gate - Raw `action_proposals.gate_decision` (a 'block' gate reads as
 *   "stays pending until you decline it").
 * @returns The consequence sentence; never empty.
 */
export function ifIgnoredCopyFor(
  actionType: string | null | undefined,
  gate: string | null | undefined,
): string {
  const type = actionType ?? '';

  // A health flag is a review-only record, not a pending side effect — its
  // honest "do nothing" copy is simply that it stays flagged here.
  if (type === 'health_flag') {
    return 'If you do nothing, this stays flagged here.';
  }
  // A voice call review is likewise informational — the call already
  // happened; nothing further is pending.
  if (type === 'voice_call_review') {
    return 'If you do nothing, this call summary stays here for your review.';
  }

  let consequence = 'Nothing happens on its own.';
  if (TENANT_FACING_TYPES.has(type)) {
    consequence = 'No message is sent — the tenant hears nothing from Odesa.';
  } else if (type === 'request_rent_payment') {
    consequence =
      'No payment link is sent and the balance stays outstanding.';
  } else if (LEASE_TYPES.has(type)) {
    consequence =
      'The lease keeps its current terms — no rent change takes effect.';
  } else if (type === 'dispatch_vendor') {
    consequence =
      'No dispatch is recorded and the work order stays open and unassigned.';
  } else if (type === 'log_maintenance_ticket') {
    consequence = 'No work-order record is created — the report goes untracked.';
  }

  const pending =
    gate === 'block'
      ? 'The proposal stays pending here until you decline it.'
      : 'The decision stays pending in your queue.';

  return `${consequence} ${pending}`;
}

// ---------------------------------------------------------------------------
// financialLabelFor — relabels the money chip; null when no figure exists.
// ---------------------------------------------------------------------------

/**
 * The honest label for a proposal's money chip. Callers must only render this
 * when a real dollar figure is present on the payload.
 *
 * @param actionType - Raw `action_proposals.action_type`.
 * @returns A money-chip label, or null when this action carries no figure.
 */
export function financialLabelFor(
  actionType: string | null | undefined,
): string | null {
  const type = actionType ?? '';

  if (type === 'request_rent_payment') return 'Outstanding balance';
  if (type === 'dispatch_vendor') return 'Estimated vendor cost';
  if (LEASE_TYPES.has(type)) return 'Proposed rent';
  if (TENANT_FACING_TYPES.has(type)) return 'Authorization requested';

  return null;
}

// ---------------------------------------------------------------------------
// editKindFor — which drawer form (Pass 2) this proposal opens.
// ---------------------------------------------------------------------------

/**
 * Which edit form the decision drawer should render for a proposal, or null
 * when the proposal has no supported editable payload.
 *
 * @param actionType - Raw `action_proposals.action_type`.
 * @returns The edit kind, or null when not editable.
 */
export function editKindFor(actionType: string | null | undefined): EditKind {
  const type = actionType ?? '';

  if (type === 'dispatch_vendor') return 'dispatch';
  if (type === 'request_rent_payment') return 'rent_payment';
  if (LEASE_TYPES.has(type)) return 'lease';
  if (TENANT_FACING_TYPES.has(type)) return 'message';

  return null;
}

// ---------------------------------------------------------------------------
// guidanceDefaultFor — a meaningful, EDITABLE starting point for the
// "Save as owner guidance" dialog (the owner edits it before saving).
// ---------------------------------------------------------------------------

/**
 * A sensible default line of owner guidance for a decision, by edit kind. This
 * is a STARTING POINT the owner edits before saving — never the bare decision
 * title (which carries no instruction). Saving appends the owner's final text
 * to the property rulebook as guidance Odesa considers in future drafts.
 *
 * @param actionType - Raw `action_proposals.action_type`.
 * @param title - The decision title, used only for the generic fallback.
 * @returns An editable guidance sentence.
 */
export function guidanceDefaultFor(
  actionType: string | null | undefined,
  title?: string | null,
): string {
  switch (editKindFor(actionType)) {
    case 'message':
      return 'When a tenant raises a request like this, reply in a warm, professional tone and keep me posted before anything escalates.';
    case 'dispatch':
      return 'For emergency repairs like this, approve the recommended vendor for same-day dispatch when they are a trusted match.';
    case 'rent_payment':
      return 'When a tenant asks to pay by card, send a one-time payment link before applying any late fee.';
    case 'lease':
      return 'Use the proposed renewal terms unless market comps clearly justify a different rent.';
    default: {
      const t = (title ?? '').trim();
      return t.length > 0
        ? `Handle "${t}" decisions like this going forward.`
        : 'Handle decisions like this the same way going forward.';
    }
  }
}

// ---------------------------------------------------------------------------
// gateDisplayFor — fixed gate → display language.
// ---------------------------------------------------------------------------

/**
 * The owner-facing display label for a gate decision. This mapping is fixed:
 * no "Hold", no "Snooze", no scheduling language (no such workflow exists).
 *
 * @param gate - Raw `action_proposals.gate_decision`.
 * @returns "Recommended" / "Owner review required" / "Not recommended".
 */
export function gateDisplayFor(gate: string | null | undefined): string {
  switch (gate) {
    case 'auto':
      return 'Recommended';
    case 'block':
      return 'Not recommended';
    case 'review':
    default:
      return 'Owner review required';
  }
}

// ---------------------------------------------------------------------------
// gateReasonFor — pairs the gate display with WHY it landed there.
// ---------------------------------------------------------------------------

/**
 * A single line pairing the gate display with the honest reason it gated, so
 * a confidence number never reads as a magical score. Reasons are drawn only
 * from the action's nature (tenant-facing / money / lease) — never invented.
 *
 * @param gate - Raw `action_proposals.gate_decision`.
 * @param actionType - Raw `action_proposals.action_type`.
 * @returns e.g. "Owner review required — tenant-facing".
 */
export function gateReasonFor(
  gate: string | null | undefined,
  actionType: string | null | undefined,
): string {
  const display = gateDisplayFor(gate);
  const cause = gateCauseFor(actionType);
  return cause ? `${display} — ${cause}` : display;
}

/** The short "why it gated" clause appended to the gate display. */
function gateCauseFor(actionType: string | null | undefined): string {
  const type = actionType ?? '';

  if (TENANT_FACING_TYPES.has(type)) return 'tenant-facing';
  if (type === 'request_rent_payment') return 'requests a payment';
  if (LEASE_TYPES.has(type)) return 'changes lease terms';
  if (type === 'dispatch_vendor') return 'spends money';

  return '';
}

// ---------------------------------------------------------------------------
// normalizeSourceLabel — memory_facts.fact_type → clean, short chip label.
// ---------------------------------------------------------------------------

/** Hard cap for unknown fact-type chip labels so the strip never sprawls. */
const SOURCE_LABEL_MAX = 24;

const SOURCE_LABELS: Record<string, string> = {
  rent_ledger: 'Rent ledger',
  tenant_pattern: 'Tenant messages',
  tenant_message: 'Tenant messages',
  lease: 'Lease terms',
  vendor_relationship: 'Vendor estimate',
  work_order: 'Work order',
  market_comp: 'Market comps',
};

/**
 * Maps a raw `memory_facts.fact_type` to a clean, short source-chip label.
 * Unknown types are humanized (underscores → spaces, capitalized) and
 * truncated so a noisy fact type can never blow out the chip row.
 *
 * @param factType - Raw `memory_facts.fact_type`.
 * @returns A short, display-safe label.
 */
export function normalizeSourceLabel(
  factType: string | null | undefined,
): string {
  const type = (factType ?? '').trim();
  if (type.length === 0) return 'Source';

  const known = SOURCE_LABELS[type];
  if (known) return known;

  const humanized = type
    .split(/[_\s]+/)
    .filter((part) => part.length > 0)
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join(' ')
    .trim();

  if (humanized.length <= SOURCE_LABEL_MAX) return humanized;
  return `${humanized.slice(0, SOURCE_LABEL_MAX - 1).trimEnd()}…`;
}
