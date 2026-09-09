/**
 * Thin Anthropic SDK wrapper for the three meta loops.
 *
 * Why a wrapper rather than calling the SDK directly in each loop:
 *   1. Each loop swaps model + temperature + max_tokens; centralising lets
 *      tests stub one surface instead of three.
 *   2. The Boop pattern records usage per phase ("consolidation-proposer",
 *      etc.) — we mirror that with a `phase` tag the caller passes through.
 *   3. JSON-mode discipline: every meta call demands a single JSON object;
 *      `parseJsonStrict` clips to the first outermost `{...}` then
 *      `JSON.parse`s, returning `null` on failure so callers don't crash
 *      on malformed model output (we log + skip instead).
 *
 * The Anthropic client is constructed lazily via `getClient()` so test
 * files can monkey-patch the constructor without forcing every import to
 * pay the dependency cost at module load.
 */

import Anthropic from '@anthropic-ai/sdk';
import * as Sentry from '@sentry/nextjs';

// ---------------------------------------------------------------------------
// Model identifiers — kept here so the three loops reference one place.
// ---------------------------------------------------------------------------

export const REFLECTION_MODEL =
  process.env.ODESA_REFLECTION_MODEL ?? 'claude-haiku-4-5-20251001';
export const SYNTHESIS_PROPOSER_MODEL =
  process.env.ODESA_SYNTHESIS_PROPOSER_MODEL ?? 'claude-sonnet-4-6';
export const SYNTHESIS_ADVERSARY_MODEL =
  process.env.ODESA_SYNTHESIS_ADVERSARY_MODEL ?? 'claude-haiku-4-5-20251001';
export const SYNTHESIS_JUDGE_MODEL =
  process.env.ODESA_SYNTHESIS_JUDGE_MODEL ?? 'claude-sonnet-4-6';
export const CROSS_PROPERTY_MODEL =
  process.env.ODESA_CROSS_PROPERTY_MODEL ?? 'claude-opus-4-7';

// ---------------------------------------------------------------------------
// Client factory — lazy + injectable for tests
// ---------------------------------------------------------------------------

let cachedClient: Anthropic | null = null;
let clientFactory: () => Anthropic = () =>
  new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export function setAnthropicClientFactory(factory: () => Anthropic): void {
  clientFactory = factory;
  cachedClient = null;
}

export function resetAnthropicClient(): void {
  cachedClient = null;
}

function getClient(): Anthropic {
  if (!cachedClient) cachedClient = clientFactory();
  return cachedClient;
}

// ---------------------------------------------------------------------------
// Call shape
// ---------------------------------------------------------------------------

export interface MetaLlmCallInput {
  /** Diagnostic tag persisted with usage metrics. */
  phase:
    | 'reflection'
    | 'synthesis-proposer'
    | 'synthesis-adversary'
    | 'synthesis-judge'
    | 'cross-property';
  model: string;
  systemPrompt: string;
  userPrompt: string;
  /** Defaults to 4096; raised by callers when output JSON is large. */
  maxTokens?: number;
  /** Defaults to 0.2 — meta loops want determinism, not creativity. */
  temperature?: number;
}

export interface MetaLlmCallOutput {
  text: string;
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
  model: string;
}

/**
 * Run a single Anthropic Messages call. Throws on transport errors so the
 * caller's try/catch gets to mark the run as failed; returns the raw text
 * (callers parse JSON via `parseJsonStrict`).
 */
export async function callMetaLlm(input: MetaLlmCallInput): Promise<MetaLlmCallOutput> {
  const started = Date.now();
  const client = getClient();

  return Sentry.startSpan(
    {
      name: `meta-llm.${input.phase}`,
      op: 'ai.inference',
      attributes: {
        'ai.model': input.model,
        'ai.phase': input.phase,
        'ai.max_tokens': input.maxTokens ?? 4096,
      },
    },
    async () => {
      const response = await client.messages.create({
        model: input.model,
        max_tokens: input.maxTokens ?? 4096,
        temperature: input.temperature ?? 0.2,
        system: input.systemPrompt,
        messages: [{ role: 'user', content: input.userPrompt }],
      });

      const text = response.content
        .filter((block): block is Anthropic.TextBlock => block.type === 'text')
        .map((block) => block.text)
        .join('');

      return {
        text,
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        durationMs: Date.now() - started,
        model: input.model,
      };
    },
  );
}

// ---------------------------------------------------------------------------
// JSON parsing — same forgiving regex-clip pattern as Boop's parseJson
// ---------------------------------------------------------------------------

/**
 * Extract the first outermost JSON object from `raw` and parse it.
 *
 * The regex matches the LONGEST sequence between the first `{` and the
 * last `}` — `[\s\S]*` is greedy, so JSON.parse on the result handles
 * nested braces correctly. Returns null on either no-match or parse-fail.
 */
export function parseJsonStrict<T>(raw: string): T | null {
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]) as T;
  } catch {
    return null;
  }
}
