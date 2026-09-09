/**
 * VoiceReadinessStrip — the "Integration status" ledger on `/calls`.
 *
 * Modeled on `src/components/financials/reliability-strip.tsx`: warm, compact,
 * honest — a quiet ledger, never a warning panel or bug tracker. It answers the
 * only question the flagship raises — "is this real yet?" — without alarm.
 *
 * Truthful by construction: Voice Operator runs on SIMULATED call flows locally.
 * Rows are green for what is genuinely configured and gold for what still
 * needs external verification. There
 * is no alarm-red state and no "broken" / "not production ready" copy — the page
 * is landlord-facing. Cloud-migration / DB-grant / HMAC-internal detail lives in
 * the sprint's final report, never here.
 *
 * Server component — dynamically checks actual configuration state to show
 * honest readiness status.
 */

import type { CSSProperties, ReactElement } from "react";
import type { VoiceSettings } from "@/lib/voice/settings";
import {
  assessReadiness,
  READINESS_STATE_LABELS,
  type CheckStatus,
  type ReadinessInput,
} from "@/lib/voice/readiness";

type ReadinessTone = "green" | "gold";

interface VoiceReadinessStripProps {
  voiceSettings?: VoiceSettings;
}

/**
 * Build the pure readiness input from env + org voice settings.
 *
 * `sandboxVerified` has NO local evidence channel — it is external evidence
 * that code cannot self-assert, so it stays false here. That keeps the strip
 * honest: a local dev/CI environment can never render past "config generated".
 */
export function buildVoiceReadinessInput(
  voiceSettings?: VoiceSettings,
): ReadinessInput {
  // SMS agents are dashboard-created for V1; their ids land in env.
  const smsAgentConfigured = !!(
    process.env.RETELL_SMS_AGENT_ID && process.env.RETELL_SMS_DISPATCH_AGENT_ID
  );
  return {
    retellApiKeyPresent: !!process.env.RETELL_API_KEY,
    requireSignature:
      process.env.RETELL_REQUIRE_SIGNATURE === "true" ||
      process.env.RETELL_REQUIRE_SIGNATURE === "1",
    publicUrlConfigured: !!process.env.NEXT_PUBLIC_APP_URL,
    agentIdConfigured: !!(
      voiceSettings?.retellAgentId || process.env.RETELL_AGENT_ID
    ),
    orgPhoneConfigured: !!(
      voiceSettings?.retellPhoneNumberE164 || process.env.RETELL_PHONE_NUMBER
    ),
    // A local/org toggle records intent only. No database field currently
    // carries Retell-dashboard webhook attestation, so this must stay false.
    inboundWebhookConfigured: false,
    // External evidence only — never self-asserted from a local run. The
    // liveCallsEnabled settings toggle is operator INTENT/config, not proof a
    // real inbound call ever connected, so it must NOT drive the "Production
    // phone live" rollup (readiness.ts §51 contract). Both stay false until
    // out-of-band sandbox/production verification supplies the evidence.
    sandboxVerified: false,
    productionLive: false,
    smsAgentConfigured,
    // An app URL plus agent ids prove configuration only. They do not attest
    // that the provider dashboard points at this deployment or that a carrier
    // delivered a webhook.
    smsWebhookConfigured: false,
    // ponytail: A2P approval is a deployment-level env flag (single-tenant
    // Galaxy reality); upgrade path = per-org column (e.g.
    // organizations.sms_a2p_approved_at) when multi-tenant. Never inferred —
    // 'SMS ready' requires this explicit attestation, not env presence alone.
    a2pApproved:
      process.env.RETELL_SMS_A2P_APPROVED === "true" ||
      process.env.RETELL_SMS_A2P_APPROVED === "1",
  };
}

/** green for genuinely-ready checks; gold for everything not-yet. No alarm-red. */
function toneFor(status: CheckStatus): ReadinessTone {
  return status === "ready" ? "green" : "gold";
}

