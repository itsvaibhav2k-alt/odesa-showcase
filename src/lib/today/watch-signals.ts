/**
 * Today v2 — "Watching Quietly" rail signal derivation.
 *
 * Builds the `WatchSignal[]` for the right-rail from the REAL portfolio
 * state the Today page already fetched: lease deadlines, maintenance
 * work orders, rent collection, inbox health, and vendor activity.
 *
 * Pure module — no IO, deterministic for a given input — so the copy can
 * be unit-tested directly. Every `meta` string is composed from real
 * numbers (counts, percentages, dates) the page passes in; there is no
 * hand-authored demo copy here.
 *
 * Each signal carries a UNIQUE `channel`, which the rail uses both as
 * the React list key and to drive the emphasis link with the selected
 * queue row. Signals are returned in a stable display order
 * (lease → maintenance → rent → inbox → vendor).
 */

import type { WatchChannel, WatchSignal } from '@/types/today';
import type { BriefingDeadline } from './briefing-summary';
import type { UrgentItem } from './queries';

/** Inputs `deriveWatchSignals` reads — all from the page's live fetch. */
export interface WatchSignalsInput {
  /** Live urgent-items feed; maintenance + vendor signals read from it. */
  urgentItems: readonly UrgentItem[];
  /** Number of leases expiring within the look-ahead window. */
  expiringLeasesCount: number;
  /** Soonest upcoming deadline (lease end / move-in), if any. */
  nextDeadline?: BriefingDeadline | null;
  /** Rent collected this cycle as a percentage (0–100), or null. */
  rentCollectedPct: number | null;
  /** Drafts/queue summary from `listInboxBuckets(...).summary`. */
  draftsSummary: {
    needsCount: number;
    readyCount: number;
    sentTodayCount: number;
  };
  /** Per-channel urgent counts from `getChannelCounts(urgentItems)`. */
  channelCounts: Record<WatchChannel, number>;
}

/** Pluralizes a noun against a count ('lease' / 'leases'). */
function plural(n: number, singular: string): string {
  return n === 1 ? singular : `${singular}s`;
}

/** Builds the lease-deadline signal from expiring-lease counts + the
 *  next deadline. Amber when something is upcoming, muted when quiet. */
function leaseSignal(input: WatchSignalsInput): WatchSignal {
  const count = Math.max(0, input.expiringLeasesCount);
  if (count === 0) {
    return {
      channel: 'lease',
      title: 'Lease deadlines',
      meta: 'No leases expiring this week.',
      dotVariant: 'muted',
    };
  }
  const next = input.nextDeadline
    ? ` Next is ${input.nextDeadline.date}.`
    : '';
  return {
    channel: 'lease',
    title: 'Lease deadlines',
    meta: `${count} ${plural(count, 'lease')} expiring this week.${next}`,
    dotVariant: 'amber',
  };
}

/** Builds the maintenance signal from open work_order urgent items. */
function maintenanceSignal(input: WatchSignalsInput): WatchSignal {
  const count = input.urgentItems.filter(
    (i) => i.kind === 'work_order',
  ).length;
  if (count === 0) {
    return {
      channel: 'maintenance',
      title: 'Maintenance risk',
      meta: 'No urgent work orders in this queue.',
      dotVariant: 'muted',
    };
  }
  return {
    channel: 'maintenance',
    title: 'Maintenance risk',
    meta: `${count} urgent ${plural(count, 'work order')} open · vendor timing not verified.`,
    dotVariant: 'clay',
  };
}

/** Builds the rent-collection signal from the collected percentage.
 *  Green when healthy, amber when lagging, muted when nothing's billed. */
function rentSignal(input: WatchSignalsInput): WatchSignal {
  if (input.rentCollectedPct === null || !Number.isFinite(input.rentCollectedPct)) {
    return {
      channel: 'rent',
      title: 'Rent collection',
      meta: 'No rent billed this cycle yet.',
      dotVariant: 'muted',
    };
  }
  const pct = Math.max(0, Math.min(100, Math.round(input.rentCollectedPct)));
  const healthy = pct >= 90;
  return {
    channel: 'rent',
    title: 'Rent collection',
    meta: healthy
      ? `${pct}% collected · ${100 - pct}% still outstanding.`
      : `${pct}% collected · ${100 - pct}% still outstanding.`,
    dotVariant: healthy ? 'green' : 'amber',
  };
}

