/**
 * Unit tests for the embed module.
 *
 * Avoids vi.mock('openai') so the lazy-cached client + fallback path can
 * be exercised end-to-end. The module exposes `__setEmbeddingClient` for
 * deterministic injection.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  EMBEDDING_DIMENSIONS,
  EMBEDDING_MAX_RETRIES,
  EMBEDDING_MODEL,
  EMBEDDING_TIMEOUT_MS,
  __setEmbeddingClient,
  embedFactContent,
  embeddingToVectorLiteral,
  semanticMemoryHealth,
  semanticMemoryReadiness,
} from '../embed';
import { GET as getVercelHealth } from '@/app/api/healthz/route';

const ORIGINAL_KEY = process.env.OPENAI_API_KEY;
const ORIGINAL_BASE_URL = process.env.OPENAI_BASE_URL;
const ORIGINAL_CUSTOM_HEADERS = process.env.OPENAI_CUSTOM_HEADERS;

function makeVector(seed: number): number[] {
  return Array.from({ length: EMBEDDING_DIMENSIONS }, (_, i) => seed + i / 10000);
}

describe('embedFactContent', () => {
  beforeEach(() => {
    process.env.OPENAI_API_KEY = 'test-key';
    __setEmbeddingClient(null);
  });

  afterEach(() => {
    if (ORIGINAL_KEY === undefined) {
      delete process.env.OPENAI_API_KEY;
    } else {
      process.env.OPENAI_API_KEY = ORIGINAL_KEY;
    }
    if (ORIGINAL_BASE_URL === undefined) delete process.env.OPENAI_BASE_URL;
    else process.env.OPENAI_BASE_URL = ORIGINAL_BASE_URL;
    if (ORIGINAL_CUSTOM_HEADERS === undefined) delete process.env.OPENAI_CUSTOM_HEADERS;
    else process.env.OPENAI_CUSTOM_HEADERS = ORIGINAL_CUSTOM_HEADERS;
    __setEmbeddingClient(null);
    vi.restoreAllMocks();
  });

  it('returns a 1536-dim embedding for a string input', async () => {
    const create = vi
      .fn()
      .mockResolvedValue({ data: [{ embedding: makeVector(0.1) }] });
    __setEmbeddingClient({ embeddings: { create } });

    const result = await embedFactContent('boiler kicks off below 10F');
    expect(result).not.toBeNull();
    expect(result).toHaveLength(EMBEDDING_DIMENSIONS);
    expect(create).toHaveBeenCalledWith({
      model: EMBEDDING_MODEL,
      input: 'boiler kicks off below 10F',
    });
  });

  it('JSON-stringifies object input before embedding', async () => {
    const create = vi
      .fn()
      .mockResolvedValue({ data: [{ embedding: makeVector(0.2) }] });
    __setEmbeddingClient({ embeddings: { create } });

    const content = { description: 'heating system fails below 50F' };
    const result = await embedFactContent(content);
    expect(result).not.toBeNull();
    expect(create).toHaveBeenCalledWith({
      model: EMBEDDING_MODEL,
      input: JSON.stringify(content),
    });
  });

  it('returns null when OPENAI_API_KEY is missing (degrades cleanly)', async () => {
    delete process.env.OPENAI_API_KEY;
    __setEmbeddingClient(null);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const result = await embedFactContent('anything');
    expect(result).toBeNull();
    expect(warn).toHaveBeenCalled();
  });

  it('returns null when the API call rejects (never throws)', async () => {
    const create = vi.fn().mockRejectedValue(new Error('ECONNRESET'));
    __setEmbeddingClient({ embeddings: { create } });
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const result = await embedFactContent({ description: 'x' });
    expect(result).toBeNull();
    expect(errSpy).toHaveBeenCalled();
  });

  it('returns null when the response shape is unexpected', async () => {
    const create = vi.fn().mockResolvedValue({ data: [{ embedding: [1, 2, 3] }] });
    __setEmbeddingClient({ embeddings: { create } });
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const result = await embedFactContent('x');
    expect(result).toBeNull();
    expect(errSpy).toHaveBeenCalled();
  });

  it('returns null on empty input rather than calling the API', async () => {
    const create = vi.fn();
    __setEmbeddingClient({ embeddings: { create } });

    const result = await embedFactContent('');
    expect(result).toBeNull();
    expect(create).not.toHaveBeenCalled();
  });

  it('pins a single 10-second provider attempt with SDK retries disabled', () => {
    expect(EMBEDDING_TIMEOUT_MS).toBe(10_000);
    expect(EMBEDDING_MAX_RETRIES).toBe(0);
  });
});

describe('embeddingToVectorLiteral', () => {
  it('formats an embedding as a pgvector literal', () => {
    expect(embeddingToVectorLiteral([0.1, 0.2, 0.3])).toBe('[0.1,0.2,0.3]');
  });

  it('handles empty arrays', () => {
    expect(embeddingToVectorLiteral([])).toBe('[]');
  });
});

describe('semantic-memory readiness', () => {
  it('is import-safe and degraded when the key is missing', () => {
    expect(semanticMemoryReadiness({})).toEqual({
      configured: false,
      status: 'degraded',
      reason: 'missing_openai_api_key',
    });
  });

  it('reports configured without exposing the key', () => {
    const secret = 'sk-test-never-serialize-this';
    const readiness = semanticMemoryReadiness({ OPENAI_API_KEY: secret });
    expect(readiness).toEqual({
      configured: true,
      status: 'configured',
      reason: null,
    });
    expect(JSON.stringify(readiness)).not.toContain(secret);
  });

  it('degrades on endpoint/header overrides without returning their values', () => {
    const override = 'https://unexpected-provider.invalid/v1';
    const readiness = semanticMemoryReadiness({
      OPENAI_API_KEY: 'sk-test',
      OPENAI_BASE_URL: override,
    });
    expect(readiness).toEqual({
      configured: false,
      status: 'degraded',
      reason: 'unsupported_openai_override',
    });
    expect(JSON.stringify(readiness)).not.toContain(override);
  });

  it('makes Vercel readiness fail honestly when semantic memory is degraded', async () => {
    delete process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_BASE_URL;
    delete process.env.OPENAI_CUSTOM_HEADERS;
    const response = await getVercelHealth();
    const body = await response.json() as Record<string, unknown>;
    expect(response.status).toBe(503);
    expect(body).toMatchObject({
      ok: false,
      service: 'odesa-vercel',
      semanticMemory: {
        configured: false,
        status: 'degraded',
        reason: 'missing_openai_api_key',
      },
    });
  });

  it('makes Vercel readiness green with a supported configured key', async () => {
    const secret = 'sk-test-readiness';
    process.env.OPENAI_API_KEY = secret;
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://project.supabase.co';
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';
    delete process.env.OPENAI_BASE_URL;
    delete process.env.OPENAI_CUSTOM_HEADERS;
    const response = await getVercelHealth();
    const serialized = await response.text();
    expect(response.status).toBe(200);
    expect(JSON.parse(serialized)).toMatchObject({
      ok: true,
      semanticMemory: { configured: true, status: 'configured', reason: null },
    });
    expect(serialized).not.toContain(secret);
  });

  it('builds the Railway readiness contract from the same secret-safe state', () => {
    const health = semanticMemoryHealth('odesa-operator-worker', {});
    expect(health).toEqual({
      status: 503,
      body: {
        ok: false,
        service: 'odesa-operator-worker',
        semanticMemory: {
          configured: false,
          status: 'degraded',
          reason: 'missing_openai_api_key',
        },
      },
    });
  });
});
