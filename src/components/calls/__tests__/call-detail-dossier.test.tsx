import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { CallDetailDossier } from '@/components/calls/call-detail-dossier';
import type { VoiceCallDetail } from '@/lib/voice/queries';

const DETAIL: VoiceCallDetail = {
  id: 'call-12345678',
  retellCallId: 'retell-call-1',
  callerKind: 'verified_tenant',
  callerLabel: 'Maya Chen',
  fromNumber: '+15555550123',
  status: 'completed',
  startedAt: '2026-08-03T14:00:00.000Z',
  endedAt: '2026-08-03T14:05:00.000Z',
  summary: 'Tenant requested a follow-up that needs owner approval.',
  transcriptPreview: 'Caller requested a follow-up.',
  transcript: 'Caller: Please follow up.\nOdesa: I will prepare that for review.',
  intents: ['maintenance_request'],
  approvalsNeeded: 1,
  riskFlags: 0,
  conversationId: 'conversation-1',
  propertyId: 'property-1',
  review: {
    needsReview: true,
    resolvedAutomatically: false,
    approvalCount: 1,
    riskFlagCount: 0,
    unresolvedCount: 0,
            reviewReasons: ['1 review item for Owner Queue'],
    statusTone: 'clay',
    statusLabel: 'Needs review',
  },
  actionsTaken: 0,
  actionIds: [],
  recordsCreated: [{ kind: 'proposal', id: 'proposal-1' }],
  smsSentCount: 0,
  smsDraftedCount: 1,
  drilldownIds: { proposal: ['proposal-1'] },
  outcome: {
    approvalsNeeded: ['Draft follow-up for the owner to review'],
    riskFlags: [],
    unresolved: [],
    recordsCreated: [{ kind: 'proposal', id: 'proposal-1' }],
    propertyId: 'property-1',
  },
};

describe('CallDetailDossier audience boundaries', () => {
  it('routes a VA proposal to shift escalation context', () => {
    render(<CallDetailDossier detail={DETAIL} audience="va" />);

    expect(screen.getByTestId('call-next-move-link')).toHaveAttribute(
      'href',
      '/escalations?proposal=proposal-1',
    );
    expect(screen.getByTestId('call-next-move-link')).toHaveTextContent(
      'Prepare owner handoff',
    );
    const handoff = screen.getByTestId('call-left');
    expect(within(handoff).getByText('Owner handoff')).toBeInTheDocument();
    expect(handoff).toHaveTextContent('awaiting owner approval');
    expect(
      screen.getByRole('link', { name: /Owner handoff/ }),
    ).toHaveAttribute('href', '/escalations?proposal=proposal-1');
  });

  it('preserves the exact conversation when a VA follows call context', () => {
    render(
      <CallDetailDossier
        audience="va"
        detail={{
          ...DETAIL,
          approvalsNeeded: 0,
          recordsCreated: [{ kind: 'conversation', id: 'conversation-1' }],
          drilldownIds: { conversation: ['conversation-1'] },
          review: {
            ...DETAIL.review,
            approvalCount: 0,
            riskFlagCount: 1,
            reviewReasons: ['1 risk flag'],
          },
          outcome: {
            approvalsNeeded: [],
            recordsCreated: [
              { kind: 'conversation', id: 'conversation-1' },
            ],
            riskFlags: ['Owner context needed'],
            unresolved: [],
            propertyId: 'property-1',
          },
        }}
      />,
    );

    expect(screen.getByTestId('call-next-move-link')).toHaveAttribute(
      'href',
      '/inbox?conversation=conversation-1',
    );
    expect(
      screen.getByRole('link', { name: /^Open →$/ }),
    ).toHaveAttribute('href', '/inbox?conversation=conversation-1');
  });

  it('preserves the Owner Queue destination for owners', () => {
    render(<CallDetailDossier detail={DETAIL} audience="owner" />);

    expect(screen.getByTestId('call-next-move-link')).toHaveAttribute(
      'href',
      '/owner-queue',
    );
    expect(screen.getByTestId('call-next-move-link')).toHaveTextContent(
      'Review in Owner Queue',
    );
    expect(screen.getByTestId('call-left')).toHaveTextContent('Left for you');
  });

  it('keeps raw identifiers and internal reason enums out of visible copy', () => {
    const rawId = '123e4567-e89b-12d3-a456-426614174000';
    const { container } = render(
      <CallDetailDossier
        detail={{
          ...DETAIL,
          id: rawId,
          recordsCreated: [{ kind: 'work_order', id: rawId }],
          drilldownIds: { work_order: [rawId] },
          review: {
            ...DETAIL.review,
            approvalCount: 2,
            riskFlagCount: 1,
            unresolvedCount: 1,
            reviewReasons: [
              '2 review items for Owner Queue',
              '1 risk flag: Payment claim does not match the rent ledger',
            ],
          },
          outcome: {
            approvalsNeeded: [rawId, 'owner_decision_on_fee_request'],
            riskFlags: ['payment_claim_ledger_conflict'],
            unresolved: ['unknown_caller_needs_review'],
            recordsCreated: [{ kind: 'work_order', id: rawId }],
            propertyId: 'property-1',
          },
        }}
      />,
    );

    expect(container).toHaveTextContent(
      '2 review items awaiting owner review',
    );
    expect(container).toHaveTextContent(
      'Payment claim does not match the rent ledger',
    );
    expect(container).toHaveTextContent(
      'Caller identity could not be verified',
    );
    expect(container).toHaveTextContent('Work order record created');
    expect(container).not.toHaveTextContent('owner_decision_on_fee_request');
    expect(container).not.toHaveTextContent(rawId);
    expect(container).not.toHaveTextContent(rawId.slice(0, 8));
    expect(screen.getByRole('link', { name: /^Open →$/ })).toHaveAttribute(
      'href',
      `/work-orders/${rawId}`,
    );
  });

  it('does not infer understanding, authority, or completion from a missing outcome', () => {
    const { container } = render(
      <CallDetailDossier
        detail={{
          ...DETAIL,
          summary: null,
          transcript: null,
          transcriptPreview: null,
          intents: [],
          recordsCreated: [],
          smsDraftedCount: 0,
          review: {
            needsReview: false,
            resolvedAutomatically: false,
            approvalCount: 0,
            riskFlagCount: 0,
            unresolvedCount: 0,
            reviewReasons: [],
            statusTone: 'neutral',
            statusLabel: 'Outcome unavailable',
          },
          outcome: null,
        }}
      />,
    );

    expect(container).toHaveTextContent('No structured outcome was recorded');
    expect(container).toHaveTextContent('No completed action is recorded');
    expect(container).toHaveTextContent('No completed review outcome is recorded');
    expect(container).toHaveTextContent('Outcome status: outcome unavailable');
    expect(container).not.toHaveTextContent('No owner action needed');
    expect(container).not.toHaveTextContent('stayed within Odesa');
  });
});
