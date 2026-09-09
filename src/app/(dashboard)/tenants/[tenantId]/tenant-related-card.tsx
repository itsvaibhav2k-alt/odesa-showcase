/**
 * TenantRelatedCard — the "Related property and unit" context card on the
 * tenant brief.
 *
 * Mirrors the mockup `.ctx-card` structure (round avatar + name/sub body +
 * two action links) exactly as the shared `CtxCard` atom does, but rendered
 * locally so the two cross-links can carry their required test ids
 * (`tenant-property-link` / `tenant-unit-link`) and resolve their hrefs from
 * the `propertyHref` / `unitHref` helpers rather than the baked-in mock values.
 *
 * A11Y: avatar is aria-hidden; the card is not itself a link; the two actions
 * are sibling DetailButtons — no nested interactive elements.
 *
 * Server component — purely presentational.
 */

import type { CSSProperties } from 'react';
import type { CtxCardSpec } from '@/lib/properties/mock-detail';
import { DetailButton } from '@/components/properties/detail/detail-button';

export interface TenantRelatedCardProps {
  card: CtxCardSpec;
  propertyHref: string;
  unitHref: string;
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

export function TenantRelatedCard({ card, propertyHref, unitHref }: TenantRelatedCardProps) {
  return (
    <div style={cardStyle}>
      <div aria-hidden="true" style={avatarStyle}>
        {card.avatar}
      </div>

      <div style={bodyStyle}>
        <span style={nameStyle}>{card.name}</span>
        <div style={subStyle}>{card.sub}</div>
      </div>

      <div style={actionsStyle}>
        <span data-testid="tenant-property-link">
          <DetailButton variant="default" size="sm" href={propertyHref}>
            View property
          </DetailButton>
        </span>
        <span data-testid="tenant-unit-link">
          <DetailButton variant="default" size="sm" href={unitHref}>
            View unit
          </DetailButton>
        </span>
      </div>
    </div>
  );
}
