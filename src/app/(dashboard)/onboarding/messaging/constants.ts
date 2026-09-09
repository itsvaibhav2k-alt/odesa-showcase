/**
 * Pure constants shared between the Messaging onboarding step's server
 * actions, the client form, and the Settings card.
 *
 * Lives in its own module because the actions file is `'use server'`
 * and Next.js requires every export from a server-actions module to
 * be an async function. Constants get pulled into client bundles
 * directly from this file.
 */

/** Typed error code surfaced to the UI when the pool has no rows left. */
export const NO_AVAILABLE_NUMBERS_ERROR = 'NO_AVAILABLE_NUMBERS';

/**
 * Friendly message the UI renders when the typed error fires.
 *
 * T2b (2026-05-17): Updated to waitlist language. Pool-empty is an expected
 * v1 capacity state — operator is added to the waitlist and will be notified
 * when a number becomes available.
 */
export const NO_AVAILABLE_NUMBERS_MESSAGE =
  "We're at capacity right now — you've been added to the waitlist and we'll reach out as soon as a number opens up. No action needed on your end.";

/** Default assistant name persisted by the migration; UI uses as placeholder. */
export const DEFAULT_ASSISTANT_NAME = 'Odesa';

/** Hard cap on `assistant_name` length enforced at the application layer. */
export const ASSISTANT_NAME_MAX_LENGTH = 30;
