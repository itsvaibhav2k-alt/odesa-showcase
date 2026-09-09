/**
 * AgingRow — delinquency aging as a compact risk object for `/financials`.
 *
 * Server component. Focal headline (`$5,200 · 2 tenants` + oldest-bucket
 * age), one short mono status line keyed off which buckets hold money, one
 * proportional stacked bar (segments sized by cents share — zero buckets
 * contribute nothing), and a row of four bucket chips linking into the
 * pre-filtered rent ledger. Tone escalates with age: current is quiet
 * paper/ink, 1–7 days is warm gold, 8–30 days deeper amber, and 31+ days
 * is terracotta — deliberately the ONLY terracotta on the page.
 *
 * Honest by construction: buckets arrive from the pure `buildAgingBuckets`
 * fold (as-of-today balances, integer cents, distinct leases). Zero total
 * renders an honest "nothing outstanding" state. All amounts and counts
 * exist as literal text, never only as color or bar length.
 */

import Link from 'next/link';
import type { CSSProperties, ReactElement } from 'react';

import { formatMoneyCents } from '@/lib/financials/format';
import type { AgingBucket } from '@/lib/financials/trend';

export interface AgingRowProps {
  buckets: AgingBucket[];
}

/** Bucket id → segment/swatch tone. Terracotta ONLY on 31+. */
const BUCKET_COLOR: Record<AgingBucket['id'], string> = {
  current: 'var(--hairline-strong)',
  d1_7: 'var(--gold)',
  d8_30: 'var(--amber-ink)',
  d31_plus: 'var(--terracotta)',
};

const cardStyle: CSSProperties = {
  background: 'var(--panel-lift)',
  border: '1px solid var(--hairline)',
  borderRadius: 12,
  padding: '18px 20px',
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
};

const headlineRowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'baseline',
  gap: 10,
  flexWrap: 'wrap',
};

const headlineStyle: CSSProperties = {
  fontFamily: 'var(--font-mono-operator), ui-monospace, monospace',
  fontSize: '24px',
  fontWeight: 600,
  letterSpacing: '-0.01em',
  color: 'var(--ink)',
  fontVariantNumeric: 'tabular-nums',
};

const ageTagStyle: CSSProperties = {
  fontFamily: 'var(--font-mono-operator), ui-monospace, monospace',
  fontSize: '10.5px',
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: 'var(--ink-2)',
};

const statusStyle: CSSProperties = {
  fontFamily: 'var(--font-mono-operator), ui-monospace, monospace',
  fontSize: '11px',
  color: 'var(--ink-3)',
  marginTop: -6,
};

const barStyle: CSSProperties = {
  display: 'flex',
  width: '100%',
  height: 14,
  borderRadius: 999,
  overflow: 'hidden',
  background: 'var(--panel)',
  border: '1px solid var(--hairline-faint)',
};

const chipsRowStyle: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 8,
};

const chipBaseStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  textDecoration: 'none',
  borderRadius: 999,
  border: '1px solid var(--hairline)',
  fontFamily: 'var(--font-mono-operator), ui-monospace, monospace',
  fontVariantNumeric: 'tabular-nums',
  whiteSpace: 'nowrap',
};

const swatchStyle: CSSProperties = {
  width: 8,
  height: 8,
  borderRadius: 2,
  flexShrink: 0,
};

const emptyStyle: CSSProperties = {
  ...cardStyle,
  fontSize: '12.5px',
  color: 'var(--ink-3)',
};

/** Oldest → newest, for finding the most-aged bucket holding money. */
const AGE_ORDER: AgingBucket['id'][] = ['d31_plus', 'd8_30', 'd1_7', 'current'];

