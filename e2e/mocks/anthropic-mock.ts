/**
 * Anthropic SDK mock harness — v1.5 property workers.
 *
 * The property worker calls Anthropic's Messages API through
 * `src/lib/agent/providers/hosted-haiku.ts` (and the meta-learning
 * loop calls Sonnet/Opus via the same provider abstraction). To avoid
 * burning real tokens (and to make assertions deterministic) we
 * intercept those calls.
 *
 * Pattern matches the messaging Claude mock (`src/lib/messaging/
 * claude-draft.ts` + `e2e/mocks/claude-mock.ts`):
 *
 *   1. Mock state lives on the Next server's globalThis (so HMR and
 *      cross-route invocations see the same store).
 *   2. Specs install scripts + read recorded calls via an in-process
 *      `/api/agent/test-hooks` route (owned by the agent-eng team).
 *   3. The provider's adapter detects mock-state-installed and routes
 *      through it instead of the real SDK.
 *
 * This file is the spec-side harness. The provider-side hook lives in
 * `src/lib/agent/test-hooks.ts` (owned by agent-eng).
 *
 * Scriptable axes:
 *   - per `action_type` (e.g. dispatch_vendor → fixed JSON response)
 *   - per `model` (haiku/sonnet/opus return different shapes)
 *   - regex on the user prompt body (matches the 3-phase synthesis
 *     proposer/adversary/judge prompts)
 *   - FIFO queue: scripts pop in order — supports the synthesis spec
 *     where the same model is called three times with different
 *     responses.
 */

import type { APIRequestContext } from '@playwright/test';

import { TEST_HOOKS_HEADERS } from '../fixtures/manifest';

// =====================================================================
// Public types
// =====================================================================

/** Models the mock recognises. Free-form so providers can swap freely. */
export type AnthropicModel =
  | 'claude-haiku-4-5'
  | 'claude-sonnet-4-6'
  | 'claude-opus-4-7'
  | (string & {});

/** One scripted response. The first matching script in the queue wins. */
export interface AnthropicMockScript {
  /**
   * Optional: only match when the worker is calling for this action_type.
   * The agent layer attaches `action_type` as a metadata header on each
   * Messages API call.
   */
  matchActionType?: string;
  /** Optional: only match when the model contains this substring. */
  matchModel?: string;
  /** Optional regex (JS source) matched case-insensitively against user prompt. */
  matchPattern?: string;
  /**
   * Response body the mock returns. Either a plain string (becomes the
   * single text content block) or a structured Anthropic-style
   * messages.create response. Specs typically pass a string for
   * conversational responses and a structured payload for tool-use
   * routing.
   */
  reply: string | AnthropicMockReply;
  /**
   * If true, this script is consumed once and removed from the queue.
   * Default: true (so synthesis specs can stack three responses in
   * order without configuring per-call regex).
   */
  consumeOnce?: boolean;
}

/** A structured response, mirroring Anthropic's Messages API shape. */
export interface AnthropicMockReply {
  id?: string;
  model?: AnthropicModel;
  role?: 'assistant';
  content: Array<
    | { type: 'text'; text: string }
    | {
        type: 'tool_use';
        id: string;
        name: string;
        input: Record<string, unknown>;
      }
  >;
  stop_reason?: 'end_turn' | 'tool_use' | 'max_tokens';
  usage?: {
    input_tokens: number;
    output_tokens: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
  };
}

/** What the mock recorded for one call (shape used by assertions). */
export interface AnthropicRecordedCall {
  model: string;
  systemPrompt: string;
  /** Concatenation of all user-message text blocks. */
  userPrompt: string;
  /** action_type header attached by the worker, if set. */
  actionType: string | null;
  /** Whether prompt-caching cache_control markers were present. */
  hadCacheBreakpoints: boolean;
  /** ISO timestamp the call was received. */
  receivedAt: string;
  /** Ordered list of tool-use names if the response routed through a tool. */
  toolUseNames: readonly string[];
}

export interface AnthropicMockHarness {
  /** Install the mock and seed an initial script queue. */
  install: (init?: { scripts?: AnthropicMockScript[] }) => Promise<void>;
  /** Remove the mock (call from test.afterEach). */
  uninstall: () => Promise<void>;
  /** Drop recorded calls without uninstalling. */
  reset: () => Promise<void>;
  /** Replace the script queue mid-test. */
  setScripts: (scripts: AnthropicMockScript[]) => Promise<void>;
  /** Append more scripts (FIFO) without dropping the existing queue. */
  appendScripts: (scripts: AnthropicMockScript[]) => Promise<void>;
  /** Read recorded calls so far (in order). */
  getRecorded: () => Promise<readonly AnthropicRecordedCall[]>;
  /** Convenience: count of calls per model. */
  getCallCountByModel: () => Promise<Readonly<Record<string, number>>>;
}

