"use client";

import type { CSSProperties } from "react";
import type { Decision } from "@/lib/owner-queue/mock-decisions";
import type { DecisionStatus } from "./use-owner-queue-controller";

/**
 * One ruled ledger row in the owner-queue index (NOT a card). A compact,
 * scannable line an owner reads to choose which decision to open: a
 * status/judgment marker, the decision title, its property/category, and its
 * money or risk figure. The selected row is unmistakable (warm fill + a solid
 * left accent in the decision's tier color). Settled rows dim and carry a
 * ✓ / ✕ marker.
 *
 * Rendered as a real <button> so the whole line is one focusable, keyboard-
 * activatable target — no nested interactive controls. Keeps the stable
 * `decision-card-<id>` test-id so structural specs that count/anchor decisions
 * by that prefix keep resolving.
 */

export interface LedgerRowProps {
  decision: Decision;
  /** Whether this decision needs owner judgment (amber) vs is routine (green). */
  isJudgment: boolean;
  /** Reconciled lifecycle status driving the settled dim + marker. */
  status: DecisionStatus;
  /** Whether this row is the open dossier. */
  selected: boolean;
  onSelect: () => void;
}

const rowStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "auto 1fr auto",
  alignItems: "center",
  gap: 12,
  width: "100%",
  textAlign: "left",
  minHeight: 64,
  padding: "11px 14px 11px 13px",
  background: "transparent",
  border: "none",
  borderLeft: "3px solid transparent",
  borderBottom: "1px solid var(--hairline-faint)",
  cursor: "pointer",
  color: "var(--ink)",
  font: "inherit",
};

const rowSelectedJudgmentStyle: CSSProperties = {
  background: "var(--amber-bg-soft)",
  borderLeftColor: "var(--amber)",
};

const rowSelectedRoutineStyle: CSSProperties = {
  background: "var(--panel-lift)",
  borderLeftColor: "var(--green)",
};

const rowSettledStyle: CSSProperties = {
  opacity: 0.55,
};

const markerWrapStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  width: 16,
};

const judgmentMarkStyle: CSSProperties = {
  fontSize: "10px",
  color: "var(--amber)",
  lineHeight: 1,
};

const routineMarkStyle: CSSProperties = {
  width: 7,
  height: 7,
  borderRadius: "50%",
  background: "var(--green)",
};

const settledMarkStyle: CSSProperties = {
  fontSize: "12px",
  color: "var(--ink-3)",
  lineHeight: 1,
};

const bodyStyle: CSSProperties = {
  minWidth: 0,
};

const titleStyle: CSSProperties = {
  display: "block",
  fontSize: "13.5px",
  fontWeight: 450,
  letterSpacing: "-0.006em",
  color: "var(--ink)",
  lineHeight: 1.25,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

const metaStyle: CSSProperties = {
  display: "block",
  marginTop: 2,
  fontFamily: "var(--font-mono-operator), ui-monospace, monospace",
  fontSize: "9.5px",
  letterSpacing: "0.06em",
  textTransform: "uppercase",
  color: "var(--ink-3)",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

const railStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  alignItems: "flex-end",
  gap: 3,
  flexShrink: 0,
};

const moneyStyle: CSSProperties = {
  fontFamily: "var(--font-mono-operator), ui-monospace, monospace",
  fontSize: "12.5px",
  fontWeight: 500,
  color: "var(--gold-800)",
  fontVariantNumeric: "tabular-nums",
};

const riskStyle: CSSProperties = {
  fontFamily: "var(--font-mono-operator), ui-monospace, monospace",
  fontSize: "8.5px",
  fontWeight: 500,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  color: "var(--clay-ink)",
  background: "var(--clay-bg)",
  border: "1px solid var(--clay-border)",
  borderRadius: 3,
  padding: "2px 5px",
};

/** The dollar chip on a decision, if it carries a real money figure. */
function moneyValue(decision: Decision): string | null {
  const chip = decision.metricChips.find((c) => c.value.trim().startsWith("$"));
  return chip ? chip.value : null;
}

/** Whether any metric on the decision is risk-flagged. */
function hasRisk(decision: Decision): boolean {
  return decision.metricChips.some((c) => c.isRisk);
}

export function LedgerRow({
  decision,
  isJudgment,
  status,
  selected,
  onSelect,
}: LedgerRowProps) {
  const isSettled = status === "approved" || status === "declined";
  const money = moneyValue(decision);
  const risk = hasRisk(decision);

  const style: CSSProperties = {
    ...rowStyle,
    ...(selected
      ? isJudgment
        ? rowSelectedJudgmentStyle
        : rowSelectedRoutineStyle
      : null),
    ...(isSettled ? rowSettledStyle : null),
  };

  return (
    <button
      type="button"
      data-testid={`decision-card-${decision.id}`}
      aria-current={selected ? "true" : undefined}
      style={style}
      onClick={onSelect}
    >
      <span aria-hidden="true" style={markerWrapStyle}>
        {isSettled ? (
          <span style={settledMarkStyle}>
            {status === "approved" ? "✓" : "✕"}
          </span>
        ) : isJudgment ? (
          <span style={judgmentMarkStyle}>◆</span>
        ) : (
          <span style={routineMarkStyle} />
        )}
      </span>

      <span style={bodyStyle}>
        <span style={titleStyle}>{decision.title}</span>
        <span style={metaStyle}>
          {decision.type} · {decision.location}
        </span>
      </span>

      <span style={railStyle}>
        {money ? (
          <span className="num" style={moneyStyle}>
            {money}
          </span>
        ) : null}
        {risk ? <span style={riskStyle}>Risk</span> : null}
      </span>
    </button>
  );
}
