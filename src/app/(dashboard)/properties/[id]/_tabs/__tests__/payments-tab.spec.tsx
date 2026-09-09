/**
 * Tests for the property Payments tab (Wave 8).
 *
 * Mocks the query module so the server component renders with known
 * inputs. Covers the empty state, the totals-by-month strip math,
 * and the status-pill rendering on data rows.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';

vi.mock('@/lib/properties/queries', async () => {
  const actual = await vi.importActual<
    typeof import('@/lib/properties/queries')
  >('@/lib/properties/queries');
  return {
    ...actual,
    listRentPaymentsForProperty: vi.fn(),
  };
});

vi.mock('@/lib/financials/queries', () => ({
  getPropertyFinancialSnapshot: vi.fn(),
}));

import { listRentPaymentsForProperty } from '@/lib/properties/queries';
import type {
  PropertyRentPaymentsResult,
  RentPaymentRow,
} from '@/lib/properties/queries';
import { getPropertyFinancialSnapshot } from '@/lib/financials/queries';
import type {
  PropertyFinancialBriefing,
} from '@/lib/financials/queries';
import type { PropertyFinancialSnapshot } from '@/lib/financials/types';

import { PaymentsTab } from '../payments-tab';

function makeBriefing(
  snapshot: Partial<PropertyFinancialSnapshot> = {},
  exceptions: PropertyFinancialBriefing['exceptions'] = [],
): PropertyFinancialBriefing {
  return {
    period: { startDate: '2026-05-01', endDate: '2026-05-31', label: 'May 2026' },
    snapshot: {
      propertyId: 'prop-1',
      propertyName: 'Ranson Apartments',
      units: 3,
      occupiedUnits: 3,
      rentBilledCents: 600_000,
      rentCollectedCents: 400_000,
      rentOutstandingCents: 200_000,
      rentLateCents: 150_000,
      maintenanceSpendCents: null,
      vendorSpendCents: null,
      otherExpenseCents: null,
      operatingExpenseCents: null,
      noiCents: null,
      marginPct: null,
      collectionRatePct: 66.7,
      occupancyRatePct: 100,
      openWorkOrderCount: 0,
      riskLevel: 'attention',
      riskReasons: ['$1,500 of rent is late'],
      ...snapshot,
    },
    exceptions,
  };
}

function makeRow(
  o: Partial<RentPaymentRow> & { id: string },
): RentPaymentRow {
  return {
    id: o.id,
    amountCents: o.amountCents ?? 200000,
    status: o.status ?? 'succeeded',
    createdAt: o.createdAt ?? '2026-05-01T00:00:00.000Z',
    paidAt: o.paidAt ?? '2026-05-01T00:00:00.000Z',
    receiptUrl: o.receiptUrl ?? null,
    paymentLinkUrl: o.paymentLinkUrl ?? null,
    leaseId: o.leaseId ?? 'lease-1',
    tenantId: o.tenantId ?? 'tenant-1',
    tenantName: o.tenantName ?? 'Marcus Lee',
    unitId: o.unitId ?? 'unit-1',
    unitLabel: o.unitLabel ?? 'Apt 1A',
  };
}

function mockResult(result: PropertyRentPaymentsResult): void {
  vi.mocked(listRentPaymentsForProperty).mockResolvedValue(result);
}

async function renderTab(now?: Date): Promise<void> {
  const element = await PaymentsTab({
    organizationId: 'org-1',
    propertyId: 'prop-1',
    now,
  });
  render(element);
}

describe('PaymentsTab', () => {
  beforeEach(() => {
    // Default: no briefing so the existing structural tests are unaffected.
    vi.mocked(getPropertyFinancialSnapshot).mockResolvedValue(null);
  });

  it('renders an empty state when there are no payments', async () => {
    mockResult({ rows: [], totalsByMonth: {} });
    await renderTab(new Date(Date.UTC(2026, 4, 10)));

    expect(screen.getByTestId('payments-tab-empty')).toBeInTheDocument();
    expect(screen.queryByTestId('payments-tab')).not.toBeInTheDocument();
  });

  it('renders the table + totals strip when rows are present', async () => {
    mockResult({
      rows: [makeRow({ id: 'p1' })],
      totalsByMonth: { '2026-05': 200000 },
    });
    await renderTab(new Date(Date.UTC(2026, 4, 10)));

    expect(screen.getByTestId('payments-tab')).toBeInTheDocument();
    expect(screen.getByTestId('payments-totals-strip')).toBeInTheDocument();
    expect(screen.getByTestId('payments-table')).toBeInTheDocument();
  });

  it('computes "This month" from the reference date', async () => {
    mockResult({
      rows: [makeRow({ id: 'p1' })],
      totalsByMonth: {
        '2026-03': 100000,
        '2026-04': 150000,
        '2026-05': 220000,
      },
    });

    await renderTab(new Date(Date.UTC(2026, 4, 10)));

    expect(
      screen.getByTestId('payments-stat-this-month-value'),
    ).toHaveTextContent('$2,200');
  });

  it('computes "Last 3 months" as a trailing 3-month sum (inclusive of current)', async () => {
    mockResult({
      rows: [makeRow({ id: 'p1' })],
      totalsByMonth: {
        '2026-02': 50000,
        '2026-03': 100000,
        '2026-04': 150000,
        '2026-05': 220000,
      },
    });

    await renderTab(new Date(Date.UTC(2026, 4, 10)));

    // Trailing 3 months from May 2026 = May + Apr + Mar = 220000 + 150000 + 100000 = 470000.
    expect(
      screen.getByTestId('payments-stat-last-3-months-value'),
    ).toHaveTextContent('$4,700');
  });

  it('shows $0 totals when totalsByMonth lacks current-month data', async () => {
    mockResult({
      rows: [
        makeRow({ id: 'p1', status: 'pending', paidAt: null }),
      ],
      totalsByMonth: {},
    });

    await renderTab(new Date(Date.UTC(2026, 4, 10)));

    expect(
      screen.getByTestId('payments-stat-this-month-value'),
    ).toHaveTextContent('$0');
    expect(
      screen.getByTestId('payments-stat-last-3-months-value'),
    ).toHaveTextContent('$0');
  });

  it('renders one status pill per row', async () => {
    mockResult({
      rows: [
        makeRow({ id: 'p1', status: 'succeeded' }),
        makeRow({ id: 'p2', status: 'pending', paidAt: null }),
        makeRow({ id: 'p3', status: 'failed', paidAt: null }),
      ],
      totalsByMonth: {},
    });

    await renderTab(new Date(Date.UTC(2026, 4, 10)));

    expect(screen.getByTestId('payment-status-succeeded')).toBeInTheDocument();
    expect(screen.getByTestId('payment-status-pending')).toBeInTheDocument();
    expect(screen.getByTestId('payment-status-failed')).toBeInTheDocument();
  });

  it('renders an em-dash for paid date when the payment is pending', async () => {
    mockResult({
      rows: [
        makeRow({
          id: 'p1',
          status: 'pending',
          paidAt: null,
          tenantName: 'Pending Pat',
        }),
      ],
      totalsByMonth: {},
    });

    await renderTab(new Date(Date.UTC(2026, 4, 10)));

    const table = screen.getByTestId('payments-table');
    expect(within(table).getByText('Pending Pat')).toBeInTheDocument();
    expect(within(table).getAllByText('—').length).toBeGreaterThanOrEqual(1);
  });

  it('renders a receipt icon link when receipt_url is set', async () => {
    mockResult({
      rows: [
        makeRow({
          id: 'p1',
          receiptUrl: 'https://stripe.com/receipt/abc',
        }),
      ],
      totalsByMonth: {},
    });

    await renderTab(new Date(Date.UTC(2026, 4, 10)));

    const link = screen.getByTestId('payment-receipt-link');
    expect(link).toHaveAttribute('href', 'https://stripe.com/receipt/abc');
    expect(link).toHaveAttribute('target', '_blank');
  });

  describe('financial briefing', () => {
    it('renders the briefing with rent-cycle metrics above the table', async () => {
      vi.mocked(getPropertyFinancialSnapshot).mockResolvedValue(makeBriefing());
      mockResult({
        rows: [makeRow({ id: 'p1' })],
        totalsByMonth: { '2026-05': 200000 },
      });

      await renderTab(new Date(Date.UTC(2026, 4, 10)));

      const briefing = screen.getByTestId('payments-briefing');
      expect(briefing).toBeInTheDocument();
      // Expected $6,000 + Collected $4,000 come from the snapshot, not rows.
      expect(within(briefing).getByText('$6,000')).toBeInTheDocument();
      expect(within(briefing).getByText('$4,000')).toBeInTheDocument();
    });

    it('renders the briefing even when there are no payment rows', async () => {
      vi.mocked(getPropertyFinancialSnapshot).mockResolvedValue(makeBriefing());
      mockResult({ rows: [], totalsByMonth: {} });

      await renderTab(new Date(Date.UTC(2026, 4, 10)));

      expect(screen.getByTestId('payments-briefing')).toBeInTheDocument();
      expect(screen.getByTestId('payments-tab-empty')).toBeInTheDocument();
    });

    it('states the honest spend gap and never invents NOI', async () => {
      vi.mocked(getPropertyFinancialSnapshot).mockResolvedValue(makeBriefing());
      mockResult({ rows: [], totalsByMonth: {} });

      await renderTab(new Date(Date.UTC(2026, 4, 10)));

      expect(
        screen.getByTestId('payments-briefing-spend-note'),
      ).toHaveTextContent(/expense imports not connected yet/i);
    });

    it('lists recent succeeded payments only', async () => {
      vi.mocked(getPropertyFinancialSnapshot).mockResolvedValue(makeBriefing());
      mockResult({
        rows: [
          makeRow({ id: 'p1', tenantName: 'Marcus Lee', status: 'succeeded' }),
          makeRow({ id: 'p2', tenantName: 'Pending Pat', status: 'pending', paidAt: null }),
        ],
        totalsByMonth: { '2026-05': 200000 },
      });

      await renderTab(new Date(Date.UTC(2026, 4, 10)));

      const recent = screen.getByTestId('payments-briefing-recent');
      expect(within(recent).getByText('Marcus Lee')).toBeInTheDocument();
      expect(within(recent).queryByText('Pending Pat')).not.toBeInTheDocument();
    });
  });
});
