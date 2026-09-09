/**
 * Shared currency / percent formatters for NEW financial + reliability
 * UI. Intentionally small and dependency-free.
 *
 * This does NOT replace the 5+ pre-existing duplicate formatters across
 * the app — only new code should adopt these helpers (see plan).
 */

import type { MoneyCents } from './types';

/** Em-dash shown for unknown / not-connected money or percent values. */
export const UNKNOWN_DISPLAY = '—';

/**
 * Format integer cents as whole grouped dollars, e.g. `$1,450`.
 * `null`/`undefined` (unknown / not-connected) renders as an em-dash.
 * Negative values keep a leading minus: `-$320`.
 */
export function formatMoneyCents(cents: MoneyCents | null | undefined): string {
  if (cents === null || cents === undefined || !Number.isFinite(cents)) {
    return UNKNOWN_DISPLAY;
  }
  const negative = cents < 0;
  const whole = Math.round(Math.abs(cents) / 100);
  const body = `$${whole.toLocaleString('en-US')}`;
  return negative ? `-${body}` : body;
}

/**
 * Format integer cents with two decimal places, e.g. `$1,450.00`.
 * Used where exact amounts matter (a single payment row, a balance).
 */
export function formatMoneyCentsPrecise(cents: MoneyCents | null | undefined): string {
  if (cents === null || cents === undefined || !Number.isFinite(cents)) {
    return UNKNOWN_DISPLAY;
  }
  const negative = cents < 0;
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100);
  const remainder = abs % 100;
  const body = `$${dollars.toLocaleString('en-US')}.${String(remainder).padStart(2, '0')}`;
  return negative ? `-${body}` : body;
}

/**
 * Format a signed money delta, e.g. `+$420` / `−$180` (true minus sign,
 * U+2212 — never a hyphen). Returns `null` for zero or unknown values so
 * delta chips can be omitted instead of showing a meaningless `+$0`.
 */
export function formatSignedMoneyCents(cents: MoneyCents | null | undefined): string | null {
  if (cents === null || cents === undefined || !Number.isFinite(cents) || cents === 0) {
    return null;
  }
  const whole = Math.round(Math.abs(cents) / 100);
  const body = `$${whole.toLocaleString('en-US')}`;
  return cents > 0 ? `+${body}` : `−${body}`;
}

/**
 * Compact money for axis ticks / chips: `$32k`, `$20.5k`, `$800`.
 * Under $100k, non-whole thousands keep one decimal (`$20.5k`,
 * `$5.2k`) while whole thousands stay clean (`$25k`, `$5k`); $100k and
 * up rounds to whole thousands. Zero renders `$0`, negatives keep a
 * leading minus (`-$1.5k`).
 */
export function formatMoneyCentsShort(cents: MoneyCents): string {
  if (!Number.isFinite(cents)) return UNKNOWN_DISPLAY;
  const negative = cents < 0;
  const dollars = Math.abs(cents) / 100;
  let body: string;
  if (dollars >= 100_000) {
    body = `$${Math.round(dollars / 1000)}k`;
  } else if (dollars >= 1_000) {
    const thousandths = Math.round(dollars / 100) / 10;
    body = Number.isInteger(thousandths) ? `$${thousandths}k` : `$${thousandths.toFixed(1)}k`;
  } else {
    body = `$${Math.round(dollars)}`;
  }
  return negative ? `-${body}` : body;
}

/**
 * Format a percent value for display, e.g. `94.2%`. `null` (not
 * computable) renders as an em-dash. Trims a trailing `.0`.
 */
export function formatPct(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return UNKNOWN_DISPLAY;
  }
  const rounded = Math.round(value * 10) / 10;
  const text = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
  return `${text}%`;
}
