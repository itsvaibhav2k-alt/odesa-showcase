/**
 * Properties route loading skeleton.
 *
 * Server component shown while the `/properties` portfolio data resolves. It
 * mirrors the directory's shape — a row of stat tiles above a grid of property
 * cards — using the shared skeleton primitives so the layout doesn't shift when
 * real data arrives.
 */

import { CardSkeleton, StatSkeleton } from '@/components/shared';

export default function PropertiesLoading() {
  return (
    <div
      data-testid="properties-loading"
      className="today-theme"
      style={{
        minHeight: '100vh',
        background: 'var(--panel-clean)',
        padding: '24px 30px',
      }}
    >
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <StatSkeleton key={index} />
        ))}
      </div>
      <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 6 }).map((_, index) => (
          <CardSkeleton key={index} />
        ))}
      </div>
    </div>
  );
}
