'use client';

import { useRouter } from 'next/navigation';
import {
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';

/**
 * "Ask Odesa" bar for the /owner-queue "Decisions Desk".
 *
 * Reproduces the locked mockup `.ask` bar: a single input row (mono ⌘
 * prompt glyph, free-text input, ↵ kbd hint) over a suggestions row
 * (context dot + uppercased context label + tappable suggestion chips).
 *
 * Owns its input value via local state. Submitting (Enter) and tapping a
 * suggestion chip both navigate to `/assistant?q=…` (read-only routing,
 * mirrors `inbox/ask-odesa-bar.tsx`). All colors come from the warm CSS
 * custom properties (no hardcoded hex).
 */

export interface AskOdesaPanelProps {
  /**
   * Suggestion chip labels. When omitted or empty the panel falls back
   * to the control-oriented defaults below.
   */
  suggestions?: string[];
  /** Context scope label, e.g. "Across all decisions" (rendered uppercased). */
  contextLabel: string;
}

const PLACEHOLDER = 'Ask Odesa about your pending decisions…';

/**
 * Control-oriented default chips: each maps to a question the owner can
 * use to scope, audit, or set guidance over the pending queue. Tapping a
 * chip routes to `/assistant?q=…` with the chip text as the query.
 */
const DEFAULT_SUGGESTIONS: string[] = [
  'Which decisions actually send a message?',
  "What's the cash impact if I approve all?",
  'What guidance should I set from these?',
  'Show only the ones that need my review',
];

const askStyle: CSSProperties = {
  maxWidth: 860,
  margin: '24px auto 8px',
  background: 'var(--panel)',
  border: '1px solid var(--hairline)',
  borderRadius: 10,
  padding: '11px 16px 12px',
};

const inputRowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  paddingBottom: 9,
  borderBottom: '1px solid var(--hairline-faint)',
};

const promptStyle: CSSProperties = {
  fontFamily: 'var(--font-mono-operator), ui-monospace, monospace',
  fontSize: '13px',
  color: 'var(--terracotta)',
  fontWeight: 500,
};

const inputStyle: CSSProperties = {
  flex: 1,
  background: 'transparent',
  border: 'none',
  outline: 'none',
  fontSize: '13.5px',
  color: 'var(--ink)',
  caretColor: 'var(--terracotta)',
  fontFamily: 'var(--font-sans-operator), system-ui, sans-serif',
};

const kbdStyle: CSSProperties = {
  fontFamily: 'var(--font-mono-operator), ui-monospace, monospace',
  fontSize: '11px',
  color: 'var(--ink-3)',
};

const suggestionsStyle: CSSProperties = {
  display: 'flex',
  gap: 7,
  paddingTop: 9,
  flexWrap: 'wrap',
  alignItems: 'center',
};

const labelStyle: CSSProperties = {
  fontFamily: 'var(--font-mono-operator), ui-monospace, monospace',
  fontSize: '9.5px',
  fontWeight: 500,
  letterSpacing: '0.14em',
  textTransform: 'uppercase',
  color: 'var(--terracotta)',
  marginRight: 3,
  display: 'inline-flex',
  alignItems: 'center',
  gap: 5,
};

const dotStyle: CSSProperties = {
  width: 4,
  height: 4,
  borderRadius: '50%',
  background: 'var(--terracotta)',
  boxShadow: '0 0 0 2px rgba(184, 87, 49, 0.15)',
};

const chipStyle: CSSProperties = {
  fontSize: '11.5px',
  color: 'var(--ink-2)',
  background: 'var(--canvas)',
  border: '1px solid var(--hairline)',
  borderRadius: 5,
  padding: '4px 9px',
  letterSpacing: '-0.003em',
  cursor: 'pointer',
};

export function AskOdesaPanel({ suggestions, contextLabel }: AskOdesaPanelProps) {
  const router = useRouter();
  const [value, setValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const chips =
    suggestions && suggestions.length > 0 ? suggestions : DEFAULT_SUGGESTIONS;

  function contextualize(text: string): string {
    return `Owner Queue context — ${contextLabel}: ${text.trim()}`;
  }

  function handleKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    const trimmed = value.trim();
    if (trimmed.length === 0) return;
    router.push(`/assistant?q=${encodeURIComponent(contextualize(trimmed))}`);
    setValue('');
  }

  function handleChip(text: string) {
    router.push(`/assistant?q=${encodeURIComponent(contextualize(text))}`);
  }

  return (
    <div style={askStyle}>
      <div style={inputRowStyle}>
        <span aria-hidden="true" style={promptStyle}>
          ⌘
        </span>
        <label className="sr-only" htmlFor="ask-odesa-input">
          Ask Odesa about your pending decisions
        </label>
        <input
          id="ask-odesa-input"
          ref={inputRef}
          data-testid="ask-odesa-input"
          style={inputStyle}
          placeholder={PLACEHOLDER}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={handleKeyDown}
        />
        <span aria-hidden="true" style={kbdStyle}>
          ↵
        </span>
      </div>
      <div style={suggestionsStyle}>
        <span style={labelStyle}>
          <span aria-hidden="true" style={dotStyle} />
          {contextLabel.toUpperCase()}
        </span>
        {chips.map((suggestion) => (
          <button
            key={suggestion}
            type="button"
            data-testid="ask-chip"
            data-suggestion-chip={suggestion}
            style={chipStyle}
            onClick={() => handleChip(suggestion)}
          >
            {suggestion}
          </button>
        ))}
      </div>
    </div>
  );
}
