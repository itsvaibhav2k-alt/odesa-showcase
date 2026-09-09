/**
 * Retell tool: send_sms_followup — the safe-confirmation SMS tool.
 *
 * WHY the classifier sits here and not in the agent prompt: the LLM proposes
 * SMS bodies but deterministic policy disposes. `classifySmsBody` runs BEFORE
 * any send — 'safe' bodies take the existing notifyTenant path unchanged;
 * anything else (payment claims, promises, legal language, or simply
 * unrecognized text — fail closed) becomes a pending_review draft via
 * createSmsDraft instead. The response stays shape-compatible with the
 * e2e contract (sent/conversation_id/message_id) and only ADDS
 * drafted/draft_reason on the draft path.
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
import { createSmsDraft } from '@/lib/messaging/create-draft';
import { notifyTenant } from '@/lib/messaging/notify';
import { ACTION_TIERS, classifySmsBody } from '@/lib/voice/policy';
import { resolveCaller } from '@/lib/voice/resolve-caller';
import { appendCallAction } from '@/lib/voice/session-store';
import { runDurableToolInvocation } from '@/lib/voice/tool-invocations';

const schema = z.object({
  call_id: z.string().optional(),
  from_number: z.string().regex(/^\+?[0-9]{7,15}$/),
  to_number: z.string().regex(/^\+?[0-9]{7,15}$/),
  args: z.object({
    body: z.string().min(1).max(1600),
  }),
});

export async function POST(request: NextRequest) {
  const auth = verifyRetellAuth(request);
  if (!auth.ok) return auth.response;

  const parsed = await readToolRequest(request, schema);
  if (!parsed.ok) return parsed.response;

  return Sentry.startSpan({ name: 'retell.tool.send_sms_followup', op: 'webhook' }, async () => {
    const db = createServiceClient();
    const ctx = await resolveCallContext(db, parsed.data);
    if (!ctx.ok) return toolError(ctx.error, 404);
    if (!ctx.context.tenantId) return toolError('tenant not found for caller', 404);

    const { body } = parsed.data.args;
    const callId = parsed.data.call_id;
    if (!callId) return toolError('call_id is required for record-creating tools', 400);

    // Idempotency spans BOTH paths (draft or send): a retry replays whichever
    // record the first execution created, never a second send or draft.
    const requestHash = deriveIdempotencyKey(callId, 'send_sms_followup', parsed.data.args);
    const idemKey = parsed.toolCallKey ?? requestHash;
    const artifactKey = `${callId}:send_sms_followup:${idemKey}`;

    const classified = classifySmsBody(body);

    const durable = await runDurableToolInvocation({
      db, organizationId: ctx.context.organizationId, callId,
      toolName: 'send_sms_followup', idempotencyKey: idemKey, requestHash,
      execute: async (ownership) => {
        if (classified.classification === 'draft') {
          const resolved = await resolveCaller(db, parsed.data.from_number, parsed.data.to_number);
          const draft = await createSmsDraft(db, {
            organizationId: ctx.context.organizationId, tenantId: ctx.context.tenantId,
            propertyId: resolved?.propertyId ?? null, body,
            reason: `${classified.category}: ${classified.reason}`, source: 'retell_voice',
            callId, retellArtifactKey: artifactKey,
            assertOwnership: ownership.assertOwned,
          });
          await appendCallAction(db, callId, {
            action: 'create_followup_sms_draft', at: new Date().toISOString(),
            tier: ACTION_TIERS.create_followup_sms_draft, outcome: 'drafted',
            ids: { conversation: draft.conversationId, message: draft.messageId, ...(draft.proposalId ? { proposal: draft.proposalId } : {}) },
            detail: classified.category,
          });
          return {
            body: { sent: false, conversation_id: draft.conversationId, message_id: draft.messageId, drafted: true, draft_reason: classified.category },
            evidence: { conversation_id: draft.conversationId, message_id: draft.messageId, proposal_id: draft.proposalId },
          };
        }

        const notify = await notifyTenant({
          db, organizationId: ctx.context.organizationId,
          tenantId: ctx.context.tenantId!, body, retellArtifactKey: artifactKey,
          assertOwnership: ownership.assertOwned,
        });
        if (!notify.ok || !notify.conversationId || !notify.messageId) {
          return {
            body: { sent: false, conversation_id: notify.conversationId, message_id: notify.messageId, provider: notify.provider, error: notify.error, retryable: true },
            httpStatus: 502, outcome: 'failed' as const, retryable: true,
            errorCode: 'tenant_notify_failed',
            evidence: { conversation_id: notify.conversationId, message_id: notify.messageId, provider_error: notify.error },
          };
        }
        await appendCallAction(db, callId, {
          action: 'send_safe_confirmation_sms', at: new Date().toISOString(),
          tier: ACTION_TIERS.send_safe_confirmation_sms, outcome: 'executed',
          ids: { conversation: notify.conversationId, message: notify.messageId }, detail: classified.category,
        });
        return {
          body: { sent: true, conversation_id: notify.conversationId, message_id: notify.messageId, provider: notify.provider, error: null },
          evidence: { conversation_id: notify.conversationId, message_id: notify.messageId, provider: notify.provider },
        };
      },
    });
    return NextResponse.json(durable.body, { status: durable.httpStatus });
  });
}
