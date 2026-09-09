/**
 * Owner Queue — structured, owner-facing reasoning copy.
 *
 * Voice- and policy-originated proposals write INTERNAL enum tokens into
 * `action_proposals.reasoning` — the SMS classifier category (e.g.
 * `payment_cleared_claim`) and an origin tag (`(source: retell_voice, call …)`).
 * Rendered verbatim, those read as raw jargon in the Decisions Desk dossier.
 *
 * This module is the DERIVATION layer that turns that raw string into calm,
 * labeled human sentences — the six-section owner dossier copy (Trigger,
 * Evidence, Safety boundary, Recommended next action, Source, If ignored).
 *
 * PURE — no IO, no React, no Supabase. It REUSES the copy maps in
 * `decision-actions.ts` (`boundaryCopyFor` / `ifIgnoredCopyFor` /
 * `actionLabelFor`) rather than duplicating them, and humanizes the enum tokens
 * through a single lookup each. Unknown tokens get a readable fallback — never
 * a bare token. The raw `reasoning` is NEVER mutated; humanization happens only
 * for display, so the untouched audit string stays available underneath.
 */

import {
  actionLabelFor,
  boundaryCopyFor,
  ifIgnoredCopyFor,
  type Recommendation,
} from './decision-actions';

/** The fixed six owner-dossier section labels, in render order. */
export type OwnerReasoningLabel =
  | 'Trigger'
  | 'Evidence'
  | 'Safety boundary'
  | 'Recommended next action'
  | 'Source'
  | 'If ignored';

/** One labeled, owner-facing sentence of the dossier reasoning. */
export interface OwnerReasoningSection {
  label: OwnerReasoningLabel;
  detail: string;
}

/** Proposal fields the derivation reads. All optional/nullable — fails soft. */
export interface OwnerReasoningInput {
  /** Raw `action_proposals.reasoning` (may embed classifier/source tokens). */
  reasoning: string | null | undefined;
  /** Raw `action_proposals.action_type`. */
  actionType: string | null | undefined;
  /** Raw `action_proposals.gate_decision`. */
  gate: string | null | undefined;
  /** Mock recommendation derived from the gate. */
  recommendation: Recommendation;
  /** Normalized provenance chip labels (from `sourceFacts`); backs Evidence. */
  sourceLabels?: readonly string[];
}

// ---------------------------------------------------------------------------
// Token lookups — one map each; unknown tokens get a readable, non-bare label.
// ---------------------------------------------------------------------------

/**
 * SMS-classifier category token → calm owner sentence. Keys mirror the deny
 * categories + fail-open shapes in `src/lib/voice/policy.ts` (`classifySmsBody`).
 */
const CLASSIFIER_COPY: Record<string, string> = {
  payment_cleared_claim: 'Tenant claims a payment already cleared',
  legal_or_eviction: 'Message used legal or eviction language',
  fee_waiver: 'Message offered to waive or drop a fee',
  payment_plan: 'Message proposed a payment plan',
  appointment_promise: 'Message promised a set appointment',
  lease_change_promise: 'Message promised a lease change',
  dispatch_promise: 'Message promised a vendor dispatch',
  pressure_or_threat: 'Message used pressure or threatening language',
  unmatched: 'Message did not match a known-safe reply shape',
  safe_confirmation: 'Message matched a known-safe confirmation shape',
};

/** Proposal origin token → owner-facing origin. */
const SOURCE_COPY: Record<string, string> = {
  retell_voice: 'Voice call (Retell)',
};

/** Honest default origin for any proposal without an explicit source tag. */
const DEFAULT_SOURCE = 'Odesa property agent';

/**
 * A classifier category token → owner sentence. Unknown tokens get the readable
 * `Automated classifier: <token>` fallback (never a bare token). Empty → ''.
 */
export function humanizeClassifier(token: string | null | undefined): string {
  const key = (token ?? '').trim();
  if (key.length === 0) return '';
  return CLASSIFIER_COPY[key] ?? `Automated classifier: ${key}`;
}

/**
 * A source/origin token → owner sentence. Unknown tokens get the readable
 * `Automated source: <token>` fallback (never a bare token). Empty → ''.
 */
export function humanizeSource(token: string | null | undefined): string {
  const key = (token ?? '').trim();
  if (key.length === 0) return '';
  return SOURCE_COPY[key] ?? `Automated source: ${key}`;
}

// ---------------------------------------------------------------------------
// Reasoning parsing (pure)
// ---------------------------------------------------------------------------

/** A snake_case enum token: `word` + one-or-more `_word` segments. */
const LEADING_CLASSIFIER = /^([a-z0-9]+(?:_[a-z0-9]+)+):\s*([\s\S]*)$/;

/**
 * Trailing origin tag the voice draft appends, e.g. `(source: retell_voice,
 * call call_abc123)` or `(source: retell_voice)`. Anchored to the END so it
 * never eats parentheses inside the human body.
 */
