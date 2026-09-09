import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database, Json } from '@/types/database';
import { runDurableToolInvocation } from '../tool-invocations';

describe('runDurableToolInvocation', () => {
  it('lets one of 55 concurrent retries execute and replays one canonical result', async () => {
    let claimed = false;
    let terminal: { status: string; canonical_result: Json | null; http_status: number | null } = {
      status: 'processing', canonical_result: null, http_status: null,
    };
    const rpc = vi.fn(async (name: string, args: Record<string, unknown>) => {
      if (name === 'claim_retell_tool_invocation') {
        if (!claimed) {
          claimed = true;
          return { data: { id: 'inv-1', claimed: true, claim_token: 'token-1', claim_generation: 1, ...terminal }, error: null };
        }
        return { data: { id: 'inv-1', claimed: false, claim_token: null, ...terminal }, error: null };
      }
      if (name === 'renew_retell_tool_invocation_lease') return { data: true, error: null };
      terminal = {
        status: args.p_status as string,
        canonical_result: args.p_canonical_result as Json,
        http_status: args.p_http_status as number,
      };
      return { data: { id: 'inv-1', ...terminal }, error: null };
    });
    const db = {
      rpc,
      from: () => ({
        select: () => ({
          eq: () => ({
            single: async () => ({ data: terminal, error: null }),
          }),
        }),
      }),
    } as unknown as SupabaseClient<Database>;
    const execute = vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
      return { body: { work_order_id: 'wo-1', status: 'open' } };
    });

    const results = await Promise.all(Array.from({ length: 55 }, () =>
      runDurableToolInvocation({
        db, organizationId: 'org-1', callId: 'call-1', toolName: 'create_work_order',
        idempotencyKey: 'idem-1', requestHash: 'idem-1', execute,
      }),
    ));

    expect(execute).toHaveBeenCalledTimes(1);
    expect(new Set(results.map((result) => JSON.stringify(result.body)))).toEqual(
      new Set([JSON.stringify({ work_order_id: 'wo-1', status: 'open' })]),
    );
    expect(results.filter((result) => result.replayed)).toHaveLength(54);
  });

  it('persists and replays retryable failure instead of rerunning it', async () => {
    let terminal: { status: string; canonical_result: Json | null; http_status: number | null } = {
      status: 'processing', canonical_result: null, http_status: null,
    };
    let claimed = false;
    const db = {
      rpc: async (name: string, args: Record<string, unknown>) => {
        if (name === 'claim_retell_tool_invocation') {
          if (!claimed) {
            claimed = true;
            return { data: { id: 'inv-2', claimed: true, claim_token: 'token-2', claim_generation: 1, ...terminal }, error: null };
          }
          return { data: { id: 'inv-2', claimed: false, claim_token: null, ...terminal }, error: null };
        }
        if (name === 'renew_retell_tool_invocation_lease') return { data: true, error: null };
        terminal = { status: args.p_status as string, canonical_result: args.p_canonical_result as Json, http_status: args.p_http_status as number };
        return { data: { id: 'inv-2', ...terminal }, error: null };
      },
      from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: terminal, error: null }) }) }) }),
    } as unknown as SupabaseClient<Database>;
    const execute = vi.fn(async () => ({
      body: { error: 'provider failed', retryable: true }, httpStatus: 502,
      outcome: 'failed' as const, retryable: true,
    }));

    const first = await runDurableToolInvocation({ db, organizationId: 'org-1', callId: 'call-2', toolName: 'send_sms_followup', idempotencyKey: 'idem-2', requestHash: 'idem-2', execute });
    const replay = await runDurableToolInvocation({ db, organizationId: 'org-1', callId: 'call-2', toolName: 'send_sms_followup', idempotencyKey: 'idem-2', requestHash: 'idem-2', execute });

    expect(execute).toHaveBeenCalledTimes(1);
    expect(first.httpStatus).toBe(502);
    expect(replay).toMatchObject({ httpStatus: 502, replayed: true, body: first.body });
  });

  it('does not start execution when observed lease renewal transiently fails', async () => {
    const rpc = vi.fn(async (name: string) => {
      if (name === 'claim_retell_tool_invocation') return {
        data: { id: 'inv-renew-fail', claimed: true, claim_token: 'token-1',
          claim_generation: 1, status: 'processing', canonical_result: null, http_status: null }, error: null,
      };
      if (name === 'renew_retell_tool_invocation_lease') return {
        data: null, error: { message: 'temporary database failure' },
      };
      throw new Error(`unexpected RPC ${name}`);
    });
    const db = { rpc } as unknown as SupabaseClient<Database>;
    const execute = vi.fn(async () => ({ body: { sent: true } }));

    const result = await runDurableToolInvocation({ db, organizationId: 'org-1',
      callId: 'call-renew-fail', toolName: 'send_sms_followup', idempotencyKey: 'idem',
      requestHash: 'hash', execute });

    expect(result).toMatchObject({ httpStatus: 409, replayed: false,
      body: { error: 'invocation ownership uncertain', retryable: true } });
    expect(execute).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalledWith('complete_retell_tool_invocation', expect.anything());
  });

  it('stops a multi-step side effect when renewal fails after its durable intent', async () => {
    let renewals = 0;
    const steps: string[] = [];
    const rpc = vi.fn(async (name: string) => {
      if (name === 'claim_retell_tool_invocation') return {
        data: { id: 'inv-mid-flight', claimed: true, claim_token: 'token-1', claim_generation: 1,
          status: 'processing', canonical_result: null, http_status: null }, error: null,
      };
      if (name === 'renew_retell_tool_invocation_lease') {
        renewals += 1;
        return renewals === 1
          ? { data: true, error: null }
          : { data: null, error: { message: 'transient renewal failure' } };
      }
      throw new Error(`unexpected RPC ${name}`);
    });
    const db = { rpc } as unknown as SupabaseClient<Database>;
    const result = await runDurableToolInvocation({ db, organizationId: 'org-1',
      callId: 'call-mid-flight', toolName: 'send_sms_followup', idempotencyKey: 'idem',
      requestHash: 'hash', execute: async (ownership) => {
        steps.push('durable-intent');
        await ownership.assertOwned();
        steps.push('external-send');
        return { body: { sent: true } };
      } });

    expect(steps).toEqual(['durable-intent']);
    expect(result).toMatchObject({ httpStatus: 409,
      body: { reconciliation_required: true, retryable: true } });
    expect(rpc).not.toHaveBeenCalledWith('complete_retell_tool_invocation', expect.anything());
  });

  it('fences a stale original after takeover so only the current owner performs and completes', async () => {
    let generation = 1;
    let claimedOnce = false;
    let releaseOriginal!: () => void;
    const originalPaused = new Promise<void>((resolve) => { releaseOriginal = resolve; });
    const sends: string[] = [];
    const completions: number[] = [];
    const rpc = vi.fn(async (name: string, rpcArgs: Record<string, unknown>) => {
      if (name === 'claim_retell_tool_invocation') {
        if (!claimedOnce) {
          claimedOnce = true;
          return { data: { id: 'inv-takeover', claimed: true, takeover: false,
            claim_token: 'token-1', claim_generation: 1, status: 'processing',
            canonical_result: null, http_status: null }, error: null };
        }
        return { data: { id: 'inv-takeover', claimed: true, takeover: true,
          claim_token: 'token-2', claim_generation: 2, status: 'processing',
          canonical_result: null, http_status: null }, error: null };
      }
      if (name === 'renew_retell_tool_invocation_lease') {
        return { data: rpcArgs.p_claim_generation === generation, error: null };
      }
      if (name === 'complete_retell_tool_invocation') {
        completions.push(rpcArgs.p_claim_generation as number);
        return { data: { id: 'inv-takeover', status: 'completed',
          canonical_result: rpcArgs.p_canonical_result, http_status: 200 }, error: null };
      }
      throw new Error(`unexpected RPC ${name}`);
    });
    const db = { rpc } as unknown as SupabaseClient<Database>;
    const original = runDurableToolInvocation({ db, organizationId: 'org-1', callId: 'call-takeover',
      toolName: 'send_sms_followup', idempotencyKey: 'idem', requestHash: 'hash',
      execute: async (ownership) => {
        await originalPaused;
        await ownership.assertOwned();
        sends.push('stale');
        return { body: { sent: true } };
      } });
    await vi.waitFor(() => expect(rpc).toHaveBeenCalledWith(
      'renew_retell_tool_invocation_lease', expect.objectContaining({ p_claim_generation: 1 }),
    ));
    generation = 2;
    const winner = runDurableToolInvocation({ db, organizationId: 'org-1', callId: 'call-takeover',
      toolName: 'send_sms_followup', idempotencyKey: 'idem', requestHash: 'hash',
      execute: async (ownership) => {
        await ownership.assertOwned();
        sends.push('winner');
        return { body: { sent: true } };
      } });
    releaseOriginal();
    const [staleResult, winnerResult] = await Promise.all([original, winner]);

    expect(sends).toEqual(['winner']);
    expect(completions).toEqual([2]);
    expect(staleResult.httpStatus).toBe(409);
    expect(winnerResult.httpStatus).toBe(200);
  });
});
