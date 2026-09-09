/**
 * CallDetailDossier — the dedicated `/calls/[id]` Call Review Studio.
 *
 * The record is arranged around evidence rather than cards: call map on the
 * left, transcript in the center, and Odesa's action trace on the right. The
 * source strip is explicit about what this record contains; no fake audio
 * transport is rendered because `voice_calls` stores transcripts, not audio.
 */

import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";

import {
  humanizeCallReason,
  type VoiceCallDetail,
  type CallStatusTone,
} from "@/lib/voice/queries";
import {
  CALLER_KIND_LABELS,
  intentLabel,
  timeLabel,
  namedActions,
  outcomeSentence,
  reviewReason,
  nextMove,
  safeCallerLabel,
} from "@/components/calls/call-copy";
import {
  StatusChip,
  type StatusChipTone,
} from "@/components/shared/status-chip";
import { TextExportActions } from "@/components/calls/text-export-actions";
import type { Json } from "@/types/database";

function asRecord(value: Json | null): Record<string, Json | undefined> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, Json | undefined>)
    : {};
}

function strings(value: Json | undefined): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function idField(
  record: Record<string, Json | undefined>,
  key: string,
): string | null {
  const value = record[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

const RECORD_LABELS: Record<string, string> = {
  work_order: "Work order record created",
  conversation: "Inbox conversation recorded",
  proposal: "Owner Queue item created",
};

function recordLabel(kind: string): string {
  return RECORD_LABELS[kind] ?? "Related record created";
}

const CHIP_TONE: Record<CallStatusTone, StatusChipTone> = {
  green: "green",
  clay: "clay",
  gold: "amber",
  neutral: "neutral-gold",
};

interface PanelPalette {
  bg: string;
  border: string;
  ink: string;
}

const MOVE_PALETTE: Record<string, PanelPalette> = {
  clay: {
    bg: "var(--clay-bg)",
    border: "var(--clay-border)",
    ink: "var(--clay-ink)",
  },
  green: {
    bg: "var(--green-bg)",
    border: "var(--green-border)",
    ink: "var(--green-ink)",
  },
  neutral: {
    bg: "var(--panel-lift)",
    border: "var(--hairline)",
    ink: "var(--ink-2)",
  },
};

const pageStyle: CSSProperties = {
  background: "var(--panel-clean)",
  minHeight: "100vh",
  padding: "24px 28px 56px",
  fontFamily: "var(--font-body)",
};

const backLinkStyle: CSSProperties = {
  fontFamily: "var(--font-mono), ui-monospace, monospace",
  fontSize: "10.5px",
  letterSpacing: "0.06em",
  textTransform: "uppercase",
  color: "var(--ink-3)",
  textDecoration: "none",
};

const eyebrowStyle: CSSProperties = {
  fontFamily: "var(--font-mono), ui-monospace, monospace",
  fontSize: "9px",
  fontWeight: 600,
  letterSpacing: "0.13em",
  textTransform: "uppercase",
  color: "var(--ink-3)",
};

const h1Style: CSSProperties = {
  fontFamily: "var(--font-display), var(--font-sans), system-ui, sans-serif",
  fontWeight: 400,
  fontSize: "30px",
  letterSpacing: "-0.02em",
  lineHeight: 1.05,
  color: "var(--ink)",
  margin: 0,
};

const monoStyle: CSSProperties = {
  fontFamily: "var(--font-mono), ui-monospace, monospace",
  fontSize: "10px",
  letterSpacing: "0.035em",
  color: "var(--ink-3)",
  fontVariantNumeric: "tabular-nums",
};

const panelStyle: CSSProperties = {
  border: "1px solid var(--hairline)",
  borderRadius: 8,
  background: "var(--panel-lift)",
  padding: "14px 15px",
};

const panelHeadingStyle: CSSProperties = {
  ...eyebrowStyle,
  display: "block",
  marginBottom: 9,
};

const summaryStyle: CSSProperties = {
  fontFamily: "var(--font-display), var(--font-sans), system-ui, sans-serif",
  fontSize: "15px",
  lineHeight: 1.5,
  color: "var(--ink)",
  margin: 0,
};

const mutedStyle: CSSProperties = {
  margin: 0,
  fontSize: "12px",
  lineHeight: 1.5,
  color: "var(--ink-3)",
};

const itemStyle: CSSProperties = {
  display: "flex",
  gap: 9,
  alignItems: "baseline",
  padding: "7px 0",
  borderBottom: "1px solid var(--hairline-faint)",
  fontSize: "12px",
  lineHeight: 1.42,
  color: "var(--ink-2)",
};

const smallLinkStyle: CSSProperties = {
  ...monoStyle,
  color: "var(--terracotta)",
  textDecoration: "none",
  whiteSpace: "nowrap",
};

const identityLinkStyle: CSSProperties = {
  display: "block",
  padding: "6px 0",
  borderBottom: "1px solid var(--hairline-faint)",
  fontSize: "11.5px",
  color: "var(--terracotta)",
  textDecoration: "none",
};

const chipStyle: CSSProperties = {
  display: "inline-block",
  ...monoStyle,
  fontSize: "9px",
  textTransform: "uppercase",
  border: "1px solid var(--hairline)",
  borderRadius: 999,
  padding: "3px 8px",
  margin: "0 5px 5px 0",
};

function Panel({
  title,
  children,
  testId,
  action,
  style,
}: {
  title: string;
  children: ReactNode;
  testId?: string;
  action?: ReactNode;
  style?: CSSProperties;
}) {
  return (
    <section style={{ ...panelStyle, ...style }} data-testid={testId}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 10,
        }}
      >
        <span style={panelHeadingStyle}>{title}</span>
        {action}
      </div>
      {children}
    </section>
  );
}

