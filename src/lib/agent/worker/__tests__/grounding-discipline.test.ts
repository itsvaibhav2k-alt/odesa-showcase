/**
 * Grounding-discipline tests for the worker system prompt.
 *
 * The brief calls for: feed the worker an ambiguous query, assert it
 * returns confidence 0.0 + requires_review true rather than fabricating;
 * an in-context query should produce a normal proposal.
 *
 * The worker is a structured-output sub-agent — its only contract is
 * the system prompt + the per-action contract block. The actual model
 * is mocked via a lightweight `WorkerModelProvider` stand-in so the
 * test can drive the full spawn pipeline deterministically. We assert:
 *   1. The system prompt the provider receives carries the grounding
 *      rule, the confidence-calibration hard rule, and the per-org
 *      branding header.
 *   2. When the (mocked) provider returns confidence=0 + a "no info"
 *      reasoning, the spawn pipeline propagates it faithfully (no
 *      fabricated proposal, no swallowed signal).
 *   3. When the provider returns a normal proposal, the pipeline
 *      preserves confidence verbatim.
 */

import { describe, expect, it, vi } from 'vitest';

import {
  WORKER_BASE_SYSTEM_PROMPT,
  buildWorkerSystemPrompt,
  flattenSystemPrompt,
  renderWorkerBasePrompt,
} from '../system-prompt';
import { spawnPropertyWorker } from '../spawn';
import type { SupabaseLike } from '../context-loader';
import type {
  PropertyContext,
  PropertyWorkerInput,
  PropertyWorkerOutput,
  WorkerModelProvider,
} from '../types';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const PROP_ID = 'prop-discipline-1';
const ORG_ID = 'org-discipline-1';

function fixtureContext(): PropertyContext {
  return {
    property: {
      id: PROP_ID,
      organizationId: ORG_ID,
      name: '32 Sutter Apartments',
      addressLine: '32 Sutter St, San Francisco, CA',
      timezone: 'America/Los_Angeles',
      rulesText:
        'Quiet hours 10pm to 7am. Pet deposit is $300. No smoking inside.',
      autonomyLevel: 0.4,
      privacyMode: 'hosted',
    },
    facts: [],
    recentTurns: [],
    vendors: [],
    tenants: [],
    loadedAt: '2026-05-06T12:00:00.000Z',
  };
}

// Minimal SupabaseLike that satisfies loadPropertyContext for one call.
// We bypass the real loader by short-circuiting with a hand-rolled
// builder that returns the property row + empty everything else.
function makeMockClient(ctx: PropertyContext): SupabaseLike {
  return {
    from(table: string) {
      const result = (() => {
        switch (table) {
          case 'properties':
            return {
              data: {
                id: ctx.property.id,
                organization_id: ctx.property.organizationId,
                name: ctx.property.name,
                address_street: '32 Sutter St',
                address_city: 'San Francisco',
                address_state: 'CA',
                address_zip: null,
                timezone: ctx.property.timezone,
                rules_text: ctx.property.rulesText,
                autonomy_level: ctx.property.autonomyLevel,
                privacy_mode: ctx.property.privacyMode,
              },
              error: null,
            };
          case 'memory_facts':
          case 'messages':
          case 'vendors':
          case 'leases':
          case 'rent_events':
            return { data: [], error: null };
          default:
            return { data: null, error: null };
        }
      })();

      // Chainable builder — every method returns `this`; .maybeSingle
      // and `.then` resolve with the table's preset payload.
      const builder: Record<string, unknown> = {
        select: () => builder,
        eq: () => builder,
        is: () => builder,
        in: () => builder,
        order: () => builder,
        limit: () => builder,
        maybeSingle: async () => result,
        single: async () => result,
        then: <TResult1, TResult2 = never>(
          onfulfilled?:
            | ((value: { data: unknown; error: unknown }) => TResult1 | PromiseLike<TResult1>)
            | null
            | undefined,
          onrejected?:
            | ((reason: unknown) => TResult2 | PromiseLike<TResult2>)
            | null
            | undefined,
        ): Promise<TResult1 | TResult2> => {
          try {
            return Promise.resolve(result).then(
              onfulfilled ?? ((v) => v as unknown as TResult1),
              onrejected,
            );
          } catch (e) {
            if (onrejected) return Promise.resolve(onrejected(e));
            return Promise.reject(e);
          }
        },
      };
      return builder;
    },
  };
}

interface ScriptedProviderOptions {
  /** What the model returns for this call. */
  response: PropertyWorkerOutput;
  /** Optional spy to capture the input the provider received. */
  capture?: (input: PropertyWorkerInput) => void;
}

