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
import { createWorkOrder, workOrderArgsSchema } from '@/lib/work-orders/create';

const schema = z.object({
  call_id: z.string().optional(),
  from_number: z.string().regex(/^\+?[0-9]{7,15}$/),
  to_number: z.string().regex(/^\+?[0-9]{7,15}$/),
  args: workOrderArgsSchema,
});

export async function POST(request: NextRequest) {
  const auth = verifyRetellAuth(request);
  if (!auth.ok) return auth.response;

  const parsed = await readToolRequest(request, schema);
  if (!parsed.ok) return parsed.response;

  return Sentry.startSpan({ name: 'retell.tool.create_work_order', op: 'webhook' }, async () => {
    const db = createServiceClient();
    const ctx = await resolveCallContext(db, parsed.data);
    if (!ctx.ok) return toolError(ctx.error, 404);
    if (!ctx.context.tenantId) return toolError('tenant not found for caller', 404);

    // Idempotency: a Retell retry with the same call + args replays the stored
    // result instead of inserting a second work order.
    const callId = parsed.data.call_id;
    if (!callId) return toolError('call_id is required for record-creating tools', 400);
    const requestHash = deriveIdempotencyKey(callId, 'create_work_order', parsed.data.args);
    const idemKey = parsed.toolCallKey ?? requestHash;
    const artifactKey = `${callId}:create_work_order:${idemKey}`;
    const result = await runDurableToolInvocation({
      db,
      organizationId: ctx.context.organizationId,
      callId,
      toolName: 'create_work_order',
      idempotencyKey: idemKey,
      requestHash,
      execute: async (ownership) => {
        const { data: existing } = await db.from('work_orders')
          .select('id, status').eq('retell_artifact_key', artifactKey).maybeSingle();
        if (existing) return {
          body: { work_order_id: existing.id, status: existing.status, shadow_queued: true, autonomy_tier: ACTION_TIERS.create_work_order },
          evidence: { work_order_id: existing.id, retell_artifact_key: artifactKey, recovered: true },
        };
        const now = new Date().toISOString();
        const created = await createWorkOrder(db, {
          organizationId: ctx.context.organizationId,
          tenantId: ctx.context.tenantId!,
          ...parsed.data.args,
          source: 'retell_voice',
          retellArtifactKey: artifactKey,
          timelineExtra: { call_id: callId, shadow_queued: true },
          nowIso: now,
          beforeInsert: () => ownership.assertOwned(),
        });
        if (!created.ok) {
          if (created.error === 'active_lease_not_found') {
            return {
              body: { error: 'no active lease for tenant' },
              httpStatus: 404,
              outcome: 'failed' as const,
              retryable: false,
              errorCode: 'active_lease_not_found',
              evidence: { tenant_id: ctx.context.tenantId },
            };
          }
          const { data: recovered } = await db.from('work_orders').select('id, status').eq('retell_artifact_key', artifactKey).maybeSingle();
          if (recovered) return { body: { work_order_id: recovered.id, status: recovered.status, shadow_queued: true, autonomy_tier: ACTION_TIERS.create_work_order }, evidence: { work_order_id: recovered.id, retell_artifact_key: artifactKey, recovered: true } };
          throw new Error(`work order insert failed: ${created.message}`);
        }

        await ownership.assertOwned();
        await appendCallAction(db, callId, {
          action: 'create_work_order', at: now, tier: ACTION_TIERS.create_work_order,
          outcome: 'executed', ids: { work_order: created.workOrderId },
        });
        return {
          body: { work_order_id: created.workOrderId, status: created.status, shadow_queued: true, autonomy_tier: ACTION_TIERS.create_work_order },
          evidence: { work_order_id: created.workOrderId, retell_artifact_key: artifactKey },
        };
      },
    });
    return NextResponse.json(result.body, { status: result.httpStatus });
  });
}
