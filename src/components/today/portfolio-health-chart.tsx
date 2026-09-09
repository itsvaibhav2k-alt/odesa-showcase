'use client';

import { useEffect, useRef, useState } from 'react';

import type { TodayKpiDeltas, TodayKpis } from '@/lib/today/queries';
import type { WeekSnapshot } from '@/app/api/today/kpi-history/route';

interface Props {
  /**
   * Portfolio KPIs. No longer rendered inside the chart (the numeric
   * metrics moved to KpiStrip); kept on the prop contract so the page
   * can hand the chart the same snapshot it gives the strip without a
   * separate fetch, and so a future trend annotation can read it.
   */
  kpis: TodayKpis;
  deltas: TodayKpiDeltas;
}

// Plot region is described as percentages of the container so we can
// position both the SVG paths (via viewBox 0..100) and HTML labels
// (via top/left CSS percents) at the same coordinates.
const PLOT_TOP = 18;
const PLOT_BOTTOM = 78;
const PLOT_LEFT = 7;
const PLOT_RIGHT = 96;
const CHART_HEIGHT_PX = 220;

function formatRentShort(cents: number): string {
  const dollars = cents / 100;
  if (dollars >= 10_000) return `$${Math.round(dollars / 1000)}k`;
  if (dollars >= 1_000) return `$${(dollars / 1000).toFixed(1)}k`;
  return `$${Math.round(dollars)}`;
}

function formatUpdated(fetchedAt: Date): string {
  const diffMs = Date.now() - fetchedAt.getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return 'Updated just now';
  return `Updated ${diffMin}m ago`;
}

function scaleY(value: number, domainMin: number, domainMax: number): number {
  const range = domainMax - domainMin;
  if (range <= 0) return (PLOT_TOP + PLOT_BOTTOM) / 2;
  const pct = (value - domainMin) / range;
  return PLOT_BOTTOM - pct * (PLOT_BOTTOM - PLOT_TOP);
}

function scaleX(index: number, total: number): number {
  if (total <= 1) return (PLOT_LEFT + PLOT_RIGHT) / 2;
  return PLOT_LEFT + (index / (total - 1)) * (PLOT_RIGHT - PLOT_LEFT);
}

interface PlotPoint {
  x: number;
  y: number;
  rawValue: number;
  label: string;
  xDate: string;
}

function smoothPath(points: PlotPoint[]): string {
  if (points.length === 0) return '';
  if (points.length === 1) return `M ${points[0].x} ${points[0].y}`;
  const cmds: string[] = [`M ${points[0].x.toFixed(2)} ${points[0].y.toFixed(2)}`];
  for (let i = 1; i < points.length; i++) {
    const p0 = points[i - 1];
    const p1 = points[i];
    const dx = (p1.x - p0.x) * 0.35;
    const c1x = p0.x + dx;
    const c1y = p0.y;
    const c2x = p1.x - dx;
    const c2y = p1.y;
    cmds.push(
      `C ${c1x.toFixed(2)} ${c1y.toFixed(2)} ${c2x.toFixed(2)} ${c2y.toFixed(2)} ${p1.x.toFixed(2)} ${p1.y.toFixed(2)}`,
    );
  }
  return cmds.join(' ');
}

function areaPath(points: PlotPoint[]): string {
  if (points.length === 0) return '';
  const line = smoothPath(points);
  const last = points[points.length - 1];
  const first = points[0];
  return `${line} L ${last.x.toFixed(2)} ${PLOT_BOTTOM} L ${first.x.toFixed(2)} ${PLOT_BOTTOM} Z`;
}

function buildOccupancyPoints(weeks: WeekSnapshot[]): PlotPoint[] {
  return weeks.map((w, i) => ({
    x: scaleX(i, weeks.length),
    y: scaleY(Math.min(Math.max(w.occupancyPct, 0), 100), 0, 100),
    rawValue: w.occupancyPct,
    label: `${Math.round(w.occupancyPct)}%`,
    xDate: w.weekLabel,
  }));
}

function buildRentPoints(weeks: WeekSnapshot[]): PlotPoint[] {
  const rents = weeks.map((w) => w.rentCollectedCents);
  const max = Math.max(...rents, 1);
  // Rent occupies the lower half of the plot so the two series don't
  // visually fight. The label below shows the actual dollar amount.
  const RENT_TOP = PLOT_TOP + (PLOT_BOTTOM - PLOT_TOP) * 0.55;
  return weeks.map((w, i) => ({
    x: scaleX(i, weeks.length),
    y:
      RENT_TOP +
      (1 - w.rentCollectedCents / max) * (PLOT_BOTTOM - RENT_TOP),
    rawValue: w.rentCollectedCents,
    label: formatRentShort(w.rentCollectedCents),
    xDate: w.weekLabel,
  }));
}

