/**
 * Unit tests for `<UnitsTable>`. Covers empty state, populated render,
 * and the row click → router URL transition.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

const mockPush = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: mockPush, refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams('room=units'),
}));

import { UnitsTable } from '@/components/properties/units-table';
import type { UnitTableRow } from '@/lib/properties/queries';

const ROW_OCCUPIED: UnitTableRow = {
  id: 'unit-1',
  label: 'Apt 1A',
  tenantName: 'Marcus Lee',
  rentAmountCents: 240000,
  status: 'occupied',
  lastPaymentDate: '2026-05-03T10:00:00.000Z',
  openMaintCount: 0,
  tenantId: 'tenant-1',
  leaseId: 'lease-1',
  leaseEndDate: '2026-12-31',
  outstandingDollars: 0,
  daysLate: 0,
  currentRentEventId: 'rent-1',
};

const ROW_VACANT: UnitTableRow = {
  id: 'unit-2',
  label: 'Apt 2B',
  tenantName: null,
  rentAmountCents: null,
  status: 'vacant',
  lastPaymentDate: null,
  openMaintCount: 3,
  tenantId: null,
  leaseId: null,
  leaseEndDate: null,
  outstandingDollars: 0,
  daysLate: 0,
  currentRentEventId: null,
};

beforeEach(() => {
  mockPush.mockReset();
});

describe('UnitsTable', () => {
  describe('empty state', () => {
    it('renders the empty slot when no units are provided', () => {
      render(<UnitsTable propertyId='prop-1' units={[]} />);
      expect(screen.getByTestId('units-table-empty')).toBeInTheDocument();
      expect(screen.queryByRole('table')).not.toBeInTheDocument();
    });
  });

  describe('with units', () => {
    it('renders one row per unit with rent + last payment formatting', () => {
      render(
        <UnitsTable propertyId='prop-1' units={[ROW_OCCUPIED, ROW_VACANT]} />,
      );

      expect(screen.getAllByTestId('data-table-row')).toHaveLength(2);
      expect(screen.getByText('Apt 1A')).toBeInTheDocument();
      expect(screen.getByText('Marcus Lee')).toBeInTheDocument();
      expect(screen.getByText('$2,400/mo')).toBeInTheDocument();
      expect(screen.getByText('May 3, 2026')).toBeInTheDocument();
    });

    it('renders em-dash placeholders for vacant unit', () => {
      render(<UnitsTable propertyId='prop-1' units={[ROW_VACANT]} />);
      // tenant + rent + last payment all em-dash for the vacant unit.
      const dashes = screen.getAllByText('—');
      expect(dashes.length).toBeGreaterThanOrEqual(3);
    });

    it('renders a destructive badge with the open maint count when > 0', () => {
      render(<UnitsTable propertyId='prop-1' units={[ROW_VACANT]} />);
      const badge = screen.getByTestId('units-table-row-unit-2-maint');
      expect(badge).toHaveTextContent('3');
    });

    it('renders an em-dash when open maint count is 0', () => {
      render(<UnitsTable propertyId='prop-1' units={[ROW_OCCUPIED]} />);
      expect(
        screen.queryByTestId('units-table-row-unit-1-maint'),
      ).not.toBeInTheDocument();
    });

    it('renders status pills via testid for each status', () => {
      render(
        <UnitsTable propertyId='prop-1' units={[ROW_OCCUPIED, ROW_VACANT]} />,
      );
      expect(
        screen.getByTestId('units-table-status-occupied'),
      ).toBeInTheDocument();
      expect(
        screen.getByTestId('units-table-status-vacant'),
      ).toBeInTheDocument();
    });
  });

  describe('row click', () => {
    it('calls router.push with room=units + unit=<id>', () => {
      render(<UnitsTable propertyId='prop-1' units={[ROW_OCCUPIED]} />);
      const row = screen.getByTestId('data-table-row');
      fireEvent.click(row);

      expect(mockPush).toHaveBeenCalledTimes(1);
      expect(mockPush).toHaveBeenCalledWith('?room=units&unit=unit-1', {
        scroll: false,
      });
    });
  });
});
