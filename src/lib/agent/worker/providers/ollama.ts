/**
 * OllamaProvider — on-prem chat via Ollama's /api/chat endpoint.
 *
 * Default for `org.privacy_mode='on_prem'`.
 * Default model: llama3.3:70b-instruct-q4_K_M (re-verify per addendum
 * §"Open questions"; configurable per-org).
 *
 * Ollama has no prompt-cache primitive, so we collapse the canonical
 * block-array system prompt to a single string via
 * `flattenSystemPrompt()`. This keeps the wording identical to the
 * hosted tier — only the cache_control marker is dropped at flatten
 * time.
 *
 * Output uses Ollama's `format:'json'` structured-output flag plus the
 * per-action contract carried in the canonical builder's task block.
 * Tool calls (when needed) are translated to Ollama's `tools`
 * parameter — the schema on the wire is
 * `{type:'function', function:{name, description, parameters}}`,
 * which mirrors OpenAI's spec rather than Anthropic's.
 *
 * Note: OSS models lag Haiku 4.5 ~10-15% on tool-use reliability
 * (addendum §Risks). The autonomy ceiling for on-prem orgs is gated
 * lower in commit-gate.ts to compensate.
 */

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
import {
  buildWorkerSystemPrompt,
  flattenSystemPrompt,
} from '@/lib/agent/worker/system-prompt';

import {
  OLLAMA_DEFAULT_HOST,
  OLLAMA_DEFAULT_MODEL,
  ProviderCallError,
  type ProviderCallOptions,
  type WorkerModelProvider,
} from './types';

const HEALTH_CHECK_PATH = '/api/tags';
const CHAT_PATH = '/api/chat';

/** Stable provider name persisted to action_proposals.worker_model. */
export const OLLAMA_PROVIDER_NAME = 'ollama-llama3.3';

interface OllamaProviderOptions {
  host?: string;
  model?: string;
  /** Test seam — defaults to globalThis.fetch. */
  fetchImpl?: typeof fetch;
  temperature?: number;
  /** Optional tool definitions translated to Ollama function-calling. */
  tools?: ReadonlyArray<OllamaToolDefinition>;
}

/**
 * Ollama tool schema (OpenAI-compatible).
 * Translation rules:
 *   - Anthropic Tool { name, description, input_schema } maps to
 *     { type:'function', function:{ name, description, parameters: input_schema } }.
 *   - Ollama returns tool calls in `message.tool_calls[].function.{name, arguments}`.
 */
export interface OllamaToolDefinition {
  type: 'function';
  function: {
    name: string;
    description?: string;
    parameters: {
      type: 'object';
      properties?: Record<string, unknown>;
      required?: string[];
    };
  };
}

/**
 * Translate an Anthropic-shaped tool descriptor to Ollama's function
 * schema. Exposed for tests + callers that already hold Anthropic
 * tool defs and want to reuse them under privacy mode.
 */
export function translateAnthropicToolToOllama(tool: {
  name: string;
  description?: string;
  input_schema: { type: 'object'; properties?: unknown; required?: string[] };
}): OllamaToolDefinition {
  return {
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: {
        type: 'object',
        properties:
          (tool.input_schema.properties as Record<string, unknown>) ?? undefined,
        required: tool.input_schema.required,
      },
    },
  };
}

interface OllamaChatRequestBody {
  model: string;
  messages: Array<{
    role: 'system' | 'user' | 'assistant' | 'tool';
    content: string;
  }>;
  stream: false;
  format: 'json';
  options?: { temperature?: number };
  tools?: ReadonlyArray<OllamaToolDefinition>;
}

interface OllamaChatResponse {
  model?: string;
  message?: {
    role?: string;
    content?: string;
    tool_calls?: Array<{
      function?: {
        name?: string;
        arguments?: unknown;
      };
    }>;
  };
  done?: boolean;
}

export class OllamaProvider implements WorkerModelProvider {
  readonly name = OLLAMA_PROVIDER_NAME;
  private readonly host: string;
  private readonly model: string;
  private readonly fetchImpl: typeof fetch;
  private readonly temperature: number;
  private readonly tools?: ReadonlyArray<OllamaToolDefinition>;

  constructor(options: OllamaProviderOptions = {}) {
    this.host = trimTrailingSlash(
      options.host ?? process.env.OLLAMA_HOST ?? OLLAMA_DEFAULT_HOST,
    );
    this.model = options.model ?? OLLAMA_DEFAULT_MODEL;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.temperature = options.temperature ?? 0.2;
    this.tools = options.tools;
  }

