/**
 * CallRegister — dense operational call table with progressive detail drawer.
 *
 * The table stays primary. Selecting a row opens a right-side investigation
 * drawer with transcript preview, extracted signals, action trace, follow-up,
 * and a deep link to the complete review studio.
 */

"use client";

import Link from "next/link";
import { useMemo, useState, type CSSProperties } from "react";

import {
  StatusChip,
  type StatusChipTone,
} from "@/components/shared/status-chip";
import type { CallStatusTone, VoiceCallListItem } from "@/lib/voice/queries";
import {
  CALLER_KIND_LABELS,
  intentLabel,
  namedActions,
  safeCallerLabel,
  outcomeSentence,
  timeLabel,
} from "./call-copy";

export type CallFilter = "all" | "live" | "review" | "resolved";

export interface CallRegisterProps {
  items: VoiceCallListItem[];
  filter: CallFilter;
  onFilterChange: (filter: CallFilter) => void;
  counts: { all: number; live: number; review: number; resolved: number };
  page: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  isEmpty: boolean;
  /** Optional role-aware empty copy; defaults to the owner test-call prompt. */
  emptyDescription?: string;
}

export interface PageWindow {
  pageStart: number;
  rangeStart: number;
  rangeEnd: number;
  hasPrev: boolean;
  hasNext: boolean;
}

export function pageWindow(
  total: number,
  page: number,
  pageSize: number,
): PageWindow {
  const pageStart = page * pageSize;
  const rangeStart = total === 0 ? 0 : pageStart + 1;
  const rangeEnd = Math.min(pageStart + pageSize, total);
  return {
    pageStart,
    rangeStart,
    rangeEnd,
    hasPrev: page > 0,
    hasNext: rangeEnd < total,
  };
}

const CHIP_TONE: Record<CallStatusTone, StatusChipTone> = {
  green: "green",
  clay: "clay",
  gold: "amber",
  neutral: "neutral-gold",
};

const FILTERS: Array<{ key: CallFilter; label: string }> = [
  { key: "all", label: "All" },
  { key: "live", label: "In progress" },
  { key: "review", label: "Needs review" },
  { key: "resolved", label: "Outcome recorded" },
];

const sectionStyle: CSSProperties = { marginTop: 22 };

const toolbarStyle: CSSProperties = {
  minHeight: 46,
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 14,
  flexWrap: "wrap",
  borderBottom: "1px solid var(--hairline-strong)",
};

const toolbarLeftStyle: CSSProperties = {
  display: "flex",
  alignItems: "baseline",
  gap: 10,
  minWidth: 0,
};

const titleStyle: CSSProperties = {
  fontFamily: "var(--font-sans-operator), system-ui, sans-serif",
  fontSize: 13,
  fontWeight: 600,
  letterSpacing: "-.01em",
};

const metaStyle: CSSProperties = {
  fontFamily: "var(--font-mono-operator), ui-monospace, monospace",
  fontSize: 9.5,
  color: "var(--ink-3)",
};

const filtersStyle: CSSProperties = {
  display: "flex",
  gap: 3,
  flexWrap: "wrap",
};

const filterStyle: CSSProperties = {
  minHeight: 30,
  padding: "0 9px",
  borderWidth: 1,
  borderStyle: "solid",
  borderColor: "transparent",
  borderRadius: 4,
  background: "transparent",
  color: "var(--ink-2)",
  fontSize: 10.5,
  fontWeight: 500,
  cursor: "pointer",
};

const filterActiveStyle: CSSProperties = {
  ...filterStyle,
  background: "var(--ink)",
  borderColor: "var(--ink)",
  color: "#fffdf7",
};

const frameStyle: CSSProperties = {
  position: "relative",
  border: "1px solid var(--hairline-strong)",
  borderTop: 0,
  borderRadius: "0 0 7px 7px",
  overflow: "hidden",
  background: "#fffefa",
};

const tableScrollStyle: CSSProperties = { overflowX: "auto" };

