'use client';

import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { type StatusTone, statusColor } from '@/lib/today/status';
import type { UrgentItem, UrgentItemKind } from '@/lib/today/queries';

/**
 * Segmented attention queue for the Today console (00-BUILD-HUB §4,
 * 20-attention-queue). A segmented control of COMPACT ROWS — not big
 * cards — showing the exceptions that need owner judgment, plus what
 * Odesa has drafted and what it is quietly watching.
 *
 * Three segments:
 * - "Needs review" — items waiting on owner judgement (gold / review).
 *   Backed by `getUrgentItems()`; action verb by kind.
 * - "Odesa drafted" — replies Odesa staged for approval (navy / watching).
 *   Backed by `listInboxBuckets()` needsJudgment + readyToSend.
 * - "Watching" — lower-priority monitored items, no action (neutral).
 *
 * Each row's accent dot resolves through `statusColor` rather than a
 * per-segment hex, so a color always means the same thing across the
 * screen. Compact: 8–12px gaps, hairline dividers, hover navy tint.
 *
 * PRESENTATIONAL: takes pre-built arrays per segment. The integrator
 * wires `getUrgentItems` / `listInboxBuckets` into these props later.
 *
 * Empty states must PROVE MONITORING — never a blank panel (§3.2).
 * Each segment carries a calm line that names what Odesa checked and
 * links to Recent Checks.
 */

/** Which segment a row belongs to; drives accent tone + action verb. */
export type AttentionSegment = 'needs_review' | 'odesa_drafted' | 'watching';

/**
 * One row in the attention queue. A presentational superset of
 * {@link UrgentItem}: the shared fields render the row, `segment`
 * routes it to a tab, and the optional fields let the integrator
 * supply already-formatted copy without the row reaching into data.
 */
export interface AttentionItem extends UrgentItem {
  /** Which tab this row lives under. */
  segment: AttentionSegment;
  /** Odesa's one-line recommendation, e.g. "Draft ready". Optional. */
  recommendation?: string | null;
  /** Pre-formatted time/context, e.g. "2d" or "28h". Mono. Optional. */
  timeLabel?: string | null;
}

export interface AttentionQueueProps {
  /** Items waiting on owner judgement (gold / review). */
  needsReview: AttentionItem[];
  /** Odesa-staged replies awaiting approval (navy / watching accent). */
  odesaDrafted: AttentionItem[];
  /** Quiet items Odesa is monitoring; no action required (neutral). */
  watching: AttentionItem[];
}

interface SegmentConfig {
  /** Internal key for prop routing. */
  readonly key: AttentionSegment;
  /** Stable testid suffix (matches 20-attention-queue: needs|drafted|watching). */
  readonly testidSuffix: string;
  readonly label: string;
  readonly tone: StatusTone;
  /** Calm empty-state line that proves monitoring. */
  readonly empty: string;
}

const SEGMENTS: readonly SegmentConfig[] = [
  {
    key: 'needs_review',
    testidSuffix: 'needs',
    label: 'Needs review',
    tone: 'review',
    empty: 'Nothing needs your judgment. Odesa checked rent, inbox, work orders, and leases.',
  },
  {
    key: 'odesa_drafted',
    testidSuffix: 'drafted',
    label: 'Odesa drafted',
    tone: 'watching',
    empty: 'No drafts waiting. Odesa stages replies here for your approval before they send.',
  },
  {
    key: 'watching',
    testidSuffix: 'watching',
    label: 'Watching',
    tone: 'neutral',
    empty: 'All quiet. Odesa is monitoring conversations, rent, and work orders in the background.',
  },
];

function itemsFor(props: AttentionQueueProps, key: AttentionSegment): AttentionItem[] {
  switch (key) {
    case 'needs_review':
      return props.needsReview;
    case 'odesa_drafted':
      return props.odesaDrafted;
    case 'watching':
      return props.watching;
  }
}

/**
 * Primary action verb for a row, by segment and item kind. Needs-review
 * verbs vary by kind (conversation→Review, rent→Approve, WO→Follow up);
 * drafted rows approve; watched rows just open.
 */
function actionLabel(segment: AttentionSegment, kind: UrgentItemKind): string {
  if (segment === 'odesa_drafted') return 'Approve';
  if (segment === 'watching') return 'Open';
  switch (kind) {
    case 'conversation':
      return 'Review';
    case 'rent':
      return 'Approve';
    case 'work_order':
      return 'Follow up';
  }
}

