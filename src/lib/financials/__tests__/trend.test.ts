/**
 * Unit tests for the pure trend / aging / period math.
 *
 * Rows are built through the canonical `deriveRentCycleStatus` (like
 * summary.test.ts) so the division of labour is exercised end to end:
 * lateness/balance come from the domain module, trend.ts only groups and
 * sums. Also covers `formatSignedMoneyCents` (consumed by the same
 * console; format.ts has no dedicated spec file).
 */

import { describe, expect, it } from 'vitest';

import { deriveRentCycleStatus } from '@/lib/domain/rent-cycle';
import { formatSignedMoneyCents } from '../format';
import {
  buildAgingBuckets,
  buildMonthlySeries,
  parsePeriodKey,
  periodTotals,
  resolvePeriodCycles,
  type CycleRowInput,
} from '../trend';
import type { MoneyCents } from '../types';

const TODAY = '2026-07-15';
const CURRENT = '2026-07-01';

/** Build a flat derived row from cycle facts (canonical derivation). */
function cycleRow(opts: {
  leaseId?: string;
  cycleMonth: string;
  billedCents: MoneyCents;
  collectedCents?: MoneyCents;
  status?: string;
  dueDate?: string | null;
}): CycleRowInput {
  const collectedCents = opts.collectedCents ?? 0;
  return {
    leaseId: opts.leaseId ?? 'lease-1',
    cycleMonth: opts.cycleMonth,
    billedCents: opts.billedCents,
    collectedCents,
    status: deriveRentCycleStatus({
      status: (opts.status ?? 'pending') as never,
      dueDate: opts.dueDate ?? null,
      amountDueCents: opts.billedCents,
      amountPaidCents: collectedCents,
      todayIso: TODAY,
    }),
  };
}

const paid = (cycleMonth: string, cents: MoneyCents, leaseId = 'lease-1'): CycleRowInput =>
  cycleRow({ leaseId, cycleMonth, billedCents: cents, collectedCents: cents });

/** Unpaid row whose dueDate puts it exactly `daysLate` days overdue. */
const overdue = (dueDate: string, cents: MoneyCents, leaseId: string): CycleRowInput =>
  cycleRow({ leaseId, cycleMonth: CURRENT, billedCents: cents, dueDate });

