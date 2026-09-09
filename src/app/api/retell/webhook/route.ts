/**
 * Retell call-lifecycle webhook — POST /api/retell/webhook.
 *
 * WHY this route exists: the tool endpoints answer questions mid-call; this
 * webhook owns the call's bookends. `call_started` resolves who is on the
 * line and hands Retell PRIVACY-GATED dynamic variables (unknown/ambiguous
 * callers get an EMPTY object — no names, no balances, no unit info).
 * `call_ended` compiles the deterministic CallOutcome artifact, lands the
 * inbox conversation + message, queues a `voice_call_review` proposal when
 * (and only when) `needsOwnerReview` says so, and finalizes the voice_calls
 * row. Everything risky is decided by pure policy code — the LLM never
 * gates anything here.
 *
 * AUTH (verified contract — research note §2 + M3): when the request carries an
 * `x-retell-signature` header we verify it via the adapter's HMAC-SHA256 over
 * `rawBody + poststamp` keyed by `RETELL_API_KEY` (the sole webhook secret; the
 * old `RETELL_WEBHOOK_SECRET` was a fiction and is gone). When the header is
 * ABSENT: if `RETELL_REQUIRE_SIGNATURE === '1'` we 401 (prod hard-fail),
 * otherwise we fall back to bearer-token auth so local dev + e2e keep working.
 *
 * BODY: parsed by the adapter. `call_analyzed` maps to internal `call_ended`
 * (both mean "the call is over"); a recognized-but-unhandled event is ACKed
 * 200 `{ignored:true}` to stop retry storms; a malformed body is 400.
 *
 * FAILURE CONVENTION (mirrors src/app/api/messaging/inbound/linq/route.ts):
 * bad auth 401, bad body 400, org not routed 404, internal failure 500 with
 * an error payload — never a swallowed 200. Provider retries on 5xx are
 * safe: `upsertCallStarted` is idempotent and a completed row short-circuits
 * `call_ended` to enrichment-only with `{ duplicate: true }`.
 */

import { type NextRequest, NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';

import { createServiceClient, verifyRetellWebhookAuth } from '@/lib/agent/retell-auth';
import type { VoiceCallReviewPayload } from '@/lib/agent/worker/types';
import { resolveDynamicVariables } from '@/lib/voice/dynamic-variables';
import { compileOutcome, formatOutcomeMessage, needsOwnerReview } from '@/lib/voice/outcomes';
import { parseRetellWebhookPayload } from '@/lib/voice/providers/retell-adapter';
import { resolveCaller } from '@/lib/voice/resolve-caller';
import {
  finalizeCallArtifacts,
  loadSession,
  upsertCallStarted,
} from '@/lib/voice/session-store';
import type { VoiceWebhookEvent } from '@/lib/voice/types';

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Json } from '@/types/database';

type Db = SupabaseClient<Database>;

/** Provider call_analysis blob rides on the parsed event's call at runtime. */
type CallWithAnalysis = VoiceWebhookEvent['call'] & { call_analysis?: unknown };

