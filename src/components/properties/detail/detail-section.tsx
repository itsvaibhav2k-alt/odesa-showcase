/**
 * DetailSection — section wrapper atom for property detail pages.
 *
 * Reproduces the mockup's `.section` + `.section-head` pattern:
 * mono uppercase label + optional sub text + flex rule line filling
 * remaining space + optional right action slot.
 * Children render below the head.
 */

import type { CSSProperties, ReactNode } from 'react';

export interface DetailSectionProps {
  /** Mono uppercase section label, e.g. "Units". */
  label?: string;
  /** Optional muted sub-text after the label, e.g. "5 units · 1 on a plan". */
  sub?: string;
  /** Optional right-aligned action slot (e.g. a link or button). */
  action?: ReactNode;
  children: ReactNode;
}

const sectionStyle: CSSProperties = {
  marginBottom: '26px',
};

const headStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'baseline',
  gap: '11px',
  rowGap: '6px',
  flexWrap: 'wrap',
  marginBottom: '13px',
};

const labelStyle: CSSProperties = {
  fontFamily: 'var(--font-mono-operator)',
  fontSize: '11px',
  fontWeight: 500,
  letterSpacing: '0.14em',
  textTransform: 'uppercase',
  color: 'var(--ink)',
  flexShrink: 0,
};

const subStyle: CSSProperties = {
  fontSize: '12px',
  color: 'var(--ink-3)',
  minWidth: 0,
  overflowWrap: 'anywhere',
};

const ruleStyle: CSSProperties = {
  flex: 1,
  height: '1px',
  background: 'var(--hairline-faint)',
  alignSelf: 'center',
};

const actionStyle: CSSProperties = {
  fontSize: '11.5px',
  color: 'var(--ink-3)',
  flexShrink: 0,
};

export function DetailSection({ label, sub, action, children }: DetailSectionProps) {
  const hasHead = label != null || sub != null || action != null;

  return (
    <section style={sectionStyle}>
      {hasHead && (
        <div style={headStyle}>
          {label && <span style={labelStyle}>{label}</span>}
          {sub && <span style={subStyle}>{sub}</span>}
          <span aria-hidden="true" style={ruleStyle} />
          {action && <span style={actionStyle}>{action}</span>}
        </div>
      )}
      {children}
    </section>
  );
}
