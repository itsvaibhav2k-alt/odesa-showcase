"use client";

import type { CSSProperties } from "react";
import type { Decision } from "@/lib/owner-queue/mock-decisions";

/**
 * Shared, honest "evidence" affordances for both Decision cards (owner-queue
 * Pass 1). Each piece is rendered only when the proposal actually carries the
 * backing data — never fabricated:
 *
 *   - <SourceChips>: normalized, short `sourceFacts` chips (hidden when none).
 *   - <WhyThisDisclosure>: structured label/detail rows (Trigger / Evidence /
 *     Owner boundary / Recommendation / If ignored) built from the proposal's
 *     REAL adapter fields; says "Reasoning unavailable" when whyFacts is empty.
 *   - <ConsequencePair>: the calm decision-consequence block pairing the
 *     "Safeguard" currently holding the action against the "If you do nothing"
 *     cost of inaction, aligned so an owner can weigh both at a glance. Each
 *     line collapses when its copy is missing; the block hides when both are.
 *
 * Presentational only. The parent card owns disclosure open/closed state and
 * passes it via `isOpen`, mirroring `ReasoningDisclosure`.
 */

// ---------------------------------------------------------------------------
// De-emphasized confidence + gate-reason line (Hermes constraint #9)
// ---------------------------------------------------------------------------

/**
 * The calm, owner-facing gate-reason headline for a decision card, e.g.
 * "Owner review required — tenant-facing". A bare model-confidence percentage
 * ("100% · …") reads as an internal debug score to an owner, so confidence is
 * deliberately NOT folded into the headline (and `metricChipsWithoutConfidence`
 * keeps it out of the chip strip too); the explanation is carried by the
 * adapter's gate-reason line alone. Returns an empty string when the adapter
 * supplied no gate reason — the caller then renders nothing.
 *
 * `metricChips` is retained in the signature for call-site compatibility with
 * both decision cards; confidence is intentionally no longer read from it.
 *
 * @param metricChips - The proposal's metric chips (no longer read; see above).
 * @param gateReason - The adapter's "Owner review required — …" line.
 * @returns The gate-reason headline, or '' when there is nothing to show.
 */
export function confidenceGateLine(
  metricChips: Decision["metricChips"],
  gateReason: Decision["gateReason"],
): string {
  void metricChips;
  return (gateReason ?? "").trim();
}

/**
 * The metric-chip strip with the "Confidence" chip removed. A raw model
 * confidence percentage is internal-facing, so it is never shown to an owner —
 * not as a chip here, and not in the gate-reason headline. Pure; returns a new
 * array (never mutates the input).
 *
 * @param metricChips - The proposal's metric chips.
 * @returns A new array without the confidence chip.
 */
export function metricChipsWithoutConfidence(
  metricChips: Decision["metricChips"],
): Decision["metricChips"] {
  return (metricChips ?? []).filter(
    (chip) => chip.label.toLowerCase() !== "confidence",
  );
}

// ---------------------------------------------------------------------------
// Source chips
// ---------------------------------------------------------------------------

const sourceRowStyle: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  alignItems: "center",
  gap: 6,
};

const sourceLabelStyle: CSSProperties = {
  fontFamily: "var(--font-mono-operator), ui-monospace, monospace",
  fontSize: "9.5px",
  fontWeight: 500,
  letterSpacing: "0.1em",
  textTransform: "uppercase",
  color: "var(--ink-3)",
  marginRight: 2,
};

const sourceChipStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  fontSize: "11px",
  color: "var(--ink-2)",
  background: "var(--canvas)",
  border: "1px solid var(--hairline)",
  borderRadius: 5,
  padding: "3px 8px",
  letterSpacing: "-0.002em",
  whiteSpace: "nowrap",
};

export interface SourceChipsProps {
  /** Normalized, short source chips; component renders nothing when empty. */
  sourceFacts: Decision["sourceFacts"];
}

/**
 * Renders the proposal's evidence as short, normalized chips. Returns null
 * (renders nothing) when there is no provenance — an empty strip is never
 * shown, and a generic "View source" placeholder is never invented.
 */