const TRAILING_SOURCE = /\s*\(source:\s*([^,)]+?)(?:\s*,\s*call\s+[^)]+)?\)\s*$/i;

interface ParsedReasoning {
  /** Leading classifier category token, when the reasoning carried one. */
  triggerToken: string | null;
  /** The human reason body, with any classifier prefix + source tag stripped. */
  body: string;
  /** Trailing source/origin token, when present. */
  sourceToken: string | null;
}

/** Splits reasoning into {classifier token, human body, source token}. PURE. */
function parseReasoning(reasoning: string | null | undefined): ParsedReasoning {
  const text = (reasoning ?? '').trim();
  if (text.length === 0) return { triggerToken: null, body: '', sourceToken: null };

  let body = text;
  let sourceToken: string | null = null;
  const src = body.match(TRAILING_SOURCE);
  if (src && src.index != null) {
    sourceToken = src[1].trim();
    body = body.slice(0, src.index).trim();
  }

  let triggerToken: string | null = null;
  const tok = body.match(LEADING_CLASSIFIER);
  if (tok) {
    triggerToken = tok[1];
    body = tok[2].trim();
  }

  return { triggerToken, body, sourceToken };
}

/** Sentence-segments on terminal punctuation; trims; drops empties. PURE. */
function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

// ---------------------------------------------------------------------------
// Public derivation
// ---------------------------------------------------------------------------

/**
 * The primary "Odesa recommends" one-liner: the raw reasoning with any internal
 * classifier prefix humanized and the origin tag stripped. A no-op for
 * already-clean human reasoning (returns it trimmed). Empty → ''.
 *
 * @param reasoning - Raw `action_proposals.reasoning`.
 * @returns Token-free, source-free owner copy for the headline line.
 */
export function cleanReasoning(reasoning: string | null | undefined): string {
  const { triggerToken, body, sourceToken } = parseReasoning(reasoning);
  // Nothing internal to rewrite — return the human text as-is (trimmed).
  if (triggerToken == null && sourceToken == null) {
    return (reasoning ?? '').trim();
  }
  const parts: string[] = [];
  if (triggerToken) parts.push(humanizeClassifier(triggerToken));
  if (body.length > 0) parts.push(body);
  return parts.join(' — ').trim();
}

/**
 * Derives the structured six-section owner-dossier copy from a proposal's real
 * fields. Sections are emitted in fixed order; Trigger/Evidence are omitted only
 * when there is no reasoning to back them (never invented). Boundary, next
 * action, source, and if-ignored always resolve from the action's nature.
 *
 * @param input - The proposal's raw fields (see {@link OwnerReasoningInput}).
 * @returns Ordered, humanized {label, detail} sections; never raw tokens.
 */
export function deriveOwnerReasoning(
  input: OwnerReasoningInput,
): OwnerReasoningSection[] {
  const { reasoning, actionType, gate, recommendation, sourceLabels } = input;
  const { triggerToken, body, sourceToken } = parseReasoning(reasoning);
  const sections: OwnerReasoningSection[] = [];

  // Trigger / Evidence — from the real reasoning only.
  let triggerDetail = '';
  let evidenceBody = '';
  if (triggerToken) {
    triggerDetail = humanizeClassifier(triggerToken);
    evidenceBody = body; // the classifier's human reason is the evidence
  } else if (body.length > 0) {
    const [first, ...rest] = splitSentences(body);
    triggerDetail = first ?? '';
    evidenceBody = rest.join(' ');
  }
  if (triggerDetail.length > 0) {
    sections.push({ label: 'Trigger', detail: triggerDetail });
  }

  const evidenceParts: string[] = [];
  if (evidenceBody.length > 0) evidenceParts.push(evidenceBody);
  const labels = (sourceLabels ?? []).filter((l) => l.trim().length > 0);
  if (labels.length > 0) evidenceParts.push(`Backed by ${labels.join(' · ')}.`);
  if (evidenceParts.length > 0) {
    sections.push({ label: 'Evidence', detail: evidenceParts.join(' ') });
  }

  // Safety boundary — reuse the shared copy map (always non-empty).
  const boundary = boundaryCopyFor(actionType).trim();
  if (boundary.length > 0) {
    sections.push({ label: 'Safety boundary', detail: boundary });
  }

  // Recommended next action — the primary button verb (reused, never "Hold").
  sections.push({
    label: 'Recommended next action',
    detail: actionLabelFor(actionType, recommendation),
  });

  // Source — humanized origin token, else the honest automated default.
  sections.push({
    label: 'Source',
    detail: sourceToken ? humanizeSource(sourceToken) : DEFAULT_SOURCE,
  });

  // If ignored — reuse the shared copy map (always non-empty).
  const ifIgnored = ifIgnoredCopyFor(actionType, gate).trim();
  if (ifIgnored.length > 0) {
    sections.push({ label: 'If ignored', detail: ifIgnored });
  }

  return sections;
}
