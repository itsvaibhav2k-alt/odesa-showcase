/**
 * Canonical domain module — the single source of truth for rent-cycle
 * lateness, tenant standing, and unit occupancy. Pure, IO-free.
 */

export {
  parseIsoDay,
  dayNumber,
  diffDays,
  type IsoDayParts,
} from './dates';

export {
  deriveRentCycleStatus,
  rentCycleFromRow,
  LATE_STATUS_DAY_FLOOR,
  type RentCycleKind,
  type RentCycleInput,
  type RentCycleRow,
  type DerivedRentCycleStatus,
  type RentEventStatus,
  type LeaseStatus,
} from './rent-cycle';

export {
  deriveTenantStanding,
  standingLabel,
  standingNarrative,
  type TenantStanding,
} from './standing';

export {
  rentRecommendationCopy,
  type RentRecommendationKind,
  type RentRecommendationOpts,
} from './rent-copy';

export {
  deriveLeaseStatus,
  deriveUnitOccupancyStatus,
  type DerivedLeaseStatus,
  type UnitOccupancyKind,
  type OccupancyLeaseInput,
} from './occupancy';
