/**
 * Owner Review flow — `getReviewCase(kind, id)` loader.
 *
 * Loads one urgent item (rent event / conversation / work order) by id,
 * RLS-scoped via `createServerClient`, and maps it to a `ReviewCase`. Reuses
 * `getCaseContext` (lease + payments), `getConversation` (thread + draft), and
 * `getWorkOrderDetail` (full ticket view-model). Returns `null` for unknown /
 * RLS-hidden ids so the page can `notFound()`.
 *
 * The branchy presentation logic (labels, badges, action sets) is extracted
 * into pure exported helpers so it is unit-testable without a DB.
 */

import { createServerClient } from '@/lib/supabase/server';
import { getCaseContext } from '@/lib/inbox/case-context';
import { getConversation } from '@/lib/inbox/conversation-queries';
import { getWorkOrderDetail } from '@/lib/work-orders/queries';
import type { RentEventStatus, ConversationStatus } from '@/types/database';
import type {
  ReviewAction,
  ReviewCase,
  ReviewContextBlock,
  ReviewKind,
} from './types';

// =====================================================================
// Public entry
// =====================================================================

export async function getReviewCase(
  kind: ReviewKind,
  id: string,
): Promise<ReviewCase | null> {
  switch (kind) {
    case 'rent':
      return getRentReviewCase(id);
    case 'conversation':
      return getConversationReviewCase(id);
    case 'work_order':
      return getWorkOrderReviewCase(id);
    default:
      return null;
  }
}

// =====================================================================
// Pure mappers (unit-tested)
// =====================================================================

const RENT_LABELS: Record<RentEventStatus, string> = {
  pending: 'Pending',
  reminder_sent: 'Reminder sent',
  due_sent: 'Due notice sent',
  late_1: '1 day late',
  late_3: '3 days late',
  late_7: '7 days late',
  paid: 'Paid',
  escalated: 'Escalated',
  plan_agreed: 'Payment plan',
};

export function rentTitle(status: RentEventStatus): string {
  return RENT_LABELS[status] ?? 'Rent event';
}

export function rentBadge(status: RentEventStatus): ReviewCase['badge'] {
  const tone =
    status === 'escalated'
      ? 'clay'
      : status === 'paid' || status === 'plan_agreed'
        ? 'green'
        : status.startsWith('late')
          ? 'amber'
          : 'muted';
  return { label: rentTitle(status), tone };
}

export function rentActions(): ReviewAction[] {
  return [
    { id: 'rent.send_reminder', label: 'Send reminder', variant: 'primary', kind: 'send' },
    { id: 'rent.escalate', label: 'Escalate to me', variant: 'secondary', kind: 'transition' },
    { id: 'rent.arrange_plan', label: 'Arrange payment plan', variant: 'secondary', kind: 'transition' },
  ];
}

const CONVERSATION_LABELS: Record<ConversationStatus, string> = {
  open: 'Open reply',
  resolved: 'Resolved',
  escalated: 'Escalated',
};

export function conversationTitle(status: ConversationStatus): string {
  return CONVERSATION_LABELS[status] ?? 'Conversation';
}

export function conversationBadge(
  status: ConversationStatus,
): ReviewCase['badge'] {
  const tone =
    status === 'escalated' ? 'clay' : status === 'resolved' ? 'green' : 'amber';
  return { label: conversationTitle(status), tone };
}

export function conversationActions(hasDraft: boolean): ReviewAction[] {
  const actions: ReviewAction[] = [];
  if (hasDraft) {
    actions.push({
      id: 'conversation.send_reply',
      label: 'Approve & send reply',
      variant: 'primary',
      kind: 'send',
    });
  }
  actions.push({
    id: 'conversation.resolve',
    label: 'Mark resolved',
    variant: hasDraft ? 'secondary' : 'primary',
    kind: 'transition',
  });
  return actions;
}

export function workOrderActions(workOrderId: string): ReviewAction[] {
  return [
    { id: 'work_order.start', label: 'Mark in progress', variant: 'primary', kind: 'transition' },
    {
      id: 'work_order.open_ticket',
      label: 'Open full ticket',
      variant: 'secondary',
      kind: 'link',
      href: `/work-orders/${workOrderId}`,
    },
  ];
}

// =====================================================================
// Formatting helpers (pure)
// =====================================================================

/** rent_events amounts are stored in DOLLARS (see today/queries.ts). */
function formatDollars(amount: number | null | undefined): string {
  const n = Number(amount ?? 0);
  return `$${Math.round(n).toLocaleString('en-US')}`;
}

function shortDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

// =====================================================================
// Kind loaders
// =====================================================================