const gridColumns =
  "72px minmax(120px,.9fr) 92px minmax(125px,.95fr) 138px minmax(150px,1.15fr) 58px 108px";

const headStyle: CSSProperties = {
  minWidth: 970,
  display: "grid",
  gridTemplateColumns: gridColumns,
  alignItems: "center",
  gap: 12,
  padding: "8px 13px",
  borderBottom: "1px solid var(--hairline-strong)",
  background: "#f4f1ea",
  fontFamily: "var(--font-mono-operator), ui-monospace, monospace",
  fontSize: 8.5,
  fontWeight: 500,
  letterSpacing: ".08em",
  textTransform: "uppercase",
  color: "var(--ink-3)",
};

const rowStyle: CSSProperties = {
  width: "100%",
  minWidth: 970,
  minHeight: 62,
  display: "grid",
  gridTemplateColumns: gridColumns,
  alignItems: "center",
  gap: 12,
  padding: "9px 13px",
  border: 0,
  borderBottom: "1px solid var(--hairline)",
  background: "transparent",
  color: "var(--ink)",
  textAlign: "left",
  cursor: "pointer",
  fontFamily: "var(--font-sans-operator), system-ui, sans-serif",
};

const monoStyle: CSSProperties = {
  fontFamily: "var(--font-mono-operator), ui-monospace, monospace",
  fontSize: 9.5,
  color: "var(--ink-3)",
  fontVariantNumeric: "tabular-nums",
};

const strongStyle: CSSProperties = {
  display: "block",
  fontSize: 12.5,
  lineHeight: 1.25,
  fontWeight: 600,
  color: "var(--ink)",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

const minorStyle: CSSProperties = {
  ...monoStyle,
  display: "block",
  marginTop: 3,
  fontSize: 8.5,
  letterSpacing: ".04em",
  textTransform: "uppercase",
};

const sentenceStyle: CSSProperties = {
  fontSize: 11.5,
  lineHeight: 1.35,
  color: "var(--ink-2)",
  overflow: "hidden",
  display: "-webkit-box",
  WebkitLineClamp: 2,
  WebkitBoxOrient: "vertical",
};

const followUpStyle: CSSProperties = {
  fontSize: 10.5,
  lineHeight: 1.35,
  color: "var(--ink-2)",
};

const emptyStyle: CSSProperties = {
  padding: "48px 22px",
  textAlign: "center",
  fontSize: 12,
  lineHeight: 1.55,
  color: "var(--ink-3)",
};

const footerStyle: CSSProperties = {
  minHeight: 43,
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 10,
  padding: "7px 12px",
  background: "#f8f5ef",
};

const pagerStyle: CSSProperties = {
  minHeight: 29,
  padding: "0 9px",
  border: "1px solid var(--hairline-strong)",
  borderRadius: 4,
  background: "#fffefa",
  color: "var(--ink)",
  fontSize: 10.5,
  cursor: "pointer",
};

const scrimStyle: CSSProperties = {
  position: "fixed",
  inset: 0,
  zIndex: 39,
  background: "rgba(27,24,20,.18)",
};

const drawerStyle: CSSProperties = {
  position: "fixed",
  zIndex: 40,
  top: 56,
  right: 0,
  bottom: 0,
  width: "min(440px, calc(100vw - 24px))",
  overflowY: "auto",
  background: "#fffefa",
  borderLeft: "1px solid var(--hairline-strong)",
  boxShadow: "-18px 0 48px rgba(35,29,23,.13)",
  padding: "18px 20px 28px",
};

const drawerHeadStyle: CSSProperties = {
  display: "flex",
  alignItems: "flex-start",
  justifyContent: "space-between",
  gap: 14,
  paddingBottom: 16,
  borderBottom: "1px solid var(--hairline-strong)",
};

const drawerEyebrowStyle: CSSProperties = {
  fontFamily: "var(--font-mono-operator), ui-monospace, monospace",
  fontSize: 9,
  fontWeight: 500,
  letterSpacing: ".1em",
  textTransform: "uppercase",
  color: "var(--terracotta)",
};

const drawerTitleStyle: CSSProperties = {
  margin: "4px 0 0",
  fontFamily: "var(--font-sans-operator), system-ui, sans-serif",
  fontSize: 20,
  lineHeight: 1.15,
  fontWeight: 600,
  letterSpacing: "-.025em",
};

const closeStyle: CSSProperties = {
  width: 30,
  height: 30,
  border: "1px solid var(--hairline-strong)",
  borderRadius: 4,
  background: "transparent",
  color: "var(--ink-2)",
  cursor: "pointer",
};

const factGridStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "1fr 1fr",
  gap: 0,
  marginTop: 14,
  border: "1px solid var(--hairline)",
  borderRadius: 6,
  overflow: "hidden",
};

