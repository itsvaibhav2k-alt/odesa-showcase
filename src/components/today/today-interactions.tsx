'use client';

/**
 * Today v2 — selection client island.
 *
 * Owns the `selectedItem` state for the Today page: a single nullable
 * `QueueItem` representing the row the operator has clicked to bring
 * into focus. Selection drives three downstream visuals:
 *
 *  1. `<QueueRow>` — the selected row gets the terracotta inset shadow
 *     and the `var(--panel-lift)` background.
 *  2. `<WatchItem>` — the watch signal whose `channel` matches the
 *     selected item's `channel` is "emphasized" (inset shadow,
 *     panel-lift bg, dot scaled up) and shows the `↳ LINKED: …` tag.
 *  3. `<AskOdesaCommand>` — eyebrow swaps to `● IN CONTEXT — …` in
 *     terracotta, chips swap to `selectedItem.contextSuggestions`,
 *     placeholder swaps to `selectedItem.contextPlaceholder`, and the
 *     `× clear context` button becomes visible.
 *
 * Architectural shape:
 *  - This is the single client boundary for selection. `page.tsx`
 *    stays a server component and passes serialized data
 *    (`queueItems`, `watchSignals`) down as props. The island
 *    composes the queue, the rail, and the AskOdesa command itself
 *    so the selection state can be threaded purely via React props
 *    without a new Context or a render-prop crossing the server /
 *    client boundary (functions aren't serializable).
 *  - The section heads and rail footer are inlined here rather than reusing
 *    the static `<OwnerReviewQueue>` / `<WatchingQuietlyRail>`
 *    components from PR-2. Those static components remain for any
 *    surface that doesn't want the interactivity, but the live Today
 *    page renders through this island.
 *
 * State management decisions (see ref-hard-rules.md):
 *  - `useState<QueueItem | null>(null)` — no Zustand, no Redux, no
 *    Jotai, no URL state, no new React Context.
 *  - Click on row toggles: re-clicking the same row clears.
 *  - Esc key clears selection (`document` listener — works regardless
 *    of focus position).
 *  - Action button clicks call `e.stopPropagation()` inside
 *    `<QueueRow>` so they never bubble to the row container.
 */

import {
  useCallback,
  useEffect,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import Link from 'next/link';

import { AskOdesaCommand } from './ask-odesa-command';
import { QueueRow, type QueueAction } from './queue-row';
import { WatchItem } from './watch-item';
import type { QueueChipStatus } from './queue-chip';
import { formatAgoPhrase } from '@/lib/today/format';
import type { QueueItem, WatchSignal } from '@/types/today';

/** Watch-header tone — the 3-value subset of the rail dot variants. */
type WatchTone = 'green' | 'amber' | 'clay';

/** Render-prop API exposed for callers that want full layout control. */
export interface TodayInteractionsApi {
  /** Currently selected queue row, or null when no row is selected. */
  selectedItem: QueueItem | null;
  /** Toggle helper for row clicks: same-row re-click clears. */
  toggleItem: (item: QueueItem) => void;
  /** Direct setter (e.g. for tests or storybook). */
  setSelectedItem: (item: QueueItem | null) => void;
  /** Convenience alias used by AskOdesa's `× clear context` button. */
  onClearContext: () => void;
}

interface TodayInteractionsProps {
  /** Owner is the unchanged default; VA mode is inspect/prepare-only. */
  audience?: 'owner' | 'va';
  /**
   * Queue items rendered in the Owner Review queue. Adapter output
   * (`getMockQueueItems()` in PR-3) flows in from `page.tsx`. Each
   * item drives both its row and, when selected, the AskOdesa
   * context swap and the watch-rail emphasis.
   */
  queueItems: ReadonlyArray<QueueItem>;
  /**
   * Watch signals rendered in the Watching Quietly rail. Authored
   * verbatim from `ref-context-map.md` and threaded in by `page.tsx`.
   * The rail uses `channel` to determine emphasis vs the selected
   * queue item.
   */
  watchSignals: ReadonlyArray<WatchSignal>;
  /**
   * Honest "Watching Quietly" header derived from the live signals (see
   * `deriveWatchHeadline`). `label` replaces the old hardcoded "on
   * track"; `tone` colors the header dot + text via the same token
   * family the rail dots use. Never `'muted'` — the header always
   * resolves to one of the three meaningful tones.
   */
  watchHeadline: { label: string; tone: WatchTone };
  /**
   * Relative-time label (e.g. '11m', 'just now') for the rail footer's
   * "Refreshed …" line. Threaded from `page.tsx`'s `checkedAgoLabel` and
   * rendered through `formatAgoPhrase` so it can never read the broken
   * "Refreshed just now ago".
   */
  refreshedLabel: string;
  /**
   * Optional slot rendered BETWEEN the queue/rail grid and the
   * AskOdesa command bar. `page.tsx` passes the
   * `<OdesaHandlingPanel>` here so the dark handling strip keeps its
   * mockup position (queue → handling → AskOdesa) without leaving
   * the client island. The slot is server-renderable because it's
   * a plain React element, not a function.
   */
  middleSlot?: ReactNode;
  /**
   * Render-prop escape hatch. When provided, the island ignores its
   * default layout and yields control entirely. Useful for tests or
   * storybook stories that want full layout control.
   */
  children?: (api: TodayInteractionsApi) => ReactNode;
}

// ───────────────────────── styles ─────────────────────────

const queueRailGridStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 1fr) 320px',
  gap: '20px',
  alignItems: 'start',
};

