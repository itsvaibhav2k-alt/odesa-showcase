'use client';

import Link from 'next/link';
import type { UnitGridCard } from '@/lib/properties/queries';

/**
 * A single unit card inside the property-detail grid.
 *
 * Design:
 * - paper-0 background, 1px ink-200 border, radius-md-odesa
 * - Hover lifts the border color to navy-300 (no shadow growth)
 * - Top row: unit label (data-lg) + status dot aligned right
 * - Middle: tenant name
 * - Footer: rent amount (right-aligned) + lease end meta (uppercase)
 * - Entire card is a Link to `/properties/[id]/units/[unitId]`
 */

export interface UnitCardProps {
  propertyId: string;
  card: UnitGridCard;
}

export function UnitCard({ propertyId, card }: UnitCardProps) {
  return (
    <Link
      href={`/properties/${propertyId}/units/${card.id}`}
      data-testid={`unit-card-${card.id}`}
      data-unit-status={card.status}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '14px',
        padding: '20px 22px',
        background: 'var(--paper-0)',
        border: '1px solid var(--ink-200)',
        borderRadius: 'var(--radius-md-odesa)',
        textDecoration: 'none',
        color: 'var(--ink-800)',
        minHeight: '148px',
        transition: 'border-color 180ms var(--ease-smooth)',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = 'var(--navy-300)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = 'var(--ink-200)';
      }}
    >
      <div className="flex items-start justify-between gap-3">
        <span
          data-testid={`unit-card-${card.id}-label`}
          className="tabular-nums"
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: '22px',
            fontWeight: 500,
            letterSpacing: '-0.01em',
            color: 'var(--ink-900)',
          }}
        >
          {card.label}
        </span>
        <StatusDot status={card.status} testId={`unit-card-${card.id}-status`} />
      </div>

      <div style={{ flex: 1 }}>
        <p
          data-testid={`unit-card-${card.id}-tenant`}
          style={{
            fontSize: '14px',
            color: card.tenantName ? 'var(--ink-800)' : 'var(--ink-400)',
            fontWeight: 500,
          }}
        >
          {card.tenantName ?? (card.status === 'pending' ? 'Lease pending' : 'Vacant')}
        </p>
      </div>

      <div className="flex items-baseline justify-between gap-3">
        <span
          data-testid={`unit-card-${card.id}-lease-end`}
          className="meta-label"
          style={{ color: 'var(--ink-500)', fontSize: '10px' }}
        >
          {card.leaseEndDate
            ? `Ends ${formatShortDate(card.leaseEndDate)}`
            : card.status === 'pending'
              ? 'Move-in being set up'
              : 'No active lease'}
        </span>
        {card.rentAmountCents != null ? (
          <span
            data-testid={`unit-card-${card.id}-rent`}
            className="tabular-nums"
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: '16px',
              fontWeight: 500,
              color: 'var(--ink-900)',
            }}
          >
            {formatMoneyCents(card.rentAmountCents)}
          </span>
        ) : (
          <span style={{ fontSize: '13px', color: 'var(--ink-400)' }}>—</span>
        )}
      </div>
    </Link>
  );
}

interface StatusDotProps {
  status: UnitGridCard['status'];
  testId: string;
}

function StatusDot({ status, testId }: StatusDotProps) {
  const { color, label } = statusMeta(status);
  return (
    <span
      data-testid={testId}
      data-status={status}
      aria-label={label}
      title={label}
      style={{
        display: 'inline-block',
        width: '10px',
        height: '10px',
        borderRadius: '999px',
        background: color,
        flexShrink: 0,
        marginTop: '8px',
      }}
    />
  );
}

function statusMeta(status: UnitGridCard['status']): { color: string; label: string } {
  switch (status) {
    case 'current':
      return { color: 'var(--success-600)', label: 'Current' };
    case 'ending_soon':
      return { color: 'var(--warning-600)', label: 'Lease ending soon' };
    case 'late':
      return { color: 'var(--error-600)', label: 'Rent late' };
    case 'pending':
      return { color: 'var(--navy-600)', label: 'Lease pending' };
    case 'vacant':
      return { color: 'var(--ink-400)', label: 'Vacant' };
  }
}

function formatShortDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const month = d.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' });
  const day = d.getUTCDate();
  return `${month.toLowerCase()} ${day}`;
}

function formatMoneyCents(cents: number): string {
  const dollars = Math.round(cents) / 100;
  return `$${Math.round(dollars).toLocaleString('en-US')}`;
}
