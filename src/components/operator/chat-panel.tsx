'use client';

/**
 * ChatPanel — operator chat surface for `/inbox` and `/properties/[id]/chat`.
 *
 * Lifted from `src/components/properties/chat/chat-panel.tsx` to live at
 * the operator-component root because the org-level `/inbox` surface
 * (Phase B Goal 1) shares the same UI, transport, and event reducer —
 * it just talks to a different SSE endpoint and resolves a different
 * chat row.
 *
 * Four responsibilities:
 *   1. Hydrate the message list from `initialHistory` (the SSR shell
 *      pre-loaded the last 20 turns from `loadHistory(chatId, 20)`).
 *   2. POST inbound messages to `apiEndpoint` and consume the
 *      `text/event-stream` response, mutating local message state per
 *      `DispatcherEvent.type`.
 *   3. Subscribe to Supabase realtime INSERTs on `operator_chat_turns`
 *      filtered by `chat_id`. Cross-channel writes (iMessage inbound, a
 *      different browser tab on the same chat) surface as
 *      `realtime.turn` events the reducer applies in-place. The reducer
 *      dedupes by `turn_id` (and per-row source ids) so an SSE-applied
 *      turn does not double-render when the realtime broadcast arrives a
 *      moment later.
 *   4. Render the scrollable message list + input form. The list
 *      auto-scrolls to the bottom when new items arrive.
 *
 * Streaming model: we use `fetch` + `ReadableStream.getReader()` rather
 * than the native `EventSource` because `EventSource` is GET-only and
 * the inbound message body needs to ride on a POST.
 *
 * Per the design memory: tasteful restraint. No animation library; the
 * caret blink in <ChatMessage /> is a CSS keyframe. Hover transitions
 * only.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { Send } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { createBrowserClient } from '@/lib/supabase/client';
import type {
  DispatcherEvent,
  OperatorChatTurnRow,
} from '@/lib/agent/operator/types';
import type { ActionProposal } from '@/lib/agent/worker/types';

import { ChatMessage } from './chat-message';
import { ProposedActionCard } from './proposed-action-card';
import { type ChatItem, mintLocalId, type ProposalCardStatus } from './types';
import { useDurableChat, type PendingTurnRef } from './use-durable-chat';

export interface ChatPanelProps {
  /** The pre-resolved operator_chats row id that all turns append to. */
  chatId: string;
  /**
   * Where to POST new inbound messages. The route emits SSE
   * DispatcherEvent frames the panel consumes verbatim.
   *   - `/api/chat/inbox`             — org-level (`/inbox`)
   *   - `/api/chat/property/[id]`     — per-property (legacy)
   */
  apiEndpoint: string;
  initialHistory: OperatorChatTurnRow[];
  /**
   * Per-property chat surface passes the property name so the input
   * placeholder can read "Ask about $name…". Org-level callers omit
   * this; we default to a generic prompt.
   */
  propertyName?: string;
  /**
   * Per-property surfaces still pass propertyId. The durable-run path
   * (NEXT_PUBLIC_DURABLE_CHAT) forwards it to /api/chat/runs so the
   * chat-row keying matches the per-property SSE route; it is not
   * rendered.
   */
  propertyId?: string;
  /**
   * Optional seed for the composer input. The `/assistant` page reads it
   * from `?q=` so an "Ask Odesa" bar elsewhere can pre-fill (but not
   * auto-send) a prompt. Defaults to an empty composer.
   */
  initialInput?: string;
  /** Role-aware copy for a deliberately scoped empty thread. */
  emptyStateContent?: ChatPanelEmptyStateContent;
  /** Require durable agent_runs lifecycle for the canonical global assistant. */
  forceDurable?: boolean;
}

export interface ChatPanelEmptyStateContent {
  eyebrow?: string;
  description: string;
  prompts: readonly string[];
  compact?: boolean;
}

/**
 * Client-side deadline for the SSE (non-durable) transport. The fetch
 * itself has no timeout, so without this the composer can hang on
 * "Sending" forever when the backend stalls. 45s is generous enough for
 * a slow-but-live dispatcher reply while still rescuing the UI from a
 * dead backend.
 */
