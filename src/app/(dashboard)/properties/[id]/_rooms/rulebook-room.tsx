/**
 * Rulebook binder — room-drawer interior for `?room=rulebook`.
 *
 * One self-contained async server component: it fetches `properties.rules_text`
 * (same logic as the old `/properties/[id]/rulebook` page) and renders the
 * existing autosaving `RulebookForm` inside the shared room chrome. The drawer
 * shell (`RoomDrawerMount`) already paints the eyebrow/title/description from
 * `ROOM_META`, so this file renders only the body.
 *
 * Mockup notes:
 *  - Stat rail: Last updated / Version / Owner rules / Tenant-facing. These have
 *    no backing schema in this pass, so they render the spec placeholders
 *    ('—' / '1.0' / '0' / '0'). The fetch deliberately selects only
 *    `rules_text` — there is no rules-specific timestamp column, so "Last
 *    updated" stays '—' (no schema change here).
 *  - Actions: the mockup's "Edit rulebook" button is satisfied by the
 *    always-editable form, so no action row is rendered (no `RoomActions`).
 *  - Empty state: when `rules_text` is empty the form's own placeholder covers
 *    the explanatory copy, so we render only the mockup headline ("No rules
 *    yet.") plus a small sepia binder + plant spot illustration ABOVE the form.
 *    `RoomEmptyState` is intentionally not used here: it mandates a 2-line body
 *    that would duplicate the form's placeholder.
 */

import type { CSSProperties, ReactElement } from 'react';

import { createServerClient } from '@/lib/supabase/server';

import { RoomCard, RoomStatCell, RoomStatGrid } from './room-chrome';
import { RulebookForm } from '../rulebook-form';

interface RulebookRoomProps {
  propertyId: string;
}

export async function RulebookRoom({
  propertyId,
}: RulebookRoomProps): Promise<ReactElement> {
  const supabase = await createServerClient();

  // Mirrors the old rulebook page: pull the saved rules text for the property.
  const { data: propertyRow } = await supabase
    .from('properties')
    .select('rules_text')
    .eq('id', propertyId)
    .maybeSingle();

  const rulesText = propertyRow?.rules_text ?? '';
  const isEmpty = rulesText.trim().length === 0;

  return (
    <div style={layoutStyle}>
      <RoomStatGrid>
        <RoomStatCell label="Last updated" value="—" />
        <RoomStatCell label="Version" value="1.0" />
        <RoomStatCell label="Owner rules" value="0" />
        <RoomStatCell label="Tenant-facing" value="0" />
      </RoomStatGrid>

      {isEmpty ? <RulebookEmptyHeader /> : null}

      <RoomCard>
        <div style={cardInnerStyle}>
          <div style={helperRowStyle}>
            <span aria-hidden="true" style={helperDotStyle} />
            <span style={helperTextStyle}>Autosaves as you type.</span>
          </div>
          <RulebookForm propertyId={propertyId} initialText={rulesText} />
        </div>
      </RoomCard>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Empty header (above the form) — spot illustration + serif headline only.
// ---------------------------------------------------------------------------

function RulebookEmptyHeader(): ReactElement {
  return (
    <div style={emptyHeaderStyle}>
      <span aria-hidden="true" style={emptyIllustrationStyle}>
        <BinderPlantGlyph />
      </span>
      <h3 style={emptyHeadlineStyle}>No rules yet.</h3>
    </div>
  );
}

/**
 * Small, low-contrast sepia line-art: a ring binder with a little potted plant.
 * Strokes inherit `currentColor` (set to `--ink-3` on the wrapper); fills use
 * warm paper tones. Decorative only, so `aria-hidden` on the wrapping span.
 */
function BinderPlantGlyph(): ReactElement {
  const warmFill = 'color-mix(in srgb, var(--paper-0) 62%, transparent)';
  return (
    <svg
      width="72"
      height="56"
      viewBox="0 0 72 56"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {/* Binder cover */}
      <rect x="11" y="9" width="27" height="38" rx="2.5" fill={warmFill} />
      {/* Spine + rings */}
      <line x1="18" y1="11" x2="18" y2="45" />
      <circle cx="18" cy="18" r="1.4" fill={warmFill} />
      <circle cx="18" cy="28" r="1.4" fill={warmFill} />
      <circle cx="18" cy="38" r="1.4" fill={warmFill} />
      {/* Cover label sticker */}
      <rect x="23" y="17" width="11" height="8" rx="1" />
      <line x1="23" y1="31" x2="34" y2="31" />
      <line x1="23" y1="36" x2="31" y2="36" />
      {/* Potted plant */}
      <path d="M49 40 L63 40 L61 49 L51 49 Z" fill={warmFill} />
      <line x1="48" y1="40" x2="64" y2="40" />
      <line x1="56" y1="40" x2="56" y2="28" />
      <path d="M56 33 C 51 31, 49 27, 52 24 C 55 26, 56 30, 56 33 Z" fill={warmFill} />
      <path d="M56 30 C 61 28, 63 24, 60 21 C 57 23, 56 27, 56 30 Z" fill={warmFill} />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Styles (inline CSSProperties over Quiet Operator tokens).
// ---------------------------------------------------------------------------

const layoutStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 18,
  minWidth: 0,
};

const cardInnerStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
  minWidth: 0,
};

const helperRowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
};

const helperDotStyle: CSSProperties = {
  width: 6,
  height: 6,
  borderRadius: 999,
  background: 'color-mix(in srgb, var(--ink-3) 70%, transparent)',
  flexShrink: 0,
};

const helperTextStyle: CSSProperties = {
  fontFamily: 'var(--font-sans-operator), system-ui, sans-serif',
  fontSize: 12,
  lineHeight: 1.4,
  color: 'var(--ink-3)',
};

const emptyHeaderStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  textAlign: 'center',
  gap: 10,
  padding: '8px 12px 4px',
};

const emptyIllustrationStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  color: 'var(--ink-3)',
  opacity: 0.85,
};

const emptyHeadlineStyle: CSSProperties = {
  margin: 0,
  maxWidth: '34ch',
  fontFamily: 'var(--font-serif-display), Georgia, serif',
  fontSize: 21,
  fontWeight: 700,
  lineHeight: 1.2,
  letterSpacing: '-0.01em',
  color: 'var(--ink)',
};
