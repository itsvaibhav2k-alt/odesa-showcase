'use client';

/**
 * useDurableChat — client side of the durable web-chat path
 * (Phase B, behind NEXT_PUBLIC_DURABLE_CHAT).
 *
 * When enabled, ChatPanel's submit no longer consumes an SSE stream.
 * Instead:
 *
 *   1. `submit` POSTs to /api/chat/runs, which inserts an
 *      `agent_runs(queued)` row + enqueues the Inngest event, and
 *      returns 202 {runId, chatId, turnId}. The pre-minted turnId is
 *      remembered as the "pending turn" so ChatPanel's realtime
 *      reducer can dedupe BY ID ONLY: skip the echoed `user` row
 *      (already optimistic), stream `assistant_ack` rows live, and
 *      write `assistant_text` into the placeholder bubble.
 *   2. A realtime subscription on `agent_runs` UPDATE (chat-scoped)
 *      settles the run: 'failed' surfaces the run error through the
 *      existing transport-error path; 'done' clears the working state
 *      (filling the placeholder from `reply_text` if the
 *      operator_chat_turns broadcast hasn't landed yet).
 *   3. POLLING FALLBACK — realtime is delivery, DB is truth. If no
 *      'running' status is observed within ~3s of enqueue, poll
 *      GET /api/chat/runs?runId= every 2.5s until terminal; the poll
 *      stops as soon as realtime delivers the terminal state.
 *   4. A 15s stall hint ("is Inngest running?") for local dev where
 *      neither Inngest nor the inline fallback picked the run up.
 *
 * Live tool-cards over realtime are explicitly out of scope for v1 —
 * they re-render on refresh.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { createBrowserClient } from '@/lib/supabase/client';

import type { ChatItem } from './types';

const POLL_START_DELAY_MS = 3_000;
const POLL_INTERVAL_MS = 2_500;
const STALL_HINT_MS = 15_000;
const STALL_HINT_TEXT = 'Odesa is still working. Your request is saved.';
/**
 * Hard watchdog for a run that enqueued but never reaches a terminal
 * status (e.g. Inngest is down, the worker crashed before writing a
 * terminal UPDATE). The stall hint is advisory only — it never
 * re-enables the composer — so without this the textarea/Send button
 * would stay disabled forever. On fire we surface a clear, retryable
 * error and release the working state.
 */
const RUN_WATCHDOG_MS = 60_000;
const RUN_WATCHDOG_TEXT =
  "Odesa didn't finish in time. Your message is saved—review this thread before trying again.";
const RUN_FAILED_TEXT =
  "Odesa couldn't finish this request. No action is shown as completed—review this thread and Owner Queue before trying again.";
const RUN_START_FAILED_TEXT =
  "Odesa couldn't start this request. Your message is still here—review it before trying again.";

type SetMessages = React.Dispatch<React.SetStateAction<ChatItem[]>>;

/** Subset of the agent_runs row the settle logic reads. */
interface AgentRunStatus {
  id: string;
  status: string;
  reply_text: string | null;
  error: string | null;
}

interface PendingDurableRun {
  runId: string;
  turnId: string;
  /** Local id of the optimistic assistant placeholder bubble. */
  assistantId: string;
  /** True once any 'running' signal arrived (realtime or poll). */
  sawRunning: boolean;
}

export interface PendingTurnRef {
  turnId: string;
  assistantId: string;
}

export interface UseDurableChatArgs {
  chatId: string;
  propertyId?: string;
  setMessages: SetMessages;
  /**
   * The panel's turn-id dedupe set (a stable Set instance). On terminal
   * the pending turnId is added so late operator_chat_turns broadcasts
   * for the settled turn don't re-render.
   */
  appliedTurnIds: Set<string>;
  onTransportError: (message: string) => void;
  setIsStreaming: (streaming: boolean) => void;
  /** Canonical global assistant uses the durable lifecycle regardless of flag. */
  forceDurable?: boolean;
}

export interface DurableChatHandle {
  /** NEXT_PUBLIC_DURABLE_CHAT === 'true'. Off → every member no-ops. */
  enabled: boolean;
  /** Non-null while the queued run has not started after ~15s. */
  stallHint: string | null;
  /** Pending-turn snapshot for ChatPanel's realtime turn reducer. */
  pendingTurn: () => PendingTurnRef | null;
  submit: (input: { message: string; assistantId: string }) => Promise<void>;
}

