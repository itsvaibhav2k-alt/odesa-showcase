import Link from 'next/link';

export interface AskOdesaProps {
  /** Prompt shown in the input affordance. */
  placeholder?: string;
  /**
   * Suggested prompts. Each links to `/assistant?q=<prompt>` so the
   * assistant can prefill; if the page ignores `?q` it still lands
   * users on the assistant.
   */
  suggestions?: string[];
}

const DEFAULT_PLACEHOLDER = 'Ask Odesa about rent, maintenance, tenants, or deadlines…';

const DEFAULT_SUGGESTIONS: readonly string[] = [
  'Who needs follow-up?',
  'What changed since yesterday?',
  'Draft rent reminders.',
];

/** Builds the assistant href, prefilling the conversation via `?q`. */
function assistantHref(query?: string): string {
  if (!query) return '/assistant';
  return `/assistant?q=${encodeURIComponent(query)}`;
}

/**
 * Command entry into the assistant. Presentational only — it is a
 * styled link plus suggestion chips, not a live chat panel, so the
 * rail stays a server component and the conversation lives at
 * `/assistant`.
 */
export function AskOdesa({
  placeholder = DEFAULT_PLACEHOLDER,
  suggestions = [...DEFAULT_SUGGESTIONS],
}: AskOdesaProps) {
  return (
    <section
      data-testid="today-ask-odesa"
      style={{
        background: 'var(--paper-0)',
        border: '1px solid var(--ink-200)',
        borderRadius: 'var(--radius-lg-odesa)',
        padding: '16px',
        display: 'flex',
        flexDirection: 'column',
        gap: '12px',
      }}
    >
      {/* Input affordance — a link styled as an input, not a real field */}
      <Link
        href={assistantHref()}
        data-testid="today-ask-odesa-input"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
          background: 'var(--paper-0)',
          border: '1px solid var(--ink-200)',
          borderRadius: 'var(--radius-md-odesa)',
          padding: '12px 14px',
          textDecoration: 'none',
        }}
      >
        <svg
          width="18"
          height="18"
          viewBox="0 0 18 18"
          fill="none"
          stroke="var(--navy-700)"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          style={{ flexShrink: 0 }}
        >
          <path d="M3 5.5A2.5 2.5 0 0 1 5.5 3h7A2.5 2.5 0 0 1 15 5.5v4A2.5 2.5 0 0 1 12.5 12H7l-3.5 3v-3A2.5 2.5 0 0 1 3 9.5Z" />
        </svg>
        <span
          style={{
            flex: 1,
            fontSize: '13px',
            color: 'var(--ink-500)',
            minWidth: 0,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {placeholder}
        </span>
        <span
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: '10px',
            letterSpacing: '0.04em',
            color: 'var(--navy-700)',
            flexShrink: 0,
          }}
        >
          Ask →
        </span>
      </Link>

      {/* Suggested prompt chips */}
      {suggestions.length > 0 && (
        <div
          data-testid="today-ask-odesa-suggestions"
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: '8px',
          }}
        >
          {suggestions.map((prompt) => (
            <Link
              key={prompt}
              href={assistantHref(prompt)}
              data-testid="today-ask-odesa-suggestion"
              style={{
                fontSize: '11px',
                color: 'var(--ink-600)',
                border: '1px solid var(--ink-200)',
                borderRadius: 'var(--radius-sm-odesa)',
                padding: '6px 10px',
                textDecoration: 'none',
                background: 'var(--paper-0)',
              }}
            >
              {prompt}
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}
