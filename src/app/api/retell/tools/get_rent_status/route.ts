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

  return Sentry.startSpan({ name: 'retell.tool.get_rent_status', op: 'webhook' }, async () => {
    const db = createServiceClient();
    const ctx = await resolveCallContext(db, parsed.data);
    if (!ctx.ok) return toolError(ctx.error, 404);
    if (!ctx.context.tenantId) return toolError('tenant not found for caller', 404);

    const { data: lease } = await db
      .from('leases')
      .select('id, rent_amount, rent_due_day, status')
      .eq('tenant_id', ctx.context.tenantId)
      .eq('status', 'active')
      .maybeSingle();

    if (!lease) return toolError('no active lease for tenant', 404);

    const { data: events } = await db
      .from('rent_events')
      .select('id, status, due_date, amount_due, amount_paid, updated_at')
      .eq('lease_id', lease.id)
      .order('due_date', { ascending: false })
      .limit(3);

    const latest = events?.[0] ?? null;
    const lastPaid = events?.find((e) => e.status === 'paid') ?? null;
    const outstanding =
      latest && latest.status !== 'paid'
        ? Number(latest.amount_due) - Number(latest.amount_paid ?? 0)
        : 0;

    const currentStatus = latest?.status ?? 'unknown';
    const monthLabel = latest?.due_date ?? 'the current period';
    const ledgerStatusPhrase =
      currentStatus === 'paid'
        ? `the ledger currently shows paid for ${monthLabel}`
        : `the ledger currently shows ${currentStatus} for ${monthLabel}; $${outstanding} outstanding`;

    return toolOk({
      balance_due: outstanding,
      next_due_date: latest?.due_date ?? null,
      rent_amount: Number(lease.rent_amount),
      last_payment_amount: lastPaid ? Number(lastPaid.amount_paid) : null,
      // ALWAYS null: rent_events has no paid_at; updated_at is mutation
      // time, not payment evidence — Financials investigation 2026-07.
      // Fabricating a payment timestamp from row churn is a lie the
      // agent would speak out loud on a live call.
      last_payment_date: null,
      current_status: currentStatus,
      // Deterministic honest phrasing for the agent to speak verbatim —
      // "the ledger shows", never "you paid on".
      ledger_status_phrase: ledgerStatusPhrase,
    });
  });
}
