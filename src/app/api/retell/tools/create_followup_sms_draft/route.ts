/**
 * Retell tool: create_followup_sms_draft — the always-draft SMS tool.
 *
 * WHY this exists alongside send_sms_followup: tier-3 messages (rent
 * reminders, dispute follow-ups, payment plans, vendor coordination,
 * access/entry) must NEVER auto-send regardless of how innocuous the body
 * reads — the classifier gates send_sms_followup, but the agent is
 * instructed to route known-sensitive intents here, where drafting is
 * unconditional. The owner approves via the existing draft_sms_reply
 * proposal path; this route never touches a send provider.
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
import { ACTION_TIERS } from '@/lib/voice/policy';
import { resolveCaller } from '@/lib/voice/resolve-caller';
import { appendCallAction } from '@/lib/voice/session-store';
import { runDurableToolInvocation } from '@/lib/voice/tool-invocations';

const schema = z.object({
  call_id: z.string().optional(),
  from_number: z.string().regex(/^\+?[0-9]{7,15}$/),
  to_number: z.string().regex(/^\+?[0-9]{7,15}$/),
  args: z.object({
    body: z.string().min(1).max(1600),
    reason: z.string().min(3).max(500).optional(),
  }),
});

export async function POST(request: NextRequest) {
  const auth = verifyRetellAuth(request);
  if (!auth.ok) return auth.response;

  const parsed = await readToolRequest(request, schema);
  if (!parsed.ok) return parsed.response;

  return Sentry.startSpan(
    { name: 'retell.tool.create_followup_sms_draft', op: 'webhook' },
    async () => {
      const db = createServiceClient();
      const ctx = await resolveCallContext(db, parsed.data);
      if (!ctx.ok) return toolError(ctx.error, 404);
      if (!ctx.context.tenantId) return toolError('tenant not found for caller', 404);

      const { body, reason } = parsed.data.args;
      const callId = parsed.data.call_id;
      if (!callId) return toolError('call_id is required for record-creating tools', 400);

      // Idempotency: a retry replays the stored draft, never a second draft.
      const requestHash = deriveIdempotencyKey(callId, 'create_followup_sms_draft', parsed.data.args);
      const idemKey = parsed.toolCallKey ?? requestHash;
      const artifactKey = `${callId}:create_followup_sms_draft:${idemKey}`;
      const result = await runDurableToolInvocation({
        db, organizationId: ctx.context.organizationId, callId,
        toolName: 'create_followup_sms_draft', idempotencyKey: idemKey, requestHash,
        execute: async (ownership) => {
          const resolved = await resolveCaller(db, parsed.data.from_number, parsed.data.to_number);
          const draft = await createSmsDraft(db, {
            organizationId: ctx.context.organizationId, tenantId: ctx.context.tenantId,
            propertyId: resolved?.propertyId ?? null, body,
            reason: reason ?? 'voice operator follow-up draft', source: 'retell_voice',
            callId, retellArtifactKey: artifactKey,
            assertOwnership: ownership.assertOwned,
          });
          await appendCallAction(db, callId, {
            action: 'create_followup_sms_draft', at: new Date().toISOString(),
            tier: ACTION_TIERS.create_followup_sms_draft, outcome: 'drafted',
            ids: { conversation: draft.conversationId, message: draft.messageId, ...(draft.proposalId ? { proposal: draft.proposalId } : {}) },
            detail: reason,
          });
          return {
            body: { drafted: true, conversation_id: draft.conversationId, message_id: draft.messageId, proposal_id: draft.proposalId, autonomy_tier: ACTION_TIERS.create_followup_sms_draft },
            evidence: { conversation_id: draft.conversationId, message_id: draft.messageId, proposal_id: draft.proposalId, retell_artifact_key: artifactKey },
          };
        },
      });
      return NextResponse.json(result.body, { status: result.httpStatus });
    },
  );
}
