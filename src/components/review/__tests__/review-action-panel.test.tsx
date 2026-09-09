import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/app/(dashboard)/review/actions', () => ({
  decideRentReviewAction: vi.fn(),
  sendRentReminderAction: vi.fn(),
  decideConversationReviewAction: vi.fn(),
  sendConversationReplyAction: vi.fn(),
  decideWorkOrderReviewAction: vi.fn(),
}));

import { ReviewActionPanel } from '../review-action-panel';

const actions = [
  {
    id: 'rent.send_reminder',
    label: 'Send reminder',
    kind: 'send' as const,
    variant: 'primary' as const,
  },
  {
    id: 'rent.arrange_plan',
    label: 'Arrange payment plan',
    kind: 'transition' as const,
    variant: 'secondary' as const,
  },
];

describe('ReviewActionPanel role controls', () => {
  it('keeps the owner draft and actions interactive by default', () => {
    render(
      <ReviewActionPanel
        id="rent-1"
        draft={{ body: 'Owner draft', editable: true }}
        actions={actions}
        recommendation="Follow up"
        backHref="/today"
      />,
    );

    expect(screen.getByTestId('review-draft')).not.toHaveAttribute('readonly');
    expect(
      screen.getByRole('button', { name: 'Send reminder' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Arrange payment plan' }),
    ).toBeInTheDocument();
  });

  it('keeps evidence visible for VA while removing owner actions', () => {
    render(
      <ReviewActionPanel
        id="rent-1"
        draft={{ body: 'Grounded draft', editable: true }}
        actions={actions}
        recommendation="Follow up"
        backHref="/today"
        readOnly
      />,
    );

    expect(screen.getByTestId('review-draft')).toHaveAttribute('readonly');
    expect(screen.getByTestId('review-owner-boundary')).toHaveTextContent(
      'Owner approval is required',
    );
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.getByText(/view for owner review/i)).toBeInTheDocument();
  });
});