function Item({
  color,
  children,
  trailing,
}: {
  color: string;
  children: ReactNode;
  trailing?: ReactNode;
}) {
  return (
    <div style={itemStyle}>
      <span aria-hidden="true" style={{ color, fontSize: 15 }}>
        •
      </span>
      <span style={{ flex: 1 }}>{children}</span>
      {trailing}
    </div>
  );
}

function recordLink(
  kind: string,
  id: string,
  audience: 'owner' | 'va',
): ReactNode {
  if (kind === "work_order") {
    return (
      <Link href={`/work-orders/${id}`} style={smallLinkStyle}>
        Open →
      </Link>
    );
  }
  if (kind === "conversation") {
    return (
      <Link
        href={`/inbox?conversation=${encodeURIComponent(id)}`}
        style={smallLinkStyle}
      >
        Open →
      </Link>
    );
  }
  if (kind === "proposal") {
    return (
      <Link
        href={
          audience === "va"
            ? `/escalations?proposal=${encodeURIComponent(id)}`
            : "/owner-queue"
        }
        style={smallLinkStyle}
      >
        {audience === "va" ? "Owner handoff" : "Review"} →
      </Link>
    );
  }
  return null;
}

const AGENT_SPEAKER = /^(odesa|agent|assistant|ai)$/i;

