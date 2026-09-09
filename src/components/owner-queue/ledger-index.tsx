"use client";

import { useRef, type CSSProperties, type KeyboardEvent } from "react";
import type { Decision } from "@/lib/owner-queue/mock-decisions";
import type { DecisionStatus } from "./use-owner-queue-controller";
import { LedgerRow } from "./ledger-row";

/**
 * The left index pane of the owner-queue docket — a finite, ruled ledger of
 * every held decision. Not a feed: rows are compact (see <LedgerRow>), the set
 * is explicitly paginated ("1–N of M" + Prev/Next, never infinite scroll), and
 * Judgment vs Routine are separated by filter chips and in-list section rules.
 *
 * Presentational + keyboard-navigable. All state (active filter, page,
 * selection) is owned by the client; this component renders the slice it is
 * handed and reports intent up. Arrow / j / k move focus between the rendered
 * rows; Enter or click (native button activation) opens the dossier.
 */

export type LedgerFilter = "all" | "judgment" | "routine";

export interface LedgerIndexProps {
  /** Full filtered, ordered list (judgment first); the pane paginates it. */
  items: Decision[];
  filter: LedgerFilter;
  onFilterChange: (filter: LedgerFilter) => void;
  counts: { all: number; judgment: number; routine: number };
  page: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  selectedId: string | null;
  onSelect: (id: string) => void;
  statusFor: (decision: Decision) => DecisionStatus;
  /** True for decisions needing owner judgment (recommendation !== 'approve'). */
  isJudgment: (decision: Decision) => boolean;
  /** Batch-review affordance for the routine set (opens the confirm modal). */
  batchEligibleCount: number;
  onReviewBatch: () => void;
}

const paneStyle: CSSProperties = {
  background: "var(--canvas)",
  border: "1px solid var(--hairline)",
  borderRadius: 10,
  overflow: "hidden",
  display: "flex",
  flexDirection: "column",
  height: "100%",
};

const headStyle: CSSProperties = {
  padding: "12px 14px 11px",
  borderBottom: "1px solid var(--hairline)",
};

const filterRowStyle: CSSProperties = {
  display: "flex",
  gap: 6,
};

const chipBase: CSSProperties = {
  flex: 1,
  fontFamily: "var(--font-mono-operator), ui-monospace, monospace",
  fontSize: "10px",
  fontWeight: 500,
  letterSpacing: "0.06em",
  textTransform: "uppercase",
  padding: "6px 8px",
  borderRadius: 5,
  border: "1px solid var(--hairline)",
  background: "var(--panel-lift)",
  color: "var(--ink-3)",
  cursor: "pointer",
  whiteSpace: "nowrap",
};

const chipActiveStyle: CSSProperties = {
  background: "var(--ink)",
  borderColor: "var(--ink)",
  color: "var(--panel-lift)",
};

const listStyle: CSSProperties = {
  flex: 1,
  overflowY: "auto",
  minHeight: 0,
};

const sectionRuleStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  padding: "10px 14px 6px",
  fontFamily: "var(--font-mono-operator), ui-monospace, monospace",
  fontSize: "9.5px",
  fontWeight: 500,
  letterSpacing: "0.12em",
  textTransform: "uppercase",
};

const judgmentRuleStyle: CSSProperties = {
  ...sectionRuleStyle,
  color: "var(--amber-ink)",
};

const routineRuleStyle: CSSProperties = {
  ...sectionRuleStyle,
  color: "var(--green-ink)",
};

const ruleLineStyle: CSSProperties = {
  flex: 1,
  height: 1,
  background: "var(--hairline-faint)",
};

const emptyFilterStyle: CSSProperties = {
  padding: "28px 16px",
  textAlign: "center",
  fontSize: "12.5px",
  color: "var(--ink-3)",
  letterSpacing: "-0.003em",
};

const footStyle: CSSProperties = {
  borderTop: "1px solid var(--hairline)",
  padding: "10px 14px",
  display: "flex",
  flexDirection: "column",
  gap: 10,
};

const pagerStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 10,
};

const pagerLabelStyle: CSSProperties = {
  fontFamily: "var(--font-mono-operator), ui-monospace, monospace",
  fontSize: "10.5px",
  letterSpacing: "0.04em",
  color: "var(--ink-2)",
  fontVariantNumeric: "tabular-nums",
};

const pagerBtnStyle: CSSProperties = {
  fontFamily: "var(--font-mono-operator), ui-monospace, monospace",
  fontSize: "10.5px",
  fontWeight: 500,
  letterSpacing: "0.04em",
  padding: "5px 11px",
  borderRadius: 5,
  border: "1px solid var(--hairline-strong)",
  background: "var(--panel-lift)",
  color: "var(--ink)",
  cursor: "pointer",
};

const pagerBtnDisabledStyle: CSSProperties = {
  ...pagerBtnStyle,
  opacity: 0.4,
  cursor: "default",
  color: "var(--ink-3)",
};

