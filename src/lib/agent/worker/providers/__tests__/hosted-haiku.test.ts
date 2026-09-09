import { afterEach, describe, expect, it, vi } from 'vitest';

import type {
  PropertyContext,
  PropertyWorkerInput,
} from '@/lib/agent/worker/types';

import {
  HOSTED_HAIKU_PROVIDER_NAME,
  HostedHaikuProvider,
} from '../hosted-haiku';
import { HOSTED_HAIKU_MODEL, ProviderCallError } from '../types';

vi.mock('@anthropic-ai/sdk', () => {
  class MockAnthropic {
    messages = { create: vi.fn() };
  }
  return { default: MockAnthropic };
});

const fixedContext: PropertyContext = {
  property: {
    id: 'prop-1',
    organizationId: 'org-1',
    name: '123 Main',
    addressLine: '123 Main St',
    timezone: 'America/New_York',
    rulesText: 'Be direct. No apologies.',
    autonomyLevel: 0.5,
    privacyMode: 'hosted',
  },
  facts: [
    {
      id: 'fact-1',
      factType: 'tenant_pattern',
      subjectId: 'tenant-1',
      content: { note: 'pays late on weekends' },
      confidence: 0.8,
      source: 'observed',
      createdAt: '2026-04-01T00:00:00Z',
    },
  ],
  recentTurns: [
    {
      conversationId: 'conv-1',
      channel: 'sms',
      direction: 'inbound',
      body: 'rent question',
      occurredAt: '2026-04-26T12:00:00Z',
    },
  ],
  vendors: [
    {
      id: 'vendor-1',
      name: 'Pete Plumbing',
      category: 'plumbing',
      acceptanceRate: 0.92,
    },
  ],
  tenants: [
    {
      id: 'tenant-1',
      fullName: 'Marcus Reed',
      unitLabel: '2B',
      rentStatus: 'late',
      rentAmount: 1450,
    },
  ],
  loadedAt: '2026-04-27T10:00:00Z',
};

const draftInput: PropertyWorkerInput = {
  propertyId: 'prop-1',
  organizationId: 'org-1',
  action_type: 'draft_sms_reply',
  data: {
    tenantId: 'tenant-1',
    tenantName: 'Marcus Reed',
    phoneE164: '+15551234567',
    conversationId: 'conv-1',
    inboundBody: 'when is rent due',
    history: [],
  },
  context: fixedContext,
};

const validOutput = {
  action_type: 'draft_sms_reply',
  payload: { body: "Rent's due on the 1st.", tone: 'neutral' },
  reasoning: 'Owner rulebook says be direct.',
  confidence: 0.9,
  context_fact_ids: ['fact-1'],
};

function makeProvider(createImpl: ReturnType<typeof vi.fn>) {
  return new HostedHaikuProvider({
    client: { messages: { create: createImpl } } as never,
  });
}

afterEach(() => vi.restoreAllMocks());