const factStyle: CSSProperties = {
  minHeight: 62,
  padding: "10px 11px",
  borderRight: "1px solid var(--hairline)",
  borderBottom: "1px solid var(--hairline)",
};

const factLabelStyle: CSSProperties = {
  fontFamily: "var(--font-mono-operator), ui-monospace, monospace",
  fontSize: 8.5,
  fontWeight: 500,
  letterSpacing: ".08em",
  textTransform: "uppercase",
  color: "var(--ink-3)",
};

const factValueStyle: CSSProperties = {
  marginTop: 4,
  fontSize: 11.5,
  lineHeight: 1.35,
  fontWeight: 500,
  color: "var(--ink)",
};

const drawerSectionStyle: CSSProperties = {
  padding: "16px 0",
  borderBottom: "1px solid var(--hairline)",
};

const drawerSectionTitleStyle: CSSProperties = {
  marginBottom: 7,
  fontFamily: "var(--font-sans-operator), system-ui, sans-serif",
  fontSize: 11,
  fontWeight: 600,
  color: "var(--ink)",
};

const transcriptStyle: CSSProperties = {
  margin: 0,
  padding: "11px 12px",
  borderLeft: "3px solid var(--terracotta)",
  background: "#f5f1e9",
  fontSize: 11.5,
  lineHeight: 1.55,
  color: "var(--ink-2)",
};

const fullReviewStyle: CSSProperties = {
  marginTop: 18,
  minHeight: 38,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  borderRadius: 5,
  background: "var(--ink)",
  color: "#fffdf7",
  textDecoration: "none",
  fontSize: 11.5,
  fontWeight: 500,
};

