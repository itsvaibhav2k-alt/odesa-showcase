/**
 * CollectionPace — the flagship graph moment on `/financials`.
 *
 * Server component, two columns. Left: a cumulative billed-vs-collected
 * area chart over the REAL monthly cycles (prefix sums via
 * `buildCumulativePace`) — soft green collected mass rising under a
 * faint billed line, with a terracotta band where the gap is open in
 * the final segment. Monthly grain only: visible month anchor dots and
 * month-tick links into each cycle's rent ledger, never a daily curve.
 *
 * Right: the portfolio status ring (`buildRentCoverageSegments`) —
 * current / late / vacant unit STATUS from summary counts. It is NOT
 * payment-ledger derived, so ring copy never says "collected".
 *
 * Every plotted dollar and count also exists as visible text or an
 * aria-label; both SVGs are `role="img"` with full narration.
 */

import Link from 'next/link';
import type { CSSProperties, ReactElement } from 'react';

import {
  buildCumulativePace,
  buildRentCoverageSegments,
  monthRatePct,
  niceAxis,
} from '@/lib/financials/chart';
import { formatMoneyCents, formatMoneyCentsShort, formatPct } from '@/lib/financials/format';
import type { MonthlyRentPoint } from '@/lib/financials/trend';

export interface CollectionPaceProps {
  series: MonthlyRentPoint[];
  unitCount: number;
  occupiedUnitCount: number;
  lateLeaseCount: number;
}

const PLOT_HEIGHT_PX = 300;
const Y_GUTTER_PX = 48;
/** Plot-box percent coordinates; the right margin holds endpoint labels. */
const PLOT_LEFT = 2;
const PLOT_RIGHT = 82;

const MONO_FONT = 'var(--font-mono-operator), ui-monospace, monospace';
const SERIF_FONT = 'var(--font-serif-display), Georgia, serif';

const MONTHS_FULL = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
] as const;

/** Ring geometry: r ≈ 52 in a 120-unit viewBox, 14-unit stroke. */
const RING_R = 52;
const RING_C = 2 * Math.PI * RING_R;
const RING_STROKE = 14;

const RING_COLORS: Record<'current' | 'late' | 'vacant', string> = {
  current: 'var(--green)',
  late: 'var(--gold)',
  vacant: 'var(--paper-300)',
};

const cardStyle: CSSProperties = {
  background: 'var(--panel-lift)',
  border: '1px solid var(--hairline)',
  borderRadius: 12,
  padding: '20px 24px',
  display: 'flex',
  flexDirection: 'column',
  gap: 16,
};

const monoLabelStyle: CSSProperties = {
  fontFamily: MONO_FONT,
  fontSize: '10px',
  letterSpacing: '0.04em',
  color: 'var(--ink-3)',
  whiteSpace: 'nowrap',
};

const endpointLabelStyle: CSSProperties = {
  position: 'absolute',
  fontFamily: MONO_FONT,
  fontSize: '10.5px',
  letterSpacing: '0.03em',
  whiteSpace: 'nowrap',
  pointerEvents: 'none',
  lineHeight: 1.2,
};

const legendRowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  fontSize: '12.5px',
  color: 'var(--ink-2)',
};

interface XY {
  x: number;
  y: number;
}

function fmt(value: number): string {
  return value.toFixed(2);
}

/**
 * Straight segments between month points. Deliberately NOT a bezier:
 * only monthly data exists, and intra-month curvature would fabricate
 * granularity the ledger does not have.
 */
function curveCmds(pts: XY[]): string {
  const cmds: string[] = [];
  for (let i = 1; i < pts.length; i++) {
    cmds.push(`L ${fmt(pts[i].x)} ${fmt(pts[i].y)}`);
  }
  return cmds.join(' ');
}

function lineD(pts: XY[]): string {
  if (pts.length === 0) return '';
  return `M ${fmt(pts[0].x)} ${fmt(pts[0].y)} ${curveCmds(pts)}`.trim();
}

