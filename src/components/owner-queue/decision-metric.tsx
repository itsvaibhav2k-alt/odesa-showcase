import type { CSSProperties } from "react";

/**
 * Labeled metric chip for a decision card (mockup `.metric`, lines 1176-1202).
 *
 * Presentational only — a single `<span data-testid="decision-metric">` holding
 * a mono uppercase key (`.mk`) and a tabular value (`.mv`, `className="num"`).
 * `isRisk` swaps in the clay treatment (`.metric.risk`): clay-tinted background,
 * border, and ink for both key and value. `isMoney` swaps in the gold treatment
 * so the dollar-at-stake anchors the strip — money reads gold everywhere on the
 * page (matching the header's "At stake" tile). `isRisk` wins when both are set.
 */

export interface DecisionMetricProps {
  label: string;
  value: string;
  /** Renders the clay "risk" treatment. */
  isRisk?: boolean;
  /** Renders the gold "money" treatment so the dollar figure pops. */
  isMoney?: boolean;
}

const chipBase: CSSProperties = {
  display: "inline-flex",
  alignItems: "baseline",
  gap: 7,
  padding: "5px 10px",
  background: "var(--canvas)",
  border: "1px solid var(--hairline)",
  borderRadius: 6,
};

const chipRisk: CSSProperties = {
  background: "var(--clay-bg)",
  border: "1px solid var(--clay-border)",
};

// Gold money treatment: a warm gold tint + border so the dollar figure is the
// anchor of the metric strip. Kept subtle (no fill saturation) so it reads as
// "at stake", not an alert — clay/risk stays the louder, redder signal.
const chipMoney: CSSProperties = {
  background: "var(--gold-100)",
  border: "1px solid var(--gold-300)",
};

const keyBase: CSSProperties = {
  fontFamily: "var(--font-mono-operator), ui-monospace, monospace",
  fontSize: "9.5px",
  fontWeight: 500,
  letterSpacing: "0.06em",
  textTransform: "uppercase",
  color: "var(--ink-2)",
};

const keyRisk: CSSProperties = {
  color: "var(--clay-ink)",
  opacity: 0.8,
};

const keyMoney: CSSProperties = {
  color: "var(--gold-700)",
};

const valueBase: CSSProperties = {
  fontSize: "13px",
  color: "var(--ink)",
  fontWeight: 450,
  letterSpacing: "-0.005em",
};

const valueRisk: CSSProperties = {
  color: "var(--clay-ink)",
};

const valueMoney: CSSProperties = {
  color: "var(--gold-800)",
  fontWeight: 500,
  fontVariantNumeric: "tabular-nums",
};

export function DecisionMetric({
  label,
  value,
  isRisk = false,
  isMoney = false,
}: DecisionMetricProps) {
  // isRisk wins when both are set — a risky money figure should read as risk.
  const tone: "risk" | "money" | "base" = isRisk
    ? "risk"
    : isMoney
      ? "money"
      : "base";
  const chipStyle =
    tone === "risk"
      ? { ...chipBase, ...chipRisk }
      : tone === "money"
        ? { ...chipBase, ...chipMoney }
        : chipBase;
  const keyStyle =
    tone === "risk"
      ? { ...keyBase, ...keyRisk }
      : tone === "money"
        ? { ...keyBase, ...keyMoney }
        : keyBase;
  const valueStyle =
    tone === "risk"
      ? { ...valueBase, ...valueRisk }
      : tone === "money"
        ? { ...valueBase, ...valueMoney }
        : valueBase;

  return (
    <span data-testid="decision-metric" style={chipStyle}>
      <span style={keyStyle}>{label}</span>
      <span className="num" style={valueStyle}>
        {value}
      </span>
    </span>
  );
}
