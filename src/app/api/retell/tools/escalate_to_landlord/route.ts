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
import { notifyLandlord } from '@/lib/messaging/notify';
import { ACTION_TIERS } from '@/lib/voice/policy';
import { appendCallAction } from '@/lib/voice/session-store';
import { runDurableToolInvocation } from '@/lib/voice/tool-invocations';

const schema = z.object({
  call_id: z.string().optional(),
  from_number: z.string().regex(/^\+?[0-9]{7,15}$/),
  to_number: z.string().regex(/^\+?[0-9]{7,15}$/),
  args: z.object({
    reason: z.string().min(3).max(2000),
    urgency: z.enum(['emergency', 'urgent', 'routine']),
    category: z
      .enum([
        'water_leak',
        'no_heat_winter',
        'fire_smoke',
        'gas_smell',
        'lockout',
        'sewage_backup',
        'other',
      ])
      .optional(),
  }),
});

export async function POST(request: NextRequest) {
  const auth = verifyRetellAuth(request);
  if (!auth.ok) return auth.response;

  const parsed = await readToolRequest(request, schema);
  if (!parsed.ok) return parsed.response;

  return Sentry.startSpan({ name: 'retell.tool.escalate_to_landlord', op: 'webhook' }, async () => {
    const db = createServiceClient();
    const ctx = await resolveCallContext(db, parsed.data);
    if (!ctx.ok) return toolError(ctx.error, 404);

    // Idempotency: a retry replays the stored result — no duplicate escalation
    // conversation and no second landlord alert.
    const callId = parsed.data.call_id;
    if (!callId) return toolError('call_id is required for record-creating tools', 400);
    const requestHash = deriveIdempotencyKey(callId, 'escalate_to_landlord', parsed.data.args);
    const idemKey = parsed.toolCallKey ?? requestHash;
    const artifactKey = `${callId}:escalate_to_landlord:${idemKey}`;
    const durable = await runDurableToolInvocation({
      db, organizationId: ctx.context.organizationId, callId,
      toolName: 'escalate_to_landlord', idempotencyKey: idemKey, requestHash,
      execute: async (ownership) => {
        const { reason, urgency, category } = parsed.data.args;
        const attemptedAt = new Date().toISOString();
        const escalationKey = `${artifactKey}:escalation`;
        let { data: conversation } = await db.from('conversations').select('id')
          .eq('retell_artifact_key', escalationKey).maybeSingle();
        let convErr: { message: string } | null = null;
        if (!conversation) {
          await ownership.assertOwned();
          ({ data: conversation, error: convErr } = await db.from('conversations').insert({
          organization_id: ctx.context.organizationId, tenant_id: ctx.context.tenantId,
          channel: 'voice', status: 'escalated',
          summary: `[ESCALATION ${urgency}${category ? ` · ${category}` : ''}] ${reason}`,
          last_message_at: attemptedAt, retell_artifact_key: escalationKey,
          }).select('id').single());
        }
        if (!conversation && convErr) {
          ({ data: conversation } = await db.from('conversations').select('id').eq('retell_artifact_key', escalationKey).maybeSingle());
        }
        if (convErr || !conversation) throw new Error(`escalation log failed: ${convErr?.message ?? 'no row'}`);

        const notifyResult = await notifyLandlord({
          db, organizationId: ctx.context.organizationId,
          body: buildLandlordAlert({ urgency, category, reason }), urgent: true,
          retellArtifactKey: `${artifactKey}:owner_alert`,
          assertOwnership: ownership.assertOwned,
        });
        if (!notifyResult.ok) {
          return {
            body: { escalated: false, escalation_recorded: true, conversation_id: conversation.id, contact_attempted_at: attemptedAt, landlord_sms_sent: false, landlord_sms_error: notifyResult.error, retryable: true, autonomy_tier: ACTION_TIERS.escalate_to_landlord },
            httpStatus: 502, outcome: 'failed' as const, retryable: true,
            errorCode: 'landlord_notification_failed',
            evidence: { conversation_id: conversation.id, notification_message_id: notifyResult.messageId, provider_error: notifyResult.error },
          };
        }
        await ownership.assertOwned();
        await appendCallAction(db, callId, {
          action: 'escalate_to_landlord', at: attemptedAt,
          tier: ACTION_TIERS.escalate_to_landlord, outcome: 'executed',
          ids: { conversation: conversation.id },
        });
        return {
          body: { escalated: true, conversation_id: conversation.id, contact_attempted_at: attemptedAt, landlord_sms_sent: true, landlord_sms_error: null, autonomy_tier: ACTION_TIERS.escalate_to_landlord },
          evidence: { conversation_id: conversation.id, notification_message_id: notifyResult.messageId, provider: notifyResult.provider },
        };
      },
    });
    return NextResponse.json(durable.body, { status: durable.httpStatus });
  });
}

function buildLandlordAlert({
  urgency,
  category,
  reason,
}: {
  urgency: string;
  category?: string;
  reason: string;
}): string {
  const head = `[${urgency.toUpperCase()}]${category ? ` ${category}` : ''}`;
  return `${head} ${reason}`.slice(0, 300);
}
