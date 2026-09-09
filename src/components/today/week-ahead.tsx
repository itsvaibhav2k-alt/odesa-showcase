import Link from 'next/link';
import type { UpcomingMoveIn } from '@/lib/today/queries';
import { format } from './_date-utils';

/**
 * One expiring lease, as surfaced in the right rail. Mirrors the
 * lease row the integrator passes down from `briefing.metrics`; kept
 * local because no query type owns this shape yet.
 */
export interface ExpiringLease {
  leaseId: string;
  tenantName: string | null;
  unitLabel: string | null;
  /** Lease `end_date` as an ISO date string ('YYYY-MM-DD'). */
  endDate: string;
  /** Monthly rent in dollars. */
  rentAmount: number;
  /**
   * Odesa's state for this deadline, shown as the trailing chip
   * (e.g. "draft ready", "needs review"). Optional — falls back to
   * "needs review" when the integrator hasn't resolved one.
   */
  odesaState?: string | null;
}

export interface WeekAheadProps {
  /** Leases ending soon — the only "deadline" we ever surface. */
  expiringLeases: ExpiringLease[];
  /** Confirmed upcoming move-ins from `getUpcomingMoveIns()`. */
  moveIns: UpcomingMoveIn[];
}

/** A single dated thing happening this week, normalized for sorting. */
interface WeekRow {
  key: string;
  /** ISO date string used for ordering. */
  date: string;
  event: string;
  /** Property / unit, rendered in mono. */
  location: string;
  /** Odesa state chip text. */
  state: string;
  /** True only for deadlines (leases), which can take the gold accent. */
  isDeadline: boolean;
  href: string;
}

/**
 * Parses an ISO date ('YYYY-MM-DD') as a local-noon Date so day-level
 * formatting never slips across a timezone boundary.
 */
function parseIsoDate(iso: string): Date {
  return new Date(`${iso}T12:00:00`);
}

/** "Wed" — short weekday for the row's mono date column. */
function weekday(iso: string): string {
  return format(parseIsoDate(iso), { weekday: 'short' });
}

function toRows(expiringLeases: ExpiringLease[], moveIns: UpcomingMoveIn[]): WeekRow[] {
  const leaseRows: WeekRow[] = expiringLeases.map((lease) => ({
    key: `lease-${lease.leaseId}`,
    date: lease.endDate,
    event: 'Lease renewal',
    location: lease.unitLabel ? `Unit ${lease.unitLabel}` : (lease.tenantName ?? 'Lease'),
    state: lease.odesaState?.trim() || 'needs review',
    isDeadline: true,
    href: `/leases/${lease.leaseId}`,
  }));

  const moveInRows: WeekRow[] = moveIns.map((moveIn, index) => ({
    key: `movein-${moveIn.date}-${index}`,
    date: moveIn.date,
    event: 'Move-in',
    location: moveIn.unitLabel ? `Unit ${moveIn.unitLabel}` : (moveIn.tenantName ?? 'New tenant'),
    state: 'ready',
    isDeadline: false,
    href: '/leases',
  }));

  return [...leaseRows, ...moveInRows].sort((a, b) => a.date.localeCompare(b.date));
}

export function WeekAhead({ expiringLeases, moveIns }: WeekAheadProps) {
  const rows = toRows(expiringLeases, moveIns);
  // Gold highlight lands on the single nearest deadline (earliest lease).
  const nearestDeadlineKey = rows.find((row) => row.isDeadline)?.key ?? null;

  return (
    <section
      data-testid="today-week-ahead"
      style={{
        background: 'var(--paper-0)',
        border: '1px solid var(--ink-200)',
        borderRadius: 'var(--radius-lg-odesa)',
        padding: '20px',
      }}
    >
      <h3
        style={{
          fontWeight: 500,
          fontSize: '14px',
          color: 'var(--ink-900)',
          marginBottom: '16px',
          marginTop: 0,
        }}
      >
        This week ahead
      </h3>

      {rows.length === 0 ? (
        <p
          data-testid="today-week-ahead-empty"
          style={{
            fontStyle: 'italic',
            color: 'var(--ink-500)',
            fontSize: '13px',
            margin: 0,
          }}
        >
          No deadlines this week. Odesa will flag any.
        </p>
      ) : (
        <div
          data-testid="today-week-ahead-list"
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
          }}
        >
          {rows.map((row) => {
            const highlight = row.key === nearestDeadlineKey;
            return (
              <Link
                key={row.key}
                href={row.href}
                data-testid={`today-week-ahead-row-${row.key}`}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '10px',
                  border: `1px solid ${highlight ? '#F2EFE8' : 'var(--ink-200)'}`,
                  background: highlight ? '#FDFBF7' : 'var(--paper-0)',
                  borderRadius: 'var(--radius-sm-odesa)',
                  padding: '8px 10px',
                  textDecoration: 'none',
                }}
              >
                {/* Day — mono */}
                <span
                  style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: '11px',
                    color: highlight ? 'var(--gold-500)' : 'var(--ink-600)',
                    flexShrink: 0,
                    minWidth: '30px',
                  }}
                >
                  {weekday(row.date)}
                </span>
                {/* Event + location */}
                <span
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '2px',
                    flex: 1,
                    minWidth: 0,
                  }}
                >
                  <span
                    style={{
                      fontWeight: 500,
                      fontSize: '12px',
                      color: 'var(--ink-900)',
                    }}
                  >
                    {row.event}
                  </span>
                  <span
                    style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: '11px',
                      color: 'var(--ink-500)',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {row.location}
                  </span>
                </span>
                {/* Odesa state chip */}
                <span
                  style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: '10px',
                    letterSpacing: '0.03em',
                    color: highlight ? 'var(--gold-500)' : 'var(--ink-600)',
                    border: `1px solid ${highlight ? '#F2EFE8' : 'var(--ink-200)'}`,
                    borderRadius: '3px',
                    padding: '2px 6px',
                    flexShrink: 0,
                  }}
                >
                  {row.state}
                </span>
              </Link>
            );
          })}
        </div>
      )}
    </section>
  );
}
