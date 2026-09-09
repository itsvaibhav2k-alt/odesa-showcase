/**
 * Rent desk — the `?room=payments` drawer interior.
 *
 * One self-contained async server component that owns its own org-scoped
 * fetch and renders INSIDE the room-drawer shell (the shell paints the
 * eyebrow/title/description from `ROOM_META`; this component never repeats
 * them). The shell stays visually dominant — the legacy payments table sits
 * inside the main hairline card with reduced chrome + horizontal scroll so
 * it never blows out the drawer at 720px or 92vw.
 *
 * Stat rail (from the data the query already returns):
 *   - Collected (MTD) — succeeded amounts bucketed into the current month
 *   - Outstanding     — sum of `pending` payment amounts
 *   - Next due        — placeholder "—" (no lease-term schedule in scope)
 *   - Reminders queued — placeholder 0 (no reminder schema in scope)
 */

import * as React from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ExternalLink } from 'lucide-react';

import { createServerClient } from '@/lib/supabase/server';
import {
  listRentPaymentsForProperty,
  type RentPaymentRow,
} from '@/lib/properties/queries';
import { getPropertyFinancialSnapshot } from '@/lib/financials/queries';
import { DataTable, type DataTableColumn } from '@/components/ui/data-table';

import {
  RoomCard,
  RoomEmptyState,
  RoomStatCell,
  RoomStatGrid,
} from './room-chrome';
import { PaymentStatusPill } from '../_tabs/status-pill';
import {
  PaymentsBriefing,
  selectRecentPayments,
} from '../_components/payments-briefing';

export interface PaymentsRoomProps {
  propertyId: string;
}

