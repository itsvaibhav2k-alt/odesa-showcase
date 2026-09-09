/**
 * Voice readiness rollup tests — the honesty guarantees.
 *
 * The load-bearing invariant: the rollup can NEVER over-claim. Local test
 * passes alone (full config, no external verification) top out at state 2;
 * states 3 and 4 require external `sandboxVerified` / `productionLive` evidence.
 * Pure booleans in, pure state out — no env, no network.
 */

import { describe, expect, it } from 'vitest';

import {
  assessReadiness,
  evaluateChecks,
  isProductionLive,
  phoneLineCaption,
  rollupState,
  signatureEnforced,
  smsReadinessState,
  READINESS_STATE_LABELS,
  SMS_READINESS_LABELS,
  type ReadinessInput,
  type ReadinessState,
} from '../readiness';

/** Fully-configured, externally-verified, production-live input. */
function fullInput(): ReadinessInput {
  return {
    retellApiKeyPresent: true,
    requireSignature: true,
    publicUrlConfigured: true,
    agentIdConfigured: true,
    orgPhoneConfigured: true,
    inboundWebhookConfigured: true,
    sandboxVerified: true,
    productionLive: true,
    smsAgentConfigured: true,
    smsWebhookConfigured: true,
    a2pApproved: true,
  };
}

/** The local-dev baseline: nothing configured, nothing verified. */
function bareInput(): ReadinessInput {
  return {
    retellApiKeyPresent: false,
    requireSignature: false,
    publicUrlConfigured: false,
    agentIdConfigured: false,
    orgPhoneConfigured: false,
    inboundWebhookConfigured: false,
    sandboxVerified: false,
    productionLive: false,
    smsAgentConfigured: false,
    smsWebhookConfigured: false,
    a2pApproved: false,
  };
}

describe('rollupState', () => {
  describe('the four states', () => {
    it('should report state 1 (local simulation) with no config', () => {
      expect(rollupState(bareInput())).toBe(1);
    });

    it('should report state 1 even with only an API key (config incomplete)', () => {
      expect(rollupState({ ...bareInput(), retellApiKeyPresent: true })).toBe(1);
    });

    it('should report state 2 (config generated, not synced) with full config but no external verification', () => {
      const input: ReadinessInput = {
        ...bareInput(),
        retellApiKeyPresent: true,
        agentIdConfigured: true,
        publicUrlConfigured: true,
      };
      expect(rollupState(input)).toBe(2);
    });

    it('should report state 3 (sandbox verified) with config plus external sandbox evidence', () => {
      const input: ReadinessInput = {
        ...bareInput(),
        retellApiKeyPresent: true,
        agentIdConfigured: true,
        publicUrlConfigured: true,
        sandboxVerified: true,
      };
      expect(rollupState(input)).toBe(3);
    });

    it('should report state 4 (production live) with full config, verification, phone, signature, and live flag', () => {
      expect(rollupState(fullInput())).toBe(4);
    });
  });

  describe('never over-claims (downgrade conditions)', () => {
    it('should NOT reach state 3 or 4 from local passes alone (no external evidence)', () => {
      const localOnly: ReadinessInput = {
        retellApiKeyPresent: true,
        requireSignature: true,
        publicUrlConfigured: true,
        agentIdConfigured: true,
        orgPhoneConfigured: true,
        inboundWebhookConfigured: true,
        // externally-supplied evidence absent
        sandboxVerified: false,
        productionLive: false,
        smsAgentConfigured: false,
        smsWebhookConfigured: false,
        a2pApproved: false,
      };
      expect(rollupState(localOnly)).toBe(2);
    });

    it('should downgrade to state 3 (not 4) when production not live even if sandbox verified', () => {
      expect(rollupState({ ...fullInput(), productionLive: false })).toBe(3);
    });

    it('should downgrade to state 2 (not 3) when sandbox not verified', () => {
      expect(rollupState({ ...fullInput(), sandboxVerified: false, productionLive: false })).toBe(2);
    });

    it('should downgrade below state 4 when signature not enforced', () => {
      expect(rollupState({ ...fullInput(), requireSignature: false })).toBeLessThan(4);
    });

    it('should downgrade below state 4 when org phone missing', () => {
      expect(rollupState({ ...fullInput(), orgPhoneConfigured: false })).toBeLessThan(4);
    });

    it('should downgrade to state 1 when API key missing, regardless of other evidence', () => {
      expect(rollupState({ ...fullInput(), retellApiKeyPresent: false })).toBe(1);
    });

    it('should downgrade to state 1 when public URL missing (config incomplete)', () => {
      expect(rollupState({ ...fullInput(), publicUrlConfigured: false })).toBe(1);
    });

    it('should downgrade to state 1 when agent id missing (config incomplete)', () => {
      expect(rollupState({ ...fullInput(), agentIdConfigured: false })).toBe(1);
    });
  });
});