export function useDurableChat(args: UseDurableChatArgs): DurableChatHandle {
  const enabled =
    args.forceDurable === true ||
    process.env.NEXT_PUBLIC_DURABLE_CHAT === 'true';

  const [stallHint, setStallHint] = useState<string | null>(null);

  const pendingRef = useRef<PendingDurableRun | null>(null);
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollStartTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stallTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const watchdogTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Latest-args ref so the realtime/poll callbacks never close over a
  // stale setMessages/onTransportError without forcing re-subscribes.
  const argsRef = useRef(args);
  argsRef.current = args;

  const clearTimers = useCallback((): void => {
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
    if (pollStartTimerRef.current) {
      clearTimeout(pollStartTimerRef.current);
      pollStartTimerRef.current = null;
    }
    if (stallTimerRef.current) {
      clearTimeout(stallTimerRef.current);
      stallTimerRef.current = null;
    }
    if (watchdogTimerRef.current) {
      clearTimeout(watchdogTimerRef.current);
      watchdogTimerRef.current = null;
    }
  }, []);

  /**
   * Apply an agent_runs status observation (realtime UPDATE or poll
   * response) to the pending run. Terminal states clear the working
   * UI; 'running' only cancels the stall hint.
   */
  const settleRun = useCallback(
    (run: AgentRunStatus): void => {
      const pending = pendingRef.current;
      if (!pending || run.id !== pending.runId) return;

      if (run.status === 'running') {
        pending.sawRunning = true;
        setStallHint(null);
        return;
      }
      if (run.status !== 'done' && run.status !== 'failed') return;

      const { setMessages, setIsStreaming, onTransportError, appliedTurnIds } =
        argsRef.current;

      // Late operator_chat_turns broadcasts for this turn are dispatcher
      // bookkeeping we already rendered (or filled from reply_text below).
      appliedTurnIds.add(pending.turnId);
      pendingRef.current = null;
      clearTimers();
      setStallHint(null);

      if (run.status === 'failed') {
        // `agent_runs.error` is detailed audit evidence and may contain
        // provider/tool internals. Keep it out of customer copy.
        onTransportError(RUN_FAILED_TEXT);
        setMessages((prev) =>
          prev.map((m) =>
            m.kind === 'assistant_text' && m.id === pending.assistantId
              ? {
                  ...m,
                  // Partial provider text is not a trustworthy completion.
                  // Replace it so a fragment like "I changed the rent" can
                  // never survive beside a durable failed run.
                  body: RUN_FAILED_TEXT,
                  streaming: false,
                }
              : m,
          ),
        );
      } else {
        const replyText = run.reply_text ?? '';
        setMessages((prev) =>
          prev.map((m) =>
            m.kind === 'assistant_text' && m.id === pending.assistantId
              ? {
                  ...m,
                  // Realtime usually streamed the assistant_text row into
                  // the placeholder already; reply_text covers the race
                  // where the done UPDATE outran the turn INSERT broadcast.
                  // The terminal agent_runs row is canonical. It includes
                  // deterministic review/commit summaries in addition to the
                  // model narrative, so replace any earlier realtime fragment.
                  body: replyText.length > 0 ? replyText : m.body,
                  streaming: false,
                }
              : m,
          ),
        );
      }
      setIsStreaming(false);
    },
    [clearTimers],
  );

  const pollOnce = useCallback(
    async (runId: string): Promise<void> => {
      if (pendingRef.current?.runId !== runId) return;
      try {
        const res = await fetch(
          `/api/chat/runs?runId=${encodeURIComponent(runId)}`,
        );
        if (!res.ok) return; // transient — next tick retries
        const payload = (await res.json()) as {
          data?: { status?: string; replyText?: string | null; error?: string | null };
        };
        const data = payload.data;
        if (!data || typeof data.status !== 'string') return;
        settleRun({
          id: runId,
          status: data.status,
          reply_text: data.replyText ?? null,
          error: data.error ?? null,
        });
      } catch {
        // Transient poll failure — keep polling; the stall hint covers
        // the "nothing is happening" case for the operator.
      }
    },
    [settleRun],
  );

  const startPolling = useCallback(
    (runId: string): void => {
      if (pollIntervalRef.current) return;
      pollIntervalRef.current = setInterval(() => {
        void pollOnce(runId);
      }, POLL_INTERVAL_MS);
      void pollOnce(runId);
    },
    [pollOnce],
  );

  const submit = useCallback(
    async (input: { message: string; assistantId: string }): Promise<void> => {
      const { propertyId, setMessages, setIsStreaming, onTransportError } =
        argsRef.current;
      // Reset any leftover timers from a prior run before starting a new
      // one — a fresh submit owns the watchdog/poll lifecycle.
      clearTimers();
      try {
        const submissionId = crypto.randomUUID();
        // Establish the turn identity before POST resolves. The route persists
        // the user row before worker handoff; a fast realtime broadcast must
        // dedupe against the optimistic bubble instead of appending it twice.
        pendingRef.current = {
          runId: '',
          turnId: submissionId,
          assistantId: input.assistantId,
          sawRunning: false,
        };
        const response = await fetch('/api/chat/runs', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(
            propertyId
              ? { message: input.message, propertyId, submissionId }
              : { message: input.message, submissionId },
          ),
        });

        const payload = (await response.json().catch(() => null)) as {
          error?: string;
          data?: { runId?: string; turnId?: string };
        } | null;

        if (!response.ok) {
          throw new Error(
            response.status === 409
              ? 'Odesa is already working on this thread. Wait for that result before sending another message.'
              : RUN_START_FAILED_TEXT,
          );
        }
        const runId = payload?.data?.runId;
        const turnId = payload?.data?.turnId;
        if (!runId || !turnId) {
          throw new Error('Chat request returned an unexpected payload');
        }

        pendingRef.current = {
          runId,
          turnId,
          assistantId: input.assistantId,
          sawRunning: false,
        };

        pollStartTimerRef.current = setTimeout(() => {
          const pending = pendingRef.current;
          if (pending?.runId === runId && !pending.sawRunning) {
            startPolling(runId);
          }
        }, POLL_START_DELAY_MS);

        stallTimerRef.current = setTimeout(() => {
          const pending = pendingRef.current;
          if (pending?.runId === runId && !pending.sawRunning) {
            setStallHint(STALL_HINT_TEXT);
          }
        }, STALL_HINT_MS);

        // Hard watchdog: if the run never settles to a terminal status
        // (Inngest down, worker crashed mid-run), nothing else will ever
        // flip isStreaming back off. Surface a clear error, drop the
        // streaming caret, clear the pending turn, and re-enable the
        // composer. Guard on runId so a stale watchdog can't clobber a
        // newer pending run.
        watchdogTimerRef.current = setTimeout(() => {
          const pending = pendingRef.current;
          if (!pending || pending.runId !== runId) return;

          const {
            setMessages: latestSetMessages,
            setIsStreaming: latestSetIsStreaming,
            onTransportError: latestOnTransportError,
          } = argsRef.current;

          pendingRef.current = null;
          clearTimers();
          setStallHint(null);

          latestOnTransportError(RUN_WATCHDOG_TEXT);
          latestSetMessages((prev) =>
            prev.map((m) =>
              m.kind === 'assistant_text' && m.id === pending.assistantId
                ? {
                    ...m,
                    // A watchdog timeout is a durable failure from the
                    // browser's point of view. Any partial provider text is
                    // untrusted and must not survive as a claimed outcome.
                    body: RUN_WATCHDOG_TEXT,
                    streaming: false,
                  }
                : m,
            ),
          );
          latestSetIsStreaming(false);
        }, RUN_WATCHDOG_MS);
      } catch (err) {
        pendingRef.current = null;
        onTransportError(
          err instanceof Error &&
            (err.message === RUN_START_FAILED_TEXT ||
              err.message.startsWith('Odesa is already working'))
            ? err.message
            : RUN_START_FAILED_TEXT,
        );
        setMessages((prev) =>
          prev.map((m) =>
            m.kind === 'assistant_text' && m.id === input.assistantId
              ? { ...m, streaming: false }
              : m,
          ),
        );
        setIsStreaming(false);
      }
    },
    [startPolling, clearTimers],
  );

  // Realtime subscription on agent_runs UPDATE for this chat. RLS on
  // agent_runs is org-scoped SELECT, so the browser session only ever
  // sees its own org's runs.
  useEffect(() => {
    if (!enabled || !args.chatId) return;
    const supabase = createBrowserClient();
    const channel = supabase
      .channel(`chat-runs:${args.chatId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'agent_runs',
          filter: `chat_id=eq.${args.chatId}`,
        },
        (payload) => {
          settleRun(payload.new as AgentRunStatus);
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [enabled, args.chatId, settleRun]);

  // Clear any pending timers on unmount.
  useEffect(() => clearTimers, [clearTimers]);

  const pendingTurn = useCallback((): PendingTurnRef | null => {
    const pending = pendingRef.current;
    return pending
      ? { turnId: pending.turnId, assistantId: pending.assistantId }
      : null;
  }, []);

  return { enabled, stallHint, pendingTurn, submit };
}
