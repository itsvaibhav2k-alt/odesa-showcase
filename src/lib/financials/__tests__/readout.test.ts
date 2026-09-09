/**
 * Unit tests for the deterministic financial readout (NOT LLM).
 *
 * `buildFinancialReadout` turns a portfolio summary into 3–5 plain
 * sentences. It must stay honest: when expenses aren't connected it says
 * so rather than implying a margin.
 */

import { describe, expect, it } from 'vitest';

import { deriveRentCycleStatus } from '@/lib/domain/rent-cycle';
import { buildFinancialReadout, buildOperatorSummary } from '../readout';
import { buildPortfolioSummary, type DerivedRentRow, type PropertySnapshotInput } from '../summary';
import type { AgingBucket, PeriodTotals } from '../trend';
import type { FinancialPeriod, MoneyCents } from '../types';

const PERIOD: FinancialPeriod = {
  startDate: '2026-06-01',
  endDate: '2026-06-30',
  label: 'June 2026',
};

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
    todayIso: '2026-06-15',
  });
  return { billedCents, collectedCents, status };
}

const paid = (cents: MoneyCents): DerivedRentRow => row(cents, cents);
const late = (billed: MoneyCents): DerivedRentRow =>
  row(billed, 0, { status: 'late_3', dueDate: '2026-06-01' });

function property(overrides: Partial<PropertySnapshotInput> = {}): PropertySnapshotInput {
  return {
    propertyId: 'p1',
    propertyName: 'Maple Court',
    units: 2,
    occupiedUnits: 2,
    rentRows: [paid(150000), paid(150000)],
    ...overrides,
  };
}

describe('financials/readout', () => {
  it('should produce 3–5 plain lines for a populated portfolio', () => {
    const summary = buildPortfolioSummary({ period: PERIOD, properties: [property()] });
    const lines = buildFinancialReadout(summary);
    expect(lines.length).toBeGreaterThanOrEqual(3);
    expect(lines.length).toBeLessThanOrEqual(5);
    expect(lines.every((line) => typeof line === 'string' && line.length > 0)).toBe(true);
  });

  it('should lead with a collections line', () => {
    const summary = buildPortfolioSummary({ period: PERIOD, properties: [property()] });
    const lines = buildFinancialReadout(summary);
    expect(lines.some((line) => line.includes('Collected'))).toBe(true);
    expect(lines.some((line) => line.includes('June 2026'))).toBe(true);
  });

  it('should report occupancy', () => {
    const summary = buildPortfolioSummary({ period: PERIOD, properties: [property()] });
    expect(buildFinancialReadout(summary).some((line) => line.includes('occupied'))).toBe(true);
  });

  it('should state honestly that expenses are not connected', () => {
    const summary = buildPortfolioSummary({ period: PERIOD, properties: [property()] });
    expect(
      buildFinancialReadout(summary).some((line) =>
        line.toLowerCase().includes('expense imports'),
      ),
    ).toBe(true);
  });

  it('should surface the largest money exception', () => {
    const summary = buildPortfolioSummary({
      period: PERIOD,
      properties: [
        property(),
        property({ propertyId: 'bad', propertyName: 'Bad House', rentRows: [late(300000)] }),
      ],
    });
    const lines = buildFinancialReadout(summary);
    expect(lines.some((line) => line.includes('Bad House') || line.includes('$3,000'))).toBe(true);
  });

  it('should stay honest and short for an empty portfolio', () => {
    const summary = buildPortfolioSummary({ period: PERIOD, properties: [] });
    const lines = buildFinancialReadout(summary);
    expect(lines.length).toBeGreaterThanOrEqual(1);
    expect(lines.length).toBeLessThanOrEqual(5);
    expect(lines.some((line) => line.toLowerCase().includes('no properties'))).toBe(true);
  });

  it('should be deterministic for identical input', () => {
    const input = { period: PERIOD, properties: [property()] };
    const a = buildFinancialReadout(buildPortfolioSummary(input));
    const b = buildFinancialReadout(buildPortfolioSummary(input));
    expect(a).toEqual(b);
  });
});

function totals(overrides: Partial<PeriodTotals> = {}): PeriodTotals {
  return {
    billedCents: 0,
    collectedCents: 0,
    outstandingCents: 0,
    lateCents: 0,
    lateLeaseCount: 0,
    ...overrides,
  };
}

function aging(
  nonzero: Partial<Record<AgingBucket['id'], { cents: MoneyCents; count: number }>> = {},
): AgingBucket[] {
  const defs = [
    { id: 'current', label: 'Current' },
    { id: 'd1_7', label: '1–7 days' },
    { id: 'd8_30', label: '8–30 days' },
    { id: 'd31_plus', label: '31+ days' },
  ] as const;
  return defs.map((def) => ({
    id: def.id,
    label: def.label,
    cents: nonzero[def.id]?.cents ?? 0,
    count: nonzero[def.id]?.count ?? 0,
  }));
}

