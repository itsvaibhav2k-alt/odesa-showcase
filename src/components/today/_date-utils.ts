/**
 * Tiny date helpers for the Today screen.
 *
 * Kept colocated under `today/` (prefixed `_` so it is clearly private)
 * because the formatters are opinionated to the briefing-card aesthetic
 * (short ordinals, no year, 24h timestamps). If other screens end up
 * needing the same shape later we lift this to `src/lib/utils/date.ts`.
 */

/**
 * Returns the Monday following the given date. If `from` is already a
 * Monday, returns the Monday 7 days later (Odesa briefings arrive on
 * the NEXT Monday, not "today" even if today is Monday).
 */
export function nextMonday(from: Date): Date {
  const d = new Date(from);
  const day = d.getDay(); // 0=Sun, 1=Mon, ..., 6=Sat
  const diff = day === 1 ? 7 : (8 - day) % 7;
  d.setDate(d.getDate() + (diff === 0 ? 7 : diff));
  d.setHours(7, 0, 0, 0);
  return d;
}

/**
 * Formats a date in US-short form: "Apr 21" or "April 21, 2026" if you
 * pass explicit opts. Calling without opts produces a compact stamp.
 */
export function format(date: Date, opts?: Intl.DateTimeFormatOptions): string {
  const fmt = new Intl.DateTimeFormat('en-US', opts ?? {
    month: 'short',
    day: 'numeric',
  });
  return fmt.format(date);
}
