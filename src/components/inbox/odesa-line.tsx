'use client';

/**
 * OdesaLine — terracotta badge + one-line synthesis above the timeline.
 *
 * The text + emphasis substrings come from the deterministic
 * `buildOdesaLine` synthesiser. The renderer just walks the text,
 * splitting on the emphasis substrings to bold them inline.
 */

import { Fragment } from 'react';

import {
  buildOdesaLine,
  type OdesaLineStatus,
} from '@/lib/inbox/odesa-line';
import type { ConversationDetail } from '@/lib/inbox/conversation-queries';

export interface OdesaLineProps {
  detail: ConversationDetail;
  status: OdesaLineStatus;
  audience?: 'owner' | 'va';
}

export function OdesaLine({ detail, status, audience = 'owner' }: OdesaLineProps) {
  const { text, emphasis } = buildOdesaLine({
    pendingDraft: detail.pendingDraft,
    status,
    workOrder: detail.caseContext.workOrder,
    payments: detail.caseContext.payments,
    audience,
  });

  return (
    <div
      className='flex items-center gap-3'
      style={{
        background: 'var(--panel-clean, #FFFDF6)',
        padding: '10px 36px',
        borderBottom: '1px solid var(--hairline-faint, #EAE0CA)',
      }}
    >
      <OdesaBadge />
      <p
        className='m-0'
        style={{
          fontFamily: 'var(--font-sans-operator, system-ui, sans-serif)',
          color: 'var(--ink-2, #4A3F30)',
          fontSize: '13px',
          lineHeight: 1.5,
        }}
      >
        {renderEmphasised(text, emphasis)}
      </p>
    </div>
  );
}

function OdesaBadge() {
  return (
    <span
      className='inline-flex items-center gap-1.5 uppercase flex-shrink-0'
      style={{
        fontFamily: 'var(--font-mono-operator, ui-monospace, monospace)',
        fontSize: '9.5px',
        letterSpacing: '0.14em',
        color: 'var(--ink-3, #75674F)',
      }}
    >
      <span
        aria-hidden='true'
        style={{
          display: 'inline-block',
          width: '6px',
          height: '6px',
          borderRadius: '50%',
          background: 'var(--terracotta, #B85731)',
        }}
      />
      Odesa
    </span>
  );
}

/**
 * Render `text` with each emphasis substring wrapped in a <strong>.
 *
 * The algorithm walks the text left-to-right looking for the next
 * emphasis match (any one of `emphasis`). Substrings are matched in
 * the order they appear in the text so the rendered output is stable.
 */
function renderEmphasised(
  text: string,
  emphasis: readonly string[],
): React.ReactNode {
  if (emphasis.length === 0) return text;

  const segments: Array<{ text: string; bold: boolean }> = [];
  let cursor = 0;

  while (cursor < text.length) {
    // Find the earliest emphasis match at or after the cursor.
    let nextStart = -1;
    let nextEnd = -1;
    for (const phrase of emphasis) {
      if (!phrase) continue;
      const idx = text.indexOf(phrase, cursor);
      if (idx === -1) continue;
      if (nextStart === -1 || idx < nextStart) {
        nextStart = idx;
        nextEnd = idx + phrase.length;
      }
    }
    if (nextStart === -1) {
      segments.push({ text: text.slice(cursor), bold: false });
      break;
    }
    if (nextStart > cursor) {
      segments.push({ text: text.slice(cursor, nextStart), bold: false });
    }
    segments.push({ text: text.slice(nextStart, nextEnd), bold: true });
    cursor = nextEnd;
  }

  return (
    <>
      {segments.map((seg, idx) => (
        <Fragment key={idx}>
          {seg.bold ? (
            <strong
              style={{
                fontWeight: 600,
                color: 'var(--ink, #1B1712)',
              }}
            >
              {seg.text}
            </strong>
          ) : (
            seg.text
          )}
        </Fragment>
      ))}
    </>
  );
}
