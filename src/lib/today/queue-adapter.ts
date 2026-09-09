/**
 * Today v2 — `UrgentItem` (DB) → `QueueItem` (UI) adapter.
 *
 * Today surfaces a row-specific Ask Odesa context (chip
 * label, suggestion list, placeholder, linked-tag) so that selecting a
 * row can swap the command bar into something specific. That context is
 * derived **generically** from the live row — its `kind` (rent /
 * work_order / conversation) plus its title/unit/tenant — so the
 * production render path never depends on hand-authored demo strings.
 *
 * `urgentItemToQueueItem` always returns a fully-populated `QueueItem`
 * for any real `UrgentItem`; it never returns `null` and never consults
 * a hardcoded demo bundle.
 */

import type {
  QueueItem,
  QueueStatus,
  WatchChannel,
} from '@/types/today';
import type { UrgentItem, UrgentItemKind } from './queries';

// =====================================================================
// Row-context table — LEGACY / TEST-ONLY
// =====================================================================
//
// NOT reachable from `/today`. The production adapter
// (`urgentItemToQueueItem`) derives context generically from the live
// row and never reads this table. These hand-authored demo bundles are
// retained only so the existing snapshot/order tests in
// `tests/today/queue-adapter.test.ts` keep compiling. `page.tsx` does
// not import `getMockQueueItems` or `getRowContextTable`.

/**
 * The five known row "kinds" the Today v2 mockup shipped with. Each maps
 * to a watch channel + a fully-authored context bundle. Demo-only.
 */
type RowKey = 'leak' | 'rent' | 'vendor' | 'noise' | 'lockbox';

interface RowContext {
  channel: WatchChannel;
  contextLabel: string;
  contextSuggestions: [string, string, string, string];
  contextPlaceholder: string;
  linkedLabel: string;
}

// TODO: source from DB or Odesa-generated metadata at row creation.
// Today these are hand-authored; future state moves them into a
// `queue_row_context` table (or generates them with a Claude call when
// Odesa drafts the recommendation) so the UI can drop the hardcoded
// fallback. Verbatim from `ref-context-map.md`.
const ROW_CONTEXT: Record<RowKey, RowContext> = {
  leak: {
    channel: 'maintenance',
    contextLabel: 'leak escalation',
    contextSuggestions: [
      'Explain why Greene Plumbing',
      'Draft tenant update for Unit 3B',
      'Compare vendor quotes',
      'What happens if I snooze this?',
    ],
    contextPlaceholder: 'Ask about the Unit 3B leak…',
    linkedLabel: 'leak escalation',
  },
  rent: {
    channel: 'rent',
    contextLabel: 'Sandra K. late payment',
    contextSuggestions: [
      "Show Sandra's payment history",
      'Draft a softer reminder',
      'Suggest a payment plan threshold',
      'Who else is at risk this month?',
    ],
    contextPlaceholder: "Ask about Sandra's late payment…",
    linkedLabel: 'Sandra K. late',
  },
  vendor: {
    channel: 'vendor',
    contextLabel: 'Greene HVAC silence',
    contextSuggestions: [
      'Show Greene HVAC track record',
      'Draft escalation script',
      'Suggest a backup vendor',
      'When should I switch vendors?',
    ],
    contextPlaceholder: 'Ask about the Greene HVAC delay…',
    linkedLabel: 'Greene HVAC silence',
  },
  noise: {
    channel: 'inbox',
    contextLabel: 'noise dispute',
    contextSuggestions: [
      'Show both incident threads',
      'Draft a neutral reply to Marcus',
      'Is this a lease violation?',
      'Risk if this is ignored?',
    ],
    contextPlaceholder: 'Ask about the noise dispute at Unit 4…',
    linkedLabel: 'noise dispute',
  },
  lockbox: {
    channel: 'vendor',
    contextLabel: 'lockbox rotation',
    contextSuggestions: [
      'Show the rotation log',
      'Which vendors got new codes?',
      'When is the next rotation?',
      'Audit access changes',
    ],
    contextPlaceholder: 'Ask about the lockbox rotation…',
    linkedLabel: 'lockbox rotation',
  },
};

/** Read-only handle on the context table — exported for snapshot tests. */
export function getRowContextTable(): Readonly<Record<RowKey, RowContext>> {
  return ROW_CONTEXT;
}

// =====================================================================
// Channel + status derivation
// =====================================================================