/** Close the line down to the zero baseline (y=100 in plot coords). */
function areaD(pts: XY[]): string {
  if (pts.length === 0) return '';
  const first = pts[0];
  const last = pts[pts.length - 1];
  return `${lineD(pts)} L ${fmt(last.x)} 100 L ${fmt(first.x)} 100 Z`;
}

/** Closed band between the top (billed) and bottom (collected) curves. */
function bandD(top: XY[], bottom: XY[]): string {
  if (top.length < 2 || top.length !== bottom.length) return '';
  const back = [...bottom].reverse();
  return `${lineD(top)} L ${fmt(back[0].x)} ${fmt(back[0].y)} ${curveCmds(back)} Z`;
}

/** 'July' from '2026-07-01'; falls back to the raw string when malformed. */
function fullMonthName(cycleMonth: string): string {
  const month = Number(cycleMonth.slice(5, 7));
  return MONTHS_FULL[month - 1] ?? cycleMonth;
}

export function CollectionPace({
  series,
  unitCount,
  occupiedUnitCount,
  lateLeaseCount,
}: CollectionPaceProps): ReactElement | null {
  if (series.length === 0) return null;

  const pace = buildCumulativePace(series);
  const segments = buildRentCoverageSegments({ unitCount, occupiedUnitCount, lateLeaseCount });
  const n = pace.length;
  const last = pace[n - 1];
  const cyclesText = `${n} cycle${n === 1 ? '' : 's'}`;

  const { axisMaxCents, tickCents } = niceAxis(
    Math.max(last.cumBilledCents, last.cumCollectedCents),
  );
  const xAt = (i: number): number =>
    n <= 1 ? (PLOT_LEFT + PLOT_RIGHT) / 2 : PLOT_LEFT + (i / (n - 1)) * (PLOT_RIGHT - PLOT_LEFT);
  const yAt = (cents: number): number =>
    100 - (Math.min(Math.max(cents, 0), axisMaxCents) / axisMaxCents) * 100;

  const billedPts = pace.map((p, i) => ({ x: xAt(i), y: yAt(p.cumBilledCents) }));
  const collectedPts = pace.map((p, i) => ({ x: xAt(i), y: yAt(p.cumCollectedCents) }));

  // Trailing run of months where the cumulative gap is open; the band is
  // anchored one point earlier so it grows out of the last settled month.
  let gapStart = n;
  for (let i = n - 1; i >= 0 && pace[i].gapCents > 0; i--) gapStart = i;
  const hasGap = last.gapCents > 0;
  const bandFrom = Math.max(0, gapStart - 1);

  // Lead with the CURRENT month's own rate — the cumulative denominator
  // would understate the miss (e.g. read $5.2k/$61.6k as ~8% when July
  // itself is 25% uncollected).
  const lastMonth = series[series.length - 1];
  const lastRate = monthRatePct(lastMonth);
  const thesis =
    hasGap && lastMonth.outstandingCents > 0 && lastRate !== null
      ? `${fullMonthName(lastMonth.cycleMonth)} sits at ${formatPct(lastRate)} collected — ` +
        `${formatMoneyCentsShort(lastMonth.outstandingCents)} of its ` +
        `${formatMoneyCentsShort(lastMonth.billedCents)} billed is still open.`
      : hasGap
        ? `${formatMoneyCentsShort(last.gapCents)} of ` +
          `${formatMoneyCentsShort(last.cumBilledCents)} billed across ${cyclesText} is still open ` +
          `from an earlier cycle.`
        : `Every dollar billed across ${cyclesText} is in — ` +
          `${formatMoneyCentsShort(last.cumCollectedCents)} collected of ` +
          `${formatMoneyCentsShort(last.cumBilledCents)} billed.`;

  const chartNarration =
    'Cumulative rent pace by month. ' +
    pace
      .map((p) => {
        const gapText = p.gapCents > 0 ? `, ${formatMoneyCents(p.gapCents)} gap open` : '';
        return (
          `${fullMonthName(p.cycleMonth)}: ${formatMoneyCents(p.cumBilledCents)} billed to date, ` +
          `${formatMoneyCents(p.cumCollectedCents)} collected to date${gapText}`
        );
      })
      .join('. ') +
    '.';

  const endX = xAt(n - 1);
  const billedEndY = billedPts[n - 1].y;
  const collectedEndY = collectedPts[n - 1].y;

  return (
    <section style={cardStyle} data-testid="collection-pace">
      <header style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <h2
          style={{
            fontFamily: SERIF_FONT,
            fontSize: '20px',
            fontWeight: 500,
            color: 'var(--ink)',
            margin: 0,
          }}
        >
          Collection pace
        </h2>
        <p style={{ fontSize: '13px', color: 'var(--ink-2)', margin: 0, lineHeight: 1.5 }}>
          {thesis}
        </p>
      </header>

      <div className="pace-grid">
        {/* ——— Left: cumulative area chart ——— */}
        <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
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
                  data-testid="collection-pace-ytick"
                  style={{
                    ...monoLabelStyle,
                    position: 'absolute',
                    right: 8,
                    top: `${yAt(tick)}%`,
                    transform: 'translateY(-50%)',
                    color: 'var(--ink-4)',
                  }}
                >
                  {formatMoneyCentsShort(tick)}
                </span>
              ))}
            </div>

            {/* Plot box */}
            <div
              style={{
                position: 'relative',
                flex: 1,
                minWidth: 0,
                height: PLOT_HEIGHT_PX,
                borderBottom: '1px solid var(--hairline-strong)',
              }}
            >
              {/* Gridlines (zero baseline is the borderBottom). */}
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
                      top: `${yAt(tick)}%`,
                      borderTop: '1px solid var(--hairline-faint)',
                      pointerEvents: 'none',
                    }}
                  />
                ))}

              <svg
                viewBox="0 0 100 100"
                preserveAspectRatio="none"
                role="img"
                aria-label={chartNarration}
                style={{
                  position: 'absolute',
                  inset: 0,
                  width: '100%',
                  height: '100%',
                  overflow: 'visible',
                }}
              >
                {/* Collected mass */}
                <path d={areaD(collectedPts)} fill="var(--green)" fillOpacity={0.16} />
                {/* Open-gap band between billed and collected, final segment only */}
                {hasGap && n >= 2 && (
                  <path
                    d={bandD(billedPts.slice(bandFrom), collectedPts.slice(bandFrom))}
                    fill="var(--terracotta)"
                    fillOpacity={0.18}
                  />
                )}
                {/* Faint billed line above the mass */}
                <path
                  d={lineD(billedPts)}
                  fill="none"
                  stroke="var(--ink-4)"
                  strokeWidth={1.25}
                  vectorEffect="non-scaling-stroke"
                  strokeLinecap="round"
                />
                {/* Collected pace line */}
                <path
                  d={lineD(collectedPts)}
                  fill="none"
                  stroke="var(--green-ink)"
                  strokeWidth={2}
                  vectorEffect="non-scaling-stroke"
                  strokeLinecap="round"
                />
              </svg>

              {/* Month anchor dots — HTML so they stay round under
                  preserveAspectRatio='none'. */}
              {billedPts.map((p, i) => (
                <div
                  key={`billed-dot-${pace[i].cycleMonth}`}
                  aria-hidden="true"
                  style={{
                    position: 'absolute',
                    left: `${p.x}%`,
                    top: `${p.y}%`,
                    width: 6,
                    height: 6,
                    transform: 'translate(-50%, -50%)',
                    borderRadius: '50%',
                    background: 'var(--panel-lift)',
                    border: '1.5px solid var(--hairline-strong)',
                    boxSizing: 'border-box',
                    pointerEvents: 'none',
                  }}
                />
              ))}
              {collectedPts.map((p, i) => (
                <div
                  key={`collected-dot-${pace[i].cycleMonth}`}
                  aria-hidden="true"
                  style={{
                    position: 'absolute',
                    left: `${p.x}%`,
                    top: `${p.y}%`,
                    width: 9,
                    height: 9,
                    transform: 'translate(-50%, -50%)',
                    borderRadius: '50%',
                    background: 'var(--panel-clean)',
                    border: '2px solid var(--green-ink)',
                    boxSizing: 'border-box',
                    pointerEvents: 'none',
                    zIndex: 2,
                  }}
                />
              ))}

              {/* Endpoint direct labels */}
              <span
                style={{
                  ...endpointLabelStyle,
                  left: `${endX}%`,
                  top: `${billedEndY}%`,
                  transform: 'translate(10px, -110%)',
                  color: 'var(--ink-2)',
                }}
              >
                {formatMoneyCentsShort(last.cumBilledCents)} billed
              </span>
              <span
                style={{
                  ...endpointLabelStyle,
                  left: `${endX}%`,
                  top: `${collectedEndY}%`,
                  transform: 'translate(10px, 10%)',
                  color: 'var(--green-ink)',
                  fontWeight: 600,
                }}
              >
                {formatMoneyCentsShort(last.cumCollectedCents)} collected
              </span>
              {hasGap && (
                <span
                  style={{
                    ...endpointLabelStyle,
                    left: `${endX}%`,
                    top: `${(billedEndY + collectedEndY) / 2}%`,
                    transform: 'translate(10px, -50%)',
                    color: 'var(--clay-ink)',
                    background: 'var(--clay-bg)',
                    border: '1px solid var(--clay-border)',
                    borderRadius: 6,
                    padding: '2px 7px',
                  }}
                >
                  {formatMoneyCentsShort(last.gapCents)} gap
                </span>
              )}
            </div>
          </div>

          {/* Month tick links, aligned under their anchors. */}
          <div
            style={{
              position: 'relative',
              height: 26,
              marginLeft: Y_GUTTER_PX,
            }}
          >
            {pace.map((p, i) => (
              <Link
                key={p.cycleMonth}
                href={`/rent?cycle=${p.cycleMonth.slice(0, 7)}`}
                className="pace-month"
                data-testid="collection-pace-month"
                aria-label={
                  `${fullMonthName(p.cycleMonth)}: ` +
                  `${formatMoneyCents(p.cumCollectedCents)} collected of ` +
                  `${formatMoneyCents(p.cumBilledCents)} billed to date — ` +
                  "open that month's rent ledger"
                }
                style={{
                  ...monoLabelStyle,
                  position: 'absolute',
                  left: `${xAt(i)}%`,
                  top: 2,
                  transform: 'translateX(-50%)',
                  color: 'var(--ink-2)',
                  textDecoration: 'none',
                  padding: '2px 7px',
                  borderRadius: 6,
                }}
              >
                {p.label}
              </Link>
            ))}
          </div>

          <div style={{ ...monoLabelStyle, textAlign: 'right', color: 'var(--ink-4)' }}>
            Cumulative by month · {cyclesText} of history
          </div>
        </div>

        {/* ——— Right: portfolio status ring (occupancy/late status from
            summary counts — NOT payment-ledger data). ——— */}
        <PortfolioStatusRing segments={segments} unitCount={unitCount} />
      </div>

      <CollectionPaceStyles />
    </section>
  );
}

