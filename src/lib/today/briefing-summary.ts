/**
 * Live daily briefing synthesis for the Today console.
 *
 * Turns the current portfolio state into the one editorial sentence,
 * the supporting bullets, and the semantic tone the briefing card
 * renders. Pure module — no IO, deterministic for a given input — so
 * the copy can be unit-tested directly and the card stays purely
 * presentational (10-briefing.md §synthesizeBriefing).
 *
 * Copy follows the hub copy-system (00-BUILD-HUB §Copy system): calm,
 * operator-like, specific. The sentence always reads as a desk that
 * already checked the portfolio — never blank, even when quiet.
 */

import type { StatusTone } from './status';

/** A single upcoming deadline worth surfacing in the briefing. */
export interface BriefingDeadline {
  /** Human label, e.g. 'Lease ends · Unit 4B'. */
  label: string;
  /** Short date stamp, e.g. 'May 28'. */
  date: string;
}

/** Current portfolio state the briefing is synthesized from. */
export interface BriefingInput {
  /** Items currently needing the owner's review (attention queue). */
  urgentCount: number;
  /** Rent follow-ups Odesa has drafted and is holding for review. */
  draftsCount: number;
  /** The nearest upcoming deadline, if any (lease end, move-in, etc.). */
  nextDeadline?: BriefingDeadline;
  /** One-line summary of what Odesa checked, for the standing bullet. */
  checksSummary: string;
}

/** The synthesized briefing the card renders. */
export interface BriefingSummary {
  /** The single editorial-serif sentence. */
  sentence: string;
  /** 2–3 supporting sans bullets. */
  bullets: string[];
  /** Semantic tone for the accent / status. */
  tone: StatusTone;
}

/** Number words for small counts; falls back to the digit for larger. */
const NUMBER_WORDS: Readonly<Record<number, string>> = {
  1: 'One',
  2: 'Two',
  3: 'Three',
  4: 'Four',
  5: 'Five',
  6: 'Six',
  7: 'Seven',
  8: 'Eight',
  9: 'Nine',
};

/**
 * Capitalized count word for the start of a sentence ('Two', '12').
 *
 * @param n - A non-negative count.
 * @returns The spelled-out word for 1–9, otherwise the digits.
 */
function countWord(n: number): string {
  return NUMBER_WORDS[n] ?? String(n);
}

/** Pluralizes a noun against a count ('item' / 'items'). */
function plural(n: number, singular: string): string {
  return n === 1 ? singular : `${singular}s`;
}

/**
 * Synthesizes the live daily briefing from current portfolio state.
 *
 * - Zero urgent items reads quiet and healthy.
 * - One or more reads as a review ask, tone `review`.
 * - Bullets always lead with what Odesa checked, then add a drafts line
 *   and a deadline line when those are present (2–3 bullets total).
 *
 * @param input - Current portfolio state.
 * @returns The sentence, bullets, and tone for the briefing card.
 *
 * @example
 * const b = synthesizeBriefing({
 *   urgentCount: 0,
 *   draftsCount: 0,
 *   checksSummary: 'Odesa checked rent, work orders, tenant inbox, and lease deadlines.',
 * });
 * // b.sentence === 'Nothing urgent needs you.'
 */
export function synthesizeBriefing(input: BriefingInput): BriefingSummary {
  const { urgentCount, draftsCount, nextDeadline, checksSummary } = input;

  const urgent = Number.isFinite(urgentCount) && urgentCount > 0 ? Math.floor(urgentCount) : 0;
  const drafts = Number.isFinite(draftsCount) && draftsCount > 0 ? Math.floor(draftsCount) : 0;

  const sentence =
    urgent === 0
      ? 'Nothing urgent needs you.'
      : `${countWord(urgent)} ${plural(urgent, 'thing')} ${urgent === 1 ? 'needs' : 'need'} your review.`;
  const tone: StatusTone = urgent === 0 ? 'healthy' : 'review';

  const bullets: string[] = [checksSummary];
  if (drafts > 0) {
    bullets.push(
      `${countWord(drafts)} rent ${plural(drafts, 'follow-up')} ${drafts === 1 ? 'is' : 'are'} drafted for review.`,
    );
  }
  if (nextDeadline) {
    bullets.push(`${nextDeadline.label} on ${nextDeadline.date}.`);
  }

  return { sentence, bullets, tone };
}

// ---------------------------------------------------------------------------
// V2 briefing header (used by the new Today v2 console)
// ---------------------------------------------------------------------------

import type { WatchChannel } from '@/types/today';
import type { UrgentItem, UrgentItemKind } from './queries';

/**
 * A run of inline text inside a briefing bullet. Renderers wrap `name`
 * spans in `<b>`-equivalent styling and `num` spans in `<b>` + `.num`
 * tabular-figure styling.
 */
export type BriefingSegment =
  | { kind: 'text'; value: string }
  | { kind: 'name'; value: string }
  | { kind: 'num'; value: string };