/**
 * Derives the watch-rail channel for a queue row. Rent + work-orders
 * map by kind; conversations defer to `conversations.channel` and fall
 * back to `'inbox'` for unknown values.
 */
function channelFor(item: UrgentItem): WatchChannel {
  if (item.kind === 'rent') return 'rent';
  if (item.kind === 'work_order') return 'maintenance';

  // conversation
  const raw = (item.channel ?? '').toString().toLowerCase();
  // Known conversation channels map cleanly to watch channels where
  // they overlap; everything else lands in the generic 'inbox' bucket.
  if (raw === 'vendor') return 'vendor';
  if (raw === 'maintenance') return 'maintenance';
  return 'inbox';
}

/**
 * Picks a source-record status without inventing a draft or approval artifact.
 */
function statusFor(item: UrgentItem): QueueStatus {
  if (item.kind === 'rent') return 'waiting';
  if (item.kind === 'work_order') {
    return item.urgency === 'emergency' ? 'escalated' : 'waiting';
  }

  // Conversation — only preserve an explicit source escalation.
  const label = (item.statusLabel ?? '').toLowerCase();
  if (label.includes('escalat')) return 'escalated';
  return 'waiting';
}

// =====================================================================
// Generic context derivation (per kind, from the live row)
// =====================================================================

/**
 * Human noun for a row's kind, used in the title fallback + the AskOdesa
 * context copy ("Ask about this maintenance item…").
 */
function kindNoun(kind: UrgentItemKind): string {
  switch (kind) {
    case 'rent':
      return 'rent';
    case 'work_order':
      return 'maintenance item';
    default:
      return 'conversation';
  }
}

/**
 * Short reference label for a row — the unit, else the tenant, else a
 * kind-flavoured fallback. Feeds the AskOdesa eyebrow + the `↳ LINKED:`
 * tag. Always non-empty so the watch-rail emphasis never shows a blank
 * tag.
 */
function contextRef(item: UrgentItem): string {
  if (item.unitLabel) return `Unit ${item.unitLabel}`;
  if (item.tenantName) return item.tenantName;
  switch (item.kind) {
    case 'rent':
      return 'this rent flag';
    case 'work_order':
      return 'this maintenance item';
    default:
      return 'this conversation';
  }
}

/**
 * Four generic AskOdesa suggestion chips for a row, varied by kind so
 * the in-context command bar reads specific without any hand-authored
 * per-row copy. The `ref` is the row's short label (unit/tenant).
 */
function suggestionsFor(item: UrgentItem, ref: string): string[] {
  switch (item.kind) {
    case 'rent':
      return [
        `Show ${ref}'s payment history`,
        'Draft a reminder',
        'Suggest a payment plan',
        'Who else is at risk this month?',
      ];
    case 'work_order':
      return [
        `Summarize ${ref}`,
        'Draft a tenant update',
        'Recommend a vendor',
        'What happens if I snooze this?',
      ];
    default:
      return [
        `Summarize ${ref}`,
        'Draft a reply',
        'What does the tenant need?',
        'Risk if this is ignored?',
      ];
  }
}

/**
 * Derives the four AskOdesa context fields generically from the live
 * row. No demo bundles, no substring inference — purely a function of
 * the row's kind + its own labels.
 */
function deriveContext(item: UrgentItem): {
  contextLabel: string;
  contextSuggestions: string[];
  contextPlaceholder: string;
  linkedLabel: string;
} {
  const ref = contextRef(item);
  return {
    contextLabel: `${kindNoun(item.kind)} · ${ref}`,
    contextSuggestions: suggestionsFor(item, ref),
    contextPlaceholder: `Ask about this ${kindNoun(item.kind)}…`,
    linkedLabel: ref,
  };
}

/**
 * Compact absolute date ("Apr 21") — month short + day numeric. Mirrors
 * the `shortDate` helper in `app/(dashboard)/today/page.tsx` so the meta
 * line and the stale-item timestamp read the same way the rest of the
 * page does. Falls back to the raw input on an unparseable date.
 */
