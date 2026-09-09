/**
 * Shared "create a work order" domain command — the ONE insert path used
 * by both the Retell voice tool route and the tenant portal.
 *
 * Owns the shared category/urgency vocabulary, args validation, active-
 * lease → unit resolution, and the insert with the first status_timeline
 * entry. Callers pass an explicit `{ organizationId, tenantId }` scope;
 * the active-lease lookup is double-keyed on BOTH (the historical Retell
 * route filtered tenant_id only — that omission stops here).
 *
 * Retell-specific concerns (idempotency artifact key, call ownership
 * assert, durable-invocation recovery) stay in the Retell route and reach
 * this command only through `retellArtifactKey` / `timelineExtra` /
 * `beforeInsert`.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';

import type { Database, Json } from '@/types/database';

/** Work-order categories — mirrors the `work_order_category` DB enum. */
export const WORK_ORDER_CATEGORIES = [
  'plumbing',
  'electrical',
  'hvac',
  'appliances',
  'flooring',
  'painting',
  'landscaping',
  'security',
  'cleaning',
  'general',
  'other',
] as const;

/** Work-order urgencies — mirrors the `work_order_urgency` DB enum. */
export const WORK_ORDER_URGENCIES = ['emergency', 'urgent', 'routine'] as const;

export type WorkOrderCategory = (typeof WORK_ORDER_CATEGORIES)[number];
export type WorkOrderUrgency = (typeof WORK_ORDER_URGENCIES)[number];

/**
 * Shared args validation — the Retell tool schema and the portal form
 * both parse through this, so the vocab can never drift between callers.
 */
export const workOrderArgsSchema = z.object({
  description: z.string().min(3).max(2000),
  category: z.enum(WORK_ORDER_CATEGORIES).default('general'),
  urgency: z.enum(WORK_ORDER_URGENCIES).default('routine'),
});

export interface CreateWorkOrderInput {
  organizationId: string;
  tenantId: string;
  description: string;
  category: WorkOrderCategory;
  urgency: WorkOrderUrgency;
  /** Stamped into the first status_timeline entry. */
  source: 'retell_voice' | 'portal';
  /** Extra fields merged into the first timeline entry (e.g. call_id). */
  timelineExtra?: Record<string, Json>;
  /** Retell idempotency key column; non-Retell callers leave it unset. */
  retellArtifactKey?: string | null;
  /** Timeline timestamp; defaults to now (Retell shares one clock read). */
  nowIso?: string;
  /** Runs after the lease resolves, right before the insert (Retell's
   * `ownership.assertOwned()` keeps its original call ordering). */
  beforeInsert?: () => Promise<void>;
}

export type CreateWorkOrderResult =
  | { ok: true; workOrderId: string; status: string }
  | { ok: false; error: 'active_lease_not_found' }
  | { ok: false; error: 'insert_failed'; message: string };

/**
 * Resolve the tenant's active lease (latest start_date wins — staff-brief
 * convention) and insert an `open` work order against its unit.
 */
export async function createWorkOrder(
  db: SupabaseClient<Database>,
  input: CreateWorkOrderInput,
): Promise<CreateWorkOrderResult> {
  const { data: lease } = await db
    .from('leases')
    .select('id, unit_id')
    .eq('tenant_id', input.tenantId)
    .eq('organization_id', input.organizationId)
    .eq('status', 'active')
    .order('start_date', { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();
  if (!lease) return { ok: false, error: 'active_lease_not_found' };

  if (input.beforeInsert) await input.beforeInsert();

  const at = input.nowIso ?? new Date().toISOString();
  const { data: wo, error } = await db
    .from('work_orders')
    .insert({
      organization_id: input.organizationId,
      tenant_id: input.tenantId,
      unit_id: lease.unit_id,
      category: input.category,
      urgency: input.urgency,
      status: 'open',
      description: input.description,
      retell_artifact_key: input.retellArtifactKey ?? null,
      status_timeline: [
        { at, status: 'open', source: input.source, ...input.timelineExtra },
      ],
    })
    .select('id, status')
    .single();
  if (error || !wo) {
    return {
      ok: false,
      error: 'insert_failed',
      message: error?.message ?? 'no row',
    };
  }
  return { ok: true, workOrderId: wo.id, status: wo.status };
}
