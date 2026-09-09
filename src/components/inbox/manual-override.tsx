'use client';

/**
 * ManualOverride — bordered single-line input row at the bottom of
 * the case file column.
 *
 * The override row is the authenticated operator's deliberate manual send:
 * type, press Enter, send. AI-generated tenant drafts use the separate
 * review flow. Quiet visual weight keeps this control from pressuring the
 * operator into a reply.
 *
 * Wires via the existing `ConversationsValue.sendOwner` interface so
 * the auth gate and Sendblue handoff stay in `sendOwnerMessageAction`.
 *
 * Test-ids preserved from Wave 3:
 *   - `inbox-compose-row`      → form
 *   - `inbox-compose-textarea` → input
 *   - `inbox-compose-send`     → hidden submit (Enter sends)
 */

import { useEffect, useRef, type FormEvent, type KeyboardEvent } from 'react';

import { useConversations } from '@/components/inbox/conversations-context';

export function ManualOverride() {
  const {
    composeBody,
    setComposeBody,
    sending,
    sendOwner,
    registerComposeRef,
  } = useConversations();

  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // Wave 7 — let the provider focus this input when an Ask Odesa
  // prefill_override chip fires. Cleanup on unmount.
  useEffect(() => {
    const unregister = registerComposeRef(textareaRef);
    return unregister;
  }, [registerComposeRef]);

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (sending || composeBody.trim().length === 0) return;
    void sendOwner();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      if (sending || composeBody.trim().length === 0) return;
      void sendOwner();
    }
  };

  return (
    <form
      onSubmit={handleSubmit}
      data-testid='inbox-compose-row'
      className='flex items-center gap-3'
      style={{
        background: 'var(--panel-clean, #FFFDF6)',
        borderTop: '1px solid var(--hairline-faint, #EAE0CA)',
        padding: '12px 36px',
      }}
    >
      <textarea
        ref={textareaRef}
        value={composeBody}
        onChange={(e) => setComposeBody(e.target.value)}
        onKeyDown={handleKeyDown}
        rows={1}
        placeholder='type only if you want to step in…'
        data-testid='inbox-compose-textarea'
        className='flex-1 resize-none focus:outline-none transition-colors'
        style={{
          background: 'transparent',
          border: '1px solid var(--hairline-faint, #EAE0CA)',
          borderRadius: '6px',
          padding: '8px 12px',
          fontSize: '13px',
          fontFamily: 'var(--font-sans-operator, system-ui, sans-serif)',
          color: 'var(--ink, #1B1712)',
          lineHeight: 1.5,
          maxHeight: '6rem',
        }}
      />
      <button
        type='submit'
        disabled={sending || composeBody.trim().length === 0}
        data-testid='inbox-compose-send'
        aria-label='Send message'
        style={{
          border: '1px solid var(--hairline, #D8C6A5)',
          borderRadius: '999px',
          background:
            sending || composeBody.trim().length === 0
              ? 'var(--paper-muted, #F3EBDD)'
              : 'var(--ink, #1B1712)',
          color:
            sending || composeBody.trim().length === 0
              ? 'var(--ink-500, #8A7A64)'
              : 'var(--panel-clean, #FFFDF6)',
          cursor:
            sending || composeBody.trim().length === 0 ? 'not-allowed' : 'pointer',
          fontFamily: 'var(--font-mono-operator, ui-monospace, monospace)',
          fontSize: '11px',
          letterSpacing: '0.08em',
          lineHeight: 1,
          padding: '9px 12px',
          textTransform: 'uppercase',
          transition: 'background 160ms ease, color 160ms ease, opacity 160ms ease',
          whiteSpace: 'nowrap',
        }}
      >
        {sending ? 'Sending' : 'Send'}
      </button>
    </form>
  );
}
