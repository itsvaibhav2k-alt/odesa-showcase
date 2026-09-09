/**
 * Shared display copy for the /calls surface — caller-kind labels, intent
 * chip wording, time formatting, named-action labels, humanized outcome
 * sentences, review reasons, and next-move destination logic.
 *
 * Pure at runtime; the only imports are TYPE-only (erased at compile), so no
 * server/client coupling and no runtime dependency on the data layer.
 */

import type {
  CallReview,
  VoiceCallDetail,
  VoiceCallListItem,
} from "@/lib/voice/queries";

export const CALLER_KIND_LABELS: Record<string, string> = {
  verified_owner: "Owner",
  verified_tenant: "Tenant",
  likely_tenant: "Likely tenant",
  known_vendor: "Vendor",
  unknown_caller: "Unknown caller",
  ambiguous: "Unverified caller",
};

/** A value that reads as a bare phone number, e.g. '+15555551234' or '(571) 555-0101'. */
const PHONE_LIKE = /^\+?[\d\s()\-.]{7,}$/;

/**
 * Privacy-safe caller label for card/list chrome — a real name when we have
 * one, otherwise the caller-kind label ('Unknown caller', 'Tenant', …). Never
 * surfaces a raw/unmasked phone number, since `VoiceCallListItem.callerLabel`
 * falls back to `from_number` when no tenant/vendor name resolves.
 */
export function safeCallerLabel(
  callerLabel: string,
  callerKind: string,
): string {
  if (callerLabel && !PHONE_LIKE.test(callerLabel.trim())) return callerLabel;
  return CALLER_KIND_LABELS[callerKind] ?? "Caller";
}