export function AttentionQueue(props: AttentionQueueProps) {
  return (
    <section
      data-testid="today-attention-queue"
      aria-labelledby="today-attention-heading"
      style={{
        background: 'var(--paper-0)',
        border: '1px solid var(--ink-200)',
        borderRadius: 'var(--radius-md-odesa)',
        padding: '20px 0 8px',
      }}
    >
      <p id="today-attention-heading" className="meta-label" style={{ padding: '0 24px 10px' }}>
        Attention
      </p>

      <Tabs defaultValue="needs_review" style={{ gap: 0 }}>
        <TabsList style={{ margin: '0 24px 4px' }}>
          {SEGMENTS.map((segment) => {
            const count = itemsFor(props, segment.key).length;
            return (
              <TabsTrigger
                key={segment.key}
                value={segment.key}
                data-testid={`today-attention-tab-${segment.testidSuffix}`}
              >
                {segment.label}
                <span
                  aria-hidden="true"
                  style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: '11px',
                    color: 'var(--ink-500)',
                  }}
                >
                  {count}
                </span>
              </TabsTrigger>
            );
          })}
        </TabsList>

        {SEGMENTS.map((segment) => {
          const items = itemsFor(props, segment.key);
          return (
            <TabsContent key={segment.key} value={segment.key}>
              {items.length === 0 ? (
                <EmptySegment segment={segment} />
              ) : (
                <ul role="list" data-testid={`today-attention-list-${segment.testidSuffix}`}>
                  {items.map((item) => (
                    <li key={`${item.kind}:${item.id}`}>
                      <AttentionRow item={item} config={segment} />
                    </li>
                  ))}
                </ul>
              )}
            </TabsContent>
          );
        })}
      </Tabs>
    </section>
  );
}

function EmptySegment({ segment }: { segment: SegmentConfig }) {
  return (
    <div
      data-testid={`today-attention-empty-${segment.testidSuffix}`}
      style={{ padding: '20px 24px 16px' }}
    >
      <p
        className="font-brief"
        style={{
          fontSize: '17px',
          lineHeight: 1.4,
          color: 'var(--ink-700)',
          margin: 0,
        }}
      >
        {segment.empty}
      </p>
      <Link
        href="#today-recent-checks"
        style={{
          display: 'inline-block',
          marginTop: '10px',
          fontSize: '12px',
          fontWeight: 500,
          color: 'var(--navy-700)',
          textDecoration: 'none',
        }}
      >
        See Recent Checks →
      </Link>
    </div>
  );
}

function AttentionRow({ item, config }: { item: AttentionItem; config: SegmentConfig }) {
  const accent = statusColor(config.tone);
  const tenant = item.tenantName?.trim() || 'Unknown tenant';
  const unit = item.unitLabel?.trim();
  const recommendation = item.recommendation?.trim() || item.statusLabel;
  const time = item.timeLabel?.trim();

  return (
    <Link
      href={item.href}
      data-testid={`today-attention-row-${item.id}`}
      data-attention-segment={item.segment}
      className="group flex items-center gap-3 transition-row-hover"
      style={{
        padding: '12px 24px',
        borderTop: '1px solid var(--paper-200)',
        textDecoration: 'none',
        color: 'var(--ink-800)',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.backgroundColor = 'var(--paper-50)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.backgroundColor = 'transparent';
      }}
    >
      <span
        aria-hidden="true"
        style={{
          flexShrink: 0,
          width: '6px',
          height: '6px',
          borderRadius: '50%',
          background: accent,
        }}
      />
      <div className="flex-1 min-w-0">
        <p
          className="truncate"
          style={{ fontSize: '14px', fontWeight: 600, color: 'var(--ink-900)' }}
        >
          {tenant}
        </p>
        <p className="truncate" style={{ fontSize: '12px', color: 'var(--ink-600)' }}>
          {recommendation}
        </p>
      </div>
      {unit ? (
        <span
          className="truncate"
          style={{
            flexShrink: 0,
            maxWidth: '120px',
            fontFamily: 'var(--font-mono)',
            fontSize: '11px',
            color: 'var(--ink-500)',
          }}
        >
          Unit {unit}
        </span>
      ) : null}
      {time ? (
        <span
          style={{
            flexShrink: 0,
            fontFamily: 'var(--font-mono)',
            fontSize: '11px',
            color: 'var(--ink-500)',
            whiteSpace: 'nowrap',
          }}
        >
          {time}
        </span>
      ) : null}
      <div className="flex items-center gap-2" style={{ whiteSpace: 'nowrap', flexShrink: 0 }}>
        <span
          data-testid={`today-attention-row-${item.id}-action`}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            padding: '6px 12px',
            borderRadius: 'var(--radius-sm-odesa)',
            border: '1px solid var(--navy-700)',
            color: 'var(--navy-700)',
            background: 'transparent',
            fontSize: '12px',
            fontWeight: 500,
            letterSpacing: '0.02em',
          }}
        >
          {actionLabel(item.segment, item.kind)}
        </span>
        <span
          className="opacity-0 group-hover:opacity-100"
          style={{
            color: 'var(--ink-500)',
            display: 'inline-flex',
            transition: 'opacity 180ms var(--ease-smooth)',
          }}
          aria-hidden="true"
        >
          <ChevronRight size={16} />
        </span>
      </div>
    </Link>
  );
}
