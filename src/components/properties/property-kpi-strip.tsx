import type { PropertyKpis } from '@/lib/properties/queries';

/**
 * Lightweight KPI strip for the property-detail header.
 *
 * A property-scoped analogue to the org-level `KpiStrip` on Today. The
 * Today strip is tightly coupled to `TodayKpis` / `TodayKpiDeltas`
 * shapes; rather than bend that API, we render a small, static,
 * dependency-free strip here. Same visual vocabulary (paper-0 card,
 * ink-200 border, tabular-num JetBrains Mono numerals, uppercase
 * meta-label above) so the Today and Properties surfaces feel like
 * siblings.
 */

export interface PropertyKpiStripProps {
  kpis: PropertyKpis;
}

export function PropertyKpiStrip({ kpis }: PropertyKpiStripProps) {
  return (
    <section
      data-testid="property-kpi-strip"
      aria-label="Property KPIs"
      className="grid gap-3 grid-cols-2 lg:grid-cols-4"
    >
      <Cell
        label="Units"
        value={`${kpis.unitCount}`}
        testId="property-kpi-units"
      />
      <Cell
        label="Occupancy"
        value={`${kpis.occupancyPct}%`}
        testId="property-kpi-occupancy"
      />
      <Cell
        label="MRR"
        value={formatMoneyCents(kpis.mrrCents)}
        testId="property-kpi-mrr"
      />
      <Cell
        label="Open WO"
        value={`${kpis.openWorkOrderCount}`}
        testId="property-kpi-open-wos"
      />
    </section>
  );
}

interface CellProps {
  label: string;
  value: string;
  testId: string;
}

function Cell({ label, value, testId }: CellProps) {
  return (
    <article
      data-testid={testId}
      style={{
        background: 'var(--paper-0)',
        border: '1px solid var(--ink-200)',
        borderRadius: 'var(--radius-md-odesa)',
        padding: '18px 20px',
        display: 'flex',
        flexDirection: 'column',
        gap: '6px',
        minHeight: '92px',
      }}
    >
      <p className="meta-label" data-testid={`${testId}-label`}>
        {label}
      </p>
      <p
        className="tabular-nums"
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

function formatMoneyCents(cents: number): string {
  const dollars = Math.round(cents) / 100;
  if (dollars >= 10_000) {
    const k = dollars / 1000;
    return `$${k.toFixed(1).replace(/\.0$/, '')}k`;
  }
  return `$${Math.round(dollars).toLocaleString('en-US')}`;
}
