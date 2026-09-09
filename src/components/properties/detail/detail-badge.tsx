/**
 * DetailBadge — status badge atom for property detail pages.
 *
 * Renders a colored dot (aria-hidden) + text label. Never color-only: the
 * label always carries the full status meaning. Matches the mockup's
 * `.badge.<variant>` pattern exactly.
 */

import type { CSSProperties } from 'react';
import type { BadgeVariant } from '@/lib/properties/mock-detail';

export interface DetailBadgeProps {
  variant: BadgeVariant;
  label: string;
}

interface BadgeTheme {
  color: string;
  background: string;
  borderColor: string;
  dot: string;
}

const BADGE_THEME: Record<BadgeVariant, BadgeTheme> = {
  needsaction: {
    color: '#FBF5E8',
    background: 'var(--clay)',
    borderColor: 'transparent',
    dot: '#FBF5E8',
  },
  atrisk: {
    color: 'var(--clay-ink)',
    background: 'var(--clay-bg)',
    borderColor: 'var(--clay-border)',
    dot: 'var(--clay)',
  },
  watching: {
    color: 'var(--amber-ink)',
    background: 'var(--amber-bg)',
    borderColor: 'var(--amber-border)',
    dot: 'var(--amber)',
  },
  leasing: {
    color: 'var(--neutral-ink)',
    background: 'var(--neutral-bg)',
    borderColor: 'var(--neutral-border)',
    dot: 'var(--gold)',
  },
  plan: {
    color: 'var(--amber-ink)',
    background: 'var(--amber-bg)',
    borderColor: 'var(--amber-border)',
    dot: 'var(--amber)',
  },
  calm: {
    color: 'var(--green-ink)',
    background: 'var(--green-bg)',
    borderColor: 'var(--green-border)',
    dot: 'var(--green)',
  },
  current: {
    color: 'var(--green-ink)',
    background: 'var(--green-bg)',
    borderColor: 'var(--green-border)',
    dot: 'var(--green)',
  },
  clear: {
    color: 'var(--green-ink)',
    background: 'var(--green-bg)',
    borderColor: 'var(--green-border)',
    dot: 'var(--green)',
  },
  open: {
    color: 'var(--clay-ink)',
    background: 'var(--clay-bg)',
    borderColor: 'var(--clay-border)',
    dot: 'var(--clay)',
  },
  dispatched: {
    color: 'var(--amber-ink)',
    background: 'var(--amber-bg)',
    borderColor: 'var(--amber-border)',
    dot: 'var(--amber)',
  },
  scheduled: {
    color: 'var(--neutral-ink)',
    background: 'var(--neutral-bg)',
    borderColor: 'var(--neutral-border)',
    dot: 'var(--gold)',
  },
  resolved: {
    color: 'var(--green-ink)',
    background: 'var(--green-bg)',
    borderColor: 'var(--green-border)',
    dot: 'var(--green)',
  },
};

const wrapStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '6px',
  fontFamily: 'var(--font-mono-operator)',
  fontSize: '10px',
  fontWeight: 500,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  padding: '4px 10px 4px 8px',
  borderRadius: '4px',
  border: '1px solid transparent',
  whiteSpace: 'nowrap',
};

const dotStyle: CSSProperties = {
  width: '6px',
  height: '6px',
  borderRadius: '50%',
  flexShrink: 0,
};

export function DetailBadge({ variant, label }: DetailBadgeProps) {
  const theme = BADGE_THEME[variant];
  return (
    <span
      style={{
        ...wrapStyle,
        color: theme.color,
        background: theme.background,
        borderColor: theme.borderColor,
      }}
    >
      <span aria-hidden="true" style={{ ...dotStyle, background: theme.dot }} />
      {label}
    </span>
  );
}
