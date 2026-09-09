/**
 * Weekly briefing types — shared between the metrics calculator,
 * the template generator, and the Inngest cron.
 */

export interface BriefingMetrics {
  weekStartDate: string; // ISO YYYY-MM-DD
  occupancyPct: number; // 0..100
  unitsOccupied: number;
  unitsTotal: number;
  rentCollectedDollars: number;
  rentDueDollars: number;
  rentCollectedPct: number; // 0..100
  workOrdersOpenedCount: number;
  workOrdersClosedCount: number;
  workOrdersOpenCount: number;
  lateTenantsCount: number;
  expiringLeasesCount: number; // leases ending within 60 days
  expiringLeases: readonly ExpiringLease[];
  belowMarketUnits: readonly BelowMarketFlag[];
}

export interface ExpiringLease {
  leaseId: string;
  tenantName: string;
  unitLabel: string | null;
  endDate: string;
  rentAmount: number;
}

export interface BelowMarketFlag {
  leaseId: string;
  tenantName: string;
  unitLabel: string | null;
  currentRent: number;
  medianRent: number;
  deltaDollars: number; // positive = below market
}

export interface GeneratedBriefing {
  metrics: BriefingMetrics;
  briefingText: string;
  recommendation: string | null;
  generatedAt: string;
}