const askOdesaBlockStyle: CSSProperties = {
  marginTop: '20px',
};

const middleSlotStyle: CSSProperties = {
  marginTop: '24px',
};

const sectionHeadStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'baseline',
  padding: '0 2px 12px',
  gap: 12,
};

const eyebrowStyle: CSSProperties = {
  fontSize: '9.5px',
  fontWeight: 500,
  letterSpacing: '0.16em',
  textTransform: 'uppercase',
  color: 'var(--ink-3)',
  padding: 0,
};

const countStyle: CSSProperties = {
  fontFamily: 'var(--font-mono-operator), ui-monospace, monospace',
  fontSize: '10.5px',
  color: 'var(--ink-2)',
  background: 'var(--canvas-deep)',
  padding: '1px 6px',
  borderRadius: 3,
  fontFeatureSettings: "'tnum' 1",
};

const sortLineStyle: CSSProperties = {
  marginLeft: 'auto',
  fontSize: '11px',
  color: 'var(--ink-3)',
  letterSpacing: '0.04em',
};

const sortAccentStyle: CSSProperties = {
  fontSize: '11px',
  color: 'var(--ink-3)',
};

const queueContainerStyle: CSSProperties = {
  background: 'var(--panel)',
  border: '1px solid var(--hairline)',
  borderRadius: 8,
  overflow: 'hidden',
};

// Empty-state copy shown when the live queue / rail have no rows. Quiet,
// operator-voice, and styled to sit inside the existing containers so the
// UI never renders a bare bordered box.
const queueEmptyStyle: CSSProperties = {
  padding: '20px 18px',
  fontFamily: 'var(--font-sans-operator)',
  fontSize: '13px',
  color: 'var(--ink-3)',
  lineHeight: 1.5,
};

const railEmptyStyle: CSSProperties = {
  padding: '8px 0 4px',
  fontFamily: 'var(--font-sans-operator)',
  fontSize: '12px',
  color: 'var(--ink-3)',
  lineHeight: 1.5,
};

const railContainerStyle: CSSProperties = {
  position: 'sticky',
  top: '22px',
  alignSelf: 'start',
  background: 'var(--panel)',
  border: '1px solid var(--hairline)',
  borderRadius: '8px',
  padding: '18px 18px 14px',
  fontFamily: 'var(--font-sans-operator)',
  fontFeatureSettings: "'tnum' 1, 'lnum' 1",
  fontVariantNumeric: 'tabular-nums lining-nums',
};

const railHeadStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: '12px',
  marginBottom: '8px',
};

