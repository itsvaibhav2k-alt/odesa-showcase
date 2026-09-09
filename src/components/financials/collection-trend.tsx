/**
 * CollectionTrend — the monthly collection columns on `/financials`.
 *
 * Server component. Answers: when did the gap open, and how big is it
 * vs history? One stacked column per month from a zero baseline:
 * collected = solid green fill, outstanding = terracotta cap on top —
 * the current month's hole is literally visible. A faint hairline
 * outline is drawn to billed height ONLY when billed differs from
 * collected + outstanding, keeping any waived remainder honest.
 *
 * No rate line: the collection rate is a mono badge rail under the
 * month labels (`100%`, `74.7%`, `—` when nothing was billed). Values
 * are direct-labeled above each column; the current month also labels
 * its collected amount and anchors the open-gap chip at the terracotta
 * cap's height.
 *
 * Every month column is a `<Link>` into that month's rent ledger
 * (`/rent?cycle=YYYY-MM`) — receipts-first, no decorative bars.
 *
 * Honest-history invariant: the series arrives already truncated to the
 * org's first observed rent event (see `buildMonthlySeries`) — an empty
 * series renders an honest "no history" line, never fabricated months.
 */

import Link from 'next/link';
import type { CSSProperties, ReactElement } from 'react';

import { currentMonthGap, monthRatePct, niceAxis } from '@/lib/financials/chart';
import { formatMoneyCents, formatMoneyCentsShort, formatPct } from '@/lib/financials/format';
import type { MonthlyRentPoint } from '@/lib/financials/trend';

export interface CollectionTrendProps {
  series: MonthlyRentPoint[];
}

const PLOT_HEIGHT_PX = 260;
const Y_GUTTER_PX = 48;
const COLUMN_MAX_WIDTH_PX = 60;
/** Green fill must be at least this tall to hold the "collected" label inside. */
const INSIDE_LABEL_MIN_PX = 48;

const MONO_FONT = 'var(--font-mono-operator), ui-monospace, monospace';

const cardStyle: CSSProperties = {
  background: 'var(--panel-lift)',
  border: '1px solid var(--hairline)',
  borderRadius: 12,
  padding: '18px 20px',
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
};

const monoLabelStyle: CSSProperties = {
  fontFamily: MONO_FONT,
  fontSize: '10px',
  letterSpacing: '0.04em',
  color: 'var(--ink-3)',
  whiteSpace: 'nowrap',
};

const monthLinkStyle: CSSProperties = {
  flex: 1,
  minWidth: 0,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'stretch',
  gap: 0,
  textDecoration: 'none',
  borderRadius: 8,
};

const barRegionStyle: CSSProperties = {
  height: PLOT_HEIGHT_PX,
  display: 'flex',
  alignItems: 'flex-end',
  justifyContent: 'center',
  padding: '0 8px',
  // The shared bottom hairline is the zero baseline.
  borderBottom: '1px solid var(--hairline-strong)',
};

const columnStyle: CSSProperties = {
  position: 'relative',
  width: '100%',
  maxWidth: COLUMN_MAX_WIDTH_PX,
  height: '100%',
};

const segmentBaseStyle: CSSProperties = {
  position: 'absolute',
  left: 0,
  right: 0,
};

const emptyStyle: CSSProperties = {
  ...cardStyle,
  fontSize: '12.5px',
  color: 'var(--ink-3)',
};

/** Value (0–100) as a % of the axis; a real zero stays zero. */
function axisPct(cents: number, axisMaxCents: number): number {
  if (axisMaxCents <= 0 || cents <= 0) return 0;
  return (cents / axisMaxCents) * 100;
}

/** Y offset (px from plot top) for a dollar tick on the zero-baseline axis. */
function tickTopPx(tick: number, axisMaxCents: number): number {
  return (1 - tick / axisMaxCents) * PLOT_HEIGHT_PX;
}

function monthAriaLabel(point: MonthlyRentPoint, rate: number | null): string {
  const rateText = rate === null ? '' : ` (${formatPct(rate)} collected)`;
  const outstandingText =
    point.outstandingCents > 0
      ? `, ${formatMoneyCents(point.outstandingCents)} outstanding`
      : '';
  return `${point.label}: ${formatMoneyCents(point.collectedCents)} collected of ${formatMoneyCents(point.billedCents)} billed${rateText}${outstandingText} — open that month's rent ledger`;
}

function rateBadgeStyle(isCurrent: boolean): CSSProperties {
  return {
    display: 'inline-block',
    fontFamily: MONO_FONT,
    fontSize: '10px',
    letterSpacing: '0.04em',
    whiteSpace: 'nowrap',
    padding: '1px 6px',
    borderRadius: 5,
    ...(isCurrent
      ? {
          color: 'var(--ink)',
          background: 'var(--panel-clean)',
          border: '1px solid var(--hairline-strong)',
        }
      : { color: 'var(--ink-3)', border: '1px solid transparent' }),
  };
}