export function PortfolioHealthChart(_props: Props) {
  const [history, setHistory] = useState<WeekSnapshot[] | null>(null);
  const [fetchedAt, setFetchedAt] = useState<Date | null>(null);
  const [updatedLabel, setUpdatedLabel] = useState('Updated 2m ago');
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    fetch('/api/today/kpi-history')
      .then((r) => r.json())
      .then((data: { weeks: WeekSnapshot[] }) => {
        setHistory(data.weeks);
        const now = new Date();
        setFetchedAt(now);
        setUpdatedLabel('Updated just now');
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!fetchedAt) return;
    intervalRef.current = setInterval(() => {
      setUpdatedLabel(formatUpdated(fetchedAt));
    }, 30_000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [fetchedAt]);

  const isPlottable = history !== null && history.length >= 2;

  // When there is not enough history to plot, the module renders
  // NOTHING — no oversized placeholder (00-BUILD-HUB anti-patterns).
  // Portfolio metrics live in the KpiStrip now; the chart is a quiet
  // trend trim at the bottom of the column, present only once it can
  // actually draw a line.
  if (!isPlottable) {
    return null;
  }

  const occPoints = buildOccupancyPoints(history!);
  const rentPoints = buildRentPoints(history!);

  return (
    <section
      data-testid="today-portfolio-chart"
      style={{
        background: 'var(--paper-0)',
        border: '1px solid var(--ink-200)',
        borderRadius: 'var(--radius-lg-odesa)',
        padding: '24px',
      }}
    >
      {/* Header row */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '20px',
        }}
      >
        <span
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: '10px',
            textTransform: 'uppercase',
            color: 'var(--ink-500)',
            letterSpacing: '0.06em',
          }}
        >
          Portfolio Health · 4 Weeks
        </span>
        <span
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: '10px',
            color: 'var(--ink-400)',
          }}
        >
          {updatedLabel}
        </span>
      </div>

      <ChartBody occPoints={occPoints} rentPoints={rentPoints} />

      {/* Series legend only — the numeric metrics now live in KpiStrip. */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          borderTop: '1px solid var(--ink-200)',
          paddingTop: '14px',
          gap: '16px',
          flexWrap: 'wrap',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <div
            style={{
              width: '14px',
              height: '3px',
              background: '#1B3A6B',
              borderRadius: '2px',
            }}
          />
          <span
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: '10px',
              color: 'var(--ink-600)',
            }}
          >
            Occupancy
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <div
            style={{
              width: '14px',
              height: '0',
              borderTop: '2px dashed #C9A55C',
            }}
          />
          <span
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: '10px',
              color: 'var(--ink-600)',
            }}
          >
            Rent collection
          </span>
        </div>
      </div>
    </section>
  );
}

interface ChartBodyProps {
  occPoints: PlotPoint[];
  rentPoints: PlotPoint[];
}

