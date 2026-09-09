/**
 * Retell tool: get_owner_briefing — portfolio counts for the verified owner.
 *
 * WHY the hard 403: this tool exists so the landlord can call their own
 * Odesa number and hear a real status briefing. The counts alone leak
 * business state (late rent, pending approvals), so anyone who is not
 * resolved as 'verified_owner' by phone number gets refused outright —
 * tenants, vendors, ambiguous and unknown callers all included. Counts
 * only, no tenant PII: the agent speaks numbers, never names.
 *
 * Tier 0 (read-only); honesty_note reminds the agent these are ledger/queue
 * snapshots, not guarantees ("the ledger currently shows" phrasing).
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
import { resolveCaller } from '@/lib/voice/resolve-caller';

const schema = z.object({
  call_id: z.string().optional(),
  from_number: z.string().regex(/^\+?[0-9]{7,15}$/),
  to_number: z.string().regex(/^\+?[0-9]{7,15}$/),
});

/** rent_events statuses that mean "the ledger shows this cycle is late". */
const LATE_STATUSES = ['late_1', 'late_3', 'late_7', 'escalated'] as const;
const OPEN_WORK_ORDER_STATUSES = ['open', 'assigned', 'in_progress'] as const;

/** First of the current month, UTC — matches rent_events.cycle_month ('YYYY-MM-01'). */
function currentCycleMonthIso(): string {
  const now = new Date();
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  return `${now.getUTCFullYear()}-${month}-01`;
}

/** Start of the current UTC day, ISO — bounds calls_today. */
function startOfUtcDayIso(): string {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
}

export async function POST(request: NextRequest) {
  const auth = verifyRetellAuth(request);
  if (!auth.ok) return auth.response;

  const parsed = await readToolRequest(request, schema);
  if (!parsed.ok) return parsed.response;

  return Sentry.startSpan({ name: 'retell.tool.get_owner_briefing', op: 'webhook' }, async () => {
    const db = createServiceClient();
    const resolved = await resolveCaller(db, parsed.data.from_number, parsed.data.to_number);
    if (!resolved) return toolError(`no organization routed to ${parsed.data.to_number}`, 404);
    if (resolved.callerKind !== 'verified_owner') {
      return toolError('owner verification required', 403);
    }

    const orgId = resolved.organizationId;
    const count = { count: 'exact', head: true } as const;

    const [lateRent, openWorkOrders, pendingApprovals, openConversations, callsToday] =
      await Promise.all([
        db
          .from('rent_events')
          .select('id', count)
          .eq('organization_id', orgId)
          .eq('cycle_month', currentCycleMonthIso())
          .in('status', [...LATE_STATUSES]),
        db
          .from('work_orders')
          .select('id', count)
          .eq('organization_id', orgId)
          .in('status', [...OPEN_WORK_ORDER_STATUSES]),
        db
          .from('action_proposals')
          .select('id', count)
          .eq('organization_id', orgId)
          .eq('status', 'proposed'),
        db
          .from('conversations')
          .select('id', count)
          .eq('organization_id', orgId)
          .eq('status', 'open'),
        db
          .from('voice_calls')
          .select('id', count)
          .eq('organization_id', orgId)
          .gte('started_at', startOfUtcDayIso()),
      ]);

    return toolOk({
      late_rent: lateRent.count ?? 0,
      open_work_orders: openWorkOrders.count ?? 0,
      pending_approvals: pendingApprovals.count ?? 0,
      open_conversations: openConversations.count ?? 0,
      calls_today: callsToday.count ?? 0,
      honesty_note: 'counts reflect current ledger and queue state',
      autonomy_tier: 0,
    });
  });
}
