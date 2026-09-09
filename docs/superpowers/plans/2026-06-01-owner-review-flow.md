# Owner Review Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Today "Owner Review" queue's "Review" button work end-to-end by building a dedicated `/review/[kind]/[id]` page where the operator reviews an urgent item (rent event, conversation, or work order) and takes an action that persists to the DB and is reflected back on Today.

**Architecture:** A new `/review/[kind]/[id]` server-component route loads a normalized `ReviewCase` view-model via `getReviewCase(kind, id)` (reusing `getCaseContext`, `getConversation`, `getWorkOrderDetail`). A client `ReviewCaseView` composes the existing `properties/detail/*` component kit and dispatches per-kind server actions that transition DB status (`escalated`/`plan_agreed`, `resolved`, `in_progress`) and `revalidatePath('/today')`. The Today queue's `href` is repointed to `/review/...` and `QueueRow` renders the primary "Review" action as a navigating `<Link>`.

**Tech Stack:** Next.js 16 App Router (RSC + server actions), React 19, TypeScript strict, Supabase (RLS + admin client for mutations), Vitest (unit), Playwright (E2E gate).

**Spec:** `docs/superpowers/specs/2026-06-01-review-flow-design.md`

---

## File Structure

**New**
- `src/lib/review/types.ts` — `ReviewKind`, `ReviewCase`, `ReviewAction`, `ReviewContextBlock`, `ReviewActionResult` (pure types, no deps).
- `src/lib/review/queries.ts` — `getReviewCase(kind, id)` + pure mappers + local label helpers.
- `src/app/(dashboard)/review/actions.ts` — `'use server'` actions: `decideRentReviewAction`, `sendRentReminderAction`, `decideConversationReviewAction`, `sendConversationReplyAction`, `decideWorkOrderReviewAction`.
- `src/components/review/review-case-view.tsx` — client view composing the detail kit + action dispatch.
- `src/app/(dashboard)/review/[kind]/[id]/page.tsx` — the route.
- `src/lib/review/__tests__/queries.test.ts` — Vitest mapping tests.
- `e2e/review/review-flow.spec.ts` — Playwright smoke + one transition assertion.

**Modified**
- `src/lib/today/queries.ts` — three `href` strings → `/review/<kind>/<id>`.
- `src/components/today/queue-row.tsx` — primary action renders as `<Link>` when its handler is a route.
- `e2e/route-sweep/manifest.ts` — add the `/review/[kind]/[id]` route case.

---

## Task 1: Review view-model types

**Files:**
- Create: `src/lib/review/types.ts`

- [ ] **Step 1: Write the types file**

