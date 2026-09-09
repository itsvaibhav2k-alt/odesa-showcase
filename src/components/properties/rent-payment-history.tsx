/**
 * Wave 7 Stream S — Stripe rent-payment history.
 *
 * Renders the `rent_payments` rows for one lease as a compact table
 * (last 12 by convention; the caller decides how many to pass). Each
 * row: month label, amount, status pill, paid_at, receipt link, and
 * the live payment link.
 *
 * Wave 8: rebuilt on top of `DataTable<T>` so the property Payments
 * tab and the per-unit drawer render the same visual primitive. The
 * external prop shape (`{ payments }`) is preserved.
 */

import * as React from 'react';
import { ExternalLink } from 'lucide-react';

import { DataTable, type DataTableColumn } from '@/components/ui/data-table';
import type { RentPaymentEntry } from '@/lib/properties/queries';

export interface RentPaymentHistoryProps {
  payments: RentPaymentEntry[];
}

export function RentPaymentHistory({ payments }: RentPaymentHistoryProps) {
  return (
    <section
      data-testid='rent-payment-history'
      aria-label='Payment history'
      className='flex flex-col gap-3'
    >
      <h2
        style={{
          fontSize: '14px',
          fontWeight: 500,
          color: 'var(--ink-900)',
          letterSpacing: '0.02em',
          margin: 0,
        }}
      >
        Payment history
      </h2>
      <DataTable<RentPaymentEntry>
        rows={payments}
        columns={COLUMNS}
        getRowKey={(p) => p.id}
        emptyState={
          <span data-testid='rent-payment-history-empty'>
            No rent payments yet. Odesa will create one when rent is requested.
          </span>
        }
      />
    </section>
  );
}

// ---------------------------------------------------------------------------
// Columns + helpers
// ---------------------------------------------------------------------------

const COLUMNS: ReadonlyArray<DataTableColumn<RentPaymentEntry>> = [
  {
    key: 'month',
    header: 'Month',
    render: (p) => formatMonthLabel(p.createdAt),
  },
  {
    key: 'amountCents',
    header: 'Amount',
    align: 'right',
    render: (p) => (
      <span className='tabular-nums'>{formatDollars(p.amountCents)}</span>
    ),
  },
  {
    key: 'status',
    header: 'Status',
    render: (p) => <StatusPill status={p.status} />,
  },
  {
    key: 'paidAt',
    header: 'Paid',
    render: (p) => (p.paidAt ? formatPaidAt(p.paidAt) : '—'),
  },
  {
    key: 'receiptUrl',
    header: 'Receipt',
    render: (p) =>
      p.receiptUrl ? (
        <a
          href={p.receiptUrl}
          target='_blank'
          rel='noopener noreferrer'
          style={{ color: 'var(--accent-600)', textDecoration: 'underline' }}
        >
          View
        </a>
      ) : (
        '—'
      ),
  },
  {
    key: 'paymentLinkUrl',
    header: 'Payment link',
    render: (p) =>
      p.paymentLinkUrl ? (
        <a
          href={p.paymentLinkUrl}
          target='_blank'
          rel='noopener noreferrer'
          aria-label='Open Stripe payment link'
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            color: 'var(--accent-600)',
            textDecoration: 'underline',
          }}
        >
          Payment link
          <ExternalLink size={12} aria-hidden style={{ marginLeft: 4 }} />
        </a>
      ) : (
        '—'
      ),
  },
];

interface StatusPillProps {
  status: RentPaymentEntry['status'];
}

function StatusPill({ status }: StatusPillProps) {
  const palette = STATUS_PALETTE[status];
  return (
    <span
      data-testid={`rent-payment-status-${status}`}
      style={{
        display: 'inline-block',
        padding: '2px 8px',
        borderRadius: '999px',
        fontSize: '11px',
        fontWeight: 500,
        letterSpacing: '0.02em',
        background: palette.bg,
        color: palette.fg,
      }}
    >
      {STATUS_LABEL[status]}
    </span>
  );
}

const STATUS_PALETTE: Record<
  RentPaymentEntry['status'],
  { bg: string; fg: string }
> = {
  pending: { bg: '#fef3c7', fg: '#92400e' },
  succeeded: { bg: '#d1fae5', fg: '#065f46' },
  failed: { bg: '#fee2e2', fg: '#991b1b' },
  refunded: { bg: '#e2e8f0', fg: '#475569' },
  canceled: { bg: '#e2e8f0', fg: '#475569' },
};

const STATUS_LABEL: Record<RentPaymentEntry['status'], string> = {
  pending: 'Pending',
  succeeded: 'Paid',
  failed: 'Failed',
  refunded: 'Refunded',
  canceled: 'Canceled',
};

function formatMonthLabel(iso: string): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return iso;
  return parsed.toLocaleDateString('en-US', {
    month: 'short',
    year: 'numeric',
  });
}

function formatPaidAt(iso: string): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return iso;
  return parsed.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  });
}

function formatDollars(cents: number): string {
  const dollars = cents / 100;
  return dollars.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: dollars % 1 === 0 ? 0 : 2,
  });
}