const SSE_TIMEOUT_MS = 45_000;

const CHAT_PANEL_KEYFRAMES = `
@keyframes odesa-caret-blink {
  0%, 50% { opacity: 1; }
  51%, 100% { opacity: 0; }
}
`;

/**
 * Empty-state suggested prompts. Clicking one pre-fills the composer
 * (never auto-sends) so the operator stays in control of every turn.
 */
const SUGGESTED_PROMPTS: readonly string[] = [
  'What needs my attention today?',
  'Show pending decisions',
  'Draft a tenant message',
];

/** Chip styling for the suggested prompts — mirrors the inbox Ask Odesa
 *  bar's pill chips, expressed in this panel's paper/ink token family. */
const suggestedPromptChipStyle: React.CSSProperties = {
  background: 'transparent',
  border: '1px solid var(--ink-200)',
  borderRadius: '999px',
  padding: '4px 12px',
  fontFamily: 'inherit',
  fontSize: '12.5px',
  color: 'var(--ink-900)',
  cursor: 'pointer',
  whiteSpace: 'nowrap',
};

export function ChatPanel({
  chatId,
  apiEndpoint,
  initialHistory,
  propertyName,
  propertyId,
  initialInput,
  emptyStateContent,
  forceDurable = false,
}: ChatPanelProps) {
  const [messages, setMessages] = useState<ChatItem[]>(() =>
    hydrateInitialHistory(initialHistory),
  );
  const [input, setInput] = useState(initialInput ?? '');
  const [isStreaming, setIsStreaming] = useState(false);
  const [transportError, setTransportError] = useState<string | null>(null);
  // True when the composer arrived pre-filled (e.g. /assistant?q=…).
  // Shows a dismissible hint so the operator knows nothing auto-sent.
  const [showPrefillHint, setShowPrefillHint] = useState(
    () => (initialInput ?? '').trim().length > 0,
  );

  const listRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Dedupe state for the realtime ↔ SSE collision.
  //
  // `appliedRowIds`  — operator_chat_turns row PKs we've already
  //                    rendered. Seeded from initialHistory (server-side
  //                    hydrated rows) and bumped on every realtime
  //                    broadcast we accept. Catches realtime → realtime
  //                    re-deliveries and history → realtime overlap.
  // `appliedTurnIds` — logical `turn_id` values whose human-visible
  //                    rows we already showed via the SSE branch.
  //                    Seeded from initialHistory and bumped when the
  //                    dispatcher's `done` event arrives (which carries
  //                    the turnId it persisted every row under). Catches
  //                    the SSE → realtime overlap: when a turn streams
  //                    via `say.delta` the assistant_text bubble has a
  //                    synthetic `assistantId`, so the row-id check
  //                    can't see the duplicate; the turn_id check can.
  const appliedRowIdsRef = useRef<Set<string>>(
    new Set(initialHistory.map((r) => r.id)),
  );
  // Only COMPLETE turns (assistant_text already in history) seed the
  // turn-id set. A turn caught mid-run by a refresh has its `user` row
  // in history but its reply still in flight — blanket-seeding that
  // turn_id would make the dedupe swallow the assistant_text row when
  // it arrives via realtime, so the reply would never render. Row-id
  // dedupe still prevents re-rendering rows history already showed.
  const appliedTurnIdsRef = useRef<Set<string>>(
    new Set(
      initialHistory
        .filter((r) => r.role === 'assistant_text')
        .map((r) => r.turn_id)
        .filter((t): t is string => typeof t === 'string' && t.length > 0),
    ),
  );

  // Durable-run path (NEXT_PUBLIC_DURABLE_CHAT). When the flag is off
  // every member no-ops and the SSE path below is untouched.
  const durable = useDurableChat({
    chatId,
    ...(propertyId ? { propertyId } : {}),
    setMessages,
    appliedTurnIds: appliedTurnIdsRef.current,
    onTransportError: setTransportError,
    setIsStreaming,
    forceDurable,
  });
  // Stable function identity (useCallback in the hook) — destructured so
  // the realtime effect can depend on it without re-subscribing.
  const durablePendingTurn = durable.pendingTurn;

  // Auto-scroll to the bottom whenever the message list changes.
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages]);

  // Tear down any in-flight request on unmount.
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  // ---------------------------------------------------------------------
  // Realtime subscription
  // ---------------------------------------------------------------------
  //
  // Subscribe to INSERTs on `operator_chat_turns` for this chat. Inbound
  // iMessages persisted by `handle-operator-inbound` push a fresh row
  // straight to Postgres; the realtime publication added in
  // 20260506000003_realtime_operator_chat_turns.sql fans the row out to
  // any subscribed client. RLS on `operator_chat_turns` is org+user
  // scoped, so authenticated browser sessions only see their own rows.
  useEffect(() => {
    if (!chatId) return;
    const supabase = createBrowserClient();
    const channel = supabase
      .channel(`chat:${chatId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'operator_chat_turns',
          filter: `chat_id=eq.${chatId}`,
        },
        (payload) => {
          const turn = payload.new as OperatorChatTurnRow;
          applyRealtimeTurn(
            setMessages,
            appliedRowIdsRef.current,
            appliedTurnIdsRef.current,
            turn,
            durablePendingTurn(),
          );
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [chatId, durablePendingTurn]);

  const placeholder = useMemo(
    () =>
      propertyName
        ? `Ask about ${propertyName}…`
        : 'Ask about a property, draft a tenant message, or check what needs your attention…',
    [propertyName],
  );

  const defaultEmptyDescription = propertyName
    ? 'Ask anything about this property — pending decisions, recent activity, or have me draft a tenant message.'
    : 'Ask anything across your portfolio — pending decisions, recent activity, or have me draft a tenant message.';
  const emptyDescription =
    emptyStateContent?.description ?? defaultEmptyDescription;
  const emptyPrompts = emptyStateContent?.prompts ?? SUGGESTED_PROMPTS;

  const handleSuggestedPrompt = (prompt: string) => {
    setInput(prompt);
    setShowPrefillHint(false);
    inputRef.current?.focus();
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (isStreaming) return;

    const trimmed = input.trim();
    if (trimmed.length === 0) return;

    setTransportError(null);
    setInput('');
    setShowPrefillHint(false);

    const userId = mintLocalId('user');
    const assistantId = mintLocalId('assistant');

    setMessages((prev) => [
      ...prev,
      { kind: 'user', id: userId, body: trimmed },
      { kind: 'assistant_text', id: assistantId, body: '', streaming: true },
    ]);
    setIsStreaming(true);

    if (durable.enabled) {
      // Durable path: enqueue via /api/chat/runs; delivery arrives over
      // the realtime subscriptions (with the polling fallback) and the
      // hook clears the working state on the terminal run status (or the
      // hook's own watchdog if the run never settles).
      //
      // Wrap so a thrown enqueue still releases the working flag — the
      // hook's own catch already handles the rejected POST, but a
      // synchronous throw before that (or any unexpected error) must not
      // leave the composer stuck "Sending".
      try {
        await durable.submit({ message: trimmed, assistantId });
      } catch {
        setIsStreaming(false);
      }
      return;
    }

    const controller = new AbortController();
    abortRef.current = controller;
    // Client-side transport timeout: the SSE fetch has no server-side
    // deadline of its own, so without this the composer can stay stuck on
    // "Sending" indefinitely when the backend is slow or unreachable. On
    // fire we abort the request and surface a clear, retryable message.
    let timedOut = false;
    const timeoutId = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, SSE_TIMEOUT_MS);

    try {
      const response = await fetch(apiEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: trimmed }),
        signal: controller.signal,
      });

      if (!response.ok || !response.body) {
        const errBody = await safeReadText(response);
        throw new Error(
          `Chat request failed (${response.status}): ${errBody || response.statusText}`,
        );
      }

      await consumeSse(response.body, (ev) => {
        applyEvent(setMessages, appliedTurnIdsRef.current, ev, assistantId);
      });
      // The dispatcher's `done` already added the turnId to the dedupe
      // set inside `applyEvent`, but in case the SSE stream tore down
      // before yielding `done` (transport hiccup, abort) we leave the
      // realtime path to re-render whichever rows the dispatcher
      // managed to persist server-side.
    } catch (err) {
      if (controller.signal.aborted && !timedOut) {
        // Operator navigated away or refreshed — silent abort is fine.
        // A timeout-driven abort (timedOut) falls through to the error
        // branch below so the operator sees a clear, retryable message.
        return;
      }
      setTransportError(
        timedOut
          ? "Odesa didn't finish in time. Review this thread before trying again."
          : err instanceof Error
            ? err.message
            : String(err),
      );
      // Drop the streaming flag on the in-flight assistant message so
      // the caret stops blinking.
      setMessages((prev) =>
        prev.map((m) =>
          m.kind === 'assistant_text' && m.id === assistantId
            ? { ...m, streaming: false }
            : m,
        ),
      );
    } finally {
      clearTimeout(timeoutId);
      setIsStreaming(false);
      abortRef.current = null;
    }
  };

  return (
    <section
      data-testid="chat-panel"
      style={{
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--paper-0)',
        border: '1px solid var(--ink-200)',
        borderRadius: 'var(--radius-lg-odesa, 12px)',
        height:
          emptyStateContent?.compact && messages.length === 0
            ? 'min(54vh, 520px)'
            : 'min(70vh, 720px)',
        overflow: 'hidden',
      }}
    >
      <style>{CHAT_PANEL_KEYFRAMES}</style>
      <div
        ref={listRef}
        data-testid="chat-panel-list"
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '24px 24px 16px',
          display: 'flex',
          flexDirection: 'column',
          gap: '12px',
        }}
      >
        {messages.length === 0 ? (
          <div
            style={{
              alignSelf: 'center',
              margin: 'auto',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '14px',
            }}
          >
            {emptyStateContent?.eyebrow ? (
              <p
                className="meta-label"
                data-testid="chat-panel-empty-eyebrow"
                style={{ margin: 0, color: 'var(--clay-600)' }}
              >
                {emptyStateContent.eyebrow}
              </p>
            ) : null}
            <p
              data-testid="chat-panel-empty"
              style={{
                margin: 0,
                textAlign: 'center',
                color: 'var(--ink-500)',
                fontSize: '14px',
                maxWidth: '40ch',
              }}
            >
              {emptyDescription}
            </p>
            <div
              data-testid="chat-panel-suggested-prompts"
              role="group"
              aria-label="Suggested prompts"
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                justifyContent: 'center',
                gap: '8px',
              }}
            >
              {emptyPrompts.map((prompt) => (
                <button
                  key={prompt}
                  type="button"
                  style={suggestedPromptChipStyle}
                  onClick={() => handleSuggestedPrompt(prompt)}
                >
                  {prompt}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((item) =>
            item.kind === 'proposal_card' ? (
              <ProposedActionCard
                key={item.id}
                proposal={item.proposal}
                status={item.status}
              />
            ) : (
              <ChatMessage key={item.id} item={item} />
            ),
          )
        )}
      </div>

      {durable.stallHint ? (
        <p
          data-testid="chat-panel-stall-hint"
          style={{
            margin: 0,
            padding: '8px 24px',
            fontSize: '12px',
            color: 'var(--ink-500)',
            background: 'var(--paper-100)',
          }}
        >
          {durable.stallHint}
        </p>
      ) : null}

      {transportError ? (
        <p
          role="alert"
          data-testid="chat-panel-transport-error"
          style={{
            margin: 0,
            padding: '8px 24px',
            fontSize: '12px',
            color: 'var(--destructive, #b3261e)',
            background: 'rgba(180, 67, 76, 0.06)',
          }}
        >
          {transportError}
        </p>
      ) : null}

      {showPrefillHint ? (
        <div
          data-testid="chat-prefill-hint"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '8px',
            margin: 0,
            padding: '8px 24px',
            fontSize: '12px',
            color: 'var(--ink-500)',
            background: 'var(--paper-100)',
            borderTop: '1px solid var(--ink-200)',
          }}
        >
          <span>Pre-filled from your last action — review and press Send.</span>
          <button
            type="button"
            aria-label="Dismiss pre-fill hint"
            onClick={() => setShowPrefillHint(false)}
            style={{
              background: 'transparent',
              border: 'none',
              padding: '2px 4px',
              fontSize: '12px',
              lineHeight: 1,
              color: 'var(--ink-500)',
              cursor: 'pointer',
            }}
          >
            ✕
          </button>
        </div>
      ) : null}

      <form
        onSubmit={handleSubmit}
        data-testid="chat-panel-form"
        style={{
          display: 'flex',
          gap: '8px',
          padding: '14px 24px',
          borderTop: '1px solid var(--ink-200)',
          background: 'var(--paper-0)',
        }}
      >
        <textarea
          ref={inputRef}
          data-testid="chat-panel-input"
          aria-label="Message Odesa"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void handleSubmit(e);
            }
          }}
          rows={1}
          placeholder={placeholder}
          disabled={isStreaming}
          style={{
            flex: 1,
            resize: 'none',
            padding: '8px 12px',
            fontSize: '14px',
            lineHeight: 1.5,
            color: 'var(--ink-900)',
            background: 'var(--paper-100)',
            border: '1px solid var(--ink-200)',
            borderRadius: '10px',
            outline: 'none',
            fontFamily: 'inherit',
            maxHeight: '160px',
            minHeight: '36px',
          }}
        />
        <Button
          type="submit"
          disabled={isStreaming || input.trim().length === 0}
          aria-disabled={isStreaming || input.trim().length === 0}
          aria-busy={isStreaming}
          title={
            isStreaming
              ? 'Odesa is still responding'
              : input.trim().length === 0
                ? 'Type a message first'
                : undefined
          }
          data-testid="chat-panel-send"
        >
          <Send />
          {isStreaming ? 'Sending' : 'Send'}
        </Button>
      </form>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Initial-history hydration
// ---------------------------------------------------------------------------

function hydrateInitialHistory(rows: OperatorChatTurnRow[]): ChatItem[] {
  const out: ChatItem[] = [];
  for (const row of rows) {
    const id = row.id;
    if (row.role === 'user' && row.body) {
      out.push({ kind: 'user', id, body: row.body });
    } else if (row.role === 'assistant_text' && row.body) {
      out.push({
        kind: 'assistant_text',
        id,
        body: row.body,
        streaming: false,
      });
    } else if (row.role === 'assistant_ack' && row.body) {
      out.push({ kind: 'assistant_ack', id, body: row.body });
    }
    // tool_use / tool_result are omitted from the initial render — they
    // are dispatcher bookkeeping, not first-paint conversation.
  }
  return out;
}

// ---------------------------------------------------------------------------
// Realtime row → ChatItem reducer
// ---------------------------------------------------------------------------
//
// Realtime broadcasts deliver the raw operator_chat_turns row. We only
// surface the human-visible roles (user, assistant_text, assistant_ack)
// here; tool_use/tool_result chatter is dispatcher bookkeeping that
// belongs to the SSE branch where it pairs back to its tool.use card.
// Dedupe by source id (the row's PK), which the SSE branch also adds
// when persisting via dispatcher.

function applyRealtimeTurn(
  setMessages: SetMessages,
  appliedRowIds: Set<string>,
  appliedTurnIds: Set<string>,
  turn: OperatorChatTurnRow,
  pendingTurn: PendingTurnRef | null = null,
): void {
  // Row-id dedupe: a realtime broadcast we already applied (or that came
  // through initial history) does not re-render.
  if (appliedRowIds.has(turn.id)) return;
  // Turn-id dedupe: the SSE branch already showed the human-visible
  // rows for this turn; skip the realtime echo of the same turn.
  if (turn.turn_id && appliedTurnIds.has(turn.turn_id)) {
    appliedRowIds.add(turn.id);
    return;
  }
  appliedRowIds.add(turn.id);

  // Durable path: rows for the in-flight run's pre-minted turn_id are
  // THE delivery channel (there is no SSE branch). Dedupe by id only:
  // the `user` row is already on screen optimistically; acks stream in
  // above the placeholder; assistant_text writes INTO the placeholder
  // so the working indicator resolves in place.
  if (pendingTurn && turn.turn_id === pendingTurn.turnId) {
    if (turn.role === 'user') return;
    if (turn.role === 'assistant_ack' && turn.body) {
      setMessages((prev) =>
        insertBeforeAssistant(prev, pendingTurn.assistantId, {
          kind: 'assistant_ack',
          id: turn.id,
          body: turn.body!,
        }),
      );
      return;
    }
    if (turn.role === 'assistant_text' && turn.body) {
      setMessages((prev) =>
        prev.map((m) =>
          m.kind === 'assistant_text' && m.id === pendingTurn.assistantId
            ? {
                ...m,
                body:
                  m.body.length > 0 ? `${m.body}\n\n${turn.body!}` : turn.body!,
              }
            : m,
        ),
      );
      return;
    }
    // tool_use / tool_result: live tool-cards over realtime are out of
    // scope for v1 — they render on the next refresh via history.
    return;
  }

  if (turn.role === 'user' && turn.body) {
    setMessages((prev) => appendIfMissing(prev, 'user', turn.id, turn.body!));
    return;
  }
  if (turn.role === 'assistant_text' && turn.body) {
    setMessages((prev) =>
      appendIfMissing(prev, 'assistant_text', turn.id, turn.body!),
    );
    return;
  }
  if (turn.role === 'assistant_ack' && turn.body) {
    setMessages((prev) =>
      appendIfMissing(prev, 'assistant_ack', turn.id, turn.body!),
    );
    return;
  }
  // tool_use / tool_result rows are intentionally ignored on the realtime
  // path. They surface via SSE for the active tab; for cross-tab views
  // they show up as part of the assistant_text follow-up.
}

function appendIfMissing(
  prev: ChatItem[],
  kind: 'user' | 'assistant_text' | 'assistant_ack',
  id: string,
  body: string,
): ChatItem[] {
  // Belt-and-suspenders: even if the dedupe set somehow misses (e.g.
  // the same row arrives via two paths with different turn_ids — should
  // not happen), don't double-render the same DB-row id.
  if (prev.some((m) => m.id === id)) return prev;

  if (kind === 'assistant_text') {
    return [...prev, { kind, id, body, streaming: false }];
  }
  return [...prev, { kind, id, body }];
}

// ---------------------------------------------------------------------------
// SSE consumer
// ---------------------------------------------------------------------------

async function consumeSse(
  body: ReadableStream<Uint8Array>,
  onEvent: (event: DispatcherEvent) => void,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });

    // Frames are delimited by a blank line. Each frame can have
    // multiple `data:` lines; we concatenate them per the SSE spec.
    let separatorIndex = buffer.indexOf('\n\n');
    while (separatorIndex !== -1) {
      const frame = buffer.slice(0, separatorIndex);
      buffer = buffer.slice(separatorIndex + 2);

      const dataLines: string[] = [];
      for (const line of frame.split('\n')) {
        if (line.startsWith('data:')) {
          dataLines.push(line.slice(5).trimStart());
        }
      }
      if (dataLines.length > 0) {
        const payload = dataLines.join('\n');
        try {
          const ev = JSON.parse(payload) as DispatcherEvent;
          onEvent(ev);
        } catch {
          // Malformed frame — skip rather than tear the stream down.
        }
      }
      separatorIndex = buffer.indexOf('\n\n');
    }
  }
}

// ---------------------------------------------------------------------------
// Event → state reducer
// ---------------------------------------------------------------------------

type SetMessages = React.Dispatch<React.SetStateAction<ChatItem[]>>;

function applyEvent(
  setMessages: SetMessages,
  appliedTurnIds: Set<string>,
  event: DispatcherEvent,
  assistantId: string,
): void {
  switch (event.type) {
    case 'ack':
      setMessages((prev) =>
        insertBeforeAssistant(prev, assistantId, {
          kind: 'assistant_ack',
          id: mintLocalId('ack'),
          body: event.text,
        }),
      );
      return;

    case 'say.delta':
      setMessages((prev) =>
        prev.map((m) =>
          m.kind === 'assistant_text' && m.id === assistantId
            ? { ...m, body: m.body + event.text }
            : m,
        ),
      );
      return;

    case 'tool.use':
    case 'tool.result':
      // Tool names, payloads, results, and identifiers are audit evidence,
      // not customer conversation. The dispatcher persists them separately.
      return;

    case 'tool.error':
      setMessages((prev) =>
        prev.map((message) =>
          message.kind === 'assistant_text' && message.id === assistantId
            ? {
                ...message,
                body:
                  "Odesa couldn't finish this request. No action is shown as completed—review this thread and Owner Queue before trying again.",
              }
            : message,
        ),
      );
      return;

    case 'proposal.recorded':
      setMessages((prev) =>
        upsertProposalCard(prev, event.proposal, 'recorded', null, assistantId),
      );
      return;

    case 'proposal.committed':
      setMessages((prev) =>
        upsertProposalCard(
          prev,
          event.proposal,
          'committed',
          null,
          assistantId,
        ),
      );
      return;

    case 'proposal.review_required':
      setMessages((prev) =>
        upsertProposalCard(
          prev,
          event.proposal,
          'review_required',
          event.reviewUrl,
          assistantId,
        ),
      );
      return;

    case 'done': {
      // Seed the realtime dedupe set with this turn's logical turnId.
      // The dispatcher persists every operator_chat_turns row under this
      // shared turn_id, and the realtime publication broadcasts those
      // rows back a beat later — without this seed the assistant_text
      // we already showed via `say.delta` would render a second time
      // when the postgres INSERT broadcast lands.
      appliedTurnIds.add(event.turnId);

      setMessages((prev) =>
        prev.map((m) =>
          m.kind === 'assistant_text' && m.id === assistantId
            ? { ...m, streaming: false }
            : m,
        ),
      );
      return;
    }

    default: {
      const _exhaustive: never = event;
      void _exhaustive;
      return;
    }
  }
}

/**
 * Tool / ack / error rows want to appear ABOVE the in-flight assistant
 * bubble so the operator's chronological mental model holds (the model
 * thought, then it spoke). We splice rather than push.
 */
function insertBeforeAssistant(
  prev: ChatItem[],
  assistantId: string,
  item: ChatItem,
): ChatItem[] {
  const idx = prev.findIndex(
    (m) => m.kind === 'assistant_text' && m.id === assistantId,
  );
  if (idx === -1) return [...prev, item];
  return [...prev.slice(0, idx), item, ...prev.slice(idx)];
}

/**
 * Maintain a single card per proposal id across the recorded →
 * committed/review_required state transitions.
 */
function upsertProposalCard(
  prev: ChatItem[],
  proposal: ActionProposal,
  status: ProposalCardStatus,
  reviewUrl: string | null,
  assistantId: string,
): ChatItem[] {
  const cardId = `proposal_${proposal.id ?? mintLocalId('p')}`;
  const existingIdx = prev.findIndex(
    (m) => m.kind === 'proposal_card' && m.id === cardId,
  );

  if (existingIdx !== -1) {
    return prev.map((m, i) =>
      i === existingIdx && m.kind === 'proposal_card'
        ? {
            ...m,
            proposal,
            status,
            reviewUrl: reviewUrl ?? m.reviewUrl,
          }
        : m,
    );
  }

  return insertBeforeAssistant(prev, assistantId, {
    kind: 'proposal_card',
    id: cardId,
    proposal,
    status,
    reviewUrl,
  });
}

async function safeReadText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return '';
  }
}
