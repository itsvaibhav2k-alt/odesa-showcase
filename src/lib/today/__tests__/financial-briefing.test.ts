/**
 * Tests for the pure Today financial-briefing transform.
 *
 * `buildTodayFinancialBriefing` folds a typed `PortfolioFinancialSummary`
 * (from `@/lib/financials`) into the compact, high-signal shape the
 * Today morning console renders. It is pure and deterministic, so it is
 * tested without any Supabase stub — realistic summaries are produced via
 * the financial `buildPortfolioSummary` fold.
 */

import { describe, expect, it } from 'vitest';

import type { DerivedRentCycleStatus } from '@/lib/domain/rent-cycle';
import {
  buildPortfolioSummary,
  type DerivedRentRow,
  type PortfolioSummaryInput,
} from '@/lib/financials/summary';
import type { FinancialPeriod } from '@/lib/financials/types';
import { buildTodayFinancialBriefing } from '../financial-briefing';

const PERIOD: FinancialPeriod = {
  startDate: '2026-06-01',
  endDate: '2026-06-30',
  label: 'June 2026',
};

function makeRow(
  billedCents: number,
  collectedCents: number,
  opts: { late?: boolean } = {},
): DerivedRentRow {
  const balanceCents = Math.max(0, billedCents - collectedCents);
  const status: DerivedRentCycleStatus = {
    kind: opts.late ? 'late' : balanceCents > 0 ? 'due' : 'paid',
    label: 'test',
    isOutstanding: balanceCents > 0,
    isLate: opts.late ?? false,
    isEscalated: false,
    isOnPlan: false,
    daysLate: opts.late ? 11 : 0,
    balanceCents,
  };
  return { billedCents, collectedCents, status };
}

function summaryOf(input: Partial<PortfolioSummaryInput>) {
  return buildPortfolioSummary({
    period: PERIOD,
    properties: [],
    ...input,
  });
}

describe('buildTodayFinancialBriefing', () => {
  describe('empty portfolio', () => {
    it('renders a muted, honest briefing when no properties exist', () => {
      const briefing = buildTodayFinancialBriefing(summaryOf({ properties: [] }));

      expect(briefing.periodLabel).toBe('June 2026');
      expect(briefing.hasBilled).toBe(false);
      expect(briefing.collectionsTone).toBe('muted');
      expect(briefing.topException).toBeNull();
      expect(briefing.expensesConnected).toBe(false);
    });
  });

  describe('collections tone', () => {
    it('reads green when collection rate is at or above 95%', () => {
      const briefing = buildTodayFinancialBriefing(
        summaryOf({
          properties: [
            {
              propertyId: 'p1',
              propertyName: 'Maple Court',
              units: 4,
              occupiedUnits: 4,
              rentRows: [makeRow(100_000, 100_000)],
            },
          ],
        }),
      );

      expect(briefing.hasBilled).toBe(true);
      expect(briefing.collectionRatePct).toBe(100);
      expect(briefing.collectionsTone).toBe('green');
    });

    it('reads amber when collection rate is between 85% and 95%', () => {
      const briefing = buildTodayFinancialBriefing(
        summaryOf({
          properties: [
            {
              propertyId: 'p1',
              propertyName: 'Maple Court',
              units: 4,
              occupiedUnits: 4,
              rentRows: [makeRow(100_000, 90_000)],
            },
          ],
        }),
      );

      expect(briefing.collectionRatePct).toBe(90);
      expect(briefing.collectionsTone).toBe('amber');
    });

    it('reads clay when collection rate is below 85%', () => {
      const briefing = buildTodayFinancialBriefing(
        summaryOf({
          properties: [
            {
              propertyId: 'p1',
              propertyName: 'Maple Court',
              units: 4,
              occupiedUnits: 4,
              rentRows: [makeRow(100_000, 50_000, { late: true })],
            },
          ],
        }),
      );

      expect(briefing.collectionsTone).toBe('clay');
    });

    it('reads muted when nothing has been billed', () => {
      const briefing = buildTodayFinancialBriefing(
        summaryOf({
          properties: [
            {
              propertyId: 'p1',
              propertyName: 'Maple Court',
              units: 4,
              occupiedUnits: 4,
              rentRows: [],
            },
          ],
        }),
      );

      expect(briefing.hasBilled).toBe(false);
      expect(briefing.collectionsTone).toBe('muted');
    });
  });

  describe('late-rent exposure', () => {
    it('surfaces late and outstanding cents straight from the summary', () => {
      const briefing = buildTodayFinancialBriefing(
        summaryOf({
          properties: [
            {
              propertyId: 'p1',
              propertyName: 'Maple Court',
              units: 4,
              occupiedUnits: 4,
              rentRows: [makeRow(100_000, 40_000, { late: true })],
            },
          ],
        }),
      );

      expect(briefing.rentLateCents).toBe(60_000);
      expect(briefing.rentOutstandingCents).toBe(60_000);
    });
  });

  describe('biggest money exception', () => {
    it('picks the largest money-shaped exception across properties', () => {
      const briefing = buildTodayFinancialBriefing(
        summaryOf({
          properties: [
            {
              propertyId: 'p1',
              propertyName: 'Maple Court',
              units: 4,
              occupiedUnits: 4,
              rentRows: [makeRow(100_000, 90_000, { late: true })],
            },
            {
              propertyId: 'p2',
              propertyName: 'Birch Lane',
              units: 4,
              occupiedUnits: 4,
              rentRows: [makeRow(100_000, 20_000, { late: true })],
            },
          ],
        }),
      );

      expect(briefing.topException).not.toBeNull();
      expect(briefing.topException?.propertyId).toBe('p2');
      expect(briefing.topException?.amountCents).toBe(80_000);
      expect(briefing.topException?.title).toContain('Birch Lane');
    });

    it('returns null when the only exception carries no money amount', () => {
      // Fully collected + fully occupied → only the info "expense imports"
      // exception remains, which has no amountCents.
      const briefing = buildTodayFinancialBriefing(
        summaryOf({
          properties: [
            {
              propertyId: 'p1',
              propertyName: 'Maple Court',
              units: 4,
              occupiedUnits: 4,
              rentRows: [makeRow(100_000, 100_000)],
            },
          ],
        }),
      );

      expect(briefing.topException).toBeNull();
    });
  });

  describe('watching-quietly financial signal', () => {
    it('watches occupancy when units are vacant', () => {
      const briefing = buildTodayFinancialBriefing(
        summaryOf({
          properties: [
            {
              propertyId: 'p1',
              propertyName: 'Maple Court',
              units: 10,
              occupiedUnits: 6,
              rentRows: [makeRow(100_000, 100_000)],
            },
          ],
        }),
      );

      expect(briefing.watch.title).toBe('Occupancy');
      expect(briefing.watch.meta).toContain('6 of 10');
      expect(briefing.watch.tone).toBe('clay');
    });

    it('falls back to the honest expense-imports note when occupancy is healthy', () => {
      const briefing = buildTodayFinancialBriefing(
        summaryOf({
          properties: [
            {
              propertyId: 'p1',
              propertyName: 'Maple Court',
              units: 10,
              occupiedUnits: 10,
              rentRows: [makeRow(100_000, 100_000)],
            },
          ],
        }),
      );

      expect(briefing.expensesConnected).toBe(false);
      expect(briefing.watch.title).toBe('Expense imports');
      expect(briefing.watch.tone).toBe('muted');
    });
  });
});
