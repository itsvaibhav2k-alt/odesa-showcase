"use client";

import type { CSSProperties } from "react";
import type { Decision } from "@/lib/owner-queue/mock-decisions";
import type { DecisionStatus } from "./use-owner-queue-controller";
import { DecisionMetric } from "./decision-metric";
import { ReasoningDisclosure } from "./reasoning-disclosure";
import {
  ConsequencePair,
  SourceChips,
  WhyThisDisclosure,
  confidenceGateLine,
  metricChipsWithoutConfidence,
} from "./decision-evidence";

/**
 * The right dossier pane — the open case file for the ONE selected decision.
 * Reads as an editorial folio, not a card: ruled sections and typography
 * (context → recommendation → metrics → sources/reasoning → the paired
 * Safeguard / If-you-do-nothing) with a persistent action rail pinned to the
 * bottom of the pane.
 *
 * SAFETY — identical semantics to the retired decision cards. The primary
 * NEVER commits a tenant-facing / money / lease action directly: for those it
 * opens the preview drawer (parent `onPrimary`), where an explicit in-drawer
 * "Save & approve" is the only commit path. `dispatch_vendor` is a safe no-op
 * so its "Record dispatch approval" commits directly. Decline (recordOutcome rejected)
 * is always safe. All per-decision control test-ids (`approve-<id>`,
 * `decline-<id>`, `why-<id>`, `save-guidance-<id>`, `settled-<id>`,
 * `error-<id>`) and the boundary copy live inside this one <article>.
 */

export interface DecisionDossierProps {
  decision: Decision;
  /** Whether the decision needs owner judgment (amber) vs is routine (green). */
  isJudgment: boolean;
  status: DecisionStatus;
  error: string | null;
  busy: boolean;
  isDisclosureOpen: boolean;
  onToggleDisclosure: () => void;
  onPrimary: () => void;
  onDecline: () => void;
  onSaveGuidance: () => void;
  /** 1-based position + total for the "Decision N of M" orientation cue. */
  position: { index: number; total: number };
  hasPrev: boolean;
  hasNext: boolean;
  onPrev: () => void;
  onNext: () => void;
  /** Narrow-layout return-to-index control. */
  onBackToDocket: () => void;
}

const dossierStyle: CSSProperties = {
  background: "var(--panel-lift)",
  border: "1px solid var(--hairline)",
  borderRadius: 10,
  display: "flex",
  flexDirection: "column",
  overflow: "hidden",
  minHeight: 0,
  height: "100%",
};

const scrollStyle: CSSProperties = {
  flex: 1,
  overflowY: "auto",
  padding: "20px 26px 22px",
  minHeight: 0,
};

const backBtnStyle: CSSProperties = {
  display: "none",
  alignItems: "center",
  gap: 6,
  fontFamily: "var(--font-mono-operator), ui-monospace, monospace",
  fontSize: "10px",
  fontWeight: 500,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  color: "var(--ink-2)",
  padding: "6px 10px",
  border: "1px solid var(--hairline)",
  borderRadius: 5,
  background: "transparent",
  cursor: "pointer",
  marginBottom: 14,
};

const eyebrowRowStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 12,
  marginBottom: 9,
};

const eyebrowStyle: CSSProperties = {
  fontFamily: "var(--font-mono-operator), ui-monospace, monospace",
  fontSize: "10px",
  letterSpacing: "0.1em",
  textTransform: "uppercase",
  color: "var(--ink-2)",
};

const locStyle: CSSProperties = {
  color: "var(--ink-3)",
};

const chipBase: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 5,
  fontFamily: "var(--font-mono-operator), ui-monospace, monospace",
  fontSize: "9px",
  fontWeight: 500,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  padding: "3px 8px",
  borderRadius: 3,
  whiteSpace: "nowrap",
};

const judgmentChipStyle: CSSProperties = {
  ...chipBase,
  border: "1px solid var(--amber-border)",
  background: "var(--amber-bg)",
  color: "var(--amber-ink)",
};

const routineChipStyle: CSSProperties = {
  ...chipBase,
  border: "1px solid var(--green-border)",
  background: "var(--green-bg)",
  color: "var(--green-ink)",
};

const pulseJudgmentStyle: CSSProperties = {
  width: 4,
  height: 4,
  borderRadius: "50%",
  background: "var(--amber)",
};

const pulseRoutineStyle: CSSProperties = {
  width: 4,
  height: 4,
  borderRadius: "50%",
  background: "var(--green)",
};

