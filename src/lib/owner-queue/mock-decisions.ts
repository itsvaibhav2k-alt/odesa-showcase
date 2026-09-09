/**
 * Owner Queue — decision TYPES.
 *
 * The `/owner-queue` "Decisions Desk" page renders the `Decision` /
 * `DecisionSummary` / `MetricChip` / `Consideration` / `DecisionEditDraft`
 * shapes defined here. The live VALUE adapter (which reads the real
 * `action_proposals` table, RLS-scoped) lives in
 * `src/lib/owner-queue/queries.ts`; the page imports its `getDecisions*` /
 * `getDecisionSummary` from there. This module is now TYPES-ONLY — the legacy
 * static mock array and its helpers were removed once the real adapter shipped.
 */

export type DecisionRecommendation = 'approve' | 'hold' | 'decline';

export interface MetricChip {
  label: string;
  value: string;
  /** Renders the clay "risk" chip style. */
  isRisk?: boolean;
}

export interface Consideration {
  label: string;
  /**
   * Trusted, hardcoded mock copy that may contain inline <b> tags; rendered
   * via dangerouslySetInnerHTML. SANITIZE before rendering real/user data.
   */
  detail: string;
}

export interface Decision {
  id: string;
  recommendation: DecisionRecommendation;
  /** Eyebrow category, e.g. "VENDOR DISPATCH". */
  type: string;
  /** Eyebrow location, e.g. "14 MAPLE CT · UNIT 3B". */
  location: string;
  title: string;
  /** First four metric chips (label/value), risk-flagged. */
  metricChips: MetricChip[];
  /** Rationale paragraph; may contain inline <b> (trusted mock copy). */
  odesaLine: string;
  /** "Impact" line text. */
  impact: string;
  /** "Sources" list. */
  sources: string[];
  /** Expanded "Odesa's reasoning" rows. */
  considerations: Consideration[];
  /** "View source" provenance blurb. */
  sourceNote: string;
  /** Per-decision Ask Odesa placeholder (reserved for future per-card scope). */
  askPlaceholder: string;
  /** Per-decision Ask Odesa suggestion chips (reserved for future per-card scope). */
  askSuggestions: string[];

  // -------------------------------------------------------------------------
  // Decision-control adapter fields (owner-queue Pass 1).
  //
  // All OPTIONAL so existing tests keep compiling. Populated by `queries.ts`
  // from real `action_proposals` data and the pure maps in
  // `decision-actions.ts`. Render a field ONLY when it is present — never
  // fabricate (no spend caps, ETAs, risk scores, etc.).
  // -------------------------------------------------------------------------

  /** Raw `action_proposals.action_type` (e.g. 'dispatch_vendor'); drives the maps. */
  actionType?: string;
  /** Owning property id (for the "Save as owner guidance" scope). */
  propertyId?: string;
  /** Gate reason line pairing display + cause, e.g. "Owner review required — tenant-facing". */
  gateReason?: string;
  /** Conservative consequence copy, e.g. "No tenant-facing message sends until you approve it." */
  boundary?: string;
  /** Honest "if you do nothing" copy, e.g. "No message is sent — … stays pending in your queue." */
  ifIgnored?: string;
  /** Final primary-action label, e.g. "Record dispatch approval" / "Preview + approve". */
  primaryActionLabel?: string;
  /** Money-chip relabel, e.g. "Estimated vendor cost"; null when no figure exists. */
  financialLabel?: string | null;
  /** Which edit form (if any) the drawer opens; null when not editable. */
  editKind?: 'message' | 'dispatch' | 'rent_payment' | 'lease' | null;
  /** Structured "Why this?" facts derived from REAL reasoning only. */
  whyFacts?: string[];
  /**
   * Structured, owner-facing dossier reasoning — the six labeled sections
   * (Trigger / Evidence / Safety boundary / Recommended next action / Source /
   * If ignored) derived from the proposal's real fields via
   * `deriveOwnerReasoning`. Humanized so no raw classifier/source enum token
   * ever surfaces; the untouched raw reasoning stays in `rawReasoning`.
   */
  reasoningSections?: import('./owner-reasoning').OwnerReasoningSection[];
  /**
   * The untouched raw `action_proposals.reasoning` audit string, present ONLY
   * when it carried internal tokens the display copy humanized away — so the
   * dossier can surface the exact audit trail underneath the human copy.
   */
  rawReasoning?: string;
  /** Owner-facing decision state used for card feedback. */
  state?: 'recommended' | 'edited' | 'approved' | 'declined';
  /** Normalized, short source chips; omitted/empty when no provenance exists. */
  sourceFacts?: { id: string; label: string }[];
  /**
   * Current editable values for the decision-edit drawer (Pass 2). Carries ONLY
   * real per-type schema fields — never a fabricated figure — so the drawer can
   * pre-fill its inputs and diff the owner's edits into a payload patch. Each
   * sub-field is optional; populated by `queries.ts` from the proposal's real
   * `payload` (and a tenant-facing recipient/channel label from `payload`).
   * Omitted entirely when the proposal has no editable payload.
   */
  editDraft?: DecisionEditDraft;
}

/**
 * The drawer's editable initial values, per `editKind`. Every field maps 1:1 to
 * a real worker payload key (see `WORKER_PAYLOAD_SCHEMAS`); nothing here is
 * invented. The recipient/channel pair is a presentational label derived from
 * the payload's `tenantName` for the tenant-facing preview — never the raw
 * tenant id.
 */
export interface DecisionEditDraft {
  // message (draft_sms_reply / send_tenant_message)
  /** payload.body — the tenant-facing message text. */
  body?: string;
  /** payload.tone — draft_sms_reply only. */
  tone?: 'neutral' | 'firm' | 'warm' | 'apologetic';
  // dispatch (dispatch_vendor)
  /** payload.smsBody — the message Odesa would send the vendor. */
  smsBody?: string;
  /** Read-only resolved vendor label for the dispatch form (display only). */
  vendorLabel?: string;
  // rent_payment (request_rent_payment)
  /** payload.amountCents — surfaced/edited in whole dollars by the drawer. */
  amountCents?: number;
  /** payload.dueDate — ISO 'YYYY-MM-DD'. */
  dueDate?: string;
  // lease (update_rent / set_lease_terms)
  /** payload.rentAmount — whole dollars (schema is an integer). */
  rentAmount?: number;
  /** payload.rentDueDay — set_lease_terms only (1–28). */
  rentDueDay?: number;
  /** payload.startDate — set_lease_terms only, ISO 'YYYY-MM-DD'. */
  startDate?: string;
  /** payload.endDate — set_lease_terms only, ISO 'YYYY-MM-DD'. */
  endDate?: string;
  /** True when the lease action is set_lease_terms (shows the extra fields). */
  isFullLease?: boolean;
  // shared tenant-facing preview labels (presentational only, never the raw id)
  /** Display recipient for the preview block, e.g. a tenant first name or "Tenant". */
  recipientLabel?: string;
  /** Display channel for the preview block, e.g. "SMS". */
  channel?: string;
}

/** Page-level summary shown in the top bar + banner. */
export interface DecisionSummary {
  pendingCount: number;
  /** Formatted total at stake across all pending decisions, e.g. "$4,090". */
  totalAtStake: string;
  timeSensitiveCount: number;
  /** Formatted one-time cash total of the routine batch, e.g. "$4,040". */
  routineTotal: string;
}