describe('HostedHaikuProvider', () => {
  describe('name + caching', () => {
    it('exposes the stable provider name', () => {
      const provider = makeProvider(vi.fn());
      expect(provider.name).toBe(HOSTED_HAIKU_PROVIDER_NAME);
      expect(provider.name).toBe('haiku-4-5');
    });

    it('reports prompt-caching support', () => {
      const provider = makeProvider(vi.fn());
      expect(provider.supportsPromptCaching()).toBe(true);
    });
  });

  describe('call()', () => {
    it('sends model + messages and parses the JSON envelope', async () => {
      const create = vi.fn().mockResolvedValue({
        content: [{ type: 'text', text: JSON.stringify(validOutput) }],
      });
      const provider = makeProvider(create);

      const out = await provider.call(draftInput);

      expect(out.action_type).toBe('draft_sms_reply');
      expect(out.confidence).toBe(0.9);
      expect(out.context_fact_ids).toEqual(['fact-1']);

      const callArgs = create.mock.calls[0]?.[0];
      expect(callArgs.model).toBe(HOSTED_HAIKU_MODEL);
      expect(callArgs.messages).toHaveLength(1);
      expect(callArgs.messages[0].role).toBe('user');
    });

    it('places cache_control:{type:"ephemeral"} ONLY on the static base block', async () => {
      const create = vi.fn().mockResolvedValue({
        content: [{ type: 'text', text: JSON.stringify(validOutput) }],
      });
      const provider = makeProvider(create);

      await provider.call(draftInput);

      const sysBlocks = create.mock.calls[0]?.[0].system;
      expect(Array.isArray(sysBlocks)).toBe(true);
      // Canonical buildWorkerSystemPrompt structure:
      // [base(cached), property, facts, turns, roster, task]
      expect(sysBlocks.length).toBeGreaterThanOrEqual(2);
      expect(sysBlocks[0].type).toBe('text');
      expect(sysBlocks[0].cache_control).toEqual({ type: 'ephemeral' });
      // No subsequent block carries cache_control — those vary per call.
      for (let i = 1; i < sysBlocks.length; i++) {
        expect(sysBlocks[i].type).toBe('text');
        expect(sysBlocks[i].cache_control).toBeUndefined();
      }
    });

    it('puts the property identity + rulebook + facts + roster into uncached blocks', async () => {
      const create = vi.fn().mockResolvedValue({
        content: [{ type: 'text', text: JSON.stringify(validOutput) }],
      });
      const provider = makeProvider(create);

      await provider.call(draftInput);

      const sysBlocks = create.mock.calls[0]?.[0].system as Array<{
        text: string;
        cache_control?: unknown;
      }>;
      const uncachedText = sysBlocks
        .filter((b) => b.cache_control === undefined)
        .map((b) => b.text)
        .join('\n');
      expect(uncachedText).toContain('123 Main');
      expect(uncachedText).toContain('prop-1');
      expect(uncachedText).toContain('Be direct.');
      expect(uncachedText).toContain('Pete Plumbing');
      expect(uncachedText).toContain('Marcus Reed');
      expect(uncachedText).toContain('fact-1');
      // The static base block stays property-agnostic — no property
      // name leaks into it.
      expect(sysBlocks[0].text).not.toContain('123 Main');
      expect(sysBlocks[0].text).not.toContain('Marcus Reed');
    });

    it('puts the per-action contract in the final task block', async () => {
      const create = vi.fn().mockResolvedValue({
        content: [{ type: 'text', text: JSON.stringify(validOutput) }],
      });
      const provider = makeProvider(create);

      await provider.call(draftInput);

      const sysBlocks = create.mock.calls[0]?.[0].system as Array<{
        text: string;
      }>;
      const taskBlock = sysBlocks[sysBlocks.length - 1];
      expect(taskBlock.text).toContain('TASK: draft_sms_reply');
      expect(taskBlock.text).toContain('NOW: 2026-04-27T10:00:00Z');
    });

    it('forwards AbortSignal as the SDK request option', async () => {
      const create = vi.fn().mockResolvedValue({
        content: [{ type: 'text', text: JSON.stringify(validOutput) }],
      });
      const provider = makeProvider(create);
      const ac = new AbortController();

      await provider.call(draftInput, { signal: ac.signal });

      expect(create.mock.calls[0]?.[1]).toEqual({ signal: ac.signal });
    });

    it('omits the request-options arg when no signal is provided', async () => {
      const create = vi.fn().mockResolvedValue({
        content: [{ type: 'text', text: JSON.stringify(validOutput) }],
      });
      const provider = makeProvider(create);

      await provider.call(draftInput);

      expect(create.mock.calls[0]?.[1]).toBeUndefined();
    });

    it('strips ```json fences before parsing', async () => {
      const create = vi.fn().mockResolvedValue({
        content: [
          {
            type: 'text',
            text: '```json\n' + JSON.stringify(validOutput) + '\n```',
          },
        ],
      });
      const provider = makeProvider(create);

      const out = await provider.call(draftInput);
      expect(out.action_type).toBe('draft_sms_reply');
    });

    it('throws ProviderCallError on invalid JSON', async () => {
      const create = vi.fn().mockResolvedValue({
        content: [{ type: 'text', text: 'not json at all' }],
      });
      const provider = makeProvider(create);

      await expect(provider.call(draftInput)).rejects.toThrow(ProviderCallError);
    });

    it('throws ProviderCallError on envelope schema mismatch', async () => {
      const create = vi.fn().mockResolvedValue({
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              action_type: 'draft_sms_reply',
              payload: {},
              // missing reasoning, confidence
            }),
          },
        ],
      });
      const provider = makeProvider(create);

      await expect(provider.call(draftInput)).rejects.toThrow(ProviderCallError);
    });

    it('throws ProviderCallError when payload does not match the action_type', async () => {
      // envelope is valid but payload has the shape of confirm_emergency
      // while action_type is draft_sms_reply.
      const create = vi.fn().mockResolvedValue({
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              action_type: 'draft_sms_reply',
              payload: {
                isEmergency: true,
                category: 'water_leak',
                recommendedAction: 'escalate_now',
              },
              reasoning: 'mismatched',
              confidence: 0.5,
              context_fact_ids: [],
            }),
          },
        ],
      });
      const provider = makeProvider(create);

      await expect(provider.call(draftInput)).rejects.toThrow(
        /payload schema mismatch for draft_sms_reply/,
      );
    });

    it('throws ProviderCallError when the SDK rejects', async () => {
      const create = vi.fn().mockRejectedValue(
        Object.assign(new Error('rate limited'), { status: 429 }),
      );
      const provider = makeProvider(create);

      await expect(provider.call(draftInput)).rejects.toThrow(ProviderCallError);
    });

    it('throws ProviderCallError when no text blocks are returned', async () => {
      const create = vi.fn().mockResolvedValue({
        content: [{ type: 'tool_use', id: 't1', name: 'x', input: {} }],
      });
      const provider = makeProvider(create);

      await expect(provider.call(draftInput)).rejects.toThrow(ProviderCallError);
    });
  });

  describe('healthCheck()', () => {
    it('returns ok=true on successful ping', async () => {
      const create = vi
        .fn()
        .mockResolvedValue({ content: [{ type: 'text', text: 'pong' }] });
      const provider = makeProvider(create);

      const result = await provider.healthCheck();

      expect(result.ok).toBe(true);
      expect(result.latencyMs).toBeGreaterThanOrEqual(0);
      expect(create.mock.calls[0]?.[0].max_tokens).toBe(8);
    });

    it('returns ok=false with the error message on failure', async () => {
      const create = vi.fn().mockRejectedValue(new Error('boom'));
      const provider = makeProvider(create);

      const result = await provider.healthCheck();

      expect(result.ok).toBe(false);
      expect(result.error).toBe('boom');
    });
  });
});
