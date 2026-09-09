# Owner Review Flow — Design Spec

**Date:** 2026-06-01
**Status:** Approved (design); pending spec review → implementation plan
**Surface:** `/today` "Owner Review" queue → new `/review/[kind]/[id]` page
**Branch context:** `feat/inbox-tenant-signal-desk` (Odesa app, `/Users/vaibhav/odesa`)

---

## 1. Problem

The Today page renders a real "Owner Review" queue (`getUrgentItems()` →
`urgentItemToQueueItem` → `TodayInteractions`/`QueueRow`). Each row has a
**"Review" button that does nothing**: `QueueRow.handleAction` only
`console.log`s. The adapter sets `primaryAction.handler = item.href`
(e.g. `/inbox?rent=<id>`), but:

- the button never reads or navigates to that handler, and
- `/inbox` ignores `searchParams` entirely — it is a conversation-only
  viewer and cannot open a rent event or a work order.

So there is **no working review destination** for any of the three urgent-item
kinds. This spec builds that destination and wires the button, end-to-end, for
all three kinds.

### The three kinds (from `getUrgentItems`)

| kind | source table | enters feed when | id is |
|---|---|---|---|
| `rent` | `rent_events` | status ∈ `late_3` `late_7` `escalated` | rent_event.id |
| `conversation` | `conversations` | status ∈ `open` `escalated` | conversation.id |
| `work_order` | `work_orders` | `urgency='emergency'` (not completed/cancelled) OR (`status='open'` AND created > 7d ago) | work_order.id |

---

## 2. Goals / Non-goals

**Goals**
- A dedicated, full-page review surface at `/review/[kind]/[id]`.
- The Today "Review" button navigates there for all three kinds.
- On the review page, the operator can take an action that **persists a DB
  state change** and is **reflected back on Today** (item drops from / changes
  in the urgent feed).
- Visual consistency with `today-theme` by reusing the `properties/detail/*`
  component kit (same kit `/work-orders/[woId]` uses).
- Registered in the route-sweep manifest (CI gate) + one Playwright smoke spec.

**Non-goals**
- No redesign of `/inbox`, `/owner-queue`, or `/today`.
- No new maintenance-ticket UI — work-order deep dives reuse the existing
  `/work-orders/[woId]` page via a deep link.
- No dependency on live messaging providers for the e2e-verifiable path
  (outbound SMS remains provider-gated, consistent with the rest of the app).
- No new DB migration (all actions transition to **existing** enum values).

---

## 3. Architecture

### 3.1 Route

`src/app/(dashboard)/review/[kind]/[id]/page.tsx`

- `kind` ∈ `{ rent, conversation, work_order }` (validated; anything else →
  `notFound()`).
- Async server component, `export const dynamic = 'force-dynamic'`.
- Auth-gates like other dashboard pages (`createServerClient` + `getUser`,
  redirect `/login` when absent).
- Wrapped in `today-theme`; root `data-testid="review-page"` plus
  `data-review-kind` / `data-review-id` for tests.
- Calls `getReviewCase(kind, id)`; `null` → `notFound()`.

Route shape rationale: `kind` is a closed enum prefix, `id` the record UUID.
One `page.tsx`, one manifest pattern (`/review/[kind]/[id]`), each kind
independently deep-linkable.

### 3.2 Loader — `src/lib/review/queries.ts`

`getReviewCase(kind: ReviewKind, id: string): Promise<ReviewCase | null>`

Loads the base record by id (RLS-scoped via `createServerClient`), resolves
tenant/unit/lease, and **reuses existing data helpers**:

- `getCaseContext(supabase, tenantId)` → `{ lease, payments, workOrder }`
  (rent + conversation context).
- `getConversation(id)` → thread + draft reply (conversation).
- `getWorkOrderDetail(id)` → full ticket fields (work order; we surface a
  summary subset and deep-link for the rest).

Returns a normalized view-model (never leaks DB row shapes to the component):

