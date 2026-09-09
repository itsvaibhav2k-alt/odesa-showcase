'use client';

/**
 * AskOdesaBar — Wave 7 contextual chip bar pinned at the bottom of
 * the case-file scroll container.
 *
 * Pieces:
 *   1. Input row with a `⌘` glyph, a placeholder that adapts to the
 *      open conversation, and a small ↵ kbd. Enter routes to
 *      `/assistant?q=…` (no in-page streaming in this wave).
 *   2. Suggestion row with a status dot, "In context — {label}", and
 *      four chips derived from `deriveChipSet({ status, ... })`.
 *
 * Every chip is a contextual handoff to the same global Ask Odesa thread.
 * Chips never approve, reject, edit, regenerate, or send inside Inbox; any
 * consequential proposal returns through Owner Queue.
 *
 * Visual: the bar lives INSIDE `inbox-thread-scroll` (so it scrolls
 * with the timeline rather than docking above `<ManualOverride />`).
 * It uses the warm palette tokens at :root and inline-falls back the
 * `--ink*` tokens which only exist under `.today-theme`.
 *
 * Fade-swap: when the selected conversation id changes we hold the
 * outgoing chip/placeholder/label for 140ms with `data-swapping="true"`,
 * then update the rendered ctx. CSS transitions opacity.
 */

import { useRouter } from 'next/navigation';
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';

import { useConversations } from '@/components/inbox/conversations-context';
import {
  buildContextLabel,
  buildPlaceholder,
  deriveChipSet,
  interpolateTemplate,
  type ChipContext,
  type ChipDef,
  type ChipStatus,
} from '@/lib/inbox/ask-odesa-chips';
import {
  deriveQueueStatus,
  type QueueStatusKind,
} from '@/lib/inbox/queue-status';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Duration of the chip fade-swap animation (matches CSS). */
const SWAP_DURATION_MS = 140;

/**
 * Map the queue's 5-kind taxonomy onto the chip framework's 4-kind
 * taxonomy. `watching` collapses to `handled` — the chip set for a
 * quietly-monitored thread is the same as a resolved one.
 */
function toChipStatus(kind: QueueStatusKind): ChipStatus {
  if (kind === 'watching') return 'handled';
  return kind;
}

