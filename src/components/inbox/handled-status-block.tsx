'use client';

/**
 * HandledStatusBlock — green hero block shown when there's no pending
 * draft and the conversation is in a resolved/handled state.
 *
 * Visual per `mockup-extracts/draft-hero.md` (bottom section):
 *   - bg `--green-bg`, border `--green-border`, inset 4px `--green-warm`
 *   - 32×32 round icon circle (green-warm bg, white check)
 *   - sans 14px title, sans 12.5px body
 *
 * Rendered inline in the hero slot (above the timeline). Title +
 * body copy default to a neutral "handled" line; callers can override.
 */

export interface HandledStatusBlockProps {
  title?: string;
  body?: string;
}

export function HandledStatusBlock({
  title = 'Resolved',
  body = 'Odesa already replied. Watching for follow-up.',
}: HandledStatusBlockProps) {
  return (
    <div
      className='flex items-start gap-3'
      style={{
        margin: '24px 36px 0',
        background: 'var(--green-bg, #D8E5D2)',
        border: '1px solid var(--green-border, #B0C7A8)',
        boxShadow: 'inset 4px 0 0 var(--green-warm, #4D7A56)',
        borderRadius: '10px',
        padding: '14px 18px',
      }}
    >
      <span
        aria-hidden='true'
        className='flex items-center justify-center flex-shrink-0'
        style={{
          width: '32px',
          height: '32px',
          borderRadius: '50%',
          background: 'var(--green-warm, #4D7A56)',
          color: '#FFFFFF',
          fontSize: '15px',
          lineHeight: 1,
          fontWeight: 600,
        }}
      >
        ✓
      </span>
      <div className='flex flex-col gap-0.5 min-w-0'>
        <h3
          className='m-0'
          style={{
            fontFamily: 'var(--font-sans-operator, system-ui, sans-serif)',
            fontSize: '14px',
            fontWeight: 500,
            color: 'var(--green-ink, #2E4A33)',
            letterSpacing: '-0.005em',
          }}
        >
          {title}
        </h3>
        <p
          className='m-0'
          style={{
            fontFamily: 'var(--font-sans-operator, system-ui, sans-serif)',
            fontSize: '12.5px',
            color: 'var(--green-ink, #2E4A33)',
            opacity: 0.8,
            lineHeight: 1.5,
          }}
        >
          {body}
        </p>
      </div>
    </div>
  );
}