describe('evaluateChecks', () => {
  it('should mark every check ready when fully configured (except Grok)', () => {
    const checks = evaluateChecks(fullInput());
    const grok = checks.find((c) => c.key === 'grok');
    expect(grok?.status).toBe('research_deferred');
    for (const check of checks.filter((c) => c.key !== 'grok')) {
      expect(check.status).toBe('ready');
    }
  });

  it('should report missing_secret for absent API key', () => {
    const checks = evaluateChecks(bareInput());
    expect(checks.find((c) => c.key === 'apiKey')?.status).toBe('missing_secret');
  });

  it('should report needs_dashboard_config when signature not enforced', () => {
    const checks = evaluateChecks(bareInput());
    expect(checks.find((c) => c.key === 'signature')?.status).toBe('needs_dashboard_config');
  });

  it('should report manual_sync_required for an unwired inbound webhook', () => {
    const checks = evaluateChecks(bareInput());
    expect(checks.find((c) => c.key === 'inbound')?.status).toBe('manual_sync_required');
  });

  it('should always defer Grok regardless of config', () => {
    expect(evaluateChecks(bareInput()).find((c) => c.key === 'grok')?.status).toBe(
      'research_deferred',
    );
    expect(evaluateChecks(fullInput()).find((c) => c.key === 'grok')?.status).toBe(
      'research_deferred',
    );
  });
});

describe('smsReadinessState', () => {
  it('should report not_configured when SMS agents are absent', () => {
    expect(smsReadinessState(bareInput())).toBe('not_configured');
    expect(SMS_READINESS_LABELS.not_configured).toBe('SMS not configured');
  });

  it('should report not_configured when the agent is set but the webhook is not (and vice versa)', () => {
    expect(smsReadinessState({ ...bareInput(), smsAgentConfigured: true })).toBe('not_configured');
    expect(smsReadinessState({ ...bareInput(), smsWebhookConfigured: true })).toBe('not_configured');
  });

  it('should report webhook_configured (A2P unknown) when wired but A2P not attested', () => {
    const state = smsReadinessState({
      ...bareInput(),
      smsAgentConfigured: true,
      smsWebhookConfigured: true,
    });
    expect(state).toBe('webhook_configured');
    expect(SMS_READINESS_LABELS.webhook_configured).toBe(
      'SMS webhook configured, A2P status unknown',
    );
  });

  it('should NEVER report ready from the A2P flag alone (no webhook/agent evidence)', () => {
    expect(smsReadinessState({ ...bareInput(), a2pApproved: true })).toBe('not_configured');
  });

  it('should report ready only when agents + webhook + explicit A2P approval all hold', () => {
    expect(smsReadinessState(fullInput())).toBe('ready');
    expect(SMS_READINESS_LABELS.ready).toBe(
      'SMS ready: Retell/Twilio standard US number with A2P approved',
    );
  });

  it('should surface the tri-state as the sms check detail without touching the voice rollup', () => {
    const noSms: ReadinessInput = {
      ...fullInput(),
      smsAgentConfigured: false,
      smsWebhookConfigured: false,
      a2pApproved: false,
    };
    expect(rollupState(noSms)).toBe(rollupState(fullInput()));
    const check = evaluateChecks(noSms).find((c) => c.key === 'sms');
    expect(check?.status).toBe('needs_dashboard_config');
    expect(check?.detail).toBe(SMS_READINESS_LABELS.not_configured);
    expect(evaluateChecks(fullInput()).find((c) => c.key === 'sms')?.status).toBe('ready');
  });
});

