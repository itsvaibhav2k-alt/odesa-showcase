'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { ChevronDown } from 'lucide-react';
import type {
  PropertyListRow,
  PropertySortKey,
} from '@/lib/properties/queries';

/**
 * Compact, editorial-density table for the `/properties` list view.
 *
 * Design:
 * - Hairline `ink-200` row dividers (no zebra striping).
 * - Column headers clickable to toggle the `sort` URL param.
 * - Active sort column shows a chevron in navy-700.
 * - Row click navigates to `/properties/[id]`.
 * - Occupancy cell renders a 100%-width bar behind the text colored
 *   per spec: success-600 >= 90, warning-600 70-90, error-600 < 70.
 * - MRR and unit counts are right-aligned, tabular-num.
 */

export interface PropertyTableProps {
  rows: PropertyListRow[];
  sort: PropertySortKey;
}

const SORT_KEYS: readonly PropertySortKey[] = ['name', 'units', 'occupancy', 'mrr'];

export function PropertyTable({ rows, sort }: PropertyTableProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const applySort = (next: PropertySortKey) => {
    const params = new URLSearchParams(searchParams?.toString() ?? '');
    if (next === 'name') {
      params.delete('sort');
    } else {
      params.set('sort', next);
    }
    const query = params.toString();
    router.push(`/properties${query ? `?${query}` : ''}`);
  };

  if (rows.length === 0) {
    return (
      <div
        data-testid="property-table-empty"
        style={{
          background: 'var(--paper-0)',
          border: '1px solid var(--ink-200)',
          borderRadius: 'var(--radius-md-odesa)',
          padding: '48px 32px',
          textAlign: 'center',
          color: 'var(--ink-500)',
          fontSize: '14px',
        }}
      >
        No properties yet. Add one from onboarding to get started.
      </div>
    );
  }

  return (
    <div
      data-testid="property-table"
      style={{
        background: 'var(--paper-0)',
        border: '1px solid var(--ink-200)',
        borderRadius: 'var(--radius-md-odesa)',
        overflow: 'hidden',
      }}
    >
      <table
        style={{
          width: '100%',
          borderCollapse: 'collapse',
          fontSize: '14px',
        }}
      >
        <thead>
          <tr style={{ background: 'var(--paper-50)' }}>
            <HeaderCell
              sortKey="name"
              active={sort}
              label="Property"
              onClick={applySort}
            />
            <HeaderCell
              sortKey="name"
              active={sort}
              label="Address"
              align="left"
              disabled
            />
            <HeaderCell
              sortKey="units"
              active={sort}
              label="Units"
              align="right"
              onClick={applySort}
            />
            <HeaderCell
              sortKey="occupancy"
              active={sort}
              label="Occupancy"
              align="right"
              onClick={applySort}
            />
            <HeaderCell
              sortKey="mrr"
              active={sort}
              label="MRR"
              align="right"
              onClick={applySort}
            />
            <th
              scope="col"
              style={{
                padding: '12px 20px',
                textAlign: 'right',
                fontSize: '11px',
                letterSpacing: '0.12em',
                textTransform: 'uppercase',
                fontWeight: 500,
                color: 'var(--ink-500)',
                borderBottom: '1px solid var(--ink-200)',
              }}
            >
              Issues
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, idx) => (
            <PropertyRow
              key={row.id}
              row={row}
              isFirst={idx === 0}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

interface HeaderCellProps {
  sortKey: PropertySortKey;
  active: PropertySortKey;
  label: string;
  align?: 'left' | 'right';
  onClick?: (key: PropertySortKey) => void;
  disabled?: boolean;
}

function HeaderCell({
  sortKey,
  active,
  label,
  align = 'left',
  onClick,
  disabled,
}: HeaderCellProps) {
  const isActive = SORT_KEYS.includes(sortKey) && active === sortKey && !disabled;
  const style: React.CSSProperties = {
    padding: '12px 20px',
    textAlign: align,
    fontSize: '11px',
    letterSpacing: '0.12em',
    textTransform: 'uppercase',
    fontWeight: 500,
    color: isActive ? 'var(--navy-700)' : 'var(--ink-500)',
    borderBottom: '1px solid var(--ink-200)',
    cursor: onClick && !disabled ? 'pointer' : 'default',
    userSelect: 'none',
  };

  const testId = `property-table-header-${sortKey === 'name' && label === 'Address' ? 'address' : sortKey}`;

  if (onClick && !disabled) {
    return (
      <th
        scope="col"
        style={style}
        data-testid={testId}
        data-active={isActive ? 'true' : 'false'}
        onClick={() => onClick(sortKey)}
      >
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px',
            justifyContent: align === 'right' ? 'flex-end' : 'flex-start',
          }}
        >
          {label}
          {isActive ? <ChevronDown size={14} aria-hidden /> : null}
        </span>
      </th>
    );
  }

  return (
    <th scope="col" style={style} data-testid={testId}>
      {label}
    </th>
  );
}