export function CollectionTrend({ series }: CollectionTrendProps): ReactElement {
  if (series.length === 0) {
    return (
      <div style={emptyStyle} data-testid="collection-trend-empty">
        No rent history yet — the trend starts with the first billed cycle.
      </div>
    );
  }

  const n = series.length;
  const currentIndex = n - 1;
  const maxCents = Math.max(
    ...series.map((p) => Math.max(p.billedCents, p.collectedCents + p.outstandingCents)),
  );
  const { axisMaxCents, tickCents } = niceAxis(maxCents);
  const rates = series.map(monthRatePct);
  const gap = currentMonthGap(series);

  const last = series[currentIndex];
  // Gap chip anchors at the vertical center of the terracotta cap.
  const capCenterPct = axisPct(last.collectedCents + last.outstandingCents / 2, axisMaxCents);
  const lastBandCenterPct = ((n - 0.5) / n) * 100;
  // ponytail: chip sits right of the last column up to 6 months, flips to
  // the left side beyond that so it never overflows the plot at 12 months.
  const chipOnRight = n <= 6;

  const accrual = n === 12 ? 'rolling' : 'accrues monthly';
  const historyNote = `${n} month${n === 1 ? '' : 's'} · ${accrual}`;

  return (
    <div style={cardStyle} data-testid="collection-trend">
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <span style={{ ...monoLabelStyle, color: 'var(--ink-4)' }}>{historyNote}</span>
      </div>

      <div style={{ display: 'flex', alignItems: 'flex-start' }}>
        {/* Dollar axis gutter */}
        <div
          style={{
            position: 'relative',
            width: Y_GUTTER_PX,
            flexShrink: 0,
            height: PLOT_HEIGHT_PX,
          }}
        >
          {tickCents.map((tick) => (
            <span
              key={tick}
              data-testid="collection-trend-ytick"
              style={{
                ...monoLabelStyle,
                position: 'absolute',
                right: 8,
                top: tickTopPx(tick, axisMaxCents),
                transform: 'translateY(-50%)',
                color: 'var(--ink-4)',
              }}
            >
              {formatMoneyCentsShort(tick)}
            </span>
          ))}
        </div>

        {/* Plot area */}
        <div style={{ position: 'relative', flex: 1, minWidth: 0 }}>
          {/* Gridlines (zero baseline is the bar region's borderBottom). */}
          {tickCents
            .filter((tick) => tick > 0)
            .map((tick) => (
              <div
                key={tick}
                aria-hidden="true"
                style={{
                  position: 'absolute',
                  left: 0,
                  right: 0,
                  top: tickTopPx(tick, axisMaxCents),
                  borderTop: '1px solid var(--hairline-faint)',
                  pointerEvents: 'none',
                }}
              />
            ))}

          {/* Month columns — one stacked column per month. */}
          <div style={{ display: 'flex', gap: 0 }}>
            {series.map((point, i) => {
              const stackCents = point.collectedCents + point.outstandingCents;
              const topPct = axisPct(Math.max(point.billedCents, stackCents), axisMaxCents);
              const collectedPct = axisPct(point.collectedCents, axisMaxCents);
              const isCurrent = i === currentIndex;
              const collectedInside =
                isCurrent && (collectedPct / 100) * PLOT_HEIGHT_PX >= INSIDE_LABEL_MIN_PX;
              return (
                <Link
                  key={point.cycleMonth}
                  href={`/rent?cycle=${point.cycleMonth.slice(0, 7)}`}
                  style={monthLinkStyle}
                  className="trend-month"
                  data-testid="collection-trend-month"
                  aria-label={monthAriaLabel(point, rates[i])}
                >
                  <span style={barRegionStyle} aria-hidden="true">
                    <span style={columnStyle}>
                      {/* Honest billed outline — only when billed differs from the stack. */}
                      {point.billedCents !== stackCents && (
                        <span
                          style={{
                            ...segmentBaseStyle,
                            bottom: 0,
                            height: `${axisPct(point.billedCents, axisMaxCents).toFixed(2)}%`,
                            border: '1px solid var(--hairline-strong)',
                            borderBottom: 'none',
                            borderRadius: '4px 4px 0 0',
                            background: 'transparent',
                          }}
                        />
                      )}
                      {point.collectedCents > 0 && (
                        <span
                          style={{
                            ...segmentBaseStyle,
                            bottom: 0,
                            height: `${collectedPct.toFixed(2)}%`,
                            background: 'var(--green)',
                            borderRadius:
                              point.outstandingCents > 0 ? 0 : '4px 4px 0 0',
                          }}
                        />
                      )}
                      {point.outstandingCents > 0 && (
                        <span
                          style={{
                            ...segmentBaseStyle,
                            bottom: `${collectedPct.toFixed(2)}%`,
                            height: `${axisPct(point.outstandingCents, axisMaxCents).toFixed(2)}%`,
                            background: 'var(--terracotta)',
                            borderRadius: '4px 4px 0 0',
                          }}
                        />
                      )}
                      {/* Direct labels above the column top. */}
                      <span
                        style={{
                          position: 'absolute',
                          bottom: `calc(${topPct.toFixed(2)}% + 6px)`,
                          left: '50%',
                          transform: 'translateX(-50%)',
                          display: 'flex',
                          flexDirection: 'column',
                          alignItems: 'center',
                          gap: 2,
                        }}
                      >
                        {isCurrent && !collectedInside && (
                          <span
                            style={{
                              ...monoLabelStyle,
                              fontSize: '9.5px',
                              color: 'var(--green-ink)',
                            }}
                          >
                            {formatMoneyCentsShort(point.collectedCents)} collected
                          </span>
                        )}
                        <span style={{ ...monoLabelStyle, color: 'var(--ink-2)' }}>
                          {formatMoneyCentsShort(point.billedCents)}
                        </span>
                      </span>
                      {/* Current month: collected amount inside the green fill. */}
                      {collectedInside && (
                        <span
                          style={{
                            position: 'absolute',
                            left: 0,
                            right: 0,
                            bottom: `calc(${collectedPct.toFixed(2)}% - 34px)`,
                            display: 'flex',
                            flexDirection: 'column',
                            alignItems: 'center',
                            fontFamily: MONO_FONT,
                            fontSize: '9.5px',
                            letterSpacing: '0.03em',
                            lineHeight: 1.35,
                            color: 'var(--panel-clean)',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          <span>{formatMoneyCentsShort(point.collectedCents)}</span>
                          <span>collected</span>
                        </span>
                      )}
                    </span>
                  </span>
                  <span
                    style={{ ...monoLabelStyle, textAlign: 'center', padding: '6px 2px 2px' }}
                    aria-hidden="true"
                  >
                    {point.label}
                  </span>
                </Link>
              );
            })}
          </div>

          {/* Rate rail — one mono badge per month, under the month labels.
              Rates already live in each month link's aria-label. */}
          <div
            style={{ display: 'flex', gap: 0 }}
            data-testid="collection-trend-rate"
            aria-hidden="true"
          >
            {series.map((point, i) => (
              <span
                key={point.cycleMonth}
                style={{ flex: 1, minWidth: 0, textAlign: 'center', paddingTop: 2 }}
              >
                <span style={rateBadgeStyle(i === currentIndex)}>
                  {rates[i] === null ? '—' : formatPct(rates[i])}
                </span>
              </span>
            ))}
          </div>

          {/* Gap chip — anchored at the terracotta cap's height, beside the
              last column (clicks fall through to the month link). */}
          {gap !== null && (
            <div
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                height: PLOT_HEIGHT_PX,
                pointerEvents: 'none',
              }}
            >
              <div
                data-testid="collection-trend-gap"
                style={{
                  position: 'absolute',
                  left: chipOnRight
                    ? `calc(${lastBandCenterPct.toFixed(2)}% + ${COLUMN_MAX_WIDTH_PX / 2 + 8}px)`
                    : `calc(${lastBandCenterPct.toFixed(2)}% - ${COLUMN_MAX_WIDTH_PX / 2 + 8}px)`,
                  bottom: `${capCenterPct.toFixed(2)}%`,
                  transform: chipOnRight ? 'translateY(50%)' : 'translate(-100%, 50%)',
                  fontFamily: MONO_FONT,
                  fontSize: '10px',
                  letterSpacing: '0.04em',
                  whiteSpace: 'nowrap',
                  color: 'var(--clay-ink)',
                  background: 'var(--clay-bg)',
                  border: '1px solid var(--clay-border)',
                  borderRadius: 6,
                  padding: '3px 8px',
                }}
              >
                {`−${formatMoneyCentsShort(gap.outstandingCents)} open`}
              </div>
            </div>
          )}
        </div>
      </div>
      <CollectionTrendStyles />
    </div>
  );
}

function CollectionTrendStyles(): ReactElement {
  return (
    <style precedence="default" href="financials-collection-trend">{`
      .trend-month:hover { background: var(--panel-clean); }
      .trend-month:focus-visible {
        outline: 2px solid var(--terracotta);
        outline-offset: 2px;
      }
    `}</style>
  );
}