export async function PaymentsRoom({
  propertyId,
}: PaymentsRoomProps): Promise<React.ReactElement> {
  // --- org-id auth block (copied verbatim from the old payments page) -------
  const supabase = await createServerClient();

  const { data: authUser } = await supabase.auth.getUser();
  if (!authUser.user) notFound();

  const [{ data: userRow }, { data: propertyRow }] = await Promise.all([
    supabase
      .from('users')
      .select('organization_id')
      .eq('id', authUser.user.id)
      .single(),
    supabase
      .from('properties')
      .select('id, name')
      .eq('id', propertyId)
      .maybeSingle(),
  ]);

  if (!userRow?.organization_id || !propertyRow) notFound();
  // --- end auth block -------------------------------------------------------

  const [{ rows, totalsByMonth }, briefing] = await Promise.all([
    listRentPaymentsForProperty(userRow.organization_id, propertyId),
    getPropertyFinancialSnapshot(propertyId),
  ]);

  const reference = new Date();
  const collectedMtdCents = totalsByMonth[monthKey(reference)] ?? 0;
  const outstandingCents = rows.reduce(
    (sum, row) => (row.status === 'pending' ? sum + row.amountCents : sum),
    0,
  );

  return (
    <div data-testid='payments-room' style={roomBodyStyle}>
      <PaymentsBriefing
        briefing={briefing}
        recentPayments={selectRecentPayments(rows)}
      />

      <div data-testid='record-payment-pointer' style={calloutStyle}>
        <div style={calloutHeaderRowStyle}>
          <h3 style={calloutTitleStyle}>Record an offline payment</h3>
          <span aria-hidden='true' style={calloutChipStyle}>
            Manual payment entry
          </span>
        </div>
        <p style={calloutBodyStyle}>
          Recording an offline payment updates the current rent cycle balance —
          no money moves. You can record one from the Rent ledger, or from a
          tenant&apos;s page.
        </p>
        <Link
          href='/rent'
          data-testid='record-payment-open-rent'
          style={calloutLinkStyle}
        >
          Open Rent →
        </Link>
      </div>

      <RoomStatGrid>
        <RoomStatCell label='Collected (MTD)' value={formatDollars(collectedMtdCents)} />
        <RoomStatCell label='Outstanding' value={formatDollars(outstandingCents)} />
        <RoomStatCell label='Next due' value='—' />
        <RoomStatCell label='Reminders queued' value={0} />
      </RoomStatGrid>

      {rows.length === 0 ? (
        <RoomCard>
          <RoomEmptyState
            illustration={<ReceiptPairIllustration />}
            headline='No rent payments yet.'
            body='Odesa creates a rent desk when payment links or lease terms are configured.'
          />
        </RoomCard>
      ) : (
        <RoomCard flush scrollX>
          <DataTable<RentPaymentRow>
            rows={rows}
            columns={PAYMENT_COLUMNS}
            getRowKey={(row) => row.id}
            className='min-w-[560px] border-0 rounded-none bg-transparent'
            data-testid='payments-room-table'
          />
        </RoomCard>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Table (reduced-chrome mirror of the legacy payments table)
// ---------------------------------------------------------------------------

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
// Spot illustration — overlapping receipt pair (small, sepia, decorative)
// ---------------------------------------------------------------------------

function ReceiptPairIllustration(): React.ReactElement {
  return (
    <svg
      width={72}
      height={72}
      viewBox='0 0 72 72'
      fill='none'
      aria-hidden='true'
    >
      {/* Back receipt — lighter, offset up-and-right */}
      <rect
        x={31}
        y={15}
        width={24}
        height={29}
        rx={2}
        fill='var(--panel-clean)'
        stroke='var(--ink-4)'
        strokeWidth={1.25}
      />
      {/* Front receipt — torn/perforated bottom edge */}
      <path
        d='M22 20 L50 20 L50 49 L46 52 L42 49 L38 52 L34 49 L30 52 L26 49 L22 52 Z'
        fill='var(--panel-clean)'
        stroke='var(--ink-3)'
        strokeWidth={1.25}
        strokeLinejoin='round'
      />
      {/* Line items */}
      <line x1={26} y1={28} x2={46} y2={28} stroke='var(--ink-3)' strokeWidth={1.25} strokeLinecap='round' />
      <line x1={26} y1={33} x2={46} y2={33} stroke='var(--ink-3)' strokeWidth={1.25} strokeLinecap='round' />
      <line x1={26} y1={38} x2={40} y2={38} stroke='var(--ink-3)' strokeWidth={1.25} strokeLinecap='round' />
      {/* Total line + amount marker */}
      <line x1={26} y1={43} x2={34} y2={43} stroke='var(--ink-3)' strokeWidth={1.25} strokeLinecap='round' />
      <circle cx={44} cy={43} r={2} fill='none' stroke='var(--ink-3)' strokeWidth={1.25} />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Styles + formatting helpers
// ---------------------------------------------------------------------------

const roomBodyStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 18,
};

// Honest pointer to where offline payments are actually recorded. This
// room's rows are Stripe-shaped `rent_payments` (no per-row rent_events cycle
// id / cycle outstanding), so the safe RecordPaymentModal — which records a
// dollar amount against a `rent_events` cycle — can't be wired per row here.
// It IS live on the Rent ledger and tenant pages, so we point there instead
// of claiming recording is unavailable.
const calloutStyle: React.CSSProperties = {
  minWidth: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  padding: 18,
  border: '1px solid var(--hairline)',
  borderRadius: 8,
  background: 'color-mix(in srgb, var(--panel-lift) 76%, transparent)',
};

const calloutHeaderRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 12,
  flexWrap: 'wrap',
};

const calloutTitleStyle: React.CSSProperties = {
  margin: 0,
  fontFamily: 'var(--font-serif-display), Georgia, serif',
  fontSize: 16,
  fontWeight: 700,
  lineHeight: 1.25,
  letterSpacing: '-0.01em',
  color: 'var(--ink)',
};

const calloutChipStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  padding: '3px 9px',
  border: '1px solid var(--hairline-faint)',
  borderRadius: 999,
  background: 'transparent',
  fontFamily: 'var(--font-mono-operator), ui-monospace, monospace',
  fontSize: 9.5,
  letterSpacing: '0.14em',
  textTransform: 'uppercase',
  color: 'var(--ink-4)',
  whiteSpace: 'nowrap',
};

const calloutBodyStyle: React.CSSProperties = {
  margin: 0,
  maxWidth: '46ch',
  fontFamily: 'var(--font-sans-operator), system-ui, sans-serif',
  fontSize: 13.5,
  lineHeight: 1.55,
  color: 'var(--ink-2)',
};

const calloutLinkStyle: React.CSSProperties = {
  alignSelf: 'flex-start',
  marginTop: 2,
  fontFamily: 'var(--font-sans-operator), system-ui, sans-serif',
  fontSize: 13,
  fontWeight: 500,
  letterSpacing: '0.005em',
  color: 'var(--accent-600)',
  textDecoration: 'none',
};

/** UTC month bucket — matches the keys built by `listRentPaymentsForProperty`. */
function monthKey(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
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
