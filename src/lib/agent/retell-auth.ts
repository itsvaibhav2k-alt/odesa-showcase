/**
 * Shared auth + client helpers for Retell tool endpoints.
 *
 * Retell posts to our webhooks from its own infrastructure — there's no
 * Supabase user session. Tool calls and lifecycle/inbound webhooks authenticate
 * with Retell's raw-body HMAC keyed by `RETELL_API_KEY`. The account-level API
 * key is never stored in provider-held custom-tool definitions.
 */

import crypto from 'crypto';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { type NextRequest, NextResponse } from 'next/server';
import { type ZodSchema } from 'zod';
import type { Database } from '@/types/database';
import {
  normalizeRetellToolRequest,
  verifyRetellSignature,
} from '@/lib/voice/providers/retell-adapter';

function constantTimeEqual(left: string, right: string): boolean {
  const leftDigest = crypto.createHash('sha256').update(left).digest();
  const rightDigest = crypto.createHash('sha256').update(right).digest();
  return crypto.timingSafeEqual(leftDigest, rightDigest);
}

function unauthorized(): { ok: false; response: NextResponse } {
  return {
    ok: false,
    response: NextResponse.json({ error: 'unauthorized' }, { status: 401 }),
  };
}

/**
 * First half of custom-tool authentication: reject missing configuration and
 * missing/malformed signatures before consuming the body.
 *
 * The cryptographic raw-body check necessarily happens in readToolRequest,
 * which is async and is called immediately after this guard by every tool
 * route. Splitting the check this way preserves the existing route contract
 * while ensuring parsing and all side effects remain behind HMAC verification.
 */
export function verifyRetellAuth(request: NextRequest): { ok: true } | { ok: false; response: NextResponse } {
  const apiKey = process.env.RETELL_API_KEY ?? '';
  const signature = request.headers.get('x-retell-signature') ?? '';
  if (!apiKey || !/^v=\d+,d=[0-9a-f]{64}$/i.test(signature)) return unauthorized();
  return { ok: true };
}

function verifyRetellApiBearer(
  request: NextRequest,
  apiKey: string,
): { ok: true } | { ok: false; response: NextResponse } {
  const header = request.headers.get('authorization') ?? '';
  if (!apiKey || !constantTimeEqual(header, `Bearer ${apiKey}`)) return unauthorized();
  return { ok: true };
}

/**
 * Shared auth policy for BOTH Retell call-event and call_inbound webhooks
 * (verified contract — research note §2 + inbound §3e). Signature-first:
 *   - `x-retell-signature` present → HMAC verify with RETELL_API_KEY, 401 on
 *     failure.
 *   - absent + `RETELL_REQUIRE_SIGNATURE === '1'` → 401 (prod hard-fail).
 *   - absent + enforcement off → bearer-token fallback (local dev + e2e).
 *
 * The caller must pass the RAW body string (never a re-serialized object) so
 * the HMAC input matches Retell's byte-for-byte.
 */
export function verifyRetellWebhookAuth(
  request: NextRequest,
  rawBody: string,
): { ok: true } | { ok: false; response: NextResponse } {
  const apiKey = process.env.RETELL_API_KEY ?? '';
  const signature = request.headers.get('x-retell-signature');
  if (signature) {
    if (!apiKey || !verifyRetellSignature(rawBody, signature, apiKey)) {
      return {
        ok: false,
        response: NextResponse.json({ error: 'invalid signature' }, { status: 401 }),
      };
    }
    return { ok: true };
  }
  // Mirror env.ts's RETELL_REQUIRE_SIGNATURE transform (accepts '1' OR 'true')
  // and the readiness strip's predicate byte-for-byte. A drift here would let the
  // strip render "Signature enforcement: HMAC enforced" while an unsigned request
  // still fell through to the bearer path — a fake-readiness claim AND a fail-open
  // downgrade (the operator asked for hard-fail; we must honour it).
  const requireSignature =
    process.env.RETELL_REQUIRE_SIGNATURE === '1' ||
    process.env.RETELL_REQUIRE_SIGNATURE === 'true';
  if (requireSignature) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'missing signature' }, { status: 401 }),
    };
  }
  // Local/dev fallback remains an API-key bearer because this is a Retell
  // lifecycle endpoint, not a custom tool. Production signature enforcement
  // prevents this branch entirely.
  return verifyRetellApiBearer(request, apiKey);
}

export function createServiceClient(): SupabaseClient<Database> {
  return createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? '',
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
}

