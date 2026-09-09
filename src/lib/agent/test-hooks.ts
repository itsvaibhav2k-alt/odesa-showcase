/**
 * Test hooks for the v1.5 property-worker agent layer.
 *
 * Mirrors `src/lib/messaging/test-hooks.ts`. State pinned to globalThis
 * so Next dev-mode HMR + cross-route invocations all see the same
 * store. Specs install + read this state via the `/api/agent/test-hooks`
 * route.
 *
 * # Integration contract
 *
 * Provider call sites (HostedHaikuProvider, future SonnetSynthesizer,
 * OpusMetaLearner) consult this module before instantiating the real
 * Anthropic SDK client:
 *
 *   import { getAnthropicMockClient, recordAnthropicCall } from
 *     '@/lib/agent/test-hooks';
 *
 *   const mockClient = getAnthropicMockClient();
 *   this.client =
 *     options.client ??
 *     mockClient ??
 *     new Anthropic({ apiKey: ... });
 *
 * Then before returning each call result, record what the mock saw:
 *
 *   recordAnthropicCall({ model, systemPrompt, userPrompt, actionType,
 *     hadCacheBreakpoints, toolUseNames });
 *
 * Production never installs the mock state, so the `??` short-circuit
 * skips test-only code paths in real deployments.
 *
 * # Why module state vs vitest mocks
 *
 * Playwright runs the real Next server in a separate process; spec-side
 * vitest mocks of '@anthropic-ai/sdk' wouldn't apply. Module state on
 * the server process + a test-hooks API route is the only way the
 * spec process can observe + control what the worker layer sees.
 */

import type Anthropic from '@anthropic-ai/sdk';

// =====================================================================
// Public types — kept structurally aligned with e2e/mocks/anthropic-mock.ts
// =====================================================================

export interface AnthropicMockReply {
  id?: string;
  model?: string;
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

export interface AnthropicMockScript {
  matchActionType?: string;
  matchModel?: string;
  matchPattern?: string;
  reply: string | AnthropicMockReply;
  consumeOnce?: boolean;
}

export interface AnthropicRecordedCall {
  model: string;
  systemPrompt: string;
  userPrompt: string;
  actionType: string | null;
  hadCacheBreakpoints: boolean;
  receivedAt: string;
  toolUseNames: readonly string[];
}

interface AnthropicMockState {
  scripts: AnthropicMockScript[];
  recorded: AnthropicRecordedCall[];
}

// =====================================================================
// Global slot
// =====================================================================

const GLOBAL_KEY = '__odesaAgentMockState__';
type GlobalWithMock = typeof globalThis & {
  [GLOBAL_KEY]?: { state: AnthropicMockState | null };
};

function slot(): { state: AnthropicMockState | null } {
  const g = globalThis as GlobalWithMock;
  if (!g[GLOBAL_KEY]) g[GLOBAL_KEY] = { state: null };
  return g[GLOBAL_KEY]!;
}

function getState(): AnthropicMockState | null {
  return slot().state;
}

function setState(next: AnthropicMockState | null): void {
  slot().state = next;
}

// =====================================================================
// Lifecycle (called from `/api/agent/test-hooks`)
// =====================================================================

export function installAnthropicMock(
  initialScripts: AnthropicMockScript[] = [],
): AnthropicMockState {
  const fresh: AnthropicMockState = {
    scripts: [...initialScripts],
    recorded: [],
  };
  setState(fresh);
  return fresh;
}

export function uninstallAnthropicMock(): void {
  setState(null);
}

export function resetAnthropicMock(): void {
  const current = getState();
  if (!current) return;
  current.recorded = [];
}

export function setAnthropicMockScripts(scripts: AnthropicMockScript[]): void {
  let current = getState();
  if (!current) current = installAnthropicMock();
  current.scripts = [...scripts];
}

export function appendAnthropicMockScripts(
  scripts: AnthropicMockScript[],
): void {
  let current = getState();
  if (!current) current = installAnthropicMock();
  current.scripts.push(...scripts);
}

export function getAnthropicMockState(): AnthropicMockState | null {
  return getState();
}

export function getAnthropicMockRecorded(): readonly AnthropicRecordedCall[] {
  return getState()?.recorded ?? [];
}

// =====================================================================
// Provider integration helpers
// =====================================================================

export interface RecordAnthropicCallArgs {
  model: string;
  systemPrompt: string;
  userPrompt: string;
  actionType?: string | null;
  hadCacheBreakpoints?: boolean;
  toolUseNames?: readonly string[];
}

/**
 * Append one recorded call. No-op when the mock isn't installed (so
 * provider code can call this unconditionally without a guard).
 */
export function recordAnthropicCall(args: RecordAnthropicCallArgs): void {
  const current = getState();
  if (!current) return;
  current.recorded.push({
    model: args.model,
    systemPrompt: args.systemPrompt,
    userPrompt: args.userPrompt,
    actionType: args.actionType ?? null,
    hadCacheBreakpoints: Boolean(args.hadCacheBreakpoints),
    receivedAt: new Date().toISOString(),
    toolUseNames: [...(args.toolUseNames ?? [])],
  });
}

/**
 * Pull one scripted reply matching the given call shape. Returns null
 * when no script matches OR when the mock isn't installed (provider
 * should fall back to the real SDK client in that case).
 */
export function consumeAnthropicMockReply(args: {
  model: string;
  systemPrompt: string;
  userPrompt: string;
  actionType?: string | null;
}): AnthropicMockReply | null {
  const current = getState();
  if (!current) return null;
  for (let i = 0; i < current.scripts.length; i++) {
    const script = current.scripts[i]!;
    if (
      script.matchActionType &&
      script.matchActionType !== (args.actionType ?? '')
    ) {
      continue;
    }
    if (script.matchModel && !args.model.includes(script.matchModel)) {
      continue;
    }
    if (script.matchPattern) {
      const re = new RegExp(script.matchPattern, 'i');
      if (!re.test(args.userPrompt) && !re.test(args.systemPrompt)) {
        continue;
      }
    }
    const reply = normaliseReply(script.reply, args.model);
    if (script.consumeOnce !== false) {
      current.scripts.splice(i, 1);
    }
    return reply;
  }
  return null;
}

function normaliseReply(
  reply: string | AnthropicMockReply,
  fallbackModel: string,
): AnthropicMockReply {
  if (typeof reply === 'string') {
    return {
      role: 'assistant',
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: reply }],
      usage: { input_tokens: 100, output_tokens: reply.length },
      model: fallbackModel,
    };
  }
  return { ...reply, model: reply.model ?? fallbackModel };
}

