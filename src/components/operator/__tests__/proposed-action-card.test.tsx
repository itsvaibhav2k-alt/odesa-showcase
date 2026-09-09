import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { ActionProposal } from '@/lib/agent/worker/types';

import { ProposedActionCard } from '../proposed-action-card';

const proposal: ActionProposal = {
  id: 'proposal-1',
  organizationId: 'org-1',
  propertyId: 'property-1',
  workerModel: 'test',
  action_type: 'draft_sms_reply',
  payload: { body: 'Hello from the grounded draft', tone: 'warm' },
  routing: null,
  reasoning: 'Tenant asked for an update.',
  confidence: 0.9,
  context_fact_ids: [],
  gate_decision: 'review',
  status: 'proposed',
  createdAt: '2026-08-03T12:00:00Z',
};

describe('ProposedActionCard commitment boundary', () => {
  it('hands review-required proposals to Owner Queue without inline controls', () => {
    render(
      <ProposedActionCard
        proposal={proposal}
        status="review_required"
      />,
    );

    expect(screen.getByTestId('proposed-action-card-status')).toHaveTextContent(
      'Owner approval required',
    );
    expect(
      screen.getByTestId('proposed-action-card-owner-boundary'),
    ).toHaveTextContent('Approvals, edits, and rejections happen in Owner Queue');
    expect(
      screen.queryByTestId('proposed-action-card-approve'),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId('proposed-action-card-reject'),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId('proposed-action-card-review-link')).toHaveAttribute(
      'href',
      '/owner-queue',
    );
  });

  it.each([
    ['dispatching', 'Working…'],
    ['committed', 'Completed ✓'],
  ] as const)('uses action-neutral copy for %s proposals', (status, label) => {
    render(
      <ProposedActionCard
        proposal={{ ...proposal, action_type: 'log_maintenance_ticket' }}
        status={status}
      />,
    );

    expect(screen.getByTestId('proposed-action-card-status')).toHaveTextContent(
      label,
    );
    expect(screen.queryByText(/sent|sending/i)).not.toBeInTheDocument();
  });
});
