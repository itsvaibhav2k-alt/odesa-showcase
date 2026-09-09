/**
 * Property detail route loading skeleton.
 *
 * Server component shown while `/properties/[id]` resolves its brief. It mirrors
 * the detail layout — a hero strip above a two-column interior (primary panel +
 * right rail) — using the shared skeleton primitives so the page doesn't shift
 * when real data arrives.
 */

import { CardSkeleton, StatSkeleton } from '@/components/shared';

export default function PropertyDetailLoading() {
  return (
    <div
      data-testid="property-detail-loading"
      className="today-theme"
      style={{
        minHeight: '100vh',
        background: 'var(--panel-clean)',
      }}
    >
      <div
        style={{
          padding: '28px 30px',
          borderBottom: '1px solid var(--hairline)',
        }}
      >
        <StatSkeleton />
      </div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1fr) 330px',
          gap: 18,
          padding: '22px 30px 28px',
        }}
      >
        <div className="grid gap-4">
          <CardSkeleton />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <StatSkeleton />
            <StatSkeleton />
          </div>
        </div>
        <div className="grid gap-4">
          <CardSkeleton />
          <CardSkeleton />
        </div>
      </div>
    </div>
  );
}
