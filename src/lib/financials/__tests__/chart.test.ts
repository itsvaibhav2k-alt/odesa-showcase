/**
 * Unit tests for the pure chart helpers (axis math, rate/gap
 * derivation, property-mark routing) plus `formatMoneyCentsShort`
 * (consumed by the same graphs; mirrors trend.test.ts covering
 * `formatSignedMoneyCents`).
 */

import { describe, expect, it } from 'vitest';

import {
  buildCumulativePace,
  buildPropertyMarks,
  buildRentCoverageSegments,
  currentMonthGap,
  monthRatePct,
  niceAxis,
} from '../chart';
import { formatMoneyCentsShort } from '../format';
import type { MonthlyRentPoint } from '../trend';
import type { MoneyCents, PropertyFinancialSnapshot } from '../types';

function point(opts: {
  billedCents: MoneyCents;
  collectedCents: MoneyCents;
  outstandingCents?: MoneyCents;
}): MonthlyRentPoint {
  return {
    cycleMonth: '2026-07-01',
    label: 'Jul',
    billedCents: opts.billedCents,
    collectedCents: opts.collectedCents,
    outstandingCents: opts.outstandingCents ?? 0,
    lateCents: 0,
  };
}

function snapshot(opts: {
  propertyId?: string;
  collectionRatePct: number | null;
  occupancyRatePct?: number | null;
  riskLevel?: PropertyFinancialSnapshot['riskLevel'];
  rentOutstandingCents?: MoneyCents;
}): PropertyFinancialSnapshot {
  return {
    propertyId: opts.propertyId ?? 'prop-1',
    propertyName: 'Test Property',
    units: 4,
    occupiedUnits: 3,
    rentBilledCents: 100000,
    rentCollectedCents: 75000,
    rentOutstandingCents: opts.rentOutstandingCents ?? 25000,
    rentLateCents: 0,
    maintenanceSpendCents: null,
    vendorSpendCents: null,
    otherExpenseCents: null,
    operatingExpenseCents: null,
    noiCents: null,
    marginPct: null,
    collectionRatePct: opts.collectionRatePct,
    occupancyRatePct: opts.occupancyRatePct === undefined ? 75 : opts.occupancyRatePct,
    riskLevel: opts.riskLevel ?? 'healthy',
    riskReasons: [],
  };
}