function shortDate(iso: string): string {
  const d = new Date(`${iso}T12:00:00`);
  if (Number.isNaN(d.getTime())) {
    const fallback = new Date(iso);
    if (Number.isNaN(fallback.getTime())) return iso;
    return fallback.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
    });
  }
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/**
 * Formats an ISO `ageAnchor` into a trust-preserving timestamp. Recent
 * items read relative ("12m ago", "3h ago", "yesterday"); anything older
 * than two days reads as an ABSOLUTE short date ("Apr 21") rather than a
 * growing "62d ago" that makes seeded/stale rows look neglected. Runs
 * server-side only (the page is a server component); the resulting
 * string is embedded once and passed to the client `QueueRow` as a prop,
 * so it never recomputes on the client and cannot cause a hydration
 * mismatch.
 */
function relativeTimestamp(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const minutes = Math.max(0, Math.floor((Date.now() - then) / 60000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  if (hours < 48) return 'yesterday';
  return shortDate(iso);
}

// =====================================================================
// Operational copy — event-first title, meta, action, boundaries
// =====================================================================

/** True when a row's raw status enum reads as escalated. */
function isEscalated(item: UrgentItem): boolean {
  return (item.rawStatus ?? '').toLowerCase().includes('escalat');
}

/**
 * Event-first title — the title IS the problem type (operators scan by
 * "what is this" first); the tenant/unit/money reference lives in the
 * meta row. Derived from the raw status / urgency the queries surface.
 */
function titleFor(item: UrgentItem): string {
  switch (item.kind) {
    case 'rent':
      return isEscalated(item) ? 'Rent escalation' : 'Late rent';
    case 'work_order':
      return item.urgency === 'emergency' ? 'Emergency repair' : 'Open work order';
    default: {
      if (isEscalated(item)) return 'Escalated thread';
      const label = (item.statusLabel ?? '').toLowerCase();
      if (label.includes('waiting') || label.includes('no reply')) {
        return 'Tenant message awaiting reply';
      }
      return 'Tenant message';
    }
  }
}

/** Formats a cent amount as whole dollars with thousands separators. */
function formatDollars(cents: number): string {
  return `$${Math.round(cents / 100).toLocaleString('en-US')}`;
}

/**
 * Builds the meta-row tokens, ref-first and REAL DATA ONLY — a token is
 * omitted whenever its underlying field is absent. Tenant/unit anchor
 * the "who/where"; money + dates carry the operational specifics.
 */
function metaFor(item: UrgentItem): string[] {
  const meta: string[] = [];
  if (item.tenantName) meta.push(item.tenantName);
  if (item.unitLabel) meta.push(`Unit ${item.unitLabel}`);

  switch (item.kind) {
    case 'rent': {
      const due = item.amountDueCents;
      const paid = item.amountPaidCents;
      if (due != null && paid != null) {
        const unpaid = due - paid;
        if (unpaid > 0) meta.push(`${formatDollars(unpaid)} unpaid`);
      }
      if (item.dueDate) meta.push(`Due ${shortDate(item.dueDate)}`);
      break;
    }
    case 'work_order': {
      if (item.urgency === 'emergency') meta.push('Emergency');
      meta.push(`Reported ${shortDate(item.ageAnchor)}`);
      break;
    }
    default: {
      meta.push(`Last reply ${shortDate(item.ageAnchor)}`);
      const channelLabel = conversationChannelLabel(item.channel);
      if (channelLabel) meta.push(channelLabel);
      break;
    }
  }

  return meta;
}

/** Maps a conversation channel to a human label, omitted when generic. */
function conversationChannelLabel(channel: UrgentItem['channel']): string | null {
  const raw = (channel ?? '').toString().toLowerCase();
  switch (raw) {
    case 'sms':
      return 'SMS';
    case 'email':
      return 'Email';
    case 'voice':
      return 'Voice';
    case 'vendor':
      return 'Vendor';
    case 'maintenance':
      return 'Maintenance';
    default:
      return null;
  }
}

/** Specific primary-action label by kind — handler stays the row href. */
function primaryActionLabelFor(kind: UrgentItemKind): string {
  switch (kind) {
    case 'rent':
      return 'Open rent record';
    case 'work_order':
      return 'Open work order';
    default:
      return 'Open thread';
  }
}

/**
 * Conservative evidence boundary. A bare source row does not prove that a
 * draft, send, vendor contact, or approval artifact exists.
 */
function nextStepFor(kind: UrgentItemKind): string {
  switch (kind) {
    case 'rent':
      return 'No tenant-facing action is recorded from this source item.';
    case 'work_order':
      return 'This source record does not prove vendor contact or dispatch.';
    default:
      return 'This source record does not prove a drafted or sent reply.';
  }
}

/** The concrete consequence of leaving this row untouched — real, not voiced. */
function ifIgnoredFor(kind: UrgentItemKind): string {
  switch (kind) {
    case 'rent':
      return 'If you do nothing, the unpaid balance remains in the Rent record.';
    case 'work_order':
      return 'If you do nothing, the work order stays open.';
    default:
      return 'If you do nothing, the conversation stays open.';
  }
}

/** Operational boundary micro-tag — not a configured threshold. */
function ownerRuleFor(kind: UrgentItemKind): string {
  void kind;
  return 'Source record · commitments in Owner Queue';
}

/**
 * Deterministic "Why this?" disclosure — grounded in the row's status,
 * never AI-voiced reasoning or an invented rule.
 */
function reasonFor(kind: UrgentItemKind): string {
  switch (kind) {
    case 'rent':
      return 'The current Rent record shows an unpaid balance for this cycle.';
    case 'work_order':
      return 'Marked emergency/open and still active.';
    default:
      return 'The conversation is open and returned by the attention query.';
  }
}

/** Domain-specific source-link label by kind — all point at the row href. */
function sourceLabelFor(kind: UrgentItemKind): string {
  switch (kind) {
    case 'rent':
      return 'View ledger';
    case 'work_order':
      return 'View work order';
    default:
      return 'View thread';
  }
}

// =====================================================================
// Public API
// =====================================================================

/**
 * Maps an `UrgentItem` from the DB into a fully-populated `QueueItem`
 * the Today v2 UI can render. ALWAYS returns a real row derived from the
 * live record (event-first title, ref-first meta, channel, status,
 * context, boundary copy, timestamp, href) — it never returns `null`
 * and never reads a hardcoded demo bundle. Every operational token is
 * derived from real fields; tokens are omitted when their data is
 * absent rather than invented.
 *
 * @param item - The live urgent-items row from {@link getUrgentItems}.
 * @returns A renderable `QueueItem` for Today attention.
 */
export function urgentItemToQueueItem(item: UrgentItem): QueueItem {
  const channel = channelFor(item);
  const status = statusFor(item);
  const context = deriveContext(item);

  return {
    id: item.id,
    status,
    title: titleFor(item),
    property: item.unitLabel ?? '',
    unit: item.unitLabel ?? undefined,
    tenant: item.tenantName ?? undefined,
    meta: metaFor(item),
    recommendation: recommendationFor(item),
    timestamp: relativeTimestamp(item.ageAnchor),
    channel,
    contextLabel: context.contextLabel,
    contextSuggestions: context.contextSuggestions,
    contextPlaceholder: context.contextPlaceholder,
    linkedLabel: context.linkedLabel,
    primaryAction: {
      label: primaryActionLabelFor(item.kind),
      handler: item.href,
    },
    nextStep: nextStepFor(item.kind),
    ifIgnored: ifIgnoredFor(item.kind),
    ownerRule: ownerRuleFor(item.kind),
    reason: reasonFor(item.kind),
    sourceLabel: sourceLabelFor(item.kind),
    sourceHref: item.href,
  };
}

/**
 * A short Odesa-voice recommendation line for the row, varied by kind.
 * Warm but deterministic — grounded in the row's status, with no implied
 * tone/rule data and no per-row hand-authored copy.
 */
function recommendationFor(item: UrgentItem): string {
  switch (item.kind) {
    case 'rent':
      return 'Current Rent record shows an unpaid balance — open the ledger for source evidence.';
    case 'work_order':
      return 'Current work-order record is emergency/open and still active.';
    default:
      return 'Current conversation record is still open.';
  }
}

// =====================================================================
// Hardcoded mock rows — LEGACY / TEST-ONLY
// =====================================================================

/**
 * The five rows from the original mockup, hardcoded verbatim from
 * `ref-context-map.md`. NOT reachable from `/today` — `page.tsx` renders
 * the live queue via `urgentItemToQueueItem`. Retained only so the
 * snapshot/order tests in `tests/today/queue-adapter.test.ts` keep
 * passing. Order: leak → rent → vendor → noise → lockbox.
 */
export function getMockQueueItems(): QueueItem[] {
  return [
    {
      id: 'leak',
      status: 'review',
      title: 'Maintenance escalation — slow leak under kitchen sink',
      property: '14 Maple Ct',
      unit: 'Unit 3B',
      tenant: 'Priya R.',
      meta: [
        'reported 06:42',
        '$640 quote',
        '48-hour SLA',
        'used twice before',
      ],
      recommendation: 'Odesa recommends approving Greene Plumbing —',
      timestamp: '12m ago',
      channel: 'maintenance',
      contextLabel: ROW_CONTEXT.leak.contextLabel,
      contextSuggestions: [...ROW_CONTEXT.leak.contextSuggestions],
      contextPlaceholder: ROW_CONTEXT.leak.contextPlaceholder,
      linkedLabel: ROW_CONTEXT.leak.linkedLabel,
      primaryAction: { label: 'Approve', handler: 'approve' },
      secondaryAction: { label: 'Review quote', handler: 'review-quote' },
    },
    {
      id: 'rent',
      status: 'draft',
      title: 'Late rent reminder for Sandra K.',
      property: '22 Oak St',
      unit: 'Unit 1',
      tenant: 'Sandra K.',
      meta: ['day 5 late', '$1,425'],
      recommendation:
        "Odesa drafted a warm but firm message. No payment plan needed yet — she's been on time eleven months running.",
      timestamp: '1h ago',
      channel: 'rent',
      contextLabel: ROW_CONTEXT.rent.contextLabel,
      contextSuggestions: [...ROW_CONTEXT.rent.contextSuggestions],
      contextPlaceholder: ROW_CONTEXT.rent.contextPlaceholder,
      linkedLabel: ROW_CONTEXT.rent.linkedLabel,
      primaryAction: { label: 'Send', handler: 'send' },
      secondaryAction: { label: 'Edit draft', handler: 'edit-draft' },
    },
    {
      id: 'vendor',
      status: 'waiting',
      title: 'Vendor silence — Greene HVAC, second nudge unanswered',
      property: '108 Cedar Ln',
      unit: 'Unit 2A',
      meta: ['no reply since Friday', '3 days'],
      recommendation:
        'Two SMS nudges sent. A phone call from you reads firmer than a third message — Odesa can ghost-write the script.',
      timestamp: '3h ago',
      channel: 'vendor',
      contextLabel: ROW_CONTEXT.vendor.contextLabel,
      contextSuggestions: [...ROW_CONTEXT.vendor.contextSuggestions],
      contextPlaceholder: ROW_CONTEXT.vendor.contextPlaceholder,
      linkedLabel: ROW_CONTEXT.vendor.linkedLabel,
      primaryAction: { label: 'Escalate', handler: 'escalate' },
      secondaryAction: { label: 'Snooze', handler: 'snooze' },
    },
    {
      id: 'noise',
      status: 'escalated',
      title: 'Tenant complaint — noise dispute, second mention this month',
      property: '22 Oak St',
      unit: 'Unit 4',
      tenant: 'Marcus T.',
      meta: ['thread of 4'],
      recommendation:
        'Context logged across both incidents. A short reply now is cheaper than a pattern later — Odesa has a tone-neutral draft.',
      timestamp: 'yesterday',
      channel: 'inbox',
      contextLabel: ROW_CONTEXT.noise.contextLabel,
      contextSuggestions: [...ROW_CONTEXT.noise.contextSuggestions],
      contextPlaceholder: ROW_CONTEXT.noise.contextPlaceholder,
      linkedLabel: ROW_CONTEXT.noise.linkedLabel,
      primaryAction: { label: 'Reply', handler: 'reply' },
      secondaryAction: { label: 'Open thread', handler: 'open-thread' },
    },
    {
      id: 'lockbox',
      status: 'resolved',
      title: 'Quarterly lockbox code rotation — all six properties',
      property: 'portfolio-wide',
      meta: ['6 codes rotated', 'vendors notified'],
      recommendation:
        'Completed automatically overnight. New codes are shared in the vendor portal — no owner action needed.',
      timestamp: '06:14',
      channel: 'vendor',
      contextLabel: ROW_CONTEXT.lockbox.contextLabel,
      contextSuggestions: [...ROW_CONTEXT.lockbox.contextSuggestions],
      contextPlaceholder: ROW_CONTEXT.lockbox.contextPlaceholder,
      linkedLabel: ROW_CONTEXT.lockbox.linkedLabel,
      primaryAction: { label: 'View log', handler: 'view-log' },
    },
  ];
}
