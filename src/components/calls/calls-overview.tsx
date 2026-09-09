/**
 * CallsOverview — the operational voice console.
 *
 * Structure is deliberately utility-first: persistent system status, exception
 * metrics, then the complete call register. Editorial styling is limited to the
 * route title supplied by the server shell; routine operational copy is sans.
 */

"use client";

import Link from "next/link";
import { useMemo, useState, type CSSProperties, type ReactNode } from "react";

import type { VoiceCallActivity, VoiceCallListItem } from "@/lib/voice/queries";
import type { VoiceSettings } from "@/lib/voice/settings";

import { CallRegister, type CallFilter } from "./call-register";

export interface CallsOverviewProps {
  activity: VoiceCallActivity;
  calls: VoiceCallListItem[];
  voiceSettings: VoiceSettings;
  readinessSlot: ReactNode;
  /** VA shift mode: inspect calls and prepare follow-up, not voice config. */
  readOnly?: boolean;
  /** The global assistant is an owner-reserved capability. */
  canUseAssistant?: boolean;
}

const PAGE_SIZE = 12;

const rootStyle: CSSProperties = {
  color: "var(--ink)",
  fontFamily: "var(--font-sans-operator), system-ui, sans-serif",
};

const statusFrameStyle: CSSProperties = {
  position: "sticky",
  top: 55,
  zIndex: 12,
  background: "rgba(251, 249, 244, .96)",
  border: "1px solid var(--hairline-strong)",
  borderRadius: 8,
  boxShadow: "0 7px 24px rgba(43, 35, 27, .07)",
  backdropFilter: "blur(12px)",
};

const statusBarStyle: CSSProperties = {
  minHeight: 54,
  padding: "8px 12px 8px 15px",
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 16,
  flexWrap: "wrap",
};

const systemGroupStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 18,
  minWidth: 0,
  flexWrap: "wrap",
};

const systemItemStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 7,
  minWidth: 0,
};

const systemLabelStyle: CSSProperties = {
  fontFamily: "var(--font-mono-operator), ui-monospace, monospace",
  fontSize: 9,
  fontWeight: 600,
  letterSpacing: ".09em",
  textTransform: "uppercase",
  color: "var(--ink-3)",
};

const systemValueStyle: CSSProperties = {
  fontSize: 12,
  fontWeight: 500,
  color: "var(--ink)",
  whiteSpace: "nowrap",
};

const statusDot = (tone: "green" | "amber" | "red" | "gray"): CSSProperties => ({
  width: 7,
  height: 7,
  borderRadius: "50%",
  background:
    tone === "green"
      ? "var(--green)"
      : tone === "amber"
        ? "var(--amber)"
        : tone === "red"
          ? "#b84f3d"
          : "var(--ink-4)",
  boxShadow: tone === "green" ? "0 0 0 3px rgba(71,113,78,.12)" : undefined,
  flexShrink: 0,
});

const sectionHeadStyle: CSSProperties = {
  display: "flex",
  alignItems: "baseline",
  justifyContent: "space-between",
  gap: 16,
  marginTop: 22,
  marginBottom: 9,
};

const sectionTitleStyle: CSSProperties = {
  margin: 0,
  fontFamily: "var(--font-sans-operator), system-ui, sans-serif",
  fontSize: 13,
  fontWeight: 600,
  letterSpacing: "-.01em",
  color: "var(--ink)",
};

const sectionMetaStyle: CSSProperties = {
  fontFamily: "var(--font-mono-operator), ui-monospace, monospace",
  fontSize: 9.5,
  color: "var(--ink-3)",
  letterSpacing: ".04em",
};

const askLinkStyle: CSSProperties = {
  fontFamily: "var(--font-mono-operator), ui-monospace, monospace",
  fontSize: 9.5,
  color: "var(--terracotta)",
  textDecoration: "none",
  letterSpacing: ".04em",
};

const primaryMetricsStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
  border: "1px solid var(--hairline-strong)",
  borderRadius: "7px 7px 0 0",
  overflow: "hidden",
  background: "var(--panel-clean)",
};

const secondaryMetricsStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
  border: "1px solid var(--hairline-strong)",
  borderTop: 0,
  borderRadius: "0 0 7px 7px",
  overflow: "hidden",
  background: "var(--panel-lift)",
};

const primaryMetricStyle: CSSProperties = {
  minHeight: 76,
  padding: "12px 15px",
  borderRight: "1px solid var(--hairline-strong)",
};

const secondaryMetricStyle: CSSProperties = {
  minHeight: 52,
  padding: "9px 14px",
  borderRight: "1px solid var(--hairline)",
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 8,
};

const metricLabelStyle: CSSProperties = {
  fontFamily: "var(--font-mono-operator), ui-monospace, monospace",
  fontSize: 9,
  fontWeight: 500,
  letterSpacing: ".08em",
  textTransform: "uppercase",
  color: "var(--ink-3)",
};

