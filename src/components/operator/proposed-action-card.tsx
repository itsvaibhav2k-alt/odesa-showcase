'use client';

/**
 * Inline ProposedActionCard — rendered when the dispatcher emits
 * `proposal.recorded` / `proposal.committed` / `proposal.review_required`.
 *
 * States:
 *
 *   recorded         — neutral "Recorded" eyebrow. Worker just finished;
 *                      gate hasn't decided yet (or this card is held
 *                      momentarily before the next event arrives).
 *   committed        — success eyebrow ("Completed ✓" affordance). No buttons.
 *   review_required  — gold eyebrow + a handoff to Owner Queue. The
 *                      assistant never becomes a second commitment ledger.
 *   dispatching      — transient state received from a legacy event.
 *   rejected         — muted final state.
 */

import Link from 'next/link';
import { ExternalLink } from 'lucide-react';

import type { ActionProposal } from '@/lib/agent/worker/types';

import { formatProposalPayload } from './format-proposal';
import type { ProposalCardStatus } from './types';

export interface ProposedActionCardProps {
  proposal: ActionProposal;
  status: ProposalCardStatus;
}

export function ProposedActionCard({
  proposal,
  status,
}: ProposedActionCardProps) {
  const summary = formatProposalPayload(proposal);
  const palette = paletteForStatus(status);
  const statusLabel =
    status === 'review_required' ? 'Owner approval required' : palette.label;

  return (
    <article
      data-testid="proposed-action-card"
      data-proposal-id={proposal.id ?? 'unknown'}
      data-status={status}
      style={{
        alignSelf: 'flex-start',
        maxWidth: '92%',
        width: '100%',
        background: 'var(--paper-0)',
        border: `1px solid ${palette.border}`,
        borderLeft: `3px solid ${palette.accent}`,
        borderRadius: '12px',
        padding: '14px 16px',
        display: 'flex',
        flexDirection: 'column',
        gap: '10px',
      }}
    >
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '12px',
        }}
      >
        <p
          className="meta-label"
          data-testid="proposed-action-card-status"
          style={{ color: palette.accent, margin: 0 }}
        >
          {statusLabel}
        </p>
        {typeof proposal.confidence === 'number' ? (
          <p
            style={{
              fontFamily: 'var(--font-mono-metrics), monospace',
              fontSize: '11px',
              color: 'var(--ink-500)',
              margin: 0,
            }}
          >
            confidence {Math.round(proposal.confidence * 100)}%
          </p>
        ) : null}
      </header>

      <div>
        <p
          data-testid="proposed-action-card-title"
          style={{
            fontSize: '14px',
            fontWeight: 600,
            color: 'var(--ink-900)',
            margin: 0,
          }}
        >
          {summary.title}
        </p>
        {summary.preview ? (
          <p
            data-testid="proposed-action-card-preview"
            style={{
              marginTop: '6px',
              padding: '8px 10px',
              background: 'var(--paper-100)',
              border: '1px solid var(--ink-100, #ECEAE3)',
              borderRadius: '8px',
              fontSize: '13px',
              lineHeight: 1.5,
              color: 'var(--ink-800)',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
            }}
          >
            {summary.preview}
          </p>
        ) : null}
      </div>

      {status === 'review_required' ? (
        <div
          data-testid="proposed-action-card-owner-boundary"
          style={{
            margin: '4px 0 0',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '12px',
            fontSize: '12px',
            lineHeight: 1.45,
            color: 'var(--ink-600)',
          }}
        >
          <span>
            Prepared for review. Approvals, edits, and rejections happen in
            Owner Queue.
          </span>
          <Link
            href="/owner-queue"
            data-testid="proposed-action-card-review-link"
            style={{
              flexShrink: 0,
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px',
              color: 'var(--ink-700)',
              textDecoration: 'none',
            }}
          >
            <ExternalLink size={12} aria-hidden />
            Open Owner Queue
          </Link>
        </div>
      ) : null}
    </article>
  );
}

interface CardPalette {
  label: string;
  accent: string;
  border: string;
}

function paletteForStatus(status: ProposalCardStatus): CardPalette {
  switch (status) {
    case 'committed':
      return {
        label: 'Completed ✓',
        accent: 'var(--success-600, #2E7D5B)',
        border: 'var(--ink-200)',
      };
    case 'review_required':
      return {
        label: 'Needs your approval',
        accent: 'var(--gold-700, #8C6B1A)',
        border: 'var(--ink-200)',
      };
    case 'dispatching':
      return {
        label: 'Working…',
        accent: 'var(--ink-600)',
        border: 'var(--ink-200)',
      };
    case 'rejected':
      return {
        label: 'Rejected',
        accent: 'var(--ink-500)',
        border: 'var(--ink-200)',
      };
    default:
      return {
        label: 'Recorded',
        accent: 'var(--ink-600)',
        border: 'var(--ink-200)',
      };
  }
}
