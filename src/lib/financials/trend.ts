/**
 * Pure trend / aging / period math for the financials console.
 *
 * No IO and no hidden clock: the current cycle month is injected as a
 * 'YYYY-MM-01' string and ALL month arithmetic is string-only (no Date
 * timezone traps). Lateness/balance are never computed here — each row
 * carries a `DerivedRentCycleStatus` from `src/lib/domain/rent-cycle.ts`
 * and this module only groups and sums those figures (integer cents).
 *
 * Honest-history invariant: the monthly series never emits months before
 * the org's first observed rent event — sparse history renders sparse,
 * never as fabricated $0 months.
 */

import type { DerivedRentCycleStatus } from '@/lib/domain/rent-cycle';

import type { FinancialPeriod, MoneyCents } from './types';

/** Selectable reporting window for the financials console. */
export type PeriodKey = 'mtd' | 'last' | 'qtd' | 'ytd';

/** All valid period keys, in display order. */
export const PERIOD_KEYS: readonly PeriodKey[] = ['mtd', 'last', 'qtd', 'ytd'];

/**
 * Parse a raw `?period=` search param into a {@link PeriodKey}.
 * Anything unrecognised (including `undefined`) falls back to `'mtd'`.
 */
export function parsePeriodKey(raw: string | undefined): PeriodKey {
  return (PERIOD_KEYS as readonly string[]).includes(raw ?? '') ? (raw as PeriodKey) : 'mtd';
}

/** Flat derived rent row collected at the IO boundary (queries.ts loop). */
export interface CycleRowInput {
  leaseId: string;
  /** 'YYYY-MM-01'. */
  cycleMonth: string;
  billedCents: MoneyCents;
  collectedCents: MoneyCents;
  /** Canonical derived status (balance/lateness live here). */
  status: DerivedRentCycleStatus;
}

/** One month of the collected-vs-billed trend. */
export interface MonthlyRentPoint {
  /** 'YYYY-MM-01'. */
  cycleMonth: string;
  /** 'Jul', or 'Jul ’25' when the year differs from the current cycle's. */
  label: string;
  billedCents: MoneyCents;
  collectedCents: MoneyCents;
  /** Sum of balances STILL owed today for that month's cycles. */
  outstandingCents: MoneyCents;
  lateCents: MoneyCents;
}

const MONTH_SHORT = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
] as const;

const MONTHS_FULL = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
] as const;

const CYCLE_RE = /^(\d{4})-(\d{2})-01$/;

/** Parse 'YYYY-MM-01' into numeric parts; null when malformed. */
function parseCycle(cycleIso: string): { year: number; month: number } | null {
  const match = CYCLE_RE.exec(cycleIso);
  if (!match) return null;
  const month = Number(match[2]);
  if (month < 1 || month > 12) return null;
  return { year: Number(match[1]), month };
}

