/**
 * DetailPill — inline mono status pill atom for property detail pages.
 *
 * Matches the mockup's `.pill.<variant>` pattern: tiny dot (aria-hidden) + text.
 * Used in unit rows, appliance rows, and anywhere an inline status pill appears.
 * Never color-only: label always carries meaning.
 */

import type { CSSProperties } from 'react';
import type { PillVariant } from '@/lib/properties/mock-detail';

export interface DetailPillProps {
  variant: PillVariant;
  label: string;
}

interface PillTheme {
  color: string;
  background: string;
  borderColor: string;
  dot: string;
}

const PILL_THEME: Record<PillVariant, PillTheme> = {
  plan: {
    color: 'var(--amber-ink)',
    background: 'var(--amber-bg)',
    borderColor: 'var(--amber-border)',
    dot: 'var(--amber)',
  },
  watching: {
    color: 'var(--amber-ink)',
    background: 'var(--amber-bg-soft)',
    borderColor: 'var(--amber-border)',
    dot: 'var(--amber)',
  },
  current: {
    color: 'var(--green-ink)',
    background: 'var(--green-bg)',
    borderColor: 'var(--green-border)',
    dot: 'var(--green)',
  },
  good: {
    color: 'var(--green-ink)',
    background: 'var(--green-bg)',
    borderColor: 'var(--green-border)',
    dot: 'var(--green)',
  },
  aging: {
    color: 'var(--amber-ink)',
    background: 'var(--amber-bg-soft)',
    borderColor: 'var(--amber-border)',
    dot: 'var(--amber)',
  },
  replace: {
    color: 'var(--clay-ink)',
    background: 'var(--clay-bg)',
    borderColor: 'var(--clay-border)',
    dot: 'var(--clay)',
  },
};

const wrapStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '6px',
  fontFamily: 'var(--font-mono-operator)',
  fontSize: '9.5px',
  fontWeight: 500,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  padding: '3px 8px 3px 7px',
  borderRadius: '3px',
  border: '1px solid',
  whiteSpace: 'nowrap',
};

const dotStyle: CSSProperties = {
  width: '5px',
  height: '5px',
  borderRadius: '50%',
  flexShrink: 0,
};

export function DetailPill({ variant, label }: DetailPillProps) {
  const theme = PILL_THEME[variant];
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