/** 'maintenance_request' → 'Maintenance request'. */
export function intentLabel(intent: string): string {
  const words = intent.replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Compact operator-console timestamp, e.g. 'Jul 6, 12:58 AM'. */
export function timeLabel(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

// ---------------------------------------------------------------------------
// Named actions — canonical action ids → human labels (never "N actions")
// ---------------------------------------------------------------------------

/** Human label per canonical VoiceActionId (see src/lib/voice/policy.ts, READ-ONLY). */
const ACTION_LABELS: Record<string, string> = {
  // tier 0 — answer-only
  answer_rent_status: "Rent status answered",
  answer_lease_question: "Lease question answered",
  provide_owner_briefing: "Owner briefing provided",
  collect_vendor_status: "Vendor status collected",
  // tier 1 — record
  record_call_note: "Note recorded",
  record_callback_request: "Callback recorded",
  // tier 2 — act, reversible
  create_work_order: "Work order created",
  send_safe_confirmation_sms: "Confirmation SMS provider-accepted",
  request_payment_proof_sms: "Payment proof requested",
  request_photo_sms: "Photo requested",
  notify_owner: "Owner notified",
  create_owner_queue_item: "Owner Queue item created",
  schedule_callback: "Callback scheduled",
  escalate_to_landlord: "Escalation logged",
  // tier 3 — draft for approval (rare in autonomousActions, kept for completeness)
  create_followup_sms_draft: "Follow-up SMS drafted",
  send_rent_reminder: "Rent reminder drafted",
  coordinate_vendor: "Vendor coordination drafted",
  schedule_access_entry: "Access entry drafted",
};

/** Records that may exist without a matching tier<=2 action label (fallback only). */
const RECORD_LABELS: Record<string, string> = {
  work_order: "Work order created",
  proposal: "Owner Queue item created",
};

/**
 * Named action labels for a call, deduped and order-preserving. Derived from
 * executed action ids first, then any canonical record that has no matching
 * action label. NEVER emits a vague "N actions" — unknown ids are dropped.
 */
export function namedActions(
  call: Pick<VoiceCallListItem, "actionIds" | "recordsCreated">,
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (label: string): void => {
    if (!seen.has(label)) {
      seen.add(label);
      out.push(label);
    }
  };
  for (const id of call.actionIds) {
    const label = ACTION_LABELS[id];
    if (label) push(label);
  }
  for (const { kind } of call.recordsCreated) {
    const label = RECORD_LABELS[kind];
    if (label) push(label);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Outcome sentence — humanized summary from structured fields
// ---------------------------------------------------------------------------

function lowerFirst(text: string): string {
  return text ? text.charAt(0).toLowerCase() + text.slice(1) : text;
}

/** 'a' | 'a and b' | 'a, b and c'. */
function joinList(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/**
 * Humanized one-sentence outcome built from structured fields — caller + the
 * topics handled + the named actions Odesa took. NOT the raw compiler
 * `oneSentence`. Falls back to the stored summary, then a neutral phrase, when
 * no structured fields are present.
 */
export function outcomeSentence(
  call: Pick<
    VoiceCallListItem,
    "callerKind" | "intents" | "actionIds" | "recordsCreated" | "summary"
  >,
): string {
  const caller = CALLER_KIND_LABELS[call.callerKind] ?? "Caller";
  const topics = call.intents
    .slice(0, 2)
    .map((i) => lowerFirst(intentLabel(i)));
  const actions = namedActions(call);

  if (topics.length === 0 && actions.length === 0) {
    return call.summary?.trim() || "No structured outcome was recorded.";
  }

  const base = topics.length
    ? `${caller} called about ${joinList(topics)}`
    : `${caller} call handled`;
  const tail = actions.length ? ` — ${actions.map(lowerFirst).join(", ")}` : "";
  return `${base}${tail}.`;
}

// ---------------------------------------------------------------------------
// Review reason + next move
// ---------------------------------------------------------------------------

/** Joins the derived review reasons into one operator-facing line. */
export function reviewReason(
  review: Pick<CallReview, "reviewReasons">,
): string {
  return review.reviewReasons.join(" · ");
}

export interface NextMove {
  label: string;
  href: string | null;
  tone: string;
}

const UNVERIFIED_KINDS = new Set(["unknown_caller", "ambiguous"]);

/**
 * Truthful next-move destination for a call detail.
 *
 * Owner-queue link ONLY when a real proposal exists — a `proposal` record, or a
 * pending approval on a call that actually resolved to a property (mirrors
 * `needsOwnerReview()` in src/lib/voice/outcomes.ts). A risk flag with no
 * proposal routes to the inbox conversation / call record, never the owner
 * queue. Unknown callers get the honest "no private data disclosed" line.
 */
export function nextMove(
  detail: Pick<
    VoiceCallDetail,
    "callerKind" | "conversationId" | "propertyId" | "recordsCreated" | "review"
  >,
): NextMove {
  const { review } = detail;
  const hasProposalRecord = detail.recordsCreated.some(
    (r) => r.kind === "proposal",
  );
  const proposalExists =
    hasProposalRecord ||
    (review.approvalCount > 0 && detail.propertyId !== null);

  if (proposalExists) {
    return {
      label: "Review in Owner Queue",
      href: "/owner-queue",
      tone: "clay",
    };
  }

  if (review.needsReview) {
    if (UNVERIFIED_KINDS.has(detail.callerKind)) {
      return {
        label: "Identity not verified; no private data disclosed",
        href: null,
        tone: "neutral",
      };
    }
    if (detail.conversationId) {
      return {
        label: "Review conversation in inbox",
        href: "/inbox",
        tone: "clay",
      };
    }
    return { label: "Review this call record", href: null, tone: "clay" };
  }

  if (review.resolvedAutomatically) {
    return { label: "No owner action needed", href: null, tone: "green" };
  }

  if (UNVERIFIED_KINDS.has(detail.callerKind)) {
    return {
      label: "Identity not verified; no private data disclosed",
      href: null,
      tone: "neutral",
    };
  }
  return {
    label: "No completed outcome recorded",
    href: null,
    tone: "neutral",
  };
}