export interface BriefingHeaderSentence {
  /** Plain prefix, e.g. "Three current items; ". */
  prefix: string;
  /** Italic-terracotta emphasis, e.g. "only one". Empty string when the
   *  attention count is zero (renderer hides the span). */
  italic: string;
  /** Plain suffix, e.g. " needs you.". */
  suffix: string;
}

export interface BriefingHeaderCta {
  label: string;
  href: string;
}

export interface BriefingHeaderData {
  sentence: BriefingHeaderSentence;
  bullets: BriefingSegment[][];
  cta: BriefingHeaderCta;
  /**
   * Optional secondary link label, e.g. "Show all five changes". Null
   * when there's nothing extra to surface (zero-change days).
   */
  secondaryLabel: string | null;
}

export interface BriefingHeaderInput {
  /** Urgent items (the owner-review queue source); used for sentence
   *  count and CTA selection. */
  urgentItems: readonly UrgentItem[];
  /** Current Inbox draft records folded into the summary count. */
  draftsCount: number;
  /** Most-recent rent collection percentage (0–100), or null when
   *  rent isn't billed this month. */
  rentCollectedPct: number | null;
  /** Soonest deadline label/date, or null. */
  nextDeadline?: BriefingDeadline | null;
}

const CHANNEL_BY_KIND: Readonly<Record<UrgentItemKind, WatchChannel>> = {
  conversation: 'inbox',
  rent: 'rent',
  work_order: 'maintenance',
};

/**
 * Per-channel counts for the orbit. Always returns a complete record
 * (zero for any channel without an item) so the renderer can iterate
 * without conditional checks.
 */
export function getChannelCounts(
  urgentItems: readonly UrgentItem[],
): Record<WatchChannel, number> {
  const counts: Record<WatchChannel, number> = {
    lease: 0,
    maintenance: 0,
    rent: 0,
    inbox: 0,
    vendor: 0,
    documents: 0,
  };
  for (const item of urgentItems) {
    const ch = CHANNEL_BY_KIND[item.kind] ?? 'inbox';
    counts[ch] = (counts[ch] ?? 0) + 1;
  }
  return counts;
}

/**
 * Picks the single channel that most deserves the gold "in attention"
 * ring on the orbit. Returns null when nothing is urgent — the orbit
 * renders a quiet steady state in that case.
 */
export function pickAttentionChannel(
  counts: Record<WatchChannel, number>,
): WatchChannel | null {
  let best: WatchChannel | null = null;
  let bestCount = 0;
  for (const [channel, count] of Object.entries(counts) as [
    WatchChannel,
    number,
  ][]) {
    if (count > bestCount) {
      bestCount = count;
      best = channel;
    }
  }
  return best;
}

function segText(value: string): BriefingSegment {
  return { kind: 'text', value };
}
function segName(value: string): BriefingSegment {
  return { kind: 'name', value };
}
function segNum(value: string): BriefingSegment {
  return { kind: 'num', value };
}

/**
 * Synthesizes the v2 briefing header from current portfolio state. The
 * sentence reports current records rather than inventing an overnight window.
 * The attention count is rendered in italic-terracotta. Bullets
 * lead with the top urgent item, then a rent collection line, then
 * the soonest deadline (when each exists). CTA points at the top
 * urgent item.
 */
