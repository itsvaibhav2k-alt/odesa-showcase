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
import { ACTION_TIERS } from '@/lib/voice/policy';
import { appendCallAction } from '@/lib/voice/session-store';
import { runDurableToolInvocation } from '@/lib/voice/tool-invocations';

const schema = z.object({
  call_id: z.string().optional(),
  from_number: z.string().regex(/^\+?[0-9]{7,15}$/),
  to_number: z.string().regex(/^\+?[0-9]{7,15}$/),
  args: z.object({
    preferred_time: z.string().min(1).max(100),
    topic: z.string().min(1).max(1000),
  }),
});

export async function POST(request: NextRequest) {
  const auth = verifyRetellAuth(request);
  if (!auth.ok) return auth.response;

  const parsed = await readToolRequest(request, schema);
  if (!parsed.ok) return parsed.response;

  return Sentry.startSpan({ name: 'retell.tool.schedule_callback', op: 'webhook' }, async () => {
    const db = createServiceClient();
    const ctx = await resolveCallContext(db, parsed.data);
    if (!ctx.ok) return toolError(ctx.error, 404);

    // Idempotency: a retry replays the stored result, no second conversation.
    const callId = parsed.data.call_id;
    if (!callId) return toolError('call_id is required for record-creating tools', 400);
    const requestHash = deriveIdempotencyKey(callId, 'schedule_callback', parsed.data.args);
    const idemKey = parsed.toolCallKey ?? requestHash;
    const artifactKey = `${callId}:schedule_callback:${idemKey}`;
    const result = await runDurableToolInvocation({
      db, organizationId: ctx.context.organizationId, callId,
      toolName: 'schedule_callback', idempotencyKey: idemKey, requestHash,
      execute: async (ownership) => {
        const { preferred_time, topic } = parsed.data.args;
        const { data: existing } = await db.from('conversations').select('id')
          .eq('retell_artifact_key', artifactKey).maybeSingle();
        if (existing) return {
          body: { callback_scheduled: true, conversation_id: existing.id, preferred_time, autonomy_tier: ACTION_TIERS.schedule_callback },
          evidence: { conversation_id: existing.id, retell_artifact_key: artifactKey, recovered: true },
        };
        const summary = `[CALLBACK REQUESTED · ${preferred_time}] ${topic}`;
        const at = new Date().toISOString();
        await ownership.assertOwned();
        const { data: conversation, error } = await db.from('conversations').insert({
          organization_id: ctx.context.organizationId,
          tenant_id: ctx.context.tenantId,
          channel: 'voice', status: 'open', summary, last_message_at: at,
          retell_artifact_key: artifactKey,
        }).select('id').single();
        if (error || !conversation) {
          const { data: recovered } = await db.from('conversations').select('id').eq('retell_artifact_key', artifactKey).maybeSingle();
          if (recovered) return { body: { callback_scheduled: true, conversation_id: recovered.id, preferred_time, autonomy_tier: ACTION_TIERS.schedule_callback }, evidence: { conversation_id: recovered.id, retell_artifact_key: artifactKey, recovered: true } };
          throw new Error(`callback log failed: ${error?.message ?? 'no row'}`);
        }
        await ownership.assertOwned();
        await appendCallAction(db, callId, {
          action: 'schedule_callback', at, tier: ACTION_TIERS.schedule_callback,
          outcome: 'executed', ids: { conversation: conversation.id },
        });
        return {
          body: { callback_scheduled: true, conversation_id: conversation.id, preferred_time, autonomy_tier: ACTION_TIERS.schedule_callback },
          evidence: { conversation_id: conversation.id, retell_artifact_key: artifactKey },
        };
      },
    });
    return NextResponse.json(result.body, { status: result.httpStatus });
  });
}
