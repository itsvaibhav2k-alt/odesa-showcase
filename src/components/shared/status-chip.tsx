/**
 * StatusChip — the shared status pill primitive for list-row tables.
 *
 * Four list pages (tenants, vendors, rent, documents) carried byte-identical
 * status pills — mono 9.5px / 0.06em tracking / 3px radius / 5px dot — that
 * differed only in their palette map. This is the single source of truth for
 * that pixel spec. The `tone` prop selects a CSS-variable triple (bg/ink/border
 * plus a dot color) from the `.today-theme` palette in globals.css; the chip is
 * never color-only (the dot is aria-hidden, the label carries the meaning).
 *
 * Server component (no 'use client') — render-only, no interaction.
 *
 * Sizes:
 *   - `list`  (default) — copies the list-row pill spec verbatim: mono 9.5px.
 *   - `queue` — matches QueueChip metrics (inherited sans, 10.5px, tabular-nums)
 *               for owner-review surfaces. QueueChip is NOT migrated onto this.
 */

import type { CSSProperties } from 'react';

export type StatusChipTone =
  | 'green'
  | 'amber'
  | 'amber-soft'
  | 'clay'
  | 'neutral-gold';

export type StatusChipSize = 'list' | 'queue';

interface ChipPalette {
  background: string;
  color: string;
  borderColor: string;
  dot: string;
}

/** Tone → CSS-variable palette, a superset of the four list-row call sites. */
const TONE_PALETTE: Record<StatusChipTone, ChipPalette> = {
  green: {
    background: 'var(--green-bg)',
    color: 'var(--green-ink)',
    borderColor: 'var(--green-border)',
    dot: 'var(--green)',
  },
  amber: {
    background: 'var(--amber-bg)',
    color: 'var(--amber-ink)',
    borderColor: 'var(--amber-border)',
    dot: 'var(--amber)',
  },
  'amber-soft': {
    background: 'var(--amber-bg-soft)',
    color: 'var(--amber-ink)',
    borderColor: 'var(--amber-border)',
    dot: 'var(--amber)',
  },
  clay: {
    background: 'var(--clay-bg)',
    color: 'var(--clay-ink)',
    borderColor: 'var(--clay-border)',
    dot: 'var(--clay)',
  },
  'neutral-gold': {
    background: 'var(--neutral-bg)',
    color: 'var(--neutral-ink)',
    borderColor: 'var(--neutral-border)',
    dot: 'var(--gold)',
  },
};

/** Spec shared by both sizes — only typography differs (see SIZE_STYLE). */
const baseChipStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  fontWeight: 500,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  padding: '3px 8px 3px 7px',
  borderRadius: 3,
  border: '1px solid',
  whiteSpace: 'nowrap',
};

/** Per-size typography. `list` = list-row pill verbatim; `queue` = QueueChip. */
const SIZE_STYLE: Record<StatusChipSize, CSSProperties> = {
  list: {
    fontFamily: 'var(--font-mono-operator), ui-monospace, monospace',
    fontSize: '9.5px',
  },
  queue: {
    fontSize: '10.5px',
    fontFeatureSettings: "'tnum' 1",
  },
};

const dotStyle: CSSProperties = {
  width: 5,
  height: 5,
  borderRadius: '50%',
  flexShrink: 0,
};

export interface StatusChipProps {
  /** Selects the bg/ink/border/dot palette triple. */
  tone: StatusChipTone;
  /** Visible, accessible label text. */
  label: string;
  /** Typography size variant. Defaults to `list`. */
  size?: StatusChipSize;
}

export function StatusChip({ tone, label, size = 'list' }: StatusChipProps) {
  const palette = TONE_PALETTE[tone];

  return (
    <span
      data-status-tone={tone}
      style={{
        ...baseChipStyle,
        ...SIZE_STYLE[size],
        color: palette.color,
        background: palette.background,
        borderColor: palette.borderColor,
      }}
    >
      <span aria-hidden="true" style={{ ...dotStyle, background: palette.dot }} />
      {label}
    </span>
  );
}