```ts
/**
 * Owner Review flow — view-model + action result types.
 *
 * Dependency-free (no DB types). `getReviewCase` maps a live record into a
 * `ReviewCase`; `ReviewCaseView` renders it; the review server actions return
 * `ReviewActionResult`.
 */

export type ReviewKind = 'rent' | 'conversation' | 'work_order';

/** The three URL segments that map 1:1 to `ReviewKind`. */
export const REVIEW_KINDS: readonly ReviewKind[] = [
  'rent',
  'conversation',
  'work_order',
];

export function isReviewKind(value: string): value is ReviewKind {
  return (REVIEW_KINDS as readonly string[]).includes(value);
}

export type ReviewBadgeTone = 'clay' | 'amber' | 'green' | 'muted';

/** A single action button on the review surface. */
export interface ReviewAction {
  /** Stable key, e.g. 'rent.escalate' / 'conversation.resolve'. */
  id: string;
  label: string;
  variant: 'primary' | 'secondary';
  /**
   * 'transition' → calls a status-transition server action (DB persists);
   * 'send'       → calls a messaging server action (provider-gated);
   * 'link'       → plain navigation to `href`.
   */
  kind: 'transition' | 'send' | 'link';
  href?: string;
}

/** A labelled block of key/value context rows (lease, payments, thread, …). */
export interface ReviewContextBlock {
  label: string;
  rows: { k: string; v: string; mono?: boolean }[];
  href?: string;
}

export interface ReviewCase {
  kind: ReviewKind;
  id: string;
  eyebrow: string;
  title: string;
  badge: { label: string; tone: ReviewBadgeTone };
  meta: string[];
  recommendation: string;
  draft?: { body: string; editable: boolean };
  context: ReviewContextBlock[];
  actions: ReviewAction[];
  backHref: string;
}

export interface ReviewActionOk {
  ok: true;
  data?: { status?: string; messageId?: string };
}
export interface ReviewActionErr {
  ok: false;
  error: string;
}
export type ReviewActionResult = ReviewActionOk | ReviewActionErr;
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS (no errors introduced by the new file).

- [ ] **Step 3: Commit**

```bash
git add src/lib/review/types.ts
git commit -m "feat(review): view-model + action result types"
```

---

## Task 2: `getReviewCase` loader + mapping tests (TDD)

**Files:**
- Test: `src/lib/review/__tests__/queries.test.ts`
- Create: `src/lib/review/queries.ts`

The loader is split into three kind-specific functions plus pure mappers. We
unit-test the **pure mappers** (label/badge/meta/action derivation) with plain
inputs — they hold the branching logic — and leave the supabase plumbing to the
E2E gate (consistent with how `tests/today` tests the adapter, not the queries).

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/review/__tests__/queries.test.ts
import { describe, it, expect } from 'vitest';
import {
  rentBadge,
  conversationBadge,
  workOrderActions,
  rentActions,
  conversationActions,
  rentTitle,
  conversationTitle,
} from '../queries';

describe('review/queries pure mappers', () => {
  describe('rentBadge', () => {
    it('maps escalated to clay', () => {
      expect(rentBadge('escalated')).toEqual({ label: 'Escalated', tone: 'clay' });
    });
    it('maps late_7 to amber', () => {
      expect(rentBadge('late_7')).toEqual({ label: '7 days late', tone: 'amber' });
    });
    it('maps paid to green', () => {
      expect(rentBadge('paid')).toEqual({ label: 'Paid', tone: 'green' });
    });
  });

  describe('rentTitle', () => {
    it('humanises the status', () => {
      expect(rentTitle('late_3')).toBe('3 days late');
      expect(rentTitle('escalated')).toBe('Escalated');
    });
  });

  describe('rentActions', () => {
    it('offers send + escalate + arrange-plan with one primary', () => {
      const actions = rentActions();
      expect(actions.map((a) => a.id)).toEqual([
        'rent.send_reminder',
        'rent.escalate',
        'rent.arrange_plan',
      ]);
      expect(actions.filter((a) => a.variant === 'primary')).toHaveLength(1);
      expect(actions.find((a) => a.id === 'rent.escalate')?.kind).toBe('transition');
    });
  });

  describe('conversationBadge', () => {
    it('maps escalated to clay and open to amber', () => {
      expect(conversationBadge('escalated')).toEqual({ label: 'Escalated', tone: 'clay' });
      expect(conversationBadge('open')).toEqual({ label: 'Open reply', tone: 'amber' });
    });
  });

  describe('conversationTitle', () => {
    it('humanises status', () => {
      expect(conversationTitle('open')).toBe('Open reply');
      expect(conversationTitle('resolved')).toBe('Resolved');
    });
  });

  describe('conversationActions', () => {
    it('includes send (only when a draft exists) + resolve', () => {
      const withDraft = conversationActions(true);
      expect(withDraft.map((a) => a.id)).toEqual([
        'conversation.send_reply',
        'conversation.resolve',
      ]);
      const noDraft = conversationActions(false);
      expect(noDraft.map((a) => a.id)).toEqual(['conversation.resolve']);
      expect(noDraft[0].variant).toBe('primary');
    });
  });

  describe('workOrderActions', () => {
    it('offers start (transition) + open-ticket (link)', () => {
      const actions = workOrderActions('w1');
      expect(actions.map((a) => a.id)).toEqual([
        'work_order.start',
        'work_order.open_ticket',
      ]);
      const link = actions.find((a) => a.id === 'work_order.open_ticket');
      expect(link?.kind).toBe('link');
      expect(link?.href).toBe('/work-orders/w1');
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/review/__tests__/queries.test.ts`
Expected: FAIL — `queries.ts` does not exist / exports undefined.

- [ ] **Step 3: Write `queries.ts`**

