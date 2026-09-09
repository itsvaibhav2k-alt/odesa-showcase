/**
 * Retell provider adapter — pure, side-effect-free translation between the
 * verified external Retell wire contract and Odesa's internal voice shapes.
 *
 * WHY this file exists as a thin, pure adapter:
 *   - Retell's real webhook/tool payloads match NEITHER what the current
 *     routes expect. The verified contract (nested `call`, `v=,d=` signature
 *     header, body+timestamp HMAC) lives in
 *     docs/research/retell-grok-production-voice-research-2026-07-07.md and is
 *     the single source of truth. This module implements exactly that, so the
 *     route handlers stay thin and every wire-format decision is unit-tested
 *     here without a network or Supabase.
 *   - Backward-compat is a hard requirement: the existing e2e in
 *     e2e/retell/*.spec.ts speak a FLAT internal tool payload
 *     `{call_id, from_number, to_number, args}` with bearer auth. The tool
 *     normalizer accepts BOTH that flat shape and the real nested Retell shape
 *     so nothing downstream breaks.
 *
 * FAIL-CLOSED: malformed signatures verify `false`; malformed webhook/tool
 * bodies THROW (the caller turns that into a 400). Odesa voice is phone-only,
 * so payloads missing from_number/to_number are rejected (see §3d/§3a and M10
 * of the research note) — a web_call reaching these paths is treated as bad
 * input, never silently accepted.
 *
 * NO side effects, NO Supabase, NO Date.now() except the signature replay
 * clock (which is injectable via `nowMs` so tests are deterministic).
 */

import crypto from 'crypto';

import { voiceWebhookEventSchema, type VoiceWebhookEvent } from '../types';

// ---------------------------------------------------------------------------
// 1. Webhook signature verification
// ---------------------------------------------------------------------------

/** 5-minute replay window, in ms (SDK `FIVE_MINUTES`). Research note §2. */
const FIVE_MINUTES_MS = 5 * 60 * 1000;

/** Header format `v={poststampMillis},d={hexDigest}` (research note §2). */
const SIGNATURE_HEADER_RE = /v=(\d+),d=(.*)/;

/**
 * Verify a Retell `x-retell-signature` header, mirroring retell-sdk Node
 * v4.0.0 `lib/webhook_auth.js` (byte-identical to the Python SDK). The helper
 * was REMOVED in retell-sdk v5.43.0, so we implement it manually.
 *
 * Algorithm (verified — research note §2):
 *   1. Parse `v={ms},d={hex}`; reject if header absent or unmatched.
 *   2. Replay window: reject if `abs(now - poststamp) > 300000` — poststamp is
 *      epoch MILLISECONDS taken from the signature itself, not the clock.
 *   3. expected = HMAC-SHA256(key = RETELL_API_KEY, message = rawBody +
 *      String(poststamp)) as lowercase hex — body FIRST, then the ms stamp.
 *   4. Accept iff `expected === d`, using a constant-time compare.
 *
 * The caller MUST pass the RAW request body string
 * (`await request.clone().text()`), never `JSON.stringify(parsed)` — key
 * ordering/whitespace would differ and every check would fail.
 *
 * Fail closed: any missing/malformed input returns `false`. This also rejects
 * the OLD Odesa format (plain hex of body-only, no `v=,d=` wrapper), which is
 * intentional — that scheme never matched real Retell traffic.
 *
 * @param rawBody - raw request body string, exactly as received
 * @param signatureHeader - value of the `x-retell-signature` header (or null)
 * @param apiKey - the Retell API key bearing the webhook badge (HMAC secret)
 * @param nowMs - injectable clock for deterministic replay-window tests
 * @returns true iff the signature is authentic and within the replay window
 */
