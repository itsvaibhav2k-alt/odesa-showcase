import { WatchItem, type WatchDotVariant } from './watch-item';

/**
 * Sticky right-column "Watching quietly" rail.
 *
 * Server component. Renders the five hardcoded watch items from
 * ref-context-map verbatim. The eyebrow strip carries the section label
 * on the left and an "on track" status pulse on the right. The footer
 * carries the refresh timestamp (mono) and a "see history" link.
 *
 * PR-3 will fetch real items and pass an `emphasizedChannel` prop. PR-2
 * is purely static.
 */

interface WatchItemData {
  channel: string;
  title: string;
  meta: string;
  dotVariant: WatchDotVariant;
}

const WATCH_ITEMS: readonly WatchItemData[] = [
  {
    channel: 'lease',
    title: 'Lease deadlines',
    meta: '2 upcoming — next is 14 Maple Ct on Fri, May 29. Draft is queued.',
    dotVariant: 'amber',
  },
  {
    channel: 'maintenance',
    title: 'Maintenance risk',
    meta: 'Unit 3B leak — watching for vendor delay. If no plumber on-site by 5:00 PM, Odesa will escalate.',
    dotVariant: 'clay',
  },
  {
    channel: 'rent',
    title: 'Rent collection',
    meta: '82% collected · pacing on track for May. 4 follow-ups queued for 4:00 PM.',
    dotVariant: 'green',
  },
  {
    channel: 'inbox',
    title: 'Inbox health',
    meta: '0 tenant messages unread over 24h. 9 resolved this week.',
    dotVariant: 'muted',
  },
  {
    channel: 'vendor',
    title: 'Vendor calendar',
    meta: 'No appointments scheduled in the next 48h. Greene HVAC pending response.',
    dotVariant: 'muted',
  },
];

export function WatchingQuietlyRail() {
  return (
    <aside
      data-section="watching"
      style={{
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
      }}
    >
      {/* eyebrow strip */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '12px',
          marginBottom: '8px',
        }}
      >
        <span
          style={{
            fontFamily: 'var(--font-sans-operator)',
            fontSize: '10.5px',
            fontWeight: 600,
            letterSpacing: '0.12em',
            textTransform: 'uppercase',
            color: 'var(--ink-3)',
          }}
        >
          WATCHING QUIETLY
        </span>
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px',
            fontFamily: 'var(--font-sans-operator)',
            fontSize: '10.5px',
            fontWeight: 500,
            letterSpacing: '0.06em',
            color: 'var(--green-ink)',
          }}
        >
          <span
            aria-hidden="true"
            style={{
              width: '6px',
              height: '6px',
              borderRadius: '999px',
              background: 'var(--green)',
            }}
          />
          on track
        </span>
      </div>

      {/* item list */}
      <ul
        style={{
          listStyle: 'none',
          margin: 0,
          padding: 0,
        }}
      >
        {WATCH_ITEMS.map((item, idx) => (
          <li
            key={item.channel}
            style={{
              // strip bottom hairline on the last row so the footer hairline owns the bottom edge
              borderBottom: idx === WATCH_ITEMS.length - 1 ? 'none' : undefined,
            }}
          >
            <WatchItem
              channel={item.channel}
              title={item.title}
              meta={item.meta}
              dotVariant={item.dotVariant}
            />
          </li>
        ))}
      </ul>

      {/* footer */}
      <div
        style={{
          marginTop: '10px',
          paddingTop: '10px',
          borderTop: '1px solid var(--hairline-faint)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '12px',
        }}
      >
        <span
          className="num"
          style={{
            fontFamily: 'var(--font-mono-operator)',
            fontSize: '10.5px',
            color: 'var(--ink-3)',
            letterSpacing: '0.02em',
          }}
        >
          Refreshed 11m ago
        </span>
        <a
          href="/open-items"
          style={{
            fontFamily: 'var(--font-sans-operator)',
            fontSize: '11px',
            color: 'var(--terracotta)',
            textDecoration: 'none',
            borderBottom: '1px solid var(--terracotta-soft)',
            paddingBottom: '1px',
          }}
        >
          see history
        </a>
      </div>
    </aside>
  );
}
