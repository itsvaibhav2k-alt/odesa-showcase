'use client';

/**
 * Owner Review — interactive action island.
 *
 * The only client piece of the review surface: Odesa's editable draft (when
 * present), the action buttons, the error line, and the post-action "handled"
 * confirmation + Back-to-Today link. Everything else on the page is server-
 * rendered. Dispatches to the per-kind review server actions by `action.id`.
 */

import { useState, useTransition, type CSSProperties } from 'react';
import Link from 'next/link';

import { HandledStatusBlock } from '@/components/inbox/handled-status-block';
import type { ReviewAction, ReviewActionResult } from '@/lib/review/types';
import {
  decideRentReviewAction,
  sendRentReminderAction,
  decideConversationReviewAction,
  sendConversationReplyAction,
  decideWorkOrderReviewAction,
} from '@/app/(dashboard)/review/actions';

interface ReviewActionPanelProps {
  id: string;
  draft: { body: string; editable: boolean } | null;
  actions: ReviewAction[];
  recommendation: string;
  backHref: string;
  /** VA view: evidence and draft remain visible, owner controls do not. */
  readOnly?: boolean;
}

const draftWrap: CSSProperties = {
  border: '1px solid var(--hairline)',
  borderRadius: '10px',
  background: 'var(--panel-lift)',
  padding: '14px 16px',
  marginBottom: '18px',
};
const draftLabel: CSSProperties = {
  fontFamily: 'var(--font-mono-operator)',
  fontSize: '10.5px',
  letterSpacing: '0.12em',
  textTransform: 'uppercase',
  color: 'var(--ink-3)',
  marginBottom: '8px',
};
const draftBox: CSSProperties = {
  width: '100%',
  minHeight: '92px',
  padding: '11px 13px',
  border: '1px solid var(--hairline)',
  borderRadius: '8px',
  background: 'var(--panel-clean)',
  color: 'var(--ink)',
  fontFamily: 'var(--font-sans-operator)',
  fontSize: '14px',
  lineHeight: 1.5,
  resize: 'vertical',
  boxSizing: 'border-box',
};
const actionsRow: CSSProperties = {
  display: 'flex',
  gap: '10px',
  flexWrap: 'wrap',
  margin: '0 0 4px',
};
const btnBase: CSSProperties = {
  fontFamily: 'var(--font-sans-operator)',
  fontSize: '13px',
  fontWeight: 450,
  padding: '9px 16px',
  borderRadius: '8px',
  border: '1px solid var(--hairline-strong)',
  background: 'var(--panel-lift)',
  color: 'var(--ink)',
  cursor: 'pointer',
  textDecoration: 'none',
  display: 'inline-block',
};
const btnPrimary: CSSProperties = {
  ...btnBase,
  background: 'var(--ink)',
  color: 'var(--panel-lift)',
  borderColor: 'var(--ink)',
};
const errStyle: CSSProperties = {
  color: 'var(--terracotta)',
  fontSize: '12.5px',
  marginBottom: '12px',
};
const backLink: CSSProperties = {
  color: 'var(--terracotta)',
  fontSize: '13px',
  textDecoration: 'none',
};

function toKebab(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function ReviewActionPanel({
  id,
  draft,
  actions,
  recommendation,
  backHref,
  readOnly = false,
}: ReviewActionPanelProps) {
  const [body, setBody] = useState(draft?.body ?? '');
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [handled, setHandled] = useState<string | null>(null);

  function run(action: ReviewAction) {
    setError(null);
    startTransition(async () => {
      const result = await dispatchReviewAction(
        id,
        action,
        body,
        recommendation,
      );
      if (result.ok) {
        setHandled(action.label);
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <section data-section="review-actions" style={{ margin: '0 0 26px' }}>
      {draft ? (
        <div style={draftWrap}>
          <div style={draftLabel}>
            Odesa&apos;s draft ·{' '}
            {readOnly ? 'view for owner review' : 'editable before send'}
          </div>
          <textarea
            data-testid="review-draft"
            style={draftBox}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            disabled={Boolean(handled)}
            readOnly={readOnly}
          />
        </div>
      ) : null}

      {readOnly ? (
        <div
          data-testid="review-owner-boundary"
          style={{
            ...draftWrap,
            marginBottom: 0,
            fontFamily: 'var(--font-sans-operator)',
            fontSize: '13px',
            lineHeight: 1.5,
            color: 'var(--ink-2)',
          }}
        >
          Review the context here, then use Shift support to prepare an owner
          handoff. Owner approval is required for tenant, money, lease, and
          vendor-facing actions.
        </div>
      ) : handled ? (
        <div data-testid="review-handled">
          <HandledStatusBlock
            title="Handled"
            body={`"${handled}" recorded. Odesa updated your queue.`}
          />
          <div style={{ margin: '14px 0 0 36px' }}>
            <Link href={backHref} style={backLink}>
              ← Back to Today
            </Link>
          </div>
        </div>
      ) : (
        <>
          {error ? (
            <div role="alert" style={errStyle}>
              {error}
            </div>
          ) : null}
          <div style={actionsRow}>
            {actions.map((action) =>
              action.kind === 'link' && action.href ? (
                <Link
                  key={action.id}
                  href={action.href}
                  data-action={toKebab(action.label)}
                  style={action.variant === 'primary' ? btnPrimary : btnBase}
                >
                  {action.label}
                </Link>
              ) : (
                <button
                  key={action.id}
                  type="button"
                  data-action={toKebab(action.label)}
                  disabled={pending}
                  style={action.variant === 'primary' ? btnPrimary : btnBase}
                  onClick={() => run(action)}
                >
                  {pending ? 'Working…' : action.label}
                </button>
              ),
            )}
          </div>
        </>
      )}
    </section>
  );
}

/** Maps a (id, action) pair to the right server action call. */
async function dispatchReviewAction(
  id: string,
  action: ReviewAction,
  body: string,
  recommendation: string,
): Promise<ReviewActionResult> {
  switch (action.id) {
    case 'rent.send_reminder':
      return sendRentReminderAction(id, body || recommendation);
    case 'rent.escalate':
      return decideRentReviewAction(id, 'escalate');
    case 'rent.arrange_plan':
      return decideRentReviewAction(id, 'arrange_plan');
    case 'conversation.send_reply':
      return sendConversationReplyAction(id, body);
    case 'conversation.resolve':
      return decideConversationReviewAction(id, 'resolve');
    case 'work_order.start':
      return decideWorkOrderReviewAction(id, 'start');
    default:
      return { ok: false, error: 'Unknown action' };
  }
}