describe('financials/trend', () => {
  describe('parsePeriodKey', () => {
    it('should return each valid key unchanged', () => {
      expect(parsePeriodKey('mtd')).toBe('mtd');
      expect(parsePeriodKey('last')).toBe('last');
      expect(parsePeriodKey('qtd')).toBe('qtd');
      expect(parsePeriodKey('ytd')).toBe('ytd');
    });

    it('should fall back to mtd for invalid or missing input', () => {
      expect(parsePeriodKey('bogus')).toBe('mtd');
      expect(parsePeriodKey('')).toBe('mtd');
      expect(parsePeriodKey(undefined)).toBe('mtd');
    });
  });

  describe('buildMonthlySeries', () => {
    it('should group rows by month and sum billed/collected/outstanding/late', () => {
      const series = buildMonthlySeries(
        [
          paid('2026-06-01', 150000),
          paid(CURRENT, 150000, 'lease-a'),
          cycleRow({
            leaseId: 'lease-b',
            cycleMonth: CURRENT,
            billedCents: 100000,
            dueDate: '2026-07-01',
          }),
        ],
        CURRENT,
      );
      expect(series.map((p) => p.cycleMonth)).toEqual(['2026-06-01', CURRENT]);
      const july = series[1];
      expect(july.billedCents).toBe(250000);
      expect(july.collectedCents).toBe(150000);
      expect(july.outstandingCents).toBe(100000);
      expect(july.lateCents).toBe(100000);
    });

    it('should fill gap months with zeros inside the observed window', () => {
      const series = buildMonthlySeries(
        [paid('2026-03-01', 100000), paid(CURRENT, 100000)],
        CURRENT,
      );
      expect(series.map((p) => p.cycleMonth)).toEqual([
        '2026-03-01', '2026-04-01', '2026-05-01', '2026-06-01', CURRENT,
      ]);
      expect(series[1].billedCents).toBe(0);
      expect(series[1].collectedCents).toBe(0);
    });

    it('should never emit months before the earliest observed row', () => {
      const series = buildMonthlySeries(
        [paid('2026-05-01', 100000), paid(CURRENT, 100000)],
        CURRENT,
      );
      expect(series).toHaveLength(3);
      expect(series[0].cycleMonth).toBe('2026-05-01');
    });

    it('should cap the series at 12 months ending at the current cycle', () => {
      const series = buildMonthlySeries(
        [paid('2025-01-01', 100000), paid(CURRENT, 100000)],
        CURRENT,
      );
      expect(series).toHaveLength(12);
      expect(series[0].cycleMonth).toBe('2025-08-01');
      expect(series[11].cycleMonth).toBe(CURRENT);
      // the pre-window row is excluded, not smeared into the window
      expect(series[0].billedCents).toBe(0);
    });

    it('should honour a custom maxMonths cap', () => {
      const series = buildMonthlySeries(
        [paid('2026-01-01', 100000), paid(CURRENT, 100000)],
        CURRENT,
        3,
      );
      expect(series.map((p) => p.cycleMonth)).toEqual(['2026-05-01', '2026-06-01', CURRENT]);
    });

    it('should label months, adding the year only when it differs', () => {
      const series = buildMonthlySeries(
        [paid('2025-12-01', 100000), paid(CURRENT, 100000)],
        CURRENT,
      );
      expect(series[0].label).toBe('Dec ’25');
      expect(series[series.length - 1].label).toBe('Jul');
    });

    it('should return an empty series for no rows (no fabricated history)', () => {
      expect(buildMonthlySeries([], CURRENT)).toEqual([]);
    });

    it('should ignore rows after the current cycle', () => {
      expect(buildMonthlySeries([paid('2026-08-01', 100000)], CURRENT)).toEqual([]);
    });
  });

  describe('buildAgingBuckets', () => {
    it('should always return all four buckets, zeroed when empty', () => {
      const buckets = buildAgingBuckets([]);
      expect(buckets.map((b) => b.id)).toEqual(['current', 'd1_7', 'd8_30', 'd31_plus']);
      expect(buckets.every((b) => b.cents === 0 && b.count === 0)).toBe(true);
    });

    it('should bucket by daysLate with correct boundaries (0,1,7,8,30,31)', () => {
      const buckets = buildAgingBuckets([
        // balance > 0, due in the future → daysLate 0 → current
        cycleRow({ leaseId: 'l0', cycleMonth: CURRENT, billedCents: 10000, dueDate: '2026-07-31' }),
        overdue('2026-07-14', 20000, 'l1'), // 1 day late
        overdue('2026-07-08', 30000, 'l7'), // 7 days late
        overdue('2026-07-07', 40000, 'l8'), // 8 days late
        overdue('2026-06-15', 50000, 'l30'), // 30 days late
        overdue('2026-06-14', 60000, 'l31'), // 31 days late
      ]);
      const byId = Object.fromEntries(buckets.map((b) => [b.id, b]));
      expect(byId.current).toMatchObject({ cents: 10000, count: 1 });
      expect(byId.d1_7).toMatchObject({ cents: 50000, count: 2 });
      expect(byId.d8_30).toMatchObject({ cents: 90000, count: 2 });
      expect(byId.d31_plus).toMatchObject({ cents: 60000, count: 1 });
    });

    it('should place escalated rows by their (floored) daysLate', () => {
      const buckets = buildAgingBuckets([
        // escalated, no due date → daysLate floor 7 → d1_7
        cycleRow({ leaseId: 'e1', cycleMonth: CURRENT, billedCents: 10000, status: 'escalated' }),
        // escalated, 44 days past due → d31_plus
        cycleRow({
          leaseId: 'e2',
          cycleMonth: '2026-06-01',
          billedCents: 20000,
          status: 'escalated',
          dueDate: '2026-06-01',
        }),
      ]);
      const byId = Object.fromEntries(buckets.map((b) => [b.id, b]));
      expect(byId.d1_7).toMatchObject({ cents: 10000, count: 1 });
      expect(byId.d31_plus).toMatchObject({ cents: 20000, count: 1 });
    });

    it('should exclude rows with no balance and count leases distinctly', () => {
      const buckets = buildAgingBuckets([
        paid(CURRENT, 150000, 'paid-lease'),
        overdue('2026-07-10', 10000, 'same-lease'),
        overdue('2026-07-12', 15000, 'same-lease'),
      ]);
      const byId = Object.fromEntries(buckets.map((b) => [b.id, b]));
      expect(byId.d1_7).toMatchObject({ cents: 25000, count: 1 });
      expect(buckets.reduce((n, b) => n + b.count, 0)).toBe(1);
    });
  });

  describe('resolvePeriodCycles', () => {
    it('should resolve mtd to the current month with the previous as prior', () => {
      const resolved = resolvePeriodCycles('mtd', CURRENT);
      expect(resolved.cycleMonths).toEqual([CURRENT]);
      expect(resolved.priorCycleMonths).toEqual(['2026-06-01']);
      expect(resolved.period).toEqual({
        startDate: '2026-07-01',
        endDate: '2026-07-31',
        label: 'July 2026',
      });
    });

    it('should resolve last to the previous month', () => {
      const resolved = resolvePeriodCycles('last', CURRENT);
      expect(resolved.cycleMonths).toEqual(['2026-06-01']);
      expect(resolved.priorCycleMonths).toEqual(['2026-05-01']);
      expect(resolved.period).toEqual({
        startDate: '2026-06-01',
        endDate: '2026-06-30',
        label: 'June 2026',
      });
    });

    it('should resolve last across a year boundary', () => {
      const resolved = resolvePeriodCycles('last', '2026-01-01');
      expect(resolved.cycleMonths).toEqual(['2025-12-01']);
      expect(resolved.priorCycleMonths).toEqual(['2025-11-01']);
      expect(resolved.period.endDate).toBe('2025-12-31');
      expect(resolved.period.label).toBe('December 2025');
    });

    it('should resolve qtd at a quarter start to a single month', () => {
      const resolved = resolvePeriodCycles('qtd', CURRENT);
      expect(resolved.cycleMonths).toEqual([CURRENT]);
      expect(resolved.priorCycleMonths).toEqual(['2026-04-01']);
      expect(resolved.period.label).toBe('Q3 2026');
    });

    it('should resolve qtd mid-quarter with a same-length prior window', () => {
      const resolved = resolvePeriodCycles('qtd', '2026-08-01');
      expect(resolved.cycleMonths).toEqual(['2026-07-01', '2026-08-01']);
      expect(resolved.priorCycleMonths).toEqual(['2026-04-01', '2026-05-01']);
      expect(resolved.period).toEqual({
        startDate: '2026-07-01',
        endDate: '2026-08-31',
        label: 'Q3 2026',
      });
    });

    it('should resolve qtd in Q1 with a prior window in the previous year', () => {
      const resolved = resolvePeriodCycles('qtd', '2026-02-01');
      expect(resolved.cycleMonths).toEqual(['2026-01-01', '2026-02-01']);
      expect(resolved.priorCycleMonths).toEqual(['2025-10-01', '2025-11-01']);
      expect(resolved.period.label).toBe('Q1 2026');
    });

    it('should resolve ytd to January-through-current with last year as prior', () => {
      const resolved = resolvePeriodCycles('ytd', CURRENT);
      expect(resolved.cycleMonths).toHaveLength(7);
      expect(resolved.cycleMonths[0]).toBe('2026-01-01');
      expect(resolved.cycleMonths[6]).toBe(CURRENT);
      expect(resolved.priorCycleMonths).toHaveLength(7);
      expect(resolved.priorCycleMonths[0]).toBe('2025-01-01');
      expect(resolved.priorCycleMonths[6]).toBe('2025-07-01');
      expect(resolved.period).toEqual({
        startDate: '2026-01-01',
        endDate: '2026-07-31',
        label: '2026 YTD',
      });
    });

    it('should compute leap-year February end dates correctly', () => {
      const resolved = resolvePeriodCycles('mtd', '2028-02-01');
      expect(resolved.period.endDate).toBe('2028-02-29');
    });
  });

  describe('periodTotals', () => {
    it('should sum in-period rows and count distinct late leases', () => {
      const totals = periodTotals(
        [
          paid(CURRENT, 150000, 'a'),
          overdue('2026-07-01', 100000, 'b'),
          overdue('2026-07-05', 50000, 'b'),
        ],
        [CURRENT],
      );
      expect(totals.billedCents).toBe(300000);
      expect(totals.collectedCents).toBe(150000);
      expect(totals.outstandingCents).toBe(150000);
      expect(totals.lateCents).toBe(150000);
      expect(totals.lateLeaseCount).toBe(1);
    });

    it('should include prior-late balances in lateCents but not billed/outstanding', () => {
      const priorLate = cycleRow({
        leaseId: 'old',
        cycleMonth: '2026-05-01',
        billedCents: 80000,
        status: 'late_7',
        dueDate: '2026-05-01',
      });
      const totals = periodTotals([paid(CURRENT, 100000, 'a'), priorLate], [CURRENT]);
      expect(totals.billedCents).toBe(100000);
      expect(totals.outstandingCents).toBe(0);
      expect(totals.lateCents).toBe(80000);
      expect(totals.lateLeaseCount).toBe(1);
    });

    it('should exclude rows after the period entirely', () => {
      const totals = periodTotals(
        [paid('2026-06-01', 100000, 'a'), overdue('2026-07-01', 50000, 'b')],
        ['2026-06-01'],
      );
      expect(totals.billedCents).toBe(100000);
      expect(totals.lateCents).toBe(0);
      expect(totals.lateLeaseCount).toBe(0);
    });

    it('should count a lease late both in period and before it once', () => {
      const totals = periodTotals(
        [
          overdue('2026-07-01', 50000, 'same'),
          cycleRow({
            leaseId: 'same',
            cycleMonth: '2026-06-01',
            billedCents: 50000,
            dueDate: '2026-06-01',
          }),
        ],
        [CURRENT],
      );
      expect(totals.lateCents).toBe(100000);
      expect(totals.lateLeaseCount).toBe(1);
    });

    it('should return zeros for an empty period', () => {
      expect(periodTotals([paid(CURRENT, 100000)], [])).toEqual({
        billedCents: 0,
        collectedCents: 0,
        outstandingCents: 0,
        lateCents: 0,
        lateLeaseCount: 0,
      });
    });
  });

  describe('formatSignedMoneyCents', () => {
    it('should prefix positive deltas with a plus and group thousands', () => {
      expect(formatSignedMoneyCents(42000)).toBe('+$420');
      expect(formatSignedMoneyCents(145000)).toBe('+$1,450');
    });

    it('should use the true minus sign (U+2212) for negative deltas', () => {
      const formatted = formatSignedMoneyCents(-18000);
      expect(formatted).toBe('−$180');
      expect(formatted?.charCodeAt(0)).toBe(0x2212);
      expect(formatted?.startsWith('-')).toBe(false);
    });

    it('should return null for zero or unknown values', () => {
      expect(formatSignedMoneyCents(0)).toBeNull();
      expect(formatSignedMoneyCents(null)).toBeNull();
      expect(formatSignedMoneyCents(undefined)).toBeNull();
      expect(formatSignedMoneyCents(Number.NaN)).toBeNull();
    });
  });
});
