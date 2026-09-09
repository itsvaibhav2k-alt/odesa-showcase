/**
 * HostedHaikuProvider — Anthropic Messages API.
 *
 * Default for `org.privacy_mode='hosted'`.
 * Model: claude-haiku-4-5-20251001.
 *
 * Prompt caching: the static base persona block (first block returned
 * by `buildWorkerSystemPrompt`) carries
 * `cache_control: { type: 'ephemeral' }`. Subsequent property/facts/
 * turns/roster/task blocks are uncached because their bytes change
 * with property state and per-call action_type.
 *
 * Output contract: the model is instructed to emit ONE JSON object
 * matching `propertyWorkerOutputSchema`. The system-prompt builder
 * encodes the per-action contract in the final task block. No
 * tool-use round-trip yet — the worker is stateless per call.
 */

import Anthropic from '@anthropic-ai/sdk';

import {
  getAnthropicMockClient,
  recordAnthropicCall,
} from '@/lib/agent/test-hooks';
import type {
  PropertyWorkerInput,
  PropertyWorkerOutput,
  ProviderHealth,
  WorkerActionPayload,
} from '@/lib/agent/worker/types';
import {
  propertyWorkerOutputSchema,
  WORKER_PAYLOAD_SCHEMAS,
} from '@/lib/agent/worker/types';
import { buildWorkerSystemPrompt } from '@/lib/agent/worker/system-prompt';

import {
  HOSTED_HAIKU_MODEL,
  ProviderCallError,
  type ProviderCallOptions,
  type WorkerModelProvider,
} from './types';

const DEFAULT_MAX_TOKENS = 1024;
const DEFAULT_TEMPERATURE = 0.2;

/**
 * Stable provider name persisted to action_proposals.worker_model.
 *
 * Kept as a backward-compat constant because earlier callers and tests
 * import it directly. New code should derive the per-instance name from
 * the model id via {@link deriveAnthropicProviderName} so multi-model
 * audit trails stay accurate.
 */
export const HOSTED_HAIKU_PROVIDER_NAME = 'haiku-4-5';

/**
 * Convert an Anthropic model id (e.g. `claude-sonnet-4-6`) to the short
 * audit name we persist on action_proposals.worker_model. Trims the
 * `claude-` prefix and any trailing date suffix so the column reads
 * `sonnet-4-6` / `haiku-4-5` / `opus-4-7` regardless of which exact
 * dated revision was called.
 */
export function deriveAnthropicProviderName(modelId: string): string {
  const trimmed = modelId.replace(/^claude-/, '').replace(/-\d{8}$/, '');
  return trimmed;
}

interface HostedHaikuProviderOptions {
  apiKey?: string;
  model?: string;
  client?: Pick<Anthropic, 'messages'>;
  maxTokens?: number;
  temperature?: number;
}

/**
 * HostedHaikuProvider — wraps the Anthropic Messages API.
 *
 * Despite the historical name, the class accepts ANY Claude model id via
 * `options.model` and reports the actual model on `.name` for audit. The
 * default remains Haiku 4.5 to keep existing tests + cheap-action paths
 * unchanged. The per-action model policy in `select.ts` decides what to
 * pass in for high-stakes actions (Sonnet 4.6 for drafts/dispatch/
 * emergency, Opus 4.7 for rulebook synthesis).
 */
export class HostedHaikuProvider implements WorkerModelProvider {
  readonly name: string;
  private readonly client: Pick<Anthropic, 'messages'>;
  private readonly model: string;
  private readonly maxTokens: number;
  private readonly temperature: number;

  constructor(options: HostedHaikuProviderOptions = {}) {
    // Resolution order: explicit options.client (in-process tests) >
    // installed Anthropic mock client (Playwright via test-hooks
    // route) > real SDK. The mock returns null in production because
    // /api/agent/test-hooks 404s outside dev/test.
    const mockClient = getAnthropicMockClient();
    this.client =
      options.client ??
      mockClient ??
      new Anthropic({
        apiKey: options.apiKey ?? process.env.ANTHROPIC_API_KEY,
        timeout: 60_000,
        maxRetries: 2,
      });
    this.model = options.model ?? HOSTED_HAIKU_MODEL;
    this.name = deriveAnthropicProviderName(this.model);
    this.maxTokens = options.maxTokens ?? DEFAULT_MAX_TOKENS;
    this.temperature = options.temperature ?? DEFAULT_TEMPERATURE;
  }

  supportsPromptCaching(): boolean {
    return true;
  }