```ts
// src/lib/review/queries.ts
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
import type {
  RentEventStatus,
  ConversationStatus,
} from '@/types/database';
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

export function rentBadge(
  status: RentEventStatus,
): ReviewCase['badge'] {
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
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
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
          v: caseContext.lease.rentAmountCents != null
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

  const lastInbound = [...detail.messages].reverse().find((m) => m.direction === 'inbound');

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
        { k: 'Status', v: wo.vendor.pill ?? '—' },
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/lib/review/__tests__/queries.test.ts`
Expected: PASS (all describe blocks green).

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS. (If `wo.badge.label` / `wo.vendor.pill` typings differ, adjust the field access to match `@/lib/properties/mock-detail` — `BadgeSpec`/`CtxCardSpec` — exactly; do not invent fields.)

- [ ] **Step 6: Commit**

```bash
git add src/lib/review/queries.ts src/lib/review/__tests__/queries.test.ts
git commit -m "feat(review): getReviewCase loader + pure mapper tests"
```

---

## Task 3: Review server actions

**Files:**
- Create: `src/app/(dashboard)/review/actions.ts`

These persist the owner's decision. `decide*` actions transition status (DB,
provider-independent). `send*` actions reuse the inbox messaging path
(provider-gated). All revalidate `/today`.

- [ ] **Step 1: Write the actions file**

