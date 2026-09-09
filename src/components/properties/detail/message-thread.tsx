/**
 * MessageThread — communication thread for tenant detail pages.
 *
 * Mirrors the mockup `.msg` / `.msg-head` / `.msg-body` / `.msg-body.draft`
 * structure. Odesa messages render the sender name in terracotta; draft
 * messages use serif italic. The last row drops its bottom border via a
 * hoisted scoped style.
 *
 * Server component — no client interactivity here. Action buttons below the
 * thread are passed from the parent (the parent island wires onClick).
 */

import type { CSSProperties } from 'react';
import type { ThreadMessage } from '@/lib/properties/mock-detail';

export interface MessageThreadProps {
  messages: ThreadMessage[];
}

const threadStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
};

const msgStyle: CSSProperties = {
  padding: '12px 0',
  borderBottom: '1px solid var(--hairline-faint)',
};

const headStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'baseline',
  gap: 10,
  marginBottom: 4,
};

const whoStyle: CSSProperties = {
  fontSize: '12px',
  fontWeight: 500,
  color: 'var(--ink)',
};

const whoOdesaStyle: CSSProperties = {
  ...whoStyle,
  color: 'var(--terracotta)',
};

const timeStyle: CSSProperties = {
  fontFamily: 'var(--font-mono-operator), ui-monospace, monospace',
  fontSize: '10px',
  color: 'var(--ink-3)',
  marginLeft: 'auto',
};

const bodyStyle: CSSProperties = {
  fontSize: '13px',
  color: 'var(--ink-2)',
  lineHeight: 1.5,
};

const draftBodyStyle: CSSProperties = {
  fontFamily: 'var(--font-serif-display), Georgia, serif',
  fontStyle: 'italic',
  fontSize: '14.5px',
  color: 'var(--ink)',
  lineHeight: 1.5,
};

export function MessageThread({ messages }: MessageThreadProps) {
  return (
    <div style={threadStyle} data-message-thread>
      {messages.map((msg, idx) => (
        <div key={idx} style={msgStyle} data-msg>
          <div style={headStyle}>
            <span style={msg.odesa ? whoOdesaStyle : whoStyle}>{msg.who}</span>
            <span style={timeStyle}>{msg.time}</span>
          </div>
          <div style={msg.draft ? draftBodyStyle : bodyStyle}>{msg.body}</div>
        </div>
      ))}
      <MessageThreadStyles />
    </div>
  );
}

function MessageThreadStyles() {
  return (
    <style precedence="message-thread">{`
      [data-message-thread] [data-msg]:last-child {
        border-bottom: none;
      }
    `}</style>
  );
}
