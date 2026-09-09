import type { CSSProperties, ReactNode } from "react";
import type { DecisionSummary } from "@/lib/owner-queue/mock-decisions";

/**
 * Structural chrome for the /owner-queue "Owner's decision ledger".
 *
 * This is a bounded master-detail WORKSPACE, not a card feed:
 *   - <Masthead>: a restrained summary strip — one editorial headline plus
 *     compact finite counts (judgment / routine / at stake). No hero card.
 *   - <WorkspaceFrame>: the two-pane docket shell — a fixed-width ledger index
 *     on the left and a spacious dossier on the right. Collapses to an
 *     index-first single column on narrow screens (the caller toggles which
 *     pane shows via `mobileView`).
 *   - <OwnerQueueEmptyState>: the quiet "all caught up" state.
 *
 * All colors resolve from the warm operator tokens on the `today-theme`
 * wrapper (--canvas, --ink, --terracotta, …). Numbers carry `.num` for
 * tabular figures.
 */

interface MastheadProps {
  summary: DecisionSummary;
  judgmentCount: number;
  routineCount: number;
}

interface WorkspaceFrameProps {
  index: ReactNode;
  dossier: ReactNode;
  /** Which pane the narrow layout reveals: the index list or the open dossier. */
  mobileView: "index" | "dossier";
}

const mastheadStyle: CSSProperties = {
  maxWidth: 1240,
  margin: "0 auto",
  padding: "22px 32px 14px",
  display: "flex",
  alignItems: "flex-end",
  justifyContent: "space-between",
  gap: 24,
  flexWrap: "wrap",
};

const mastheadEyebrowStyle: CSSProperties = {
  fontFamily: "var(--font-mono-operator), ui-monospace, monospace",
  fontSize: "10px",
  fontWeight: 500,
  letterSpacing: "0.16em",
  textTransform: "uppercase",
  color: "var(--terracotta)",
  marginBottom: 6,
};

const mastheadTitleStyle: CSSProperties = {
  fontFamily: "var(--font-serif-display), Georgia, serif",
  fontSize: "27px",
  fontStyle: "italic",
  fontWeight: 400,
  letterSpacing: "-0.02em",
  lineHeight: 1.05,
  color: "var(--ink)",
  margin: 0,
};

const mastheadSubStyle: CSSProperties = {
  marginTop: 6,
  maxWidth: 560,
  fontSize: "13px",
  lineHeight: 1.5,
  letterSpacing: "-0.003em",
  color: "var(--ink-2)",
};

const statRowStyle: CSSProperties = {
  display: "flex",
  gap: 10,
  alignItems: "stretch",
};

type StatTone = "judgment" | "routine" | "money";

const statStyle: CSSProperties = {
  border: "1px solid var(--hairline-faint)",
  borderLeft: "3px solid var(--hairline-strong)",
  borderRadius: 8,
  background: "var(--panel-lift)",
  padding: "9px 14px 8px",
  minWidth: 92,
};

// Per-tile accent so the strip scans as "what needs me → what's safe → what's
// exposed" rather than three identical boxes.
const statToneStyle: Record<StatTone, CSSProperties> = {
  judgment: { borderLeftColor: "var(--amber)" },
  routine: { borderLeftColor: "var(--green)" },
  money: { borderLeftColor: "var(--gold)" },
};

const statLabelStyle: CSSProperties = {
  fontFamily: "var(--font-mono-operator), ui-monospace, monospace",
  fontSize: "9px",
  letterSpacing: "0.11em",
  textTransform: "uppercase",
  color: "var(--ink-3)",
  marginBottom: 4,
};

const statValueStyle: CSSProperties = {
  fontFamily: "var(--font-mono-operator), ui-monospace, monospace",
  fontSize: "18px",
  fontWeight: 500,
  color: "var(--ink)",
  fontFeatureSettings: "'tnum' 1",
  lineHeight: 1,
};

const statValueToneStyle: Record<StatTone, CSSProperties> = {
  judgment: { color: "var(--amber-ink)" },
  routine: { color: "var(--green-ink)" },
  money: { color: "var(--ink)" },
};

const workspaceOuterStyle: CSSProperties = {
  maxWidth: 1240,
  margin: "0 auto",
  padding: "6px 32px 26px",
  flex: 1,
  minHeight: 0,
};

const emptyStateStyle: CSSProperties = {
  maxWidth: 980,
  margin: "40px auto",
  background: "var(--panel-lift)",
  border: "1px solid var(--hairline)",
  borderRadius: 10,
  padding: "48px 24px",
  textAlign: "center",
};

const emptyTitleStyle: CSSProperties = {
  fontFamily: "var(--font-serif-display), Georgia, serif",
  fontStyle: "italic",
  fontSize: "21px",
  letterSpacing: "-0.015em",
  color: "var(--ink)",
  marginBottom: 8,
};

const emptySubStyle: CSSProperties = {
  maxWidth: 520,
  margin: "0 auto",
  fontSize: "13px",
  color: "var(--ink-3)",
  letterSpacing: "-0.003em",
  lineHeight: 1.5,
};

export function Masthead({
  summary,
  judgmentCount,
  routineCount,
}: MastheadProps) {
  return (
    <section aria-labelledby="owner-ledger-title" style={mastheadStyle}>
      <div style={{ minWidth: 0 }}>
        <div style={mastheadEyebrowStyle}>Owner&apos;s decision ledger</div>
        <h2 id="owner-ledger-title" style={mastheadTitleStyle}>
          What Odesa is holding for you.
        </h2>
        <p style={mastheadSubStyle}>
          Every entry is one held action — the safeguard keeping it in the
          ledger and the cost of leaving it. Pick a line to open its dossier;
          routine work can be reviewed as a batch.
        </p>
      </div>

      <div aria-label="Ledger summary" style={statRowStyle}>
        <Stat
          tone="judgment"
          label="Needs judgment"
          value={String(judgmentCount)}
        />
        <Stat tone="routine" label="Routine" value={String(routineCount)} />
        <Stat tone="money" label="At stake" value={summary.totalAtStake} />
      </div>
    </section>
  );
}

export function WorkspaceFrame({
  index,
  dossier,
  mobileView,
}: WorkspaceFrameProps) {
  return (
    <div style={workspaceOuterStyle}>
      <div className="oq-workspace" data-mobile-view={mobileView}>
        <div className="oq-index">{index}</div>
        <div className="oq-dossier">{dossier}</div>
      </div>
    </div>
  );
}

export function OwnerQueueEmptyState() {
  return (
    <div role="status" data-testid="owner-queue-empty" style={emptyStateStyle}>
      <div style={emptyTitleStyle}>You&apos;re all caught up</div>
      <div style={emptySubStyle}>
        No decisions need your attention right now. As Odesa prepares real owner
        decisions from calls, maintenance, rent, and lease workflows, they will
        appear here with source notes and explicit approval gates.
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: StatTone;
}) {
  return (
    <div style={{ ...statStyle, ...statToneStyle[tone] }}>
      <div style={statLabelStyle}>{label}</div>
      <div
        className="num"
        style={{ ...statValueStyle, ...statValueToneStyle[tone] }}
      >
        {value}
      </div>
    </div>
  );
}
