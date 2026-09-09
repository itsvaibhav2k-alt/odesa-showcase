import { formatAgoPhrase } from '@/lib/today/format';

/**
 * Today v2 topbar.
 *
 * Server component. Renders the page title ("Today" in italic Instrument Serif),
 * the metadata strip ("Tuesday, May 26 · 6 properties watched · 14 tenants" —
 * counts carry the `.num` class for tabular figures), and the right meta
 * ("● Data current · checked Nm ago").
 *
 * All props are driven by `page.tsx`'s server-side data fetch so the
 * timestamp + counts reflect the live portfolio on every render.
 */

export interface TodayTopbarProps {
  /** Role-aware page title; owner callers omit it and keep "Today". */
  title?: string;
  /** Human-readable date label, e.g. "Tuesday, May 26". */
  dateLabel: string;
  /** Active properties currently watched. */
  propertiesCount: number;
  /** Tenants under management. */
  tenantsCount: number;
  /**
   * Short "checked Nm ago" stamp from the latest briefing or page
   * render time. Already includes the unit ("11m", "3h", "2d") —
   * the component renders "checked {checkedAgoLabel} ago" around it.
   */
  checkedAgoLabel: string;
}

export function TodayTopbar({
  title = 'Today',
  dateLabel,
  propertiesCount,
  tenantsCount,
  checkedAgoLabel,
}: TodayTopbarProps) {
  return (
    <div
      data-section="topbar"
      style={{
        display: 'flex',
        alignItems: 'baseline',
        gap: '18px',
        paddingBottom: '18px',
        borderBottom: '1px solid var(--hairline-faint)',
        marginBottom: '22px',
      }}
    >
      <h1
        style={{
          margin: 0,
          fontFamily: 'var(--font-serif-display)',
          fontSize: '28px',
          fontStyle: 'italic',
          fontWeight: 'normal',
          color: 'var(--ink)',
          letterSpacing: '-0.015em',
          lineHeight: 1,
        }}
      >
        {title}
      </h1>

      <div
        style={{
          fontSize: '12px',
          color: 'var(--ink-3)',
          letterSpacing: '0.005em',
        }}
      >
        {/*
         * `dateLabel` is a locale/timezone-dependent string computed from
         * `new Date()` on the server. The browser's locale/timezone can
         * format the same instant differently, so React's hydration text
         * compare can flag a mismatch on just this node. Suppress here —
         * scoped to the single dynamic text node, never the whole tree.
         */}
        <span suppressHydrationWarning>{dateLabel}</span>
        <Separator />
        <span className="num">{propertiesCount}</span>{' '}
        {propertiesCount === 1 ? 'property' : 'properties'} watched
        <Separator />
        <span className="num">{tenantsCount}</span>{' '}
        {tenantsCount === 1 ? 'tenant' : 'tenants'}
      </div>

      <div
        data-freshness
        style={{
          marginLeft: 'auto',
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
          fontSize: '11.5px',
          color: 'var(--ink-3)',
        }}
      >
        <span
          aria-hidden="true"
          style={{
            display: 'inline-block',
            width: '6px',
            height: '6px',
            borderRadius: '50%',
            background: 'var(--green)',
            boxShadow: '0 0 0 3px rgba(77, 122, 86, 0.18)',
          }}
        />
        Data current
        <Separator inline />
        <span suppressHydrationWarning>
          {formatAgoPhrase('checked', checkedAgoLabel)}
        </span>
      </div>
    </div>
  );
}

function Separator({ inline = false }: { inline?: boolean }) {
  return (
    <span
      aria-hidden="true"
      style={{
        display: 'inline-block',
        width: '3px',
        height: '3px',
        borderRadius: '50%',
        background: 'var(--ink-4)',
        margin: inline ? '0 6px' : '0 7px',
        transform: 'translateY(-2px)',
      }}
    />
  );
}
