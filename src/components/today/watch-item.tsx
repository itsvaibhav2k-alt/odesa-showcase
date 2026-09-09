import type { CSSProperties } from 'react';

/**
 * Single row in the Watching Quietly rail.
 *
 * Server component. PR-3 wires `isEmphasized` + `linkedLabel` so the
 * watch item whose `channel` matches the currently-selected queue
 * row's `channel` "lights up":
 *
 *  - background → `var(--panel-lift)`
 *  - inset terracotta shadow → `inset 3px 0 0 var(--terracotta)`
 *  - dot scales to 1.25
 *  - a `↳ LINKED: {linkedLabel}` tag fades in below the meta line
 *
 * The transition runs at 220ms ease on background, box-shadow, the dot
 * transform, and the linked-tag's opacity + translateX. All four
 * preserve the "the UI is thinking" beat described in
 * ref-load-bearing-details.md — preserve them exactly.
 *
 * The `↳` glyph is a text character, not an SVG arrow. Do not swap it
 * for a Lucide icon.
 */

export type WatchDotVariant = 'amber' | 'clay' | 'green' | 'muted';

interface WatchItemProps {
  channel: string;
  title: string;
  meta: string;
  dotVariant: WatchDotVariant;
  /**
   * When `true`, the item renders in the "linked to the selected
   * queue row" state (terracotta inset + panel-lift bg + scaled dot
   * + optional `↳ LINKED:` tag). Defaults to `false`.
   */
  isEmphasized?: boolean;
  /**
   * The label to display in the `↳ LINKED: …` tag below the meta line.
   * Only rendered when `isEmphasized` is also true. The tag is uppercased
   * via CSS, so callers may pass sentence-case strings.
   */
  linkedLabel?: string;
}

const DOT_STYLES: Record<WatchDotVariant, CSSProperties> = {
  amber: {
    background: 'var(--amber)',
    boxShadow: '0 0 0 2px rgba(180, 132, 42, 0.12)',
  },
  clay: {
    background: 'var(--clay)',
    boxShadow: '0 0 0 2px rgba(166, 83, 58, 0.12)',
  },
  green: {
    background: 'var(--green)',
    boxShadow: '0 0 0 2px rgba(77, 122, 86, 0.12)',
  },
  muted: {
    background: 'var(--ink-4)',
    boxShadow: 'none',
  },
};

const linkTagStyle: CSSProperties = {
  display: 'inline-block',
  marginTop: '4px',
  color: 'var(--terracotta)',
  fontSize: '10px',
  fontFamily: 'var(--font-mono-operator), ui-monospace, monospace',
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
  // fade + slide in over 220ms (matches the emphasis transition budget)
  transition: 'opacity 220ms ease, transform 220ms ease',
};

export function WatchItem({
  channel,
  title,
  meta,
  dotVariant,
  isEmphasized = false,
  linkedLabel,
}: WatchItemProps) {
  const showLinkTag = isEmphasized && Boolean(linkedLabel);

  return (
    <li
      data-watch-item={channel}
      data-channel={channel}
      data-emphasized={isEmphasized ? 'true' : 'false'}
      style={{
        display: 'grid',
        gridTemplateColumns: '14px 1fr',
        columnGap: '10px',
        alignItems: 'start',
        padding: isEmphasized ? '12px 12px 12px 10px' : '12px 0',
        borderBottom: '1px solid var(--hairline-faint)',
        transition: 'background 220ms ease, box-shadow 220ms ease, padding 220ms ease',
        background: isEmphasized ? 'var(--panel-lift)' : 'transparent',
        boxShadow: isEmphasized ? 'inset 3px 0 0 var(--terracotta)' : 'none',
      }}
    >
      <span
        aria-hidden="true"
        style={{
          marginTop: '6px',
          width: '8px',
          height: '8px',
          borderRadius: '999px',
          transition: 'transform 220ms ease',
          transform: isEmphasized ? 'scale(1.25)' : 'scale(1)',
          ...DOT_STYLES[dotVariant],
        }}
      />
      <div style={{ minWidth: 0 }}>
        <div
          style={{
            fontFamily: 'var(--font-sans-operator)',
            fontWeight: 500,
            fontSize: '13px',
            color: 'var(--ink)',
            lineHeight: 1.35,
          }}
        >
          {title}
        </div>
        <div
          style={{
            marginTop: '4px',
            fontFamily: 'var(--font-sans-operator)',
            fontWeight: 400,
            fontSize: '12px',
            color: 'var(--ink-3)',
            lineHeight: 1.5,
          }}
        >
          {meta}
        </div>
        {showLinkTag ? (
          <span
            role="status"
            data-link-tag="true"
            style={{
              ...linkTagStyle,
              opacity: 1,
              transform: 'translateX(0)',
            }}
          >
            ↳ LINKED: {linkedLabel}
          </span>
        ) : null}
      </div>
    </li>
  );
}