const railEyebrowStyle: CSSProperties = {
  fontFamily: 'var(--font-sans-operator)',
  fontSize: '10.5px',
  fontWeight: 600,
  letterSpacing: '0.12em',
  textTransform: 'uppercase',
  color: 'var(--ink-3)',
};

const railStatusStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '6px',
  fontFamily: 'var(--font-sans-operator)',
  fontSize: '10.5px',
  fontWeight: 500,
  letterSpacing: '0.06em',
  // `color` is set per-tone at render (see WATCH_TONE_INK).
};

const railStatusDotStyle: CSSProperties = {
  width: '6px',
  height: '6px',
  borderRadius: '999px',
  // `background` is set per-tone at render (see WATCH_TONE_DOT).
};

// Watch-header tone → token map. Mirrors `watch-item.tsx`'s dot variants
// exactly (dot = `--{tone}`), with the matching `--{tone}-ink` for the
// quiet text color so the header stays calm and on-palette.
const WATCH_TONE_DOT: Record<WatchTone, string> = {
  green: 'var(--green)',
  amber: 'var(--amber)',
  clay: 'var(--clay)',
};

const WATCH_TONE_INK: Record<WatchTone, string> = {
  green: 'var(--green-ink)',
  amber: 'var(--amber-ink)',
  clay: 'var(--clay-ink)',
};

const railListStyle: CSSProperties = {
  listStyle: 'none',
  margin: 0,
  padding: 0,
};

const railFooterStyle: CSSProperties = {
  marginTop: '10px',
  paddingTop: '10px',
  borderTop: '1px solid var(--hairline-faint)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: '12px',
};

const railRefreshedStyle: CSSProperties = {
  fontFamily: 'var(--font-mono-operator)',
  fontSize: '10.5px',
  color: 'var(--ink-3)',
  letterSpacing: '0.02em',
};

// ─────────────────── render helpers ───────────────────

/**
 * Map a `QueueItem` to the props `<QueueRow>` consumes. The row
 * accepts presentation-level shape (meta tokens as `ReactNode[]`,
 * action variants, etc.) rather than the data shape from the
 * adapter, so we adapt here. Numeric tokens are wrapped in `.num`
 * spans so tabular numerals render per the typography rules.
 */
function buildActions(
  item: QueueItem,
  audience: 'owner' | 'va',
): QueueAction[] {
  if (audience === 'va') return [];
  const out: QueueAction[] = [
    { label: item.primaryAction.label, variant: 'primary' },
  ];
  if (item.secondaryAction) {
    out.push({ label: item.secondaryAction.label, variant: 'secondary' });
  }
  return out;
}

function buildMeta(item: QueueItem): ReactNode[] {
  // Each meta token may contain numbers (unit IDs, days, dollar
  // amounts, durations). Render every token through the `.num` utility
  // so tabular numerals apply uniformly without parsing the string —
  // letters render the same in tabular vs proportional, so the only
  // visible effect is on digits, which is exactly what we want.
  return item.meta.map((token, idx) => (
    <span key={idx} className="num">
      {token}
    </span>
  ));
}

// ─────────────────── component ───────────────────

