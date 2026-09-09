/**
 * Status pills used by the Maintenance + Payments tabs.
 *
 * Pure presentational, no client features. Two distinct palettes:
 *   - Maintenance ticket status (open / in_progress / resolved / cancelled)
 *   - Rent payment status (pending / succeeded / failed / refunded / canceled)
 *
 * Colors deliberately match the existing `rent-payment-history.tsx` palette
 * so the drawer + property-tab payments view look identical.
 */

import * as React from 'react';

import type {
  MaintenanceTicketRow,
  RentPaymentRow,
} from '@/lib/properties/queries';

type MaintenanceStatus = MaintenanceTicketRow['status'];
type PaymentStatus = RentPaymentRow['status'];
type Severity = MaintenanceTicketRow['severity'];

interface Palette {
  bg: string;
  fg: string;
  label: string;
}

const MAINTENANCE_PALETTE: Record<MaintenanceStatus, Palette> = {
  open: { bg: '#fee2e2', fg: '#991b1b', label: 'Open' },
  in_progress: { bg: '#fef3c7', fg: '#92400e', label: 'In progress' },
  resolved: { bg: '#d1fae5', fg: '#065f46', label: 'Resolved' },
  cancelled: { bg: '#e2e8f0', fg: '#475569', label: 'Cancelled' },
};

const PAYMENT_PALETTE: Record<PaymentStatus, Palette> = {
  pending: { bg: '#fef3c7', fg: '#92400e', label: 'Pending' },
  succeeded: { bg: '#d1fae5', fg: '#065f46', label: 'Paid' },
  failed: { bg: '#fee2e2', fg: '#991b1b', label: 'Failed' },
  refunded: { bg: '#e2e8f0', fg: '#475569', label: 'Refunded' },
  canceled: { bg: '#e2e8f0', fg: '#475569', label: 'Canceled' },
};

const SEVERITY_PALETTE: Record<Severity, Palette> = {
  low: { bg: '#e2e8f0', fg: '#475569', label: 'Low' },
  medium: { bg: '#fef3c7', fg: '#92400e', label: 'Medium' },
  high: { bg: '#fed7aa', fg: '#9a3412', label: 'High' },
  urgent: { bg: '#fee2e2', fg: '#991b1b', label: 'Urgent' },
};

interface PillProps {
  palette: Palette;
  testId: string;
}

function Pill({ palette, testId }: PillProps): React.ReactElement {
  return (
    <span
      data-testid={testId}
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
      {palette.label}
    </span>
  );
}

export function MaintenanceStatusPill({
  status,
}: {
  status: MaintenanceStatus;
}): React.ReactElement {
  return (
    <Pill
      palette={MAINTENANCE_PALETTE[status]}
      testId={`maintenance-status-${status}`}
    />
  );
}

export function PaymentStatusPill({
  status,
}: {
  status: PaymentStatus;
}): React.ReactElement {
  return (
    <Pill
      palette={PAYMENT_PALETTE[status]}
      testId={`payment-status-${status}`}
    />
  );
}

export function SeverityPill({
  severity,
}: {
  severity: Severity;
}): React.ReactElement {
  return (
    <Pill
      palette={SEVERITY_PALETTE[severity]}
      testId={`maintenance-severity-${severity}`}
    />
  );
}