function durationLabel(call: VoiceCallListItem): string {
  if (!call.endedAt) return call.status === "active" ? "In progress" : "—";
  const duration = Math.max(
    0,
    new Date(call.endedAt).getTime() - new Date(call.startedAt).getTime(),
  );
  if (!Number.isFinite(duration)) return "—";
  const seconds = Math.round(duration / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function propertyLabel(call: VoiceCallListItem): string {
  return call.propertyId ? "Linked property" : "Unresolved";
}

function reasonLabel(call: VoiceCallListItem): string {
  if (call.intents.length > 0)
    return call.intents.slice(0, 2).map(intentLabel).join(" · ");
  if (call.summary?.trim()) return call.summary;
  return call.status === "active"
    ? "Conversation in progress"
    : "Reason not extracted";
}

function actionLabel(call: VoiceCallListItem): string {
  const actions = namedActions(call);
  if (actions.length > 0) return actions.slice(0, 2).join(" · ");
  if (call.review.needsReview) return "Owner judgment required";
  return "No autonomous action";
}

function followUpLabel(call: VoiceCallListItem): string {
  const parts: string[] = [];
  if (call.smsSentCount > 0)
    parts.push(`${call.smsSentCount} SMS provider-accepted`);
  if (call.smsDraftedCount > 0) parts.push(`${call.smsDraftedCount} SMS draft`);
  if (call.approvalsNeeded > 0)
    parts.push(`${call.approvalsNeeded} Owner Queue decision`);
  if (parts.length === 0)
    return call.review.needsReview ? "Review required" : "None";
  return parts.join(" · ");
}

function InvestigationDrawer({
  call,
  onClose,
}: {
  call: VoiceCallListItem;
  onClose: () => void;
}) {
  const caller = safeCallerLabel(call.callerLabel, call.callerKind);
  return (
    <>
      <button
        aria-label="Close call details"
        style={scrimStyle}
        onClick={onClose}
      />
      <aside
        aria-label={`Call details for ${caller}`}
        data-testid="call-investigation-drawer"
        style={drawerStyle}
      >
        <div style={drawerHeadStyle}>
          <div>
            <div style={drawerEyebrowStyle}>Call investigation</div>
            <h3 style={drawerTitleStyle}>{caller}</h3>
            <div style={{ ...monoStyle, marginTop: 6 }}>
              {timeLabel(call.startedAt)}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={closeStyle}
          >
            ×
          </button>
        </div>

        <div style={factGridStyle}>
          <div style={factStyle}>
            <div style={factLabelStyle}>Property</div>
            <div style={factValueStyle}>{propertyLabel(call)}</div>
          </div>
          <div style={factStyle}>
            <div style={factLabelStyle}>Duration</div>
            <div style={factValueStyle}>{durationLabel(call)}</div>
          </div>
          <div style={factStyle}>
            <div style={factLabelStyle}>Detected reason</div>
            <div style={factValueStyle}>{reasonLabel(call)}</div>
          </div>
          <div style={factStyle}>
            <div style={factLabelStyle}>Review state</div>
            <div style={factValueStyle}>{call.review.statusLabel}</div>
          </div>
        </div>

        <section style={drawerSectionStyle}>
          <div style={drawerSectionTitleStyle}>Odesa outcome</div>
          <div style={sentenceStyle}>{outcomeSentence(call)}</div>
        </section>
        <section style={drawerSectionStyle}>
          <div style={drawerSectionTitleStyle}>Action trace</div>
          <div style={sentenceStyle}>{actionLabel(call)}</div>
          <div style={{ ...followUpStyle, marginTop: 7 }}>
            {followUpLabel(call)}
          </div>
        </section>
        <section style={drawerSectionStyle}>
          <div style={drawerSectionTitleStyle}>Transcript preview</div>
          <blockquote style={transcriptStyle}>
            {call.transcriptPreview || "Transcript unavailable for this call."}
          </blockquote>
        </section>
        <section style={drawerSectionStyle}>
          <div style={drawerSectionTitleStyle}>Available evidence</div>
          <div style={sentenceStyle}>
            Open the full review for the stored timeline, transcript, outcome,
            and any recorded follow-up evidence.
          </div>
        </section>
        <Link
          href={`/calls/${call.id}`}
          data-testid="call-investigation-open-full"
          style={fullReviewStyle}
        >
          Open complete call review →
        </Link>
      </aside>
    </>
  );
}

export function CallRegister({
  items,
  filter,
  onFilterChange,
  counts,
  page,
  pageSize,
  onPageChange,
  isEmpty,
  emptyDescription,
}: CallRegisterProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = useMemo(
    () => items.find((call) => call.id === selectedId) ?? null,
    [items, selectedId],
  );

  const total = items.length;
  const { pageStart, rangeStart, rangeEnd, hasPrev, hasNext } = pageWindow(
    total,
    page,
    pageSize,
  );
  const pageItems = items.slice(pageStart, pageStart + pageSize);

  return (
    <section aria-label="Call activity" style={sectionStyle}>
      <div style={toolbarStyle}>
        <div style={toolbarLeftStyle}>
          <span style={titleStyle}>Call activity</span>
          <span style={metaStyle}>
            Newest first · select a row to investigate
          </span>
        </div>
        <div role="group" aria-label="Filter calls" style={filtersStyle}>
          {FILTERS.map(({ key, label }) => {
            const active = filter === key;
            return (
              <button
                key={key}
                type="button"
                aria-pressed={active}
                data-testid={`calls-filter-${key}`}
                style={active ? filterActiveStyle : filterStyle}
                onClick={() => onFilterChange(key)}
              >
                {label} {counts[key]}
              </button>
            );
          })}
        </div>
      </div>

      <div style={frameStyle}>
        <div style={tableScrollStyle}>
          <div className="call-ops-head" style={headStyle} aria-hidden="true">
            <span>Time</span>
            <span>Caller</span>
            <span>Property</span>
            <span>Reason</span>
            <span>Status</span>
            <span>Odesa outcome</span>
            <span>Duration</span>
            <span>Follow-up</span>
          </div>
          <div data-testid="calls-register-rows">
            {pageItems.length === 0 ? (
              <div
                style={emptyStyle}
                data-testid={isEmpty ? "calls-empty" : undefined}
              >
                {isEmpty
                  ? emptyDescription ??
                    "No calls recorded yet. New call records will appear here when evidence is available."
                  : "Nothing in this call view."}
              </div>
            ) : (
              pageItems.map((call) => {
                const caller = safeCallerLabel(
                  call.callerLabel,
                  call.callerKind,
                );
                return (
                  <button
                    key={call.id}
                    type="button"
                    className="call-ops-row"
                    data-testid="call-row"
                    data-call-id={call.id}
                    style={rowStyle}
                    onClick={() => setSelectedId(call.id)}
                    aria-label={`Investigate call from ${caller}`}
                  >
                    <span style={monoStyle}>{timeLabel(call.startedAt)}</span>
                    <span style={{ minWidth: 0 }}>
                      <span style={strongStyle}>{caller}</span>
                      <span style={minorStyle}>
                        {CALLER_KIND_LABELS[call.callerKind] ?? "Caller"}
                      </span>
                    </span>
                    <span style={sentenceStyle}>{propertyLabel(call)}</span>
                    <span style={sentenceStyle}>{reasonLabel(call)}</span>
                    <StatusChip
                      tone={CHIP_TONE[call.review.statusTone]}
                      label={
                        call.status === "active"
                          ? "In progress"
                          : call.review.statusLabel
                      }
                    />
                    <span style={sentenceStyle}>{actionLabel(call)}</span>
                    <span style={monoStyle}>{durationLabel(call)}</span>
                    <span style={followUpStyle}>{followUpLabel(call)}</span>
                  </button>
                );
              })
            )}
          </div>
        </div>

        <div style={footerStyle}>
          <span style={monoStyle} data-testid="calls-register-range">
            {rangeStart}–{rangeEnd} of {total} calls
          </span>
          <div style={{ display: "flex", gap: 5 }}>
            <button
              type="button"
              data-testid="calls-register-prev"
              style={{ ...pagerStyle, opacity: hasPrev ? 1 : 0.42 }}
              disabled={!hasPrev}
              onClick={() => hasPrev && onPageChange(page - 1)}
            >
              ‹ Prev
            </button>
            <button
              type="button"
              data-testid="calls-register-next"
              style={{ ...pagerStyle, opacity: hasNext ? 1 : 0.42 }}
              disabled={!hasNext}
              onClick={() => hasNext && onPageChange(page + 1)}
            >
              Next ›
            </button>
          </div>
        </div>
      </div>

      {selected ? (
        <InvestigationDrawer
          call={selected}
          onClose={() => setSelectedId(null)}
        />
      ) : null}

      <style precedence="default" href="call-operations-table">{`
        .call-ops-row:hover { background: #f6f3ed !important; }
        .call-ops-row:focus-visible { outline: 2px solid var(--terracotta); outline-offset: -2px; }
        @media (max-width: 760px) {
          .call-ops-head, .call-ops-row { min-width: 920px !important; }
        }
      `}</style>
    </section>
  );
}
