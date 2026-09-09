/**
 * Wave 5 `mutate_work_order_lifecycle` — concurrency + idempotency contract.
 *
 * Companion to `role-matrix.spec.ts`. Exercises the four distinct DB-level
 * outcomes the frozen contract enumerates, driven straight through the RPC as
 * a signed-in owner (no browser, no server), so the guarantees are proven at
 * the data layer where they live:
 *
 *   (a) exact retry (same request_id + same payload) AFTER lifecycle_version
 *       advanced → replays the stored canonical result verbatim, applied once
 *       (no re-apply, no extra version bump, no extra ledger row).
 *   (b) same request_id + a DIFFERENT payload → idempotency_conflict (22000),
 *       and this wins over the stale check (it is evaluated first).
 *   (c) new request_id + a stale expected_version → stale_write (55000); the
 *       first writer's state is preserved, and the error returns promptly.
 *   (d) two DISTINCT simultaneous transitions from the same version → exactly
 *       one succeeds under the FOR UPDATE row lock, the other gets stale_write.
 *
 * Plus the guardrails: manager/va are denied (42501) on the lifecycle RPC, and
 * record_response against a WO with no vendor is rejected (22000).
 *
 * NOTE: (c) and (d) were previously quarantined because `stale_write` was raised
 * as SQLSTATE 40001 (serialization_failure), which PostgREST auto-retries; with
 * the function holding a FOR UPDATE lock the retry self-contended and the request
 * hung to a gateway timeout. `stale_write` now raises 55000
 * (object_not_in_prerequisite_state), a non-retryable code, so the stale path
 * returns promptly — (c) uses a five-second bound, still far below the
 * historic 30–60 second gateway hang.
 *
 * The idempotency ledger (`work_order_mutation_requests`) is readable only by
 * service_role, so the admin client asserts "applied once" via row counts.
 *
 * Skipped when the Supabase env vars are missing (same contract as rls.spec.ts).
 */

import { expect, test } from '@playwright/test';

import { HAVE_SUPABASE, provisionLifecycleOrg, type LifecycleOrg } from './lifecycle-fixture';

/** A distinct v4-ish request id per call (crypto.randomUUID, like the UI). */
function reqId(): string {
  return crypto.randomUUID();
}

/** Count ledger rows for a WO (service_role only). */
async function ledgerCount(org: LifecycleOrg, woId: string): Promise<number> {
  const { count, error } = await org.admin
    .from('work_order_mutation_requests')
    .select('*', { count: 'exact', head: true })
    .eq('work_order_id', woId);
  if (error) throw new Error(`ledger count failed: ${error.message}`);
  return count ?? -1;
}

/** Read the mutable lifecycle columns for a WO via admin (bypasses RLS). */
async function readWo(org: LifecycleOrg, woId: string) {
  const { data, error } = await org.admin
    .from('work_orders')
    .select('status, vendor_id, vendor_response, vendor_assigned_at, vendor_responded_at, reviewed_at, lifecycle_version')
    .eq('id', woId)
    .single();
  if (error || !data) throw new Error(`read wo failed: ${error?.message ?? 'no row'}`);
  return data;
}

