'use client';

import type { UrgentItem, UrgentItemKind } from '@/lib/today/queries';

interface Props {
  items: UrgentItem[];
}

interface BadgeStyle {
  background: string;
  color: string;
  border: string;
  label: string;
}

function getBadgeStyle(kind: UrgentItemKind): BadgeStyle {
  switch (kind) {
    case 'conversation':
      return {
        background: '#FDEAEB',
        color: '#D93036',
        border: '1px solid #F9D6D7',
        label: 'NEEDS YOU',
      };
    case 'work_order':
      return {
        background: '#F0F4F8',
        color: 'var(--navy-700)',
        border: '1px solid #D0E0EE',
        label: 'AUTOMATED',
      };
    case 'rent':
      return {
        background: 'white',
        color: 'var(--ink-600)',
        border: '1px solid var(--ink-200)',
        label: 'RECEIVED',
      };
  }
}

function formatAgeAnchor(isoTimestamp: string): string {
  const anchor = new Date(isoTimestamp);
  const diffMs = Date.now() - anchor.getTime();
  const diffMin = diffMs / 60_000;
  if (diffMin < 2) return 'Just now';
  return anchor.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

function getDescriptionText(item: UrgentItem): string {
  switch (item.kind) {
    case 'conversation':
      return `${item.tenantName ?? 'Tenant'} — ${item.statusLabel}`;
    case 'work_order':
      return `Work order: ${item.unitLabel ? `Unit ${item.unitLabel}` : item.statusLabel}`;
    case 'rent':
      return `Rent ${item.statusLabel.toLowerCase()} — ${item.unitLabel ? `Unit ${item.unitLabel}` : ''}`;
  }
}

interface DotProps {
  kind: UrgentItemKind;
}

function TimelineDot({ kind }: DotProps) {
  if (kind === 'conversation') {
    return (
      <div
        style={{
          width: '22px',
          height: '22px',
          borderRadius: '50%',
          background: '#FDEAEB',
          border: '2px solid white',
          zIndex: 10,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}
      >
        <div
          style={{
            width: '8px',
            height: '8px',
            borderRadius: '50%',
            background: '#D93036',
          }}
        />
      </div>
    );
  }

  if (kind === 'work_order') {
    return (
      <div
        style={{
          width: '22px',
          height: '22px',
          borderRadius: '50%',
          background: '#F0F4F8',
          border: '2px solid white',
          zIndex: 10,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
          fontSize: '10px',
          color: 'var(--navy-700)',
        }}
      >
        ⚙
      </div>
    );
  }

  // rent
  return (
    <div
      style={{
        width: '22px',
        height: '22px',
        borderRadius: '50%',
        background: 'var(--paper-50)',
        border: '2px solid white',
        zIndex: 10,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
      }}
    >
      <div
        style={{
          width: '6px',
          height: '6px',
          borderRadius: '50%',
          background: 'var(--ink-400)',
        }}
      />
    </div>
  );
}

export function TodayPulse({ items }: Props) {
  const visible = items.slice(0, 5);

  return (
    <section
      data-testid="today-pulse"
      style={{
        background: 'var(--paper-0)',
        border: '1px solid var(--ink-200)',
        borderRadius: 'var(--radius-lg-odesa)',
        padding: '20px',
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          marginBottom: '16px',
        }}
      >
        <svg
          width="18"
          height="18"
          viewBox="0 0 18 18"
          fill="none"
          stroke="var(--ink-400)"
          strokeWidth="1.5"
        >
          <circle cx="9" cy="9" r="7.5" />
          <path d="M9 5.5v4l2.5 2.5" />
        </svg>
        <span
          style={{
            fontWeight: 500,
            fontSize: '14px',
            color: 'var(--ink-900)',
          }}
        >
          Today&apos;s Pulse
        </span>
      </div>

      {visible.length === 0 ? (
        <p
          data-testid="today-pulse-empty"
          style={{
            fontStyle: 'italic',
            color: 'var(--ink-500)',
            fontSize: '14px',
            margin: 0,
          }}
        >
          All quiet right now.
        </p>
      ) : (
        <ul
          data-testid="today-pulse-list"
          style={{ listStyle: 'none', margin: 0, padding: 0 }}
        >
          {visible.map((item) => {
            const badge = getBadgeStyle(item.kind);
            return (
              <li
                key={item.id}
                data-testid={`today-pulse-item-${item.id}`}
                style={{
                  display: 'flex',
                  gap: '12px',
                  marginBottom: '20px',
                }}
              >
                <TimelineDot kind={item.kind} />
                <div style={{ flex: 1 }}>
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'baseline',
                      marginBottom: '4px',
                    }}
                  >
                    <span
                      style={{
                        fontFamily: 'var(--font-mono)',
                        fontSize: '11px',
                        color: 'var(--ink-500)',
                      }}
                    >
                      {formatAgeAnchor(item.ageAnchor)}
                    </span>
                    <span
                      style={{
                        background: badge.background,
                        color: badge.color,
                        border: badge.border,
                        borderRadius: '3px',
                        fontSize: '9px',
                        fontFamily: 'var(--font-mono)',
                        letterSpacing: '0.05em',
                        padding: '2px 5px',
                      }}
                    >
                      {badge.label}
                    </span>
                  </div>
                  <p
                    style={{
                      fontSize: '13px',
                      color: item.kind === 'conversation' ? 'var(--ink-800)' : 'var(--ink-600)',
                      lineHeight: 1.4,
                      margin: 0,
                    }}
                  >
                    {getDescriptionText(item)}
                  </p>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
