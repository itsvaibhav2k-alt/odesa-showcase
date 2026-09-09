'use client';

import { useEffect, useRef, useState } from 'react';

import { statusColor, type StatusTone } from '@/lib/today/status';

/**
 * A single KPI card in the Today strip.
 *
 * Features:
 * - Count-up animation on mount: runs once over 400ms with a
 *   cubic-bezier(0.16, 1, 0.3, 1) ease-out. Respects
 *   `prefers-reduced-motion`.
 * - Value is rendered with tabular-nums so the count-up doesn't
 *   shift horizontal alignment frame-by-frame.
 * - Delta chip is color-coded (up/down/neutral) and uses semantic
 *   colors for up/down based on `positiveIsGood`.
 *
 * The card is a single `<article>` with stable `data-testid` hooks so
 * the Playwright specs in `e2e/today/` can read KPIs without relying
 * on the surrounding layout.
 */

export interface KpiCardProps {
  /** Short uppercase label above the numeral (e.g. "Occupancy"). */
  label: string;
  /** The target numeric value to count up to. */
  value: number;
  /**
   * The formatter used for rendering. Receives the currently-animating
   * numeric value; implementations may produce "$12,480", "97%", or
   * "14" depending on the KPI.
   */
  formatValue: (n: number) => string;
  /**
   * Week-over-week delta. Pass `null` to suppress the delta chip (e.g.
   * for the occupancy card in Phase 1 where we don't have a baseline
   * snapshot yet).
   */
  delta?: number | null;
  /** Formatter for the delta chip. */
  formatDelta?: (n: number) => string;
  /**
   * If `true`, a positive delta is rendered green (success) — e.g.
   * rent collected. If `false`, a positive delta is rendered red
   * (error) — e.g. late tenants, open WOs.
   * @default true
   */
  positiveIsGood?: boolean;
  /**
   * Short plain-language line beneath the value giving the numeral
   * meaning (e.g. "32 of 33 units" or "$2,300 still out"). Pass
   * `undefined` to omit. Sits above the delta chip.
   */
  context?: string;
  /**
   * Semantic status pill rendered top-right of the card. `tone` resolves
   * its color through the shared `statusColor` helper so a green/gold/red
   * here means the same as everywhere else on the Today screen. Pass
   * `undefined` to omit the pill.
   */
  status?: { label: string; tone: StatusTone };
  /** `testid` slug for Playwright selectors. */
  testId: string;
}

export function KpiCard({
  label,
  value,
  formatValue,
  delta,
  formatDelta,
  positiveIsGood = true,
  context,
  status,
  testId,
}: KpiCardProps) {
  const animatedValue = useCountUp(value, 400);

  const deltaColor = deltaToColor(delta ?? null, positiveIsGood);
  const deltaLabel =
    delta == null
      ? null
      : (formatDelta ?? defaultDeltaFormat)(delta);

  return (
    <article
      data-testid={testId}
      className="animate-kpi-settle"
      style={{
        background: 'var(--paper-0)',
        border: '1px solid var(--ink-200)',
        borderRadius: 'var(--radius-md-odesa)',
        padding: '18px 20px',
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
        minHeight: '108px',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: '10px',
        }}
      >
        <p
          className="meta-label"
          data-testid={`${testId}-label`}
          style={{ flex: '1 1 auto', minWidth: 0 }}
        >
          {label}
        </p>
        {status ? (
          <span
            data-testid={`${testId}-status`}
            style={{
              flexShrink: 0,
              fontSize: '11px',
              fontWeight: 600,
              lineHeight: 1,
              letterSpacing: '0.02em',
              color: statusColor(status.tone),
              border: `1px solid ${statusColor(status.tone)}`,
              borderRadius: '999px',
              padding: '3px 8px',
              whiteSpace: 'nowrap',
            }}
          >
            {status.label}
          </span>
        ) : null}
      </div>
      <p
        className="tabular-nums"
        data-testid={`${testId}-value`}
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: '28px',
          lineHeight: 1.05,
          fontWeight: 500,
          color: 'var(--ink-900)',
          letterSpacing: '-0.01em',
        }}
      >
        {formatValue(animatedValue)}
      </p>
      {context ? (
        <p
          data-testid={`${testId}-context`}
          style={{
            fontSize: '12px',
            lineHeight: 1.3,
            color: 'var(--ink-500)',
          }}
        >
          {context}
        </p>
      ) : null}
      {deltaLabel ? (
        <p
          className="tabular-nums"
          data-testid={`${testId}-delta`}
          style={{
            fontSize: '12px',
            fontWeight: 500,
            color: deltaColor,
            letterSpacing: '0.01em',
          }}
        >
          {deltaLabel}
        </p>
      ) : (
        <p
          className="meta-label"
          data-testid={`${testId}-delta-empty`}
          style={{ color: 'var(--ink-400)' }}
        >
          vs. last week
        </p>
      )}
    </article>
  );
}

/**
 * Runs a 0 → target count-up over `durationMs` once, on mount.
 * Respects prefers-reduced-motion by jumping directly to `target`.
 *
 * We round the animated value for display (the formatter is expected
 * to tolerate any number). Fractional targets still animate smoothly
 * and render cleanly because the final frame sets `target` exactly.
 */
function useCountUp(target: number, durationMs: number): number {
  const [display, setDisplay] = useState(0);
  const frameRef = useRef<number | null>(null);
  const reducedMotion =
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  useEffect(() => {
    if (reducedMotion) {
      setDisplay(target);
      return;
    }

    if (target === 0) {
      setDisplay(0);
      return;
    }

    const start = performance.now();
    const step = (t: number) => {
      const elapsed = t - start;
      const progress = Math.min(1, elapsed / durationMs);
      // ease-out cubic — matches the CSS var visually
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplay(eased * target);
      if (progress < 1) {
        frameRef.current = requestAnimationFrame(step);
      } else {
        setDisplay(target);
      }
    };

    frameRef.current = requestAnimationFrame(step);
    return () => {
      if (frameRef.current != null) cancelAnimationFrame(frameRef.current);
    };
    // Intentionally fire once per mount for a given target; re-animating
    // on every value change would feel noisy in a dashboard.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return display;
}

function deltaToColor(delta: number | null, positiveIsGood: boolean): string {
  if (delta == null || delta === 0) return 'var(--ink-500)';
  const isPositive = delta > 0;
  const good = positiveIsGood ? isPositive : !isPositive;
  return good ? 'var(--success-600)' : 'var(--error-600)';
}

function defaultDeltaFormat(n: number): string {
  if (n === 0) return 'No change';
  const sign = n > 0 ? '+' : '';
  return `${sign}${n} vs. last week`;
}
