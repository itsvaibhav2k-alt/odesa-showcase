/**
 * Shared console / request guards + demo-string detection for the route
 * sweep. Extracted from the per-spec `isBenignConsoleError` idiom used
 * across `e2e/properties/*.spec.ts` so every swept route applies the same
 * noise filter rather than each spec re-deriving it.
 */

/**
 * True when a console.error line is known harmless noise (dev-tools hint,
 * Fast Refresh chatter, ResizeObserver loop, favicon probe). Anything else
 * is treated as a real error the route should not emit.
 */
export function isBenignConsoleError(text: string): boolean {
  if (text.trim() === '') return true;
  return (
    text.includes('Download the React DevTools') ||
    text.includes('[Fast Refresh]') ||
    text.includes('ResizeObserver loop') ||
    /favicon\.ico/.test(text) ||
    // Pre-existing dev-only React warning (non-fatal attribute hydration
    // mismatch — likely locale date formatting in the dashboard chrome).
    // "won't be patched up" is unique to the recoverable variant; a true
    // hydration FAILURE ("this tree will be regenerated") is NOT matched and
    // still fails the sweep. Tracked as a Phase-3 SHOULD-fix finding; absent
    // from production builds.
    text.includes("won't be patched up")
  );
}

/**
 * Request failures we ignore: optional telemetry beacons and favicon /
 * static probes that are not part of a route's data path. A real failed
 * data fetch (an `/api/...` 500, a Supabase error) is NOT ignored.
 *
 * `errorText` is the Playwright `request.failure()?.errorText`. It lets us
 * ignore RSC prefetch cancellations: under a production `next start` server,
 * `<Link>` prefetches fire eagerly and the browser aborts the in-flight ones
 * (`net::ERR_ABORTED`) the moment the sweep navigates to the next route — a
 * benign prefetch cancellation, not a data-path failure. We scope this tightly
 * to `?_rsc=` prefetch requests that aborted, so a genuine RSC failure (which
 * surfaces as an HTTP response, not a `requestfailed` event) still fails.
 */
export function isIgnorableRequestFailure(url: string, errorText?: string): boolean {
  return (
    /favicon\.ico/.test(url) ||
    /sentry\.io|ingest\.sentry|sentry_key=/.test(url) ||
    /_next\/static\//.test(url) ||
    /\.(?:woff2?|ttf|png|jpg|jpeg|svg|gif|ico)(?:\?|$)/.test(url) ||
    (errorText === 'net::ERR_ABORTED' && /[?&]_rsc=/.test(url))
  );
}

/**
 * Demo strings that must NOT appear on a real-data (`customer-data`) route
 * once wiring is complete. They come from the mock modules
 * (`mock-portfolio*`, `mock-detail`, the Today queue `ROW_CONTEXT`). After
 * wiring, the real Galaxy seed shows `Marcus Alvarez` / `Jessica Kim` /
 * `Oakwood Commons` / `17th Street Row` instead — so any of these strings
 * surfacing means a mock leaked into a production page.
 *
 * The runtime assertion is gated behind `SWEEP_ENFORCE_REAL=1` so the
 * pre-wiring baseline sweep (where mock pages legitimately show these)
 * records but does not fail; Phase 4 turns it into a hard gate.
 */
export const BANNED_DEMO_STRINGS: readonly string[] = [
  'Sandra K.',
  'Greene HVAC',
  '14 Maple Ct',
  '108 Cedar Ln',
  'Priya R.',
  'Marcus T.', // mock noise-dispute tenant — distinct from real "Marcus Alvarez"
];

/** Returns the subset of banned demo strings present in `content`. */
export function findBannedStrings(content: string): string[] {
  return BANNED_DEMO_STRINGS.filter((s) => content.includes(s));
}

/** Next.js / error-boundary signatures that indicate a render failure. */
export const ERROR_BOUNDARY_PATTERN =
  /Application error|Unhandled Runtime Error|This page could not be found|client-side exception/i;
