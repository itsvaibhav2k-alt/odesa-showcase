'use server';

/**
 * Owner overrides for a work order, split into two honest write paths:
 *
 *  1. `updateWorkOrderFieldsAction` — URGENCY ONLY. The voice agent proposes a
 *     priority (urgency) and it is model-chosen / non-deterministic (the same
 *     request lands Low on one call and High on another), so the owner corrects
 *     it. Routes through the Wave 2 `mutate_work_order_audited` RPC (same
 *     five-argument compatibility signature, narrowed to urgency-only),
 *     passing only p_urgency; status/vendor are never sent from the app here.
 *
 *  2. `transitionWorkOrderLifecycleAction` — the vendor/status STATE MACHINE
 *     (assign / respond / start / complete / approve / reopen / cancel). Guarded,
 *     optimistically-locked and idempotent in the database via
 *     `mutate_work_order_lifecycle`; the app just relays the verb + version +
 *     request id and maps PG error codes onto honest caller messages.
 *
 * Both paths are RLS-scoped, owner-gated (`can(role,'mutate_work_order')`), and
 * append an audit entry to the work order's `status_timeline` in the database.
 */

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { createServerClient } from '@/lib/supabase/server';
import { can, FORBIDDEN_MESSAGE } from '@/lib/authz/policy';

const WORK_ORDER_URGENCY = ['emergency', 'urgent', 'routine'] as const;

const patchSchema = z.object({
  urgency: z.enum(WORK_ORDER_URGENCY),
});

export type UpdateWorkOrderInput = z.infer<typeof patchSchema>;

/**
 * Urgency-only override for a work order. Status and vendor moved to
 * `transitionWorkOrderLifecycleAction`; this path exists solely to correct the
 * AI-set priority through the audited Wave 2 RPC.
 */
export async function updateWorkOrderFieldsAction(
  woId: string,
  input: UpdateWorkOrderInput,
): Promise<{ ok: true } | { ok: false; error: string; status?: 401 | 403 }> {
  const parsed = patchSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Invalid update' };

  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Unauthorized', status: 401 };

  const { data: userRow, error: membershipError } = await supabase
    .from('users')
    .select('organization_id, role')
    .eq('id', user.id)
    .single();
  if (membershipError || !userRow?.organization_id || !userRow.role) {
    return { ok: false, error: FORBIDDEN_MESSAGE, status: 403 };
  }
  if (!can(userRow.role, 'mutate_work_order')) {
    return { ok: false, error: FORBIDDEN_MESSAGE, status: 403 };
  }

  const { data, error } = await supabase.rpc('mutate_work_order_audited', {
    p_work_order_id: woId,
    p_urgency: parsed.data.urgency,
    p_status: null,
    p_vendor_id: null,
    p_set_vendor: false,
  });
  if (error?.code === '42501') {
    return { ok: false, error: FORBIDDEN_MESSAGE, status: 403 };
  }
  if (error?.code === 'P0002') {
    return { ok: false, error: 'Work order not found' };
  }
  if (error) return { ok: false, error: 'Failed to update work order' };

  const result = data as { unitId?: string | null } | null;

  revalidatePath(`/work-orders/${woId}`);
  if (result?.unitId) {
    const { data: unit } = await supabase
      .from('units')
      .select('property_id')
      .eq('id', result.unitId)
      .maybeSingle();
    if (unit?.property_id) revalidatePath(`/properties/${unit.property_id}`);
  }

  return { ok: true };
}

// =====================================================================
// Vendor lifecycle state machine
// =====================================================================

const LIFECYCLE_ACTIONS = [
  'assign_vendor',
  'record_response',
  'reassign_vendor',
  'start_work',
  'complete',
  'approve',
  'reopen',
  'cancel',
] as const;

const VENDOR_RESPONSE = ['accepted', 'declined', 'no_response'] as const;

const lifecycleSchema = z.object({
  action: z.enum(LIFECYCLE_ACTIONS),
  expectedVersion: z.number().int().nonnegative(),
  requestId: z.string().uuid(),
  vendorId: z.string().uuid().nullable().optional(),
  vendorResponse: z.enum(VENDOR_RESPONSE).optional(),
});

export type TransitionWorkOrderInput = z.infer<typeof lifecycleSchema>;

export type TransitionWorkOrderResult =
  | {
      ok: true;
      changed: boolean;
      lifecycleVersion: number;
      vendorAssignedAt: string | null;
      vendorRespondedAt: string | null;
    }
  | {
      ok: false;
      error: string;
      code?: 'stale' | 'invalid' | 'forbidden' | 'conflict';
      status?: 401 | 403;
    };