```ts
// src/lib/review/types.ts
export type ReviewKind = 'rent' | 'conversation' | 'work_order';

export interface ReviewAction {
  id: string;            // stable action key, e.g. 'rent.escalate'
  label: string;         // 'Escalate to me'
  variant: 'primary' | 'secondary' | 'ghost';
  kind: 'transition' | 'send' | 'link';
  href?: string;         // for kind:'link' (e.g. /work-orders/<id>)
  confirm?: string;      // optional confirm copy
}

export interface ReviewContextBlock {
  label: string;                       // 'Lease' | 'Payment history' | 'Thread' | 'Work order'
  rows: { label: string; value: string }[];
  href?: string;                       // optional deep link
}

export interface ReviewCase {
  kind: ReviewKind;
  id: string;
  eyebrow: string;        // 'RENT' | 'CONVERSATION' | 'MAINTENANCE'
  title: string;          // status label, e.g. 'Escalated'
  badge: { label: string; tone: 'clay' | 'amber' | 'green' | 'muted' };
  meta: string[];         // ['Unit C', 'Jessica Kim', '61d']
  recommendation: string; // Odesa-voice line
  draft?: { body: string; editable: boolean }; // rent reminder / conversation reply
  context: ReviewContextBlock[];
  actions: ReviewAction[];
  backHref: string;       // '/today'
}
```

The recommendation copy reuses the same generic Odesa-voice strings the adapter
already produces (`recommendationFor` in `queue-adapter.ts`), so the review page
and the Today row stay consistent.

### 3.3 View — `src/components/review/review-case-view.tsx`

Client component (owns action state + optimistic/resolved UI). Composed from the
existing detail kit:

- `DetailGlobalBar` — breadcrumb / "← Back to Today" + freshness.
- `DetailTitleBlock` — eyebrow, title, badge, meta.
- `AttentionBrief` / `NextActionCallout` — Odesa's recommendation line.
- Draft panel (rent reminder / conversation reply) when `draft` present —
  editable textarea reusing inbox draft styling.
- Action row — primary/secondary buttons from `ReviewCase.actions`.
- Context panels — `DetailSection` + `DetailPanel` + `KvGrid` for
  lease / payment history / thread / work-order summary.
- `AskOdesaBar` — scoped to the case.

After a successful action: swap the action row for an inline
"handled" confirmation (`HandledStatusBlock`-style) + a prominent
"← Back to Today" link. No auto-redirect (operator stays in control).

### 3.4 Actions — `src/app/(dashboard)/review/actions.ts` (`'use server'`)

Uniform `ActionResult<T>` (`{ ok, data?, error? }`), auth-gated + cross-org
checked like the inbox actions. Each revalidates `/today` **and** the review
route on success.

| kind | actions | DB effect | Today effect |
|---|---|---|---|
| `rent` | **Send reminder** (send) · **Escalate** (transition) · **Arrange payment plan** (transition) · **Snooze** (transition) | Send: reuse messaging send path (provider-gated); Escalate → `escalated`; Arrange plan → `plan_agreed`; Snooze → record + keep status | `plan_agreed`/`paid` leave the late tiers → row drops from feed; escalate relabels |
| `conversation` | **Approve & send reply** (send) · **Mark resolved** (transition) | Send: reuse `sendOwnerMessageAction(convId, body)`; Resolve → `conversations.status='resolved'` | resolved leaves open/escalated → row drops |
| `work_order` | **Mark in progress** (transition) · **Open full ticket** (link) | In progress → `work_orders.status='in_progress'`; link → `/work-orders/<id>` | open>7d → in_progress leaves the stale pool → row drops |

All transitions target **existing enum values** — no migration. The messaging
"Send" paths reuse existing, provider-gated code and are **not** the assertion
the e2e test hinges on (see §5).

### 3.5 Wiring the Today button

1. `src/lib/today/queries.ts`: change each `href` from `/inbox?<kind>=<id>` to
   `/review/<kind>/<id>` (single source of truth; `getUrgentItems`).
