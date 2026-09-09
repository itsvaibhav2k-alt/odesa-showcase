'use client';

/**
 * FilterBar — segmented filter button row for list views.
 *
 * Mirrors the mockup's `.filters` row: a mono "Filter" label followed by
 * pill-shaped <button>s. Controlled — parent owns `value`/`onChange`. Active
 * filter gets inked background + light border; all buttons have visible
 * terracotta focus rings.
 *
 * 'use client' — interactivity required (onClick).
 */

import type { CSSProperties } from 'react';

export interface FilterOption {
  /** Machine key, matched against `value`. */
  id: string;
  /** Display label, e.g. "All 17" or "Needs attention 2". */
  label: string;
}

export interface FilterBarProps {
  /** Optional label text overriding the default "Filter". */
  label?: string;
  filters: FilterOption[];
  value: string;
  onChange: (id: string) => void;
}

const wrapStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 7,
  flexWrap: 'wrap',
  marginBottom: 16,
};

const labelStyle: CSSProperties = {
  fontFamily: 'var(--font-mono-operator), ui-monospace, monospace',
  fontSize: '9.5px',
  fontWeight: 500,
  letterSpacing: '0.12em',
  textTransform: 'uppercase',
  color: 'var(--ink-3)',
  marginRight: 3,
};

const btnBaseStyle: CSSProperties = {
  fontFamily: 'var(--font-sans-operator), system-ui, sans-serif',
  fontSize: '12px',
  padding: '5px 12px',
  borderRadius: 20,
  borderWidth: 1,
  borderStyle: 'solid',
  borderColor: 'var(--hairline)',
  cursor: 'pointer',
  letterSpacing: '-0.003em',
  lineHeight: 1.4,
  whiteSpace: 'nowrap',
};

const btnActiveStyle: CSSProperties = {
  ...btnBaseStyle,
  background: 'var(--ink)',
  color: 'var(--panel-lift)',
  borderColor: 'var(--ink)',
};

const btnInactiveStyle: CSSProperties = {
  ...btnBaseStyle,
  background: 'transparent',
  color: 'var(--ink-2)',
};

export function FilterBar({ label = 'Filter', filters, value, onChange }: FilterBarProps) {
  return (
    <>
      <div style={wrapStyle} data-testid="filter-bar" role="group" aria-label={label}>
        <span style={labelStyle} aria-hidden="true">
          {label}
        </span>
        {filters.map((f) => {
          const isActive = f.id === value;
          return (
            <button
              key={f.id}
              type="button"
              data-testid={`filter-btn-${f.id}`}
              aria-pressed={isActive}
              onClick={() => onChange(f.id)}
              className="filter-bar-btn"
              style={isActive ? btnActiveStyle : btnInactiveStyle}
            >
              {f.label}
            </button>
          );
        })}
      </div>
      <FilterBarStyles />
    </>
  );
}

function FilterBarStyles() {
  return (
    <style precedence="filter-bar">{`
      .filter-bar-btn:hover {
        border-color: var(--hairline-strong);
        color: var(--ink);
      }
      .filter-bar-btn[aria-pressed="true"]:hover {
        background: var(--ink);
        border-color: var(--ink);
        color: var(--panel-lift);
      }
      .filter-bar-btn:focus-visible {
        outline: 2px solid var(--terracotta);
        outline-offset: 2px;
      }
    `}</style>
  );
}