/**
 * Drive one vendor-lifecycle transition through the owner-only, optimistically
 * locked, idempotent `mutate_work_order_lifecycle` RPC.
 *
 * @param woId - work_orders.id.
 * @param input - the verb, the `expectedVersion` read when the page loaded, a
 *   fresh `requestId` (crypto.randomUUID) generated once per click, and the
 *   vendor id / vendor response the verb needs.
 * @returns `{ ok, lifecycleVersion }` on success, or an honest typed error —
 *   `stale` (row moved on since load), `invalid` (transition not allowed for
 *   the current state), `conflict` (same requestId reused with a different
 *   payload), `forbidden` (role/org denial).
 */
export async function transitionWorkOrderLifecycleAction(
  woId: string,
  input: TransitionWorkOrderInput,
): Promise<TransitionWorkOrderResult> {
  const parsed = lifecycleSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Invalid request', code: 'invalid' };

  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Unauthorized', status: 401 };

  const { data: userRow, error: membershipError } = await supabase
    .from('users')
    .select('organization_id, role')
    .eq('id', user.id)
    .single();
  if (membershipError || !userRow?.organization_id || !userRow.role) {
    return { ok: false, error: FORBIDDEN_MESSAGE, code: 'forbidden', status: 403 };
  }
  if (!can(userRow.role, 'mutate_work_order')) {
    return { ok: false, error: FORBIDDEN_MESSAGE, code: 'forbidden', status: 403 };
  }

  const { data, error } = await supabase.rpc('mutate_work_order_lifecycle', {
    p_work_order_id: woId,
    p_action: parsed.data.action,
    p_expected_version: parsed.data.expectedVersion,
    p_request_id: parsed.data.requestId,
    p_vendor_id: parsed.data.vendorId ?? null,
    p_vendor_response: parsed.data.vendorResponse ?? null,
  });

  if (error) {
    if (error.code === '42501') {
      return { ok: false, error: FORBIDDEN_MESSAGE, code: 'forbidden', status: 403 };
    }
    // stale_write is raised as 55000 (object_not_in_prerequisite_state), NOT
    // 40001 — 40001 would make PostgREST auto-retry into the RPC's FOR UPDATE
    // lock and hang the request instead of returning here.
    if (error.code === '55000') {
      return {
        ok: false,
        code: 'stale',
        error:
          'This work order changed since you loaded it — refresh to see the latest.',
      };
    }
    if (error.code === 'P0002') {
      return { ok: false, error: 'Work order not found' };
    }
    if (error.code === '22000') {
      if ((error.message ?? '').includes('idempotency_conflict')) {
        return {
          ok: false,
          code: 'conflict',
          error: 'This action was already submitted with different values.',
        };
      }
      return {
        ok: false,
        code: 'invalid',
        error: cleanTransitionMessage(error.message),
      };
    }
    return { ok: false, error: 'Failed to update work order', code: 'invalid' };
  }

  const result = data as {
    changed?: boolean;
    unitId?: string | null;
    vendorId?: string | null;
    lifecycleVersion?: number;
    vendorAssignedAt?: string | null;
    vendorRespondedAt?: string | null;
  } | null;

  revalidatePath(`/work-orders/${woId}`);
  revalidatePath('/open-items');
  if (result?.vendorId) revalidatePath(`/vendors/${result.vendorId}`);
  if (result?.unitId) {
    const { data: unit } = await supabase
      .from('units')
      .select('property_id')
      .eq('id', result.unitId)
      .maybeSingle();
    if (unit?.property_id) revalidatePath(`/properties/${unit.property_id}`);
  }

  return {
    ok: true,
    changed: result?.changed === true,
    lifecycleVersion: result?.lifecycleVersion ?? parsed.data.expectedVersion,
    vendorAssignedAt: result?.vendorAssignedAt ?? null,
    vendorRespondedAt: result?.vendorRespondedAt ?? null,
  };
}

/** Strip the internal `invalid_transition: ` prefix off the PG message. */
function cleanTransitionMessage(message: string | undefined): string {
  const raw = (message ?? '').replace(/^invalid_transition:\s*/, '').trim();
  return raw.length > 0
    ? raw.charAt(0).toUpperCase() + raw.slice(1)
    : 'This action is not allowed for the current state.';
}