// =====================================================================
// Test-hooks endpoint
// =====================================================================

const HOOK_URL = '/api/agent/test-hooks';

/**
 * Server-side action verbs. The `/api/agent/test-hooks` route handler
 * (owned by agent-eng) MUST accept these. Kept as a string-literal
 * union so a typo on either side surfaces as a TS error.
 */
type AnthropicHookAction =
  | 'install_anthropic'
  | 'uninstall_anthropic'
  | 'reset_anthropic'
  | 'set_anthropic_scripts'
  | 'append_anthropic_scripts';

interface AnthropicHookPostBody {
  action: AnthropicHookAction;
  scripts?: AnthropicMockScript[];
}

interface AnthropicHookGetResponse {
  success: boolean;
  data?: {
    anthropicRecorded?: AnthropicRecordedCall[];
  };
  error?: string;
}

// =====================================================================
// Harness factory
// =====================================================================

export function createAnthropicMockHarness(
  request: APIRequestContext,
): AnthropicMockHarness {
  async function post(body: AnthropicHookPostBody): Promise<void> {
    const resp = await request.post(HOOK_URL, {
      headers: TEST_HOOKS_HEADERS,
      data: body,
    });
    if (!resp.ok()) {
      const text = await resp.text().catch(() => '');
      throw new Error(
        `anthropic mock hook ${body.action} failed: ${resp.status()} ${text}`,
      );
    }
  }

  async function getRecorded(): Promise<readonly AnthropicRecordedCall[]> {
    const resp = await request.get(HOOK_URL, { headers: TEST_HOOKS_HEADERS });
    if (!resp.ok()) {
      // The test-hooks endpoint isn't installed yet (pre-task-#6 phase).
      // Return empty so spec skeletons can run and gate on length>0.
      return [];
    }
    const json = (await resp.json()) as AnthropicHookGetResponse;
    return json.data?.anthropicRecorded ?? [];
  }

  return {
    async install(init) {
      await post({
        action: 'install_anthropic',
        scripts: init?.scripts ?? [],
      });
    },
    async uninstall() {
      await post({ action: 'uninstall_anthropic' });
    },
    async reset() {
      await post({ action: 'reset_anthropic' });
    },
    async setScripts(scripts) {
      await post({ action: 'set_anthropic_scripts', scripts });
    },
    async appendScripts(scripts) {
      await post({ action: 'append_anthropic_scripts', scripts });
    },
    getRecorded,
    async getCallCountByModel() {
      const recorded = await getRecorded();
      const counts: Record<string, number> = {};
      for (const call of recorded) {
        counts[call.model] = (counts[call.model] ?? 0) + 1;
      }
      return counts;
    },
  };
}

// =====================================================================
// Convenience builders for common mock-reply shapes
// =====================================================================

/** Build a plain text-only assistant response. */
export function textReply(text: string): AnthropicMockReply {
  return {
    role: 'assistant',
    stop_reason: 'end_turn',
    content: [{ type: 'text', text }],
    usage: { input_tokens: 100, output_tokens: text.length },
  };
}

/**
 * Build a tool-use assistant response. Used by the synthesis +
 * commit-gate specs that route through proposer/judge prompts.
 */
export function toolUseReply(
  toolName: string,
  input: Record<string, unknown>,
  opts: { id?: string; usage?: AnthropicMockReply['usage'] } = {},
): AnthropicMockReply {
  return {
    role: 'assistant',
    stop_reason: 'tool_use',
    content: [
      {
        type: 'tool_use',
        id: opts.id ?? `toolu_${Math.random().toString(36).slice(2, 10)}`,
        name: toolName,
        input,
      },
    ],
    usage: opts.usage ?? { input_tokens: 200, output_tokens: 50 },
  };
}