export function SourceChips({ sourceFacts }: SourceChipsProps) {
  const facts = sourceFacts ?? [];
  if (facts.length === 0) return null;

  return (
    <div style={sourceRowStyle} data-testid="decision-source-chips">
      <span style={sourceLabelStyle}>Sources</span>
      {facts.map((fact) => (
        <span key={fact.id} style={sourceChipStyle}>
          {fact.label}
        </span>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// "Why this?" disclosure — structured label/detail rows
// ---------------------------------------------------------------------------

// Panel + row styles mirror `ReasoningDisclosure`'s label/detail grid exactly
// (same `124px 1fr` columns, mono labels, hairline row dividers) so the
// structured "Why this?" region reads as the same disclosure family.

const whyPanelStyle: CSSProperties = {
  marginTop: 16,
  padding: "15px 16px 6px",
  background: "var(--canvas)",
  border: "1px solid var(--hairline-faint)",
  borderRadius: 8,
};

const whyHeadStyle: CSSProperties = {
  fontFamily: "var(--font-mono-operator), ui-monospace, monospace",
  fontSize: "9.5px",
  letterSpacing: "0.14em",
  textTransform: "uppercase",
  color: "var(--ink-3)",
  marginBottom: 11,
};

const whyRowStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "124px 1fr",
  gap: 16,
  padding: "8px 0",
  borderBottom: "1px solid var(--hairline-faint)",
};

const whyLastRowStyle: CSSProperties = {
  ...whyRowStyle,
  borderBottom: "none",
};

const whyLabelStyle: CSSProperties = {
  fontFamily: "var(--font-mono-operator), ui-monospace, monospace",
  fontSize: "10px",
  letterSpacing: "0.1em",
  textTransform: "uppercase",
  color: "var(--ink-2)",
  paddingTop: 1,
};

const whyDetailStyle: CSSProperties = {
  fontSize: "13px",
  color: "var(--ink)",
  lineHeight: 1.5,
  letterSpacing: "-0.003em",
};

const whyUnavailableStyle: CSSProperties = {
  fontSize: "13px",
  color: "var(--ink-2)",
  lineHeight: 1.5,
  letterSpacing: "-0.003em",
  paddingBottom: 9,
};

/** One structured row of the "Why this?" disclosure. */
interface WhyRow {
  label: string;
  detail: string;
}

/**
 * Builds the structured rows (Trigger / Evidence / Owner boundary /
 * Recommendation / If ignored) from REAL adapter fields only. Exported for unit
 * tests. Rows with no backing data are omitted — never padded or invented:
 *   - Trigger        ← the first `whyFacts` sentence.
 *   - Evidence       ← the remaining `whyFacts` + the source-chip labels.
 *   - Owner boundary ← the adapter's `boundary` copy.
 *   - Recommendation ← the adapter's `gateReason` line.
 *   - If ignored     ← the adapter's `ifIgnored` copy.
 */
export function buildWhyRows(args: {
  whyFacts: Decision["whyFacts"];
  sourceFacts?: Decision["sourceFacts"];
  boundary?: Decision["boundary"];
  gateReason?: Decision["gateReason"];
  ifIgnored?: Decision["ifIgnored"];
}): WhyRow[] {
  const facts = args.whyFacts ?? [];
  const rows: WhyRow[] = [];

  if (facts.length > 0) {
    rows.push({ label: "Trigger", detail: facts[0] });
  }

  const restFacts = facts.slice(1);
  const sourceLabels = (args.sourceFacts ?? []).map((fact) => fact.label);
  const evidenceParts = [...restFacts];
  if (sourceLabels.length > 0) {
    evidenceParts.push(`Sources: ${sourceLabels.join(" · ")}`);
  }
  if (evidenceParts.length > 0) {
    rows.push({ label: "Evidence", detail: evidenceParts.join(" ") });
  }

  const boundary = (args.boundary ?? "").trim();
  if (boundary.length > 0) {
    rows.push({ label: "Owner boundary", detail: boundary });
  }

  const gateReason = (args.gateReason ?? "").trim();
  if (gateReason.length > 0) {
    rows.push({ label: "Recommendation", detail: gateReason });
  }

  const ifIgnored = (args.ifIgnored ?? "").trim();
  if (ifIgnored.length > 0) {
    rows.push({ label: "If ignored", detail: ifIgnored });
  }

  return rows;
}

export interface WhyThisDisclosureProps {
  /** Decision id; drives the panel id/testid so the toggle can `aria-controls` it. */
  id: string;
  /** Structured "Why this?" facts derived from REAL reasoning only. */
  whyFacts: Decision["whyFacts"];
  /** Normalized source chips; their labels back the Evidence row. */
  sourceFacts?: Decision["sourceFacts"];
  /** The adapter's boundary copy (Owner boundary row). */
  boundary?: Decision["boundary"];
  /** The adapter's gate-reason line (Recommendation row). */
  gateReason?: Decision["gateReason"];
  /** The adapter's "if you do nothing" copy (If ignored row). */
  ifIgnored?: Decision["ifIgnored"];
  /**
   * The adapter's structured, humanized six-section reasoning. When present it
   * is the source of the disclosure rows (Trigger / Evidence / Safety boundary
   * / Recommended next action / Source / If ignored), so no raw classifier or
   * source enum token surfaces. Falls back to {@link buildWhyRows} when absent.
   */
  reasoningSections?: Decision["reasoningSections"];
  /** Legacy prop retained for callers; raw audit text is never rendered. */
  rawReasoning?: Decision["rawReasoning"];
  isOpen: boolean;
}

/**
 * A structured "Why this?" region built strictly from the proposal's REAL
 * adapter fields, rendered as label/detail rows (Trigger / Evidence / Owner
 * boundary / Recommendation / If ignored) on `ReasoningDisclosure`'s grid.
 * When `whyFacts` is empty it says so honestly ("Reasoning unavailable for
 * this proposal.") instead of inventing a trigger. Like `ReasoningDisclosure`,
 * the parent owns open/closed state; the native `hidden` attribute keeps
 * collapsed content out of the a11y tree. Every detail is plain text (NOT
 * `dangerouslySetInnerHTML`) — real worker reasoning is untrusted.
 */
export function WhyThisDisclosure({
  id,
  whyFacts,
  sourceFacts,
  boundary,
  gateReason,
  ifIgnored,
  reasoningSections,
  rawReasoning,
  isOpen,
}: WhyThisDisclosureProps) {
  // Prefer the humanized, structured six-section copy from the adapter; fall
  // back to the whyFacts-derived rows for any consumer that hasn't supplied it.
  const sections = reasoningSections ?? [];
  const rows: WhyRow[] =
    sections.length > 0
      ? sections.map((s) => ({ label: s.label, detail: s.detail }))
      : buildWhyRows({ whyFacts, sourceFacts, boundary, gateReason, ifIgnored });

  void rawReasoning;
  const showEmpty = rows.length === 0;

  return (
    <div
      id={`why-this-${id}`}
      data-testid={`why-this-${id}`}
      role="region"
      aria-label="Why Odesa recommends this"
      hidden={!isOpen}
      style={whyPanelStyle}
    >
      <div style={whyHeadStyle}>Why this</div>
      {showEmpty ? (
        <div data-testid={`why-unavailable-${id}`} style={whyUnavailableStyle}>
          Reasoning unavailable for this proposal.
        </div>
      ) : null}
      {rows.map((row, idx) => {
        const isLast = idx === rows.length - 1;
        return (
          <div
            key={`${id}-why-${row.label}`}
            style={isLast ? whyLastRowStyle : whyRowStyle}
          >
            <div style={whyLabelStyle}>{row.label}</div>
            <div style={whyDetailStyle}>{row.detail}</div>
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Consequence pair — "Safeguard" (what's holding it) vs "If you do nothing"
// (cost of inaction), grouped so an owner can weigh the two at a glance.
// ---------------------------------------------------------------------------

// A cream inset that lifts the two load-bearing consequence lines out of the
// flat footer into one aligned block. The label column is fixed so the two
// detail sentences line up and read as a compare-pair; each label keeps its
// tier color (green = the safeguard currently holding, terracotta = the cost
// of doing nothing).
const consequenceBoxStyle: CSSProperties = {
  display: "grid",
  gap: 7,
  marginTop: 3,
  padding: "10px 13px",
  background: "var(--canvas)",
  border: "1px solid var(--hairline-faint)",
  borderRadius: 8,
};

const consequenceRowStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "116px 1fr",
  gap: 12,
  alignItems: "baseline",
};

const consequenceLabelBase: CSSProperties = {
  fontFamily: "var(--font-mono-operator), ui-monospace, monospace",
  fontSize: "9.5px",
  fontWeight: 500,
  letterSpacing: "0.1em",
  textTransform: "uppercase",
  whiteSpace: "nowrap",
};

const safeguardLabelStyle: CSSProperties = {
  ...consequenceLabelBase,
  color: "var(--green-ink)",
};

const ifIgnoredLabelStyle: CSSProperties = {
  ...consequenceLabelBase,
  color: "var(--terracotta)",
};

const consequenceDetailStyle: CSSProperties = {
  fontSize: "12.5px",
  color: "var(--ink-2)",
  lineHeight: 1.45,
  letterSpacing: "-0.002em",
};

export interface ConsequencePairProps {
  /** Calm "what this does and does not do until you approve" copy. */
  boundary: Decision["boundary"];
  /** Honest "if you do nothing" copy. */
  ifIgnored: Decision["ifIgnored"];
}

/**
 * The decision-consequence block: the safeguard currently holding the action
 * and the cost of inaction, aligned as a pair. Each line is rendered only when
 * the adapter supplied it — never invented — and the whole block collapses when
 * neither exists. Testids `decision-boundary` / `decision-if-ignored` are kept
 * on the rows so existing assertions on the boundary/inaction copy still match.
 */
export function ConsequencePair({ boundary, ifIgnored }: ConsequencePairProps) {
  const safeguard = (boundary ?? "").trim();
  const ignored = (ifIgnored ?? "").trim();
  if (safeguard.length === 0 && ignored.length === 0) return null;

  return (
    <div style={consequenceBoxStyle} data-testid="decision-consequence">
      {safeguard.length > 0 ? (
        <div style={consequenceRowStyle} data-testid="decision-boundary">
          <span style={safeguardLabelStyle}>Safeguard</span>
          <span style={consequenceDetailStyle}>{safeguard}</span>
        </div>
      ) : null}
      {ignored.length > 0 ? (
        <div style={consequenceRowStyle} data-testid="decision-if-ignored">
          <span style={ifIgnoredLabelStyle}>If you do nothing</span>
          <span style={consequenceDetailStyle}>{ignored}</span>
        </div>
      ) : null}
    </div>
  );
}
