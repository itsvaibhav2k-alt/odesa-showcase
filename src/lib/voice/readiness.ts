/**
 * Voice Operator readiness — a PURE, honest assessment of how far the Retell
 * integration has actually been taken.
 *
 * The cardinal rule: the rollup can NEVER claim a later state without the
 * external evidence for it. Local test passes ALONE can never yield "sandbox
 * verified" or "production live" — sandbox verification is out-of-band evidence
 * supplied via env/DB flag, not something code can prove about itself.
 *
 * No network, no Supabase, no process.env reads here — callers pass plain
 * booleans so this stays trivially testable and side-effect free.
 */

/** Per-check status. `research_deferred` is reserved for Grok (unverified). */
export type CheckStatus =
  | 'ready'
  | 'missing_secret'
  | 'needs_dashboard_config'
  | 'manual_sync_required'
  | 'research_deferred';

export interface ReadinessCheck {
  key: string;
  label: string;
  status: CheckStatus;
  detail: string;
}

/**
 * Evidence for the assessment. Everything is a plain boolean the caller
 * derives from env vars, voice_settings, or external verification flags.
 */
export interface ReadinessInput {
  /** RETELL_API_KEY present (the key that also carries the webhook badge). */
  retellApiKeyPresent: boolean;
  /** RETELL_REQUIRE_SIGNATURE enabled — HMAC enforced on webhook events. */
  requireSignature: boolean;
  /** Public app base URL configured (NEXT_PUBLIC_APP_URL) — Retell needs it to reach us. */
  publicUrlConfigured: boolean;
  /** RETELL_AGENT_ID / voice_settings agent id configured. */
  agentIdConfigured: boolean;
  /** Org inbound phone number configured (E.164). */
  orgPhoneConfigured: boolean;
  /** Inbound-call webhook wired in the Retell dashboard. */
  inboundWebhookConfigured: boolean;
  /**
   * EXTERNAL evidence: a call was actually placed/received against the Retell
   * sandbox and verified. Code can never set this from a local test pass.
   */
  sandboxVerified: boolean;
  /** EXTERNAL evidence: production phone is live-enabled for real inbound calls. */
  productionLive: boolean;
  /** Retell SMS chat + dispatch agents configured (RETELL_SMS_*_AGENT_ID). */
  smsAgentConfigured: boolean;
  /** SMS inbound webhook target (/api/messaging/inbound/retell) wired for the agents. */
  smsWebhookConfigured: boolean;
  /** EXTERNAL evidence: A2P campaign approved for the number (never inferred). */
  a2pApproved: boolean;
}

/** The four — and only four — ordered user-facing states. */
export type ReadinessState = 1 | 2 | 3 | 4;

export const READINESS_STATE_LABELS: Record<ReadinessState, string> = {
  1: 'Local simulation ready',
  2: 'Retell config generated, not synced',
  3: 'Retell sandbox verified',
  4: 'Production phone live',
};

export interface ReadinessAssessment {
  state: ReadinessState;
  label: string;
  checks: ReadinessCheck[];
}

/** Tri-state SMS readiness — separate from the voice rollup, never feeds it. */
export type SmsReadinessState = 'not_configured' | 'webhook_configured' | 'ready';

export const SMS_READINESS_LABELS: Record<SmsReadinessState, string> = {
  not_configured: 'SMS not configured',
  webhook_configured: 'SMS webhook configured, A2P status unknown',
  ready: 'SMS ready: Retell/Twilio standard US number with A2P approved',
};

/**
 * Honest SMS tri-state: 'ready' requires ALL THREE — agents bound, webhook
 * wired, AND explicit external A2P approval evidence. Env presence of agent
 * ids alone can never yield 'ready'.
 */
export function smsReadinessState(
  input: Pick<ReadinessInput, 'smsAgentConfigured' | 'smsWebhookConfigured' | 'a2pApproved'>,
): SmsReadinessState {
  if (!input.smsAgentConfigured || !input.smsWebhookConfigured) return 'not_configured';
  return input.a2pApproved ? 'ready' : 'webhook_configured';
}

/** True when the minimum config to hand Retell a working target exists. */
function hasGeneratedConfig(input: ReadinessInput): boolean {
  return input.retellApiKeyPresent && input.agentIdConfigured && input.publicUrlConfigured;
}

