/**
 * Tests for OperationsSection (Wave 4) — confirms the three v1.5
 * accountability panels mount on the property interior page.
 *
 * `../../actions` is mocked because PrivacyModeCard transitively pulls the
 * Ollama/worker provider chain in through the server-action module; the
 * panels only call those actions from event handlers, so inert stubs are
 * enough to render.
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('../../actions', () => ({
  updatePrivacyMode: vi.fn(),
  testOllamaConnection: vi.fn(),
}));

import type {
  AutonomyActionRow,
  ProposalFeedRow,
  PropertyProposalSummary,
} from '@/lib/properties/queries';

import { OperationsSection } from '../operations-section';

const PROPERTY_ID = '11111111-1111-1111-1111-111111111111';

function makeAutonomyRow(
  o: Partial<AutonomyActionRow> & { actionType: string },
): AutonomyActionRow {
  return {
    actionType: o.actionType,
    decision: o.decision ?? 'auto',
    committedCount: o.committedCount ?? 4,
    reviewCount: o.reviewCount ?? 1,
    blockedCount: o.blockedCount ?? 0,
  };
}

function makeProposalRow(
  o: Partial<ProposalFeedRow> & { id: string },
): ProposalFeedRow {
  return {
    id: o.id,
    createdAt: o.createdAt ?? '2026-06-01T00:00:00.000Z',
    actionType: o.actionType ?? 'draft_sms_reply',
    workerModel: o.workerModel ?? 'haiku-4.5',
    confidence: o.confidence ?? 0.82,
    gateDecision: o.gateDecision ?? 'auto',
    status: o.status ?? 'committed',
    reasoning: o.reasoning ?? 'Tenant asked about the rent due date.',
    editDiff: o.editDiff ?? null,
    committedAt: o.committedAt ?? '2026-06-01T00:01:00.000Z',
  };
}

const summary: PropertyProposalSummary = {
  autonomy: [
    makeAutonomyRow({ actionType: 'draft_sms_reply', decision: 'auto' }),
    makeAutonomyRow({ actionType: 'dispatch_vendor', decision: 'review' }),
  ],
  recent: [
    makeProposalRow({ id: 'prop-1' }),
    makeProposalRow({
      id: 'prop-2',
      actionType: 'dispatch_vendor',
      gateDecision: 'review',
      status: 'proposed',
    }),
  ],
};

function renderSection(): void {
  render(
    <OperationsSection
      propertyId={PROPERTY_ID}
      autonomyLevel={0.5}
      privacyMode="hosted"
      ollamaHost={null}
      summary={summary}
    />,
  );
}

describe('OperationsSection', () => {
  it('mounts the autonomy, privacy-mode, and proposals panels', () => {
    renderSection();

    expect(screen.getByTestId('property-autonomy-panel')).toBeInTheDocument();
    expect(
      screen.getByTestId('property-privacy-mode-card'),
    ).toBeInTheDocument();
    expect(screen.getByTestId('property-proposals-feed')).toBeInTheDocument();
  });

  it('links to the property rulebook drawer', () => {
    renderSection();

    expect(
      screen.getByRole('link', { name: /edit rulebook/i }),
    ).toHaveAttribute('href', `/properties/${PROPERTY_ID}?room=rulebook`);
  });
});
