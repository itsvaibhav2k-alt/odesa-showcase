/**
 * CtxCard — context / entity card.
 *
 * Mirrors the mockup `.ctx-card` structure: round avatar + name/sub body +
 * action buttons/links. Used for tenant cards on unit pages, vendor cards on
 * work-order pages, and related-entity cards on tenant pages.
 *
 * A11Y: no nested interactive elements — avatar is aria-hidden. Actions are
 * sibling DetailButtons; the card itself is not a link.
 */

import type { CSSProperties } from 'react';
import type { ActionLink, CtxCardSpec } from '@/lib/properties/mock-detail';
import { DetailButton } from './detail-button';

/** An action that may carry an optional per-button test/query hook. */
export type CtxCardAction = ActionLink & { 'data-testid'?: string };

export interface CtxCardProps extends Omit<CtxCardSpec, 'actions'> {
  actions: CtxCardAction[];
}

const cardStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 16,
};

const avatarStyle: CSSProperties = {
  width: 42,
  height: 42,
  borderRadius: '50%',
  background: '#DDD3BC',
  color: '#4A402D',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: '16px',
  fontWeight: 500,
  flexShrink: 0,
  fontFamily: 'var(--font-sans-operator), system-ui, sans-serif',
};

const bodyStyle: CSSProperties = {
  flex: 1,
  minWidth: 0,
};

const nameStyle: CSSProperties = {
  fontSize: '15px',
  fontWeight: 450,
  color: 'var(--ink)',
  letterSpacing: '-0.01em',
};

const pillRowStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 8,
};

const subStyle: CSSProperties = {
  fontSize: '12px',
  color: 'var(--ink-3)',
  marginTop: 2,
};

const actionsStyle: CSSProperties = {
  display: 'flex',
  gap: 8,
  flexShrink: 0,
};

const PILL_THEMES = {
  plan: {
    bg: 'var(--amber-bg)',
    color: 'var(--amber-ink)',
    border: 'var(--amber-border)',
    dot: 'var(--amber)',
  },
  watching: {
    bg: 'var(--amber-bg-soft)',
    color: 'var(--amber-ink)',
    border: 'var(--amber-border)',
    dot: 'var(--amber)',
  },
  current: {
    bg: 'var(--green-bg)',
    color: 'var(--green-ink)',
    border: 'var(--green-border)',
    dot: 'var(--green)',
  },
  good: {
    bg: 'var(--green-bg)',
    color: 'var(--green-ink)',
    border: 'var(--green-border)',
    dot: 'var(--green)',
  },
  aging: {
    bg: 'var(--amber-bg-soft)',
    color: 'var(--amber-ink)',
    border: 'var(--amber-border)',
    dot: 'var(--amber)',
  },
  replace: {
    bg: 'var(--clay-bg)',
    color: 'var(--clay-ink)',
    border: 'var(--clay-border)',
    dot: 'var(--clay)',
  },
};

export function CtxCard({ avatar, name, pill, sub, actions }: CtxCardProps) {
  const pillTheme = pill ? PILL_THEMES[pill.variant] : null;

  return (
    <div style={cardStyle}>
      <div aria-hidden="true" style={avatarStyle}>
        {avatar}
      </div>

      <div style={bodyStyle}>
        <div style={pillTheme ? pillRowStyle : undefined}>
          <span style={nameStyle}>{name}</span>
          {pill && pillTheme && (
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 5,
                fontFamily: 'var(--font-mono-operator), ui-monospace, monospace',
                fontSize: '9.5px',
                fontWeight: 500,
                letterSpacing: '0.06em',
                textTransform: 'uppercase',
                padding: '3px 8px 3px 7px',
                borderRadius: 3,
                border: `1px solid ${pillTheme.border}`,
                background: pillTheme.bg,
                color: pillTheme.color,
                whiteSpace: 'nowrap',
              }}
            >
              <span aria-hidden="true" style={{ width: 5, height: 5, borderRadius: '50%', background: pillTheme.dot }} />
              {pill.label}
            </span>
          )}
        </div>
        <div style={subStyle}>{sub}</div>
      </div>

      <div style={actionsStyle}>
        {actions.map((action) => (
          <DetailButton
            key={action.label}
            variant={action.variant}
            size="sm"
            href={action.href}
            data-testid={action['data-testid']}
          >
            {action.label}
          </DetailButton>
        ))}
      </div>
    </div>
  );
}
