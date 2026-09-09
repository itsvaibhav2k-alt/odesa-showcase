/**
 * Retell tool: get_vendor_jobs — a known vendor's open assignments.
 *
 * WHY the hard 403: this is call context for vendors phoning about their
 * work, so only a caller whose phone resolves to exactly one vendors row
 * ('known_vendor') gets anything. Everyone else — tenants, unknown,
 * ambiguous — is refused.
 *
 * WHY the response is deliberately thin: vendors get the job (category,
 * urgency, status) and a property label to orient by — never tenant names,
 * rent, or any financial data. Cost estimates and scheduling commitments
 * are Tier-3 owner decisions; boundary_note tells the agent to say so
 * instead of promising.
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

const OPEN_WORK_ORDER_STATUSES = ['open', 'assigned', 'in_progress'] as const;

export async function POST(request: NextRequest) {
  const auth = verifyRetellAuth(request);
  if (!auth.ok) return auth.response;

  const parsed = await readToolRequest(request, schema);
  if (!parsed.ok) return parsed.response;

  return Sentry.startSpan({ name: 'retell.tool.get_vendor_jobs', op: 'webhook' }, async () => {
    const db = createServiceClient();
    const resolved = await resolveCaller(db, parsed.data.from_number, parsed.data.to_number);
    if (!resolved) return toolError(`no organization routed to ${parsed.data.to_number}`, 404);
    if (resolved.callerKind !== 'known_vendor' || !resolved.vendorId) {
      return toolError('vendor verification required', 403);
    }

    const { data: orders, error } = await db
      .from('work_orders')
      .select('id, category, urgency, status, unit_id')
      .eq('organization_id', resolved.organizationId)
      .eq('vendor_id', resolved.vendorId)
      .in('status', [...OPEN_WORK_ORDER_STATUSES])
      .order('created_at', { ascending: true });
    if (error) return toolError(`work order lookup failed: ${error.message}`, 500);

    // unit → property name, two flat lookups (mirrors today/queries.ts maps).
    const unitIds = Array.from(new Set((orders ?? []).map((o) => o.unit_id)));
    const propertyNameByUnit = new Map<string, string>();
    if (unitIds.length > 0) {
      const { data: units } = await db
        .from('units')
        .select('id, property_id')
        .in('id', unitIds);
      const propertyIds = Array.from(new Set((units ?? []).map((u) => u.property_id)));
      const { data: properties } = propertyIds.length
        ? await db.from('properties').select('id, name').in('id', propertyIds)
        : { data: [] };
      const nameById = new Map((properties ?? []).map((p) => [p.id, p.name]));
      (units ?? []).forEach((u) => {
        const name = nameById.get(u.property_id);
        if (name) propertyNameByUnit.set(u.id, name);
      });
    }

    return toolOk({
      jobs: (orders ?? []).map((o) => ({
        work_order_id: o.id,
        category: o.category,
        urgency: o.urgency,
        status: o.status,
        property_label: propertyNameByUnit.get(o.unit_id) ?? null,
      })),
      autonomy_tier: 0,
      boundary_note: 'cost estimates and scheduling commitments require owner approval',
    });
  });
}