const TONE: Record<ReadinessTone, { dot: string; value: string }> = {
  green: { dot: "var(--green)", value: "var(--green-ink)" },
  gold: { dot: "var(--gold)", value: "var(--amber-ink)" },
};

const panelStyle: CSSProperties = {
  background: "var(--panel-lift)",
  border: "1px solid var(--hairline)",
  borderRadius: 9,
  overflow: "hidden",
};

const summaryStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 16,
  flexWrap: "wrap",
  padding: "12px 16px",
  cursor: "pointer",
  listStyle: "none",
};

const detailsBodyStyle: CSSProperties = {
  borderTop: "1px solid var(--hairline)",
  padding: "14px 16px 16px",
  display: "flex",
  flexDirection: "column",
  gap: 11,
};

const headingStyle: CSSProperties = {
  fontFamily: "var(--font-mono-operator), ui-monospace, monospace",
  fontSize: "10px",
  fontWeight: 500,
  letterSpacing: "0.1em",
  textTransform: "uppercase",
  color: "var(--ink-3)",
};

const stateLineStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  fontFamily: "var(--font-sans-operator), system-ui, sans-serif",
  fontSize: "13.5px",
  fontWeight: 500,
  color: "var(--ink-1)",
};

const stateStepStyle: CSSProperties = {
  fontFamily: "var(--font-mono-operator), ui-monospace, monospace",
  fontSize: "10.5px",
  letterSpacing: "0.06em",
  color: "var(--ink-3)",
};

const rowsStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 6,
};

const rowStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  fontSize: "12.5px",
  color: "var(--ink-2)",
};

const rowLabelStyle: CSSProperties = {
  minWidth: 150,
  color: "var(--ink-2)",
};

const rowValueStyle: CSSProperties = {
  fontFamily: "var(--font-mono-operator), ui-monospace, monospace",
  fontSize: "11px",
  letterSpacing: "0.03em",
};

const boundaryStyle: CSSProperties = {
  fontSize: "12.5px",
  lineHeight: 1.5,
  color: "var(--ink-2)",
  margin: 0,
  paddingTop: 2,
  borderTop: "1px solid var(--hairline-faint)",
  marginTop: 1,
};

function dotStyle(color: string): CSSProperties {
  return {
    width: 7,
    height: 7,
    borderRadius: "50%",
    background: color,
    flexShrink: 0,
  };
}

export function VoiceReadinessStrip({
  voiceSettings,
}: VoiceReadinessStripProps = {}): ReactElement {
  const { state, label, checks } = assessReadiness(
    buildVoiceReadinessInput(voiceSettings),
  );

  return (
    <details style={panelStyle} data-testid="voice-readiness-strip">
      <summary style={summaryStyle}>
        <span style={headingStyle} data-testid="voice-readiness-heading">
          Integration status
        </span>
        <span style={stateLineStyle} data-testid="voice-readiness-state">
          <span
            style={dotStyle(state >= 3 ? TONE.green.dot : TONE.gold.dot)}
            aria-hidden="true"
          />
          <span>{label}</span>
          <span style={stateStepStyle}>
            step {state} of {Object.keys(READINESS_STATE_LABELS).length}
          </span>
        </span>
        <span style={stateStepStyle} aria-hidden="true">
          Inspect →
        </span>
      </summary>

      <div style={detailsBodyStyle}>
        <div style={rowsStyle}>
          {checks.map((check) => (
            <div
              key={check.key}
              style={rowStyle}
              data-testid={`voice-readiness-check-${check.key}`}
            >
              <span
                style={dotStyle(TONE[toneFor(check.status)].dot)}
                aria-hidden="true"
              />
              <span style={rowLabelStyle}>{check.label}</span>
              <span
                style={{
                  ...rowValueStyle,
                  color: TONE[toneFor(check.status)].value,
                }}
              >
                {check.detail}
              </span>
            </div>
          ))}
        </div>

        <p style={boundaryStyle}>
          Odesa can record, draft, and route; it does not move money, waive
          fees, threaten legal action, amend leases, or dispatch paid work
          without owner approval.
        </p>
      </div>
    </details>
  );
}
