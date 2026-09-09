/**
 * ConfidenceBadge — small chip displayed alongside agent-collected vs
 * owner-confirmed rows on the property data tables (appliances,
 * vendors, tenant prefs).
 *
 * Why it lives in `shared/`: this is consumed across multiple property
 * sub-routes (`appliances/`, `vendors/`, `units/[unitId]`) AND will be
 * reused by the rent-payments table when Stream S lands. It is NOT a
 * generic UI primitive (no shadcn parallel) — it carries the
 * domain-specific source/confidence semantics, so `shared/` is the
 * right home next to PageHeader / EmptyState rather than `ui/`.
 *
 * Source semantics:
 *   - `agent`  → 🤖 from chat (the dispatcher captured it from a
 *                 conversation; treat as low-confidence)
 *   - `owner`  → ✓ confirmed (the owner explicitly entered or
 *                 confirmed the row)
 *   - `import` → 📥 imported (came from a CSV importer run)
 *
 * The badge is render-only — confirmation is wired through the parent
 * row's server action (see `appliances/page.tsx` for the
 * confirmAppliance flow). The badge is a `<button>` so it can be made
 * interactive by a parent <form action={...}> wrapper.
 */

import * as React from 'react';

export type ConfidenceSource = 'agent' | 'owner' | 'import';

export interface ConfidenceBadgeProps {
  source: ConfidenceSource;
  confidence: number;
  /** Render as button when wrapped in a <form action={...}>. */
  asButton?: boolean;
  /** Optional className passthrough for layout overrides. */
  className?: string;
}

interface BadgeStyle {
  icon: string;
  label: string;
  background: string;
  border: string;
  ink: string;
}

const STYLES: Record<ConfidenceSource, BadgeStyle> = {
  agent: {
    icon: '🤖',
    label: 'from chat',
    background: 'var(--paper-1)',
    border: 'var(--ink-200)',
    ink: 'var(--ink-600)',
  },
  owner: {
    icon: '✓',
    label: 'confirmed',
    background: 'var(--paper-1)',
    border: 'var(--moss-300, var(--ink-200))',
    ink: 'var(--moss-700, var(--ink-900))',
  },
  import: {
    icon: '📥',
    label: 'imported',
    background: 'var(--paper-1)',
    border: 'var(--ink-200)',
    ink: 'var(--ink-600)',
  },
};

export function ConfidenceBadge({
  source,
  confidence,
  asButton = false,
  className,
}: ConfidenceBadgeProps): React.ReactElement {
  const style = STYLES[source];
  const pct = Math.round(Math.max(0, Math.min(1, confidence)) * 100);
  const title = `${style.label} (confidence ${pct}%)`;

  const inner = (
    <>
      <span aria-hidden style={{ fontSize: '11px' }}>
        {style.icon}
      </span>
      <span>{style.label}</span>
    </>
  );

  const baseStyle: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '6px',
    padding: '2px 8px',
    borderRadius: '999px',
    border: `1px solid ${style.border}`,
    background: style.background,
    color: style.ink,
    fontSize: '11px',
    lineHeight: 1.2,
    letterSpacing: '0.01em',
    textTransform: 'uppercase',
    fontVariant: 'small-caps',
  };

  if (asButton) {
    return (
      <button
        type="submit"
        title={`${title} — click to confirm`}
        data-testid="confidence-badge"
        data-source={source}
        className={className}
        style={{ ...baseStyle, cursor: 'pointer' }}
      >
        {inner}
      </button>
    );
  }

  return (
    <span
      title={title}
      data-testid="confidence-badge"
      data-source={source}
      className={className}
      style={baseStyle}
    >
      {inner}
    </span>
  );
}