2. `src/components/today/queue-row.tsx`: the **primary action** ("Review")
   navigates to `item.primaryAction.handler` when it is a route (starts with
   `/`) via `useRouter().push`; otherwise keeps the existing stub (preserves
   legacy mock handlers like `'approve'`/`'send'`). `stopPropagation` already
   prevents row-selection toggle.
3. Row-click selection (AskOdesa context swap) is unchanged.

Blast radius: `urgent-items-feed.tsx` / `attention-queue.tsx` also read
`item.href` but are **not** rendered by the live Today page (legacy v1
components); the href change is safe for them.

---

## 4. Files

**New**
- `src/app/(dashboard)/review/[kind]/[id]/page.tsx`
- `src/app/(dashboard)/review/actions.ts`
- `src/lib/review/queries.ts`
- `src/lib/review/types.ts`
- `src/components/review/review-case-view.tsx`
- `e2e/review/review-flow.spec.ts`
- `tests/review/queries.test.ts` (Vitest — pure view-model mapping)

**Changed**
- `src/lib/today/queries.ts` — href → `/review/<kind>/<id>`
- `src/components/today/queue-row.tsx` — primary action navigates
- `e2e/route-sweep/manifest.ts` — add `/review/[kind]/[id]` (customer-data,
  needsAuth, needsSupabase, `rootTestId: 'review-page'`)

---

## 5. Testing

Per the project's Playwright-first gate and the user's "keep verification light"
preference:

- **Vitest** `tests/review/queries.test.ts`: pure mapping of a mocked row →
  `ReviewCase` for each kind (title, badge, context blocks, action set).
- **Playwright** `e2e/review/review-flow.spec.ts` (storageState auth):
  1. From `/today`, click a row's "Review" → asserts URL `/review/<kind>/<id>`
     and `review-page` renders for each available kind.
  2. Exercise one **transition** action (e.g. conversation "Mark resolved")
     → assert `ActionResult.ok`, the resolved confirmation renders, and after
     returning to `/today` the row is gone from the queue. This is the
     provider-independent e2e assertion.
- **Manifest**: `scripts/check-route-manifest.mjs` passes (new route listed).
- Gate before done: `npm run typecheck` + `npm run lint` + `npm run build` +
  the new review spec. Skip full visual/a11y reruns unless something breaks.

Test data: Galaxy seed already backs the live urgent items (screenshot shows
Unit C / Jessica Kim etc.). The spec picks ids dynamically from the rendered
Today queue rather than hardcoding, so it survives seed changes.

---

## 6. Risks & decisions

- **Messaging is provider-gated.** Live SMS send needs Linq/Twilio creds, absent
  locally. Decision: the e2e-verifiable path is a **status transition**, not a
  live send; the "Send" buttons reuse existing send code and degrade exactly as
  the rest of the app does (record-then-send, surfaced error on provider
  failure). No new behavior, no false "works e2e" claim.
- **id collisions across kinds.** UUIDs across three tables won't collide; the
  `kind` segment removes ambiguity regardless. Loader only queries the table the
  `kind` selects.
- **Work-order scope.** Chosen lighter path: acknowledge (`in_progress`) +
  deep-link to the existing rich ticket, rather than rebuilding maintenance UI.
- **Rent "Send reminder" semantics.** Sending a nudge does not un-late a tenant,
  so "Send reminder" does not force a status downgrade; the resolving
  transitions are **Arrange payment plan** (`plan_agreed`) / record paid
  (`paid`) / **Escalate** (`escalated`). The test asserts a resolving transition.

---

## 7. Open items for the plan

- Confirm exact `rent_events` columns for the loader (amount_due/paid, due_date,
  lease_id) and the `work_orders` columns surfaced in the summary.
- Confirm `getConversation` returns a usable draft body for the reply panel
  (else the conversation "Approve & send" uses the latest draft from
  `getDraftDetail`).
- Confirm `DetailGlobalBar` supports a single "← Back to Today" affordance or
  whether a thin custom back bar is cleaner.
