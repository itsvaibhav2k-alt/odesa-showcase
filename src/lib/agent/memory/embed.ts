/**
 * Memory fact embedding — wraps OpenAI text-embedding-3-small (1536-dim)
 * with a 10s timeout and graceful null-on-failure semantics.
 *
 * Primary callers:
 *   1. `record.ts` — embed-on-insert for every central fact writer. Explicit
 *      caller-provided results bypass this attempt. Failures still insert null
 *      so persistence never depends on OpenAI availability.
 *   2. `mcps/memory.ts` — embed-the-query for hybrid recall_facts.
 *   3. The bounded Inngest backfill — retries null rows on a later run.
 *
 * The OpenAI client is constructed lazily so a missing OPENAI_API_KEY
 * doesn't break import-time (server boot, tests, etc.). When the key is
 * absent `embedFactContent` returns null, callers degrade to the
 * substring-only path, and a single warn fires per process.
 */

import OpenAI from 'openai';

export const EMBEDDING_MODEL = 'text-embedding-3-small';
export const EMBEDDING_DIMENSIONS = 1536;
export const EMBEDDING_TIMEOUT_MS = 10_000;
export const EMBEDDING_MAX_RETRIES = 0;

export interface SemanticMemoryReadiness {
  configured: boolean;
  status: 'configured' | 'degraded';
  reason: 'missing_openai_api_key' | 'unsupported_openai_override' | null;
}

export interface SemanticMemoryEnvironment {
  OPENAI_API_KEY?: string;
  OPENAI_BASE_URL?: string;
  OPENAI_CUSTOM_HEADERS?: string;
}

export interface SemanticMemoryHealth {
  status: 200 | 503;
  body: {
    ok: boolean;
    service: string;
    semanticMemory: SemanticMemoryReadiness;
  };
}

/**
 * Secret-safe readiness shared by Vercel and the Railway operator worker.
 * Reading the environment is lazy and never constructs a client, so importing
 * a readiness endpoint cannot fail merely because the optional key is absent.
 */
export function semanticMemoryReadiness(
  raw?: SemanticMemoryEnvironment,
): SemanticMemoryReadiness {
  const environment = raw ?? {
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    OPENAI_BASE_URL: process.env.OPENAI_BASE_URL,
    OPENAI_CUSTOM_HEADERS: process.env.OPENAI_CUSTOM_HEADERS,
  };
  const hasKey = Boolean(environment.OPENAI_API_KEY?.trim());
  const hasOverride = Boolean(
    environment.OPENAI_BASE_URL?.trim() || environment.OPENAI_CUSTOM_HEADERS?.trim(),
  );
  const configured = hasKey && !hasOverride;
  return {
    configured,
    status: configured ? 'configured' : 'degraded',
    reason: !hasKey
      ? 'missing_openai_api_key'
      : hasOverride
        ? 'unsupported_openai_override'
        : null,
  };
}

/** Build the identical readiness contract used by both production runtimes. */
export function semanticMemoryHealth(
  service: string,
  raw?: SemanticMemoryEnvironment,
): SemanticMemoryHealth {
  const semanticMemory = semanticMemoryReadiness(raw);
  return {
    status: semanticMemory.configured ? 200 : 503,
    body: {
      ok: semanticMemory.configured,
      service,
      semanticMemory,
    },
  };
}

/**
 * Lazy-cached OpenAI client. Reset between tests via the `__resetClient`
 * helper so vi.mock + env-var manipulation works.
 */
let cachedClient: OpenAI | null = null;
let warnedMissingKey = false;

interface EmbeddingsApi {
  create(args: {
    model: string;
    input: string;
  }): Promise<{ data: Array<{ embedding: number[] }> }>;
}

interface EmbeddingClient {
  embeddings: EmbeddingsApi;
}

/**
 * Override the embedding client (for tests). Pass null to clear.
 *
 * Tests use this rather than vi.mock('openai', ...) because vi.mock has
 * to live at the top of the test file and we want different mocks per
 * test (success / timeout / error).
 */
export function __setEmbeddingClient(client: EmbeddingClient | null): void {
  cachedClient = client as OpenAI | null;
  warnedMissingKey = false;
}

function getClient(): EmbeddingClient | null {
  if (cachedClient) return cachedClient;
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    if (!warnedMissingKey) {
      console.warn(
        '[memory.embed] OPENAI_API_KEY missing — semantic recall degraded to substring-only',
      );
      warnedMissingKey = true;
    }
    return null;
  }
  cachedClient = new OpenAI({
    apiKey,
    timeout: EMBEDDING_TIMEOUT_MS,
    maxRetries: EMBEDDING_MAX_RETRIES,
  });
  return cachedClient;
}

/**
 * Embed a fact's `content` JSONB body (or any string). Returns a 1536-dim
 * `number[]` on success, or `null` on any failure (missing key, network
 * error, timeout, malformed response). Callers MUST tolerate null —
 * insert with embedding=null + let the backfill job pick it up.
 *
 * The input shape is intentionally flexible: `extract.ts` passes the
 * structured `content` object; `mcps/memory.ts` passes the user query
 * string. Both get JSON-stringified for embedding.
 */
export async function embedFactContent(
  content: string | object,
): Promise<number[] | null> {
  const client = getClient();
  if (!client) return null;

  const text = typeof content === 'string' ? content : JSON.stringify(content);
  if (!text || text.length === 0) return null;

  try {
    const response = await client.embeddings.create({
      model: EMBEDDING_MODEL,
      input: text,
    });
    const embedding = response.data?.[0]?.embedding;
    if (!Array.isArray(embedding) || embedding.length !== EMBEDDING_DIMENSIONS) {
      console.error(
        `[memory.embed] unexpected response shape (length=${
          Array.isArray(embedding) ? embedding.length : 'n/a'
        })`,
      );
      return null;
    }
    return embedding;
  } catch (err) {
    console.error(
      '[memory.embed] embedding call failed',
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}

/**
 * Format an embedding for postgres `vector(1536)`. pgvector accepts the
 * literal `[0.1,0.2,...]` syntax via parameterized queries.
 */
export function embeddingToVectorLiteral(embedding: readonly number[]): string {
  return `[${embedding.join(',')}]`;
}
