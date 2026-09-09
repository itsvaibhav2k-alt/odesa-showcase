/**
 * Today v2 — shared types for the Quiet Operator Console.
 *
 * These types describe the public shape of a row in the Owner Review
 * queue and a signal in the Watching Quietly rail. They are consumed by
 * server components (data fetch + composition), the selection client
 * island, and the adapter that bridges `UrgentItem` rows from the DB
 * into renderable `QueueItem`s.
 *
 * Keep this file dependency-free: importing DB types here would couple
 * the UI surface to the Supabase schema, which is exactly what the
 * adapter exists to prevent.
 */

/** Watch-rail channel a row + watch-item can be tagged with. */
export type WatchChannel =
  | 'lease'
  | 'maintenance'
  | 'rent'
  | 'inbox'
  | 'vendor'
  | 'documents';

/** Lifecycle status of a queue row — drives chip color + label. */
export type QueueStatus =
  | 'review'
  | 'draft'
  | 'waiting'
  | 'escalated'
  | 'resolved';

/**
 * A single row in the Owner Review queue. Authored per row (not derived
 * in the UI) so chips/context can be specific instead of generic.
 */
export interface QueueItem {
  id: string;
  status: QueueStatus;
  title: string;
  property: string;
  unit?: string;
  tenant?: string;
  meta: string[];
  recommendation: string;
  timestamp: string;
  channel: WatchChannel;
  contextLabel: string;
  contextSuggestions: string[];
  contextPlaceholder: string;
  linkedLabel?: string;
  primaryAction: { label: string; handler: string };
  secondaryAction?: { label: string; handler: string };
  /** Conservative boundary line — what won't happen until the owner acts. */
  nextStep?: string;
  /** Concrete consequence of leaving the row untouched (real, not voiced). */
  ifIgnored?: string;
  /** Operational boundary micro-tag (e.g. "Owner approval required"). */
  ownerRule?: string;
  /** Deterministic "Why this?" disclosure — grounded, never AI-voiced. */
  reason?: string;
  /** Domain-specific source link label (e.g. "View ledger"). */
  sourceLabel?: string;
  /** Route the source link navigates to (the underlying evidence). */
  sourceHref?: string;
}

/** A single item in the Watching Quietly right-rail. */
export interface WatchSignal {
  channel: WatchChannel;
  title: string;
  meta: string;
  dotVariant: 'amber' | 'clay' | 'green' | 'muted';
}

/** Tone shared by the Today financial briefing dots/badges. */
export type TodayFinancialTone = 'green' | 'amber' | 'clay' | 'muted';

/**
 * The single biggest money-shaped exception, flattened for the Today
 * briefing. `amountCents` is integer cents (never dollars / a float) and
 * may be `null` when the exception is not money-shaped.
 */
export interface TodayFinancialException {
  title: string;
  detail: string;
  amountCents: number | null;
  propertyId: string | null;
}

/** One quiet "watching" financial signal for the Today briefing. */
export interface TodayFinancialWatch {
  title: string;
  meta: string;
  tone: TodayFinancialTone;
}

/**
 * Compact, high-signal financial summary for the Today morning console.
 * A deliberately slim projection of `PortfolioFinancialSummary` — Today
 * is the briefing, not the financial page. All money is integer cents.
 */
export interface TodayFinancialBriefing {
  /** Reporting-period label, e.g. 'June 2026'. */
  periodLabel: string;
  rentBilledCents: number;
  rentCollectedCents: number;
  rentOutstandingCents: number;
  rentLateCents: number;
  /** Collected / billed as a percent; null when nothing billed. */
  collectionRatePct: number | null;
  /** Tone for the collections headline dot. */
  collectionsTone: TodayFinancialTone;
  /** Biggest money-shaped exception, or null when none exists. */
  topException: TodayFinancialException | null;
  /** One quiet financial signal Odesa is watching. */
  watch: TodayFinancialWatch;
  /** Honest expense state — false until expense imports are connected. */
  expensesConnected: boolean;
  /** True when any rent has been billed this period. */
  hasBilled: boolean;
}
