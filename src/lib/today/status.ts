/**
 * Semantic status helper for the Today console.
 *
 * Color MUST mean something on this screen (00-BUILD-HUB §Semantic
 * color map). Every module resolves its accent through this single
 * helper rather than inventing per-component color logic, so a green
 * always means "healthy / resolved", gold always means "needs owner
 * review", red always means "real attention", and blue-gray always
 * means "Odesa watching / quiet".
 *
 * Pure module — no IO. Returns CSS var strings defined in
 * `src/app/globals.css`; do not hardcode hexes here.
 */

/** Semantic tone for a status accent. */
export type StatusTone = 'healthy' | 'review' | 'attention' | 'watching' | 'neutral';

const TONE_VARS: Readonly<Record<StatusTone, string>> = {
  healthy: 'var(--success-600)',
  review: 'var(--gold-500)',
  attention: 'var(--error-600)',
  watching: 'var(--navy-500)',
  neutral: 'var(--ink-500)',
};

/**
 * Resolves a semantic tone to its CSS variable string.
 *
 * @param tone - Semantic tone.
 * @returns The `var(--token)` string for that tone.
 *
 * @example
 * const color = statusColor('attention'); // 'var(--error-600)'
 */
export function statusColor(tone: StatusTone): string {
  return TONE_VARS[tone];
}

/**
 * Tone for an occupancy percentage. Full occupancy reads healthy, a
 * soft dip is neutral, and a meaningful vacancy rate asks for review.
 * Clamps out-of-range / non-finite input to neutral.
 *
 * @param occupancyPct - Occupancy as a 0–100 percentage.
 * @returns The tone for the occupancy figure.
 */
export function occupancyTone(occupancyPct: number): StatusTone {
  if (!Number.isFinite(occupancyPct)) return 'neutral';
  if (occupancyPct >= 95) return 'healthy';
  if (occupancyPct >= 85) return 'neutral';
  return 'review';
}

/**
 * Tone for rent collection progress. Fully collected is healthy; a
 * trailing balance is neutral until nothing has been collected against
 * a real bill, which asks for review.
 *
 * @param collectedCents - Rent collected so far, in cents.
 * @param dueCents - Rent due this cycle, in cents.
 * @returns The tone for rent collection.
 */
export function rentCollectionTone(collectedCents: number, dueCents: number): StatusTone {
  if (!Number.isFinite(collectedCents) || !Number.isFinite(dueCents)) return 'neutral';
  // Nothing billed yet — neither healthy nor a problem.
  if (dueCents <= 0) return 'neutral';
  if (collectedCents >= dueCents) return 'healthy';
  if (collectedCents <= 0) return 'review';
  return 'neutral';
}

/**
 * Tone for a count of late tenants. Zero is healthy, a single late
 * tenant warrants review, and several is real attention.
 *
 * @param lateCount - Number of tenants currently late.
 * @returns The tone for the late-tenant count.
 */
export function lateTenantsTone(lateCount: number): StatusTone {
  if (!Number.isFinite(lateCount) || lateCount <= 0) return 'healthy';
  if (lateCount <= 2) return 'review';
  return 'attention';
}
