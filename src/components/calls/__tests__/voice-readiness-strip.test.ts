import { afterEach, describe, expect, it, vi } from 'vitest';

import { defaultSettings } from '@/lib/voice/settings';
import { assessReadiness } from '@/lib/voice/readiness';
import { buildVoiceReadinessInput } from '../voice-readiness-strip';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('buildVoiceReadinessInput', () => {
  it('never infers webhook, sandbox, or production proof from configured toggles', () => {
    vi.stubEnv('RETELL_API_KEY', 'configured');
    vi.stubEnv('RETELL_AGENT_ID', 'agent-env');
    vi.stubEnv('RETELL_PHONE_NUMBER', '+15555550100');
    vi.stubEnv('RETELL_REQUIRE_SIGNATURE', 'true');
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://example.test');
    vi.stubEnv('RETELL_SMS_AGENT_ID', 'sms-agent');
    vi.stubEnv('RETELL_SMS_DISPATCH_AGENT_ID', 'sms-dispatch-agent');

    const settings = {
      ...defaultSettings('org-1'),
      retellAgentId: 'agent-org',
      retellPhoneNumberE164: '+15555550101',
      voiceEnabled: true,
      liveCallsEnabled: true,
    };
    const input = buildVoiceReadinessInput(settings);

    expect(input.agentIdConfigured).toBe(true);
    expect(input.orgPhoneConfigured).toBe(true);
    expect(input.inboundWebhookConfigured).toBe(false);
    expect(input.sandboxVerified).toBe(false);
    expect(input.productionLive).toBe(false);
    expect(input.smsAgentConfigured).toBe(true);
    expect(input.smsWebhookConfigured).toBe(false);
    expect(assessReadiness(input).state).toBe(2);
  });
});
