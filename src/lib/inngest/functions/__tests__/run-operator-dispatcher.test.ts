/**
 * Unit tests for the run-operator-dispatcher Inngest function.
 *
 * Mirrors the fire-scheduled-action test surfaces:
 *   1. Registration smoke (id, event trigger, retries: 0, per-chat
 *      concurrency).
 *   2. The pure runner `runOperatorDispatcherJob` driven against a
 *      hand-rolled StepLike stub + mocked executeAgentRun.
 */

import { describe, expect, it, vi } from 'vitest';

import type { executeAgentRun } from '@/lib/agent/operator/run-executor';
import {
  runOperatorDispatcherFn,
  runOperatorDispatcherJob,
  RUN_OPERATOR_DISPATCHER_EVENT,
  RUN_OPERATOR_DISPATCHER_FN_ID,
  type StepLike,
} from '../run-operator-dispatcher';

const RUN = '00000000-0000-0000-0000-000000000100';

function makeStep(): StepLike & { ids: string[] } {
  const ids: string[] = [];
  return {
    ids,
    async run<T>(id: string, fn: () => Promise<T> | T): Promise<T> {
      ids.push(id);
      return await fn();
    },
  };
}

// ---------------------------------------------------------------------------
// Tests — registration
// ---------------------------------------------------------------------------

describe('runOperatorDispatcherFn registration', () => {
  it('exposes the expected id', () => {
    expect(runOperatorDispatcherFn.id()).toBe(RUN_OPERATOR_DISPATCHER_FN_ID);
    expect(RUN_OPERATOR_DISPATCHER_FN_ID).toBe('run-operator-dispatcher');
  });

  it('is bound to the dedicated worker app id (never the Vercel app)', () => {
    // `client` is a protected (not #private) field on InngestFunction, so
    // it is reachable at runtime; the client's `id` is public. Two services
    // syncing the same app id overwrite each other, so this must stay
    // 'odesa-operator-worker'.
    const fnClient = (
      runOperatorDispatcherFn as unknown as { client: { id: string } }
    ).client;
    expect(fnClient.id).toBe('odesa-operator-worker');
  });

  it('registers under the operator-run.requested event', () => {
    const triggers = runOperatorDispatcherFn.opts.triggers ?? [];
    const events = triggers
      .map((t) => ('event' in t ? t.event : null))
      .filter(Boolean);
    expect(events).toContain(RUN_OPERATOR_DISPATCHER_EVENT);
    expect(RUN_OPERATOR_DISPATCHER_EVENT).toBe('odesa/operator-run.requested');
  });

  it('disables retries — side effects are not idempotent', () => {
    expect(runOperatorDispatcherFn.opts.retries).toBe(0);
  });

  it('serializes runs per chat via the chatId concurrency key', () => {
    expect(runOperatorDispatcherFn.opts.concurrency).toEqual({
      key: 'event.data.chatId',
      limit: 1,
    });
  });
});

// ---------------------------------------------------------------------------
// Tests — runOperatorDispatcherJob
// ---------------------------------------------------------------------------

describe('runOperatorDispatcherJob', () => {
  it('runs the executor inside a single execute step and passes the outcome through', async () => {
    const step = makeStep();
    const executeAgentRunImpl = vi
      .fn<typeof executeAgentRun>()
      .mockResolvedValue({ kind: 'done', runId: RUN, replyText: 'hi' });

    const out = await runOperatorDispatcherJob({
      runId: RUN,
      step,
      deps: { executeAgentRunImpl },
    });

    expect(out).toEqual({ kind: 'done', runId: RUN, replyText: 'hi' });
    expect(step.ids).toEqual(['execute']);
    expect(executeAgentRunImpl).toHaveBeenCalledTimes(1);
    expect(executeAgentRunImpl).toHaveBeenCalledWith(RUN);
  });

  it('passes a skipped outcome through unchanged (duplicate delivery)', async () => {
    const step = makeStep();
    const executeAgentRunImpl = vi
      .fn<typeof executeAgentRun>()
      .mockResolvedValue({ kind: 'skipped', reason: 'not_claimed' });

    const out = await runOperatorDispatcherJob({
      runId: RUN,
      step,
      deps: { executeAgentRunImpl },
    });

    expect(out).toEqual({ kind: 'skipped', reason: 'not_claimed' });
  });

  it('propagates executor throws (Inngest marks the run failed; retries: 0 means no replay)', async () => {
    const step = makeStep();
    const executeAgentRunImpl = vi
      .fn<typeof executeAgentRun>()
      .mockRejectedValue(new Error('claim query 5xx'));

    await expect(
      runOperatorDispatcherJob({
        runId: RUN,
        step,
        deps: { executeAgentRunImpl },
      }),
    ).rejects.toThrow('claim query 5xx');
    expect(step.ids).toEqual(['execute']);
  });
});