const primaryValueStyle: CSSProperties = {
  marginTop: 6,
  fontFamily: "var(--font-mono-operator), ui-monospace, monospace",
  fontSize: 25,
  fontWeight: 500,
  lineHeight: 1,
  fontVariantNumeric: "tabular-nums",
};

const metricContextStyle: CSSProperties = {
  marginTop: 5,
  fontSize: 10.5,
  lineHeight: 1.3,
  color: "var(--ink-3)",
};

function PrimaryMetric({
  label,
  value,
  context,
  tone,
  testId,
}: {
  label: string;
  value: number;
  context: string;
  tone: "neutral" | "green" | "amber" | "red";
  testId: string;
}) {
  const active = value > 0 && tone !== "neutral";
  const color =
    tone === "green"
      ? "var(--green-ink)"
      : tone === "amber"
        ? "var(--amber-ink)"
        : tone === "red"
          ? "#963c2e"
          : "var(--ink)";
  return (
    <div
      data-testid={testId}
      style={{
        ...primaryMetricStyle,
        background: active
          ? tone === "green"
            ? "rgba(71,113,78,.075)"
            : tone === "amber"
              ? "rgba(184,132,38,.09)"
              : "rgba(184,79,61,.075)"
          : undefined,
        boxShadow: active ? `inset 3px 0 ${color}` : undefined,
      }}
    >
      <div style={metricLabelStyle}>{label}</div>
      <div style={{ ...primaryValueStyle, color }}>{value}</div>
      <div style={metricContextStyle}>{context}</div>
    </div>
  );
}

function SecondaryMetric({ label, value, testId }: { label: string; value: number; testId?: string }) {
  return (
    <div data-testid={testId} style={secondaryMetricStyle}>
      <span style={metricLabelStyle}>{label}</span>
      <strong className="num" style={{ fontSize: 15, fontWeight: 500 }}>
        {value}
      </strong>
    </div>
  );
}

/** Ground the Calls handoff in aggregate source counts, never hidden call ids. */
export function callsAssistantHref(
  activity: VoiceCallActivity,
  registerCount: number,
): string {
  const query =
    `Calls overview context: this register has ${registerCount} recorded calls. ` +
    `Today's source rows: ${activity.callsToday} calls; ${activity.needsReview} need human review; ` +
    `${activity.resolvedAutomatically} have canonical outcomes recorded. ` +
    'Help me choose which call evidence to inspect next. Do not infer transcript details or provider readiness.';
  return `/assistant?q=${encodeURIComponent(query)}`;
}