async function getRentReviewCase(id: string): Promise<ReviewCase | null> {
  const supabase = await createServerClient();

  const { data: rent } = await supabase
    .from('rent_events')
    .select('id, lease_id, status, amount_due, amount_paid, due_date, cycle_month')
    .eq('id', id)
    .maybeSingle();
  if (!rent) return null;

  const { data: lease } = await supabase
    .from('leases')
    .select('tenant_id, unit_id')
    .eq('id', rent.lease_id)
    .maybeSingle();

  const [tenant, unit] = await Promise.all([
    lease?.tenant_id
      ? supabase.from('tenants').select('full_name').eq('id', lease.tenant_id).maybeSingle()
      : Promise.resolve({ data: null }),
    lease?.unit_id
      ? supabase.from('units').select('label').eq('id', lease.unit_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const tenantName = tenant.data?.full_name ?? null;
  const unitLabel = unit.data?.label ?? null;
  const caseContext = await getCaseContext(supabase, lease?.tenant_id ?? null);

  const balance = Number(rent.amount_due ?? 0) - Number(rent.amount_paid ?? 0);
  const meta: string[] = [];
  if (unitLabel) meta.push(`Unit ${unitLabel}`);
  if (tenantName) meta.push(tenantName);
  meta.push(`due ${shortDate(rent.due_date)}`);

  const context: ReviewContextBlock[] = [
    {
      label: 'This cycle',
      rows: [
        { k: 'Amount due', v: formatDollars(rent.amount_due), mono: true },
        { k: 'Paid', v: formatDollars(rent.amount_paid), mono: true },
        { k: 'Balance', v: formatDollars(balance), mono: true },
        { k: 'Cycle', v: rent.cycle_month ?? '—' },
      ],
    },
    {
      label: 'Payment history',
      rows: [
        { k: 'On-time payments', v: String(caseContext.payments.onTimeCount), mono: true },
        { k: 'Recent cycles', v: String(caseContext.payments.totalRecent), mono: true },
        { k: 'Outstanding balance', v: formatDollars(caseContext.payments.balanceCents / 100), mono: true },
      ],
    },
  ];

  if (caseContext.lease) {
    context.push({
      label: 'Lease',
      rows: [
        { k: 'Starts', v: shortDate(caseContext.lease.startDate) },
        { k: 'Ends', v: shortDate(caseContext.lease.endDate) },
        {
          k: 'Monthly rent',
          v:
            caseContext.lease.rentAmountCents != null
              ? formatDollars(caseContext.lease.rentAmountCents / 100)
              : '—',
          mono: true,
        },
      ],
    });
  }

  return {
    kind: 'rent',
    id: rent.id,
    eyebrow: 'RENT',
    title: rentTitle(rent.status),
    badge: rentBadge(rent.status),
    meta,
    recommendation:
      'Odesa flagged this rent event — review before the next reminder goes out.',
    context,
    actions: rentActions(),
    backHref: '/today',
  };
}

async function getConversationReviewCase(id: string): Promise<ReviewCase | null> {
  const supabase = await createServerClient();

  const { data: row } = await supabase
    .from('conversations')
    .select('id, status, channel, summary')
    .eq('id', id)
    .maybeSingle();
  if (!row) return null;

  const detail = await getConversation(supabase, id);
  if (!detail) return null;

  const meta: string[] = [];
  if (detail.tenant.unitLabel) meta.push(`Unit ${detail.tenant.unitLabel}`);
  meta.push(detail.tenant.name);
  meta.push(`${detail.messages.length} messages`);

  const lastInbound = [...detail.messages]
    .reverse()
    .find((m) => m.direction === 'inbound');

  const context: ReviewContextBlock[] = [
    {
      label: 'Thread',
      rows: [
        { k: 'Channel', v: row.channel ?? '—' },
        { k: 'Latest from tenant', v: lastInbound?.body ?? '—' },
        { k: 'Summary', v: row.summary ?? '—' },
      ],
    },
    {
      label: 'Payment history',
      rows: [
        { k: 'On-time payments', v: String(detail.caseContext.payments.onTimeCount), mono: true },
        { k: 'Outstanding balance', v: formatDollars(detail.caseContext.payments.balanceCents / 100), mono: true },
      ],
    },
  ];

  const hasDraft = Boolean(detail.pendingDraft?.body);

  return {
    kind: 'conversation',
    id: detail.id,
    eyebrow: 'CONVERSATION',
    title: conversationTitle(row.status),
    badge: conversationBadge(row.status),
    meta,
    recommendation:
      'Odesa surfaced this thread — a quick reply keeps it from escalating.',
    draft: detail.pendingDraft
      ? { body: detail.pendingDraft.body, editable: true }
      : undefined,
    context,
    actions: conversationActions(hasDraft),
    backHref: '/today',
  };
}

async function getWorkOrderReviewCase(id: string): Promise<ReviewCase | null> {
  const wo = await getWorkOrderDetail(id);
  if (!wo) return null;

  const context: ReviewContextBlock[] = [
    {
      label: 'Ticket',
      rows: wo.metrics.map((m) => ({ k: m.label, v: m.value })),
    },
    {
      label: 'Vendor',
      rows: [
        { k: 'Assigned', v: wo.vendor.name },
        {
          k: 'Status',
          v:
            typeof wo.vendor.pill === 'string'
              ? wo.vendor.pill
              : (wo.vendor.pill?.label ?? '—'),
        },
      ],
      href: wo.vendorSlug ? `/vendors/${wo.vendorSlug}` : undefined,
    },
    {
      label: 'Access · mitigation',
      rows: wo.access.map((c) => ({ k: c.k, v: c.v, mono: c.mono })),
    },
  ];

  return {
    kind: 'work_order',
    id: wo.woId,
    eyebrow: 'MAINTENANCE',
    title: wo.title,
    badge: { label: wo.badge.label, tone: 'amber' },
    meta: wo.meta,
    recommendation: wo.nextAction.body,
    context,
    actions: workOrderActions(wo.woId),
    backHref: '/today',
  };
}