interface PortfolioStatusRingProps {
  segments: ReturnType<typeof buildRentCoverageSegments>;
  unitCount: number;
}

function PortfolioStatusRing({ segments, unitCount }: PortfolioStatusRingProps): ReactElement {
  // "Occupied", not "rent-producing": the 2 late units are occupied but
  // currently producing no rent — that is the whole gap story.
  const occupied = segments
    .filter((s) => s.id === 'current' || s.id === 'late')
    .reduce((sum, s) => sum + s.units, 0);
  const lateUnits = segments.find((s) => s.id === 'late')?.units ?? 0;

  const visible = segments.filter((s) => s.units > 0);
  const arcLen = (pct: number): number => (pct / 100) * RING_C;
  const arcs = visible.map((s, i) => ({
    segment: s,
    len: arcLen(s.pct),
    offset: visible.slice(0, i).reduce((sum, prev) => sum + arcLen(prev.pct), 0),
  }));

  return (
    <div
      data-testid="rent-coverage-ring"
      style={{ display: 'flex', flexDirection: 'column', gap: 14, alignItems: 'flex-start' }}
    >
      <span
        style={{
          ...monoLabelStyle,
          fontSize: '9.5px',
          fontWeight: 500,
          letterSpacing: '0.14em',
          textTransform: 'uppercase',
        }}
      >
        Portfolio status
      </span>

      {segments.length === 0 ? (
        <span style={{ fontSize: '12.5px', color: 'var(--ink-3)' }}>No units yet.</span>
      ) : (
        <>
          <div style={{ position: 'relative', width: 156, height: 156, alignSelf: 'center' }}>
            <svg
              viewBox="0 0 120 120"
              width="156"
              height="156"
              role="img"
              aria-label={
                `Portfolio status: ${segments.map((s) => s.label).join(', ')} — ` +
                `${occupied} of ${unitCount} units occupied` +
                `${lateUnits > 0 ? ` (${lateUnits} late)` : ''}. ` +
                'Status from lease and unit counts, not payment records.'
              }
            >
              {arcs.map(({ segment, len, offset }) => (
                <circle
                  key={segment.id}
                  cx={60}
                  cy={60}
                  r={RING_R}
                  fill="none"
                  stroke={RING_COLORS[segment.id]}
                  strokeWidth={RING_STROKE}
                  strokeDasharray={`${fmt(len)} ${fmt(RING_C - len)}`}
                  strokeDashoffset={fmt(-offset)}
                  transform="rotate(-90 60 60)"
                />
              ))}
            </svg>
            <div
              aria-hidden="true"
              style={{
                position: 'absolute',
                inset: 0,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 2,
                pointerEvents: 'none',
              }}
            >
              <span
                style={{
                  fontFamily: MONO_FONT,
                  fontSize: '24px',
                  fontWeight: 600,
                  letterSpacing: '0.02em',
                  color: 'var(--ink)',
                  lineHeight: 1,
                }}
              >
                {occupied}/{unitCount}
              </span>
              <span style={{ ...monoLabelStyle, fontSize: '9.5px' }}>occupied</span>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, width: '100%' }}>
            {segments.map((segment) => {
              const swatch = (
                <span
                  aria-hidden="true"
                  style={{
                    width: 10,
                    height: 10,
                    flexShrink: 0,
                    borderRadius: 3,
                    background: RING_COLORS[segment.id],
                    border:
                      segment.id === 'vacant' ? '1px solid var(--hairline-strong)' : 'none',
                    boxSizing: 'border-box',
                  }}
                />
              );
              if (segment.id === 'late') {
                return (
                  <Link
                    key={segment.id}
                    href="/rent?filter=outstanding"
                    className="pace-ring-link"
                    style={{ ...legendRowStyle, textDecoration: 'none' }}
                    aria-label={`${segment.label} — open outstanding rent`}
                  >
                    {swatch}
                    {segment.label}
                  </Link>
                );
              }
              if (segment.id === 'vacant') {
                return (
                  <Link
                    key={segment.id}
                    href="/properties"
                    className="pace-ring-link"
                    style={{ ...legendRowStyle, textDecoration: 'none' }}
                    aria-label={`${segment.label} — open properties`}
                  >
                    {swatch}
                    {segment.label}
                  </Link>
                );
              }
              return (
                <span key={segment.id} style={legendRowStyle}>
                  {swatch}
                  {segment.label}
                </span>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

function CollectionPaceStyles(): ReactElement {
  return (
    <style precedence="default" href="financials-collection-pace">{`
      .pace-grid {
        display: grid;
        grid-template-columns: minmax(0, 2fr) minmax(0, 1fr);
        gap: 28px;
        align-items: start;
      }
      @media (max-width: 880px) {
        .pace-grid { grid-template-columns: minmax(0, 1fr); }
      }
      .pace-month:hover { background: var(--panel-clean); }
      .pace-month:focus-visible {
        outline: 2px solid var(--terracotta);
        outline-offset: 2px;
      }
      .pace-ring-link:hover { color: var(--clay-ink); text-decoration: underline; }
      .pace-ring-link:focus-visible {
        outline: 2px solid var(--terracotta);
        outline-offset: 2px;
      }
    `}</style>
  );
}
