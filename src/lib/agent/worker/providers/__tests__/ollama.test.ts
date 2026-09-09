import { afterEach, describe, expect, it, vi } from 'vitest';

import type {
  PropertyContext,
  PropertyWorkerInput,
} from '@/lib/agent/worker/types';

import {
  OLLAMA_PROVIDER_NAME,
  OllamaProvider,
  translateAnthropicToolToOllama,
} from '../ollama';
import { OLLAMA_DEFAULT_MODEL, ProviderCallError } from '../types';

const ctx: PropertyContext = {
  property: {
    id: 'prop-9',
    organizationId: 'org-9',
    name: 'Galaxy 17',
    addressLine: null,
    timezone: 'America/Chicago',
    rulesText: 'Tone: warm. No legalese.',
    autonomyLevel: 0.3,
    privacyMode: 'on_prem',
  },
  facts: [],
  recentTurns: [],
  vendors: [],
  tenants: [],
  loadedAt: '2026-04-27T10:00:00Z',
};

const classifyInput: PropertyWorkerInput = {
  propertyId: 'prop-9',
  organizationId: 'org-9',
  action_type: 'classify_intent',
  data: {
    utterance: 'do you take cash',
    history: [],
    candidateIntents: ['rent_balance', 'general_callback'],
  },
  context: ctx,
};

const okOutput = {
  action_type: 'classify_intent',
  payload: { intent: 'rent_balance', reasoning: 'mentions cash + rent context' },
  reasoning: 'cash question maps to rent_balance',
  confidence: 0.7,
  context_fact_ids: [],
};

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  });
}

afterEach(() => vi.restoreAllMocks());

