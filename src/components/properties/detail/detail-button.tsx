/**
 * DetailButton — button/link atom for property detail pages.
 *
 * Renders a Next <Link> when `href` is provided, else a <button> element.
 * Matches the mockup's `.btn` and `.btn.primary` and `.btn.sm` patterns.
 *
 * onClick requires client interactivity — if needed, the parent island should
 * be 'use client'. This component itself stays server-renderable when used
 * without onClick (Link or plain <button> with no handler).
 *
 * A11Y: terracotta focus ring via hoisted <style>. No nested interactive
 * elements: callers must never wrap DetailButton in another interactive element.
 */

import type { CSSProperties } from 'react';
import Link from 'next/link';

export interface DetailButtonProps {
  variant?: 'default' | 'primary';
  size?: 'sm' | 'md';
  href?: string;
  /** onClick forces 'use client' in the consuming island. */
  onClick?: () => void;
  children: React.ReactNode;
  /** Forwarded to the underlying element for a11y. */
  'aria-label'?: string;
  type?: 'button' | 'submit' | 'reset';
  /** Forwarded to the underlying element for test/query hooks. */
  'data-testid'?: string;
}

const BASE_STYLE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  fontFamily: 'var(--font-sans-operator)',
  fontWeight: 450,
  letterSpacing: '-0.003em',
  whiteSpace: 'nowrap',
  borderRadius: '5px',
  border: '1px solid var(--hairline-strong)',
  background: 'var(--panel-clean)',
  color: 'var(--ink)',
  cursor: 'pointer',
  textDecoration: 'none',
  lineHeight: 1.3,
};

const SIZE_STYLE: Record<NonNullable<DetailButtonProps['size']>, CSSProperties> = {
  sm: { fontSize: '11px', padding: '5px 10px' },
  md: { fontSize: '11.5px', padding: '6px 12px' },
};

const PRIMARY_OVERRIDE: CSSProperties = {
  background: 'var(--ink)',
  color: 'var(--panel-lift)',
  borderColor: 'var(--ink)',
};

export function DetailButton({
  variant = 'default',
  size = 'md',
  href,
  onClick,
  children,
  'aria-label': ariaLabel,
  type = 'button',
  'data-testid': dataTestid,
}: DetailButtonProps) {
  const style: CSSProperties = {
    ...BASE_STYLE,
    ...SIZE_STYLE[size],
    ...(variant === 'primary' ? PRIMARY_OVERRIDE : {}),
  };

  if (href) {
    return (
      <>
        <Link
          href={href}
          style={style}
          aria-label={ariaLabel}
          data-testid={dataTestid}
          className="detail-btn"
        >
          {children}
        </Link>
        <DetailButtonStyles />
      </>
    );
  }

  return (
    <>
      <button
        type={type}
        style={style}
        onClick={onClick}
        aria-label={ariaLabel}
        data-testid={dataTestid}
        className="detail-btn"
      >
        {children}
      </button>
      <DetailButtonStyles />
    </>
  );
}

function DetailButtonStyles() {
  return (
    <style precedence="detail-btn">{`
      .detail-btn:focus-visible {
        outline: 2px solid var(--terracotta);
        outline-offset: 2px;
      }
      .detail-btn[data-variant='primary']:hover,
      button.detail-btn[style*='var(--ink)']:hover {
        background: #000;
      }
      .detail-btn:not([style*='var(--ink)']):hover {
        border-color: var(--ink-3);
      }
    `}</style>
  );
}
