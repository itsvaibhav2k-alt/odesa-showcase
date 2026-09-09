import { describe, expect, it, vi } from 'vitest';

import { commitPlan } from '../commit';
import type { ImportPlan } from '../types';

const ORG_ID = '11111111-1111-4111-8111-111111111111';
const KEY = '22222222-2222-4222-8222-222222222222';
const emptyPlan: ImportPlan = {
  properties: [], units: [], tenants: [], leases: [],
};

describe('commitPlan transactional RPC boundary', () => {
  it('makes one RPC and returns its canonical result', async () => {
    const rpc = vi.fn(async (_name: string, _args: Record<string, unknown>) => ({
      data: {
        summary: {
          inserted: { properties: 1, units: 2, tenants: 2, leases: 2 },
          skipped: { properties: 0, units: 0, tenants: 0, leases: 0 },
          errors: [],
        },
        replay: false,
      },
      error: null,
    }));
    const outcome = await commitPlan({ rpc } as never, ORG_ID, 'generic', KEY, new TextEncoder().encode('csv'), emptyPlan);
    expect(outcome).toMatchObject({ ok: true, replay: false });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc.mock.calls[0][0]).toBe('commit_portfolio_import');
    expect(rpc.mock.calls[0][1]).toMatchObject({
      p_organization_id: ORG_ID,
      p_idempotency_key: KEY,
      p_source: 'generic',
      p_payload_hash: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
  });

  it('surfaces idempotency payload conflicts without claiming success', async () => {
    const rpc = vi.fn(async () => ({
      data: null,
      error: { code: '22000', message: 'idempotency key already used with a different payload' },
    }));
    await expect(commitPlan({ rpc } as never, ORG_ID, 'generic', KEY, new TextEncoder().encode('different'), emptyPlan))
      .resolves.toEqual({
        ok: false,
        error: 'idempotency key already used with a different payload',
        conflict: true,
      });
  });

  it('does not expose database detail for a failed transaction', async () => {
    const rpc = vi.fn(async () => ({
      data: null,
      error: { code: '23503', message: 'lease missing unit or tenant reference' },
    }));
    await expect(commitPlan({ rpc } as never, ORG_ID, 'generic', KEY, new TextEncoder().encode('csv'), emptyPlan))
      .resolves.toEqual({ ok: false, error: 'Import transaction failed', conflict: false });
  });

  it('returns the deterministic unit_not_vacant occupancy conflict', async () => {
    const rpc = vi.fn(async () => ({
      data: null,
      error: { code: '23505', message: 'unit_not_vacant' },
    }));
    await expect(commitPlan(
      { rpc } as never,
      ORG_ID,
      'generic',
      KEY,
      new TextEncoder().encode('csv'),
      emptyPlan,
    )).resolves.toEqual({ ok: false, error: 'unit_not_vacant', conflict: true });
  });

  it('binds the same idempotency key to raw bytes, including invalid UTF-8', async () => {
    const hashes: string[] = [];
    const rpc = vi.fn(async (_name: string, args: { p_payload_hash: string }) => {
      hashes.push(args.p_payload_hash);
      return { data: {
        summary: {
          inserted: { properties: 0, units: 0, tenants: 0, leases: 0 },
          skipped: { properties: 0, units: 0, tenants: 0, leases: 0 }, errors: [],
        }, replay: false,
      }, error: null };
    });
    await commitPlan({ rpc } as never, ORG_ID, 'generic', KEY, Uint8Array.of(0xef, 0xbf, 0xbd), emptyPlan);
    await commitPlan({ rpc } as never, ORG_ID, 'generic', KEY, Uint8Array.of(0xff), emptyPlan);
    expect(hashes).toHaveLength(2);
    expect(hashes[0]).not.toBe(hashes[1]);
  });
});