export function synthesizeBriefingHeader(
  input: BriefingHeaderInput,
): BriefingHeaderData {
  const { urgentItems, draftsCount, rentCollectedPct } = input;
  const attentionCount = urgentItems.length;
  const totalChanges = attentionCount + Math.max(0, draftsCount);

  // ---- sentence ----------------------------------------------------------
  let sentence: BriefingHeaderSentence;
  if (totalChanges === 0) {
    sentence = {
      prefix: 'All quiet — ',
      italic: 'nothing',
      suffix: ' needs you right now.',
    };
  } else if (attentionCount === 0) {
    sentence = {
      prefix: `${countWord(totalChanges)} Inbox ${plural(totalChanges, 'draft')} ${totalChanges === 1 ? 'is' : 'are'} available; `,
      italic: 'nothing',
      suffix: ' needs you in Today.',
    };
  } else {
    const attentionWord =
      attentionCount === 1 ? 'only one' : countWord(attentionCount).toLowerCase();
    const needsVerb = attentionCount === 1 ? ' needs you.' : ' need you.';
    sentence = {
      prefix: `${countWord(totalChanges)} current ${plural(totalChanges, 'item')}; `,
      italic: attentionWord,
      suffix: needsVerb,
    };
  }

  // ---- bullets -----------------------------------------------------------
  const bullets: BriefingSegment[][] = [];
  const top = urgentItems[0] ?? null;
  if (top) {
    const where: BriefingSegment[] = [];
    if (top.unitLabel) {
      where.push(segName(`Unit ${top.unitLabel}`));
    } else if (top.tenantName) {
      where.push(segName(top.tenantName));
    }
    const leadVerb =
      top.kind === 'work_order'
        ? 'was reported'
        : top.kind === 'rent'
          ? 'was flagged'
          : 'came in';
    const status = top.statusLabel ? ` — ${top.statusLabel.toLowerCase()}` : '';
    const bullet: BriefingSegment[] = [
      segText(`A ${kindNoun(top.kind)} ${leadVerb}${where.length ? ' at ' : ''}`),
    ];
    if (where.length) {
      bullet.push(...where);
    }
    bullet.push(segText(`${status}.`));
    bullets.push(bullet);
  }

  if (rentCollectedPct !== null && Number.isFinite(rentCollectedPct)) {
    const pct = Math.max(0, Math.min(100, Math.round(rentCollectedPct)));
    const month = new Date().toLocaleString('en-US', { month: 'long' });
    const rentBullet: BriefingSegment[] = [
      segText('Rent collection is holding at '),
      segNum(`${pct}%`),
      segText(` for ${month}.`),
    ];
    if (draftsCount > 0) {
      const r = draftsCount;
      rentBullet.push(
        segText(
          ` ${countWord(r)} Inbox ${plural(r, 'draft')} ${r === 1 ? 'is' : 'are'} ready to read.`,
        ),
      );
    }
    bullets.push(rentBullet);
  }

  if (input.nextDeadline) {
    bullets.push([
      segText(`${input.nextDeadline.label} — `),
      segName(input.nextDeadline.date),
      segText(' is the next window.'),
    ]);
  }

  // ---- cta ---------------------------------------------------------------
  const cta: BriefingHeaderCta = top
    ? {
        label: `Review ${ctaShort(top)}`,
        href: top.href,
      }
    : {
        label: 'Open Owner Queue',
        href: '/owner-queue',
      };

  const secondaryLabel =
    totalChanges > 1
      ? `Show all ${countWord(totalChanges).toLowerCase()} current items`
      : null;

  return { sentence, bullets, cta, secondaryLabel };
}

function kindNoun(kind: UrgentItemKind): string {
  switch (kind) {
    case 'rent':
      return 'rent issue';
    case 'work_order':
      return 'work order';
    default:
      return 'tenant message';
  }
}

function ctaShort(item: UrgentItem): string {
  if (item.kind === 'work_order') return 'the work order';
  if (item.kind === 'rent') return 'the rent flag';
  if (item.tenantName) return `${item.tenantName.split(' ')[0]}'s thread`;
  return 'the thread';
}

function capitalize(value: string): string {
  return value.length ? value[0].toUpperCase() + value.slice(1) : value;
}

/**
 * One current item, enumerated for the "Show all N current items"
 * disclosure. The list length matches `totalChanges` in
 * {@link synthesizeBriefingHeader} (urgent items + ready drafts), so the
 * label and the revealed rows always agree.
 */
export interface BriefingChange {
  /** Inline text segments (same renderer as the bullets). */
  segments: BriefingSegment[];
  /** Where the operator acts on it — a `/review/...` page or `/inbox`. */
  href: string;
  /** True for the items that still need the owner (drives the dot color). */
  needsYou: boolean;
}

/**
 * Builds the full enumerated change list the briefing disclosure reveals.
 * Urgent items link to their review page; ready drafts link to the inbox.
 * Pure — deterministic for a given input, unit-testable without IO.
 *
 * @param urgentItems - The owner-review queue source (each "needs you").
 * @param readyDrafts - Drafts Odesa prepared and is holding for a read.
 * @returns One {@link BriefingChange} per change, urgent items first.
 */
export function buildBriefingChanges(
  urgentItems: readonly UrgentItem[],
  readyDrafts: readonly { tenant: string; unitLine?: string }[],
): BriefingChange[] {
  const changes: BriefingChange[] = [];

  for (const item of urgentItems) {
    const where: BriefingSegment[] = [];
    if (item.unitLabel) {
      where.push(segName(`Unit ${item.unitLabel}`));
    } else if (item.tenantName) {
      where.push(segName(item.tenantName));
    }
    const leadVerb =
      item.kind === 'work_order'
        ? 'reported'
        : item.kind === 'rent'
          ? 'flagged'
          : 'came in';
    const status = item.statusLabel ? ` — ${item.statusLabel.toLowerCase()}` : '';
    const segments: BriefingSegment[] = [
      segText(`${capitalize(kindNoun(item.kind))} ${leadVerb}${where.length ? ' at ' : ''}`),
    ];
    if (where.length) {
      segments.push(...where);
    }
    segments.push(segText(`${status}.`));
    changes.push({ segments, href: item.href, needsYou: true });
  }

  for (const draft of readyDrafts) {
    const segments: BriefingSegment[] = [
      segText('Reply drafted for '),
      segName(draft.tenant || 'a tenant'),
      segText(draft.unitLine ? ` · ${draft.unitLine}.` : ' — awaiting your read.'),
    ];
    changes.push({ segments, href: '/inbox', needsYou: false });
  }

  return changes;
}
