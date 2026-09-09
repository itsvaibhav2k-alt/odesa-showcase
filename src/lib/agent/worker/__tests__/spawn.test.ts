/**
 * Unit tests for spawn.ts.
 *
 * Validates the full spawn pipeline against a hand-rolled
 * Supabase-shaped client + a hand-rolled WorkerModelProvider:
 *   - context loads, gets handed to the provider
 *   - provider output is validated against propertyWorkerOutputSchema
 *   - per-action payload schemas catch shape errors
 *   - action_type mismatches between caller and model raise
 *   - happy path returns a well-formed in-memory ActionProposal
 */

import { describe, expect, it } from 'vitest';

import { spawnPropertyWorker } from '../spawn';
import {
  type PropertyWorkerInput,
  type PropertyWorkerOutput,
  type WorkerModelProvider,
  WorkerOutputValidationError,
} from '../types';
import type { SupabaseLike } from '../context-loader';

// ---------------------------------------------------------------------------
// Mock client (mirrors context-loader.test.ts)
// ---------------------------------------------------------------------------

function makeClient(): SupabaseLike {
  function builder(table: string) {
    const handlers: Record<string, () => { data: unknown; error: null }> = {
      properties: () => ({
        data: {
          id: 'prop-1',
          organization_id: 'org-1',
          name: 'Test Property',
          address_street: null,
          address_city: null,
          address_state: null,
          address_zip: null,
          timezone: 'America/Los_Angeles',
          rules_text: 'be direct',
          autonomy_level: 0.4,
          privacy_mode: 'hosted',
        },
        error: null,
      }),
      memory_facts: () => ({
        data: [
          {
            id: 'fact-1',
            fact_type: 'tenant_pattern',
            subject_id: 'tenant-1',
            content: { paysOnDay: 5 },
            confidence: 0.7,
            source: 'observed',
            created_at: '2026-04-22T10:00:00Z',
          },
        ],
        error: null,
      }),
      messages: () => ({ data: [], error: null }),
      vendors: () => ({ data: [], error: null }),
      leases: () => ({ data: [], error: null }),
      rent_events: () => ({ data: [], error: null }),
      organizations: () => ({
        data: {
          id: 'org-1',
          name: 'Galaxy Estates',
          assistant_name: 'Concierge',
        },
        error: null,
      }),
    };

    const b: Record<string, unknown> = {
      select: () => b,
      eq: () => b,
      is: () => b,
      in: () => b,
      order: () => b,
      limit: () => b,
      maybeSingle: async () => handlers[table](),
      single: async () => handlers[table](),
      then: <R1, R2 = never>(
        onfulfilled?: ((v: { data: unknown; error: unknown }) => R1 | PromiseLike<R1>) | null,
        onrejected?: ((r: unknown) => R2 | PromiseLike<R2>) | null,
      ) => Promise.resolve(handlers[table]()).then(
        onfulfilled ?? ((v) => v as unknown as R1),
        onrejected,
      ),
    };
    return b;
  }

  return {
    from(table: string) {
      return builder(table);
    },
  };
}

// ---------------------------------------------------------------------------
// Mock provider
// ---------------------------------------------------------------------------

