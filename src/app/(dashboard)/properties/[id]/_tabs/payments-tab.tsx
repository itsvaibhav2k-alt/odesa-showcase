/**
 * Payments tab for `/properties/[id]` (Wave 8).
 *
 * Server component. Lists every rent_payment scoped to the property
 * (one row per Stripe attempt) plus a top strip with two stats:
 *   - "This month" — sum of `succeeded` amounts in the current calendar month
 *   - "Last 3 months" — sum of `succeeded` amounts in the trailing 3 months,
 *      inclusive of the current month
 *
 * Math runs over `totalsByMonth` so we don't re-traverse the row list.
 */

import * as React from 'react';
import { ExternalLink } from 'lucide-react';

import { DataTable, type DataTableColumn } from '@/components/ui/data-table';
import {
  listRentPaymentsForProperty,
  type RentPaymentRow,
} from '@/lib/properties/queries';
import { getPropertyFinancialSnapshot } from '@/lib/financials/queries';

import { PaymentStatusPill } from './status-pill';
import {
  PaymentsBriefing,
  selectRecentPayments,
} from '../_components/payments-briefing';

export interface PaymentsTabProps {
  organizationId: string;
  propertyId: string;
  /**
   * Override for "now" — only the date parts are used. Lets the tests
   * pin the current-month / 3-month math to a known date.
   */
  now?: Date;
}

export async function PaymentsTab({
  organizationId,
  propertyId,
  now,
}: PaymentsTabProps): Promise<React.ReactElement> {
  const [{ rows, totalsByMonth }, briefing] = await Promise.all([
    listRentPaymentsForProperty(organizationId, propertyId),
    getPropertyFinancialSnapshot(propertyId),
  ]);

  const reference = now ?? new Date();
  const thisMonthCents = totalsByMonth[monthKey(reference)] ?? 0;
  const last3Cents = sumLastNMonths(totalsByMonth, reference, 3);

  // The briefing reads the rent cycle (expected / collected / late) which
  // exists even when no Stripe payment rows do, so it renders in both the
  // empty and populated states — before the transaction surface.
  const briefingEl = (
    <PaymentsBriefing briefing={briefing} recentPayments={selectRecentPayments(rows)} />
  );

  if (rows.length === 0) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
        {briefingEl}
        <div
          data-testid='payments-tab-empty'
          className='rounded-md border border-[var(--ink-200)] bg-[var(--paper-0)] px-8 py-9 text-sm leading-relaxed text-[var(--ink-500)]'
        >
          No online payments yet. This shows card and bank payments made
          through a payment link. For billed and outstanding rent, see the{' '}
          <a href='/rent' style={{ color: 'var(--accent-600)' }}>
            Rent ledger
          </a>
          .
        </div>
      </div>
    );
  }

  return (
    <div
      data-testid='payments-tab'
      style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}
    >
      {briefingEl}
      <section
        aria-label='Rent payment totals'
        data-testid='payments-totals-strip'
        className='grid gap-3 grid-cols-1 sm:grid-cols-2'
      >
        <StatBlock
          label='This month'
          value={formatDollars(thisMonthCents)}
          testId='payments-stat-this-month'
        />
        <StatBlock
          label='Last 3 months'
          value={formatDollars(last3Cents)}
          testId='payments-stat-last-3-months'
        />
      </section>

      <DataTable<RentPaymentRow>
        rows={rows}
        columns={PAYMENT_COLUMNS}
        getRowKey={(r) => r.id}
        data-testid='payments-table'
      />
    </div>
  );
}

interface StatBlockProps {
  label: string;
  value: string;
  testId: string;
}

function StatBlock({ label, value, testId }: StatBlockProps): React.ReactElement {
  return (
    <article
      data-testid={testId}
      style={{
        background: 'var(--paper-0)',
        border: '1px solid var(--ink-200)',
        borderRadius: 'var(--radius-md-odesa)',
        padding: '16px 18px',
        display: 'flex',
        flexDirection: 'column',
        gap: '6px',
      }}
    >
      <p className='meta-label' data-testid={`${testId}-label`}>
        {label}
      </p>
      <p
        className='tabular-nums'
        data-testid={`${testId}-value`}
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: '22px',
          lineHeight: 1.1,
          fontWeight: 500,
          color: 'var(--ink-900)',
          letterSpacing: '-0.01em',
        }}
      >
        {value}
      </p>
    </article>
  );
}

const PAYMENT_COLUMNS: ReadonlyArray<DataTableColumn<RentPaymentRow>> = [
  {
    key: 'tenantName',
    header: 'Tenant',
    render: (row) => row.tenantName ?? '—',
  },
  {
    key: 'unitLabel',
    header: 'Unit',
    render: (row) => row.unitLabel ?? '—',
  },
  {
    key: 'amountCents',
    header: 'Amount',
    align: 'right',
    render: (row) => (
      <span className='tabular-nums'>{formatDollars(row.amountCents)}</span>
    ),
  },
  {
    key: 'status',
    header: 'Status',
    render: (row) => <PaymentStatusPill status={row.status} />,
  },
  {
    key: 'paidAt',
    header: 'Paid',
    render: (row) => (row.paidAt ? formatShortDate(row.paidAt) : '—'),
  },
  {
    key: 'receiptUrl',
    header: 'Receipt',
    render: (row) =>
      row.receiptUrl ? (
        <a
          href={row.receiptUrl}
          target='_blank'
          rel='noopener noreferrer'
          aria-label='Open receipt'
          data-testid='payment-receipt-link'
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            color: 'var(--accent-600)',
          }}
        >
          <ExternalLink size={14} aria-hidden />
        </a>
      ) : (
        '—'
      ),
  },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function monthKey(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

function sumLastNMonths(
  totals: Record<string, number>,
  reference: Date,
  n: number,
): number {
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const d = new Date(
      Date.UTC(reference.getUTCFullYear(), reference.getUTCMonth() - i, 1),
    );
    sum += totals[monthKey(d)] ?? 0;
  }
  return sum;
}

function formatDollars(cents: number): string {
  const dollars = cents / 100;
  return dollars.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: dollars % 1 === 0 ? 0 : 2,
  });
}

function formatShortDate(iso: string): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return iso;
  return parsed.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  });
}