function ChartBody({ occPoints, rentPoints }: ChartBodyProps) {
  // Y-axis ticks for occupancy (0/25/50/75/100% gridlines).
  const yTicks = [0, 25, 50, 75, 100].map((pct) => ({
    pct,
    y: scaleY(pct, 0, 100),
  }));

  return (
    <div
      style={{
        position: 'relative',
        width: '100%',
        height: `${CHART_HEIGHT_PX}px`,
        marginBottom: '16px',
      }}
    >
      {/* SVG handles only the geometry: gridlines, area fill, lines, dots.
          All text/labels are HTML overlays so they stay crisp regardless
          of viewport width (the SVG uses preserveAspectRatio="none"). */}
      <svg
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          overflow: 'visible',
        }}
      >
        {/* Gridlines */}
        {yTicks.map(({ y }) => (
          <line
            key={`grid-${y}`}
            x1={PLOT_LEFT}
            x2={PLOT_RIGHT}
            y1={y}
            y2={y}
            stroke="var(--ink-200)"
            strokeWidth={0.6}
            strokeDasharray="0.8 1.2"
            vectorEffect="non-scaling-stroke"
          />
        ))}

        {/* Occupancy area fill */}
        <path d={areaPath(occPoints)} fill="#1B3A6B" fillOpacity={0.07} />

        {/* Rent dashed line */}
        <path
          d={smoothPath(rentPoints)}
          fill="none"
          stroke="#C9A55C"
          strokeWidth={1.5}
          strokeDasharray="3 2.5"
          vectorEffect="non-scaling-stroke"
          strokeLinecap="round"
        />

        {/* Occupancy line */}
        <path
          d={smoothPath(occPoints)}
          fill="none"
          stroke="#1B3A6B"
          strokeWidth={2}
          vectorEffect="non-scaling-stroke"
          strokeLinecap="round"
        />
      </svg>

      {/* Dots are rendered as HTML so they stay perfectly round at any
          container width. SVG circles get stretched into ellipses by
          preserveAspectRatio='none'. */}
      {occPoints.map((p, i) => (
        <div
          key={`occ-dot-${i}`}
          style={{
            position: 'absolute',
            left: `${p.x}%`,
            top: `${p.y}%`,
            width: '10px',
            height: '10px',
            transform: 'translate(-50%, -50%)',
            borderRadius: '50%',
            background: '#FFFFFF',
            border: '2px solid #1B3A6B',
            boxSizing: 'border-box',
            pointerEvents: 'none',
            zIndex: 2,
          }}
        />
      ))}

      {rentPoints.map((p, i) => (
        <div
          key={`rent-dot-${i}`}
          style={{
            position: 'absolute',
            left: `${p.x}%`,
            top: `${p.y}%`,
            width: '8px',
            height: '8px',
            transform: 'translate(-50%, -50%)',
            borderRadius: '50%',
            background: '#C9A55C',
            border: '1.5px solid #FFFFFF',
            boxSizing: 'border-box',
            pointerEvents: 'none',
            zIndex: 2,
          }}
        />
      ))}

      {/* HTML labels overlaid on top */}
      {/* Y-axis tick labels */}
      {yTicks.map(({ pct, y }) => (
        <div
          key={`ytick-${pct}`}
          style={{
            position: 'absolute',
            left: 0,
            top: `${y}%`,
            transform: 'translate(0, -50%)',
            fontFamily: 'var(--font-mono)',
            fontSize: '10px',
            color: 'var(--ink-400)',
            width: `${PLOT_LEFT - 1}%`,
            textAlign: 'right',
            paddingRight: '4px',
            pointerEvents: 'none',
          }}
        >
          {pct}
        </div>
      ))}

      {/* Occupancy value labels (above each dot) */}
      {occPoints.map((p, i) => (
        <div
          key={`occ-lbl-${i}`}
          style={{
            position: 'absolute',
            left: `${p.x}%`,
            top: `${p.y}%`,
            transform: 'translate(-50%, calc(-100% - 10px))',
            fontFamily: 'var(--font-mono)',
            fontSize: '12px',
            fontWeight: 600,
            color: '#1B3A6B',
            background: '#FFFFFF',
            border: '1px solid #E0E8F0',
            borderRadius: '4px',
            padding: '2px 6px',
            whiteSpace: 'nowrap',
            pointerEvents: 'none',
            lineHeight: 1.2,
          }}
        >
          {p.label}
        </div>
      ))}

      {/* Rent value labels (below each rent dot) */}
      {rentPoints.map((p, i) => (
        <div
          key={`rent-lbl-${i}`}
          style={{
            position: 'absolute',
            left: `${p.x}%`,
            top: `${p.y}%`,
            transform: 'translate(-50%, 10px)',
            fontFamily: 'var(--font-mono)',
            fontSize: '11px',
            color: '#9C7D44',
            whiteSpace: 'nowrap',
            pointerEvents: 'none',
            lineHeight: 1.2,
          }}
        >
          {p.label}
        </div>
      ))}

      {/* X-axis date labels */}
      {occPoints.map((p, i) => (
        <div
          key={`x-lbl-${i}`}
          style={{
            position: 'absolute',
            left: `${p.x}%`,
            top: `${PLOT_BOTTOM}%`,
            transform: 'translate(-50%, 14px)',
            fontFamily: 'var(--font-mono)',
            fontSize: '11px',
            color: 'var(--ink-500)',
            whiteSpace: 'nowrap',
            pointerEvents: 'none',
            lineHeight: 1.2,
          }}
        >
          {p.xDate}
        </div>
      ))}

      {/* Today annotation, anchored to the last point */}
      {occPoints.length > 0 && (
        <div
          style={{
            position: 'absolute',
            left: `${occPoints[occPoints.length - 1].x}%`,
            top: 0,
            transform: 'translate(-50%, -22px)',
            fontFamily: 'var(--font-mono)',
            fontSize: '10px',
            color: '#1B3A6B',
            background: '#F0F4F8',
            border: '1px solid #D0E0EE',
            borderRadius: '4px',
            padding: '2px 6px',
            whiteSpace: 'nowrap',
            pointerEvents: 'none',
            lineHeight: 1.2,
          }}
        >
          Today
        </div>
      )}
    </div>
  );
}
