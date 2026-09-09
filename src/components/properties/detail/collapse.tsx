'use client';

/**
 * Collapse — accessible disclosure widget for the unit detail page.
 *
 * Full-width <button aria-expanded aria-controls> toggles a hidden body.
 * Chevron rotates 180° when expanded. Mirrors the mockup's .collapse /
 * .collapse-btn / .collapse-body pattern exactly.
 *
 * Uses React-19 hoisted <style> for focus ring and chevron transition.
 */

import { useState, useId, type CSSProperties, type ReactNode } from 'react';

export interface CollapseProps {
  /** Primary label rendered in mono uppercase. */
  label: string;
  /** Secondary sub text rendered at smaller size. */
  sub?: string;
  children: ReactNode;
  /** Start open. Defaults to false. */
  defaultOpen?: boolean;
}

const wrapStyle: CSSProperties = {
  border: '1px solid var(--hairline)',
  borderRadius: 12,
  background: 'var(--panel-lift)',
  overflow: 'hidden',
};

const btnStyle: CSSProperties = {
  width: '100%',
  display: 'flex',
  alignItems: 'center',
  gap: 11,
  padding: '14px 18px',
  background: 'transparent',
  textAlign: 'left',
  cursor: 'pointer',
  border: 'none',
  fontFamily: 'inherit',
  color: 'inherit',
};

const labelStyle: CSSProperties = {
  fontFamily: 'var(--font-mono-operator)',
  fontSize: '11px',
  fontWeight: 500,
  letterSpacing: '0.13em',
  textTransform: 'uppercase',
  color: 'var(--ink)',
};

const subStyle: CSSProperties = {
  fontSize: '12px',
  color: 'var(--ink-3)',
};

const bodyStyle: CSSProperties = {
  padding: '0 18px 18px',
};

export function Collapse({ label, sub, children, defaultOpen = false }: CollapseProps) {
  const [open, setOpen] = useState(defaultOpen);
  const bodyId = useId();

  return (
    <>
      <div style={wrapStyle} data-collapse>
        <button
          type="button"
          style={btnStyle}
          aria-expanded={open}
          aria-controls={bodyId}
          onClick={() => setOpen((prev) => !prev)}
          className="collapse-trigger"
        >
          <span style={labelStyle}>{label}</span>
          {sub && <span style={subStyle}>{sub}</span>}
          <span
            aria-hidden="true"
            className="collapse-chevron"
            style={{
              marginLeft: 'auto',
              color: 'var(--ink-3)',
              fontSize: '12px',
              transition: 'transform 140ms ease',
              transform: open ? 'rotate(180deg)' : 'rotate(0deg)',
              display: 'inline-block',
            }}
          >
            ▾
          </span>
        </button>

        {open && (
          <div id={bodyId} style={bodyStyle}>
            {children}
          </div>
        )}
      </div>
      <CollapseStyles />
    </>
  );
}

function CollapseStyles() {
  return (
    <style precedence="collapse">{`
      .collapse-trigger:focus-visible {
        outline: 2px solid var(--terracotta);
        outline-offset: -2px;
      }
      .collapse-trigger:hover [data-collapse-label] {
        color: var(--ink);
      }
    `}</style>
  );
}