/** Builds the inbox-health signal from the drafts summary. Amber when
 *  drafts await a read, muted when the inbox is clear. */
function inboxSignal(input: WatchSignalsInput): WatchSignal {
  const { needsCount, readyCount, sentTodayCount } = input.draftsSummary;
  const pending = Math.max(0, needsCount) + Math.max(0, readyCount);
  const sentMeta =
    sentTodayCount > 0 ? ` ${sentTodayCount} sent today.` : '';
  if (pending === 0) {
    return {
      channel: 'inbox',
      title: 'Inbox health',
      meta: `No drafts awaiting your read.${sentMeta}`,
      dotVariant: 'muted',
    };
  }
  return {
    channel: 'inbox',
    title: 'Inbox health',
    meta: `${pending} ${plural(pending, 'draft')} awaiting your read.${sentMeta}`,
    dotVariant: 'amber',
  };
}

/** Builds the vendor signal from conversations on the vendor channel. */
function vendorSignal(input: WatchSignalsInput): WatchSignal {
  const count = input.channelCounts.vendor ?? 0;
  if (count === 0) {
    return {
      channel: 'vendor',
      title: 'Vendor follow-up',
      meta: 'No vendor threads need attention.',
      dotVariant: 'muted',
    };
  }
  return {
    channel: 'vendor',
    title: 'Vendor follow-up',
    meta: `${count} vendor ${plural(count, 'thread')} open — awaiting response.`,
    dotVariant: 'clay',
  };
}

/**
 * Derives the current-record signal rail from live portfolio state.
 *
 * @param input - Live counts/percentages/deadlines from the Today page.
 * @returns One signal per channel, in stable display order. Every meta
 *   string is built from real numbers — never demo copy.
 */
export function deriveWatchSignals(
  input: WatchSignalsInput,
): WatchSignal[] {
  return [
    leaseSignal(input),
    maintenanceSignal(input),
    rentSignal(input),
    inboxSignal(input),
    vendorSignal(input),
  ];
}

/** Headline summarizing the rail — label + tone for the header dot. */
export interface WatchHeadline {
  label: string;
  tone: 'green' | 'amber' | 'clay';
}

/**
 * Derives the current-record header by counting elevated dot variants. These
 * are source-record signals, not proof that an automation is watching them.
 *
 * Failed agent runs are an accountability override: the header can never
 * read as clear while runs have failed. A
 * positive `failedRunCount` appends "· N failed run(s) to inspect" and
 * floors the tone at amber (a green rail escalates to amber; clay stays
 * clay).
 *
 * @param signals - The derived rail signals (see {@link deriveWatchSignals}).
 * @param failedRunCount - Failed agent runs in the recent window (default 0).
 * @returns A `{ label, tone }` pair for the header line + dot color.
 */
export function deriveWatchHeadline(
  signals: WatchSignal[],
  failedRunCount = 0,
): WatchHeadline {
  const clayCount = signals.filter((s) => s.dotVariant === 'clay').length;
  const amberCount = signals.filter((s) => s.dotVariant === 'amber').length;

  let label: string;
  let tone: WatchHeadline['tone'];
  if (clayCount > 0) {
    label = `${clayCount} elevated signal${clayCount === 1 ? '' : 's'}`;
    tone = 'clay';
  } else if (amberCount > 0) {
    label = `${amberCount} attention signal${amberCount === 1 ? '' : 's'}`;
    tone = 'amber';
  } else {
    label = 'No elevated signals';
    tone = 'green';
  }

  if (failedRunCount > 0) {
    label += ` · ${failedRunCount} failed run${failedRunCount === 1 ? '' : 's'} to inspect`;
    if (tone === 'green') tone = 'amber';
  }

  return { label, tone };
}
