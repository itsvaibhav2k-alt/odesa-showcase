import { PaymentTimeline } from './payment-timeline';
import type { UnitDetail } from '@/lib/properties/queries';

/**
 * Lease block for the unit-detail page.
 *
 * Design:
 * - 2-col summary grid with term / rent / deposit / end date
 * - Deposit row is hidden if `depositCents` is null
 * - Payment timeline of dots, one per rent_event
 */

export interface LeaseBlockProps {
  lease: NonNullable<UnitDetail['lease']>;
  payments: UnitDetail['payments'];
}

export function LeaseBlock({ lease, payments }: LeaseBlockProps) {
  const rows: Array<{ label: string; value: string; testId: string }> = [
    {
      label: 'Term',
      value: formatTerm(lease.startDate, lease.endDate),
      testId: 'unit-detail-lease-term',
    },
    {
      label: 'Rent',
      value: `${formatMoneyCents(lease.rentAmountCents)} / mo`,
      testId: 'unit-detail-lease-rent',
    },
  ];

  if (lease.depositCents != null) {
    rows.push({
      label: 'Deposit',
      value: formatMoneyCents(lease.depositCents),
      testId: 'unit-detail-lease-deposit',
    });
  }

  rows.push({
    label: 'Ends',
    value: lease.endDate ? formatLongDate(lease.endDate) : 'Month-to-month',
    testId: 'unit-detail-lease-end',
  });

  return (
    <section
      data-testid="unit-detail-lease"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '20px',
      }}
    >
      <p className="meta-label" style={{ color: 'var(--ink-500)' }}>
        Lease
      </p>
      <dl
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
          gap: '18px 24px',
          margin: 0,
        }}
      >
        {rows.map((r) => (
          <div
            key={r.testId}
            data-testid={r.testId}
            style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}
          >
            <dt className="meta-label" style={{ color: 'var(--ink-500)' }}>
              {r.label}
            </dt>
            <dd
              style={{
                margin: 0,
                fontSize: '16px',
                color: 'var(--ink-900)',
                fontFamily: r.label === 'Rent' || r.label === 'Deposit'
                  ? 'var(--font-mono)'
                  : 'inherit',
              }}
              className={
                r.label === 'Rent' || r.label === 'Deposit'
                  ? 'tabular-nums'
                  : undefined
              }
            >
              {r.value}
            </dd>
          </div>
        ))}
      </dl>

      <PaymentTimeline payments={payments} />
    </section>
  );
}

function formatTerm(start: string | null, end: string | null): string {
  if (!start && !end) return 'Month-to-month';
  const parts = [start, end].map((iso) => (iso ? formatShortDate(iso) : '…'));
  return `${parts[0]} → ${parts[1]}`;
}

function formatShortDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

function formatLongDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

function formatMoneyCents(cents: number): string {
  const dollars = Math.round(cents) / 100;
  return `$${Math.round(dollars).toLocaleString('en-US')}`;
}
