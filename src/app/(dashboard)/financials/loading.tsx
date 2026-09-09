/**
 * Financials route loading skeleton.
 *
 * Server component shown while the `/financials` console resolves.
 * Mirrors the new surface shape — a wide collection-hero card, a period
 * chip row, four KPI stats, a tall trend panel, and two stacked list
 * panels — using the shared skeleton primitives so the layout doesn't
 * shift when real data arrives.
 */

import { CardSkeleton, StatSkeleton } from '@/components/shared';
import { Skeleton } from '@/components/ui/skeleton';

export default function FinancialsLoading() {
  return (
    <div
      data-testid="financials-loading"
      className="today-theme"
      style={{
        minHeight: '100vh',
        background: 'var(--panel-clean)',
        padding: '24px 30px',
      }}
    >
      {/* Collection hero */}
      <CardSkeleton />

      {/* Period chips */}
      <div className="mt-4 flex flex-wrap gap-2">
        {Array.from({ length: 4 }).map((_, index) => (
          <Skeleton key={index} className="h-7 w-24 rounded-full" />
        ))}
      </div>

      {/* KPI row */}
      <div className="mt-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <StatSkeleton key={index} />
        ))}
      </div>

      {/* Collection trend */}
      <div className="mt-6 rounded-xl border p-4">
        <Skeleton className="h-40 w-full" />
      </div>

      {/* Exceptions + property rollup */}
      <div className="mt-6 grid grid-cols-1 gap-4">
        {Array.from({ length: 2 }).map((_, index) => (
          <CardSkeleton key={index} />
        ))}
      </div>
    </div>
  );
}
