'use client';

/**
 * Inbox page shell — wave 5 (case file body mounted).
 *
 * Two-column layout under the sticky `PageHeader`:
 *
 *   - Left: `InboxQueueColumn` — 340px, `--canvas` bg, warm queue.
 *   - Right: `CaseFileColumn` — flex-1, `--panel-clean` bg. Wave 5
 *     fills this with the real case header + meta strip + Odesa line
 *     + hero (draft / handled block) + timeline + manual override.
 *
 * Provider mount, toast region, and the `inbox-page` test-id are
 * preserved from wave 3. The provider now also carries the SLA-breach
 * map so queue chips can paint the `escalated` variant without firing
 * a per-row case-context fetch.
 */

import { CaseFileColumn } from '@/components/inbox/conversation-thread-column';
import { InboxQueueColumn } from '@/components/inbox/conversations-list-column';
import {
  ConversationsProvider,
  useConversations,
} from '@/components/inbox/conversations-context';
import type {
  ActivitySummary,
  ConversationListItem,
} from '@/lib/inbox/conversation-queries';

export interface InboxPageShellProps {
  initialConversations: ConversationListItem[];
  initialActivity: ActivitySummary;
  /**
   * Map of conversation id → `workOrderSlaBreached`. Computed in the
   * page's server component via `getBreachedTenantIds` so the queue
   * chip can paint `escalated` without a per-row fetch.
   */
  initialSlaMap?: ReadonlyMap<string, boolean>;
  /** Exact record requested by a drilldown; null means the request was unavailable. */
  initialSelectedConversationId?: string | null;
  /** VA case-file mode: preserve evidence while removing owner mutations. */
  readOnly?: boolean;
  /** The global assistant is an owner-reserved capability. */
  canUseAssistant?: boolean;
}

export function InboxPageShell({
  initialConversations,
  initialActivity,
  initialSlaMap,
  initialSelectedConversationId,
  readOnly = false,
  canUseAssistant = false,
}: InboxPageShellProps) {
  return (
    <ConversationsProvider
      initialConversations={initialConversations}
      initialActivity={initialActivity}
      initialSlaMap={initialSlaMap}
      initialSelectedConversationId={initialSelectedConversationId}
    >
      <div
        data-testid='inbox-page'
        className='relative flex overflow-hidden box-border'
        style={{
          // Sits under the global app chrome (top-bar 3.5rem) + the
          // sticky `PageHeader` (52px) rendered by /inbox/page.tsx.
          height: 'calc(100vh - 3.5rem - 52px)',
          background: 'var(--canvas)',
          color: 'var(--ink, #1B1712)',
        }}
      >
        <InboxQueueColumn readOnly={readOnly} />
        <CaseFilePane
          readOnly={readOnly}
          canUseAssistant={canUseAssistant}
        />
        <Toast />
      </div>
    </ConversationsProvider>
  );
}

/**
 * Right-column wrapper — provides the `--panel-clean` bg + the hairline
 * separator the case-file pane sits inside. The actual body is the
 * Wave 5 `CaseFileColumn`.
 */
function CaseFilePane({
  readOnly,
  canUseAssistant,
}: {
  readOnly: boolean;
  canUseAssistant: boolean;
}) {
  return (
    <main
      className='flex-1 min-w-0 h-full overflow-hidden flex flex-col'
      style={{
        background: 'var(--panel-clean)',
        borderLeft: '1px solid var(--hairline-faint)',
      }}
    >
      <CaseFileColumn
        readOnly={readOnly}
        canUseAssistant={canUseAssistant}
      />
    </main>
  );
}

function Toast() {
  const { toast } = useConversations();
  if (!toast) return null;
  return (
    <div
      key={toast.key}
      data-testid='inbox-toast'
      className='absolute bottom-6 left-1/2 -translate-x-1/2 z-30 rounded-full px-4 py-2 text-sm shadow-md'
      style={{
        background: 'var(--ink, #1B1712)',
        color: 'var(--canvas)',
      }}
    >
      {toast.message}
    </div>
  );
}