function makeProvider(
  responder: (input: PropertyWorkerInput) => PropertyWorkerOutput | unknown,
  name = 'mock-haiku',
): WorkerModelProvider {
  return {
    name,
    supportsPromptCaching: () => true,
    healthCheck: async () => ({ ok: true, latencyMs: 1 }),
    call: async (input) => responder(input) as PropertyWorkerOutput,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('spawnPropertyWorker', () => {
  it('returns a well-formed ActionProposal on the happy path', async () => {
    let receivedInput: PropertyWorkerInput | null = null;
    const provider = makeProvider((input) => {
      receivedInput = input;
      return {
        action_type: 'draft_sms_reply',
        payload: {
          body: 'Hi! Checking with the landlord — back to you within 24h.',
          tone: 'warm',
        },
        reasoning: 'Tenant pattern fact-1 indicates a polite but firm tone.',
        confidence: 0.82,
        context_fact_ids: ['fact-1'],
      };
    });

    const proposal = await spawnPropertyWorker({
      propertyId: 'prop-1',
      action_type: 'draft_sms_reply',
      data: {
        tenantId: 'tenant-1',
        tenantName: 'Marcus Lee',
        phoneE164: '+15551234567',
        conversationId: 'conv-1',
        inboundBody: 'when can someone come by?',
        history: [],
      },
      deps: {
        client: makeClient(),
        provider,
        now: () => new Date('2026-04-27T00:00:00Z'),
      },
    });

    expect(proposal.id).toBeNull();
    expect(proposal.gate_decision).toBeNull();
    expect(proposal.status).toBe('proposed');
    expect(proposal.organizationId).toBe('org-1');
    expect(proposal.propertyId).toBe('prop-1');
    expect(proposal.action_type).toBe('draft_sms_reply');
    expect(proposal.workerModel).toBe('mock-haiku');
    expect(proposal.confidence).toBeCloseTo(0.82, 2);
    expect(proposal.context_fact_ids).toEqual(['fact-1']);
    expect(proposal.reasoning).toContain('fact-1');
    expect(proposal.createdAt).toBe('2026-04-27T00:00:00.000Z');

    // Provider received the loaded context
    expect(receivedInput).not.toBeNull();
    expect(receivedInput!.propertyId).toBe('prop-1');
    expect(receivedInput!.organizationId).toBe('org-1');
    expect(receivedInput!.context.facts).toHaveLength(1);
    expect(receivedInput!.context.facts[0].id).toBe('fact-1');
  });

  it('throws WorkerOutputValidationError on missing required envelope fields', async () => {
    const provider = makeProvider(() => ({
      action_type: 'draft_sms_reply',
      // missing payload + confidence + reasoning
      context_fact_ids: [],
    }));

    await expect(
      spawnPropertyWorker({
        propertyId: 'prop-1',
        action_type: 'draft_sms_reply',
        data: { foo: 'bar' },
        deps: { client: makeClient(), provider },
      }),
    ).rejects.toBeInstanceOf(WorkerOutputValidationError);
  });

  it('throws WorkerOutputValidationError when payload shape is wrong for action_type', async () => {
    const provider = makeProvider(() => ({
      action_type: 'draft_sms_reply',
      payload: {
        // wrong tone enum value
        body: 'hello',
        tone: 'sarcastic',
      },
      reasoning: 'shrug',
      confidence: 0.5,
      context_fact_ids: [],
    }));

    await expect(
      spawnPropertyWorker({
        propertyId: 'prop-1',
        action_type: 'draft_sms_reply',
        data: {},
        deps: { client: makeClient(), provider },
      }),
    ).rejects.toThrow(WorkerOutputValidationError);
  });

  it('throws when model echoes a different action_type', async () => {
    const provider = makeProvider(() => ({
      action_type: 'classify_intent',
      payload: {
        intent: 'rent_balance',
        reasoning: 'mentions rent',
      },
      reasoning: 'echoed wrong verb',
      confidence: 0.5,
      context_fact_ids: [],
    }));

    await expect(
      spawnPropertyWorker({
        propertyId: 'prop-1',
        action_type: 'draft_sms_reply',
        data: {},
        deps: { client: makeClient(), provider },
      }),
    ).rejects.toThrow(/action_type=classify_intent/);
  });

  it('rejects confidence values outside [0,1]', async () => {
    const provider = makeProvider(() => ({
      action_type: 'classify_intent',
      payload: { intent: 'unknown', reasoning: 'meh' },
      reasoning: 'meh',
      confidence: 1.5,
      context_fact_ids: [],
    }));

    await expect(
      spawnPropertyWorker({
        propertyId: 'prop-1',
        action_type: 'classify_intent',
        data: {},
        deps: { client: makeClient(), provider },
      }),
    ).rejects.toThrow(WorkerOutputValidationError);
  });

  it('validates per-action_type contracts for confirm_emergency', async () => {
    const provider = makeProvider(() => ({
      action_type: 'confirm_emergency',
      payload: {
        isEmergency: true,
        category: 'water_leak',
        recommendedAction: 'escalate_now',
      },
      reasoning: 'matches water_leak phrase',
      confidence: 0.95,
      context_fact_ids: [],
    }));

    const proposal = await spawnPropertyWorker({
      propertyId: 'prop-1',
      action_type: 'confirm_emergency',
      data: {
        utterance: 'water everywhere',
        category: 'water_leak',
        matchedPhrase: 'water everywhere',
      },
      deps: { client: makeClient(), provider },
    });

    expect(proposal.action_type).toBe('confirm_emergency');
    const payload = proposal.payload as {
      isEmergency: boolean;
      recommendedAction: string;
    };
    expect(payload.isEmergency).toBe(true);
    expect(payload.recommendedAction).toBe('escalate_now');
  });

  it('loads org branding and threads it into the provider input', async () => {
    let receivedInput: PropertyWorkerInput | null = null;
    const provider = makeProvider((input) => {
      receivedInput = input;
      return {
        action_type: 'classify_intent',
        payload: { intent: 'rent_balance', reasoning: 'mentions rent' },
        reasoning: 'meets keyword',
        confidence: 0.9,
        context_fact_ids: [],
      };
    });

    await spawnPropertyWorker({
      propertyId: 'prop-1',
      action_type: 'classify_intent',
      data: {
        utterance: 'how much do I owe',
        history: [],
        candidateIntents: ['rent_balance', 'office_hours_and_contact'],
      },
      deps: { client: makeClient(), provider },
    });

    expect(receivedInput).not.toBeNull();
    expect(receivedInput!.branding).toEqual({
      orgName: 'Galaxy Estates',
      assistantName: 'Concierge',
    });
  });

  it('omits branding when org load fails (provider falls back to defaults)', async () => {
    // Build a client where the organizations table throws — branding load
    // failure must not abort the spawn; provider receives input.branding=undefined
    // and falls back to DEFAULT_BRANDING in buildWorkerSystemPrompt.
    const baseClient = makeClient();
    const client: SupabaseLike = {
      from(table: string) {
        if (table === 'organizations') {
          // mimic an unhandled handler — call site throws
          const b: Record<string, unknown> = {
            select: () => b,
            eq: () => b,
            maybeSingle: async () => {
              throw new Error('network blip');
            },
            single: async () => {
              throw new Error('network blip');
            },
          };
          return b;
        }
        return baseClient.from(table);
      },
    };

    let receivedInput: PropertyWorkerInput | null = null;
    const provider = makeProvider((input) => {
      receivedInput = input;
      return {
        action_type: 'classify_intent',
        payload: { intent: 'rent_balance', reasoning: 'mentions rent' },
        reasoning: 'meets keyword',
        confidence: 0.9,
        context_fact_ids: [],
      };
    });

    await spawnPropertyWorker({
      propertyId: 'prop-1',
      action_type: 'classify_intent',
      data: {
        utterance: 'how much do I owe',
        history: [],
        candidateIntents: ['rent_balance', 'office_hours_and_contact'],
      },
      deps: { client, provider },
    });

    expect(receivedInput).not.toBeNull();
    expect(receivedInput!.branding).toBeUndefined();
  });

  it('captures the worker_model name from the provider', async () => {
    const provider = makeProvider(
      () => ({
        action_type: 'classify_intent',
        payload: { intent: 'rent_balance', reasoning: 'mentioned rent' },
        reasoning: 'meets keyword',
        confidence: 0.9,
        context_fact_ids: [],
      }),
      'ollama-llama3.3:70b',
    );

    const proposal = await spawnPropertyWorker({
      propertyId: 'prop-1',
      action_type: 'classify_intent',
      data: {
        utterance: 'how much do I owe',
        history: [],
        candidateIntents: ['rent_balance', 'office_hours_and_contact'],
      },
      deps: { client: makeClient(), provider },
    });

    expect(proposal.workerModel).toBe('ollama-llama3.3:70b');
  });
});