  supportsPromptCaching(): boolean {
    return false;
  }

  async call(
    input: PropertyWorkerInput,
    options: ProviderCallOptions = {},
  ): Promise<PropertyWorkerOutput> {
    const systemBlocks = buildWorkerSystemPrompt(
      input.context,
      input.action_type,
      {
        withCacheControl: false,
        ...(input.branding ? { branding: input.branding } : {}),
      },
    );
    const systemText = flattenSystemPrompt(systemBlocks);

    const body: OllamaChatRequestBody = {
      model: this.model,
      stream: false,
      format: 'json',
      options: { temperature: this.temperature },
      messages: [
        { role: 'system', content: systemText },
        { role: 'user', content: renderUserMessage(input) },
      ],
      ...(this.tools && this.tools.length > 0 ? { tools: this.tools } : {}),
    };

    const response = await this.postJson<OllamaChatResponse>(
      CHAT_PATH,
      body,
      options.signal,
    );

    const text = response.message?.content;
    if (typeof text !== 'string' || text.trim().length === 0) {
      throw new ProviderCallError(
        OLLAMA_PROVIDER_NAME,
        'Ollama response had no message.content',
      );
    }

    return parseOutput(text);
  }

  async healthCheck(): Promise<ProviderHealth> {
    const start = Date.now();
    try {
      const res = await this.fetchImpl(`${this.host}${HEALTH_CHECK_PATH}`, {
        method: 'GET',
      });
      if (!res.ok) {
        return {
          ok: false,
          latencyMs: Date.now() - start,
          error: `HTTP ${res.status}`,
        };
      }
      return { ok: true, latencyMs: Date.now() - start };
    } catch (err) {
      return {
        ok: false,
        latencyMs: Date.now() - start,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  private async postJson<T>(
    path: string,
    body: unknown,
    signal: AbortSignal | undefined,
  ): Promise<T> {
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.host}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal,
      });
    } catch (err) {
      throw new ProviderCallError(
        OLLAMA_PROVIDER_NAME,
        `network error calling ${path}: ${
          err instanceof Error ? err.message : String(err)
        }`,
        { cause: err },
      );
    }
    if (!res.ok) {
      const errText = await safeReadText(res);
      throw new ProviderCallError(
        OLLAMA_PROVIDER_NAME,
        `Ollama HTTP ${res.status}: ${errText.slice(0, 200)}`,
        { httpStatus: res.status },
      );
    }
    let parsed: unknown;
    try {
      parsed = await res.json();
    } catch (err) {
      throw new ProviderCallError(
        OLLAMA_PROVIDER_NAME,
        'Ollama response was not valid JSON',
        { cause: err },
      );
    }
    return parsed as T;
  }
}

// ---------------------------------------------------------------------------
// User-message construction
// ---------------------------------------------------------------------------

function renderUserMessage(input: PropertyWorkerInput): string {
  return [
    `Property worker request (action_type=${input.action_type}).`,
    'Input data follows as JSON:',
    JSON.stringify(input.data),
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Response parsing
// ---------------------------------------------------------------------------

function parseOutput(text: string): PropertyWorkerOutput {
  const json = extractJsonObject(text);
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (err) {
    throw new ProviderCallError(
      OLLAMA_PROVIDER_NAME,
      'model returned invalid JSON',
      { cause: err },
    );
  }
  const result = propertyWorkerOutputSchema.safeParse(parsed);
  if (!result.success) {
    throw new ProviderCallError(
      OLLAMA_PROVIDER_NAME,
      'model output failed schema validation',
      { cause: result.error },
    );
  }
  // Per-action_type narrowing — catches OSS-model output drift (e.g.
  // Ollama returning the wrong payload shape for confirm_emergency)
  // at the provider boundary instead of letting it propagate to the
  // commit gate. Doubly important for the Privacy Mode tier where
  // tool-use reliability lags Haiku 4.5 by ~10-15%.
  const payloadSchema = WORKER_PAYLOAD_SCHEMAS[result.data.action_type];
  const payloadResult = payloadSchema.safeParse(result.data.payload);
  if (!payloadResult.success) {
    throw new ProviderCallError(
      OLLAMA_PROVIDER_NAME,
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function trimTrailingSlash(host: string): string {
  return host.endsWith('/') ? host.slice(0, -1) : host;
}

async function safeReadText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return '';
  }
}