```ts
'use server';

/**
 * `/review` server actions.
 *
 * Each action auth-gates + cross-org checks (mirroring the inbox actions
 * pattern), mutates via the admin client, and `revalidatePath('/today')` so the
 * urgent queue reflects the change. Status transitions target existing enum
 * values only (no migration). Messaging sends reuse `sendOwnerMessageAction`.
 */

import { revalidatePath } from 'next/cache';

import { createServerClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { sendOwnerMessageAction } from '@/app/(dashboard)/inbox/actions';
import type { ReviewActionResult } from '@/lib/review/types';

interface AuthCtx {
  userId: string;
  organizationId: string;
}

async function requireAuthContext(): Promise<
  { ok: true; ctx: AuthCtx } | { ok: false; error: string }
> {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Unauthorized' };

  const admin = createAdminClient();
  const { data: row } = await admin
    .from('users')
    .select('organization_id')
    .eq('id', user.id)
    .single();
  if (!row?.organization_id) return { ok: false, error: 'User has no organization' };

  return { ok: true, ctx: { userId: user.id, organizationId: row.organization_id } };
}

function revalidateReview(kind: string, id: string): void {
  revalidatePath('/today');
  revalidatePath(`/review/${kind}/${id}`);
}

// ---------------------------------------------------------------------
// Rent
// ---------------------------------------------------------------------

export async function decideRentReviewAction(
  rentEventId: string,
  decision: 'escalate' | 'arrange_plan',
): Promise<ReviewActionResult> {
  const auth = await requireAuthContext();
  if (!auth.ok) return { ok: false, error: auth.error };

  const admin = createAdminClient();
  const { data: row } = await admin
    .from('rent_events')
    .select('id, organization_id')
    .eq('id', rentEventId)
    .maybeSingle();
  if (!row) return { ok: false, error: 'Rent event not found' };
  if (row.organization_id !== auth.ctx.organizationId) {
    return { ok: false, error: 'Forbidden' };
  }

  const nextStatus = decision === 'escalate' ? 'escalated' : 'plan_agreed';
  const { error } = await admin
    .from('rent_events')
    .update({ status: nextStatus, updated_at: new Date().toISOString() })
    .eq('id', rentEventId);
  if (error) return { ok: false, error: 'Failed to update rent event' };

  revalidateReview('rent', rentEventId);
  return { ok: true, data: { status: nextStatus } };
}

/**
 * Sends a rent reminder by finding the tenant's most recent conversation
 * (via lease → tenant) and delegating to the inbox send path. Provider-gated:
 * returns an error when no conversation exists or the provider fails.
 */
export async function sendRentReminderAction(
  rentEventId: string,
  body: string,
): Promise<ReviewActionResult> {
  const auth = await requireAuthContext();
  if (!auth.ok) return { ok: false, error: auth.error };

  const admin = createAdminClient();
  const { data: rent } = await admin
    .from('rent_events')
    .select('id, organization_id, lease_id')
    .eq('id', rentEventId)
    .maybeSingle();
  if (!rent) return { ok: false, error: 'Rent event not found' };
  if (rent.organization_id !== auth.ctx.organizationId) {
    return { ok: false, error: 'Forbidden' };
  }

  const { data: lease } = await admin
    .from('leases')
    .select('tenant_id')
    .eq('id', rent.lease_id)
    .maybeSingle();
  if (!lease?.tenant_id) return { ok: false, error: 'Lease has no tenant' };

  const { data: conv } = await admin
    .from('conversations')
    .select('id')
    .eq('tenant_id', lease.tenant_id)
    .order('last_message_at', { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();
  if (!conv) return { ok: false, error: 'No conversation to reply on yet' };

  const result = await sendOwnerMessageAction(conv.id, body);
  if (!result.ok) return result;

  revalidateReview('rent', rentEventId);
  return { ok: true, data: result.data };
}

// ---------------------------------------------------------------------
// Conversation
// ---------------------------------------------------------------------

export async function decideConversationReviewAction(
  conversationId: string,
  decision: 'resolve',
): Promise<ReviewActionResult> {
  const auth = await requireAuthContext();
  if (!auth.ok) return { ok: false, error: auth.error };

  const admin = createAdminClient();
  const { data: row } = await admin
    .from('conversations')
    .select('id, organization_id')
    .eq('id', conversationId)
    .maybeSingle();
  if (!row) return { ok: false, error: 'Conversation not found' };
  if (row.organization_id !== auth.ctx.organizationId) {
    return { ok: false, error: 'Forbidden' };
  }

  const { error } = await admin
    .from('conversations')
    .update({ status: 'resolved', updated_at: new Date().toISOString() })
    .eq('id', conversationId);
  if (error) return { ok: false, error: 'Failed to resolve conversation' };

  revalidateReview('conversation', conversationId);
  return { ok: true, data: { status: 'resolved' } };
}

export async function sendConversationReplyAction(
  conversationId: string,
  body: string,
): Promise<ReviewActionResult> {
  const result = await sendOwnerMessageAction(conversationId, body);
  if (!result.ok) return result;
  revalidateReview('conversation', conversationId);
  return { ok: true, data: result.data };
}

// ---------------------------------------------------------------------
// Work order
// ---------------------------------------------------------------------

export async function decideWorkOrderReviewAction(
  workOrderId: string,
  decision: 'start',
): Promise<ReviewActionResult> {
  const auth = await requireAuthContext();
  if (!auth.ok) return { ok: false, error: auth.error };

  const admin = createAdminClient();
  const { data: row } = await admin
    .from('work_orders')
    .select('id, organization_id')
    .eq('id', workOrderId)
    .maybeSingle();
  if (!row) return { ok: false, error: 'Work order not found' };
  if (row.organization_id !== auth.ctx.organizationId) {
    return { ok: false, error: 'Forbidden' };
  }

  const { error } = await admin
    .from('work_orders')
    .update({ status: 'in_progress', updated_at: new Date().toISOString() })
    .eq('id', workOrderId);
  if (error) return { ok: false, error: 'Failed to update work order' };

  revalidateReview('work_order', workOrderId);
  return { ok: true, data: { status: 'in_progress' } };
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS. (If `sendOwnerMessageAction`'s return type narrows `result` such that `return result` errors on the `ok:true` branch, change `if (!result.ok) return result;` to `if (!result.ok) return { ok: false, error: result.error };`.)

- [ ] **Step 3: Commit**

```bash
git add "src/app/(dashboard)/review/actions.ts"
git commit -m "feat(review): server actions for rent/conversation/work-order decisions"
```

---

## Task 4: `ReviewCaseView` client component

**Files:**
- Create: `src/components/review/review-case-view.tsx`

- [ ] **Step 1: Write the component**

```tsx
'use client';

/**
 * Owner Review surface — renders a `ReviewCase` using the shared
 * `properties/detail/*` kit and dispatches the per-kind server actions. On a
 * successful action it swaps the action row for a "handled" confirmation and a
 * Back-to-Today link.
 */

import { useState, useTransition, type CSSProperties } from 'react';
import Link from 'next/link';