const titleStyle: CSSProperties = {
  fontFamily: "var(--font-serif-display), Georgia, serif",
  fontSize: "24px",
  fontStyle: "italic",
  fontWeight: 400,
  letterSpacing: "-0.018em",
  lineHeight: 1.14,
  color: "var(--ink)",
  margin: "0 0 8px",
};

const gateReasonStyle: CSSProperties = {
  fontFamily: "var(--font-mono-operator), ui-monospace, monospace",
  fontSize: "10.5px",
  letterSpacing: "0.03em",
  marginBottom: 16,
};

const sectionLabelStyle: CSSProperties = {
  fontFamily: "var(--font-mono-operator), ui-monospace, monospace",
  fontSize: "9.5px",
  fontWeight: 500,
  letterSpacing: "0.13em",
  textTransform: "uppercase",
  color: "var(--ink-3)",
  margin: "18px 0 9px",
  display: "flex",
  alignItems: "center",
  gap: 9,
};

const sectionRuleLineStyle: CSSProperties = {
  flex: 1,
  height: 1,
  background: "var(--hairline-faint)",
};

const metricsStyle: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: 8,
};

const reasonStyle: CSSProperties = {
  fontSize: "14px",
  lineHeight: 1.6,
  color: "var(--ink)",
  letterSpacing: "-0.003em",
};

const impactStyle: CSSProperties = {
  fontSize: "12.5px",
  color: "var(--ink)",
  letterSpacing: "-0.003em",
  marginTop: 12,
};

const impactLabelStyle: CSSProperties = {
  fontFamily: "var(--font-mono-operator), ui-monospace, monospace",
  fontSize: "9.5px",
  fontWeight: 500,
  letterSpacing: "0.1em",
  textTransform: "uppercase",
  color: "var(--green-ink)",
  marginRight: 8,
};

const whyToggleStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  fontSize: "11.5px",
  fontWeight: 450,
  color: "var(--ink-2)",
  padding: "6px 11px",
  border: "1px solid var(--hairline)",
  borderRadius: 5,
  background: "transparent",
  letterSpacing: "-0.003em",
  cursor: "pointer",
  marginTop: 18,
};

const whyToggleOpenStyle: CSSProperties = {
  ...whyToggleStyle,
  background: "var(--canvas)",
  borderColor: "var(--hairline-strong)",
  color: "var(--ink)",
};

const whyIconStyle: CSSProperties = {
  fontSize: "11px",
  color: "var(--terracotta)",
};

// -------- sticky action rail --------

const railStyle: CSSProperties = {
  borderTop: "1px solid var(--hairline)",
  background: "var(--canvas)",
  padding: "12px 26px 14px",
  display: "flex",
  flexDirection: "column",
  gap: 10,
};

const orientRowStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 10,
};

const positionStyle: CSSProperties = {
  fontFamily: "var(--font-mono-operator), ui-monospace, monospace",
  fontSize: "10px",
  letterSpacing: "0.06em",
  textTransform: "uppercase",
  color: "var(--ink-3)",
  fontVariantNumeric: "tabular-nums",
};

const stepBtnStyle: CSSProperties = {
  fontFamily: "var(--font-mono-operator), ui-monospace, monospace",
  fontSize: "10px",
  fontWeight: 500,
  letterSpacing: "0.04em",
  padding: "4px 9px",
  borderRadius: 5,
  border: "1px solid var(--hairline-strong)",
  background: "var(--panel-lift)",
  color: "var(--ink)",
  cursor: "pointer",
};

const stepBtnDisabledStyle: CSSProperties = {
  ...stepBtnStyle,
  opacity: 0.4,
  cursor: "default",
  color: "var(--ink-3)",
};

const actionsStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  flexWrap: "wrap",
};

const spacerStyle: CSSProperties = {
  flex: 1,
};

const btnBase: CSSProperties = {
  fontSize: "12.5px",
  fontWeight: 450,
  padding: "8px 14px",
  borderRadius: 5,
  border: "1px solid var(--hairline-strong)",
  background: "var(--panel-lift)",
  color: "var(--ink)",
  letterSpacing: "-0.005em",
  cursor: "pointer",
};

const btnPrimary: CSSProperties = {
  ...btnBase,
  background: "var(--ink)",
  color: "var(--panel-lift)",
  borderColor: "var(--ink)",
  padding: "8px 18px",
};

const btnGhost: CSSProperties = {
  ...btnBase,
  background: "transparent",
};

const btnBusy: CSSProperties = {
  cursor: "progress",
  opacity: 0.6,
};