function scriptedProvider(opts: ScriptedProviderOptions): WorkerModelProvider {
  return {
    name: 'scripted-test-provider',
    supportsPromptCaching: () => false,
    healthCheck: async () => ({ ok: true, latencyMs: 0 }),
    call: async (input) => {
      opts.capture?.(input);
      return opts.response;
    },
  };
}

// ---------------------------------------------------------------------------
// Prompt-level assertions
// ---------------------------------------------------------------------------

describe('worker system prompt — grounding discipline', () => {
  it('should bake the grounding rule into the static base block', () => {
    expect(WORKER_BASE_SYSTEM_PROMPT).toMatch(/grounding rule/i);
    expect(WORKER_BASE_SYSTEM_PROMPT).toMatch(
      /training data is NOT a source/i,
    );
    expect(WORKER_BASE_SYSTEM_PROMPT).toMatch(
      /Do not invent context, prices, names, or rules/i,
    );
  });

  it('should bake the confidence-calibration hard rule into the static base block', () => {
    // The brief mandates: ungrounded → confidence 0 + requires_review true.
    expect(WORKER_BASE_SYSTEM_PROMPT).toMatch(/confidence calibration/i);
    expect(WORKER_BASE_SYSTEM_PROMPT).toMatch(/confidence: 0\.0/);
    expect(WORKER_BASE_SYSTEM_PROMPT).toMatch(/requires_review: true/);
    expect(WORKER_BASE_SYSTEM_PROMPT).toMatch(
      /Saying "I don't have that info" is a valid output/,
    );
  });

  it('should brand the worker base prompt with the per-org assistant name', () => {
    const prompt = renderWorkerBasePrompt({
      orgName: 'Galaxy Estates',
      assistantName: 'Concierge',
    });
    expect(prompt).toContain('You are Concierge, the AI property manager for Galaxy Estates');
  });

  it('should default to "Odesa" branding when no branding option is passed', () => {
    const blocks = buildWorkerSystemPrompt(fixtureContext(), 'classify_intent');
    // Default branding renders an Odesa header with a generic org name.
    expect(blocks[0].text).toContain('You are Odesa');
  });

  it('should interpolate branding from the buildWorkerSystemPrompt options', () => {
    const blocks = buildWorkerSystemPrompt(fixtureContext(), 'classify_intent', {
      branding: { orgName: 'Galaxy Estates', assistantName: 'Concierge' },
    });
    const flat = flattenSystemPrompt(blocks);
    expect(flat).toContain('You are Concierge, the AI property manager for Galaxy Estates');
    // Default branding text must NOT bleed through
    expect(flat).not.toContain('the AI property manager for the operator');
  });
});

// ---------------------------------------------------------------------------
// Pipeline-level assertions
// ---------------------------------------------------------------------------

