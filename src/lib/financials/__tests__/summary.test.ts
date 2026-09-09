/**
 * Unit tests for the pure portfolio/property summary folds.
 *
 * The folds consume rent rows that have ALREADY been derived by the
 * canonical `rent-cycle` module (lateness/balance live there, never
 * here). These tests build real derived statuses via
 * `deriveRentCycleStatus` so the division of labour is exercised end to
 * end. Spend stays `null` (honest "not connected") and never fabricated.
 */

import { describe, expect, it } from 'vitest';

import { deriveRentCycleStatus } from '@/lib/domain/rent-cycle';
import type { FinancialPeriod, MoneyCents } from '../types';
import {
  buildPortfolioSummary,
  buildPropertySnapshot,
  orderPropertiesByRisk,
  type DerivedRentRow,
  type PropertySnapshotInput,
} from '../summary';

const PERIOD: FinancialPeriod = {
  startDate: '2026-06-01',
  endDate: '2026-06-30',
  label: 'June 2026',
};

const TODAY = '2026-06-15';

/** Build a derived rent row from billed/collected cents + cycle facts. */
function row(
  billedCents: MoneyCents,
  collectedCents: MoneyCents,
  opts: { status?: string; dueDate?: string | null } = {},
): DerivedRentRow {
  const status = deriveRentCycleStatus({
    status: (opts.status ?? 'pending') as never,
    dueDate: opts.dueDate ?? null,
    amountDueCents: billedCents,
    amountPaidCents: collectedCents,
    todayIso: TODAY,
  });
  return { billedCents, collectedCents, status };
}

const paid = (cents: MoneyCents): DerivedRentRow => row(cents, cents);
const late = (billed: MoneyCents, collected: MoneyCents): DerivedRentRow =>
  row(billed, collected, { status: 'late_3', dueDate: '2026-06-01' });
const dueNotLate = (billed: MoneyCents, collected: MoneyCents): DerivedRentRow =>
  row(billed, collected, { status: 'pending', dueDate: '2026-06-30' });

function property(overrides: Partial<PropertySnapshotInput> = {}): PropertySnapshotInput {
  return {
    propertyId: 'p1',
    propertyName: 'Maple Court',
    units: 4,
    occupiedUnits: 4,
    rentRows: [paid(150000), paid(150000), paid(150000), paid(150000)],
    ...overrides,
  };
}

