import type { PaymentTimelineEntry } from '@/lib/properties/queries';
import type { RentEventStatus } from '@/types/database';

/**
 * Horizontal row of rent-event dots representing the lease's payment
 * history, ordered by `cycle_month` ascending.
 *
 * Dot color rules:
 *   - success-600 : paid
 *   - warning-600 : late_1
 *   - error-600   : late_3 / late_7 / escalated
 *   - ink-300     : pending / reminder_sent / due_sent / plan_agreed
 *
 * The first and last dots are labeled (month + year, meta).
 */

export interface PaymentTimelineProps {
  payments: PaymentTimelineEntry[];
}

export function PaymentTimeline({ payments }: PaymentTimelineProps) {
  if (payments.length === 0) {
    return (
      <div
        data-testid="payment-timeline-empty"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
          padding: '14px 16px',
          background: 'var(--paper-50)',
          border: '1px solid var(--ink-200)',
          borderRadius: 'var(--radius-sm-odesa)',
          fontSize: '13px',
          color: 'var(--ink-500)',
        }}
      >
        Payment history will appear as rent cycles run.
      </div>
    );
  }

  const first = payments[0];
  const last = payments[payments.length - 1];
  const firstLabel = formatCycleLabel(first.cycleMonth);
  const lastLabel = formatCycleLabel(last.cycleMonth);

  return (
    <div
      data-testid="payment-timeline"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '10px',
        padding: '16px 18px',
        background: 'var(--paper-50)',
        border: '1px solid var(--ink-200)',
        borderRadius: 'var(--radius-sm-odesa)',
      }}
    >
      <div className="flex items-center justify-between">
        <p className="meta-label" style={{ color: 'var(--ink-500)' }}>
          Payment history
        </p>
        <p
          className="meta-label tabular-nums"
          style={{ color: 'var(--ink-500)' }}
          data-testid="payment-timeline-count"
        >
          {payments.length} cycle{payments.length === 1 ? '' : 's'}
        </p>
      </div>
      <div
        data-testid="payment-timeline-dots"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
          flexWrap: 'wrap',
        }}
      >
        {payments.map((p) => {
          const color = colorForStatus(p.status);
          return (
            <span
              key={p.id}
              data-testid={`payment-timeline-dot-${p.id}`}
              data-payment-status={p.status}
              title={`${formatCycleLabel(p.cycleMonth)} — ${p.status}`}
              style={{
                width: '12px',
                height: '12px',
                borderRadius: '999px',
                background: color,
                flexShrink: 0,
                display: 'inline-block',
              }}
            />
          );
        })}
      </div>
      <div
        className="flex items-center justify-between"
        style={{ fontSize: '10px', letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--ink-500)' }}
      >
        <span data-testid="payment-timeline-first-label">{firstLabel}</span>
        <span data-testid="payment-timeline-last-label">{lastLabel}</span>
      </div>
    </div>
  );
}

function colorForStatus(status: RentEventStatus): string {
  switch (status) {
    case 'paid':
      return 'var(--success-600)';
    case 'late_1':
      return 'var(--warning-600)';
    case 'late_3':
    case 'late_7':
    case 'escalated':
      return 'var(--error-600)';
    case 'pending':
    case 'reminder_sent':
    case 'due_sent':
    case 'plan_agreed':
      return 'var(--ink-400)';
  }
}

function formatCycleLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d
    .toLocaleString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' })
    .toLowerCase();
}
