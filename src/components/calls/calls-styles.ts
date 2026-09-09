/**
 * Shared warm-paper styles for the split /calls section (overview + the
 * settings / scripts / test page bodies). Extracted from the former
 * CallsCommandCenter so every route renders the same operator-console language
 * without triplicating the section-heading + empty-state consts.
 */

import type { CSSProperties } from 'react';

export const sectionStyle: CSSProperties = {
  marginTop: 28,
};

export const sectionHeadStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'baseline',
  gap: 10,
  flexWrap: 'wrap',
  marginBottom: 14,
};

export const sectionTitleStyle: CSSProperties = {
  fontFamily: 'var(--font-serif-display), Georgia, serif',
  fontStyle: 'italic',
  fontWeight: 400,
  fontSize: '20px',
  letterSpacing: '-0.01em',
  color: 'var(--ink)',
};

export const sectionMetaStyle: CSSProperties = {
  fontFamily: 'var(--font-mono), ui-monospace, monospace',
  fontSize: '10px',
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: 'var(--ink-3)',
};

export const introStyle: CSSProperties = {
  fontSize: '13.5px',
  lineHeight: 1.6,
  color: 'var(--ink-2)',
  maxWidth: 720,
  margin: '0 0 18px',
};

export const emptyStyle: CSSProperties = {
  background: 'var(--panel-lift)',
  border: '1px solid var(--hairline)',
  borderRadius: 12,
  padding: '28px 24px',
  fontSize: '13px',
  lineHeight: 1.6,
  color: 'var(--ink-2)',
  maxWidth: 720,
};

export const emptyCodeHintStyle: CSSProperties = {
  fontFamily: 'var(--font-mono), ui-monospace, monospace',
  fontSize: '11px',
  letterSpacing: '0.03em',
  color: 'var(--ink-3)',
  marginTop: 10,
};
