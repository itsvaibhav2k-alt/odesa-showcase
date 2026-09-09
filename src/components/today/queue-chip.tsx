import type { CSSProperties } from 'react';

/**
 * Owner-review queue status chip.
 *
 * Server component (no client interaction). One of five muted status families
 * per the Today v2 mockup. Each maps to a hand-tuned bg/ink/border/pulse color
 * triple — do not collapse these into a single shadcn variant. See
 * `ref-load-bearing-details.md` for the chip family table.
 *
 * Visual contract:
 * - 3px border radius (not pill, not square)
 * - Uppercase tracked label at 10.5px, letter-spacing 0.06em
 * - 5px pulse dot rendered to the left of the label
 * - No `@/components/ui/badge` import — this is a from-scratch component
 */

export type QueueChipStatus =
  | 'review'
  | 'draft'
  | 'waiting'
  | 'escalated'
  | 'resolved';

interface ChipPalette {
  background: string;
  color: string;
  borderColor: string;
  pulse: string;
}

const STATUS_PALETTE: Record<QueueChipStatus, ChipPalette> = {
  review: {
    background: 'var(--amber-bg)',
    color: 'var(--amber-ink)',
    borderColor: 'var(--amber-border)',
    pulse: 'var(--amber)',
  },
  draft: {
    background: 'var(--neutral-bg)',
    color: 'var(--neutral-ink)',
    borderColor: 'var(--neutral-border)',
    pulse: 'var(--ink-2)',
  },
  waiting: {
    background: 'var(--canvas)',
    color: 'var(--ink-3)',
    borderColor: 'var(--hairline-strong)',
    pulse: 'var(--ink-4)',
  },
  escalated: {
    background: 'var(--clay-bg)',
    color: 'var(--clay-ink)',
    borderColor: 'var(--clay-border)',
    pulse: 'var(--clay)',
  },
  resolved: {
    background: 'var(--green-bg)',
    color: 'var(--green-ink)',
    borderColor: 'var(--green-border)',
    pulse: 'var(--green)',
  },
};

const STATUS_LABEL: Record<QueueChipStatus, string> = {
  review: 'Needs review',
  draft: 'Draft ready',
  waiting: 'Waiting',
  escalated: 'Escalated',
  resolved: 'Resolved',
};

interface QueueChipProps {
  status: QueueChipStatus;
  /**
   * Optional label override. Defaults to the canonical label for `status`
   * matching the mockup ("Needs review", "Draft ready", etc.).
   */
  label?: string;
}

export function QueueChip({ status, label }: QueueChipProps) {
  const palette = STATUS_PALETTE[status];
  const text = label ?? STATUS_LABEL[status];

  const chipStyle: CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    fontSize: '10.5px',
    fontWeight: 500,
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
    padding: '3px 8px 3px 7px',
    borderRadius: 3,
    border: '1px solid',
    borderColor: palette.borderColor,
    background: palette.background,
    color: palette.color,
    whiteSpace: 'nowrap',
    fontFeatureSettings: "'tnum' 1",
  };

  const pulseStyle: CSSProperties = {
    width: 5,
    height: 5,
    borderRadius: '50%',
    background: palette.pulse,
    flexShrink: 0,
  };

  return (
    <span data-queue-status={status} style={chipStyle}>
      <span aria-hidden="true" style={pulseStyle} />
      {text}
    </span>
  );
}