describe('financials/chart', () => {
  describe('niceAxis', () => {
    it('should ceil-trim $20,525 to a $25k axis with $5k ticks, never $40k', () => {
      expect(niceAxis(2052500)).toEqual({
        axisMaxCents: 2500000,
        tickCents: [0, 500000, 1000000, 1500000, 2000000, 2500000],
      });
    });

    it('should land the top tick exactly on a round $20k max', () => {
      expect(niceAxis(2000000)).toEqual({
        axisMaxCents: 2000000,
        tickCents: [0, 500000, 1000000, 1500000, 2000000],
      });
    });

    it('should trim trailing empty segments instead of padding to segments × step', () => {
      // $321.50 max → step $100, only 4 of 5 segments needed → axis $400.
      expect(niceAxis(32150)).toEqual({
        axisMaxCents: 40000,
        tickCents: [0, 10000, 20000, 30000, 40000],
      });
    });

    it('should honor a custom segment count', () => {
      expect(niceAxis(100000, 4)).toEqual({
        axisMaxCents: 100000,
        tickCents: [0, 25000, 50000, 75000, 100000],
      });
    });

    it('should stay sane for tiny maxes under $10', () => {
      expect(niceAxis(850)).toEqual({
        axisMaxCents: 1000,
        tickCents: [0, 200, 400, 600, 800, 1000],
      });
    });

    it('should stay sane for large maxes like $1.2M', () => {
      expect(niceAxis(120000000)).toEqual({
        axisMaxCents: 125000000,
        tickCents: [0, 25000000, 50000000, 75000000, 100000000, 125000000],
      });
    });

    it('should return a sane small axis when max is zero or negative', () => {
      expect(niceAxis(0)).toEqual({
        axisMaxCents: 100,
        tickCents: [0, 20, 40, 60, 80, 100],
      });
      expect(niceAxis(-500)).toEqual({
        axisMaxCents: 100,
        tickCents: [0, 20, 40, 60, 80, 100],
      });
    });

    it('should follow a single outlier month and keep every tick a whole nice step', () => {
      // Series maxes are fed in directly; an outlier just raises the axis.
      for (const maxCents of [2052500, 1234567, 99999, 730000]) {
        const { axisMaxCents, tickCents } = niceAxis(maxCents);
        expect(axisMaxCents).toBeGreaterThanOrEqual(maxCents);
        const step = tickCents[1];
        // Step is {1, 2, 2.5, 5} × 10^k — no $22k/$23k-style labels.
        const mantissa = step / 10 ** Math.floor(Math.log10(step));
        expect([1, 2, 2.5, 5]).toContain(mantissa);
        tickCents.forEach((tick, i) => expect(tick).toBe(i * step));
        expect(tickCents[tickCents.length - 1]).toBe(axisMaxCents);
        expect(tickCents.length).toBeLessThanOrEqual(6);
      }
    });
  });

  describe('monthRatePct', () => {
    it('should return the collected/billed percent', () => {
      expect(monthRatePct(point({ billedCents: 20000, collectedCents: 15000 }))).toBe(75);
    });

    it('should return null when nothing was billed', () => {
      expect(monthRatePct(point({ billedCents: 0, collectedCents: 5000 }))).toBeNull();
      expect(monthRatePct(point({ billedCents: -100, collectedCents: 0 }))).toBeNull();
    });

    it('should pass through rates above 100 without clamping', () => {
      expect(monthRatePct(point({ billedCents: 10000, collectedCents: 12500 }))).toBe(125);
    });
  });

  describe('currentMonthGap', () => {
    it('should return the last point outstanding balance when open', () => {
      const series = [
        point({ billedCents: 10000, collectedCents: 10000 }),
        point({ billedCents: 20000, collectedCents: 15000, outstandingCents: 5000 }),
      ];
      expect(currentMonthGap(series)).toEqual({ outstandingCents: 5000 });
    });

    it('should return null when the current month is settled', () => {
      const series = [point({ billedCents: 20000, collectedCents: 20000, outstandingCents: 0 })];
      expect(currentMonthGap(series)).toBeNull();
    });

    it('should return null for an empty series', () => {
      expect(currentMonthGap([])).toBeNull();
    });
  });

  describe('buildPropertyMarks', () => {
    it('should route null collection rate to unbilled and never plot it', () => {
      const { plotted, unbilled } = buildPropertyMarks([
        snapshot({ propertyId: 'billed', collectionRatePct: 74.7 }),
        snapshot({ propertyId: 'vacant', collectionRatePct: null, occupancyRatePct: 0 }),
      ]);
      expect(plotted.map((m) => m.propertyId)).toEqual(['billed']);
      expect(unbilled.map((m) => m.propertyId)).toEqual(['vacant']);
      expect(unbilled[0].collectionPct).toBeNull();
    });

    it('should default a null occupancy rate to 0 and carry snapshot fields', () => {
      const { plotted } = buildPropertyMarks([
        snapshot({
          propertyId: 'p1',
          collectionRatePct: 50,
          occupancyRatePct: null,
          riskLevel: 'attention',
          rentOutstandingCents: 12300,
        }),
      ]);
      expect(plotted[0]).toEqual({
        propertyId: 'p1',
        propertyName: 'Test Property',
        occupancyPct: 0,
        collectionPct: 50,
        riskLevel: 'attention',
        occupiedUnits: 3,
        units: 4,
        outstandingCents: 12300,
      });
    });
  });

  describe('buildCumulativePace', () => {
    const month = (
      cycleMonth: string,
      label: string,
      billedCents: MoneyCents,
      collectedCents: MoneyCents,
    ): MonthlyRentPoint => ({
      cycleMonth,
      label,
      billedCents,
      collectedCents,
      outstandingCents: Math.max(0, billedCents - collectedCents),
      lateCents: 0,
    });

    it('should return [] for an empty series', () => {
      expect(buildCumulativePace([])).toEqual([]);
    });

    it('should echo a single month with gap = billed − collected', () => {
      expect(buildCumulativePace([month('2026-07-01', 'Jul', 2060000, 1540000)])).toEqual([
        {
          cycleMonth: '2026-07-01',
          label: 'Jul',
          cumBilledCents: 2060000,
          cumCollectedCents: 1540000,
          gapCents: 520000,
        },
      ]);
    });

    it('should prefix-sum the 3-month Galaxy shape and open the $5.2k gap in July', () => {
      const pace = buildCumulativePace([
        month('2026-05-01', 'May', 2050000, 2050000),
        month('2026-06-01', 'Jun', 2050000, 2050000),
        month('2026-07-01', 'Jul', 2060000, 1540000),
      ]);
      expect(pace.map((p) => p.gapCents)).toEqual([0, 0, 520000]);
      expect(pace[2]).toEqual({
        cycleMonth: '2026-07-01',
        label: 'Jul',
        cumBilledCents: 6160000,
        cumCollectedCents: 5640000,
        gapCents: 520000,
      });
    });

    it('should clamp the gap to zero when cumulative collected exceeds billed', () => {
      const pace = buildCumulativePace([
        month('2026-06-01', 'Jun', 1000000, 1200000),
        month('2026-07-01', 'Jul', 1000000, 900000),
      ]);
      expect(pace[0].gapCents).toBe(0);
      // Overpay carries: cum billed 2,000,000 vs collected 2,100,000 → still 0.
      expect(pace[1].gapCents).toBe(0);
      expect(pace[1].cumCollectedCents).toBe(2100000);
    });
  });

  describe('buildRentCoverageSegments', () => {
    it('should split Galaxy 16/12/2 into 10 current / 2 late / 4 vacant with exact labels', () => {
      expect(
        buildRentCoverageSegments({ unitCount: 16, occupiedUnitCount: 12, lateLeaseCount: 2 }),
      ).toEqual([
        { id: 'current', units: 10, pct: 62.5, label: '10 units current' },
        { id: 'late', units: 2, pct: 12.5, label: '2 units late' },
        { id: 'vacant', units: 4, pct: 25, label: '4 units vacant' },
      ]);
    });

    it('should return [] when the portfolio has no units', () => {
      expect(
        buildRentCoverageSegments({ unitCount: 0, occupiedUnitCount: 0, lateLeaseCount: 0 }),
      ).toEqual([]);
      expect(
        buildRentCoverageSegments({ unitCount: -3, occupiedUnitCount: 2, lateLeaseCount: 1 }),
      ).toEqual([]);
    });

    it('should clamp late to occupied instead of going negative on current', () => {
      const segments = buildRentCoverageSegments({
        unitCount: 4,
        occupiedUnitCount: 2,
        lateLeaseCount: 5,
      });
      expect(segments.map((s) => s.units)).toEqual([0, 2, 2]);
      expect(segments.map((s) => s.id)).toEqual(['current', 'late', 'vacant']);
    });

    it('should use singular labels for single-unit segments', () => {
      expect(
        buildRentCoverageSegments({ unitCount: 3, occupiedUnitCount: 2, lateLeaseCount: 1 }).map(
          (s) => s.label,
        ),
      ).toEqual(['1 unit current', '1 unit late', '1 unit vacant']);
    });

    it('should never describe a segment as collected (status, not payment evidence)', () => {
      const segments = buildRentCoverageSegments({
        unitCount: 16,
        occupiedUnitCount: 12,
        lateLeaseCount: 2,
      });
      expect(segments.some((s) => s.label.toLowerCase().includes('collected'))).toBe(false);
    });
  });

  describe('formatMoneyCentsShort', () => {
    it('should format tick amounts across magnitudes', () => {
      expect(formatMoneyCentsShort(3200000)).toBe('$32k');
      expect(formatMoneyCentsShort(150000)).toBe('$1.5k');
      expect(formatMoneyCentsShort(80000)).toBe('$800');
    });

    it('should keep one decimal for non-whole thousands under $100k', () => {
      expect(formatMoneyCentsShort(2052500)).toBe('$20.5k');
      expect(formatMoneyCentsShort(1532500)).toBe('$15.3k');
      expect(formatMoneyCentsShort(520000)).toBe('$5.2k');
    });

    it('should keep whole thousands clean', () => {
      expect(formatMoneyCentsShort(2500000)).toBe('$25k');
      expect(formatMoneyCentsShort(500000)).toBe('$5k');
    });

    it('should render zero as $0', () => {
      expect(formatMoneyCentsShort(0)).toBe('$0');
    });

    it('should keep a leading minus on negatives', () => {
      expect(formatMoneyCentsShort(-150000)).toBe('-$1.5k');
      expect(formatMoneyCentsShort(-80000)).toBe('-$800');
    });
  });
});
