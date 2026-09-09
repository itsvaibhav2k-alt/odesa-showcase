import { type NextRequest } from 'next/server';
import { z } from 'zod';
import * as Sentry from '@sentry/nextjs';

import {
  createServiceClient,
  readToolRequest,
  resolveCallContext,
  toolError,
  toolOk,
  verifyRetellAuth,
} from '@/lib/agent/retell-auth';

const schema = z.object({
  call_id: z.string().optional(),
  from_number: z.string().regex(/^\+?[0-9]{7,15}$/),
  to_number: z.string().regex(/^\+?[0-9]{7,15}$/),
});

export async function POST(request: NextRequest) {
  const auth = verifyRetellAuth(request);
  if (!auth.ok) return auth.response;

  const parsed = await readToolRequest(request, schema);
  if (!parsed.ok) return parsed.response;

  return Sentry.startSpan({ name: 'retell.tool.get_lease_details', op: 'webhook' }, async () => {
    const db = createServiceClient();
    const ctx = await resolveCallContext(db, parsed.data);
    if (!ctx.ok) return toolError(ctx.error, 404);
    if (!ctx.context.tenantId) return toolError('tenant not found for caller', 404);

    const { data: lease } = await db
      .from('leases')
      .select('id, rent_amount, rent_due_day, start_date, end_date, status, late_fee_policy')
      .eq('tenant_id', ctx.context.tenantId)
      .eq('status', 'active')
      .maybeSingle();

    if (!lease) return toolError('no active lease for tenant', 404);

    return toolOk({
      lease_id: lease.id,
      rent_amount: Number(lease.rent_amount),
      rent_due_day: lease.rent_due_day,
      start_date: lease.start_date,
      end_date: lease.end_date,
      status: lease.status,
      late_fee_policy: lease.late_fee_policy ?? null,
    });
  });
}