// ---------------------------------------------------------------------------
// Copy derivations — ONE source for the phone-card + /calls surface claims.
// ---------------------------------------------------------------------------

describe('isProductionLive', () => {
  it('should be true ONLY at state 4 (external production-live evidence)', () => {
    expect(isProductionLive(4)).toBe(true);
    for (const state of [1, 2, 3] as ReadinessState[]) {
      expect(isProductionLive(state)).toBe(false);
    }
  });
});

describe('signatureEnforced', () => {
  const on = {
    retellApiKeyPresent: true,
    requireSignature: true,
    hmacVerificationEnabled: true,
  };

  it('should be enforced only when key + require-signature env + org toggle ALL hold', () => {
    expect(signatureEnforced(on)).toBe(true);
  });

  it('should NOT be enforced when the RETELL_API_KEY is absent', () => {
    expect(signatureEnforced({ ...on, retellApiKeyPresent: false })).toBe(false);
  });

  it('should NOT be enforced when the webhook is not set to require signatures', () => {
    expect(signatureEnforced({ ...on, requireSignature: false })).toBe(false);
  });

  it('should NOT be enforced when the org HMAC toggle is off', () => {
    expect(signatureEnforced({ ...on, hmacVerificationEnabled: false })).toBe(false);
  });

  // Regression (the dead-var bug): the OLD /calls dot ANDed
  // `process.env.RETELL_WEBHOOK_SECRET`, which is a fiction and always undefined,
  // so the dot could NEVER go green. This predicate takes plain booleans and has
  // no channel for that dead var — with RETELL_API_KEY present + enforcement
  // configured + the toggle on, it is honestly enforced.
  it('should go green from the real contract alone, never hinging on a dead webhook secret', () => {
    expect(signatureEnforced(on)).toBe(true);
    // Every input is a boolean the caller derives from RETELL_API_KEY /
    // RETELL_REQUIRE_SIGNATURE / voice_settings — there is no webhook-secret arg.
    expect(Object.keys(on).sort()).toEqual([
      'hmacVerificationEnabled',
      'requireSignature',
      'retellApiKeyPresent',
    ]);
  });
});

describe('phoneLineCaption', () => {
  it('should claim 24/7 answering ONLY when production-live (state 4)', () => {
    const caption = phoneLineCaption(4);
    expect(caption).toContain('Odesa answers 24/7');
    expect(caption).toContain('Tenants call or text this number');
  });

  it('should never claim 24/7 answering below production-live', () => {
    for (const state of [1, 2, 3] as ReadinessState[]) {
      const caption = phoneLineCaption(state);
      expect(caption).not.toContain('24/7');
      expect(caption).toContain('not answering live calls yet');
      // Copy is derived from the SAME state label — no ad-hoc phrasing.
      expect(caption).toContain(READINESS_STATE_LABELS[state]);
    }
  });
});

describe('assessReadiness', () => {
  it('should attach the correct label for the rolled-up state', () => {
    expect(assessReadiness(fullInput()).label).toBe(READINESS_STATE_LABELS[4]);
    expect(assessReadiness(bareInput()).label).toBe(READINESS_STATE_LABELS[1]);
  });

  it('should never label a local-only assessment as production live', () => {
    const localOnly: ReadinessInput = { ...fullInput(), sandboxVerified: false, productionLive: false };
    const assessment = assessReadiness(localOnly);
    expect(assessment.label).not.toBe(READINESS_STATE_LABELS[4]);
    expect(assessment.label.toLowerCase()).not.toContain('live');
  });
});