describe('OllamaProvider', () => {
  describe('name + caching', () => {
    it('exposes stable name', () => {
      const p = new OllamaProvider({ host: 'http://x', fetchImpl: vi.fn() });
      expect(p.name).toBe(OLLAMA_PROVIDER_NAME);
    });

    it('reports no prompt-caching support', () => {
      const p = new OllamaProvider({ host: 'http://x', fetchImpl: vi.fn() });
      expect(p.supportsPromptCaching()).toBe(false);
    });
  });

  describe('call() — request payload', () => {
    it('POSTs to /api/chat with model + format=json + stream=false', async () => {
      const fetchImpl = vi.fn().mockResolvedValue(
        jsonResponse({ message: { content: JSON.stringify(okOutput) } }),
      );
      const p = new OllamaProvider({ host: 'http://localhost:11434', fetchImpl });

      await p.call(classifyInput);

      expect(fetchImpl).toHaveBeenCalledTimes(1);
      const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('http://localhost:11434/api/chat');
      expect(init.method).toBe('POST');
      expect((init.headers as Record<string, string>)['content-type']).toBe(
        'application/json',
      );

      const body = JSON.parse(init.body as string);
      expect(body.model).toBe(OLLAMA_DEFAULT_MODEL);
      expect(body.stream).toBe(false);
      expect(body.format).toBe('json');
      expect(body.options.temperature).toBeCloseTo(0.2);
      expect(body.messages).toHaveLength(2);
      expect(body.messages[0].role).toBe('system');
      expect(body.messages[1].role).toBe('user');
      // Canonical buildWorkerSystemPrompt blocks are flattened into a
      // single system string for Ollama; the property identity, rulebook,
      // and per-action contract must all appear.
      expect(body.messages[0].content).toContain('Galaxy 17');
      expect(body.messages[0].content).toContain('Tone: warm.');
      expect(body.messages[0].content).toContain('TASK: classify_intent');
      expect(body.messages[0].content).toContain('NOW: 2026-04-27T10:00:00Z');
    });

    it('strips trailing slash from host', async () => {
      const fetchImpl = vi.fn().mockResolvedValue(
        jsonResponse({ message: { content: JSON.stringify(okOutput) } }),
      );
      const p = new OllamaProvider({ host: 'http://localhost:11434/', fetchImpl });

      await p.call(classifyInput);

      const [url] = fetchImpl.mock.calls[0] as [string];
      expect(url).toBe('http://localhost:11434/api/chat');
    });

    it('uses configured model override', async () => {
      const fetchImpl = vi.fn().mockResolvedValue(
        jsonResponse({ message: { content: JSON.stringify(okOutput) } }),
      );
      const p = new OllamaProvider({
        host: 'http://x:11434',
        model: 'qwen2.5:72b',
        fetchImpl,
      });

      await p.call(classifyInput);

      const body = JSON.parse(
        (fetchImpl.mock.calls[0]?.[1] as RequestInit).body as string,
      );
      expect(body.model).toBe('qwen2.5:72b');
    });

    it('includes tools[] when configured', async () => {
      const tool = translateAnthropicToolToOllama({
        name: 'lookup_balance',
        description: 'Look up tenant balance',
        input_schema: {
          type: 'object',
          properties: { tenantId: { type: 'string' } },
          required: ['tenantId'],
        },
      });
      const fetchImpl = vi.fn().mockResolvedValue(
        jsonResponse({ message: { content: JSON.stringify(okOutput) } }),
      );
      const p = new OllamaProvider({
        host: 'http://x:11434',
        fetchImpl,
        tools: [tool],
      });

      await p.call(classifyInput);

      const body = JSON.parse(
        (fetchImpl.mock.calls[0]?.[1] as RequestInit).body as string,
      );
      expect(body.tools).toHaveLength(1);
      expect(body.tools[0].type).toBe('function');
      expect(body.tools[0].function.name).toBe('lookup_balance');
      expect(body.tools[0].function.parameters).toEqual({
        type: 'object',
        properties: { tenantId: { type: 'string' } },
        required: ['tenantId'],
      });
    });

    it('omits tools when none configured', async () => {
      const fetchImpl = vi.fn().mockResolvedValue(
        jsonResponse({ message: { content: JSON.stringify(okOutput) } }),
      );
      const p = new OllamaProvider({ host: 'http://x:11434', fetchImpl });

      await p.call(classifyInput);

      const body = JSON.parse(
        (fetchImpl.mock.calls[0]?.[1] as RequestInit).body as string,
      );
      expect(body).not.toHaveProperty('tools');
    });

    it('forwards AbortSignal to fetch', async () => {
      const fetchImpl = vi.fn().mockResolvedValue(
        jsonResponse({ message: { content: JSON.stringify(okOutput) } }),
      );
      const p = new OllamaProvider({ host: 'http://x:11434', fetchImpl });
      const ac = new AbortController();

      await p.call(classifyInput, { signal: ac.signal });

      const init = fetchImpl.mock.calls[0]?.[1] as RequestInit;
      expect(init.signal).toBe(ac.signal);
    });
  });

  describe('call() — response handling', () => {
    it('parses message.content JSON envelope', async () => {
      const fetchImpl = vi.fn().mockResolvedValue(
        jsonResponse({ message: { content: JSON.stringify(okOutput) } }),
      );
      const p = new OllamaProvider({ host: 'http://x:11434', fetchImpl });

      const out = await p.call(classifyInput);

      expect(out.action_type).toBe('classify_intent');
      expect(out.confidence).toBe(0.7);
    });

    it('strips ```json fences', async () => {
      const fenced = '```json\n' + JSON.stringify(okOutput) + '\n```';
      const fetchImpl = vi.fn().mockResolvedValue(
        jsonResponse({ message: { content: fenced } }),
      );
      const p = new OllamaProvider({ host: 'http://x:11434', fetchImpl });

      const out = await p.call(classifyInput);
      expect(out.action_type).toBe('classify_intent');
    });

    it('throws ProviderCallError on missing message.content', async () => {
      const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ message: {} }));
      const p = new OllamaProvider({ host: 'http://x:11434', fetchImpl });

      await expect(p.call(classifyInput)).rejects.toThrow(ProviderCallError);
    });

    it('throws ProviderCallError on invalid JSON in content', async () => {
      const fetchImpl = vi.fn().mockResolvedValue(
        jsonResponse({ message: { content: 'totally not json' } }),
      );
      const p = new OllamaProvider({ host: 'http://x:11434', fetchImpl });

      await expect(p.call(classifyInput)).rejects.toThrow(ProviderCallError);
    });

    it('throws ProviderCallError on envelope schema mismatch', async () => {
      const bad = JSON.stringify({ action_type: 'classify_intent' });
      const fetchImpl = vi.fn().mockResolvedValue(
        jsonResponse({ message: { content: bad } }),
      );
      const p = new OllamaProvider({ host: 'http://x:11434', fetchImpl });

      await expect(p.call(classifyInput)).rejects.toThrow(ProviderCallError);
    });

    it('throws ProviderCallError when payload does not match the action_type', async () => {
      // envelope is valid but payload has the shape of dispatch_vendor
      // while action_type is classify_intent.
      const drift = JSON.stringify({
        action_type: 'classify_intent',
        payload: { vendorId: 'v-1', smsBody: 'wrong shape' },
        reasoning: 'mismatched',
        confidence: 0.5,
        context_fact_ids: [],
      });
      const fetchImpl = vi.fn().mockResolvedValue(
        jsonResponse({ message: { content: drift } }),
      );
      const p = new OllamaProvider({ host: 'http://x:11434', fetchImpl });

      await expect(p.call(classifyInput)).rejects.toThrow(
        /payload schema mismatch for classify_intent/,
      );
    });

    it('throws ProviderCallError on non-2xx response', async () => {
      const fetchImpl = vi
        .fn()
        .mockResolvedValue(new Response('boom', { status: 500 }));
      const p = new OllamaProvider({ host: 'http://x:11434', fetchImpl });

      await expect(p.call(classifyInput)).rejects.toThrow(ProviderCallError);
    });

    it('throws ProviderCallError on fetch network error', async () => {
      const fetchImpl = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
      const p = new OllamaProvider({ host: 'http://x:11434', fetchImpl });

      await expect(p.call(classifyInput)).rejects.toThrow(ProviderCallError);
    });
  });

  describe('healthCheck()', () => {
    it('returns ok=true when /api/tags is 200', async () => {
      const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ models: [] }));
      const p = new OllamaProvider({ host: 'http://x:11434', fetchImpl });

      const result = await p.healthCheck();

      expect(result.ok).toBe(true);
      expect(result.latencyMs).toBeGreaterThanOrEqual(0);
      const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('http://x:11434/api/tags');
      expect(init.method).toBe('GET');
    });

    it('returns ok=false on non-2xx', async () => {
      const fetchImpl = vi
        .fn()
        .mockResolvedValue(new Response('', { status: 503 }));
      const p = new OllamaProvider({ host: 'http://x:11434', fetchImpl });

      const result = await p.healthCheck();

      expect(result.ok).toBe(false);
      expect(result.error).toContain('503');
    });

    it('returns ok=false on network error', async () => {
      const fetchImpl = vi.fn().mockRejectedValue(new Error('refused'));
      const p = new OllamaProvider({ host: 'http://x:11434', fetchImpl });

      const result = await p.healthCheck();

      expect(result.ok).toBe(false);
      expect(result.error).toBe('refused');
    });
  });

  describe('translateAnthropicToolToOllama', () => {
    it('maps name + description + input_schema to function/parameters', () => {
      const ollama = translateAnthropicToolToOllama({
        name: 'send_sms',
        description: 'Send an SMS message',
        input_schema: {
          type: 'object',
          properties: { body: { type: 'string' }, to: { type: 'string' } },
          required: ['to'],
        },
      });

      expect(ollama).toEqual({
        type: 'function',
        function: {
          name: 'send_sms',
          description: 'Send an SMS message',
          parameters: {
            type: 'object',
            properties: { body: { type: 'string' }, to: { type: 'string' } },
            required: ['to'],
          },
        },
      });
    });

    it('handles missing description and properties', () => {
      const ollama = translateAnthropicToolToOllama({
        name: 'noop',
        input_schema: { type: 'object' },
      });

      expect(ollama.function.name).toBe('noop');
      expect(ollama.function.description).toBeUndefined();
      expect(ollama.function.parameters.type).toBe('object');
      expect(ollama.function.parameters.properties).toBeUndefined();
    });
  });
});
