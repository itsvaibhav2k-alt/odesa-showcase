/**
 * Component tests for the owner-queue DecisionSummaryBanner.
 *
 * Locks the zero-routine repair (trust sprint Stage 6): at routineCount 0 the
 * banner renders an honest status bar — "No routine approvals right now." plus
 * a singular/plural-safe owner-review sub-line — and the approve-all button
 * NEVER renders ("Approve all 0" must be impossible). The non-zero and
 * batch-success branches are asserted too so the repair can't regress them.
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

import { DecisionSummaryBanner } from '@/components/owner-queue/decision-summary-banner';

function renderBanner(
  overrides: Partial<
    Parameters<typeof DecisionSummaryBanner>[0]
  > = {},
) {
  return render(
    <DecisionSummaryBanner
      routineCount={0}
      reviewCount={0}
      totalAmount="$0"
      batchApproved={false}
      onApproveAll={vi.fn()}
      {...overrides}
    />,
  );
}

describe('DecisionSummaryBanner', () => {
  describe('zero-routine branch', () => {
    it('should render the honest zero-routine copy when routineCount is 0', () => {
      renderBanner({ routineCount: 0, reviewCount: 3 });

      expect(
        screen.getByTestId('decision-summary-banner'),
      ).toBeInTheDocument();
      expect(
        screen.getByText('No routine approvals right now.'),
      ).toBeInTheDocument();
      expect(
        screen.getByText('3 judgment items need your decisions below.'),
      ).toBeInTheDocument();
    });

    it('should use the singular form when exactly one review item exists', () => {
      renderBanner({ routineCount: 0, reviewCount: 1 });

      expect(
        screen.getByText('1 judgment item needs your decision below.'),
      ).toBeInTheDocument();
    });

    it('should NEVER render the approve-all button at routineCount 0', () => {
      renderBanner({ routineCount: 0, reviewCount: 2 });

      expect(screen.queryByTestId('approve-all-button')).toBeNull();
      expect(screen.queryByText(/approve all/i)).toBeNull();
    });
  });

  describe('routine branch', () => {
    it('should render the batch review action with the routine count when routineCount > 0', () => {
      renderBanner({ routineCount: 2, reviewCount: 1, totalAmount: '$3,200' });

      const button = screen.getByTestId('approve-all-button');
      expect(button).toHaveTextContent('Review batch 2');
      expect(screen.getByTestId('decision-summary-banner')).toHaveTextContent(
        'Routine approvals ready: 2 routine decisions',
      );
      expect(screen.getByTestId('decision-summary-banner')).toHaveTextContent(
        '1 judgment item stays separate',
      );
    });

    it('should pluralize correctly for a single routine decision', () => {
      renderBanner({ routineCount: 1, reviewCount: 0 });

      expect(screen.getByTestId('decision-summary-banner')).toHaveTextContent(
        '1 routine decision',
      );
    });
  });

  describe('batch-approved branch', () => {
    it('should render the success status bar instead of the zero-routine bar', () => {
      renderBanner({
        routineCount: 0,
        reviewCount: 2,
        batchApproved: true,
        committedCount: 2,
      });

      expect(screen.getByTestId('batch-success')).toBeInTheDocument();
      expect(screen.queryByTestId('decision-summary-banner')).toBeNull();
      expect(screen.queryByTestId('approve-all-button')).toBeNull();
    });

    it('should NOT render a no-op undo affordance in the success bar', () => {
      renderBanner({
        routineCount: 0,
        batchApproved: true,
        committedCount: 2,
      });

      expect(screen.queryByTestId('batch-undo-button')).toBeNull();
      expect(screen.queryByText(/undo/i)).toBeNull();
    });
  });
});
