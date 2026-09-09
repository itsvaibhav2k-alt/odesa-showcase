/**
 * In-memory rate limiter for Odesa API routes.
 *
 * Provides a factory function to create rate limiters with configurable
 * request caps and time windows, plus pre-configured instances for
 * common route groups.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface RateLimitEntry {
  readonly count: number;
  readonly resetAt: number;
}

interface RateLimitOptions {
  /** Maximum number of requests allowed within the window. */
  readonly maxRequests: number;
  /** Duration of the sliding window in milliseconds. */
  readonly windowMs: number;
}

interface RateLimitCheckResult {
  /** Whether the request is allowed. */
  readonly allowed: boolean;
  /** How many requests remain in the current window. */
  readonly remaining: number;
  /** Unix timestamp (ms) when the current window resets. */
  readonly resetAt: number;
}

interface RateLimiter {
  /** Check whether a request identified by `key` is allowed. */
  check(key: string): RateLimitCheckResult;
}

// ---------------------------------------------------------------------------
// Cleanup interval (shared across all limiter instances)
// ---------------------------------------------------------------------------

const CLEANUP_INTERVAL_MS = 60_000;

/**
 * Schedules periodic cleanup of expired entries so the Map does not grow
 * unbounded. The timer is unref'd so it will not keep a Node process alive.
 */
function scheduleCleanup(store: Map<string, RateLimitEntry>): void {
  const timer = setInterval(() => {
    const now = Date.now();
    store.forEach((entry, key) => {
      if (now > entry.resetAt) {
        store.delete(key);
      }
    });
  }, CLEANUP_INTERVAL_MS);

  // Allow the process to exit even if the timer is pending
  if (typeof timer === 'object' && 'unref' in timer) {
    timer.unref();
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Creates a rate limiter backed by an in-memory Map.
 *
 * @param options - Configuration for max requests and window size
 * @returns A RateLimiter instance
 *
 * @example
 * const limiter = createRateLimiter({ maxRequests: 60, windowMs: 60_000 });
 * const result = limiter.check(userId);
 * if (!result.allowed) {
 *   return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
 * }
 */
export function createRateLimiter(options: RateLimitOptions): RateLimiter {
  const { maxRequests, windowMs } = options;
  const store = new Map<string, RateLimitEntry>();

  scheduleCleanup(store);

  return {
    check(key: string): RateLimitCheckResult {
      const now = Date.now();
      const existing = store.get(key);

      // First request or window expired — start a new window
      if (!existing || now > existing.resetAt) {
        const resetAt = now + windowMs;
        store.set(key, { count: 1, resetAt });
        return { allowed: true, remaining: maxRequests - 1, resetAt };
      }

      // Window still active — check capacity
      if (existing.count >= maxRequests) {
        return {
          allowed: false,
          remaining: 0,
          resetAt: existing.resetAt,
        };
      }

      // Increment (immutable entry)
      const updated: RateLimitEntry = {
        count: existing.count + 1,
        resetAt: existing.resetAt,
      };
      store.set(key, updated);

      return {
        allowed: true,
        remaining: maxRequests - updated.count,
        resetAt: existing.resetAt,
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Pre-configured instances
// ---------------------------------------------------------------------------

/** General API rate limiter: 60 requests per minute. */
export const apiLimiter = createRateLimiter({
  maxRequests: 60,
  windowMs: 60_000,
});

/** Embed / widget rate limiter: 20 requests per minute. */
export const embedLimiter = createRateLimiter({
  maxRequests: 20,
  windowMs: 60_000,
});
