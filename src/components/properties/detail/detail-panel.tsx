/**
 * DetailPanel — bordered card atom for property detail pages.
 *
 * Matches the mockup's `.panel` (lift) and `.panel.clean` variants:
 * 1px --hairline border, border-radius 12, bg --panel-lift or --panel.
 */

import type { CSSProperties, ReactNode } from 'react';

export interface DetailPanelProps {
  /** 'lift' (default) => --panel-lift background; 'clean' => --panel. */
  variant?: 'lift' | 'clean';
  children: ReactNode;
}

export function DetailPanel({ variant = 'lift', children }: DetailPanelProps) {
  const panelStyle: CSSProperties = {
    background: variant === 'clean' ? 'var(--panel)' : 'var(--panel-lift)',
    border: '1px solid var(--hairline)',
    borderRadius: '12px',
    padding: '18px 20px',
  };

  return <div style={panelStyle}>{children}</div>;
}
