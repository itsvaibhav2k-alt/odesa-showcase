import { Check } from 'lucide-react';
import { type StatusTone, statusColor } from '@/lib/today/status';

/**
 * Recent Checks / Quiet Watch table for the Today console.
 *
 * Makes a quiet portfolio feel *earned*: a short status table proving
 * what Odesa actually queried this load (00-BUILD-HUB §8.3, §3.2). The
 * framing is honest — these are the systems checked on this page load,
 * not a fabricated audit count.
 *
 * One component, two render modes via `variant`:
 * - `'full'` — **Recent Checks**, left column bottom. Roomier rows with
 *   a system name, a tone-colored status word, and a last-checked +
 *   detail line.
 * - `'condensed'` — **Quiet Watch**, right rail. Tighter rows with a
 *   small check glyph and inline status.
 *
 * PRESENTATIONAL: the page derives every value from data it already
 * fetched (kpis, urgent inbox count, next lease deadline, Stripe sync,
 * `checkedAt`) and passes a flat {@link CheckRow}[]. This component runs
 * no queries and owns no business thresholds — tone is decided upstream
 * through `statusColor` so a color means the same thing screen-wide.
 */

/** Render mode: full Recent Checks panel vs. condensed Quiet Watch rail. */
export type ChecksVariant = 'full' | 'condensed';

/**
 * One monitored system, already resolved by the page.
 *
 * `slug` keys the row and its testid (`today-check-row-{slug}`).
 * `status` is the short status word ("On track", "Quiet", "3 open").
 * `detail` is the supporting line ("7:04 AM", "1 waiting on vendor", or
 * `null` when there is nothing to add). `tone` drives the accent only.
 */
export interface CheckRow {
  slug: string;
  system: string;
  status: string;
  detail: string | null;
  tone: StatusTone;
}

export interface ChecksTableProps {
  /** full = Recent Checks (left column); condensed = Quiet Watch (rail). */
  variant: ChecksVariant;
  /** Systems Odesa queried this load, in display order. */
  rows: CheckRow[];
  /** Human last-checked stamp for the section subhead ("11m ago"). */
  checkedAt: string;
}

interface VariantConfig {
  readonly testid: string;
  readonly heading: string;
  readonly radius: string;
  readonly padding: string;
  readonly rowGap: string;
}

const VARIANTS: Readonly<Record<ChecksVariant, VariantConfig>> = {
  full: {
    testid: 'today-recent-checks',
    heading: 'Recent checks',
    radius: 'var(--radius-md-odesa)',
    padding: '20px 24px',
    rowGap: '0px',
  },
  condensed: {
    testid: 'today-quiet-watch',
    heading: 'Quiet watch',
    radius: 'var(--radius-lg-odesa)',
    padding: '20px',
    rowGap: '8px',
  },
};

export function ChecksTable({ variant, rows, checkedAt }: ChecksTableProps) {
  const config = VARIANTS[variant];

  return (
    <section
      data-testid={config.testid}
      style={{
        background: 'var(--paper-0)',
        border: '1px solid var(--ink-200)',
        borderRadius: config.radius,
        padding: config.padding,
      }}
    >
      <div
        className="flex items-baseline justify-between"
        style={{ gap: '12px', marginBottom: variant === 'full' ? '12px' : '14px' }}
      >
        <h3
          style={{
            fontWeight: 500,
            fontSize: '14px',
            color: 'var(--ink-900)',
            margin: 0,
          }}
        >
          {config.heading}
        </h3>
        <span
          className="meta-label"
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: '11px',
            color: 'var(--ink-500)',
            whiteSpace: 'nowrap',
          }}
        >
          Checked {checkedAt}
        </span>
      </div>

      <div
        role="list"
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: config.rowGap,
        }}
      >
        {rows.map((row, index) =>
          variant === 'full' ? (
            <FullRow key={row.slug} row={row} isFirst={index === 0} />
          ) : (
            <CondensedRow key={row.slug} row={row} />
          ),
        )}
      </div>
    </section>
  );
}

/** Recent Checks row: system · status · detail, thin top divider. */
function FullRow({ row, isFirst }: { row: CheckRow; isFirst: boolean }) {
  return (
    <div
      role="listitem"
      data-testid={`today-check-row-${row.slug}`}
      className="flex items-baseline justify-between"
      style={{
        gap: '12px',
        padding: '10px 0',
        borderTop: isFirst ? 'none' : '1px solid var(--ink-200)',
      }}
    >
      <span
        style={{
          fontSize: '13px',
          fontWeight: 500,
          color: 'var(--ink-700)',
          flexShrink: 0,
        }}
      >
        {row.system}
      </span>
      <span
        className="flex items-baseline"
        style={{ gap: '10px', minWidth: 0, justifyContent: 'flex-end', textAlign: 'right' }}
      >
        <span style={{ fontSize: '13px', fontWeight: 500, color: statusColor(row.tone) }}>
          {row.status}
        </span>
        {row.detail ? (
          <span
            className="truncate"
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: '11px',
              color: 'var(--ink-500)',
            }}
          >
            {row.detail}
          </span>
        ) : null}
      </span>
    </div>
  );
}

/** Quiet Watch row: small check glyph + system, inline status word. */
function CondensedRow({ row }: { row: CheckRow }) {
  const accent = statusColor(row.tone);

  return (
    <div
      role="listitem"
      data-testid={`today-check-row-${row.slug}`}
      className="flex items-center"
      style={{ gap: '8px' }}
    >
      <span
        aria-hidden="true"
        style={{ display: 'inline-flex', flexShrink: 0, color: accent }}
      >
        <Check size={13} strokeWidth={2.5} />
      </span>
      <span
        className="truncate"
        style={{ fontSize: '12px', color: 'var(--ink-700)', flex: 1, minWidth: 0 }}
      >
        {row.system}
      </span>
      <span
        style={{ fontSize: '12px', fontWeight: 500, color: accent, whiteSpace: 'nowrap' }}
      >
        {row.status}
      </span>
    </div>
  );
}