export function toolError(message: string, status = 400): NextResponse {
  return NextResponse.json({ error: message }, { status });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Read + validate a Retell tool request, accepting BOTH the real nested Retell
 * body `{name, args, call:{call_id, from_number, to_number, ...}}` and the flat
 * internal body `{call_id, from_number, to_number, args}` the existing e2e
 * speak. The nested shape is flattened through the verified adapter; the flat
 * shape passes straight to the tool's existing zod schema UNCHANGED, so its
 * exact semantics (e.g. an optional call_id) are preserved and no e2e breaks.
 *
 * `toolCallKey` is Retell's per-invocation id if the payload carries one
 * (normally absent in standard mode — research note §3d); tools derive their
 * own idempotency key from call_id + args when it is undefined.
 */
export async function readToolRequest<T>(
  request: NextRequest,
  schema: ZodSchema<T>,
): Promise<{ ok: true; data: T; toolCallKey?: string } | { ok: false; response: NextResponse }> {
  let rawBody: string;
  try {
    rawBody = await request.text();
  } catch {
    return { ok: false, response: toolError('Invalid JSON body') };
  }

  const apiKey = process.env.RETELL_API_KEY ?? '';
  const signature = request.headers.get('x-retell-signature');
  if (!apiKey || !verifyRetellSignature(rawBody, signature, apiKey)) {
    return unauthorized();
  }

  let raw: unknown;
  try {
    raw = JSON.parse(rawBody) as unknown;
  } catch {
    return { ok: false, response: toolError('Invalid JSON body') };
  }

  let candidate: unknown = raw;
  let toolCallKey: string | undefined;

  if (isRecord(raw) && isRecord(raw.call)) {
    // Nested real Retell shape — flatten via the verified adapter.
    try {
      const n = normalizeRetellToolRequest(raw);
      candidate = {
        call_id: n.call_id,
        from_number: n.from_number,
        to_number: n.to_number,
        args: n.args,
      };
      toolCallKey = n.tool_call_key;
    } catch (err) {
      return {
        ok: false,
        response: toolError(err instanceof Error ? err.message : 'invalid tool payload'),
      };
    }
  } else if (isRecord(raw) && typeof raw.tool_call_id === 'string' && raw.tool_call_id.length > 0) {
    // Flat shape that happens to carry an explicit id — keep it for dedup.
    toolCallKey = raw.tool_call_id;
  }

  const result = schema.safeParse(candidate);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    return { ok: false, response: toolError(`Validation failed: ${issues}`) };
  }
  return { ok: true, data: result.data, toolCallKey };
}

/** Stable JSON: object keys sorted recursively so key order can't change the hash. */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`;
}

/**
 * Deterministic idempotency key for a record-creating tool invocation. Retell
 * standard tool bodies carry NO per-invocation id (research note §3d), so we
 * derive one from the stable triple (call_id, tool_name, normalized args). The
 * same call replaying the same tool with the same args yields the same key,
 * letting a retry return the stored result instead of duplicating side effects.
 */
export function deriveIdempotencyKey(callId: string, toolName: string, args: unknown): string {
  return crypto
    .createHash('sha256')
    .update(`${callId}|${toolName}|${stableStringify(args)}`)
    .digest('hex');
}

export function toolOk<T extends Record<string, unknown>>(data: T): NextResponse {
  return NextResponse.json(data, { status: 200 });
}

export interface CallContext {
  organizationId: string;
  tenantId: string | null;
  fromNumber: string;
  toNumber: string;
  callId: string;
}

export async function resolveCallContext(
  db: SupabaseClient<Database>,
  args: { call_id?: string; from_number: string; to_number: string },
): Promise<{ ok: true; context: CallContext } | { ok: false; error: string }> {
  const { data: org, error: orgErr } = await db
    .from('organizations')
    .select('id')
    .eq('odesa_phone_number', args.to_number)
    .maybeSingle();
  if (orgErr) return { ok: false, error: `org lookup failed: ${orgErr.message}` };
  if (!org) return { ok: false, error: `no organization routed to ${args.to_number}` };

  const { data: tenant } = await db
    .from('tenants')
    .select('id')
    .eq('organization_id', org.id)
    .eq('phone_e164', args.from_number)
    .maybeSingle();

  return {
    ok: true,
    context: {
      organizationId: org.id,
      tenantId: tenant?.id ?? null,
      fromNumber: args.from_number,
      toNumber: args.to_number,
      callId: args.call_id ?? 'unknown',
    },
  };
}
