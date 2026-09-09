import { UnitCard } from './unit-card';
import type { UnitGridCard } from '@/lib/properties/queries';

/**
 * Responsive grid of unit cards.
 *
 * - Desktop (>= 1024px): 3 columns
 * - Tablet (>= 640px): 2 columns
 * - Mobile: 1 column
 *
 * The grid is pure presentation; the cards themselves handle hover
 * state + navigation.
 */
export interface UnitGridProps {
  propertyId: string;
  units: UnitGridCard[];
}

export function UnitGrid({ propertyId, units }: UnitGridProps) {
  if (units.length === 0) {
    return (
      <div
        data-testid="unit-grid-empty"
        style={{
          background: 'var(--paper-0)',
          border: '1px solid var(--ink-200)',
          borderRadius: 'var(--radius-md-odesa)',
          padding: '48px 32px',
          textAlign: 'center',
          color: 'var(--ink-500)',
          fontSize: '14px',
        }}
      >
        No units yet. Add one from onboarding to populate this property.
      </div>
    );
  }

  return (
    <div
      data-testid="unit-grid"
      className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3"
    >
      {units.map((card) => (
        <UnitCard key={card.id} propertyId={propertyId} card={card} />
      ))}
    </div>
  );
}
