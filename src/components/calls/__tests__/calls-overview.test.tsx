import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { CallsOverview } from '@/components/calls/calls-overview';
import { defaultSettings } from '@/lib/voice/settings';
import type { VoiceCallActivity } from '@/lib/voice/queries';

const activity: VoiceCallActivity = {
  callsToday: 4,
  resolvedAutomatically: 2,
  needsReview: 1,
  awaitingApproval: 1,
  actionsTaken: 0,
  recordsCreated: 0,
};

describe('CallsOverview Ask Odesa handoff', () => {
  it('routes owners to the global assistant with grounded aggregate context', () => {
    render(
      <CallsOverview
        activity={activity}
        calls={[]}
        voiceSettings={defaultSettings('org-1')}
        readinessSlot={<div>Readiness unknown</div>}
        canUseAssistant
      />,
    );

    const link = screen.getByTestId('calls-ask-odesa');
    const href = link.getAttribute('href') ?? '';
    const query = decodeURIComponent(href.replace('/assistant?q=', ''));

    expect(query).toContain('this register has 0 recorded calls');
    expect(query).toContain("Today's source rows: 4 calls");
    expect(query).toContain('1 need human review');
    expect(query).toContain('2 have canonical outcomes recorded');
    expect(query).toContain('Do not infer transcript details or provider readiness');
    expect(query).not.toMatch(/[0-9a-f]{8}-[0-9a-f-]{27,}/i);
  });

  it('does not expose the owner-only assistant handoff without the capability', () => {
    render(
      <CallsOverview
        activity={activity}
        calls={[]}
        voiceSettings={defaultSettings('org-1')}
        readinessSlot={<div>Readiness unknown</div>}
      />,
    );

    expect(screen.queryByTestId('calls-ask-odesa')).not.toBeInTheDocument();
  });
});
