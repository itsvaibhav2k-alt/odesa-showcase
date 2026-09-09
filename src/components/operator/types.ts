/**
 * Local UI types for the operator chat panel.
 *
 * `ChatItem` is the discriminated union the message list renders. It
 * is one wider than `DispatcherEvent` because the panel also carries
 * the operator's own outbound (`user`) bubble — the SSE stream never
 * echoes that back, so the panel inserts it locally on submit.
 *
 * Each variant carries an opaque `id` (client-generated for `user`,
 * dispatcher-supplied for tool events, synthesized for `proposal_card`)
 * so React keys are stable across re-renders.
 *
 * The `proposal_card` variant tracks its lifecycle state separately from
 * the dispatcher's enum because the UI needs an extra `dispatching`
 * step (operator clicked Approve, server action in flight).
 */

import type { ActionProposal } from '@/lib/agent/worker/types';

export type ProposalCardStatus =
  | 'recorded'
  | 'committed'
  | 'review_required'
  | 'dispatching'
  | 'rejected';

export type ChatItem =
  | { kind: 'user'; id: string; body: string }
  | {
      kind: 'assistant_text';
      id: string;
      body: string;
      /** True until the dispatcher emits `done` for this turn. */
      streaming: boolean;
    }
  | { kind: 'assistant_ack'; id: string; body: string }
  | {
      kind: 'proposal_card';
      id: string;
      proposal: ActionProposal;
      status: ProposalCardStatus;
      reviewUrl: string | null;
    };

/**
 * Mint a stable id for a UI-side item that has no dispatcher anchor
 * (the operator's own bubble; the in-flight assistant message before
 * any tool is called).
 */
export function mintLocalId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}
