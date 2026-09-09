'use client';

/**
 * CaseMetaStrip — horizontal 5-cell strip below the case header.
 *
 * Mono labels stacked over tabular numerals; cells are selected by
 * `caseMetaCells` (status-aware) so the same surface flips between
 * the "owner-review/rent/general" face and the "vendor-escalated" face
 * without any branching at the component layer.
 *
 * Cells with no source data are filtered out by the selector — no `—`
 * placeholders — so the strip collapses gracefully to 4 or 3 cells.
 */

import {
  caseMetaCells,
  type CaseMetaStatus,
} from '@/lib/inbox/case-meta-cells';
import type { CaseContext } from '@/lib/inbox/case-context';

export interface CaseMetaStripProps {
  caseContext: CaseContext;
  status: CaseMetaStatus;
  unitLabel?: string | null;
  propertyName?: string | null;
  tenantSinceYear?: number | null;
}

export function CaseMetaStrip({
  caseContext,
  status,
  unitLabel,
  propertyName,
  tenantSinceYear,
}: CaseMetaStripProps) {
  const cells = caseMetaCells(caseContext, status, {
    unitLabel,
    propertyName,
    tenantSinceYear,
  });

  if (cells.length === 0) {
    return null;
  }

  return (
    <div
      className='flex items-stretch px-9'
      style={{
        background: 'var(--panel-clean, #FFFDF6)',
        borderTop: '1px solid var(--hairline-faint, #EAE0CA)',
        borderBottom: '1px solid var(--hairline-faint, #EAE0CA)',
        padding: '10px 36px',
        gap: '32px',
      }}
    >
      {cells.map((cell, idx) => (
        <div
          key={cell.id}
          className='flex flex-col'
          style={{
            gap: '2px',
            paddingLeft: idx === 0 ? 0 : '0',
          }}
        >
          <span
            className='uppercase'
            style={{
              fontFamily:
                'var(--font-mono-operator, ui-monospace, monospace)',
              color: 'var(--ink-4, #9F9075)',
              fontSize: '9.5px',
              letterSpacing: '0.12em',
            }}
          >
            {cell.label}
          </span>
          <span
            className='num'
            style={{
              fontFamily: 'var(--font-sans-operator, system-ui, sans-serif)',
              color: 'var(--ink, #1B1712)',
              fontSize: '13px',
              fontWeight: 500,
              letterSpacing: '-0.005em',
              fontFeatureSettings: '"tnum" 1, "lnum" 1',
            }}
          >
            {cell.value}
          </span>
        </div>
      ))}
    </div>
  );
}
