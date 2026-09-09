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

  return Sentry.startSpan({ name: 'retell.tool.lookup_tenant_by_phone', op: 'webhook' }, async () => {
    const db = createServiceClient();
    const ctx = await resolveCallContext(db, parsed.data);
    if (!ctx.ok) return toolError(ctx.error, 404);

    if (!ctx.context.tenantId) {
      return toolOk({ not_found: true, organization_id: ctx.context.organizationId });
    }

    const { data: tenant, error } = await db
      .from('tenants')
      .select('id, full_name, phone_e164, organization_id')
      .eq('id', ctx.context.tenantId)
      .single();
    if (error || !tenant) return toolError('tenant load failed', 500);

    const { data: lease } = await db
      .from('leases')
      .select('id, unit_id')
      .eq('tenant_id', tenant.id)
      .eq('status', 'active')
      .maybeSingle();

    let unitLabel: string | null = null;
    let propertyName: string | null = null;
    if (lease) {
      const { data: unit } = await db
        .from('units')
        .select('label, property_id')
        .eq('id', lease.unit_id)
        .maybeSingle();
      unitLabel = unit?.label ?? null;
      if (unit?.property_id) {
        const { data: property } = await db
          .from('properties')
          .select('name')
          .eq('id', unit.property_id)
          .maybeSingle();
        propertyName = property?.name ?? null;
      }
    }

    return toolOk({
      not_found: false,
      tenant_id: tenant.id,
      full_name: tenant.full_name,
      organization_id: tenant.organization_id,
      active_lease_id: lease?.id ?? null,
      unit_label: unitLabel,
      property_name: propertyName,
    });
  });
}