// ---------------------------------------------------------------------------
// workerOutputReply — typed worker-envelope builder
// ---------------------------------------------------------------------------
//
// Emits the JSON shape `propertyWorkerOutputSchema` requires (action_type +
// payload + reasoning + confidence + context_fact_ids), wrapped in a
// `textReply` so the provider's `parseOutput` finds it. Each action_type
// has its required fields hydrated with sensible defaults so a spec that
// only cares about ONE field doesn't have to spell out the rest.
//
// Required fields per action_type (mirror of WORKER_PAYLOAD_SCHEMAS in
// `src/lib/agent/worker/types.ts:359-401`):
//   draft_sms_reply    → { body, tone }
//   classify_intent    → { intent, reasoning }
//   confirm_emergency  → { isEmergency, category, recommendedAction }
//   polish_briefing    → { prose }
//   dispatch_vendor    → { vendorId, smsBody }
//   update_rulebook    → { newRulebook, diffSummary }
//   voice_call_review  → { callId, summary, intents, riskFlags }
//
// Why a builder instead of full payloads at every callsite: the
// per-action narrowing introduced in providers-eng's `182a31d` rejects
// any payload missing required fields with a 500. Forgetting one field
// in a spec produced "spawn returned 500" with no obvious cause.

export type WorkerActionType =
  | 'draft_sms_reply'
  | 'classify_intent'
  | 'confirm_emergency'
  | 'polish_briefing'
  | 'dispatch_vendor'
  | 'update_rulebook'
  | 'voice_call_review';

interface WorkerOutputReplyOptions {
  reasoning?: string;
  confidence?: number;
  contextFactIds?: readonly string[];
}

const PAYLOAD_DEFAULTS: Record<WorkerActionType, Record<string, unknown>> = {
  draft_sms_reply: {
    body: 'Acknowledged.',
    tone: 'neutral',
  },
  classify_intent: {
    intent: 'general_question',
    reasoning: 'mock classification',
  },
  confirm_emergency: {
    isEmergency: false,
    category: 'unknown',
    recommendedAction: 'route_to_drafts',
  },
  polish_briefing: {
    prose: 'Mock polished briefing.',
  },
  dispatch_vendor: {
    vendorId: '00000000-0000-0000-0000-000000000000',
    smsBody: 'Mock dispatch SMS.',
  },
  update_rulebook: {
    newRulebook: 'Mock rulebook content.',
    diffSummary: 'Mock diff summary.',
  },
  // Voice Operator V1 — system-generated by the voice webhook, never a
  // model; default exists so a spec can assert queue rendering.
  voice_call_review: {
    callId: '00000000-0000-0000-0000-000000000000',
    summary: 'Mock voice call outcome summary.',
    intents: ['maintenance_request'],
    riskFlags: [],
  },
};

/**
 * Build a worker-output text reply with per-action defaults filled in.
 *
 * @example
 * // Caller only cares about the body; tone defaults to 'neutral'.
 * scripts: [{
 *   matchActionType: 'draft_sms_reply',
 *   reply: workerOutputReply('draft_sms_reply', { body: 'Hi there' }),
 * }]
 */
export function workerOutputReply(
  actionType: WorkerActionType,
  partialPayload: Record<string, unknown> = {},
  options: WorkerOutputReplyOptions = {},
): AnthropicMockReply {
  const payload = { ...PAYLOAD_DEFAULTS[actionType], ...partialPayload };
  const envelope = {
    action_type: actionType,
    payload,
    reasoning: options.reasoning ?? 'mock worker reasoning',
    confidence: options.confidence ?? 0.8,
    context_fact_ids: options.contextFactIds ? [...options.contextFactIds] : [],
  };
  return textReply(JSON.stringify(envelope));
}

/**
 * Sequence helper for the 3-phase synthesis spec. Returns proposer →
 * adversary → judge replies in FIFO order.
 */
export function synthesisReplyTriple(opts: {
  proposed: { factType: string; content: Record<string, unknown> };
  adversaryFinding: string;
  judge: 'merge' | 'supersede' | 'reject';
}): readonly AnthropicMockScript[] {
  return [
    {
      matchActionType: 'synthesize_proposer',
      reply: toolUseReply('propose_fact', {
        fact_type: opts.proposed.factType,
        content: opts.proposed.content,
      }),
      consumeOnce: true,
    },
    {
      matchActionType: 'synthesize_adversary',
      reply: textReply(opts.adversaryFinding),
      consumeOnce: true,
    },
    {
      matchActionType: 'synthesize_judge',
      reply: toolUseReply('apply_synthesis', {
        action: opts.judge,
      }),
      consumeOnce: true,
    },
  ];
}
