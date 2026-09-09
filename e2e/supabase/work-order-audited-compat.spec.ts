/**
 * Wave 2 `mutate_work_order_audited` compatibility regression (post-Wave 5).
 *
 * Wave 5 added a SECOND, differently-named work-order RPC
 * (`mutate_work_order_lifecycle`) and new columns on `work_orders`. This spec
 * proves the Wave 5 migration did NOT disturb the Wave 2 contract:
 *
 *   - the original 5-arg audited RPC still applies urgency and writes one
 *     honest `human_edit` audit entry, for an owner;
 *   - its status/vendor parameters deterministically reject lifecycle bypasses;
 *   - it is still owner-only (manager/va -> 42501);
 *   - direct UPDATE on `work_orders` is still revoked from authenticated;
 *   - both RPCs are EXECUTE-granted to authenticated and revoked from anon;
 *   - the two functions coexist with no name-resolution ambiguity (PGRST203) —
 *     each resolves to exactly one function and runs.
 *
 * Pure `@supabase/supabase-js`; skipped when the Supabase env vars are absent.
 */

import { expect, test } from '@playwright/test';

import { HAVE_SUPABASE, provisionLifecycleOrg, type LifecycleOrg } from './lifecycle-fixture';

test.describe('mutate_work_order_audited: Wave 2 compat after Wave 5', () => {
  test.describe.configure({ mode: 'serial' });
  test.skip(
    !HAVE_SUPABASE,
    'Skipped: set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and anon key to run',
  );

  let org: LifecycleOrg;

  test.beforeAll(async () => {
    test.setTimeout(180_000);
    org = await provisionLifecycleOrg();
  });

  test.afterAll(async () => {
    if (org) {
      await org.teardown();
      await org.verifyClean();
    }
  });

  // ===================================================================
  // The old 5-arg RPC still applies and audits (owner)
  // ===================================================================

  test('owner: the 5-arg audited RPC still applies urgency and audits', async () => {
    const woId = await org.seedWorkOrder({ status: 'open', urgency: 'routine' });

    const { data, error } = await org.owner.rpc('mutate_work_order_audited', {
      p_work_order_id: woId,
      p_status: null,
      p_urgency: 'urgent',
      p_vendor_id: null,
      p_set_vendor: false,
    });
    // No ambiguity error, and the canonical Wave 2 result shape.
    expect(error).toBeNull();
    expect(data).toMatchObject({
      changed: true,
      status: 'open',
      urgency: 'urgent',
      lifecycleVersion: 1,
    });

    const { data: after } = await org.admin
      .from('work_orders')
      .select('status, urgency, status_timeline, lifecycle_version')
      .eq('id', woId)
      .single();
    expect(after?.status).toBe('open');
    expect(after?.urgency).toBe('urgent');
    expect(after?.lifecycle_version).toBe(1);
    const timeline = after?.status_timeline as Array<Record<string, unknown>>;
    expect(timeline).toHaveLength(1);
    expect(timeline[0]).toMatchObject({
      source: 'human_edit',
      actor_id: org.ownerId,
      actor_role: 'owner',
      status: 'open',
    });
  });

  test('status and vendor arguments cannot bypass the lifecycle state machine', async () => {
    const woId = await org.seedWorkOrder({ status: 'open', urgency: 'routine' });
    for (const args of [
      { p_status: 'completed' as const, p_vendor_id: null, p_set_vendor: false },
      { p_status: null, p_vendor_id: org.vendorId, p_set_vendor: true },
    ]) {
      const { error } = await org.owner.rpc('mutate_work_order_audited', {
        p_work_order_id: woId,
        p_urgency: null,
        ...args,
      });
      expect(error?.code).toBe('22000');
      expect(error?.message ?? '').toContain('lifecycle_mutation_requires');
    }
    const { data: after } = await org.admin
      .from('work_orders')
      .select('status, vendor_id, lifecycle_version, status_timeline')
      .eq('id', woId)
      .single();
    expect(after).toEqual({
      status: 'open',
      vendor_id: null,
      lifecycle_version: 0,
      status_timeline: [],
    });
  });

  test('a Wave 5 write loaded before a changed Wave 2 urgency call is stale', async () => {
    const woId = await org.seedWorkOrder({ status: 'open', urgency: 'routine' });
    const legacy = await org.owner.rpc('mutate_work_order_audited', {
      p_work_order_id: woId,
      p_urgency: 'urgent',
      p_status: null,
      p_vendor_id: null,
      p_set_vendor: false,
    });
    expect(legacy.error).toBeNull();

    const stale = await org.owner.rpc('mutate_work_order_lifecycle', {
      p_work_order_id: woId,
      p_action: 'assign_vendor',
      p_expected_version: 0,
      p_request_id: crypto.randomUUID(),
      p_vendor_id: org.vendorId,
      p_vendor_response: null,
    });
    expect(stale.error?.code).toBe('55000');
    const { data: after } = await org.admin
      .from('work_orders')
      .select('status, urgency, vendor_id, lifecycle_version')
      .eq('id', woId)
      .single();
    expect(after).toEqual({
      status: 'open',
      urgency: 'urgent',
      vendor_id: null,
      lifecycle_version: 1,
    });
  });

  // ===================================================================
  // Still owner-only (manager/va -> 42501)
  // ===================================================================

  for (const who of ['manager', 'va'] as const) {
    test(`${who} still cannot invoke the audited RPC (42501)`, async () => {
      const woId = await org.seedWorkOrder({ status: 'open' });
      const client = who === 'manager' ? org.manager : org.va;
      const { error } = await client.rpc('mutate_work_order_audited', {
        p_work_order_id: woId,
        p_status: 'completed',
        p_urgency: 'emergency',
        p_vendor_id: null,
        p_set_vendor: false,
      });
      expect(error?.code).toBe('42501');

      const { data: after } = await org.admin
        .from('work_orders')
        .select('status, urgency, status_timeline')
        .eq('id', woId)
        .single();
      expect(after?.status).toBe('open');
      expect(after?.urgency).toBe('routine');
      expect(after?.status_timeline).toEqual([]);
    });
  }

  // ===================================================================
  // Direct UPDATE on work_orders is still revoked from authenticated
  // ===================================================================

  test('owner still cannot bypass the audit with a direct UPDATE on work_orders', async () => {
    const woId = await org.seedWorkOrder({ status: 'open', urgency: 'routine' });

    const { data, error } = await org.owner
      .from('work_orders')
      .update({
        status: 'completed',
        urgency: 'emergency',
        status_timeline: [{ source: 'owner_edit', note: 'fabricated' }],
      })
      .eq('id', woId)
      .select();
    // RLS filters the row (0 rows) or errors — either way nothing changed.
    if (error === null) expect(data ?? []).toEqual([]);

    const { data: after } = await org.admin
      .from('work_orders')
      .select('status, urgency, status_timeline, lifecycle_version')
      .eq('id', woId)
      .single();
    expect(after).toEqual({
      status: 'open',
      urgency: 'routine',
      status_timeline: [],
      lifecycle_version: 0,
    });
  });

  // ===================================================================
  // Grants: both RPCs revoked from anon
  // ===================================================================

  test('anon cannot invoke either work-order RPC (grants revoked from anon)', async () => {
    const woId = await org.seedWorkOrder({ status: 'open' });

    const audited = await org.anon.rpc('mutate_work_order_audited', {
      p_work_order_id: woId,
      p_status: 'assigned',
      p_urgency: 'urgent',
      p_vendor_id: null,
      p_set_vendor: false,
    });
    expect(audited.error).not.toBeNull();

    const lifecycle = await org.anon.rpc('mutate_work_order_lifecycle', {
      p_work_order_id: woId,
      p_action: 'assign_vendor',
      p_expected_version: 0,
      p_request_id: crypto.randomUUID(),
      p_vendor_id: org.vendorId,
      p_vendor_response: null,
    });
    expect(lifecycle.error).not.toBeNull();

    // Neither touched the row.
    const { data: after } = await org.admin
      .from('work_orders')
      .select('status, vendor_id, lifecycle_version')
      .eq('id', woId)
      .single();
    expect(after?.status).toBe('open');
    expect(after?.vendor_id).toBeNull();
    expect(after?.lifecycle_version).toBe(0);
  });

  // ===================================================================
  // The two functions coexist with no resolution ambiguity
  // ===================================================================

  test('both RPCs resolve unambiguously on the same WO (no PGRST203)', async () => {
    const woId = await org.seedWorkOrder({ status: 'open', urgency: 'routine' });

    // Urgency-only edit via the Wave 2 path.
    const audited = await org.owner.rpc('mutate_work_order_audited', {
      p_work_order_id: woId,
      p_urgency: 'urgent',
      p_status: null,
      p_vendor_id: null,
      p_set_vendor: false,
    });
    expect(audited.error?.code).not.toBe('PGRST203');
    expect(audited.error).toBeNull();

    // Vendor lifecycle via the Wave 5 path, same WO.
    const lifecycle = await org.owner.rpc('mutate_work_order_lifecycle', {
      p_work_order_id: woId,
      p_action: 'assign_vendor',
      p_expected_version: 1,
      p_request_id: crypto.randomUUID(),
      p_vendor_id: org.vendorId,
      p_vendor_response: null,
    });
    expect(lifecycle.error?.code).not.toBe('PGRST203');
    expect(lifecycle.error).toBeNull();
    expect(lifecycle.data).toMatchObject({ status: 'assigned', vendorId: org.vendorId });

    // Both paths landed: urgency from Wave 2, status/vendor from Wave 5.
    const { data: after } = await org.admin
      .from('work_orders')
      .select('status, urgency, vendor_id')
      .eq('id', woId)
      .single();
    expect(after).toMatchObject({
      status: 'assigned',
      urgency: 'urgent',
      vendor_id: org.vendorId,
    });
  });
});
