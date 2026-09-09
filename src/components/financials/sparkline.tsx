/**
 * Sparkline — a tiny house-SVG trend line for KPI cards on `/financials`.
 *
 * Server component. Follows the house SVG idiom (see
 * `src/components/today/portfolio-health-chart.tsx`): viewBox 0 0 100 100,
 * `preserveAspectRatio="none"` so the geometry stretches to the container,
 * `vectorEffect="non-scaling-stroke"` so the line stays hairline-crisp at
 * any width. One stroke path, no labels, no axes — the KPI card's number
 * is the reading; this is only its shape over time.
 *
 * Honest by construction: fewer than two points renders NOTHING (a single
 * month has no trend), and the values are plotted exactly as given —
 * never smoothed into a nicer story.
 */

import type { CSSProperties } from 'react';

export interface SparklineProps {
  /** One value per month, ascending in time (integer cents). */
  values: readonly number[];
  /** Stroke color token; defaults to the quiet ink. */
  stroke?: string;
  testId?: string;
}

const svgStyle: CSSProperties = {
  display: 'block',
  width: '100%',
  height: 36,
};

/**
 * Render the sparkline, or `null` when there is no trend to show
 * (fewer than two points).
 */
export function Sparkline({ values, stroke = 'var(--ink-4)', testId }: SparklineProps) {
  if (values.length < 2) return null;

  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min;

  // x spans 2..98, y spans 8..92 (inverted), flat series sits mid-height.
  const points = values.map((value, index) => {
    const x = 2 + (index / (values.length - 1)) * 96;
    const y = range === 0 ? 50 : 92 - ((value - min) / range) * 84;
    return `${x.toFixed(2)} ${y.toFixed(2)}`;
  });

  return (
    <svg
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      style={svgStyle}
      aria-hidden="true"
      data-testid={testId}
    >
      <path
        d={`M ${points.join(' L ')}`}
        fill="none"
        stroke={stroke}
        strokeWidth={1.5}
        vectorEffect="non-scaling-stroke"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