const guidanceBtnStyle: CSSProperties = {
  ...btnBase,
  background: "transparent",
  fontSize: "12px",
  padding: "8px 12px",
  color: "var(--ink-2)",
  border: "1px solid var(--hairline)",
};

const stateLineStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 7,
  fontSize: "12.5px",
  fontWeight: 450,
  color: "var(--ink-2)",
  letterSpacing: "-0.003em",
};

const settledStyle: CSSProperties = {
  ...stateLineStyle,
};

const checkStyle: CSSProperties = { color: "var(--green-ink)" };
const declinedMarkStyle: CSSProperties = { color: "var(--ink-3)" };

const stateMarkStyle: CSSProperties = {
  width: 4,
  height: 4,
  borderRadius: "50%",
  background: "var(--amber)",
};

const errStyle: CSSProperties = {
  color: "var(--terracotta)",
  fontSize: "12px",
  letterSpacing: "-0.003em",
};

export function DecisionDossier({
  decision,
  isJudgment,
  status,
  error,
  busy,
  isDisclosureOpen,
  onToggleDisclosure,
  onPrimary,
  onDecline,
  onSaveGuidance,
  position,
  hasPrev,
  hasNext,
  onPrev,
  onNext,
  onBackToDocket,
}: DecisionDossierProps) {
  const isSettled = status === "approved" || status === "declined";
  const isEdited = status === "edited";

  const primaryActionLabel = isEdited
    ? "Approve edited recommendation"
    : (decision.primaryActionLabel ??
      (isJudgment ? "Escalate to owner" : "Approve"));

  const chips = metricChipsWithoutConfidence(decision.metricChips);
  const composedGateLine = confidenceGateLine(
    decision.metricChips,
    decision.gateReason,
  );
  const bareChip = isJudgment ? "Owner review required" : "Recommended";
  const gateReasonLine = composedGateLine === bareChip ? "" : composedGateLine;

  const whyFacts = decision.whyFacts ?? [];
  const useStructuredWhy = decision.whyFacts != null;
  const disclosureRegionId = useStructuredWhy
    ? `why-this-${decision.id}`
    : `reasoning-${decision.id}`;

  const hasSourceChips = (decision.sourceFacts ?? []).length > 0;
  const hasBoundary = (decision.boundary ?? "").trim().length > 0;
  const hasIfIgnored = (decision.ifIgnored ?? "").trim().length > 0;
  const canSaveGuidance = (decision.propertyId ?? "").trim().length > 0;

  return (
    <article
      data-testid="decision-dossier"
      aria-labelledby={`dossier-title-${decision.id}`}
      style={dossierStyle}
    >
      <div style={scrollStyle}>
        <button
          type="button"
          className="oq-back"
          data-testid="dossier-back"
          style={backBtnStyle}
          onClick={onBackToDocket}
        >
          ‹ Back to docket
        </button>

        <div style={eyebrowRowStyle}>
          <div style={eyebrowStyle}>
            {decision.type} <span style={locStyle}>· {decision.location}</span>
          </div>
          <span style={isJudgment ? judgmentChipStyle : routineChipStyle}>
            <span
              aria-hidden="true"
              style={isJudgment ? pulseJudgmentStyle : pulseRoutineStyle}
            />
            {isJudgment ? "Owner review required" : "Recommended"}
          </span>
        </div>

        <h2 id={`dossier-title-${decision.id}`} style={titleStyle}>
          {decision.title}
        </h2>

        {gateReasonLine ? (
          <div
            data-testid={`gate-reason-${decision.id}`}
            style={{
              ...gateReasonStyle,
              color: isJudgment ? "var(--amber-ink)" : "var(--ink-3)",
            }}
          >
            {gateReasonLine}
          </div>
        ) : null}

        {chips.length > 0 ? (
          <>
            <div style={sectionLabelStyle}>
              At stake
              <span aria-hidden="true" style={sectionRuleLineStyle} />
            </div>
            <div style={metricsStyle}>
              {chips.map((chip) => (
                <DecisionMetric
                  key={chip.label}
                  label={chip.label}
                  value={chip.value}
                  isRisk={chip.isRisk}
                  isMoney={chip.value.trim().startsWith("$")}
                />
              ))}
            </div>
          </>
        ) : null}

        <div style={sectionLabelStyle}>
          Odesa recommends
          <span aria-hidden="true" style={sectionRuleLineStyle} />
        </div>
        {/* sanitize before real data — odesaLine is escaped by the adapter. */}
        <div
          style={reasonStyle}
          dangerouslySetInnerHTML={{ __html: decision.odesaLine }}
        />
        {decision.impact ? (
          <div style={impactStyle}>
            <span style={impactLabelStyle}>Impact</span>
            {decision.impact}
          </div>
        ) : null}

        {hasBoundary || hasIfIgnored ? (
          <>
            <div style={sectionLabelStyle}>
              Safeguard &amp; consequence
              <span aria-hidden="true" style={sectionRuleLineStyle} />
            </div>
            <ConsequencePair
              boundary={decision.boundary}
              ifIgnored={decision.ifIgnored}
            />
          </>
        ) : null}

        {hasSourceChips ? (
          <>
            <div style={sectionLabelStyle}>
              Sources
              <span aria-hidden="true" style={sectionRuleLineStyle} />
            </div>
            <SourceChips sourceFacts={decision.sourceFacts} />
          </>
        ) : null}

        <div>
          <button
            type="button"
            data-testid={`why-${decision.id}`}
            style={isDisclosureOpen ? whyToggleOpenStyle : whyToggleStyle}
            aria-expanded={isDisclosureOpen}
            aria-controls={disclosureRegionId}
            onClick={onToggleDisclosure}
          >
            <span aria-hidden="true" style={whyIconStyle}>
              ◆
            </span>
            {isDisclosureOpen ? "Hide reasoning" : "Why this?"}
          </button>
        </div>

        {useStructuredWhy ? (
          <WhyThisDisclosure
            id={decision.id}
            whyFacts={whyFacts}
            sourceFacts={decision.sourceFacts}
            boundary={decision.boundary}
            gateReason={decision.gateReason}
            ifIgnored={decision.ifIgnored}
            reasoningSections={decision.reasoningSections}
            rawReasoning={decision.rawReasoning}
            isOpen={isDisclosureOpen}
          />
        ) : (
          <ReasoningDisclosure
            id={decision.id}
            considerations={decision.considerations}
            isOpen={isDisclosureOpen}
          />
        )}
      </div>

      <div style={railStyle}>
        <div style={orientRowStyle}>
          <span style={positionStyle} data-testid="dossier-position">
            Decision {position.index} of {position.total}
          </span>
          <div style={{ display: "flex", gap: 6 }}>
            <button
              type="button"
              data-testid="dossier-prev"
              style={hasPrev ? stepBtnStyle : stepBtnDisabledStyle}
              disabled={!hasPrev}
              aria-disabled={!hasPrev}
              onClick={onPrev}
            >
              ‹ Prev
            </button>
            <button
              type="button"
              data-testid="dossier-next"
              style={hasNext ? stepBtnStyle : stepBtnDisabledStyle}
              disabled={!hasNext}
              aria-disabled={!hasNext}
              onClick={onNext}
            >
              Next ›
            </button>
          </div>
        </div>

        {isSettled ? (
          <div style={actionsStyle}>
            <span data-testid={`settled-${decision.id}`} style={settledStyle}>
              {status === "approved" ? (
                <>
                  <span aria-hidden="true" style={checkStyle}>
                    ✓
                  </span>
                  Approval recorded
                </>
              ) : (
                <>
                  <span aria-hidden="true" style={declinedMarkStyle}>
                    ✕
                  </span>
                  Declined
                </>
              )}
            </span>
          </div>
        ) : (
          <div style={actionsStyle}>
            {isEdited ? (
              <span style={stateLineStyle} data-testid={`state-${decision.id}`}>
                <span aria-hidden="true" style={stateMarkStyle} />
                Edited by owner · pending approval
              </span>
            ) : null}
            <span style={spacerStyle} />
            {canSaveGuidance ? (
              <button
                type="button"
                data-testid={`save-guidance-${decision.id}`}
                style={
                  busy ? { ...guidanceBtnStyle, ...btnBusy } : guidanceBtnStyle
                }
                disabled={busy}
                onClick={onSaveGuidance}
              >
                Save as owner guidance
              </button>
            ) : null}
            <button
              type="button"
              data-testid={`decline-${decision.id}`}
              style={busy ? { ...btnGhost, ...btnBusy } : btnGhost}
              disabled={busy}
              onClick={onDecline}
            >
              Decline
            </button>
            <button
              type="button"
              data-testid={`approve-${decision.id}`}
              style={busy ? { ...btnPrimary, ...btnBusy } : btnPrimary}
              disabled={busy}
              onClick={onPrimary}
            >
              {primaryActionLabel}
            </button>
          </div>
        )}

        {error ? (
          <div
            role="alert"
            data-testid={`error-${decision.id}`}
            style={errStyle}
          >
            {error}
          </div>
        ) : null}
      </div>
    </article>
  );
}
