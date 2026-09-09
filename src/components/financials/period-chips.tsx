/**
 * PeriodChips — the MTD / Last month / QTD / YTD selector on `/financials`.
 *
 * Server component: four plain `<Link>`s styled like the FilterBar pills
 * (`src/components/properties/list/filter-bar.tsx`). No client island —
 * a period change is a server refetch (`?period=`), so links compose with
 * force-dynamic + the route's loading.tsx skeleton for free. The active
 * chip carries `aria-current="page"`.
 */

import Link from 'next/link';
import type { CSSProperties } from 'react';

import type { PeriodKey } from '@/lib/financials/trend';

export interface PeriodChipsProps {
  active: PeriodKey;
}

const PERIOD_OPTIONS: ReadonlyArray<{ key: PeriodKey; label: string; href: string }> = [
  { key: 'mtd', label: 'MTD', href: '/financials' },
  { key: 'last', label: 'Last month', href: '/financials?period=last' },
  { key: 'qtd', label: 'QTD', href: '/financials?period=qtd' },
  { key: 'ytd', label: 'YTD', href: '/financials?period=ytd' },
];

const wrapStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 7,
  flexWrap: 'wrap',
};

const labelStyle: CSSProperties = {
  fontFamily: 'var(--font-mono-operator), ui-monospace, monospace',
  fontSize: '9.5px',
  fontWeight: 500,
  letterSpacing: '0.12em',
  textTransform: 'uppercase',
  color: 'var(--ink-3)',
  marginRight: 3,
};

const chipBaseStyle: CSSProperties = {
  fontFamily: 'var(--font-sans-operator), system-ui, sans-serif',
  fontSize: '12px',
  padding: '5px 12px',
  borderRadius: 20,
  border: '1px solid var(--hairline)',
  letterSpacing: '-0.003em',
  lineHeight: 1.4,
  whiteSpace: 'nowrap',
  textDecoration: 'none',
};

const chipActiveStyle: CSSProperties = {
  ...chipBaseStyle,
  background: 'var(--ink)',
  color: 'var(--panel-lift)',
  borderColor: 'var(--ink)',
};

const chipInactiveStyle: CSSProperties = {
  ...chipBaseStyle,
  background: 'transparent',
  color: 'var(--ink-2)',
};

export function PeriodChips({ active }: PeriodChipsProps) {
  return (
    <>
      <nav style={wrapStyle} data-testid="period-chips" aria-label="Reporting period">
        <span style={labelStyle} aria-hidden="true">
          Period
        </span>
        {PERIOD_OPTIONS.map((option) => {
          const isActive = option.key === active;
          return (
            <Link
              key={option.key}
              href={option.href}
              data-testid={`period-chip-${option.key}`}
              className="period-chip"
              style={isActive ? chipActiveStyle : chipInactiveStyle}
              {...(isActive ? { 'aria-current': 'page' as const } : {})}
            >
              {option.label}
            </Link>
          );
        })}
      </nav>
      <PeriodChipStyles />
    </>
  );
}

function PeriodChipStyles() {
  return (
    <style precedence="default" href="financials-period-chips">{`
      .period-chip:hover {
        border-color: var(--hairline-strong);
        color: var(--ink);
      }
      .period-chip[aria-current="page"]:hover {
        background: var(--ink);
        border-color: var(--ink);
        color: var(--panel-lift);
      }
      .period-chip:focus-visible {
        outline: 2px solid var(--terracotta);
        outline-offset: 2px;
      }
    `}</style>
  );
}
