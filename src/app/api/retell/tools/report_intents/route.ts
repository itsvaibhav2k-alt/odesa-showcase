/**
 * POST /api/retell/tools/report_intents — the per-call policy brain.
 *
 * WHY this route exists: this is the HTTP boundary where "the LLM proposes,
 * Odesa disposes" becomes real. The agent reports the topics and facts it
 * heard; the deterministic engine (reducer + planTurn + gateVoiceAction)
 * decides what to ask next and which tools are allowed — the LLM never
 * gates its own risk. The response is PLANNING METADATA ONLY: no tenant
 * names, balances, or unit labels ever appear here, so an unknown caller
 * leaks nothing even if the agent echoes the payload verbatim.
 *
 * Unlike sibling tools, call_id is REQUIRED — intents are meaningless
 * without a session to fold them into. A missing voice_calls row (tool call
 * before/without the webhook) is bootstrapped idempotently via
 * upsertCallStarted, so the route works in both live and simulated calls.
 */

import { type NextRequest } from 'next/server';
import { z } from 'zod';
import * as Sentry from '@sentry/nextjs';

import {
  createServiceClient,
  readToolRequest,
  toolError,
  toolOk,
  verifyRetellAuth,
} from '@/lib/agent/retell-auth';
import { reduceCallEvent } from '@/lib/voice/call-state';
import { planTurn } from '@/lib/voice/plan';
import { resolveCaller } from '@/lib/voice/resolve-caller';
import { loadSession, saveSession, upsertCallStarted } from '@/lib/voice/session-store';
import { allowedToolsFor } from '@/lib/voice/tool-map';
import { callFactsSchema, intentIdSchema, type CallFacts } from '@/lib/voice/types';

const schema = z.object({
  call_id: z.string().min(1),
  from_number: z.string().regex(/^\+?[0-9]{7,15}$/),
  to_number: z.string().regex(/^\+?[0-9]{7,15}$/),
  args: z.object({
    intents: z.array(intentIdSchema).min(1).max(6),
    facts: callFactsSchema.optional(),
  }),
});

export async function POST(request: NextRequest) {
  const auth = verifyRetellAuth(request);
  if (!auth.ok) return auth.response;

  const parsed = await readToolRequest(request, schema);
  if (!parsed.ok) return parsed.response;

  return Sentry.startSpan({ name: 'retell.tool.report_intents', op: 'webhook' }, async () => {
    const db = createServiceClient();
    const { call_id, from_number, to_number, args } = parsed.data;

    const resolved = await resolveCaller(db, from_number, to_number);
    if (!resolved) return toolError('organization not found', 404);

    // Load the live session; bootstrap idempotently when the tool fires
    // before (or without) the call_started webhook. upsertCallStarted
    // applies caller_resolved on the fresh path, so no re-reduce here.
    const loaded = await loadSession(db, call_id);
    let session =
      loaded?.session ??
      (await upsertCallStarted(db, {
        retellCallId: call_id,
        direction: 'inbound',
        fromNumber: from_number,
        toNumber: to_number,
        startedAt: new Date().toISOString(),
        resolved,
      }));

    const at = new Date().toISOString();
    for (const intent of args.intents) {
      session = reduceCallEvent(session, { type: 'intent_added', at, intent });
    }
    if (args.facts) {
      session = reduceCallEvent(session, {
        type: 'fact_collected',
        at,
        facts: args.facts as CallFacts,
      });
    }
    await saveSession(db, call_id, session);

    const plan = planTurn(session);

    // Planning metadata only — never tenant names, balances, or unit labels.
    return toolOk({
      caller_kind: session.callerKind,
      intents_acknowledged: session.intents,
      next_question: plan.nextQuestion,
      missing_facts: plan.missingFacts,
      allowed_tools: allowedToolsFor(plan.allowedActions),
      blocked_or_draft: plan.blockedOrDraft.map(({ action, decision, reason }) => ({
        action,
        decision,
        reason,
      })),
      honesty_hints: plan.honestyHints,
    });
  });
}