// =====================================================================
// Mock SDK client — drop-in for `new Anthropic()` when mock is installed
// =====================================================================

/**
 * Returns a stand-in for `Pick<Anthropic, 'messages'>` that consults
 * the mock state. Returns null when no mock is installed.
 *
 * The provider layer should pass this to its `client` slot:
 *
 *   const mockClient = getAnthropicMockClient();
 *   this.client = options.client ?? mockClient ?? new Anthropic({...});
 */
export function getAnthropicMockClient(): Pick<Anthropic, 'messages'> | null {
  if (!getState()) return null;

  const messages = {
    async create(
      params: {
        model: string;
        system?: unknown;
        messages?: Array<{ role: string; content: unknown }>;
      },
    ) {
      const systemPrompt = stringifySystem(params.system);
      const userPrompt = stringifyMessages(params.messages);
      const actionType = extractActionType(systemPrompt, userPrompt);
      const hadCacheBreakpoints = detectCacheBreakpoints(params.system);

      const reply = consumeAnthropicMockReply({
        model: params.model,
        systemPrompt,
        userPrompt,
        actionType,
      });

      const toolUseNames =
        reply?.content
          ?.filter(
            (b): b is { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> } =>
              b.type === 'tool_use',
          )
          .map((b) => b.name) ?? [];

      recordAnthropicCall({
        model: params.model,
        systemPrompt,
        userPrompt,
        actionType,
        hadCacheBreakpoints,
        toolUseNames,
      });

      if (!reply) {
        // No script matched — return a minimal default so the provider
        // doesn't crash. Specs that rely on a specific reply must
        // script for it explicitly.
        return defaultMockResponse(params.model);
      }
      return {
        id: reply.id ?? `msg_mock_${Date.now()}`,
        type: 'message',
        role: reply.role ?? 'assistant',
        model: reply.model ?? params.model,
        content: reply.content,
        stop_reason: reply.stop_reason ?? 'end_turn',
        stop_sequence: null,
        usage: reply.usage ?? { input_tokens: 100, output_tokens: 20 },
      };
    },
  };

  return { messages } as unknown as Pick<Anthropic, 'messages'>;
}

function defaultMockResponse(model: string): unknown {
  return {
    id: `msg_default_${Date.now()}`,
    type: 'message',
    role: 'assistant',
    model,
    content: [{ type: 'text', text: '{"action_type":"noop","reasoning":"mock default"}' }],
    stop_reason: 'end_turn',
    stop_sequence: null,
    usage: { input_tokens: 50, output_tokens: 10 },
  };
}

function stringifySystem(system: unknown): string {
  if (!system) return '';
  if (typeof system === 'string') return system;
  if (Array.isArray(system)) {
    return system
      .map((block) => {
        if (block && typeof block === 'object' && 'text' in block) {
          const t = (block as { text?: unknown }).text;
          return typeof t === 'string' ? t : '';
        }
        return '';
      })
      .join('\n');
  }
  return '';
}

function stringifyMessages(
  messages: Array<{ role: string; content: unknown }> | undefined,
): string {
  if (!messages) return '';
  return messages
    .map((m) => {
      if (typeof m.content === 'string') return m.content;
      if (Array.isArray(m.content)) {
        return m.content
          .map((b) => {
            if (b && typeof b === 'object' && 'text' in b) {
              const t = (b as { text?: unknown }).text;
              return typeof t === 'string' ? t : '';
            }
            return '';
          })
          .join('\n');
      }
      return '';
    })
    .join('\n');
}

/**
 * The agent layer encodes `action_type` inside the system prompt task
 * block (see `buildWorkerSystemPrompt`). Pull it back out so the mock
 * can route on it.
 */
function extractActionType(
  systemPrompt: string,
  userPrompt: string,
): string | null {
  const fromUser = userPrompt.match(/action_type=([a-z_]+)/i);
  if (fromUser) return fromUser[1] ?? null;
  const fromSystem = systemPrompt.match(/action_type:\s*([a-z_]+)/i);
  if (fromSystem) return fromSystem[1] ?? null;
  return null;
}

function detectCacheBreakpoints(system: unknown): boolean {
  if (!Array.isArray(system)) return false;
  return system.some(
    (block) =>
      block !== null &&
      typeof block === 'object' &&
      'cache_control' in block &&
      block.cache_control !== null &&
      block.cache_control !== undefined,
  );
}