test.describe('mutate_work_order_lifecycle: concurrency + idempotency', () => {
  test.describe.configure({ mode: 'serial' });
  test.skip(
    !HAVE_SUPABASE,
    'Skipped: set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and anon key to run',
  );

  let org: LifecycleOrg;
  let foreignOrg: LifecycleOrg;

  test.beforeAll(async () => {
    test.setTimeout(180_000);
    org = await provisionLifecycleOrg();
    foreignOrg = await provisionLifecycleOrg();
  });

  test.afterAll(async () => {
    if (org) {
      await org.teardown();
      await org.verifyClean();
    }
    if (foreignOrg) {
      await foreignOrg.teardown();
      await foreignOrg.verifyClean();
    }
  });

  // ===================================================================
  // (a) exact retry replays the canonical result, applied once
  // ===================================================================

  test('(a) exact retry after version advanced replays result and applies once', async () => {
    const woId = await org.seedWorkOrder({ status: 'open' });
    const reqA = reqId();

    // First write: assign a vendor. version 0 -> 1.
    const first = await org.owner.rpc('mutate_work_order_lifecycle', {
      p_work_order_id: woId,
      p_action: 'assign_vendor',
      p_expected_version: 0,
      p_request_id: reqA,
      p_vendor_id: org.vendorId,
      p_vendor_response: null,
    });
    expect(first.error).toBeNull();
    const r1 = first.data as Record<string, unknown>;
    expect(r1).toMatchObject({
      changed: true,
      status: 'assigned',
      vendorId: org.vendorId,
      lifecycleVersion: 1,
    });

    // Advance the row with an UNRELATED transition so the retry's
    // expected_version (0) is now stale. version 1 -> 2.
    const advance = await org.owner.rpc('mutate_work_order_lifecycle', {
      p_work_order_id: woId,
      p_action: 'record_response',
      p_expected_version: 1,
      p_request_id: reqId(),
      p_vendor_id: null,
      p_vendor_response: 'accepted',
    });
    expect(advance.error).toBeNull();
    expect(await ledgerCount(org, woId)).toBe(2);

    // Exact retry of reqA with the SAME payload: idempotency replay runs BEFORE
    // the stale check, so this must NOT be a stale_write — it replays r1.
    const retry = await org.owner.rpc('mutate_work_order_lifecycle', {
      p_work_order_id: woId,
      p_action: 'assign_vendor',
      p_expected_version: 0,
      p_request_id: reqA,
      p_vendor_id: org.vendorId,
      p_vendor_response: null,
    });
    expect(retry.error).toBeNull();
    // Byte-for-byte the stored canonical result.
    expect(retry.data).toEqual(r1);

    // Applied once: the replay bumped nothing and inserted no ledger row, and
    // the DB still reflects the advance (vendor_response accepted), NOT a
    // re-applied assign (which would have reset vendor_response to null).
    const after = await readWo(org, woId);
    expect(after.lifecycle_version).toBe(2);
    expect(after.vendor_response).toBe('accepted');
    expect(after.vendor_id).toBe(org.vendorId);
    expect(after.vendor_assigned_at).not.toBeNull();
    expect(await ledgerCount(org, woId)).toBe(2);
  });

  // ===================================================================
  // (b) same request_id + different payload -> idempotency_conflict
  // ===================================================================

  test('(b) same request_id with a different payload is an idempotency_conflict', async () => {
    const woId = await org.seedWorkOrder({ status: 'open' });
    const reqB = reqId();

    // Record a first assign under reqB. version 0 -> 1.
    const first = await org.owner.rpc('mutate_work_order_lifecycle', {
      p_work_order_id: woId,
      p_action: 'assign_vendor',
      p_expected_version: 0,
      p_request_id: reqB,
      p_vendor_id: org.vendorId,
      p_vendor_response: null,
    });
    expect(first.error).toBeNull();

    // Replay reqB with a DIFFERENT payload (different vendor): idempotency check
    // runs first and the hash mismatch is a conflict (22000).
    const conflict = await org.owner.rpc('mutate_work_order_lifecycle', {
      p_work_order_id: woId,
      p_action: 'assign_vendor',
      p_expected_version: 1,
      p_request_id: reqB,
      p_vendor_id: org.vendorId2,
      p_vendor_response: null,
    });
    expect(conflict.error?.code).toBe('22000');
    expect(conflict.error?.message ?? '').toContain('idempotency_conflict');

    // Row unchanged (still the first vendor, still version 1, one ledger row).
    const after = await readWo(org, woId);
    expect(after.vendor_id).toBe(org.vendorId);
    expect(after.lifecycle_version).toBe(1);
    expect(await ledgerCount(org, woId)).toBe(1);
  });

  // ===================================================================
  // (c) new request_id + stale expected_version -> stale_write (prompt)
  //
  // `stale_write` raises SQLSTATE 55000 (object_not_in_prerequisite_state), a
  // NON-retryable code, so PostgREST returns it immediately instead of retrying
  // into the FOR UPDATE lock. We assert both the code and that it lands in well
  // under five seconds (the pre-fix path hung ~30-60s to a gateway timeout).
  // ===================================================================

  test('(c) new request_id with a stale expected_version is a stale_write', async () => {
    const woId = await org.seedWorkOrder({ status: 'open' });

    // First writer advances the row. version 0 -> 1.
    const first = await org.owner.rpc('mutate_work_order_lifecycle', {
      p_work_order_id: woId,
      p_action: 'assign_vendor',
      p_expected_version: 0,
      p_request_id: reqId(),
      p_vendor_id: org.vendorId,
      p_vendor_response: null,
    });
    expect(first.error).toBeNull();
    const before = await readWo(org, woId);

    // A second writer that still thinks it is at version 0 is a stale_write.
    const startedAt = Date.now();
    const stale = await org.owner.rpc('mutate_work_order_lifecycle', {
      p_work_order_id: woId,
      p_action: 'cancel',
      p_expected_version: 0, // current is 1
      p_request_id: reqId(), // fresh id -> no idempotency short-circuit
      p_vendor_id: null,
      p_vendor_response: null,
    });
    const elapsedMs = Date.now() - startedAt;
    expect(stale.error?.code).toBe('55000');
    expect(stale.error?.message ?? '').toContain('stale_write');
    // The whole point of the fix: the stale path must not hang on a retry.
    expect(elapsedMs).toBeLessThan(5_000);

    // First writer preserved: nothing about the row moved.
    const after = await readWo(org, woId);
    expect(after).toEqual(before);
  });

  // ===================================================================
  // (d) two simultaneous transitions from the same version -> one wins
  //
  // Same 55000 fix as (c): the loser raises stale_write with a non-retryable
  // code, so it returns promptly instead of PostgREST retrying into the FOR
  // UPDATE lock and hanging both requests. Exactly one write lands.
  // ===================================================================

  test('(d) two concurrent transitions from one version: exactly one succeeds', async () => {
    // Seed a fresh WO already assigned to a vendor at version 0 so BOTH racing
    // actions (start_work, record_response) are valid from the same state and
    // each is a real change (so the winner bumps the version).
    const woId = await org.seedWorkOrder({
      status: 'assigned',
      vendor_id: org.vendorId,
      vendor_assigned_at: new Date().toISOString(),
      vendor_response: 'accepted',
      vendor_responded_at: new Date().toISOString(),
      lifecycle_version: 0,
    });

    const [a, b] = await Promise.all([
      org.owner.rpc('mutate_work_order_lifecycle', {
        p_work_order_id: woId,
        p_action: 'start_work',
        p_expected_version: 0,
        p_request_id: reqId(),
        p_vendor_id: null,
        p_vendor_response: null,
      }),
      org.owner.rpc('mutate_work_order_lifecycle', {
        p_work_order_id: woId,
        p_action: 'record_response',
        p_expected_version: 0,
        p_request_id: reqId(),
        p_vendor_id: null,
        p_vendor_response: 'declined',
      }),
    ]);

    const errors = [a.error, b.error];
    const successes = errors.filter((e) => e === null);
    const staleWrites = errors.filter((e) => e?.code === '55000');
    expect(successes).toHaveLength(1);
    expect(staleWrites).toHaveLength(1);

    // Exactly one write landed: version advanced by exactly 1, one ledger row.
    const after = await readWo(org, woId);
    expect(after.lifecycle_version).toBe(1);
    expect(await ledgerCount(org, woId)).toBe(1);
  });

  // ===================================================================
  // Role denial on the lifecycle RPC (42501)
  // ===================================================================

  for (const who of ['manager', 'va'] as const) {
    test(`${who} cannot invoke the lifecycle RPC (42501)`, async () => {
      const woId = await org.seedWorkOrder({ status: 'open' });
      const client = who === 'manager' ? org.manager : org.va;
      const { error } = await client.rpc('mutate_work_order_lifecycle', {
        p_work_order_id: woId,
        p_action: 'assign_vendor',
        p_expected_version: 0,
        p_request_id: reqId(),
        p_vendor_id: org.vendorId,
        p_vendor_response: null,
      });
      expect(error?.code).toBe('42501');

      // Nothing was written.
      const after = await readWo(org, woId);
      expect(after.status).toBe('open');
      expect(after.vendor_id).toBeNull();
      expect(after.lifecycle_version).toBe(0);
      expect(await ledgerCount(org, woId)).toBe(0);
    });
  }

  // ===================================================================
  // record_response without a vendor is rejected (22000)
  // ===================================================================

  test('record_response is rejected when the WO has no vendor', async () => {
    // Admin-seed the guarded (RPC-unreachable) state assigned + vendor_id NULL
    // to hit the vendor-null half of the record_response guard directly.
    const woId = await org.seedWorkOrder({
      status: 'assigned',
      vendor_id: null,
      lifecycle_version: 0,
    });
    const { error } = await org.owner.rpc('mutate_work_order_lifecycle', {
      p_work_order_id: woId,
      p_action: 'record_response',
      p_expected_version: 0,
      p_request_id: reqId(),
      p_vendor_id: null,
      p_vendor_response: 'accepted',
    });
    expect(error?.code).toBe('22000');
    expect(error?.message ?? '').toContain('record_response');

    const after = await readWo(org, woId);
    expect(after.vendor_response).toBeNull();
    expect(after.lifecycle_version).toBe(0);
  });

  test('NULL expected version is rejected at the database boundary', async () => {
    const woId = await org.seedWorkOrder({ status: 'open' });
    const { error } = await org.owner.rpc('mutate_work_order_lifecycle', {
      p_work_order_id: woId,
      p_action: 'assign_vendor',
      p_expected_version: null as never,
      p_request_id: reqId(),
      p_vendor_id: org.vendorId,
      p_vendor_response: null,
    });
    expect(error?.code).toBe('22000');
    expect(error?.message ?? '').toContain('expected version is required');
    expect((await readWo(org, woId)).lifecycle_version).toBe(0);
  });

  test('foreign-org work order is denied by the SECURITY DEFINER RPC', async () => {
    const foreignWoId = await foreignOrg.seedWorkOrder({ status: 'open' });
    const { error } = await org.owner.rpc('mutate_work_order_lifecycle', {
      p_work_order_id: foreignWoId,
      p_action: 'assign_vendor',
      p_expected_version: 0,
      p_request_id: reqId(),
      p_vendor_id: org.vendorId,
      p_vendor_response: null,
    });
    expect(error?.code).toBe('42501');
    expect((await readWo(foreignOrg, foreignWoId)).lifecycle_version).toBe(0);
  });

  test('cross-org vendor assignment is denied by the SECURITY DEFINER RPC', async () => {
    const woId = await org.seedWorkOrder({ status: 'open' });
    const { error } = await org.owner.rpc('mutate_work_order_lifecycle', {
      p_work_order_id: woId,
      p_action: 'assign_vendor',
      p_expected_version: 0,
      p_request_id: reqId(),
      p_vendor_id: foreignOrg.vendorId,
      p_vendor_response: null,
    });
    expect(error?.code).toBe('42501');
    expect((await readWo(org, woId)).vendor_id).toBeNull();
  });

  for (const response of ['declined', 'no_response'] as const) {
    test(`${response} vendor response cannot start work`, async () => {
      const respondedAt = new Date().toISOString();
      const woId = await org.seedWorkOrder({
        status: 'assigned',
        vendor_id: org.vendorId,
        vendor_assigned_at: respondedAt,
        vendor_response: response,
        vendor_responded_at: respondedAt,
      });
      const { error } = await org.owner.rpc('mutate_work_order_lifecycle', {
        p_work_order_id: woId,
        p_action: 'start_work',
        p_expected_version: 0,
        p_request_id: reqId(),
        p_vendor_id: null,
        p_vendor_response: null,
      });
      expect(error?.code).toBe('22000');
      expect(error?.message ?? '').toContain('accepted vendor response');
      expect((await readWo(org, woId)).status).toBe('assigned');
    });
  }

  test('reviewed completed work cannot be reassigned', async () => {
    const woId = await org.seedWorkOrder({
      status: 'completed',
      vendor_id: org.vendorId,
      reviewed_at: new Date().toISOString(),
    });
    const { error } = await org.owner.rpc('mutate_work_order_lifecycle', {
      p_work_order_id: woId,
      p_action: 'reassign_vendor',
      p_expected_version: 0,
      p_request_id: reqId(),
      p_vendor_id: org.vendorId2,
      p_vendor_response: null,
    });
    expect(error?.code).toBe('22000');
    expect((await readWo(org, woId)).reviewed_at).not.toBeNull();
  });

  test('duplicate vendor response is a truthful no-op with a stable timestamp', async () => {
    const respondedAt = new Date().toISOString();
    const woId = await org.seedWorkOrder({
      status: 'assigned',
      vendor_id: org.vendorId,
      vendor_assigned_at: respondedAt,
      vendor_response: 'accepted',
      vendor_responded_at: respondedAt,
    });
    const before = await readWo(org, woId);
    const { data, error } = await org.owner.rpc('mutate_work_order_lifecycle', {
      p_work_order_id: woId,
      p_action: 'record_response',
      p_expected_version: 0,
      p_request_id: reqId(),
      p_vendor_id: null,
      p_vendor_response: 'accepted',
    });
    expect(error).toBeNull();
    expect(data).toMatchObject({
      changed: false,
      lifecycleVersion: 0,
    });
    const result = data as { vendorRespondedAt: string };
    expect(Date.parse(result.vendorRespondedAt)).toBe(
      Date.parse(before.vendor_responded_at!),
    );
    expect(await readWo(org, woId)).toEqual(before);
  });

  test('same-vendor reassignment is deterministically rejected', async () => {
    const assignedAt = new Date().toISOString();
    const woId = await org.seedWorkOrder({
      status: 'assigned',
      vendor_id: org.vendorId,
      vendor_assigned_at: assignedAt,
      vendor_response: 'declined',
      vendor_responded_at: assignedAt,
    });
    const { error } = await org.owner.rpc('mutate_work_order_lifecycle', {
      p_work_order_id: woId,
      p_action: 'reassign_vendor',
      p_expected_version: 0,
      p_request_id: reqId(),
      p_vendor_id: org.vendorId,
      p_vendor_response: null,
    });
    expect(error?.code).toBe('22000');
    expect(error?.message ?? '').toContain('different vendor');
    expect((await readWo(org, woId)).lifecycle_version).toBe(0);
  });

  test('audited creation succeeds for owner and denies manager, VA, anon, and foreign unit', async () => {
    const ownerCreate = await org.owner.rpc('create_work_order_audited', {
      p_unit_id: org.unitId,
      p_tenant_id: null,
      p_category: 'plumbing',
      p_urgency: 'routine',
      p_description: 'Audited lifecycle fixture creation',
    });
    expect(ownerCreate.error).toBeNull();
    const ownerResult = ownerCreate.data as { id: string };
    const { data: created, error: createdError } = await org.admin
      .from('work_orders')
      .select('status, vendor_id, reviewed_at, lifecycle_version, status_timeline')
      .eq('id', ownerResult.id)
      .single();
    expect(createdError).toBeNull();
    expect(created).toMatchObject({
      status: 'open',
      vendor_id: null,
      reviewed_at: null,
      lifecycle_version: 0,
    });
    expect(created?.status_timeline).toEqual([
      expect.objectContaining({ source: 'lifecycle', actor_role: 'owner', status: 'open' }),
    ]);

    for (const [who, client] of [
      ['manager', org.manager],
      ['va', org.va],
      ['anon', org.anon],
    ] as const) {
      const denied = await client.rpc('create_work_order_audited', {
        p_unit_id: org.unitId,
        p_tenant_id: null,
        p_category: 'plumbing',
        p_urgency: 'routine',
        p_description: `${who} denied creation`,
      });
      expect(denied.error, `${who} creation should fail`).not.toBeNull();
    }

    const foreign = await org.owner.rpc('create_work_order_audited', {
      p_unit_id: foreignOrg.unitId,
      p_tenant_id: null,
      p_category: 'plumbing',
      p_urgency: 'routine',
      p_description: 'Foreign unit denied creation',
    });
    expect(foreign.error?.code).toBe('P0002');
  });

  test('raw authenticated lifecycle INSERT and DELETE are denied for owner, manager, and VA', async () => {
    for (const [who, client] of [
      ['owner', org.owner],
      ['manager', org.manager],
      ['va', org.va],
    ] as const) {
      const insert = await client.from('work_orders').insert({
        organization_id: org.orgId,
        unit_id: org.unitId,
        category: 'plumbing',
        urgency: 'routine',
        status: 'completed',
        reviewed_at: new Date().toISOString(),
        status_timeline: [{ source: 'fabricated', actor: who }],
      }).select('id');
      expect(insert.error, `${who} direct insert should fail`).not.toBeNull();

      const woId = await org.seedWorkOrder({ status: 'open' });
      const deletion = await client.from('work_orders').delete().eq('id', woId).select('id');
      expect(deletion.error, `${who} direct delete should fail`).not.toBeNull();
      expect((await readWo(org, woId)).status).toBe('open');
    }
  });

  test('cross-org direct INSERT and DELETE are denied', async () => {
    const foreignWoId = await foreignOrg.seedWorkOrder({ status: 'open' });
    const insert = await org.owner.from('work_orders').insert({
      organization_id: foreignOrg.orgId,
      unit_id: foreignOrg.unitId,
      category: 'plumbing',
      urgency: 'routine',
      status: 'completed',
      reviewed_at: new Date().toISOString(),
      status_timeline: [{ source: 'fabricated' }],
    }).select('id');
    expect(insert.error).not.toBeNull();
    const deletion = await org.owner.from('work_orders').delete().eq('id', foreignWoId).select('id');
    expect(deletion.error).not.toBeNull();
    expect((await readWo(foreignOrg, foreignWoId)).status).toBe('open');
  });
});