function PropertyRow({ row, isFirst }: { row: PropertyListRow; isFirst: boolean }) {
  const address = formatAddress(row);
  const occupancyColor = occupancyColorFor(row.occupancyPct);

  return (
    <tr
      data-testid={`property-row-${row.id}`}
      style={{
        borderTop: isFirst ? 'none' : '1px solid var(--ink-200)',
        transition: 'background-color 180ms var(--ease-smooth)',
      }}
    >
      <td style={cellStyle({ fontWeight: 600, color: 'var(--navy-700)' })}>
        <Link
          href={`/properties/${row.id}`}
          data-testid={`property-row-${row.id}-link`}
          style={{
            color: 'var(--navy-700)',
            fontWeight: 600,
            textDecoration: 'none',
            display: 'block',
          }}
        >
          {row.name}
        </Link>
      </td>
      <td style={cellStyle({ color: 'var(--ink-500)' })}>
        <Link
          href={`/properties/${row.id}`}
          style={{ color: 'var(--ink-500)', textDecoration: 'none', display: 'block' }}
        >
          {address}
        </Link>
      </td>
      <td style={cellStyle({ textAlign: 'right', fontFamily: 'var(--font-mono)' })}>
        <Link
          href={`/properties/${row.id}`}
          style={{ color: 'var(--ink-800)', textDecoration: 'none', display: 'block' }}
          className="tabular-nums"
          data-testid={`property-row-${row.id}-units`}
        >
          {row.unitCount}
        </Link>
      </td>
      <td
        style={{
          ...cellStyle({ textAlign: 'right' }),
          position: 'relative',
        }}
        data-testid={`property-row-${row.id}-occupancy`}
        data-occupancy-pct={row.occupancyPct}
      >
        <Link
          href={`/properties/${row.id}`}
          style={{
            position: 'relative',
            display: 'block',
            textDecoration: 'none',
            color: 'var(--ink-800)',
          }}
        >
          <span
            aria-hidden
            style={{
              position: 'absolute',
              inset: 0,
              background: 'var(--paper-200)',
              borderRadius: '3px',
              opacity: 0.4,
            }}
          />
          <span
            aria-hidden
            data-testid={`property-row-${row.id}-occupancy-bar`}
            style={{
              position: 'absolute',
              left: 0,
              top: 0,
              bottom: 0,
              width: `${Math.max(0, Math.min(100, row.occupancyPct))}%`,
              background: occupancyColor,
              opacity: 0.16,
              borderRadius: '3px',
              transition: 'width 200ms var(--ease-smooth)',
            }}
          />
          <span
            className="tabular-nums"
            style={{
              position: 'relative',
              color: occupancyColor,
              fontFamily: 'var(--font-mono)',
              fontWeight: 500,
            }}
          >
            {row.occupancyPct}%
          </span>
        </Link>
      </td>
      <td style={cellStyle({ textAlign: 'right' })}>
        <Link
          href={`/properties/${row.id}`}
          style={{ color: 'var(--ink-900)', textDecoration: 'none', display: 'block' }}
          data-testid={`property-row-${row.id}-mrr`}
          className="tabular-nums"
        >
          {formatMoneyCents(row.mrrCents)}
        </Link>
      </td>
      <td style={cellStyle({ textAlign: 'right' })}>
        <Link
          href={`/properties/${row.id}`}
          style={{ textDecoration: 'none', display: 'block' }}
        >
          {row.openWorkOrderCount > 0 ? (
            <span
              data-testid={`property-row-${row.id}-issues`}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                padding: '2px 10px',
                borderRadius: '999px',
                fontSize: '12px',
                fontWeight: 500,
                background: 'var(--warning-600)',
                color: 'var(--paper-0)',
                letterSpacing: '0.02em',
              }}
            >
              {row.openWorkOrderCount}
            </span>
          ) : (
            <span
              data-testid={`property-row-${row.id}-issues`}
              style={{ color: 'var(--ink-400)', fontSize: '12px' }}
            >
              —
            </span>
          )}
        </Link>
      </td>
    </tr>
  );
}

function cellStyle(overrides: React.CSSProperties): React.CSSProperties {
  return {
    padding: '14px 20px',
    verticalAlign: 'middle',
    ...overrides,
  };
}

function formatAddress(row: PropertyListRow): string {
  const parts = [row.addressStreet, row.addressCity, row.addressState]
    .filter((p): p is string => !!p && p.trim().length > 0);
  return parts.length > 0 ? parts.join(', ') : 'No address';
}

function occupancyColorFor(pct: number): string {
  if (pct >= 90) return 'var(--success-600)';
  if (pct >= 70) return 'var(--warning-600)';
  return 'var(--error-600)';
}

function formatMoneyCents(cents: number): string {
  const dollars = Math.round(cents) / 100;
  if (dollars >= 10_000) {
    const k = dollars / 1000;
    return `$${k.toFixed(1).replace(/\.0$/, '')}k`;
  }
  return `$${Math.round(dollars).toLocaleString('en-US')}`;
}