export async function POST(request: NextRequest) {
  // Read the RAW body once — HMAC needs the exact bytes (never JSON.stringify).
  const rawBody = await request.text();

  const auth = verifyRetellWebhookAuth(request, rawBody);
  if (!auth.ok) return auth.response;

  let json: unknown;
  try {
    json = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ received: false, error: 'Invalid JSON body' }, { status: 400 });
  }

  let event: VoiceWebhookEvent;
  try {
    const parsed = parseRetellWebhookPayload(json);
    if (parsed.kind === 'ignored') {
      // Recognized lifecycle event we don't act on — ACK so Retell stops retrying.
      return NextResponse.json({ received: true, ignored: true });
    }
    event = parsed.event;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ received: false, error: message }, { status: 400 });
  }

  return Sentry.startSpan({ name: 'retell.webhook', op: 'webhook' }, async () => {
    const db = createServiceClient();
    try {
      return event.event === 'call_started'
        ? await handleCallStarted(db, event)
        : await handleCallEnded(db, event);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[retell webhook] ${event.event} failed for ${event.call.call_id}: ${message}`);
      return NextResponse.json({ received: false, error: message }, { status: 500 });
    }
  });
}

// ---------------------------------------------------------------------------
// call_started
// ---------------------------------------------------------------------------

async function handleCallStarted(db: Db, event: VoiceWebhookEvent): Promise<NextResponse> {
  const { call } = event;
  const resolved = await resolveCaller(db, call.from_number, call.to_number);
  if (!resolved) {
    return NextResponse.json(
      { received: false, error: `no organization routed to ${call.to_number}` },
      { status: 404 },
    );
  }

  await upsertCallStarted(db, {
    retellCallId: call.call_id,
    direction: call.direction ?? 'inbound',
    fromNumber: call.from_number,
    toNumber: call.to_number,
    startedAt: new Date().toISOString(),
    resolved,
  });

  return NextResponse.json({
    received: true,
    call_id: call.call_id,
    // NOTE: Retell reads dynamic variables from the call_inbound webhook, not
    // this call_started response (M6). We keep emitting them here for backward
    // compat with the internal e2e; the inbound route is the real channel.
    retell_llm_dynamic_variables: await resolveDynamicVariables(db, resolved),
  });
}

// ---------------------------------------------------------------------------
// call_ended
// ---------------------------------------------------------------------------

async function handleCallEnded(db: Db, event: VoiceWebhookEvent): Promise<NextResponse> {
  const { call } = event;

  let loaded = await loadSession(db, call.call_id);
  if (!loaded) {
    // Stray call_ended without a prior call_started (missed delivery):
    // bootstrap a minimal session so the call still produces an artifact.
    const resolved = await resolveCaller(db, call.from_number, call.to_number);
    if (!resolved) {
      return NextResponse.json(
        { received: false, error: `no organization routed to ${call.to_number}` },
        { status: 404 },
      );
    }
    await upsertCallStarted(db, {
      retellCallId: call.call_id,
      direction: call.direction ?? 'inbound',
      fromNumber: call.from_number,
      toNumber: call.to_number,
      startedAt: new Date().toISOString(),
      resolved,
    });
    loaded = await loadSession(db, call.call_id);
    if (!loaded) {
      throw new Error(`voice_calls row missing after bootstrap for ${call.call_id}`);
    }
  }

  // Preserve the first durable lifecycle timestamp while allowing richer
  // delayed analysis to replace every derived field deterministically.
  const endedAt = loaded.row.ended_at ?? new Date().toISOString();
  const transcript = call.transcript ?? null;
  const analysis = (call as CallWithAnalysis).call_analysis;
  const richness = (transcript?.trim() ? 1 : 0) + (analysis === undefined ? 0 : 2);
  const session = analysis === undefined
    ? loaded.session
    : { ...loaded.session, providerAnalysis: analysis };
  const outcome = compileOutcome(session, transcript, endedAt);
  const body = formatOutcomeMessage(outcome, transcript);

  const propertyId = loaded.row.property_id ?? loaded.session.propertyId ?? null;
  const reviewRequired = propertyId !== null && needsOwnerReview(outcome, propertyId);
  const proposalPayload: VoiceCallReviewPayload | null = reviewRequired
    ? {
        callId: loaded.row.id,
        summary: outcome.oneSentence,
        intents: outcome.intentsHandled,
        riskFlags: outcome.riskFlags,
      }
    : null;
  const proposalReasoning = !reviewRequired
    ? null
    : outcome.approvalsNeeded.length > 0
      ? `Call needs owner review: ${outcome.approvalsNeeded.join('; ')}`
      : `Call flagged for review: ${outcome.riskFlags.join(', ')}`;

  const finalized = await finalizeCallArtifacts(db, call.call_id, {
    session,
    transcript,
    summary: outcome.oneSentence,
    outcome,
    endedAt,
    messageBody: body,
    needsReview: reviewRequired,
    propertyId,
    tenantId: loaded.session.tenantId ?? null,
    proposalPayload: proposalPayload as unknown as Json | null,
    proposalReasoning,
    richness,
  });

  return NextResponse.json({
    received: true,
    call_id: call.call_id,
    duplicate: finalized.duplicate,
    conversation_id: finalized.conversationId,
    proposal_id: finalized.proposalId,
    outcome_summary: finalized.summary,
  });
}