describe('financials/readout buildOperatorSummary', () => {
  it('should name the collection rate and the top outstanding-driver property for the Galaxy shape', () => {
    const summary = buildPortfolioSummary({
      period: PERIOD,
      properties: [
        property({
          propertyId: 'seventeenth',
          propertyName: '17th Street Row',
          units: 3,
          occupiedUnits: 3,
          rentRows: [late(520000), paid(230000)],
        }),
        property({ propertyId: 'oakwood', propertyName: 'Oakwood', rentRows: [paid(1300000)] }),
        property({
          propertyId: 'winchester',
          propertyName: 'Winchester Building 1',
          units: 4,
          occupiedUnits: 0,
          rentRows: [],
        }),
        property({
          propertyId: 'vaibhavs',
          propertyName: "Vaibhav's House",
          units: 1,
          occupiedUnits: 0,
          rentRows: [],
        }),
      ],
    });
    const result = buildOperatorSummary(
      summary,
      totals({
        billedCents: 1000000,
        collectedCents: 747000,
        outstandingCents: 520000,
        lateCents: 520000,
        lateLeaseCount: 2,
      }),
      aging({ d1_7: { cents: 520000, count: 2 } }),
    );

    expect(result.whatChanged).toContain('74.7%');
    expect(result.whatChanged).toContain('17th Street Row');
    expect(result.whatChanged).toContain('$5,200');

    expect(result.whyItMatters).toContain('2 tenants');
    expect(result.whyItMatters).toContain('1–7 days');
    expect(result.whyItMatters).toContain('reminder territory, not escalation');

    expect(result.recommendedMove).toContain('reminder draft');
    expect(result.recommendedMove).toContain('Winchester Building 1');
    expect(result.recommendedMove).toContain("Vaibhav's House");
    expect(result.recommendedMove).toContain('listing work, not collection failure');
  });

  it('should use the celebratory-calm variant when nothing is outstanding', () => {
    const summary = buildPortfolioSummary({ period: PERIOD, properties: [property()] });
    const result = buildOperatorSummary(
      summary,
      totals({ billedCents: 300000, collectedCents: 300000 }),
      aging(),
    );
    expect(result.whatChanged).toContain('100%');
    expect(result.whyItMatters.toLowerCase()).toContain('nothing is outstanding');
    expect(result.recommendedMove.toLowerCase()).toContain('no collection work');
  });

  it('should stay honest when nothing has been billed yet', () => {
    const summary = buildPortfolioSummary({
      period: PERIOD,
      properties: [property({ rentRows: [] })],
    });
    const result = buildOperatorSummary(summary, totals(), aging());
    expect(result.whatChanged).toContain('No rent has been billed in June 2026');
    expect(result.recommendedMove).toContain('June 2026');
  });

  it('should report an empty portfolio without inventing numbers', () => {
    const summary = buildPortfolioSummary({ period: PERIOD, properties: [] });
    const result = buildOperatorSummary(summary, totals(), aging());
    expect(result.whatChanged).toContain('No properties');
    expect(result.whatChanged).not.toMatch(/\$|%/);
    expect(result.recommendedMove.toLowerCase()).toContain('add a property');
  });

  it('should get firmer when the oldest nonzero bucket is 31+ days', () => {
    const summary = buildPortfolioSummary({
      period: PERIOD,
      properties: [
        property({ propertyName: 'Bad House', rentRows: [late(300000)] }),
      ],
    });
    const result = buildOperatorSummary(
      summary,
      totals({ billedCents: 300000, collectedCents: 0, outstandingCents: 300000 }),
      aging({ d31_plus: { cents: 300000, count: 1 } }),
    );
    expect(result.whyItMatters).toContain('31+ days');
    expect(result.whyItMatters).toContain('1 tenant in');
    expect(result.whyItMatters.toLowerCase()).toContain('escalation');
    expect(result.whyItMatters).not.toContain('reminder territory');
    expect(result.recommendedMove.toLowerCase()).toContain('escalation');
  });

  it('should be deterministic for identical input', () => {
    const build = (): ReturnType<typeof buildOperatorSummary> =>
      buildOperatorSummary(
        buildPortfolioSummary({ period: PERIOD, properties: [property()] }),
        totals({ billedCents: 300000, collectedCents: 300000 }),
        aging(),
      );
    expect(build()).toEqual(build());
  });
});
