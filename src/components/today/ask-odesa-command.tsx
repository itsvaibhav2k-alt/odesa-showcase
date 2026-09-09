'use client';

/**
 * Today v2 — AskOdesa command bar.
 *
 * Client component. Renders the Raycast-style command input on the
 * Today page below the owner review queue. Two visual states:
 *
 *  1. Default (no row selected) — eyebrow `TRY` in muted ink, four
 *     portfolio-wide default chips, the verbatim "Ask Odesa — try …"
 *     placeholder, and no `× clear context` button.
 *
 *  2. In-context (a row is selected) — eyebrow swaps to
 *     `● IN CONTEXT — {contextLabel.toUpperCase()}` in terracotta with
 *     a small pulse dot; chips swap to `selectedItem.contextSuggestions`
 *     (exactly 4); placeholder swaps to `selectedItem.contextPlaceholder`;
 *     `× clear context` button becomes visible on the right and calls
 *     `onClearContext` on click.
 *
 * Chip swap motion: 200ms opacity fade keyed on the selection identity.
 * The chips wrapper carries a `key` that changes when `selectedItem`
 * changes, forcing React to mount a fresh node so the CSS opacity
 * transition can run from `0 → 1` per the load-bearing detail in
 * ref-load-bearing-details.md.
 *
 * Visual rules (see ref-load-bearing-details / ref-hard-rules):
 *  - Terracotta caret on the input (Raycast-like aliveness).
 *  - No Lucide icons; `*`, `›`, `↵`, `⌘`, `×` are text glyphs.
 *  - No rounded-2xl/3xl — chips are full-pill (~999px) intentionally,
 *    input field 8px radius, container card 10px radius.
 *  - No imports from `@/components/ui/*` or `@/components/shared/*`,
 *    and no reuse of the legacy `@/components/today/ask-odesa`.
 */

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import type { QueueItem } from '@/types/today';

export interface AskOdesaCommandProps {
  /** VA defaults are preparation-oriented and never imply approval. */
  audience?: 'owner' | 'va';
  /** Currently selected queue row, if any. Drives the context swap. */
  selectedItem?: QueueItem | null;
  /** Clear-context callback. Invoked by the `× clear context` button. */
  onClearContext?: () => void;
}

const DEFAULT_PLACEHOLDER =
  'Ask Odesa — try "what should I review before Monday?"';

const DEFAULT_CHIPS: ReadonlyArray<string> = [
  'Who needs follow-up this afternoon?',
  'Draft May late-rent reminders',
  'Show vendor delays',
  'What should I review before Monday?',
];

const VA_PLACEHOLDER =
  'Ask Odesa to summarize work or prepare an owner handoff…';

const VA_CHIPS: ReadonlyArray<string> = [
  'Summarize my shift queue',
  'What needs owner follow-up?',
  'Draft an owner handoff',
  'List the context still missing',
];

