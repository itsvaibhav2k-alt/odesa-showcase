/**
 * Financial domain types — the typed contract every financial surface
 * (queries, readout, UI) consumes. Money is ALWAYS integer cents; there
 * is no float money anywhere in this module.
 *
 * Honest-data invariant (this sprint): maintenance / vendor / other
 * expense spend is NOT in the schema. When expenses are unavailable the
 * spend fields stay `null` (never `0`), and any value derived from them
 * (`operatingExpenseCents`, `noiCents`, `marginPct`) is `null` /
 * `unknown` so risk derivation never claims confidence it doesn't have.
 * A work-order COUNT must never become a `MoneyCents` value.
 */

/** Integer cents. Never dollars, never a float. */
export type MoneyCents = number;

/** Risk classification for a property / portfolio. */
export type RiskLevel = 'healthy' | 'watch' | 'attention' | 'critical' | 'unknown';

/** Severity for an actionable exception (no 'healthy'/'unknown'). */
export type ExceptionSeverity = 'info' | 'watch' | 'attention' | 'critical';

/** Where an exception was sourced from (audit/UX grouping). */
export type ExceptionSource =
  | 'rent'
  | 'payment'
  | 'maintenance'
  | 'vendor'
  | 'system'
  | 'demo';

/** A closed financial reporting window, inclusive of both ends. */
export interface FinancialPeriod {
  /** 'YYYY-MM-DD'. */
  startDate: string;
  /** 'YYYY-MM-DD'. */
  endDate: string;
  /** Human label, e.g. 'June 2026'. */
  label: string;
}

/** Per-property financial snapshot for the reporting period. */
export interface PropertyFinancialSnapshot {
  propertyId: string;
  propertyName: string;
  units: number;
  occupiedUnits: number;
  rentBilledCents: MoneyCents;
  rentCollectedCents: MoneyCents;
  rentOutstandingCents: MoneyCents;
  rentLateCents: MoneyCents;
  /** null = expense imports not connected (never fabricate as 0). */
  maintenanceSpendCents: MoneyCents | null;
  vendorSpendCents: MoneyCents | null;
  otherExpenseCents: MoneyCents | null;
  depositsHeldCents?: MoneyCents | null;
  /** Sum of known expense categories; null when none are connected. */
  operatingExpenseCents: MoneyCents | null;
  /** Operating result (rent basis); null when expenses unavailable. */
  noiCents: MoneyCents | null;
  /** Operating result as % of collected rent; null when unknown. */
  marginPct: number | null;
  /** Collected / billed as a percent; null when nothing billed. */
  collectionRatePct: number | null;
  /** Occupied / total units as a percent; null when no units. */
  occupancyRatePct: number | null;
  /** Open work-order count — a RISK SIGNAL only, never a dollar figure. */
  openWorkOrderCount?: number;
  riskLevel: RiskLevel;
  riskReasons: string[];
}

/** Portfolio rollup for the reporting period. */
export interface PortfolioFinancialSummary {
  period: FinancialPeriod;
  propertyCount: number;
  unitCount: number;
  occupiedUnitCount: number;
  rentBilledCents: MoneyCents;
  rentCollectedCents: MoneyCents;
  rentOutstandingCents: MoneyCents;
  rentLateCents: MoneyCents;
  /** null = expense imports not connected (never fabricate as 0). */
  maintenanceSpendCents: MoneyCents | null;
  vendorSpendCents: MoneyCents | null;
  operatingExpenseCents: MoneyCents | null;
  /** Operating result (rent basis); null when expenses unavailable. */
  noiCents: MoneyCents | null;
  marginPct: number | null;
  collectionRatePct: number | null;
  occupancyRatePct: number | null;
  openWorkOrderCount?: number;
  properties: PropertyFinancialSnapshot[];
  exceptions: FinancialException[];
}

/** A deterministic, actionable financial exception for the queue. */
export interface FinancialException {
  id: string;
  severity: ExceptionSeverity;
  propertyId?: string;
  propertyName?: string;
  title: string;
  detail: string;
  /** Money at stake in integer cents; omitted when not money-shaped. */
  amountCents?: MoneyCents;
  recommendedAction: string;
  source: ExceptionSource;
}