/** Per-check statuses, in display order. Grok is always research-deferred. */
export function evaluateChecks(input: ReadinessInput): ReadinessCheck[] {
  const smsState = smsReadinessState(input);
  return [
    {
      key: 'apiKey',
      label: 'Retell API key',
      status: input.retellApiKeyPresent ? 'ready' : 'missing_secret',
      detail: input.retellApiKeyPresent ? 'Configured' : 'Not set',
    },
    {
      key: 'signature',
      label: 'Signature enforcement',
      status: input.requireSignature ? 'ready' : 'needs_dashboard_config',
      detail: input.requireSignature ? 'HMAC enforced' : 'Not enforced (local dev)',
    },
    {
      key: 'publicUrl',
      label: 'Public app URL',
      status: input.publicUrlConfigured ? 'ready' : 'needs_dashboard_config',
      detail: input.publicUrlConfigured ? 'Configured' : 'Not set',
    },
    {
      key: 'agentId',
      label: 'Retell agent',
      status: input.agentIdConfigured ? 'ready' : 'needs_dashboard_config',
      detail: input.agentIdConfigured ? 'Configured' : 'Not set',
    },
    {
      key: 'phone',
      label: 'Org phone number',
      status: input.orgPhoneConfigured ? 'ready' : 'needs_dashboard_config',
      detail: input.orgPhoneConfigured ? 'Configured' : 'Not set',
    },
    {
      key: 'inbound',
      label: 'Inbound webhook',
      status: input.inboundWebhookConfigured ? 'ready' : 'manual_sync_required',
      detail: input.inboundWebhookConfigured ? 'Wired' : 'Sync in Retell dashboard',
    },
    {
      key: 'sms',
      label: 'SMS (Retell chat)',
      status:
        smsState === 'ready'
          ? 'ready'
          : smsState === 'webhook_configured'
            ? 'manual_sync_required'
            : 'needs_dashboard_config',
      detail: SMS_READINESS_LABELS[smsState],
    },
    {
      key: 'grok',
      label: 'Grok model',
      status: 'research_deferred',
      detail: 'Research deferred',
    },
  ];
}

/**
 * Roll the evidence up into exactly one of the four ordered states.
 *
 * Monotonic: each higher state strictly requires the evidence of the one
 * below plus its own. States 3 and 4 require EXTERNAL evidence
 * (`sandboxVerified` / `productionLive`) — never reachable from local passes.
 */
export function rollupState(input: ReadinessInput): ReadinessState {
  if (
    input.productionLive &&
    input.sandboxVerified &&
    input.orgPhoneConfigured &&
    input.requireSignature &&
    hasGeneratedConfig(input)
  ) {
    return 4;
  }

  if (input.sandboxVerified && hasGeneratedConfig(input)) {
    return 3;
  }

  if (hasGeneratedConfig(input)) {
    return 2;
  }

  return 1;
}

// ---------------------------------------------------------------------------
// Copy derivations — ONE source for the phone-card + /calls surface claims.
// Pure like the rest of this file: state/booleans in, honest strings out.
// ---------------------------------------------------------------------------

/**
 * The line is only "answering real inbound calls" at state 4 — the sole state
 * that requires external production-live evidence. Everything below is
 * setup/simulation, so no surface may claim live answering from it.
 */
export function isProductionLive(state: ReadinessState): boolean {
  return state === 4;
}

/**
 * Honest "signature enforcement" flag for the /calls working-checklist dot.
 *
 * Mirrors the webhook (src/lib/agent/retell-auth.ts `verifyRetellWebhookAuth`):
 * a signed request is HMAC-verified with RETELL_API_KEY, and the webhook
 * HARD-REJECTS unsigned requests only when RETELL_REQUIRE_SIGNATURE is on. The
 * old RETELL_WEBHOOK_SECRET is dead ('a fiction and is gone' per the webhook
 * route) — enforcement can NEVER hinge on it, which is exactly the bug this
 * replaces. `hmacVerificationEnabled` is the operator's stored intent in
 * voice_settings. All three must hold for the dot to be honestly green; any
 * missing piece reads as not-enforced (under-claims, never over-claims).
 */
export function signatureEnforced(input: {
  retellApiKeyPresent: boolean;
  requireSignature: boolean;
  hmacVerificationEnabled: boolean;
}): boolean {
  return (
    input.retellApiKeyPresent && input.requireSignature && input.hmacVerificationEnabled
  );
}

/**
 * Settings phone-card caption, derived from the SAME readiness state as /calls.
 * Only a production-live line may claim 24/7 answering; every earlier state says
 * — honestly — that the number is still in setup and not answering live calls.
 *
 * There is no separate 'degraded'/'unknown' state: the monotonic model can never
 * enter an inconsistent state, so missing evidence simply lands on a lower state,
 * all of which collapse here into the honest "not answering live calls yet" copy.
 */
export function phoneLineCaption(state: ReadinessState): string {
  if (isProductionLive(state)) {
    return 'Tenants call or text this number. Odesa answers 24/7.';
  }
  return `This number is in setup — ${READINESS_STATE_LABELS[state]}. Odesa is not answering live calls yet.`;
}

/** Full assessment: rollup state + label + per-check rows. */
export function assessReadiness(input: ReadinessInput): ReadinessAssessment {
  const state = rollupState(input);
  return {
    state,
    label: READINESS_STATE_LABELS[state],
    checks: evaluateChecks(input),
  };
}
