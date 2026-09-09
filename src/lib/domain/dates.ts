/**
 * Canonical ISO-day helpers for the domain module.
 *
 * Pure module — no IO, no hidden clock. All dates are `YYYY-MM-DD`
 * strings. Lexicographic compare is fine for ORDERING those strings,
 * but day differences need a real calendar diff, computed here.
 *
 * NEVER `new Date('YYYY-MM-DD')` — bare-string parsing is treated as
 * UTC midnight and shifts a day in western timezones. `Date.UTC` with
 * already-parsed numeric parts is the only allowed Date usage.
 */

/** Calendar parts of an ISO day: 1-based month and day. */
export interface IsoDayParts {
  y: number;
  m: number;
  d: number;
}

const ISO_DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MS_PER_DAY = 86_400_000;

/**
 * Parses a strict `YYYY-MM-DD` string into numeric parts.
 *
 * @param iso - Candidate ISO day string.
 * @returns `{y, m, d}` when valid, `null` for anything malformed
 *   (wrong shape, month outside 1-12, day outside 1-31).
 *
 * @example
 * parseIsoDay('2026-06-01'); // { y: 2026, m: 6, d: 1 }
 * parseIsoDay('2026-6-1');   // null
 */
export function parseIsoDay(iso: string): IsoDayParts | null {
  const match = ISO_DAY_RE.exec(iso);
  if (!match) return null;
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  if (m < 1 || m > 12) return null;
  if (d < 1 || d > 31) return null;
  return { y, m, d };
}

/**
 * Converts an ISO day to its epoch day count (1970-01-01 = 0).
 *
 * @param iso - ISO day string.
 * @returns Whole days since the Unix epoch, or `NaN` when malformed.
 */
export function dayNumber(iso: string): number {
  const parts = parseIsoDay(iso);
  if (parts === null) return Number.NaN;
  return Date.UTC(parts.y, parts.m - 1, parts.d) / MS_PER_DAY;
}

/**
 * Real calendar-day difference `a - b`.
 *
 * @param a - Later ISO day (usually "today").
 * @param b - Earlier ISO day (usually a due date).
 * @returns Signed whole-day difference, or `NaN` when either input is
 *   malformed.
 *
 * @example
 * diffDays('2026-06-12', '2026-06-01'); // 11
 */
export function diffDays(a: string, b: string): number {
  return dayNumber(a) - dayNumber(b);
}
