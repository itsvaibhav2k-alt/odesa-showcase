/**
 * Unit tests for the shared `createWorkOrder` domain command.
 *
 * The headline: the active-lease lookup is double-keyed on
 * (tenant_id, organization_id) — a poisoned same-tenant lease in another
 * org must never resolve — and the first status_timeline entry carries
 * the caller's source + extras byte-for-byte (Retell compatibility).
 */
import { describe, expect, it } from 'vitest';

import type { Database } from '@/types/database';
import type { SupabaseClient } from '@supabase/supabase-js';

import { createWorkOrder, workOrderArgsSchema } from '@/lib/work-orders/create';

type Row = Record<string, unknown>;

interface StubState {
  leases: Row[];
  insertedPayloads: Row[];
  insertError: { message: string } | null;
}

function buildDb(state: StubState): SupabaseClient<Database> {
  return {
    from(table: string) {
      if (table === 'leases') {
        let rows = [...state.leases];
        const chain = {
          select: () => chain,
          eq(col: string, value: unknown) {
            rows = rows.filter((r) => r[col] === value);
            return chain;
          },
          order(col: string, opts?: { ascending?: boolean }) {
            rows = [...rows].sort((a, b) =>
              (a[col] as string) < (b[col] as string)
                ? (opts?.ascending === false ? 1 : -1)
                : (opts?.ascending === false ? -1 : 1),
            );
            return chain;
          },
          limit(n: number) {
            rows = rows.slice(0, n);
            return chain;
          },
          maybeSingle: () =>
            Promise.resolve({ data: rows[0] ?? null, error: null }),
        };
        return chain;
      }
      // work_orders insert path
      return {
        insert(payload: Row) {
          state.insertedPayloads.push(payload);
          return {
            select: () => ({
              single: () =>
                Promise.resolve(
                  state.insertError
                    ? { data: null, error: state.insertError }
                    : { data: { id: 'wo-1', status: 'open' }, error: null },
                ),
            }),
          };
        },
      };
    },
  } as unknown as SupabaseClient<Database>;
}

const BASE_INPUT = {
  organizationId: 'org-1',
  tenantId: 'tenant-a',
  description: 'Sink is leaking',
  category: 'plumbing',
  urgency: 'urgent',
  source: 'portal',
} as const;

function freshState(): StubState {
  return {
    leases: [
      {
        id: 'lease-a',
        unit_id: 'unit-a',
        tenant_id: 'tenant-a',
        organization_id: 'org-1',
        status: 'active',
        start_date: '2025-08-01',
      },
      // POISON: same tenant, WRONG org, newer start_date. An org-blind
      // lookup (the old Retell route's bug) would pick this unit.
      {
        id: 'lease-poison',
        unit_id: 'unit-poison',
        tenant_id: 'tenant-a',
        organization_id: 'org-2',
        status: 'active',
        start_date: '2026-05-01',
      },
    ],
    insertedPayloads: [],
    insertError: null,
  };
}

describe('createWorkOrder', () => {
  it('should resolve the unit from the org-scoped active lease, never the cross-org poison', async () => {
    const state = freshState();

    const result = await createWorkOrder(buildDb(state), BASE_INPUT);

    expect(result).toEqual({ ok: true, workOrderId: 'wo-1', status: 'open' });
    expect(state.insertedPayloads[0]).toMatchObject({
      organization_id: 'org-1',
      tenant_id: 'tenant-a',
      unit_id: 'unit-a', // not unit-poison
      status: 'open',
    });
  });

  it('should return active_lease_not_found without inserting when no lease matches', async () => {
    const state = freshState();
    state.leases = state.leases.filter((l) => l.id !== 'lease-a');

    const result = await createWorkOrder(buildDb(state), BASE_INPUT);

    expect(result).toEqual({ ok: false, error: 'active_lease_not_found' });
    expect(state.insertedPayloads).toHaveLength(0);
  });

  it('should stamp the first timeline entry with source and caller extras in Retell shape', async () => {
    const state = freshState();

    await createWorkOrder(buildDb(state), {
      ...BASE_INPUT,
      source: 'retell_voice',
      retellArtifactKey: 'call-1:create_work_order:key',
      nowIso: '2026-08-06T10:00:00.000Z',
      timelineExtra: { call_id: 'call-1', shadow_queued: true },
    });

    expect(state.insertedPayloads[0]).toMatchObject({
      retell_artifact_key: 'call-1:create_work_order:key',
      status_timeline: [
        {
          at: '2026-08-06T10:00:00.000Z',
          status: 'open',
          source: 'retell_voice',
          call_id: 'call-1',
          shadow_queued: true,
        },
      ],
    });
  });

  it('should default retell_artifact_key to null and stamp portal source for portal callers', async () => {
    const state = freshState();

    await createWorkOrder(buildDb(state), BASE_INPUT);

    const payload = state.insertedPayloads[0];
    expect(payload.retell_artifact_key).toBeNull();
    expect(payload.status_timeline).toEqual([
      expect.objectContaining({ status: 'open', source: 'portal' }),
    ]);
  });

  it('should run beforeInsert after the lease resolves and before the insert', async () => {
    const state = freshState();
    const calls: string[] = [];

    await createWorkOrder(buildDb(state), {
      ...BASE_INPUT,
      beforeInsert: async () => {
        calls.push(`beforeInsert:inserts=${state.insertedPayloads.length}`);
      },
    });

    expect(calls).toEqual(['beforeInsert:inserts=0']);
    expect(state.insertedPayloads).toHaveLength(1);
  });

  it('should surface the insert error message instead of throwing', async () => {
    const state = freshState();
    state.insertError = { message: 'duplicate key' };

    const result = await createWorkOrder(buildDb(state), BASE_INPUT);

    expect(result).toEqual({
      ok: false,
      error: 'insert_failed',
      message: 'duplicate key',
    });
  });
});

describe('workOrderArgsSchema', () => {
  it('should default category and urgency exactly like the historical Retell schema', () => {
    const parsed = workOrderArgsSchema.parse({ description: 'leaky faucet' });

    expect(parsed).toEqual({
      description: 'leaky faucet',
      category: 'general',
      urgency: 'routine',
    });
  });

  it('should reject descriptions outside 3..2000 chars and unknown vocab', () => {
    expect(workOrderArgsSchema.safeParse({ description: 'ab' }).success).toBe(false);
    expect(
      workOrderArgsSchema.safeParse({ description: 'x'.repeat(2001) }).success,
    ).toBe(false);
    expect(
      workOrderArgsSchema.safeParse({ description: 'valid', category: 'nuclear' })
        .success,
    ).toBe(false);
  });
});
