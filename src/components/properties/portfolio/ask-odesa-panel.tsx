"use client";

import { Send } from "lucide-react";
import {
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { useRouter } from "next/navigation";

/**
 * "Ask Odesa" bar for the /properties "portfolio operations command center".
 *
 * Reproduces the locked mockup's `.ask` bar: a single input row (mono ⌘ prompt
 * glyph, free-text input, ↵ kbd hint) over a suggestions row (context dot +
 * uppercased context label + tappable suggestion chips).
 *
 * Owns its input value via local state and holds a ref to the input so chips
 * can refocus it. Submitting routes to the live assistant query entrypoint.
 * Suggestion chips fill the input and refocus it. All colors come from the
 * warm CSS custom properties (no hardcoded hex).
 */

export interface AskOdesaPanelProps {
  /** Suggestion chip labels, scoped across all properties. */
  prompts: string[];
  variant?: "portfolio" | "compact" | "map";
  placeholder?: string;
}

const PLACEHOLDER = "Ask Odesa about your portfolio…";
const CONTEXT_LABEL = "Across all properties";

const askStyle: CSSProperties = {
  width: "100%",
  margin: "24px auto 8px",
  background: "var(--panel)",
  border: "1px solid var(--hairline)",
  borderRadius: 10,
  padding: "11px 16px 12px",
};

const mapAskStyle: CSSProperties = {
  margin: 0,
  background: "var(--panel)",
  borderRadius: 8,
  padding: "12px 14px",
};

const inputRowStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 12,
  paddingBottom: 9,
  borderBottom: "1px solid var(--hairline-faint)",
};

const promptStyle: CSSProperties = {
  fontFamily: "var(--font-mono-operator), ui-monospace, monospace",
  fontSize: "13px",
  color: "var(--terracotta)",
  fontWeight: 500,
};

const inputStyle: CSSProperties = {
  flex: 1,
  minWidth: 0,
  background: "transparent",
  border: "none",
  outline: "none",
  fontSize: "13.5px",
  color: "var(--ink)",
  caretColor: "var(--terracotta)",
  fontFamily: "var(--font-sans-operator), system-ui, sans-serif",
};

const kbdStyle: CSSProperties = {
  fontFamily: "var(--font-mono-operator), ui-monospace, monospace",
  fontSize: "11px",
  color: "var(--ink-3)",
};

const suggestionsStyle: CSSProperties = {
  display: "flex",
  gap: 7,
  paddingTop: 9,
  flexWrap: "wrap",
  alignItems: "center",
};

const labelStyle: CSSProperties = {
  fontFamily: "var(--font-mono-operator), ui-monospace, monospace",
  fontSize: "9.5px",
  fontWeight: 500,
  letterSpacing: 0,
  textTransform: "uppercase",
  color: "var(--terracotta)",
  marginRight: 3,
  display: "inline-flex",
  alignItems: "center",
  gap: 5,
};

const dotStyle: CSSProperties = {
  width: 4,
  height: 4,
  borderRadius: "50%",
  background: "var(--terracotta)",
  boxShadow: "0 0 0 2px rgba(184, 87, 49, 0.15)",
};

const chipStyle: CSSProperties = {
  fontSize: "11.5px",
  color: "var(--ink-2)",
  background: "var(--canvas)",
  border: "1px solid var(--hairline)",
  borderRadius: 5,
  padding: "4px 9px",
  letterSpacing: 0,
  cursor: "pointer",
};

const sendButtonStyle: CSSProperties = {
  width: 36,
  height: 36,
  flex: "0 0 auto",
  border: "1px solid var(--hairline)",
  borderRadius: 6,
  background: "var(--panel-lift)",
  color: "var(--ink-2)",
  display: "inline-grid",
  placeItems: "center",
  cursor: "pointer",
};

export function AskOdesaPanel({
  prompts,
  variant = "portfolio",
  placeholder = PLACEHOLDER,
}: AskOdesaPanelProps) {
  const router = useRouter();
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const isMapVariant = variant === "map";
  const isCompactVariant = variant === "compact";
  const isInlineVariant = isMapVariant || isCompactVariant;
  const isEmpty = value.trim().length === 0;

  function submit(): void {
    const query = value.trim();
    if (query.length === 0) return;
    const contextualized = `Properties context — assigned property records: ${query}`;
    router.push("/assistant?q=" + encodeURIComponent(contextualized));
  }

  function handleKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (event.key !== "Enter") return;
    event.preventDefault();
    submit();
  }

  function handleChip(text: string) {
    setValue(text);
    inputRef.current?.focus();
  }

  return (
    <div style={{ ...askStyle, ...(isInlineVariant ? mapAskStyle : null) }}>
      <div
        style={{
          ...inputRowStyle,
          ...(isInlineVariant ? { paddingBottom: 0, borderBottom: 0 } : null),
        }}
      >
        <span aria-hidden="true" style={promptStyle}>
          ⌘
        </span>
        <label className="sr-only" htmlFor="ask-odesa-input">
          Ask Odesa about your portfolio
        </label>
        <input
          id="ask-odesa-input"
          ref={inputRef}
          data-testid="ask-odesa-input"
          style={inputStyle}
          placeholder={placeholder}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={handleKeyDown}
        />
        {isInlineVariant ? (
          <button
            type="button"
            aria-label="Send Ask Odesa prompt"
            data-testid={isMapVariant ? "ask-odesa-map-send" : "ask-odesa-send"}
            style={{
              ...sendButtonStyle,
              ...(isEmpty ? { opacity: 0.5, cursor: "not-allowed" } : null),
            }}
            disabled={isEmpty}
            onClick={submit}
          >
            <Send size={15} strokeWidth={1.7} />
          </button>
        ) : (
          <span aria-hidden="true" style={kbdStyle}>
            ↵
          </span>
        )}
      </div>
      {isInlineVariant ? null : (
        <div style={suggestionsStyle}>
          <span style={labelStyle}>
            <span aria-hidden="true" style={dotStyle} />
            {CONTEXT_LABEL}
          </span>
          {prompts.map((prompt) => (
            <button
              key={prompt}
              type="button"
              data-testid="ask-chip"
              style={chipStyle}
              onClick={() => handleChip(prompt)}
            >
              {prompt}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