/** First word of the tenant display name, with `'` and trailing chars stripped. */
function firstNameOf(fullName: string | null | undefined): string {
  if (!fullName) return '';
  const first = fullName.trim().split(/\s+/)[0] ?? '';
  return first.replace(/[^\p{L}\p{M}'\-]/gu, '');
}

/** Keep Inbox provenance attached when a prompt moves to the global assistant. */
export function buildInboxAssistantQuery(
  prompt: string,
  contextLabel: string,
  hasSelectedConversation: boolean,
): string {
  const trimmed = prompt.trim();
  if (!trimmed) return '';
  return hasSelectedConversation
    ? `Inbox case context — ${contextLabel}: ${trimmed}`
    : `Inbox context: ${trimmed}`;
}

/** Translate legacy chip shapes into safe prompts for the canonical assistant. */
export function buildInboxChipPrompt(
  chip: ChipDef,
  context: ChipContext,
): string {
  const action = chip.action;
  switch (action.kind) {
    case 'approve_draft':
      return 'Review the pending draft and prepare the next step for Owner Queue. Do not send it.';
    case 'reject_draft':
      return 'Review whether the pending draft should be rejected and prepare that decision for Owner Queue. Do not reject it yet.';
    case 'prefill_override':
      return `Prepare this possible reply as a draft for review: ${interpolateTemplate(action.template, context)} Do not send it.`;
    case 'regenerate_draft':
      return `${action.instruction} Prepare the result for review. Do not send it.`;
    case 'ask_assistant':
      return interpolateTemplate(action.prompt, context);
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function AskOdesaBar() {
  const router = useRouter();
  const {
    selectedConversationId,
    selectedDetail,
    conversations,
    slaMap,
  } = useConversations();

  const inputId = useId();
  const [input, setInput] = useState('');

  // Derive the live (post-swap) chip context.
  const ctx = useMemo<ChipContext>(() => {
    const conv = conversations.find((c) => c.id === selectedConversationId);
    const slaBreached = conv
      ? (slaMap.get(conv.id) ?? false)
      : false;
    const queue = conv
      ? deriveQueueStatus(conv, { workOrderSlaBreached: slaBreached })
      : { kind: 'handled' as QueueStatusKind };
    const tenantName = selectedDetail?.tenant.name ?? '';
    return {
      status: toChipStatus(queue.kind),
      hasPendingDraft: Boolean(selectedDetail?.pendingDraft),
      hasWorkOrder: Boolean(selectedDetail?.caseContext.workOrder),
      tenantFirstName: firstNameOf(tenantName),
      // Unmatched thread (a case file is open but its tenant_id is null —
      // an unknown SMS sender) → suppress tenant-specific chips. With no
      // case file open at all there is nothing to guard, so stay neutral
      // and show the default chip set rather than the "Link tenant" guardrail.
      tenantResolved: !selectedDetail || Boolean(selectedDetail.tenant.id),
    };
  }, [
    conversations,
    selectedConversationId,
    selectedDetail,
    slaMap,
  ]);

  // Fade-swap: hold the previous rendered ctx for SWAP_DURATION_MS
  // when the selected conversation id changes, then snap to the new
  // ctx. Avoids the jarring "chips pop" when switching threads.
  const [displayed, setDisplayed] = useState<{
    conversationId: string | null;
    context: ChipContext;
  }>(() => ({ conversationId: selectedConversationId, context: ctx }));
  const isSwapping = displayed.conversationId !== selectedConversationId;
  // Same-conversation context changes render directly. During a conversation
  // switch, retain the prior context until the fade timer completes.
  const rendered = isSwapping ? displayed.context : ctx;

  useEffect(() => {
    if (!isSwapping) return;
    const t = window.setTimeout(() => {
      setDisplayed({ conversationId: selectedConversationId, context: ctx });
    }, SWAP_DURATION_MS);
    return () => window.clearTimeout(t);
  }, [selectedConversationId, ctx, isSwapping]);

  const chips = useMemo<ChipDef[]>(() => deriveChipSet(rendered), [rendered]);
  const placeholder = useMemo(
    () => buildPlaceholder(rendered),
    [rendered],
  );
  const contextLabel = useMemo(
    () => buildContextLabel(rendered),
    [rendered],
  );

  // ---------------------------------------------------------------------------
  // Dispatch
  // ---------------------------------------------------------------------------

  const onChip = useCallback(
    (chip: ChipDef) => {
      const prompt = buildInboxChipPrompt(chip, ctx);
      router.push(`/assistant?q=${encodeURIComponent(buildInboxAssistantQuery(
        prompt,
        buildContextLabel(ctx),
        selectedConversationId !== null,
      ))}`);
    },
    [ctx, router, selectedConversationId],
  );

  const onInputKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    const trimmed = input.trim();
    if (trimmed.length === 0) return;
    router.push(`/assistant?q=${encodeURIComponent(buildInboxAssistantQuery(
      trimmed,
      buildContextLabel(ctx),
      selectedConversationId !== null,
    ))}`);
    setInput('');
  };

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <section
      data-testid='ask-odesa-bar'
      aria-label='Ask Odesa'
      style={{
        margin: '12px 36px 4px',
        padding: '12px 16px',
        background: 'var(--panel-clean, #FFFDF6)',
        border: '1px solid var(--hairline-faint, #EAE0CA)',
        borderRadius: '10px',
        display: 'flex',
        flexDirection: 'column',
        gap: '10px',
      }}
    >
      <div
        className='ask-input-row'
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
        }}
      >
        <span
          aria-hidden='true'
          style={{
            fontFamily: 'var(--font-mono-operator, ui-monospace, monospace)',
            color: 'var(--ink-3, #87796A)',
            fontSize: '12px',
            width: '18px',
            display: 'inline-flex',
            justifyContent: 'center',
          }}
        >
          ⌘
        </span>
        <input
          id={inputId}
          data-testid='ask-odesa-input'
          aria-label='Ask Odesa'
          value={input}
          placeholder={placeholder}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onInputKeyDown}
          style={{
            flex: 1,
            background: 'transparent',
            border: 'none',
            outline: 'none',
            fontFamily: 'var(--font-sans-operator, system-ui, sans-serif)',
            fontSize: '13.5px',
            color: 'var(--ink, #1B1712)',
            padding: '4px 0',
          }}
        />
        <kbd
          aria-hidden='true'
          style={{
            fontFamily: 'var(--font-mono-operator, ui-monospace, monospace)',
            fontSize: '10.5px',
            color: 'var(--ink-4, #9F9075)',
            border: '1px solid var(--hairline-faint, #EAE0CA)',
            borderRadius: '4px',
            padding: '1px 6px',
          }}
        >
          ↵
        </kbd>
      </div>
      <div
        data-testid='ask-odesa-suggestions'
        data-swapping={isSwapping ? 'true' : 'false'}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          flexWrap: 'wrap',
          opacity: isSwapping ? 0 : 1,
          transition: `opacity ${SWAP_DURATION_MS}ms ease`,
        }}
      >
        <span
          data-testid='ask-odesa-context-label'
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px',
            fontFamily: 'var(--font-mono-operator, ui-monospace, monospace)',
            fontSize: '10.5px',
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            color: 'var(--ink-3, #87796A)',
          }}
        >
          <span
            aria-hidden='true'
            style={{
              display: 'inline-block',
              width: '6px',
              height: '6px',
              borderRadius: '50%',
              background: 'var(--terracotta, #C3623F)',
            }}
          />
          In context — {contextLabel}
        </span>
        {chips.map((chip) => {
          return (
            <button
              key={chip.label}
              type='button'
              data-testid={`ask-odesa-chip-${chip.action.kind}`}
              onClick={() => onChip(chip)}
              style={{
                background: 'transparent',
                border: '1px solid var(--hairline-faint, #EAE0CA)',
                borderRadius: '999px',
                padding: '4px 10px',
                fontFamily:
                  'var(--font-sans-operator, system-ui, sans-serif)',
                fontSize: '12px',
                color: 'var(--ink-2, #4A3F30)',
                cursor: 'pointer',
                whiteSpace: 'nowrap',
              }}
            >
              {chip.label}
            </button>
          );
        })}
      </div>
    </section>
  );
}

export default AskOdesaBar;