describe('spawnPropertyWorker — grounding discipline behavior', () => {
  it('should pass an ungrounded confidence-0 + requires_review proposal through faithfully', async () => {
    // Ambiguous query: the rulebook doesn't say anything about the
    // building's parking policy. A disciplined worker returns
    // confidence 0 + a "no info" reasoning rather than fabricating.
    const ungroundedResponse: PropertyWorkerOutput = {
      action_type: 'classify_intent',
      payload: {
        intent: 'unknown',
        reasoning:
          "I don't have any rulebook entry or memory_fact about parking. Routing to review.",
      },
      reasoning:
        "Rulebook is silent on parking. requires_review: true. confidence: 0.0.",
      confidence: 0.0,
      context_fact_ids: [],
    };

    let capturedInput: PropertyWorkerInput | undefined;
    const proposal = await spawnPropertyWorker({
      propertyId: PROP_ID,
      action_type: 'classify_intent',
      data: {
        utterance: 'is there parking on weekends?',
        history: [],
        candidateIntents: [],
      },
      deps: {
        client: makeMockClient(fixtureContext()),
        provider: scriptedProvider({
          response: ungroundedResponse,
          capture: (i) => {
            capturedInput = i;
          },
        }),
      },
    });

    // Confidence preserved verbatim — no auto-bumping.
    expect(proposal.confidence).toBe(0.0);
    // Reasoning shows the discipline marker, not a confabulation.
    expect(proposal.reasoning).toMatch(/requires_review: true/);
    expect(proposal.reasoning).toMatch(/confidence: 0\.0/);
    // Action type is faithful to the request — no silent rewrite.
    expect(proposal.action_type).toBe('classify_intent');
    // Status is the pre-gate sentinel.
    expect(proposal.status).toBe('proposed');
    expect(proposal.gate_decision).toBeNull();
    // The provider received the loaded context with the ambiguous
    // query — so the discipline is the model's responsibility, not a
    // pre-filter.
    expect(capturedInput).toBeDefined();
    expect(capturedInput!.context.property.id).toBe(PROP_ID);
    expect(capturedInput!.action_type).toBe('classify_intent');
  });

  it('should pass an in-context, high-confidence proposal through unchanged', async () => {
    // In-context query: rulebook explicitly states quiet hours.
    const groundedResponse: PropertyWorkerOutput = {
      action_type: 'classify_intent',
      payload: {
        intent: 'noise_complaint',
        reasoning:
          'Rulebook line 1 sets quiet hours 10pm-7am; this matches a noise_complaint intent.',
      },
      reasoning:
        'Quiet-hours rule is in the rulebook. High confidence; no review needed.',
      confidence: 0.92,
      context_fact_ids: [],
    };

    const proposal = await spawnPropertyWorker({
      propertyId: PROP_ID,
      action_type: 'classify_intent',
      data: {
        utterance: 'my neighbor is loud at 11pm',
        history: [],
        candidateIntents: ['noise_complaint', 'maintenance_request'],
      },
      deps: {
        client: makeMockClient(fixtureContext()),
        provider: scriptedProvider({ response: groundedResponse }),
      },
    });

    expect(proposal.confidence).toBeCloseTo(0.92, 2);
    expect(proposal.reasoning).toMatch(/Quiet-hours rule is in the rulebook/);
    // Payload retained verbatim
    expect(proposal.payload).toEqual({
      intent: 'noise_complaint',
      reasoning:
        'Rulebook line 1 sets quiet hours 10pm-7am; this matches a noise_complaint intent.',
    });
  });

  it('should never silently flip a low-confidence proposal to high', async () => {
    // The pipeline is dumb-pipe with respect to confidence — the gate
    // layer (covered by commit-gate.test.ts) is what routes to review.
    // Spawn must not "round up" the model's output.
    const lowConfidenceResponses = [0.0, 0.1, 0.42, 0.7];
    for (const c of lowConfidenceResponses) {
      const provider = scriptedProvider({
        response: {
          action_type: 'classify_intent',
          payload: { intent: 'unknown', reasoning: 'ambiguous' },
          reasoning: 'low signal',
          confidence: c,
          context_fact_ids: [],
        },
      });
      const proposal = await spawnPropertyWorker({
        propertyId: PROP_ID,
        action_type: 'classify_intent',
        data: { utterance: 'hi', history: [], candidateIntents: [] },
        deps: {
          client: makeMockClient(fixtureContext()),
          provider,
        },
      });
      expect(proposal.confidence).toBeCloseTo(c, 6);
    }
  });
});

// ---------------------------------------------------------------------------
// Branding interpolation in the prompt the provider sees
// ---------------------------------------------------------------------------

describe('worker system prompt — branding interpolation', () => {
  it('should default to the Odesa brand when buildWorkerSystemPrompt has no branding option', () => {
    const blocks = buildWorkerSystemPrompt(fixtureContext(), 'classify_intent');
    expect(blocks[0].text).toMatch(/^You are Odesa,/);
  });

  it('should not double-render the branding header in non-base blocks', () => {
    const blocks = buildWorkerSystemPrompt(fixtureContext(), 'classify_intent', {
      branding: { orgName: 'Galaxy Estates', assistantName: 'Concierge' },
    });
    // The branding line must only appear in the static base block.
    const otherBlocks = blocks.slice(1).map((b) => b.text);
    for (const text of otherBlocks) {
      expect(text).not.toMatch(/^You are Concierge,/);
    }
    // But the rulebook block carries the property header, not the brand.
    expect(blocks[1].text).toContain(`PROPERTY: ${fixtureContext().property.name}`);
  });

  it('should keep the action_type contract intact on the last block (smoke check)', () => {
    const blocks = buildWorkerSystemPrompt(
      fixtureContext(),
      'draft_sms_reply',
      { branding: { orgName: 'X', assistantName: 'Y' } },
    );
    expect(blocks[blocks.length - 1].text).toContain('TASK: draft_sms_reply');
  });
});

// Vitest noisy-warning silencer for `data.length >= cap` console.warn the
// rent_events loader emits when test fixtures have empty arrays.
vi.spyOn(console, 'warn').mockImplementation(() => undefined);
