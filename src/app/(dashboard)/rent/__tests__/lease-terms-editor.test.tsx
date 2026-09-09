/**
 * Unit tests for the two-stage `LeaseTermsEditor` confirm flow.
 *
 * Covers:
 *   - Stage 1 validation gates the review stage (no action call ever).
 *   - Enter / form submit advances to review only — never saves.
 *   - Review diff is computed against the ORIGINAL loaded terms, shows
 *     only changed rows, plus tenant/unit identity and the
 *     "what does not happen" block.
 *   - Current-cycle money line renders only when the checkbox is on.
 *   - `updateLeaseTermsAction` is called exactly once, from the confirm
 *     button, with the drafted payload.
 *   - End-lease review requires the exact END LEASE typed confirm before
 *     the destructive button enables, and submit can't bypass it.
 *
 * Server action mocked via `vi.mock('../actions')` (pattern of
 * verify-phone-form.test.tsx — fireEvent, no user-event package).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';

// ---------------------------------------------------------------------------
// Mocks (declare before component import)
// ---------------------------------------------------------------------------

const mockRefresh = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: mockRefresh }),
}));

const mockUpdateLeaseTerms = vi.fn();

vi.mock('../actions', () => ({
  updateLeaseTermsAction: (payload: unknown) => mockUpdateLeaseTerms(payload),
}));

import { LeaseTermsEditor } from '../lease-terms-editor';

// ---------------------------------------------------------------------------
// Fixtures + lifecycle
// ---------------------------------------------------------------------------

const TERMS = {
  leaseId: 'lease-1',
  rentAmount: 1500,
  rentDueDay: 1,
  endDate: '2027-04-30',
};

function renderEditor(): void {
  render(
    <LeaseTermsEditor
      terms={TERMS}
      tenantName="Jane Tenant"
      unitLabel="22 Oak St · 1A"
      onClose={vi.fn()}
    />,
  );
}

beforeEach(() => {
  mockRefresh.mockReset();
  mockUpdateLeaseTerms.mockReset();
  mockUpdateLeaseTerms.mockResolvedValue({
    success: true,
    data: {
      leaseId: TERMS.leaseId,
      currentCycleRequested: false,
      currentCycleUpdated: 0,
      currentCycleDueDate: null,
      currentCycleError: null,
    },
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function flushMicrotasks(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function goToReview(): void {
  fireEvent.click(screen.getByTestId('lease-terms-review'));
}

// ---------------------------------------------------------------------------
// Stage 1 — edit + validation
// ---------------------------------------------------------------------------

describe('LeaseTermsEditor', () => {
  describe('edit stage', () => {
    it('should render fields and the review button without a save button', () => {
      renderEditor();

      expect(screen.getByTestId('lease-rent-amount')).toBeInTheDocument();
      expect(screen.getByTestId('lease-terms-review')).toBeInTheDocument();
      expect(screen.queryByTestId('lease-terms-save')).not.toBeInTheDocument();
      expect(mockUpdateLeaseTerms).not.toHaveBeenCalled();
    });

    it('should stay in edit and show an error when rent amount is invalid', () => {
      renderEditor();

      fireEvent.change(screen.getByTestId('lease-rent-amount'), {
        target: { value: '-10' },
      });
      // Submit the form directly: native min/max constraint validation
      // would block a button click before app validation runs (the e2e
      // validation spec strips the attributes for the same reason).
      fireEvent.submit(screen.getByTestId('lease-terms-editor'));

      expect(screen.getByTestId('lease-terms-notice')).toHaveTextContent(
        /positive number/i,
      );
      expect(screen.queryByTestId('lease-terms-save')).not.toBeInTheDocument();
      expect(mockUpdateLeaseTerms).not.toHaveBeenCalled();
    });

    it('should stay in edit and show an error when due day is out of range', () => {
      renderEditor();

      fireEvent.change(screen.getByTestId('lease-due-day'), {
        target: { value: '40' },
      });
      fireEvent.submit(screen.getByTestId('lease-terms-editor'));

      expect(screen.getByTestId('lease-terms-notice')).toHaveTextContent(
        /between 1 and 28/i,
      );
      expect(mockUpdateLeaseTerms).not.toHaveBeenCalled();
    });

    it('should only advance to review when the form is submitted via Enter', () => {
      renderEditor();

      fireEvent.submit(screen.getByTestId('lease-terms-editor'));

      // Advanced to review — but the action was never called.
      expect(screen.getByTestId('lease-terms-save')).toBeInTheDocument();
      expect(mockUpdateLeaseTerms).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Stage 2 — review diff
  // -------------------------------------------------------------------------

  describe('review stage', () => {
    it('should diff against the original loaded terms and show only changed rows', () => {
      renderEditor();

      fireEvent.change(screen.getByTestId('lease-rent-amount'), {
        target: { value: '1600' },
      });
      goToReview();

      expect(screen.getByText('$1,500 → $1,600')).toBeInTheDocument();
      // Due day and lease end are unchanged — no rows for them.
      expect(screen.queryByText('Due day')).not.toBeInTheDocument();
      expect(screen.queryByText('Lease end')).not.toBeInTheDocument();
      // Identity lines.
      expect(screen.getByText('Jane Tenant')).toBeInTheDocument();
      expect(screen.getByText('22 Oak St · 1A')).toBeInTheDocument();
      // "What does not happen" block.
      expect(
        screen.getByText(
          /No tenant message is sent\. No payment link is issued\. No legal notice is generated\. Past cycles are unchanged\./,
        ),
      ).toBeInTheDocument();
      expect(mockUpdateLeaseTerms).not.toHaveBeenCalled();
    });

    it('should show the current-cycle money line only when the checkbox is on', () => {
      renderEditor();

      fireEvent.change(screen.getByTestId('lease-rent-amount'), {
        target: { value: '1600' },
      });
      fireEvent.click(screen.getByTestId('lease-touch-cycle'));
      goToReview();

      expect(
        screen.getByText(
          /This will update this month’s unpaid rent cycle from \$1,500 to \$1,600, due \d{4}-\d{2}-\d{2}\. No payment request is sent\./,
        ),
      ).toBeInTheDocument();
    });

    it('should return to edit with values preserved when Back is clicked', () => {
      renderEditor();

      fireEvent.change(screen.getByTestId('lease-rent-amount'), {
        target: { value: '1600' },
      });
      goToReview();
      fireEvent.click(screen.getByRole('button', { name: 'Back' }));

      expect(screen.getByTestId('lease-rent-amount')).toHaveValue(1600);
      expect(mockUpdateLeaseTerms).not.toHaveBeenCalled();
    });

    it('should call the action once with the drafted payload on confirm', async () => {
      renderEditor();

      fireEvent.change(screen.getByTestId('lease-rent-amount'), {
        target: { value: '1600' },
      });
      goToReview();
      fireEvent.click(screen.getByTestId('lease-terms-save'));
      await flushMicrotasks();

      expect(mockUpdateLeaseTerms).toHaveBeenCalledTimes(1);
      expect(mockUpdateLeaseTerms).toHaveBeenCalledWith({
        leaseId: 'lease-1',
        rentAmount: 1600,
        rentDueDay: 1,
        endDate: '2027-04-30',
        alsoUpdateCurrentCycle: false,
      });
      expect(mockRefresh).toHaveBeenCalled();
      expect(screen.getByTestId('lease-terms-notice')).toHaveTextContent(
        /applies from the next cycle/i,
      );
    });

    it('should surface action errors and return to the edit stage', async () => {
      mockUpdateLeaseTerms.mockResolvedValue({
        success: false,
        error: 'Lease not found.',
      });
      renderEditor();

      goToReview();
      fireEvent.click(screen.getByTestId('lease-terms-save'));
      await flushMicrotasks();

      expect(screen.getByTestId('lease-terms-notice')).toHaveTextContent(
        'Lease not found.',
      );
      expect(screen.getByTestId('lease-terms-review')).toBeInTheDocument();
      expect(mockRefresh).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // End-lease destructive confirm
  // -------------------------------------------------------------------------

  describe('end-lease confirm', () => {
    function goToTerminateReview(): void {
      fireEvent.click(screen.getByTestId('lease-terminate'));
      goToReview();
    }

    it('should show the destructive heading and rent-event statement', () => {
      renderEditor();
      goToTerminateReview();

      expect(
        screen.getByText('End lease for Jane Tenant and mark unit vacant'),
      ).toBeInTheDocument();
      expect(
        screen.getByText(
          /does not forgive, delete, or send anything about current rent events/,
        ),
      ).toBeInTheDocument();
      expect(
        screen.getByTestId('lease-terminate-confirm-input'),
      ).toBeInTheDocument();
    });

    it('should keep the confirm button disabled until END LEASE is typed exactly', () => {
      renderEditor();
      goToTerminateReview();

      const confirmButton = screen.getByTestId('lease-terms-save');
      expect(confirmButton).toBeDisabled();

      fireEvent.change(screen.getByTestId('lease-terminate-confirm-input'), {
        target: { value: 'end lease' },
      });
      expect(confirmButton).toBeDisabled();

      fireEvent.change(screen.getByTestId('lease-terminate-confirm-input'), {
        target: { value: 'END LEASE' },
      });
      expect(confirmButton).toBeEnabled();
      expect(mockUpdateLeaseTerms).not.toHaveBeenCalled();
    });

    it('should not save when the form is submitted from the typed-confirm input', () => {
      renderEditor();
      goToTerminateReview();

      fireEvent.change(screen.getByTestId('lease-terminate-confirm-input'), {
        target: { value: 'END LEASE' },
      });
      fireEvent.submit(screen.getByTestId('lease-terms-editor'));

      expect(mockUpdateLeaseTerms).not.toHaveBeenCalled();
    });

    it('should terminate with status terminated and no cycle touch on confirm', async () => {
      renderEditor();
      goToTerminateReview();

      fireEvent.change(screen.getByTestId('lease-terminate-confirm-input'), {
        target: { value: 'END LEASE' },
      });
      fireEvent.click(screen.getByTestId('lease-terms-save'));
      await flushMicrotasks();

      expect(mockUpdateLeaseTerms).toHaveBeenCalledTimes(1);
      expect(mockUpdateLeaseTerms).toHaveBeenCalledWith({
        leaseId: 'lease-1',
        rentAmount: 1500,
        rentDueDay: 1,
        endDate: '2027-04-30',
        status: 'terminated',
        alsoUpdateCurrentCycle: false,
      });
      expect(screen.getByTestId('lease-terms-notice')).toHaveTextContent(
        /Lease terminated/,
      );
    });
  });
});
