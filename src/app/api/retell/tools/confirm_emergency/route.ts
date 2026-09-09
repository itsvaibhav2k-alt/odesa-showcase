/**
 * Retell tool endpoint — `confirm_emergency`.
 *
 * Called by the voice agent mid-call after a lexical emergency hit.
 * Wraps `detectAndConfirmEmergency`, which (a) re-runs the lexical
 * matcher against the utterance for an audit-grade signal and (b)
 * spawns a `confirm_emergency` worker for false-positive filtering.
 *
 * The worker is gated behind `ODESA_USE_REAL_AI`. When off, this
 * endpoint returns the lexical verdict as severity='emergency' with
 * `confirmed: null` so the voice agent still escalates by default.
 *
 * Latency budget: <800ms wall-clock end-to-end. Enforced by an
 * AbortController firing at WORKER_BUDGET_MS into the worker call. On
 * budget exceeded, we fall back to the lexical match's
 * severity='emergency' so the voice agent escalates by default — the
 * caller must NEVER stall past 800ms waiting for false-positive
 * filtering. WORKER_BUDGET_MS leaves ~100ms headroom for the lexical
 * match + property/tenant lookups + JSON serialisation.
 *
 * Auth: bearer token (RETELL_API_KEY) — same as other Retell tools.
 */
import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import * as Sentry from '@sentry/nextjs';

import {
  createServiceClient,
  deriveIdempotencyKey,
  readToolRequest,
  resolveCallContext,
  toolError,
  verifyRetellAuth,
} from '@/lib/agent/retell-auth';
import {
  detectAndConfirmEmergency,
  detectEmergency,
} from '@/lib/agent/emergency';
import { resolveTenantProperty } from '@/lib/messaging/resolve-property';
import { runDurableToolInvocation } from '@/lib/voice/tool-invocations';

/**
 * Latency budget for the worker call portion of this endpoint, in ms.
 * The total endpoint budget is 800ms; this leaves headroom for the
 * lexical detect, property lookup, and response serialization.
 */
const WORKER_BUDGET_MS = 700;

const schema = z.object({
  call_id: z.string().optional(),
  from_number: z.string().regex(/^\+?[0-9]{7,15}$/),
  to_number: z.string().regex(/^\+?[0-9]{7,15}$/),
  args: z.object({
    utterance: z.string().min(1).max(2000),
    /**
     * Optional — when the agent wants to override the property anchor
     * (e.g., a guarantor calling about their child's unit). Most calls
     * resolve via the tenant lookup.
     */
    property_id: z.string().uuid().optional(),
  }),
});

export async function POST(request: NextRequest) {
  const auth = verifyRetellAuth(request);
  if (!auth.ok) return auth.response;

  const parsed = await readToolRequest(request, schema);
  if (!parsed.ok) return parsed.response;

  return Sentry.startSpan({ name: 'retell.tool.confirm_emergency', op: 'webhook' }, async () => {
    const db = createServiceClient();
    const ctx = await resolveCallContext(db, parsed.data);
    if (!ctx.ok) return toolError(ctx.error, 404);

    const { utterance, property_id } = parsed.data.args;

    // Resolve property: arg override takes precedence, else lease lookup
    // via the tenant in the call context. If neither, the lexical-only
    // path still runs (no worker call) — gives the agent SOMETHING.
    let propertyId: string | null = property_id ?? null;
    if (!propertyId && ctx.context.tenantId) {
      const resolved = await resolveTenantProperty(db, ctx.context.tenantId);
      propertyId = resolved?.propertyId ?? null;
    }

    const callId = parsed.data.call_id;
    if (!callId) return toolError('call_id is required for record-creating tools', 400);
    const requestHash = deriveIdempotencyKey(callId, 'confirm_emergency', parsed.data.args);
    const idemKey = parsed.toolCallKey ?? requestHash;
    const artifactKey = `${callId}:confirm_emergency:${idemKey}`;
    const durable = await runDurableToolInvocation({
      db, organizationId: ctx.context.organizationId, callId,
      toolName: 'confirm_emergency', idempotencyKey: idemKey, requestHash,
      execute: async (ownership) => {
        if (!propertyId) {
          return {
            body: { confirmed: null, severity: 'emergency', recommendedAction: 'escalate_now', reason: 'no_property_context' },
            evidence: { lexical_only: true, reason: 'no_property_context' },
          };
        }
        const controller = new AbortController();
        const budgetTimer = setTimeout(
          () => controller.abort(new Error('latency_budget_exceeded')),
          WORKER_BUDGET_MS,
        );
        try {
          await ownership.assertOwned();
          const result = await detectAndConfirmEmergency({
            utterance, propertyId,
            signal: AbortSignal.any([controller.signal, ownership.signal]), deps: { admin: db },
            retellArtifactKey: `${artifactKey}:proposal`,
          });
          return {
            body: { confirmed: result.workerConfirmed, severity: result.severity ?? 'emergency', category: result.category, matchedPhrase: result.matchedPhrase, recommendedAction: result.recommendedAction ?? 'escalate_now' },
            evidence: { property_id: propertyId, worker_confirmed: result.workerConfirmed },
          };
        } catch (err) {
          if (!controller.signal.aborted) throw err;
          const lexical = detectEmergency(utterance);
          return {
            body: { confirmed: null, severity: 'emergency', category: lexical.category, matchedPhrase: lexical.matchedPhrase, recommendedAction: 'escalate_now', reason: 'budget_exceeded_fallback_to_lexical' },
            evidence: { property_id: propertyId, latency_budget_exceeded: true },
          };
        } finally {
          clearTimeout(budgetTimer);
        }
      },
    });
    return NextResponse.json(durable.body, { status: durable.httpStatus });
  });
}
