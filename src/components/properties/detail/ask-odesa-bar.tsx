'use client';

/**
 * AskOdesaBar — scoped "Ask Odesa" input bar for interior detail pages.
 *
 * Single-line input with a visually-hidden <label> and aria-hidden ⌘ glyph.
 * Every clickable control performs an EXPLICIT handoff to the global
 * assistant: suggestion chips, the Enter key, and the always-visible submit
 * affordance all route to /assistant?q=<contextualized query> so property
 * scope is never lost. Mirrors ask-odesa-panel.tsx idioms adapted to the
 * unit-detail mockup's .ask / .ask-row / .ask-sugg / .sugg pattern.
 *
 * Server default: 'use client' only because of useState/useRef.
 */

import {
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import { useRouter } from 'next/navigation';

export interface AskOdesaBarProps {
  /** Aria label suffix and context label, e.g. "Unit 1A". */
  scopeLabel: string;
  /** Input placeholder text. */
  placeholder: string;
  /** Suggestion chip labels. */
  prompts: string[];
  /** Submit CTA copy; defaults to the property-level wording. */
  submitLabel?: string;
}

const wrapStyle: CSSProperties = {
  background: 'var(--panel)',
  border: '1px solid var(--hairline)',
  borderRadius: 12,
  padding: '12px 16px 13px',
  marginTop: 8,
};

const inputRowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  paddingBottom: 10,
  borderBottom: '1px solid var(--hairline-faint)',
};

const promptGlyphStyle: CSSProperties = {
  fontFamily: 'var(--font-mono-operator)',
  fontSize: '13px',
  color: 'var(--terracotta)',
  fontWeight: 500,
  flexShrink: 0,
};

const inputStyle: CSSProperties = {
  flex: 1,
  background: 'transparent',
  border: 'none',
  outline: 'none',
  fontSize: '13.5px',
  color: 'var(--ink)',
  caretColor: 'var(--terracotta)',
  fontFamily: 'var(--font-sans-operator)',
};

const kbdStyle: CSSProperties = {
  fontFamily: 'var(--font-mono-operator)',
  fontSize: '10.5px',
  color: 'var(--ink-2)',
  padding: '1px 6px',
  border: '1px solid var(--hairline-strong)',
  borderRadius: 3,
  background: 'var(--canvas)',
  flexShrink: 0,
};

const suggestionsStyle: CSSProperties = {
  display: 'flex',
  gap: 7,
  paddingTop: 10,
  flexWrap: 'wrap',
  alignItems: 'center',
};

const contextLabelStyle: CSSProperties = {
  fontFamily: 'var(--font-mono-operator)',
  fontSize: '9.5px',
  fontWeight: 500,
  letterSpacing: '0.13em',
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
  padding: '5px 10px',
  letterSpacing: '-0.003em',
  cursor: 'pointer',
  fontFamily: 'inherit',
};

const submitRowStyle: CSSProperties = {
  display: 'flex',
  justifyContent: 'flex-end',
  paddingTop: 11,
  marginTop: 9,
  borderTop: '1px solid var(--hairline-faint)',
};

const submitButtonStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 7,
  fontSize: '12px',
  fontWeight: 600,
  letterSpacing: '-0.005em',
  color: 'var(--paper-0, #fff)',
  background: 'var(--terracotta)',
  border: '1px solid var(--terracotta)',
  borderRadius: 7,
  padding: '7px 14px',
  cursor: 'pointer',
  fontFamily: 'inherit',
};

export function AskOdesaBar({
  scopeLabel,
  placeholder,
  prompts,
  submitLabel = 'Ask Odesa about this property',
}: AskOdesaBarProps) {
  const router = useRouter();
  const [value, setValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const inputId = `ask-bar-${scopeLabel.toLowerCase().replace(/\s+/g, '-')}`;

  /**
   * Execute the handoff to the global assistant with property context
   * preserved, so the scope isn't lost once the user leaves the page.
   */
  function ask(prompt: string) {
    const query = prompt.trim();
    if (query.length === 0) return;
    const contextualized = `About ${scopeLabel}: ${query}`;
    router.push('/assistant?q=' + encodeURIComponent(contextualized));
  }

  function handleKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    ask(value);
  }

  function handleChip(text: string) {
    ask(text);
  }

  const trimmedValue = value.trim();

  return (
    <>
      <div style={wrapStyle} data-ask-bar>
        <div style={inputRowStyle}>
          {/* ⌘ glyph — decorative, screen-reader hidden */}
          <span aria-hidden="true" style={promptGlyphStyle}>
            ⌘
          </span>

          {/* Visually hidden label satisfies a11y labelling */}
          <label className="sr-only" htmlFor={inputId}>
            {`Ask Odesa about ${scopeLabel}`}
          </label>

          <input
            id={inputId}
            ref={inputRef}
            style={inputStyle}
            placeholder={placeholder}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={handleKeyDown}
            data-testid="ask-odesa-bar-input"
          />

          {/* ↵ keyboard hint — decorative */}
          <span aria-hidden="true" style={kbdStyle}>
            ↵
          </span>
        </div>

        <div style={suggestionsStyle}>
          <span style={contextLabelStyle}>
            <span aria-hidden="true" style={dotStyle} />
            {`In context — ${scopeLabel}`}
          </span>

          {prompts.map((prompt) => (
            <button
              key={prompt}
              type="button"
              style={chipStyle}
              onClick={() => handleChip(prompt)}
              data-testid="ask-bar-chip"
              className="ask-bar-chip"
            >
              {prompt}
            </button>
          ))}
        </div>

        <div style={submitRowStyle}>
          <button
            type="button"
            style={submitButtonStyle}
            onClick={() => ask(value)}
            disabled={trimmedValue.length === 0}
            data-testid="ask-bar-submit"
            className="ask-bar-submit"
          >
            {submitLabel}
            <span aria-hidden="true">→</span>
          </button>
        </div>
      </div>
      <AskOdesaBarStyles />
    </>
  );
}

function AskOdesaBarStyles() {
  return (
    <style precedence="ask-odesa-bar">{`
      .ask-bar-chip:hover {
        border-color: var(--hairline-strong);
        color: var(--ink);
        background: var(--panel-lift);
      }
      .ask-bar-chip:focus-visible {
        outline: 2px solid var(--terracotta);
        outline-offset: 2px;
      }
      .ask-bar-submit {
        transition: filter 0.12s ease, opacity 0.12s ease;
      }
      .ask-bar-submit:hover:not(:disabled) {
        filter: brightness(0.94);
      }
      .ask-bar-submit:focus-visible {
        outline: 2px solid var(--terracotta);
        outline-offset: 2px;
      }
      .ask-bar-submit:disabled {
        opacity: 0.45;
        cursor: not-allowed;
      }
    `}</style>
  );
}