/** 'YYYY-MM-01' from numeric year + 1-indexed month. */
function toCycleIso(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, '0')}-01`;
}

/** String-only month arithmetic on an ALREADY-VALID 'YYYY-MM-01'. */
function addMonths(cycleIso: string, delta: number): string {
  const parts = parseCycle(cycleIso);
  if (parts === null) return cycleIso;
  const index = parts.year * 12 + (parts.month - 1) + delta;
  return toCycleIso(Math.floor(index / 12), (index % 12) + 1);
}

/** 'Jul' for the current year, 'Jul ’25' otherwise. */
function monthShortLabel(cycleIso: string, currentYear: number): string {
  const parts = parseCycle(cycleIso);
  if (parts === null) return cycleIso;
  const short = MONTH_SHORT[parts.month - 1];
  if (parts.year === currentYear) return short;
  return `${short} ’${String(parts.year % 100).padStart(2, '0')}`;
}

/**
 * Fold flat derived rows into a contiguous monthly series ending at the
 * current cycle. Window: `max(earliest observed row, current − (maxMonths
 * − 1)) .. current`, with $0 fill ONLY for gap months inside that window
 * — months before the org's first rent event are never emitted. Rows
 * after the current cycle (or malformed) are ignored.
 *
 * @param rows - Flat derived rent rows (any order).
 * @param currentCycleIso - 'YYYY-MM-01' for the current cycle.
 * @param maxMonths - Series cap, default 12.
 * @returns Points in ascending month order; `[]` when nothing observed.
 */
export function buildMonthlySeries(
  rows: readonly CycleRowInput[],
  currentCycleIso: string,
  maxMonths = 12,
): MonthlyRentPoint[] {
  const current = parseCycle(currentCycleIso);
  if (current === null || maxMonths < 1) return [];

  const byMonth = new Map<
    string,
    { billedCents: number; collectedCents: number; outstandingCents: number; lateCents: number }
  >();
  let earliest: string | null = null;

  for (const row of rows) {
    if (parseCycle(row.cycleMonth) === null || row.cycleMonth > currentCycleIso) continue;
    if (earliest === null || row.cycleMonth < earliest) earliest = row.cycleMonth;
    const bucket = byMonth.get(row.cycleMonth) ?? {
      billedCents: 0,
      collectedCents: 0,
      outstandingCents: 0,
      lateCents: 0,
    };
    byMonth.set(row.cycleMonth, {
      billedCents: bucket.billedCents + row.billedCents,
      collectedCents: bucket.collectedCents + row.collectedCents,
      outstandingCents: bucket.outstandingCents + row.status.balanceCents,
      lateCents: bucket.lateCents + (row.status.isLate ? row.status.balanceCents : 0),
    });
  }

  if (earliest === null) return [];

  const capStart = addMonths(currentCycleIso, -(maxMonths - 1));
  const start = earliest > capStart ? earliest : capStart;

  const points: MonthlyRentPoint[] = [];
  for (let cursor = start; cursor <= currentCycleIso; cursor = addMonths(cursor, 1)) {
    const bucket = byMonth.get(cursor);
    points.push({
      cycleMonth: cursor,
      label: monthShortLabel(cursor, current.year),
      billedCents: bucket?.billedCents ?? 0,
      collectedCents: bucket?.collectedCents ?? 0,
      outstandingCents: bucket?.outstandingCents ?? 0,
      lateCents: bucket?.lateCents ?? 0,
    });
  }
  return points;
}

/** One delinquency aging bucket (as-of-today balances). */
export interface AgingBucket {
  id: 'current' | 'd1_7' | 'd8_30' | 'd31_plus';
  label: string;
  cents: MoneyCents;
  /** Distinct leases with a balance in this bucket. */
  count: number;
}

const AGING_DEFS = [
  { id: 'current', label: 'Current', minDays: 0, maxDays: 0 },
  { id: 'd1_7', label: '1–7 days', minDays: 1, maxDays: 7 },
  { id: 'd8_30', label: '8–30 days', minDays: 8, maxDays: 30 },
  { id: 'd31_plus', label: '31+ days', minDays: 31, maxDays: Number.POSITIVE_INFINITY },
] as const;

/**
 * Bucket every row with a balance > 0 by `status.daysLate`: current
 * (daysLate 0, e.g. due-but-not-late) / 1–7 / 8–30 / 31+. Escalated rows
 * land wherever their (floored) daysLate puts them. Always returns all
 * four buckets so the segmented bar/legend stays stable.
 *
 * @param rows - Flat derived rent rows.
 * @returns The four buckets in aging order, cents + distinct-lease counts.
 */
export function buildAgingBuckets(rows: readonly CycleRowInput[]): AgingBucket[] {
  const cents = new Map<AgingBucket['id'], number>();
  const leases = new Map<AgingBucket['id'], Set<string>>();

  for (const row of rows) {
    if (row.status.balanceCents <= 0) continue;
    const def = AGING_DEFS.find(
      (d) => row.status.daysLate >= d.minDays && row.status.daysLate <= d.maxDays,
    );
    if (def === undefined) continue;
    cents.set(def.id, (cents.get(def.id) ?? 0) + row.status.balanceCents);
    const set = leases.get(def.id) ?? new Set<string>();
    set.add(row.leaseId);
    leases.set(def.id, set);
  }

  return AGING_DEFS.map((def) => ({
    id: def.id,
    label: def.label,
    cents: cents.get(def.id) ?? 0,
    count: leases.get(def.id)?.size ?? 0,
  }));
}

/** A resolved reporting window plus its comparable prior window. */
export interface ResolvedPeriod {
  key: PeriodKey;
  /** Cycle months in the selected window, ascending 'YYYY-MM-01'. */
  cycleMonths: string[];
  /**
   * Comparable prior window: mtd → previous month, last → the month
   * before that, qtd → the same-length start of the previous quarter,
   * ytd → the same months of the previous year.
   */
  priorCycleMonths: string[];
  period: FinancialPeriod;
}

/** Closed calendar window spanning a contiguous run of cycle months. */
function periodFromCycles(cycleMonths: readonly string[], label: string): FinancialPeriod {
  const first = cycleMonths[0];
  const last = cycleMonths[cycleMonths.length - 1];
  const parts = parseCycle(last);
  if (parts === null) {
    return { startDate: first, endDate: last, label };
  }
  // Day 0 of the NEXT month is the last day of THIS month (same idiom as
  // buildPeriod in queries.ts — day-count only, no timezone math).
  const lastDay = new Date(parts.year, parts.month, 0).getDate();
  return {
    startDate: first,
    endDate: `${last.slice(0, 8)}${String(lastDay).padStart(2, '0')}`,
    label,
  };
}

/**
 * Resolve a period key into its cycle months, the comparable prior
 * window, and a labelled {@link FinancialPeriod} — all with string-only
 * month math. A malformed current cycle degrades to a single-month
 * window echoing the input (mirrors buildPeriod's graceful fallback).
 *
 * @param key - The selected period.
 * @param currentCycleIso - 'YYYY-MM-01' for the current cycle.
 * @returns The resolved window (labels e.g. 'July 2026', 'Q3 2026', '2026 YTD').
 */
export function resolvePeriodCycles(key: PeriodKey, currentCycleIso: string): ResolvedPeriod {
  const current = parseCycle(currentCycleIso);
  if (current === null) {
    return {
      key,
      cycleMonths: [currentCycleIso],
      priorCycleMonths: [],
      period: { startDate: currentCycleIso, endDate: currentCycleIso, label: currentCycleIso },
    };
  }

  const monthLabel = (cycleIso: string): string => {
    const parts = parseCycle(cycleIso);
    return parts === null ? cycleIso : `${MONTHS_FULL[parts.month - 1]} ${parts.year}`;
  };
  const run = (startIso: string, count: number): string[] =>
    Array.from({ length: count }, (_, i) => addMonths(startIso, i));

  switch (key) {
    case 'last': {
      const lastIso = addMonths(currentCycleIso, -1);
      return {
        key,
        cycleMonths: [lastIso],
        priorCycleMonths: [addMonths(currentCycleIso, -2)],
        period: periodFromCycles([lastIso], monthLabel(lastIso)),
      };
    }
    case 'qtd': {
      const quarter = Math.floor((current.month - 1) / 3) + 1;
      const quarterStartIso = toCycleIso(current.year, (quarter - 1) * 3 + 1);
      const count = current.month - ((quarter - 1) * 3 + 1) + 1;
      const cycleMonths = run(quarterStartIso, count);
      return {
        key,
        cycleMonths,
        priorCycleMonths: run(addMonths(quarterStartIso, -3), count),
        period: periodFromCycles(cycleMonths, `Q${quarter} ${current.year}`),
      };
    }
    case 'ytd': {
      const cycleMonths = run(toCycleIso(current.year, 1), current.month);
      return {
        key,
        cycleMonths,
        priorCycleMonths: run(toCycleIso(current.year - 1, 1), current.month),
        period: periodFromCycles(cycleMonths, `${current.year} YTD`),
      };
    }
    default:
      return {
        key: 'mtd',
        cycleMonths: [currentCycleIso],
        priorCycleMonths: [addMonths(currentCycleIso, -1)],
        period: periodFromCycles([currentCycleIso], monthLabel(currentCycleIso)),
      };
  }
}

/** Rent totals folded over a period's cycle months. */
export interface PeriodTotals {
  billedCents: MoneyCents;
  collectedCents: MoneyCents;
  /** Balances still owed on IN-PERIOD cycles only. */
  outstandingCents: MoneyCents;
  /** Late balances in period, plus late balances from BEFORE the period. */
  lateCents: MoneyCents;
  /** Distinct leases with a late row (in period ∪ prior-late). */
  lateLeaseCount: number;
}

/**
 * Fold flat derived rows into period totals. In-period rows drive
 * billed/collected/outstanding; late exposure additionally includes late
 * rows from BEFORE the period (aged balances survive rollover — same
 * rule as the summary fold's `priorLateRows`). Rows after the period are
 * excluded entirely.
 *
 * @param rows - Flat derived rent rows.
 * @param cycleMonths - The period's cycle months ('YYYY-MM-01').
 * @returns Integer-cent totals plus the distinct late-lease count.
 */
export function periodTotals(
  rows: readonly CycleRowInput[],
  cycleMonths: readonly string[],
): PeriodTotals {
  if (cycleMonths.length === 0) {
    return { billedCents: 0, collectedCents: 0, outstandingCents: 0, lateCents: 0, lateLeaseCount: 0 };
  }

  const inPeriod = new Set(cycleMonths);
  const periodStart = cycleMonths.reduce((min, iso) => (iso < min ? iso : min));

  let billedCents = 0;
  let collectedCents = 0;
  let outstandingCents = 0;
  let lateCents = 0;
  const lateLeases = new Set<string>();

  for (const row of rows) {
    if (inPeriod.has(row.cycleMonth)) {
      billedCents += row.billedCents;
      collectedCents += row.collectedCents;
      outstandingCents += row.status.balanceCents;
      if (row.status.isLate) {
        lateCents += row.status.balanceCents;
        lateLeases.add(row.leaseId);
      }
    } else if (row.cycleMonth < periodStart && row.status.isLate) {
      lateCents += row.status.balanceCents;
      lateLeases.add(row.leaseId);
    }
  }

  return { billedCents, collectedCents, outstandingCents, lateCents, lateLeaseCount: lateLeases.size };
}