export function verifyRetellSignature(
  rawBody: string,
  signatureHeader: string | null,
  apiKey: string,
  nowMs: number = Date.now(),
): boolean {
  if (!signatureHeader || !apiKey) return false;

  const match = SIGNATURE_HEADER_RE.exec(signatureHeader);
  if (!match) return false;

  const poststamp = Number(match[1]);
  const postDigest = match[2];
  if (!Number.isFinite(poststamp)) return false;
  if (Math.abs(nowMs - poststamp) > FIVE_MINUTES_MS) return false;

  const expected = crypto
    .createHmac('sha256', apiKey)
    .update(rawBody + String(poststamp)) // body THEN ms timestamp — never reordered
    .digest('hex');

  // Constant-time compare (SDK uses plain `===`; we harden the timing channel).
  // timingSafeEqual throws on unequal length, so length-guard first.
  const a = Buffer.from(expected);
  const b = Buffer.from(postDigest);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// ---------------------------------------------------------------------------
// 2. Webhook lifecycle payload parsing
// ---------------------------------------------------------------------------

/** Lifecycle events we translate into an internal VoiceWebhookEvent. */
const HANDLED_EVENTS = new Set(['call_started', 'call_ended', 'call_analyzed']);

/** The internal call object plus the pass-through analysis blob. */
type CallWithAnalysis = VoiceWebhookEvent['call'] & { call_analysis?: unknown };

export type ParsedRetellWebhook =
  | { kind: 'event'; event: VoiceWebhookEvent }
  | { kind: 'ignored'; eventName: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Map a Retell call-lifecycle webhook body to the internal event shape.
 *
 *   - call_started / call_ended / call_analyzed → `{kind:'event'}`.
 *     `call_analyzed` maps to internal `call_ended` (both mean "the call is
 *     over, compile it"; research note §3c), and any `call.call_analysis` blob
 *     is carried through on the returned event's `call` so the caller can
 *     persist it. (VoiceWebhookEvent's type doesn't name the field; it rides
 *     along at runtime.)
 *   - Any other Retell event we recognize but don't handle (transcript_updated,
 *     transfer_*, chat_*, …) → `{kind:'ignored'}`.
 *   - Malformed/garbage bodies (not an object, no string `event`, or a handled
 *     event whose `call` is missing/invalid) THROW — the caller returns 400.
 *
 * Odesa voice is phone-only: a handled event whose `call` lacks a string
 * from_number/to_number fails validation and THROWS (research note §3a/§3d,
 * M10). We never accept a numberless web_call on this path.
 */
export function parseRetellWebhookPayload(raw: unknown): ParsedRetellWebhook {
  if (!isRecord(raw) || typeof raw.event !== 'string') {
    throw new Error('retell webhook: body is not an object with a string event');
  }

  const eventName = raw.event;
  if (!HANDLED_EVENTS.has(eventName)) {
    return { kind: 'ignored', eventName };
  }

  if (!isRecord(raw.call)) {
    throw new Error(`retell webhook: ${eventName} missing call object`);
  }

  const internalEvent = eventName === 'call_analyzed' ? 'call_ended' : eventName;
  const call = raw.call;

  // voiceWebhookEventSchema requires from_number/to_number as strings, so a
  // numberless (web_call) payload is rejected here — phone-only, fail closed.
  const parsed = voiceWebhookEventSchema.safeParse({
    event: internalEvent,
    call: {
      call_id: call.call_id,
      direction: call.direction,
      from_number: call.from_number,
      to_number: call.to_number,
      transcript: call.transcript,
    },
  });
  if (!parsed.success) {
    throw new Error(`retell webhook: invalid ${eventName} payload: ${parsed.error.message}`);
  }

  // Carry the analysis blob through (immutably) when present.
  const carried: CallWithAnalysis =
    call.call_analysis !== undefined
      ? { ...parsed.data.call, call_analysis: call.call_analysis }
      : parsed.data.call;

  const event: VoiceWebhookEvent = { event: parsed.data.event, call: carried };
  return { kind: 'event', event };
}

// ---------------------------------------------------------------------------
// 3. Tool (custom-function) request normalization
// ---------------------------------------------------------------------------

export interface NormalizedToolRequest {
  call_id: string;
  from_number: string;
  to_number: string;
  args: unknown;
  /**
   * Per-invocation idempotency key IF the payload provides one. The verified
   * standard Retell tool body has NO top-level tool-call id (`tool_call_id`
   * only appears in `call.transcript_with_tool_calls[]` AFTER the call ends —
   * research note §3d), so this is normally undefined. Callers derive their own
   * dedup key from call_id + serialized args.
   */
  tool_call_key?: string;
}

function requireNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`retell tool: missing or invalid ${field}`);
  }
  return value;
}

/**
 * Normalize a Retell custom-function (tool) request into the flat shape the
 * tool routes consume, accepting BOTH:
 *   - the real nested Retell STANDARD body `{name, args, call:{call_id,
 *     from_number, to_number, ...}}` (research note §3d), and
 *   - the existing FLAT internal body `{call_id, from_number, to_number, args}`
 *     that e2e/retell/*.spec.ts speak (must keep passing).
 *
 * Numbers are required (phone-only): a web_call tool body — nested `call`
 * without from_number/to_number — is rejected (throws → caller 400/404 per
 * M10). `args` defaults to `{}` when absent so read tools that send no args
 * (e.g. get_rent_status) normalize identically to the nested shape.
 */
export function normalizeRetellToolRequest(raw: unknown): NormalizedToolRequest {
  if (!isRecord(raw)) {
    throw new Error('retell tool: body is not an object');
  }

  // Nested real Retell shape: a `call` object carries the metadata.
  if (isRecord(raw.call)) {
    const call = raw.call;
    return {
      call_id: requireNonEmptyString(call.call_id, 'call.call_id'),
      from_number: requireNonEmptyString(call.from_number, 'call.from_number'),
      to_number: requireNonEmptyString(call.to_number, 'call.to_number'),
      args: raw.args ?? {},
      ...pickToolCallKey(raw, call),
    };
  }

  // Flat internal shape (backward-compat with existing e2e + tool routes).
  return {
    call_id: requireNonEmptyString(raw.call_id, 'call_id'),
    from_number: requireNonEmptyString(raw.from_number, 'from_number'),
    to_number: requireNonEmptyString(raw.to_number, 'to_number'),
    args: raw.args ?? {},
    ...pickToolCallKey(raw, undefined),
  };
}

/**
 * Extract a per-invocation tool-call id if the payload happens to carry one.
 * The verified standard body does NOT (§3d), so this is defensive: we probe the
 * documented-adjacent spots and return `{}` (undefined key) when none is a
 * non-empty string, rather than inventing an unstable key.
 */
function pickToolCallKey(
  raw: Record<string, unknown>,
  call: Record<string, unknown> | undefined,
): { tool_call_key?: string } {
  const candidate = raw.tool_call_id ?? call?.tool_call_id;
  return typeof candidate === 'string' && candidate.length > 0
    ? { tool_call_key: candidate }
    : {};
}