function statusLine(nonzeroIds: Set<AgingBucket['id']>): string {
  if (nonzeroIds.has('d31_plus')) {
    return 'Oldest balance is 31+ days late — needs direct follow-up.';
  }
  if (nonzeroIds.has('d8_30')) {
    return 'Oldest balance is 8–30 days late — follow up before it ages.';
  }
  if (nonzeroIds.has('d1_7')) {
    return 'Early overdue — no balances beyond 7 days.';
  }
  return 'Balances are current — nothing overdue.';
}

export function AgingRow({ buckets }: AgingRowProps): ReactElement {
  const totalCents = buckets.reduce((sum, bucket) => sum + bucket.cents, 0);

  if (totalCents <= 0) {
    return (
      <div style={emptyStyle} data-testid="aging-row-empty">
        Nothing outstanding — every balance is settled.
      </div>
    );
  }

  const nonzero = buckets.filter((bucket) => bucket.cents > 0);
  const nonzeroIds = new Set(nonzero.map((bucket) => bucket.id));
  const totalTenants = nonzero.reduce((sum, bucket) => sum + bucket.count, 0);
  const oldestId = AGE_ORDER.find((id) => nonzeroIds.has(id)) ?? 'current';
  const oldest = buckets.find((bucket) => bucket.id === oldestId);
  const ageTag =
    oldestId === 'current' ? 'not yet late' : `${oldest?.label ?? ''} late`;

  return (
    <div style={cardStyle} data-testid="aging-row">
      <div style={headlineRowStyle}>
        <span style={headlineStyle}>
          {formatMoneyCents(totalCents)} · {totalTenants} tenant{totalTenants === 1 ? '' : 's'}
        </span>
        <span style={ageTagStyle}>{ageTag}</span>
      </div>

      <p style={statusStyle}>{statusLine(nonzeroIds)}</p>

      <div style={barStyle} aria-hidden="true">
        {nonzero.map((bucket) => (
          <span
            key={bucket.id}
            style={{
              display: 'block',
              height: '100%',
              width: `${((bucket.cents / totalCents) * 100).toFixed(2)}%`,
              background: BUCKET_COLOR[bucket.id],
            }}
          />
        ))}
      </div>

      <div style={chipsRowStyle}>
        {buckets.map((bucket) => {
          const isZero = bucket.cents <= 0;
          return (
            <Link
              key={bucket.id}
              href="/rent?filter=outstanding"
              className="aging-cell"
              data-testid={`aging-bucket-${bucket.id}`}
              aria-label={`${bucket.label}: ${formatMoneyCents(bucket.cents)} across ${bucket.count} tenant${bucket.count === 1 ? '' : 's'} — open outstanding rent`}
              style={{
                ...chipBaseStyle,
                padding: isZero ? '3px 8px' : '5px 10px',
                fontSize: isZero ? '10.5px' : '11.5px',
                color: isZero ? 'var(--ink-4)' : 'var(--ink)',
                background: isZero ? 'transparent' : 'var(--panel-clean)',
                borderColor: isZero ? 'var(--hairline-faint)' : 'var(--hairline)',
              }}
            >
              <span
                aria-hidden="true"
                style={{
                  ...swatchStyle,
                  background: BUCKET_COLOR[bucket.id],
                  opacity: isZero ? 0.35 : 1,
                }}
              />
              <span style={{ letterSpacing: '0.06em', textTransform: 'uppercase', fontSize: '0.85em', color: isZero ? 'var(--ink-4)' : 'var(--ink-3)' }}>
                {bucket.label}
              </span>
              <span>
                {formatMoneyCents(bucket.cents)} · {bucket.count} tenant{bucket.count === 1 ? '' : 's'}
              </span>
            </Link>
          );
        })}
      </div>
      <AgingRowStyles />
    </div>
  );
}

function AgingRowStyles(): ReactElement {
  return (
    <style precedence="default" href="financials-aging-row">{`
      .aging-cell:hover { background: var(--panel-clean); }
      .aging-cell:focus-visible {
        outline: 2px solid var(--terracotta);
        outline-offset: 2px;
      }
    `}</style>
  );
}