export function TodayInteractions({
  audience = 'owner',
  queueItems,
  watchSignals,
  watchHeadline,
  refreshedLabel,
  middleSlot,
  children,
}: TodayInteractionsProps) {
  const [selectedItem, setSelectedItem] = useState<QueueItem | null>(null);

  const toggleItem = useCallback((item: QueueItem) => {
    setSelectedItem((current) => (current?.id === item.id ? null : item));
  }, []);

  const onClearContext = useCallback(() => {
    setSelectedItem(null);
  }, []);

  useEffect(() => {
    function handleKeydown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setSelectedItem(null);
      }
    }
    document.addEventListener('keydown', handleKeydown);
    return () => {
      document.removeEventListener('keydown', handleKeydown);
    };
  }, []);

  // Render-prop escape hatch for callers that want full layout control.
  if (children) {
    return (
      <>
        {children({
          selectedItem,
          toggleItem,
          setSelectedItem,
          onClearContext,
        })}
      </>
    );
  }

  return (
    <>
      <div
        data-section="queue-rail-grid"
        className="today-queue-rail-grid"
        style={queueRailGridStyle}
      >
        {/* Operational attention summary; Owner Queue is the commitment ledger. */}
        <section
          id={audience === 'va' ? 'needs-escalation' : undefined}
          data-section="operational-attention"
          data-audience={audience}
          style={{ background: 'transparent' }}
        >
          <div style={sectionHeadStyle}>
            <div style={eyebrowStyle}>
              {audience === 'va' ? 'Needs handling now' : 'Needs attention today'}
            </div>
            <div
              className="num"
              style={countStyle}
              data-testid="today-owner-review-count"
            >
              {queueItems.length}
            </div>
            <div style={sortLineStyle}>
              {audience === 'va' ? (
                <span style={sortAccentStyle}>
                  prepare / follow up · owner approval required
                </span>
              ) : (
                <>
                  Operational signals ·{' '}
                  <Link
                    href="/owner-queue"
                    style={{ ...sortAccentStyle, textDecoration: 'none' }}
                  >
                    commitments live in Owner Queue
                  </Link>
                </>
              )}
            </div>
          </div>

          <div style={queueContainerStyle}>
            {queueItems.length === 0 ? (
              <div data-queue-empty="true" style={queueEmptyStyle}>
                {audience === 'va'
                  ? 'Nothing needs handling right now.'
                  : 'Nothing needs attention today.'}
              </div>
            ) : (
              queueItems.map((item) => (
                <QueueRow
                  key={item.id}
                  rowKey={item.id}
                  status={item.status as QueueChipStatus}
                  title={item.title}
                  meta={buildMeta(item)}
                  recommendation={item.recommendation}
                  time={item.timestamp}
                  actions={buildActions(item, audience)}
                  item={item}
                  isSelected={selectedItem?.id === item.id}
                  onToggle={() => toggleItem(item)}
                />
              ))
            )}
          </div>
        </section>

        {/* Current source-record signals; no implied background automation. */}
        <aside
          data-section="watching"
          className="today-watching-rail"
          style={railContainerStyle}
        >
          <div style={railHeadStyle}>
            <span style={railEyebrowStyle}>CURRENT RECORD SIGNALS</span>
            <span
              style={{
                ...railStatusStyle,
                color: WATCH_TONE_INK[watchHeadline.tone],
              }}
            >
              <span
                aria-hidden="true"
                style={{
                  ...railStatusDotStyle,
                  background: WATCH_TONE_DOT[watchHeadline.tone],
                }}
              />
              {watchHeadline.label}
            </span>
          </div>

          {watchSignals.length === 0 ? (
            <div data-watch-empty="true" style={railEmptyStyle}>
              Nothing on the watchlist right now.
            </div>
          ) : null}

          <ul style={railListStyle}>
            {watchSignals.map((signal) => {
              const isEmphasized = selectedItem?.channel === signal.channel;
              // WatchItem renders its own <li>, so it is the direct child of
              // the <ul> (wrapping it in another <li> nests <li> in <li>).
              return (
                <WatchItem
                  key={signal.channel}
                  channel={signal.channel}
                  title={signal.title}
                  meta={signal.meta}
                  dotVariant={signal.dotVariant}
                  isEmphasized={isEmphasized}
                  linkedLabel={
                    isEmphasized ? selectedItem?.linkedLabel : undefined
                  }
                />
              );
            })}
          </ul>

          <div style={railFooterStyle}>
            <span className="num" style={railRefreshedStyle}>
              {formatAgoPhrase('Refreshed', refreshedLabel)}
            </span>
          </div>
        </aside>
      </div>

      {middleSlot ? <div style={middleSlotStyle}>{middleSlot}</div> : null}

      <div style={askOdesaBlockStyle}>
        <AskOdesaCommand
          audience={audience}
          selectedItem={selectedItem}
          onClearContext={onClearContext}
        />
      </div>
    </>
  );
}
