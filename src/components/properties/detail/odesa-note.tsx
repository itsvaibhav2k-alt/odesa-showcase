/**
 * OdesaNote — Odesa reasoning callout.
 *
 * Mirrors the mockup `.odesa-note` / `.obadge` / `.obody` / `.based-on`
 * structure. The terracotta dot before "Odesa" is CSS ::before, replicated
 * here as an aria-hidden <span>. The body supports `**bold**` markdown
 * segments (mirroring the mockup's <b> inside `.obody`), parsed into <b>
 * nodes. `basedOn` is rendered in the `.based-on` sub-line.
 */

import type { CSSProperties } from 'react';
import type { OdesaNote as OdesaNoteData } from '@/lib/properties/mock-detail';

export type OdesaNoteProps = OdesaNoteData;

const boldStyle: CSSProperties = {
  fontWeight: 600,
  color: 'var(--ink)',
};

/** Parse **bold** markdown segments into React nodes. */
function parseBold(text: string): React.ReactNode[] {
  const parts = text.split(/\*\*(.+?)\*\*/g);
  return parts.map((part, i) =>
    i % 2 === 1 ? (
      <b key={i} style={boldStyle}>
        {part}
      </b>
    ) : (
      part
    ),
  );
}

const wrapStyle: CSSProperties = {
  display: 'flex',
  gap: 11,
  alignItems: 'flex-start',
  padding: '14px 0 6px',
  marginTop: 2,
};

const badgeStyle: CSSProperties = {
  fontFamily: 'var(--font-mono-operator), ui-monospace, monospace',
  fontSize: '9.5px',
  letterSpacing: '0.14em',
  textTransform: 'uppercase',
  color: 'var(--terracotta)',
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  paddingTop: 3,
  flexShrink: 0,
};

const dotStyle: CSSProperties = {
  width: 5,
  height: 5,
  borderRadius: '50%',
  background: 'var(--terracotta)',
  flexShrink: 0,
};

const bodyStyle: CSSProperties = {
  fontSize: '13.5px',
  color: 'var(--ink-2)',
  lineHeight: 1.55,
  letterSpacing: '-0.003em',
};

const basedOnStyle: CSSProperties = {
  marginTop: 10,
  fontFamily: 'var(--font-mono-operator), ui-monospace, monospace',
  fontSize: '10px',
  letterSpacing: '0.03em',
  color: 'var(--ink-3)',
};

const basedOnLabelStyle: CSSProperties = {
  textTransform: 'uppercase',
  letterSpacing: '0.1em',
  color: 'var(--ink-4)',
  marginRight: 9,
};

export function OdesaNote({ body, basedOn }: OdesaNoteProps) {
  return (
    <div style={wrapStyle}>
      <span style={badgeStyle}>
        <span aria-hidden="true" style={dotStyle} />
        Odesa
      </span>
      <div style={bodyStyle}>
        {parseBold(body)}
        {basedOn && (
          <div style={basedOnStyle}>
            <span style={basedOnLabelStyle}>Based on</span>
            {basedOn}
          </div>
        )}
      </div>
    </div>
  );
}