  async call(
    input: PropertyWorkerInput,
    options: ProviderCallOptions = {},
  ): Promise<PropertyWorkerOutput> {
    const systemBlocks = buildWorkerSystemPrompt(
      input.context,
      input.action_type,
      {
        withCacheControl: true,
        ...(input.branding ? { branding: input.branding } : {}),
      },
    );
    const userMessage = buildUserMessage(input);

    // Record the call shape for the Playwright test harness. No-op
    // when the mock isn't installed, so production overhead is one
    // null check inside test-hooks.
    recordAnthropicCall({
      model: this.model,
      systemPrompt: systemBlocks.map((b) => b.text).join('\n\n'),
      userPrompt: userMessage,
      actionType: input.action_type,
      hadCacheBreakpoints: systemBlocks.some(
        (b) => b.cache_control !== undefined,
      ),
    });

    let response;
    try {
      response = await this.client.messages.create(
        {
          model: this.model,
          max_tokens: this.maxTokens,
          temperature: this.temperature,
          system: systemBlocks,
          messages: [{ role: 'user', content: userMessage }],
        },
        options.signal ? { signal: options.signal } : undefined,
      );
    } catch (err) {
      throw wrapAnthropicError(err);
    }

    const text = extractText(response);
    return parseOutput(text);
  }

  async healthCheck(): Promise<ProviderHealth> {
    const start = Date.now();
    try {
      await this.client.messages.create({
        model: this.model,
        max_tokens: 8,
        messages: [{ role: 'user', content: 'ping' }],
      });
      return { ok: true, latencyMs: Date.now() - start };
    } catch (err) {
      return {
        ok: false,
        latencyMs: Date.now() - start,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }
}

// ---------------------------------------------------------------------------
// User-message construction
// ---------------------------------------------------------------------------

function buildUserMessage(input: PropertyWorkerInput): string {
  return [
    `Property worker request (action_type=${input.action_type}).`,
    'Input data follows as JSON:',
    JSON.stringify(input.data),
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Response parsing
// ---------------------------------------------------------------------------

interface AnthropicMessageLike {
  content?: Array<unknown>;
}

function extractText(response: unknown): string {
  const msg = response as AnthropicMessageLike;
  if (!msg || !Array.isArray(msg.content)) {
    throw new ProviderCallError(
      HOSTED_HAIKU_PROVIDER_NAME,
      'Anthropic response had no content array',
    );
  }
  const parts: string[] = [];
  for (const block of msg.content) {
    if (
      block !== null &&
      typeof block === 'object' &&
      (block as { type?: unknown }).type === 'text' &&
      typeof (block as { text?: unknown }).text === 'string'
    ) {
      parts.push((block as { text: string }).text);
    }
  }
  if (parts.length === 0) {
    throw new ProviderCallError(
      HOSTED_HAIKU_PROVIDER_NAME,
      'Anthropic response had no text blocks',
    );
  }
  return parts.join('\n').trim();
}

function parseOutput(text: string): PropertyWorkerOutput {
  const json = extractJsonObject(text);
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (err) {
    throw new ProviderCallError(
      HOSTED_HAIKU_PROVIDER_NAME,
      'model returned invalid JSON',
      { cause: err },
    );
  }
  const result = propertyWorkerOutputSchema.safeParse(parsed);
  if (!result.success) {
    throw new ProviderCallError(
      HOSTED_HAIKU_PROVIDER_NAME,
      'model output failed schema validation',
      { cause: result.error },
    );
  }
  // Per-action_type narrowing — catches model output drift at the
  // provider boundary instead of letting a malformed payload propagate
  // to spawn.ts / the commit gate. WORKER_PAYLOAD_SCHEMAS is the
  // canonical map maintained alongside the action_type union.
  const payloadSchema = WORKER_PAYLOAD_SCHEMAS[result.data.action_type];
  const payloadResult = payloadSchema.safeParse(result.data.payload);
  if (!payloadResult.success) {
    throw new ProviderCallError(
      HOSTED_HAIKU_PROVIDER_NAME,
      `payload schema mismatch for ${result.data.action_type}`,
      { cause: payloadResult.error },
    );
  }
  return {
    action_type: result.data.action_type,
    payload: payloadResult.data as WorkerActionPayload,
    reasoning: result.data.reasoning,
    confidence: result.data.confidence,
    context_fact_ids: result.data.context_fact_ids,
  };
}

/**
 * Models occasionally wrap JSON in code fences or add a one-line
 * preamble. Strip the most common wrappers before JSON.parse.
 */
function extractJsonObject(text: string): string {
  const trimmed = text.trim();
  if (trimmed.startsWith('{')) return trimmed;
  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]+?)\s*```/i);
  if (fenceMatch) return fenceMatch[1].trim();
  const firstBrace = trimmed.indexOf('{');
  const lastBrace = trimmed.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    return trimmed.slice(firstBrace, lastBrace + 1);
  }
  return trimmed;
}

function wrapAnthropicError(err: unknown): ProviderCallError {
  if (err instanceof ProviderCallError) return err;
  const status =
    err !== null && typeof err === 'object' && 'status' in err
      ? Number((err as { status: unknown }).status)
      : null;
  const message = err instanceof Error ? err.message : String(err);
  return new ProviderCallError(HOSTED_HAIKU_PROVIDER_NAME, message, {
    cause: err,
    httpStatus: Number.isFinite(status) ? status : null,
  });
}