function transcriptLines(text: string): ReactNode[] {
  return text.split("\n").map((line, index) => {
    const match = line.match(/^([A-Za-z][A-Za-z .'-]{0,22}):\s?(.*)$/);
    if (!match) {
      return line.trim() ? (
        <p key={index} style={{ margin: "0 0 12px", color: "var(--ink-2)" }}>
          {line}
        </p>
      ) : (
        <div key={index} style={{ height: 4 }} />
      );
    }

    const [, speaker, body] = match;
    const isAgent = AGENT_SPEAKER.test(speaker.trim());
    return (
      <div key={index} className="transcript-turn">
        <span
          style={{
            ...monoStyle,
            color: isAgent ? "var(--terracotta)" : "var(--ink)",
            fontWeight: 600,
            textTransform: "uppercase",
          }}
        >
          {speaker}
        </span>
        <p
          style={{ margin: "4px 0 0", color: "var(--ink-2)", lineHeight: 1.62 }}
        >
          {body}
        </p>
      </div>
    );
  });
}

export function CallDetailDossier({
  detail,
  audience = "owner",
}: {
  detail: VoiceCallDetail;
  audience?: "owner" | "va";
}) {
  const { review } = detail;
  const outcome = asRecord(detail.outcome);
  const approvals = strings(outcome.approvalsNeeded);
  const riskFlags = strings(outcome.riskFlags);
  const unresolved = strings(outcome.unresolved);
  const tenantId = idField(outcome, "tenantId");
  const vendorId = idField(outcome, "vendorId");
  const propertyId = idField(outcome, "propertyId");

  const actions = namedActions(detail);
  const baseMove = nextMove(detail);
  const proposalId = detail.recordsCreated.find(
    (record) => record.kind === "proposal",
  )?.id;
  const move =
    audience === "va" && baseMove.href === "/owner-queue"
      ? {
          ...baseMove,
          label: "Prepare owner handoff",
          href: proposalId
            ? `/escalations?proposal=${encodeURIComponent(proposalId)}`
            : "/escalations",
        }
      : baseMove.href === "/inbox" && detail.conversationId
        ? {
            ...baseMove,
            href: `/inbox?conversation=${encodeURIComponent(detail.conversationId)}`,
          }
        : baseMove;
  const moveReason = reviewReason(review);
  const movePalette = MOVE_PALETTE[move.tone] ?? MOVE_PALETTE.neutral;
  const caller = safeCallerLabel(detail.callerLabel, detail.callerKind);
  const kindLabel = CALLER_KIND_LABELS[detail.callerKind] ?? "Caller";
  const transcript = detail.transcript?.trim() || null;
  const hasIdentity = Boolean(tenantId || vendorId || propertyId);
  const didAnything =
    actions.length > 0 ||
    detail.recordsCreated.length > 0 ||
    detail.smsSentCount > 0;
  const leftAnything =
    approvals.length > 0 ||
    riskFlags.length > 0 ||
    unresolved.length > 0 ||
    detail.smsDraftedCount > 0;
  const statusLabel =
    detail.status === "completed"
      ? "Completed"
      : detail.status === "active"
        ? "In progress"
        : intentLabel(detail.status);

  return (
    <div
      data-testid="call-detail-page"
      className="today-theme call-review-studio"
      style={pageStyle}
    >
      <div style={{ maxWidth: 1240, margin: "0 auto" }}>
        <Link href="/calls" style={backLinkStyle}>
          ← Review log
        </Link>

        <header className="studio-header">
          <div>
            <span style={eyebrowStyle}>Call review studio</span>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                flexWrap: "wrap",
                marginTop: 6,
              }}
            >
              <h1 style={h1Style}>{caller}</h1>
              <StatusChip
                tone={CHIP_TONE[review.statusTone]}
                label={review.statusLabel}
                size="queue"
              />
            </div>
            <div style={{ ...monoStyle, marginTop: 8 }}>
              {kindLabel} · {timeLabel(detail.startedAt)} · {statusLabel}
            </div>
          </div>
          <div style={{ textAlign: "right" }}>
            <span style={eyebrowStyle}>Evidence record</span>
            <div style={{ ...monoStyle, marginTop: 5 }}>
              {transcript ? "Transcript available" : "Transcript unavailable"}
            </div>
          </div>
        </header>

        <div className="studio-grid">
          <aside className="studio-map" aria-label="Call map">
            <Panel title="Call map">
              <p style={summaryStyle}>{outcomeSentence(detail)}</p>
            </Panel>

            <Panel title="Topics">
              {detail.intents.length > 0 ? (
                <div>
                  {detail.intents.map((intent) => (
                    <span key={intent} style={chipStyle}>
                      {intentLabel(intent)}
                    </span>
                  ))}
                </div>
              ) : (
                <p style={mutedStyle}>No topics were confidently identified.</p>
              )}
            </Panel>

            <Panel title="Participants & records" testId="call-identity">
              <div style={itemStyle}>
                <span style={{ flex: 1 }}>Caller</span>
                <strong>{caller}</strong>
              </div>
              {hasIdentity ? (
                <>
                  {tenantId ? (
                    <Link
                      href={`/tenants/${tenantId}`}
                      style={identityLinkStyle}
                    >
                      Open tenant record →
                    </Link>
                  ) : null}
                  {vendorId ? (
                    <Link
                      href={`/vendors/${vendorId}`}
                      style={identityLinkStyle}
                    >
                      Open vendor record →
                    </Link>
                  ) : null}
                  {propertyId ? (
                    <Link
                      href={`/properties/${propertyId}`}
                      style={identityLinkStyle}
                    >
                      Open property →
                    </Link>
                  ) : null}
                </>
              ) : (
                <p style={{ ...mutedStyle, marginTop: 9 }}>
                  No verified tenant, vendor, or property link.
                </p>
              )}
            </Panel>
          </aside>

          <section
            className="studio-transcript"
            aria-label="Transcript evidence"
          >
            <Panel
              title="Transcript evidence"
              testId="call-transcript"
              action={
                transcript ? (
                  <TextExportActions
                    text={transcript}
                    filename="odesa-call-transcript.txt"
                    idPrefix="transcript"
                  />
                ) : null
              }
              style={{ minHeight: 540, background: "var(--panel-clean)" }}
            >
              <div className="transcript-provenance">
                <span style={monoStyle}>Generated transcript</span>
                <span style={monoStyle}>Original text preserved</span>
              </div>
              <div className="transcript-body">
                {transcript ? (
                  transcriptLines(transcript)
                ) : (
                  <p style={mutedStyle}>
                    No transcript was recorded for this call.
                  </p>
                )}
              </div>
            </Panel>
          </section>

          <aside className="studio-trace" aria-label="Odesa action trace">
            <section
              data-testid="call-next-move"
              style={{
                ...panelStyle,
                background: movePalette.bg,
                borderColor: movePalette.border,
              }}
            >
              <span style={{ ...panelHeadingStyle, color: movePalette.ink }}>
                Next move
              </span>
              {move.href ? (
                <Link
                  href={move.href}
                  data-testid="call-next-move-link"
                  style={{
                    fontSize: "15px",
                    color: movePalette.ink,
                    textDecoration: "none",
                  }}
                >
                  {move.label} →
                </Link>
              ) : (
                <strong style={{ fontSize: "14px", color: movePalette.ink }}>
                  {move.label}
                </strong>
              )}
              {review.needsReview && moveReason ? (
                <p
                  style={{
                    ...mutedStyle,
                    color: movePalette.ink,
                    marginTop: 7,
                  }}
                >
                  {moveReason}
                </p>
              ) : null}
            </section>

            <Panel title="What Odesa did" testId="call-did">
              {didAnything ? (
                <>
                  {actions.map((label) => (
                    <Item key={label} color="var(--green)">
                      {label}
                    </Item>
                  ))}
                  {detail.recordsCreated.map(({ kind, id }) => (
                    <Item
                      key={`${kind}-${id}`}
                      color="var(--ink-4)"
                      trailing={recordLink(kind, id, audience)}
                    >
                      {recordLabel(kind)}
                    </Item>
                  ))}
                  {detail.smsSentCount > 0 ? (
                    <Item color="var(--green)">
                      {detail.smsSentCount} provider-accepted message
                      {detail.smsSentCount === 1 ? "" : "s"}
                    </Item>
                  ) : null}
                </>
              ) : (
                <p style={mutedStyle}>
                  No completed action is recorded for this call.
                </p>
              )}
            </Panel>

            <Panel
              title={audience === "va" ? "Owner handoff" : "Left for you"}
              testId="call-left"
            >
              {leftAnything ? (
                <>
                  {approvals.length > 0 ? (
                    <Item color="var(--clay)">
                      {approvals.length} review item
                      {approvals.length === 1 ? "" : "s"} awaiting owner review
                    </Item>
                  ) : null}
                  {detail.smsDraftedCount > 0 ? (
                    <Item color="var(--clay)">
                      {detail.smsDraftedCount} SMS draft
                      {detail.smsDraftedCount === 1 ? "" : "s"} awaiting{' '}
                      {audience === "va" ? "owner approval" : "approval"}
                    </Item>
                  ) : null}
                  {riskFlags.map((flag) => (
                    <Item key={flag} color="var(--clay)">
                      {humanizeCallReason(flag)}
                    </Item>
                  ))}
                  {unresolved.map((item) => (
                    <Item key={item} color="var(--gold)">
                      Couldn&apos;t confirm: {humanizeCallReason(item)}
                    </Item>
                  ))}
                </>
              ) : (
                <p style={mutedStyle}>
                  {review.resolvedAutomatically
                    ? "No outstanding review item is recorded."
                    : "No completed review outcome is recorded."}
                </p>
              )}
            </Panel>
          </aside>
        </div>

        <section className="source-strip" aria-label="Call source and access">
          <div>
            <span style={eyebrowStyle}>Source record</span>
            <p style={{ ...mutedStyle, marginTop: 5 }}>
              {transcript
                ? "A transcript is stored with this call. "
                : "No transcript is stored with this call. "}
              Outcome status: {review.statusLabel.toLowerCase()}. Audio recording
              is not stored in the current voice call record.
            </p>
          </div>
          <div>
            <span style={eyebrowStyle}>Access</span>
            <p style={{ ...mutedStyle, marginTop: 5 }}>
              Scoped to this organization · caller number masked in review
              chrome
            </p>
          </div>
          <div>
            <span style={eyebrowStyle}>Audit trail</span>
            <p style={{ ...mutedStyle, marginTop: 5 }}>
              Stored with organization scope
            </p>
          </div>
        </section>
      </div>

      <style precedence="default" href="call-review-studio">{`
        .studio-header {
          display: flex;
          align-items: flex-end;
          justify-content: space-between;
          gap: 20px;
          margin-top: 15px;
          padding-bottom: 16px;
          border-bottom: 1px solid var(--hairline);
        }
        .studio-grid {
          display: grid;
          grid-template-columns: minmax(190px, 230px) minmax(360px, 1fr) minmax(245px, 290px);
          gap: 14px;
          align-items: start;
          margin-top: 14px;
        }
        .studio-map, .studio-trace {
          display: flex;
          flex-direction: column;
          gap: 0;
        }
        .transcript-provenance {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
          padding: 8px 0 10px;
          border-bottom: 1px solid var(--hairline);
        }
        .transcript-body {
          padding: 18px 2px 4px;
          font-size: 13.5px;
        }
        .transcript-turn {
          padding: 0 0 14px 14px;
          margin-bottom: 14px;
          border-left: 2px solid var(--hairline-strong);
        }
        .source-strip {
          display: grid;
          grid-template-columns: 1.5fr 1.2fr 120px;
          gap: 22px;
          margin-top: 14px;
          padding: 13px 15px;
          border: 1px solid var(--hairline);
          border-radius: 8px;
          background: var(--panel-lift);
        }
        @media (max-width: 980px) {
          .studio-grid {
            grid-template-columns: minmax(180px, 220px) minmax(0, 1fr);
          }
          .studio-trace { grid-column: 1 / -1; display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
        }
        @media (max-width: 700px) {
          .call-review-studio { padding: 18px 14px 40px !important; }
          .studio-header { align-items: flex-start; }
          .studio-header > :last-child { display: none; }
          .studio-grid { grid-template-columns: 1fr; }
          .studio-transcript { grid-row: 1; }
          .studio-map { grid-row: 2; }
          .studio-trace { grid-column: auto; grid-row: 3; display: flex; }
          .source-strip { grid-template-columns: 1fr; gap: 12px; }
          .transcript-provenance { align-items: flex-start; flex-direction: column; }
        }
      `}</style>
    </div>
  );
}
