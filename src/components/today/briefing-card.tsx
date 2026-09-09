/**
 * Odesa Briefing — the signature moment on the Today screen.
 *
 * A live daily operator briefing (not a passive weekly report): the
 * desk of someone who already checked the portfolio before the landlord
 * arrived. Purely presentational — the integrator passes current state
 * as props and this card renders the synthesized sentence + bullets.
 *
 * Design per 00-BUILD-HUB + 10-briefing.md §Anatomy:
 * - paper-0 background, 2px gold-500 LEFT border + hairline ink-200 on
 *   the other three sides (the signature accent edge), 24–32px padding.
 * - The single editorial sentence uses `.font-brief` (Instrument Serif).
 * - 2–3 sans bullets, then quiet link buttons.
 */

import { synthesizeBriefing, type BriefingDeadline } from '@/lib/today/briefing-summary';
import { statusColor } from '@/lib/today/status';

/** Default standing line for what Odesa checked this cycle. */
const CHECKS_SUMMARY =
  'Odesa checked rent, work orders, tenant inbox, and lease deadlines.';

export interface BriefingCardProps {
  /** Items currently needing the owner's review (attention queue size). */
  urgentCount: number;
  /** Rent follow-ups Odesa has drafted and is holding for review. */
  draftsCount: number;
  /** The nearest upcoming deadline, if any. */
  nextDeadline?: BriefingDeadline;
  /** When Odesa last checked the portfolio (ISO-8601), for the stamp. */
  checkedAt?: string | null;
  /** Link to the full weekly briefing; rendered only when present. */
  weeklyHref?: string | null;
  /** Injected clock for deterministic tests. Defaults to `new Date()`. */
  now?: Date;
}

export function BriefingCard({
  urgentCount,
  draftsCount,
  nextDeadline,
  checkedAt,
  weeklyHref,
  now,
}: BriefingCardProps): React.JSX.Element {
  const { sentence, bullets, tone } = synthesizeBriefing({
    urgentCount,
    draftsCount,
    nextDeadline,
    checksSummary: CHECKS_SUMMARY,
  });

  const checkedLabel = checkedAt ? checkedAgo(checkedAt, now ?? new Date()) : null;

  return (
    <section
      data-testid="today-briefing-card"
      aria-labelledby="today-briefing-heading"
      className="relative overflow-hidden"
      style={{
        background: 'var(--paper-0)',
        borderTop: '1px solid var(--ink-200)',
        borderRight: '1px solid var(--ink-200)',
        borderBottom: '1px solid var(--ink-200)',
        borderLeft: '2px solid var(--gold-500)',
        borderRadius: 'var(--radius-lg-odesa)',
        padding: '28px 32px',
      }}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <p className="meta-label" style={{ color: 'var(--ink-500)' }}>
          ODESA BRIEFING
        </p>
        {checkedLabel ? (
          <p
            data-testid="today-briefing-checked"
            className="tabular-nums"
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: '11px',
              letterSpacing: '0.04em',
              color: 'var(--ink-500)',
            }}
          >
            {checkedLabel}
          </p>
        ) : null}
      </div>

      <h2
        id="today-briefing-heading"
        data-testid="today-briefing-sentence"
        className="font-brief mt-3"
        style={{
          fontSize: '34px',
          lineHeight: 1.15,
          letterSpacing: '-0.01em',
          fontWeight: 500,
          color: statusColor(tone),
        }}
      >
        {sentence}
      </h2>

      <ul
        data-testid="today-briefing-bullets"
        className="mt-4 flex flex-col gap-2"
        style={{ maxWidth: '60ch', listStyle: 'none', padding: 0, margin: 0 }}
      >
        {bullets.map((bullet) => (
          <li
            key={bullet}
            style={{
              display: 'flex',
              alignItems: 'baseline',
              gap: 8,
              fontSize: '14px',
              lineHeight: 1.5,
              color: 'var(--ink-700)',
            }}
          >
            <span
              aria-hidden="true"
              style={{
                width: 4,
                height: 4,
                marginTop: 7,
                borderRadius: '50%',
                background: 'var(--ink-500)',
                flexShrink: 0,
              }}
            />
            <span>{bullet}</span>
          </li>
        ))}
      </ul>

      <div
        style={{
          marginTop: 20,
          display: 'flex',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 16,
        }}
      >
        <a href="/inbox" style={quietLinkStyle}>
          Review drafts <span aria-hidden="true">→</span>
        </a>
        <a href="#today-recent-checks" style={quietLinkStyle}>
          View checks <span aria-hidden="true">→</span>
        </a>
        {weeklyHref ? (
          <a
            data-testid="today-briefing-weekly-link"
            href={weeklyHref}
            style={{
              ...quietLinkStyle,
              marginLeft: 'auto',
              color: 'var(--ink-500)',
            }}
          >
            Read full weekly briefing <span aria-hidden="true">→</span>
          </a>
        ) : null}
      </div>
    </section>
  );
}

const quietLinkStyle: React.CSSProperties = {
  fontWeight: 500,
  fontSize: '13px',
  color: 'var(--navy-700)',
  textDecoration: 'none',
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  whiteSpace: 'nowrap',
};

/**
 * Compact "checked Nm ago" stamp for the briefing header. Minutes under
 * an hour, then hours, then a short date once it is more than a day old.
 *
 * @param iso - When Odesa last checked, ISO-8601.
 * @param now - Reference clock.
 * @returns A stamp like 'Checked 11m ago'.
 */
function checkedAgo(iso: string, now: Date): string {
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return '';
  const minutes = Math.max(0, Math.round((now.getTime() - then.getTime()) / 60000));
  if (minutes < 60) return `Checked ${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `Checked ${hours}h ago`;
  const days = Math.round(hours / 24);
  return `Checked ${days}d ago`;
}
