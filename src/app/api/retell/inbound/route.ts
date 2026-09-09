/**
 * Retell inbound-call webhook — POST /api/retell/inbound.
 *
 * WHY this route exists (research note §3e / M6): Retell reads a call's
 * privacy-gated `dynamic_variables` ONLY from the `call_inbound` webhook
 * response, NOT from the `call_started` event response. This is the correct —
 * and only — channel for injecting caller-scoped facts into the agent prompt
 * before the call connects, so the gate lives here.
 *
 * VERIFIED request shape (verbatim from docs.retellai.com/features/inbound-call-
 * webhook, 2026-07-07):
 *   { event:'call_inbound', event_timestamp, call_inbound:{ agent_id,
 *     agent_version, from_number, to_number, custom_sip_headers } }
 * VERIFIED response (2xx), all fields optional; we return only dynamic_variables:
 *   { call_inbound:{ dynamic_variables } }
 *
 * AUTH: identical policy to the call-event webhook (shared
 * verifyRetellWebhookAuth) — the inbound webhook is verifiable with the Retell
 * API key. 10s provider timeout, so caller resolution is kept to the same
 * bounded lookups the call_started path already runs.
 *
 * FAIL CLOSED: bad auth 401, bad body 400, unrouted to_number 404, internal
 * error 500. Unknown/ambiguous callers (and callers with no from_number)
 * resolve to an EMPTY dynamic_variables object — zero private data.
 */

import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import * as Sentry from '@sentry/nextjs';

import { createServiceClient, verifyRetellWebhookAuth } from '@/lib/agent/retell-auth';
import { resolveDynamicVariables } from '@/lib/voice/dynamic-variables';
import { resolveCaller } from '@/lib/voice/resolve-caller';

/** VERIFIED inbound request body. Optional fields tolerate provider omissions. */
const inboundSchema = z.object({
  event: z.literal('call_inbound'),
  event_timestamp: z.number().optional(),
  call_inbound: z.object({
    agent_id: z.string().optional(),
    agent_version: z.number().optional(),
    // from_number can be absent for withheld/anonymous caller id → unknown caller.
    from_number: z.string().optional(),
    to_number: z.string(),
    custom_sip_headers: z.record(z.string(), z.string()).optional(),
  }),
});

export async function POST(request: NextRequest) {
  const rawBody = await request.text();

  const auth = verifyRetellWebhookAuth(request, rawBody);
  if (!auth.ok) return auth.response;

  let json: unknown;
  try {
    json = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = inboundSchema.safeParse(json);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    return NextResponse.json({ error: `Validation failed: ${issues}` }, { status: 400 });
  }

  const { from_number, to_number } = parsed.data.call_inbound;

  return Sentry.startSpan({ name: 'retell.inbound', op: 'webhook' }, async () => {
    const db = createServiceClient();
    try {
      // resolveCaller returns null only when no org routes to_number → 404.
      // An absent from_number becomes '' → no entity match → unknown_caller.
      const resolved = await resolveCaller(db, from_number ?? '', to_number);
      if (!resolved) {
        return NextResponse.json(
          { error: `no organization routed to ${to_number}` },
          { status: 404 },
        );
      }

      const dynamic_variables = await resolveDynamicVariables(db, resolved);
      return NextResponse.json({ call_inbound: { dynamic_variables } });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[retell inbound] failed for ${to_number}: ${message}`);
      return NextResponse.json({ error: message }, { status: 500 });
    }
  });
}