describe('financials/summary', () => {
  describe('buildPropertySnapshot', () => {
    it('should sum billed/collected/outstanding/late from derived rows', () => {
      const snap = buildPropertySnapshot(
        property({ rentRows: [paid(150000), late(150000, 0), dueNotLate(150000, 50000)] }),
      );
      expect(snap.rentBilledCents).toBe(450000);
      expect(snap.rentCollectedCents).toBe(200000);
      // outstanding = late 150000 + due-not-late 100000
      expect(snap.rentOutstandingCents).toBe(250000);
      // only the late cycle's balance counts as late
      expect(snap.rentLateCents).toBe(150000);
    });

    it('should keep spend null (not zero) when expenses are not connected', () => {
      const snap = buildPropertySnapshot(property());
      expect(snap.maintenanceSpendCents).toBeNull();
      expect(snap.vendorSpendCents).toBeNull();
      expect(snap.otherExpenseCents).toBeNull();
      expect(snap.operatingExpenseCents).toBeNull();
      expect(snap.noiCents).toBeNull();
      expect(snap.marginPct).toBeNull();
    });

    it('should compute a negative operating result when expenses exceed collected', () => {
      const snap = buildPropertySnapshot(
        property({
          rentRows: [paid(100000)],
          maintenanceSpendCents: 80000,
          vendorSpendCents: 40000,
        }),
      );
      expect(snap.operatingExpenseCents).toBe(120000);
      expect(snap.noiCents).toBe(-20000);
      expect(snap.marginPct).toBe(-20);
    });

    it('should be healthy when collection is full and units are occupied', () => {
      const snap = buildPropertySnapshot(property());
      expect(snap.collectionRatePct).toBe(100);
      expect(snap.occupancyRatePct).toBe(100);
      expect(snap.riskLevel).toBe('healthy');
    });

    it('should be critical on a fully unpaid (and late) month', () => {
      const snap = buildPropertySnapshot(
        property({ rentRows: [late(150000, 0), late(150000, 0)] }),
      );
      expect(snap.collectionRatePct).toBe(0);
      expect(snap.rentLateCents).toBe(300000);
      expect(snap.riskLevel).toBe('critical');
    });

    it('should allow collected > billed without negative outstanding', () => {
      const snap = buildPropertySnapshot(
        property({ rentRows: [row(150000, 175000)] }),
      );
      expect(snap.collectionRatePct).toBeGreaterThan(100);
      expect(snap.rentOutstandingCents).toBe(0);
      expect(snap.rentLateCents).toBe(0);
    });

    it('should report occupancy on a partially occupied property', () => {
      const snap = buildPropertySnapshot(
        property({ units: 4, occupiedUnits: 1, rentRows: [paid(150000)] }),
      );
      expect(snap.occupancyRatePct).toBe(25);
      expect(snap.riskLevel).toBe('attention');
    });

    it('should be unknown with zero units and nothing billed', () => {
      const snap = buildPropertySnapshot(
        property({ units: 0, occupiedUnits: 0, rentRows: [] }),
      );
      expect(snap.occupancyRatePct).toBeNull();
      expect(snap.collectionRatePct).toBeNull();
      expect(snap.riskLevel).toBe('unknown');
    });
  });

  describe('buildPortfolioSummary', () => {
    it('should handle a portfolio with zero properties', () => {
      const summary = buildPortfolioSummary({ period: PERIOD, properties: [] });
      expect(summary.propertyCount).toBe(0);
      expect(summary.unitCount).toBe(0);
      expect(summary.rentBilledCents).toBe(0);
      expect(summary.collectionRatePct).toBeNull();
      expect(summary.occupancyRatePct).toBeNull();
      expect(summary.noiCents).toBeNull();
      expect(summary.exceptions).toEqual([]);
    });

    it('should aggregate totals across properties', () => {
      const summary = buildPortfolioSummary({
        period: PERIOD,
        properties: [
          property({ propertyId: 'a', rentRows: [paid(150000), paid(150000)], units: 2, occupiedUnits: 2 }),
          property({ propertyId: 'b', rentRows: [late(150000, 0)], units: 2, occupiedUnits: 1 }),
        ],
      });
      expect(summary.propertyCount).toBe(2);
      expect(summary.unitCount).toBe(4);
      expect(summary.occupiedUnitCount).toBe(3);
      expect(summary.rentBilledCents).toBe(450000);
      expect(summary.rentCollectedCents).toBe(300000);
      expect(summary.rentLateCents).toBe(150000);
      expect(summary.collectionRatePct).toBeCloseTo(66.7, 1);
      expect(summary.occupancyRatePct).toBe(75);
    });

    it('should keep portfolio spend/noi null when no property has expenses', () => {
      const summary = buildPortfolioSummary({
        period: PERIOD,
        properties: [property()],
      });
      expect(summary.maintenanceSpendCents).toBeNull();
      expect(summary.operatingExpenseCents).toBeNull();
      expect(summary.noiCents).toBeNull();
      expect(summary.marginPct).toBeNull();
    });

    it('should emit an honest "expense imports not connected" info exception', () => {
      const summary = buildPortfolioSummary({
        period: PERIOD,
        properties: [property()],
      });
      const expenseException = summary.exceptions.find((e) => e.id === 'expense-imports');
      expect(expenseException).toBeDefined();
      expect(expenseException?.severity).toBe('info');
      expect(expenseException?.source).toBe('system');
      expect(expenseException?.amountCents).toBeUndefined();
    });

    it('should emit a money-shaped late-rent exception sorted by severity', () => {
      const summary = buildPortfolioSummary({
        period: PERIOD,
        properties: [
          property({ propertyId: 'good', propertyName: 'Good House' }),
          property({
            propertyId: 'bad',
            propertyName: 'Bad House',
            rentRows: [late(150000, 0), late(150000, 0)],
          }),
        ],
      });
      const lateException = summary.exceptions.find((e) => e.id === 'late:bad');
      expect(lateException).toBeDefined();
      expect(lateException?.severity).toBe('critical');
      expect(lateException?.amountCents).toBe(300000);
      expect(lateException?.source).toBe('rent');
      expect(lateException?.propertyName).toBe('Bad House');
      // sorted worst-first
      expect(summary.exceptions[0].severity).toBe('critical');
    });

    it('should handle a 600+ property portfolio deterministically', () => {
      const properties: PropertySnapshotInput[] = [];
      for (let i = 0; i < 600; i += 1) {
        properties.push(
          property({
            propertyId: `p${i}`,
            propertyName: `House ${i}`,
            units: 1,
            occupiedUnits: 1,
            rentRows: [paid(100000)],
          }),
        );
      }
      const summary = buildPortfolioSummary({ period: PERIOD, properties });
      expect(summary.propertyCount).toBe(600);
      expect(summary.unitCount).toBe(600);
      expect(summary.rentBilledCents).toBe(600 * 100000);
      expect(summary.rentCollectedCents).toBe(600 * 100000);
      expect(summary.collectionRatePct).toBe(100);
    });
  });

  describe('orderPropertiesByRisk', () => {
    it('should order worst risk first, then largest outstanding', () => {
      const snapshots = [
        buildPropertySnapshot(
          property({ propertyId: 'healthy', propertyName: 'Healthy House' }),
        ),
        buildPropertySnapshot(
          property({
            propertyId: 'critical-small',
            propertyName: 'Critical Small',
            rentRows: [late(100000, 0), late(100000, 0)],
          }),
        ),
        buildPropertySnapshot(
          property({
            propertyId: 'critical-big',
            propertyName: 'Critical Big',
            rentRows: [late(150000, 0), late(150000, 0)],
          }),
        ),
        buildPropertySnapshot(
          property({
            propertyId: 'attention',
            propertyName: 'Attention House',
            units: 4,
            occupiedUnits: 1,
            rentRows: [paid(150000)],
          }),
        ),
      ];
      const ordered = orderPropertiesByRisk(snapshots);
      expect(ordered.map((p) => p.propertyId)).toEqual([
        'critical-big', 'critical-small', 'attention', 'healthy',
      ]);
    });

    it('should rank unknown above healthy and break ties by name, without mutating input', () => {
      const snapshots = [
        buildPropertySnapshot(
          property({ propertyId: 'h-b', propertyName: 'Beta House' }),
        ),
        buildPropertySnapshot(
          property({ propertyId: 'h-a', propertyName: 'Alpha House' }),
        ),
        buildPropertySnapshot(
          property({ propertyId: 'unknown', propertyName: 'Zed Lot', units: 0, occupiedUnits: 0, rentRows: [] }),
        ),
      ];
      const ordered = orderPropertiesByRisk(snapshots);
      expect(ordered.map((p) => p.propertyId)).toEqual(['unknown', 'h-a', 'h-b']);
      // input untouched (new array returned)
      expect(snapshots.map((p) => p.propertyId)).toEqual(['h-b', 'h-a', 'unknown']);
    });
  });
});
