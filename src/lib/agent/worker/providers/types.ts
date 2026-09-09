/**
 * Provider-layer types — v1.5 (Phase 4.5 addendum).
 *
 * The shared `WorkerModelProvider` interface lives in
 * src/lib/agent/worker/types.ts (owned by worker-core). This file
 * adds the provider-local concerns: call options (AbortSignal),
 * health-check return shape, and the model-id constants used by
 * the two concrete implementations.
 *
 * Implementations:
 *   - hosted-haiku.ts  — Anthropic Messages API, prompt caching
 *   - ollama.ts        — HTTP /api/chat, no prompt caching
 *   - select.ts        — picks provider by org.privacy_mode
 */

import type {
  PropertyWorkerInput,
  PropertyWorkerOutput,
  ProviderHealth,
  WorkerModelProvider,
} from '@/lib/agent/worker/types';

/**
 * Optional knobs every provider call accepts. The interface in
 * worker/types.ts declares `call(input)`; we add an optional second
 * parameter at the implementation site. TS structural typing permits
 * widening with optional parameters, so callers that go through the
 * `WorkerModelProvider` interface still type-check.
 */
export interface ProviderCallOptions {
  /** External cancellation. Both providers must abort in-flight HTTP. */
  signal?: AbortSignal;
}

/** Default Anthropic model for the hosted tier. */
export const HOSTED_HAIKU_MODEL = 'claude-haiku-4-5-20251001';

/** Default Ollama model recommended Jan 2026 (see addendum §Privacy Mode). */
export const OLLAMA_DEFAULT_MODEL = 'llama3.3:70b-instruct-q4_K_M';

/** Default OLLAMA_HOST when the org has not set one. */
export const OLLAMA_DEFAULT_HOST = 'http://localhost:11434';

/**
 * The hosted Anthropic SDK call may throw network or rate-limit
 * errors. We wrap those into this concrete error so spawn.ts and the
 * commit gate can decide whether to retry, fall back to Ollama, or
 * surface to ops.
 */
export class ProviderCallError extends Error {
  readonly providerName: string;
  readonly cause?: unknown;
  readonly httpStatus: number | null;

  constructor(
    providerName: string,
    message: string,
    opts: { cause?: unknown; httpStatus?: number | null } = {},
  ) {
    super(message);
    this.name = 'ProviderCallError';
    this.providerName = providerName;
    this.cause = opts.cause;
    this.httpStatus = opts.httpStatus ?? null;
  }
}

/**
 * Re-export the shared types so files inside `providers/` can import
 * them from a single local module. This keeps imports tidy and makes
 * the boundary obvious.
 */
export type {
  PropertyWorkerInput,
  PropertyWorkerOutput,
  ProviderHealth,
  WorkerModelProvider,
};
