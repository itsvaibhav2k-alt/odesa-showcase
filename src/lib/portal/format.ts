/**
 * Consumer-facing money/date formatting shared by the portal pages.
 *
 * ISO days are parsed manually (never `new Date(iso)`) so "2026-08-01"
 * can't shift a day across time zones.
 */

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

/** "$1,850" for whole dollars, "$1,850.50" otherwise. */
export function formatDollars(amount: number): string {
  return amount.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: Number.isInteger(amount) ? 0 : 2,
    maximumFractionDigits: 2,
  });
}

function parseIsoDay(iso: string): { y: number; m: number; d: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!match) return null;
  const m = Number(match[2]);
  const d = Number(match[3]);
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  return { y: Number(match[1]), m, d };
}

/** "August" from "2026-08-01", or null when unparseable. */
export function monthName(isoDay: string): string | null {
  const parts = parseIsoDay(isoDay);
  return parts ? MONTH_NAMES[parts.m - 1] : null;
}

/** "August 1" from "2026-08-01", or null when unparseable. */
export function formatMonthDay(isoDay: string): string | null {
  const parts = parseIsoDay(isoDay);
  return parts ? `${MONTH_NAMES[parts.m - 1]} ${parts.d}` : null;
}

/** "August 1, 2026" from "2026-08-01", or null when unparseable. */
export function formatLongDate(isoDay: string): string | null {
  const parts = parseIsoDay(isoDay);
  return parts ? `${MONTH_NAMES[parts.m - 1]} ${parts.d}, ${parts.y}` : null;
}

/** "1st", "2nd", "3rd", "4th" … "21st" … */
export function ordinal(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  const suffix = { 1: "st", 2: "nd", 3: "rd" }[n % 10] ?? "th";
  return `${n}${suffix}`;
}