const batchBtnStyle: CSSProperties = {
  width: "100%",
  fontSize: "12px",
  fontWeight: 450,
  padding: "8px 12px",
  borderRadius: 6,
  border: "1px solid var(--green-border)",
  background: "var(--green-bg)",
  color: "var(--green-ink)",
  cursor: "pointer",
  letterSpacing: "-0.003em",
};

const FILTERS: { key: LedgerFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "judgment", label: "Judgment" },
  { key: "routine", label: "Routine" },
];

export function LedgerIndex({
  items,
  filter,
  onFilterChange,
  counts,
  page,
  pageSize,
  onPageChange,
  selectedId,
  onSelect,
  statusFor,
  isJudgment,
  batchEligibleCount,
  onReviewBatch,
}: LedgerIndexProps) {
  const listRef = useRef<HTMLDivElement>(null);

  const total = items.length;
  const pageStart = page * pageSize;
  const pageItems = items.slice(pageStart, pageStart + pageSize);
  const rangeStart = total === 0 ? 0 : pageStart + 1;
  const rangeEnd = Math.min(pageStart + pageSize, total);
  const hasPrev = page > 0;
  const hasNext = rangeEnd < total;

  // Roving focus across the rendered rows. Arrow / j / k move focus only; the
  // dossier opens on activation (Enter / click) — no accidental selection.
  // ponytail: nav is scoped to the current page's rows; Prev/Next changes pages.
  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const dir =
      event.key === "ArrowDown" || event.key === "j"
        ? 1
        : event.key === "ArrowUp" || event.key === "k"
          ? -1
          : 0;
    if (dir === 0 || !listRef.current) return;

    const buttons = Array.from(
      listRef.current.querySelectorAll<HTMLButtonElement>(
        'button[data-testid^="decision-card-"]',
      ),
    );
    if (buttons.length === 0) return;

    let base = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (base < 0) {
      base = buttons.findIndex(
        (b) => b.getAttribute("aria-current") === "true",
      );
    }
    const next = Math.min(
      buttons.length - 1,
      Math.max(0, (base < 0 ? 0 : base) + dir),
    );
    event.preventDefault();
    buttons[next]?.focus();
  }

  let lastTier: "judgment" | "routine" | null = null;

  return (
    <section aria-label="Decision ledger" style={paneStyle}>
      <div style={headStyle}>
        <div
          role="tablist"
          aria-label="Filter decisions"
          style={filterRowStyle}
        >
          {FILTERS.map(({ key, label }) => {
            const active = filter === key;
            return (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={active}
                data-testid={`ledger-filter-${key}`}
                style={active ? { ...chipBase, ...chipActiveStyle } : chipBase}
                onClick={() => onFilterChange(key)}
              >
                {label} {counts[key]}
              </button>
            );
          })}
        </div>
      </div>

      <div
        ref={listRef}
        style={listStyle}
        onKeyDown={handleKeyDown}
        data-testid="ledger-rows"
      >
        {pageItems.length === 0 ? (
          <div style={emptyFilterStyle}>Nothing in this view.</div>
        ) : (
          pageItems.map((decision) => {
            const tier = isJudgment(decision) ? "judgment" : "routine";
            const showRule = tier !== lastTier;
            lastTier = tier;
            return (
              <div key={decision.id}>
                {showRule ? (
                  <div
                    aria-hidden="true"
                    style={
                      tier === "judgment" ? judgmentRuleStyle : routineRuleStyle
                    }
                  >
                    {tier === "judgment" ? "Needs judgment" : "Routine"}
                    <span style={ruleLineStyle} />
                  </div>
                ) : null}
                <LedgerRow
                  decision={decision}
                  isJudgment={tier === "judgment"}
                  status={statusFor(decision)}
                  selected={decision.id === selectedId}
                  onSelect={() => onSelect(decision.id)}
                />
              </div>
            );
          })
        )}
      </div>

      <div style={footStyle}>
        <div style={pagerStyle}>
          <span
            className="num"
            style={pagerLabelStyle}
            data-testid="ledger-range"
          >
            {rangeStart}–{rangeEnd} of {total}
          </span>
          <div style={{ display: "flex", gap: 6 }}>
            <button
              type="button"
              data-testid="ledger-prev"
              style={hasPrev ? pagerBtnStyle : pagerBtnDisabledStyle}
              disabled={!hasPrev}
              aria-disabled={!hasPrev}
              onClick={() => hasPrev && onPageChange(page - 1)}
            >
              ‹ Prev
            </button>
            <button
              type="button"
              data-testid="ledger-next"
              style={hasNext ? pagerBtnStyle : pagerBtnDisabledStyle}
              disabled={!hasNext}
              aria-disabled={!hasNext}
              onClick={() => hasNext && onPageChange(page + 1)}
            >
              Next ›
            </button>
          </div>
        </div>

        {batchEligibleCount > 0 ? (
          <button
            type="button"
            data-testid="ledger-review-batch"
            style={batchBtnStyle}
            onClick={onReviewBatch}
          >
            Review routine batch ({batchEligibleCount})
          </button>
        ) : null}
      </div>
    </section>
  );
}