export function CallsOverview({
  activity,
  calls,
  voiceSettings,
  readinessSlot,
  readOnly = false,
  canUseAssistant = false,
}: CallsOverviewProps) {
  const hasNumber = Boolean(voiceSettings.retellPhoneNumberE164);
  const hasAgent = Boolean(voiceSettings.retellAgentId);
  const activeCalls = useMemo(() => calls.filter((call) => call.status === "active"), [calls]);
  const reviewCalls = useMemo(() => calls.filter((call) => call.review.needsReview), [calls]);
  const resolvedCalls = useMemo(
    () => calls.filter((call) => call.review.resolvedAutomatically),
    [calls],
  );
  const riskCalls = useMemo(() => calls.filter((call) => call.riskFlags > 0), [calls]);
  const missedCalls = useMemo(
    () => calls.filter((call) => ["missed", "failed", "no_answer"].includes(call.status)),
    [calls],
  );
  const workOrders = useMemo(
    () =>
      calls.reduce(
        (sum, call) =>
          sum +
          call.recordsCreated.filter((record) => record.kind.includes("work_order")).length +
          (call.actionIds.some((action) => action.includes("work_order")) &&
          !call.recordsCreated.some((record) => record.kind.includes("work_order"))
            ? 1
            : 0),
        0,
      ),
    [calls],
  );

  const [filter, setFilter] = useState<CallFilter>("all");
  const [page, setPage] = useState(0);

  const filtered = useMemo(() => {
    if (filter === "review") return reviewCalls;
    if (filter === "resolved") return resolvedCalls;
    if (filter === "live") return activeCalls;
    return calls;
  }, [activeCalls, calls, filter, resolvedCalls, reviewCalls]);

  const counts = {
    all: calls.length,
    live: activeCalls.length,
    review: reviewCalls.length,
    resolved: resolvedCalls.length,
  };

  function handleFilterChange(next: CallFilter): void {
    setFilter(next);
    setPage(0);
  }

  function handlePageChange(nextPage: number): void {
    const maxPage = Math.max(0, Math.ceil(filtered.length / PAGE_SIZE) - 1);
    setPage(Math.max(0, Math.min(nextPage, maxPage)));
  }

  return (
    <div data-testid="calls-page" className="calls-operations" style={rootStyle}>
      <section style={statusFrameStyle} aria-label="Voice system status">
        <div style={statusBarStyle} data-testid="calls-line-status">
          <div style={systemGroupStyle}>
            <div style={systemItemStyle}>
              <span style={statusDot(activeCalls.length > 0 ? "green" : "gray")} />
              <span style={systemLabelStyle}>Activity</span>
              <span style={systemValueStyle}>
                {activeCalls.length > 0 ? `${activeCalls.length} in progress` : "No calls in progress"}
              </span>
            </div>
            <div style={systemItemStyle}>
              <span style={statusDot(hasNumber ? "amber" : "gray")} />
              <span style={systemLabelStyle}>Line</span>
              <span style={systemValueStyle}>
                {hasNumber ? "Number configured · carrier unverified" : "Local simulation only"}
              </span>
            </div>
            <div style={systemItemStyle}>
              <span style={statusDot(hasAgent ? "amber" : "gray")} />
              <span style={systemLabelStyle}>Retell</span>
              <span style={systemValueStyle}>
                {hasAgent ? "Agent configured · connection unverified" : "Not configured"}
              </span>
            </div>
          </div>
          {readOnly ? (
            <span data-testid="calls-va-boundary" style={systemLabelStyle}>
              View calls · prepare owner follow-up
            </span>
          ) : null}
        </div>
        <div className="calls-readiness-inline">{readinessSlot}</div>
      </section>

      <div style={sectionHeadStyle}>
        <h2 style={sectionTitleStyle}>Operational summary</h2>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span style={sectionMetaStyle}>Today · exceptions receive emphasis</span>
          {!readOnly && canUseAssistant ? (
            <Link
              href={callsAssistantHref(activity, calls.length)}
              style={askLinkStyle}
              data-testid="calls-ask-odesa"
            >
              Ask Odesa about these call records →
            </Link>
          ) : null}
        </div>
      </div>

      <div style={primaryMetricsStyle} aria-label="Immediate call exceptions">
        <PrimaryMetric
          label="Active now"
          value={activeCalls.length}
          context={activeCalls.length ? "A call record is currently active" : "No calls in progress"}
          tone="green"
          testId="calls-kpi-total"
        />
        <PrimaryMetric
          label="Needs review today"
          value={activity.needsReview}
          context={
            activity.needsReview
              ? readOnly
                ? "Prepare context for owner follow-up"
                : "Owner judgment or follow-up required"
              : "Nothing waiting"
          }
          tone="amber"
          testId="calls-kpi-review"
        />
        <PrimaryMetric
          label="Risk signals"
          value={riskCalls.length}
          context={riskCalls.length ? "Open the call before taking action" : "No urgent flags detected"}
          tone="red"
          testId="calls-kpi-risk"
        />
      </div>
      <div style={secondaryMetricsStyle} aria-label="Completed call outcomes">
        <SecondaryMetric label="Outcomes recorded" value={activity.resolvedAutomatically} testId="calls-kpi-resolved" />
        <SecondaryMetric label="Actions recorded" value={activity.actionsTaken} testId="calls-kpi-actions" />
        <SecondaryMetric label="Work orders" value={workOrders} />
        <SecondaryMetric label="Missed / failed" value={missedCalls.length} />
      </div>

      <p data-testid="calls-thesis" className="sr-only">
        Call evidence, current record status, owner follow-up, and completed outcomes.
      </p>

      <CallRegister
        items={filtered}
        filter={filter}
        onFilterChange={handleFilterChange}
        counts={counts}
        page={page}
        pageSize={PAGE_SIZE}
        onPageChange={handlePageChange}
        isEmpty={calls.length === 0}
        emptyDescription={
          readOnly
            ? "No calls recorded yet. New call records will appear here for review and owner follow-up."
            : undefined
        }
      />

      <style precedence="default" href="calls-operations-console">{`
        .calls-readiness-inline > details {
          border: 0 !important;
          border-top: 1px solid var(--hairline) !important;
          border-radius: 0 !important;
          background: transparent !important;
        }
        .calls-readiness-inline summary { padding: 7px 15px !important; min-height: 34px; }
        @media (max-width: 760px) {
          .calls-operations { min-width: 0; }
          .calls-operations [aria-label="Immediate call exceptions"] { grid-template-columns: 1fr !important; }
          .calls-operations [aria-label="Completed call outcomes"] { grid-template-columns: repeat(2, 1fr) !important; }
          .calls-operations [aria-label="Immediate call exceptions"] > div,
          .calls-operations [aria-label="Completed call outcomes"] > div { border-bottom: 1px solid var(--hairline) !important; }
        }
      `}</style>
    </div>
  );
}