function toKebab(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Builds the assistant href, prefilling the conversation via `?q`.
 * Mirrors the helper in the legacy `ask-odesa` rail so both entry
 * points land on `/assistant` with the same query contract.
 */
function assistantHref(query?: string): string {
  if (!query) return '/assistant';
  return `/assistant?q=${encodeURIComponent(query)}`;
}

/** Preserve the selected Today source context when handing off to Ask Odesa. */
export function buildTodayAssistantQuery(
  prompt: string,
  selectedItem: QueueItem | null,
): string {
  const trimmed = prompt.trim();
  if (!selectedItem) return trimmed;
  const request =
    trimmed ||
    'Summarize this source record and identify any evidence still missing.';
  return `Today context — ${selectedItem.contextLabel}: ${request}`;
}

export function AskOdesaCommand({
  audience = 'owner',
  selectedItem = null,
  onClearContext,
}: AskOdesaCommandProps = {}) {
  // Input value is local. Submitting (Enter or the ↵ send button)
  // navigates to the real assistant with the query prefilled via `?q`.
  const [value, setValue] = useState<string>('');
  const router = useRouter();

  const inContext = selectedItem !== null;
  // Chip-swap animation: the chips wrapper carries a `key` derived
  // directly from the selection identity. When the identity changes
  // React mounts a fresh node and the CSS `animation: askOdesaChipsFade`
  // runs from `0 → 1`. Computing the key inline (rather than via a
  // useEffect / setState pair) avoids cascading renders.
  const chipKey: string = selectedItem?.id ?? 'default';
  const chips: ReadonlyArray<string> = inContext
    ? selectedItem.contextSuggestions
    : audience === 'va'
      ? VA_CHIPS
      : DEFAULT_CHIPS;
  const placeholder = inContext
    ? selectedItem.contextPlaceholder
    : audience === 'va'
      ? VA_PLACEHOLDER
      : DEFAULT_PLACEHOLDER;

  /**
   * Free-text submit (Enter inside the form, or the ↵ send button).
   * No-op on an empty query. In-context with an empty input we fall
   * back to the selected row's `contextLabel` so the assistant lands
   * scoped to the row the owner was looking at, rather than nothing.
   */
  function handleSubmit(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const trimmed = value.trim();
    if (!trimmed && !inContext) return;
    const query = buildTodayAssistantQuery(trimmed, selectedItem);
    if (!query) return;
    router.push(assistantHref(query));
  }

  /** Suggestion-chip click — navigates with the chip text as the query. */
  function handleChipClick(chip: string): void {
    router.push(assistantHref(buildTodayAssistantQuery(chip, selectedItem)));
  }

  return (
    <section
      data-section="ask-odesa"
      data-in-context={inContext ? 'true' : 'false'}
      style={{
        background: 'var(--panel)',
        border: '1px solid var(--hairline)',
        borderRadius: '10px',
        padding: '16px 18px',
        display: 'flex',
        flexDirection: 'column',
        gap: '14px',
      }}
    >
      {/* Input row — a form so Enter and the ↵ send button share one path */}
      <form
        onSubmit={handleSubmit}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
          background: 'var(--panel-lift)',
          border: '1px solid var(--hairline)',
          borderRadius: '8px',
          padding: '10px 12px',
        }}
      >
        <span
          aria-hidden="true"
          style={{
            color: 'var(--terracotta)',
            fontSize: '14px',
            lineHeight: 1,
            transform: 'translateY(1px)',
          }}
        >
          *
        </span>

        <input
          data-ask-input="true"
          type="text"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder={placeholder}
          aria-label="Ask Odesa"
          style={{
            flex: 1,
            background: 'transparent',
            border: 'none',
            outline: 'none',
            color: 'var(--ink)',
            fontFamily: 'var(--font-sans-operator)',
            fontSize: '13.5px',
            letterSpacing: '0.005em',
            caretColor: 'var(--terracotta)',
          }}
        />

        <span
          aria-hidden="true"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '3px',
            fontFamily: 'var(--font-mono-operator)',
            fontSize: '11px',
            color: 'var(--ink-3)',
            border: '1px solid var(--hairline)',
            borderRadius: '4px',
            padding: '2px 6px',
            background: 'var(--canvas)',
          }}
        >
          <span>⌘</span>
          <span>K</span>
        </span>

        <button
          type="submit"
          aria-label="Send"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '4px',
            fontFamily: 'var(--font-mono-operator)',
            fontSize: '11px',
            color: 'var(--ink-2)',
            background: 'var(--canvas)',
            border: '1px solid var(--hairline)',
            borderRadius: '4px',
            padding: '3px 8px',
            cursor: 'pointer',
            letterSpacing: '0.04em',
          }}
        >
          <span aria-hidden="true">↵</span>
          <span>send</span>
        </button>

        {/*
         * Clear-context button. Hidden in default state; visible (and
         * focusable) when `selectedItem` is non-null. Click clears the
         * selection via `onClearContext`, which also collapses this
         * back to the default branch.
         */}
        {inContext ? (
          <button
            type="button"
            data-clear-context="true"
            aria-label="Clear context"
            onClick={() => onClearContext?.()}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px',
              fontFamily: 'var(--font-sans-operator)',
              fontSize: '11px',
              color: 'var(--terracotta)',
              background: 'transparent',
              border: '1px solid var(--terracotta-soft, var(--hairline))',
              borderRadius: '4px',
              padding: '3px 8px',
              cursor: 'pointer',
              letterSpacing: '0.02em',
            }}
          >
            <span aria-hidden="true">×</span>
            <span>clear context</span>
          </button>
        ) : null}
      </form>

      {/* Eyebrow + chips row */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
          flexWrap: 'wrap',
        }}
      >
        {inContext ? (
          <span
            data-ask-eyebrow="IN_CONTEXT"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              fontFamily: 'var(--font-mono-operator)',
              fontSize: '10.5px',
              letterSpacing: '0.12em',
              textTransform: 'uppercase',
              color: 'var(--terracotta)',
            }}
          >
            <span
              aria-hidden="true"
              className="ask-odesa-pulse-dot"
              style={{
                width: '6px',
                height: '6px',
                borderRadius: '999px',
                background: 'var(--terracotta)',
              }}
            />
            IN CONTEXT — {selectedItem.contextLabel.toUpperCase()}
          </span>
        ) : (
          <span
            data-ask-eyebrow="TRY"
            style={{
              fontFamily: 'var(--font-mono-operator)',
              fontSize: '10.5px',
              letterSpacing: '0.12em',
              textTransform: 'uppercase',
              color: 'var(--ink-3)',
            }}
          >
            TRY
          </span>
        )}

        {/*
         * The `key` flips on every selection identity change so React
         * mounts a fresh wrapper and the CSS `transition: opacity` runs
         * from the initial render. `animation: askOdesaChipsFade` is a
         * simple opacity 0 → 1 keyframe scoped via globals.css; the
         * fallback `transition` alone is enough if the keyframe is
         * absent — the chips still appear, just without the fade.
         */}
        <div
          key={chipKey}
          data-ask-chips="true"
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: '8px',
            animation: 'askOdesaChipsFade 200ms ease both',
          }}
        >
          {chips.map((chip) => (
            <button
              key={chip}
              type="button"
              data-suggestion-chip={toKebab(chip)}
              onClick={() => handleChipClick(chip)}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                background: 'var(--canvas)',
                border: '1px solid var(--hairline)',
                borderRadius: '999px',
                padding: '6px 12px',
                color: 'var(--ink-2)',
                fontFamily: 'var(--font-sans-operator)',
                fontSize: '12.5px',
                lineHeight: 1.2,
                cursor: 'pointer',
                transition: 'opacity 200ms ease',
              }}
            >
              <span
                aria-hidden="true"
                style={{ color: 'var(--ink-4)', fontSize: '12px' }}
              >
                ›
              </span>
              <span>{chip}</span>
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