import { DetailGlobalBar } from '@/components/properties/detail/detail-global-bar';
import { DetailTitleBlock } from '@/components/properties/detail/detail-title-block';
import { DetailSection } from '@/components/properties/detail/detail-section';
import { DetailPanel } from '@/components/properties/detail/detail-panel';
import { KvGrid } from '@/components/properties/detail/kv-grid';
import { NextActionCallout } from '@/components/properties/detail/next-action-callout';
import { AskOdesaBar } from '@/components/properties/detail/ask-odesa-bar';
import { HandledStatusBlock } from '@/components/inbox/handled-status-block';
import type { ReviewAction, ReviewActionResult, ReviewCase } from '@/lib/review/types';
import {
  decideRentReviewAction,
  sendRentReminderAction,
  decideConversationReviewAction,
  sendConversationReplyAction,
  decideWorkOrderReviewAction,
} from '@/app/(dashboard)/review/actions';

const wrapStyle: CSSProperties = {
  maxWidth: '900px',
  margin: '0 auto',
  padding: '24px 36px 36px',
};

const recoStyle: CSSProperties = { marginBottom: '22px' };
const draftLabelStyle: CSSProperties = {
  fontFamily: 'var(--font-mono-operator)',
  fontSize: '10.5px',
  letterSpacing: '0.12em',
  textTransform: 'uppercase',
  color: 'var(--ink-3)',
  marginBottom: '8px',
};
const draftBoxStyle: CSSProperties = {
  width: '100%',
  minHeight: '96px',
  padding: '12px 14px',
  border: '1px solid var(--hairline)',
  borderRadius: '8px',
  background: 'var(--panel-lift)',
  color: 'var(--ink)',
  fontFamily: 'var(--font-sans-operator)',
  fontSize: '14px',
  lineHeight: 1.5,
  resize: 'vertical',
};
const actionsRowStyle: CSSProperties = {
  display: 'flex',
  gap: '10px',
  flexWrap: 'wrap',
  margin: '22px 0',
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

function toKebab(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

export function ReviewCaseView({ reviewCase }: { reviewCase: ReviewCase }) {
  const [draft, setDraft] = useState(reviewCase.draft?.body ?? '');
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [handled, setHandled] = useState<string | null>(null);

  function runAction(action: ReviewAction) {
    setError(null);
    startTransition(async () => {
      const result = await dispatchReviewAction(reviewCase, action, draft);
      if (result.ok) {
        setHandled(action.label);
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <div
      className="today-theme"
      data-testid="review-page"
      data-review-kind={reviewCase.kind}
      data-review-id={reviewCase.id}
      style={{ background: 'var(--panel-clean)', minHeight: '100vh', display: 'flex', flexDirection: 'column' }}
    >
      <DetailGlobalBar
        crumbs={[{ label: 'Today', href: reviewCase.backHref }, { label: reviewCase.title }]}
        checkedAgoLabel="now"
      />

      <main style={{ flex: 1 }}>
        <div style={wrapStyle}>
          <DetailTitleBlock
            eyebrow={reviewCase.eyebrow}
            title={reviewCase.title}
            badge={{ label: reviewCase.badge.label, tone: reviewCase.badge.tone }}
            meta={reviewCase.meta}
          />

          <div style={recoStyle}>
            <NextActionCallout body={reviewCase.recommendation} />
          </div>

          {reviewCase.draft ? (
            <DetailSection label="Odesa's draft">
              <DetailPanel>
                <div style={draftLabelStyle}>Editable before send</div>
                <textarea
                  data-testid="review-draft"
                  style={draftBoxStyle}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  disabled={Boolean(handled)}
                />
              </DetailPanel>
            </DetailSection>
          ) : null}

          {handled ? (
            <div data-testid="review-handled" style={{ margin: '22px 0' }}>
              <HandledStatusBlock
                title="Handled"
                body={`"${handled}" recorded. Odesa updated the queue.`}
              />
              <div style={{ marginTop: '14px' }}>
                <Link href={reviewCase.backHref} style={{ color: 'var(--terracotta)', fontSize: '13px' }}>
                  ← Back to Today
                </Link>
              </div>
            </div>
          ) : (
            <>
              {error ? <div role="alert" style={errStyle}>{error}</div> : null}
              <div style={actionsRowStyle}>
                {reviewCase.actions.map((action) =>
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
                      onClick={() => runAction(action)}
                    >
                      {pending ? 'Working…' : action.label}
                    </button>
                  ),
                )}
              </div>
            </>
          )}

          {reviewCase.context.map((block) => (
            <DetailSection key={block.label} label={block.label}>
              <DetailPanel>
                <KvGrid cells={block.rows.map((r) => ({ k: r.k, v: r.v, mono: r.mono }))} />
              </DetailPanel>
            </DetailSection>
          ))}

          <AskOdesaBar
            scopeLabel={reviewCase.title}
            placeholder={`Ask Odesa about this ${reviewCase.eyebrow.toLowerCase()}…`}
            prompts={['Why did Odesa flag this?', 'What happens if I wait?', 'Draft an alternative']}
          />
        </div>
      </main>
    </div>
  );
}

/** Maps a (case, action) pair to the right server action call. */
async function dispatchReviewAction(
  reviewCase: ReviewCase,
  action: ReviewAction,
  draft: string,
): Promise<ReviewActionResult> {
  switch (action.id) {
    case 'rent.send_reminder':
      return sendRentReminderAction(reviewCase.id, draft || reviewCase.recommendation);
    case 'rent.escalate':
      return decideRentReviewAction(reviewCase.id, 'escalate');
    case 'rent.arrange_plan':
      return decideRentReviewAction(reviewCase.id, 'arrange_plan');
    case 'conversation.send_reply':
      return sendConversationReplyAction(reviewCase.id, draft);
    case 'conversation.resolve':
      return decideConversationReviewAction(reviewCase.id, 'resolve');
    case 'work_order.start':
      return decideWorkOrderReviewAction(reviewCase.id, 'start');
    default:
      return { ok: false, error: 'Unknown action' };
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS. (If `DetailTitleBlock`'s `badge` expects a `BadgeSpec` whose `tone` union differs from `ReviewBadgeTone`, map it: build the `badge` prop as `{ label: reviewCase.badge.label, tone: reviewCase.badge.tone as BadgeSpec['tone'] }` importing `BadgeSpec` from `@/lib/properties/mock-detail`, and confirm the tone literals overlap.)

- [ ] **Step 3: Commit**

```bash
git add src/components/review/review-case-view.tsx
git commit -m "feat(review): ReviewCaseView client surface"
```

---

## Task 5: The `/review/[kind]/[id]` page

**Files:**
- Create: `src/app/(dashboard)/review/[kind]/[id]/page.tsx`

- [ ] **Step 1: Write the page**

```tsx
/**
 * /review/[kind]/[id] — Owner Review surface.
 *
 * Async server component. Auth-gates, validates `kind`, loads the normalized
 * `ReviewCase` via `getReviewCase`, and renders the client view. Unknown kind
 * or RLS-hidden id → notFound().
 */

import { notFound, redirect } from 'next/navigation';

import { createServerClient } from '@/lib/supabase/server';
import { getReviewCase } from '@/lib/review/queries';
import { isReviewKind } from '@/lib/review/types';
import { ReviewCaseView } from '@/components/review/review-case-view';

export const dynamic = 'force-dynamic';

interface ReviewPageProps {
  params: Promise<{ kind: string; id: string }>;
}

export default async function ReviewPage({ params }: ReviewPageProps) {
  const { kind, id } = await params;

  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  if (!isReviewKind(kind)) notFound();

  const reviewCase = await getReviewCase(kind, id);
  if (!reviewCase) notFound();

  return <ReviewCaseView reviewCase={reviewCase} />;
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add "src/app/(dashboard)/review/[kind]/[id]/page.tsx"
git commit -m "feat(review): /review/[kind]/[id] route"
```

---

## Task 6: Wire the Today "Review" button

**Files:**
- Modify: `src/lib/today/queries.ts` (three `href` assignments)
- Modify: `src/components/today/queue-row.tsx`

- [ ] **Step 1: Repoint the urgent-item hrefs**

In `src/lib/today/queries.ts`, change the three `href` strings:

In `fetchUrgentConversations`, change:
```ts
      href: `/inbox?conversation=${c.id}`,
```
to:
```ts
      href: `/review/conversation/${c.id}`,
```

In `fetchUrgentRentEvents`, change:
```ts
      href: `/inbox?rent=${r.id}`,
```
to:
```ts
      href: `/review/rent/${r.id}`,
```

In `fetchUrgentWorkOrders`, change:
```ts
      href: `/inbox?work_order=${w.id}`,
```
to:
```ts
      href: `/review/work_order/${w.id}`,
```

- [ ] **Step 2: Make the primary action navigate**

In `src/components/today/queue-row.tsx`:

Add `Link` to the imports at the top of the file:
```tsx
import Link from 'next/link';
```

Replace the actions `.map(...)` block (the one that renders each `<button>` inside `actionSlotStyle`) with this version that renders a `<Link>` for the first (primary) action when its handler is a route:

```tsx
        {actions.map((action, index) => {
          const isPrimary = index === 0;
          const routeHref =
            isPrimary && item?.primaryAction.handler.startsWith('/')
              ? item.primaryAction.handler
              : null;
          const style: CSSProperties = {
            ...(action.variant === 'primary' ? buttonPrimary : buttonBase),
            width: '100%',
            textAlign: 'center',
            textDecoration: 'none',
            display: 'inline-block',
            boxSizing: 'border-box',
          };
          return (
            <div key={action.label} style={actionSlotStyle}>
              {routeHref ? (
                <Link
                  href={routeHref}
                  data-action={toKebab(action.label)}
                  style={style}
                  onClick={(e) => e.stopPropagation()}
                >
                  {action.label}
                </Link>
              ) : (
                <button
                  type="button"
                  data-action={toKebab(action.label)}
                  style={style}
                  onClick={isInteractive ? handleAction(action.label) : undefined}
                >
                  {action.label}
                </button>
              )}
            </div>
          );
        })}
```

(Leave the `actions.length === 1 ? <span aria-hidden="true" /> : null` spacer line directly above this block unchanged.)

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Manual smoke (dev server)**

Run: `npm run dev`, open `http://localhost:3000/today`, click a "Review" button.
Expected: navigates to `/review/<kind>/<id>` and the review page renders with the item's title, recommendation, context, and action buttons. Press "← Back to Today" returns.

- [ ] **Step 5: Commit**

```bash
git add src/lib/today/queries.ts src/components/today/queue-row.tsx
git commit -m "feat(today): wire Owner Review button to /review/[kind]/[id]"
```

---

## Task 7: Route-sweep manifest + Playwright E2E

**Files:**
- Modify: `e2e/route-sweep/manifest.ts`
- Create: `e2e/review/review-flow.spec.ts`

- [ ] **Step 1: Register the route in the manifest**

In `e2e/route-sweep/manifest.ts`, add this entry to the `ROUTE_MANIFEST` array, in the "operator surface (customer-data …)" group near the `/owner-queue` entry. Use a concrete id pulled from the seeded queue — at build time, replace `<SEEDED_CONVERSATION_ID>` with a real conversation id by running:
`node -e "/* or */"` — simplest: open `/today` in the dev server, copy a Review link's href, and use that exact `kind/id`.

```ts
  { path: '/review/conversation/<SEEDED_CONVERSATION_ID>', pattern: '/review/[kind]/[id]', category: 'customer-data', dataSource: 'real', needsAuth: true, needsSupabase: true, rootTestId: 'review-page', hasExistingSpec: true },
```

If no stable seeded id is available for the manifest, mark the entry `lenient: true` and use a placeholder id that resolves via the seed; the smoke spec asserts the dynamic path instead (see Step 3). Then verify the manifest checker passes:

Run: `node scripts/check-route-manifest.mjs`
Expected: PASS — `/review/[kind]/[id]` pattern now present (no "route missing from manifest" error).

- [ ] **Step 2: Write the E2E spec**

Open `e2e/today/urgent-items.spec.ts` and copy its top-of-file import block and its auth setup (`test.use(...)` and/or `test.beforeEach(...)` that signs in the Galaxy owner) verbatim into the new spec so authentication matches the existing today suite. Then add the test bodies:

```ts
// e2e/review/review-flow.spec.ts
// <-- paste the SAME imports + auth (test.use / beforeEach) block used by
//     e2e/today/urgent-items.spec.ts here, then: -->
import { test, expect } from '@playwright/test';

test.describe('Owner Review flow', () => {
  test('every Review button navigates to a rendered /review page', async ({ page }) => {
    await page.goto('/today');

    const reviewLinks = page.locator('[data-section="owner-review"] [data-action="review"]');
    const count = await reviewLinks.count();
    expect(count, 'at least one Owner Review row').toBeGreaterThan(0);

    const hrefs: string[] = [];
    for (let i = 0; i < count; i++) {
      const href = await reviewLinks.nth(i).getAttribute('href');
      expect(href, `row ${i} Review href`).toMatch(/^\/review\/(rent|conversation|work_order)\//);
      hrefs.push(href as string);
    }

    // Visit each distinct kind once and assert the review surface renders.
    const seenKinds = new Set<string>();
    for (const href of hrefs) {
      const kind = href.split('/')[2];
      if (seenKinds.has(kind)) continue;
      seenKinds.add(kind);
      await page.goto(href);
      await expect(page.getByTestId('review-page')).toBeVisible({ timeout: 30_000 });
      await expect(page.getByTestId('review-page')).toHaveAttribute('data-review-kind', kind);
    }
  });

  test('resolving a conversation persists and removes it from Today', async ({ page }) => {
    await page.goto('/today');

    const convLink = page
      .locator('[data-section="owner-review"] [data-action="review"][href^="/review/conversation/"]')
      .first();

    if ((await convLink.count()) === 0) {
      test.info().annotations.push({
        type: 'note',
        description: 'No conversation row in queue this run — conversation transition assertion skipped (rent/work_order render still covered by the first test).',
      });
      test.skip();
      return;
    }

    const href = (await convLink.getAttribute('href')) as string;
    const convId = href.split('/')[3];

    await convLink.click();
    await expect(page.getByTestId('review-page')).toBeVisible();

    await page.locator('[data-action="mark-resolved"]').click();
    await expect(page.getByTestId('review-handled')).toBeVisible({ timeout: 15_000 });

    await page.goto('/today');
    await expect(
      page.locator(`[data-section="owner-review"] [href="/review/conversation/${convId}"]`),
    ).toHaveCount(0);
  });
});
```

- [ ] **Step 3: Run the E2E spec**

Run: `BASE_URL=http://localhost:3000 npx playwright test e2e/review/review-flow.spec.ts --project=chromium`
(Start `npm run dev` first, or let the configured `webServer` build+start.)
Expected: both tests PASS (the second may report `skipped` if the seed has no open/escalated conversation this run — acceptable; the first still covers render+navigation for the kinds present).

- [ ] **Step 4: Commit**

```bash
git add e2e/route-sweep/manifest.ts e2e/review/review-flow.spec.ts
git commit -m "test(review): route-sweep entry + e2e review-flow spec"
```

---

## Task 8: Final gate

- [ ] **Step 1: Typecheck + lint + build + unit tests**

Run:
```bash
npm run typecheck && npm run lint && npx vitest run src/lib/review && npm run build
```
Expected: all PASS. Build compiles the new route. Fix any reported errors in the files above (do not introduce new files to "work around" — fix at the source).

- [ ] **Step 2: Route-sweep smoke (optional, if dev/preview running)**

Run: `BASE_URL=http://localhost:3000 npx playwright test e2e/route-sweep/route-smoke.spec.ts --project=chromium`
Expected: PASS including the new `/review/[kind]/[id]` case.

- [ ] **Step 3: Final commit (if anything pending)**

```bash
git add -A
git commit -m "chore(review): owner review flow complete — typecheck/lint/build green"
```

---

## Notes / deviations from the spec

- **Snooze dropped (rent):** the spec listed a rent "Snooze" action, but
  `rent_events` has no snooze column and the build is migration-free. Rent
  actions are **Send reminder** (provider-gated), **Escalate** (`escalated`),
  **Arrange payment plan** (`plan_agreed`). Add Snooze later with a
  `snoozed_until` column if wanted.
- **`requireAuthContext` duplicated:** defined locally in
  `review/actions.ts` rather than shared, because the inbox copy lives in a
  `'use server'` module (can't export non-action helpers). Acceptable, isolated
  duplication; extract to `src/lib/auth/` only if a third consumer appears.
- **Messaging is provider-gated:** the `send*` actions reuse
  `sendOwnerMessageAction` and degrade exactly as the rest of the app does. The
  E2E assertion deliberately hinges on a **status transition**, not a live send.
- **Work-order lighter path:** review shows a summary + deep-links to the rich
  `/work-orders/[woId]` ticket rather than rebuilding maintenance UI.
```
