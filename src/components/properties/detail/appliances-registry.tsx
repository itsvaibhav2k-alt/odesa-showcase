/**
 * AppliancesRegistry — table-like appliance list for the unit detail page.
 *
 * Each row is a grid of name/model/age/status columns. The v1 schema has no
 * appliance → work_order linkage, so rows render as static (non-interactive)
 * text rather than a dead `href="#"` overlay or a fragile `WO-####` slug that
 * 404s against real work-order UUIDs. When a real linkage lands, re-introduce
 * a per-row overlay link via `workOrderHref(workOrderId)`.
 *
 * Mirrors the mockup's .reg / .reg-row pattern. Status via DetailPill.
 */

import type { CSSProperties } from 'react';
import type { ApplianceRow } from '@/lib/properties/mock-detail';
import { DetailPill } from './detail-pill';

export interface AppliancesRegistryProps {
  rows: ApplianceRow[];
}

const wrapStyle: CSSProperties = {
  border: '1px solid var(--hairline)',
  borderRadius: 12,
  overflow: 'hidden',
  background: 'var(--panel-lift)',
};

const rowStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 1.5fr) minmax(0, 1.2fr) 88px 110px 20px',
  alignItems: 'center',
  gap: 16,
  padding: '13px 18px',
  borderBottom: '1px solid var(--hairline-faint)',
  position: 'relative',
};

const cellRelStyle: CSSProperties = { position: 'relative', minWidth: 0 };

const nameStyle: CSSProperties = {
  fontSize: '13.5px',
  color: 'var(--ink)',
  fontWeight: 450,
};

const subStyle: CSSProperties = {
  fontSize: '11px',
  color: 'var(--ink-3)',
  marginTop: 1,
};

const modelLineStyle: CSSProperties = {
  fontFamily: 'var(--font-mono-operator)',
  fontSize: '11.5px',
  color: 'var(--ink-2)',
};

const warrantyLineStyle: CSSProperties = {
  fontSize: '10.5px',
  color: 'var(--ink-3)',
  marginTop: 2,
};

const ageStyle: CSSProperties = {
  fontFamily: 'var(--font-mono-operator)',
  fontSize: '11.5px',
  color: 'var(--ink-2)',
};

const arrowStyle: CSSProperties = {
  color: 'var(--ink-4)',
  fontSize: '13px',
  textAlign: 'right',
};

export function AppliancesRegistry({ rows }: AppliancesRegistryProps) {
  return (
    <>
      <div style={wrapStyle} data-reg>
        {rows.map((row, idx) => {
          const isLast = idx === rows.length - 1;
          const rowFinalStyle: CSSProperties = {
            ...rowStyle,
            ...(isLast ? { borderBottom: 'none' } : {}),
          };

          return (
            <div
              key={`${row.name}-${idx}`}
              style={rowFinalStyle}
              data-reg-row
              className="appl-row"
            >
              {/* Name + optional sub */}
              <div style={cellRelStyle}>
                <div style={nameStyle}>{row.name}</div>
                {row.sub && <div style={subStyle}>{row.sub}</div>}
              </div>

              {/* Model + warranty */}
              <div style={cellRelStyle} data-appl-col="model">
                <div style={modelLineStyle}>{row.model}</div>
                <div style={warrantyLineStyle}>{row.warranty}</div>
              </div>

              {/* Age */}
              <div style={{ ...cellRelStyle, ...ageStyle }} data-appl-col="age">
                {row.age}
              </div>

              {/* Status pill */}
              <div style={cellRelStyle}>
                <DetailPill variant={row.status.variant} label={row.status.label} />
              </div>

              {/* Arrow decoration */}
              <div aria-hidden="true" style={{ ...cellRelStyle, ...arrowStyle }}>
                →
              </div>
            </div>
          );
        })}
      </div>
      <AppliancesRegistryStyles />
    </>
  );
}

function AppliancesRegistryStyles() {
  return (
    <style precedence="appliances-registry">{`
      [data-reg-row]:hover { background: var(--panel-clean); }
      [data-reg-row]:hover [data-reg-arrow] { color: var(--terracotta); }
      @media (max-width: 560px) {
        .appl-row {
          grid-template-columns: minmax(0, 1fr) 78px 20px !important;
        }
        .appl-row [data-appl-col="model"],
        .appl-row [data-appl-col="age"] {
          display: none;
        }
      }
    `}</style>
  );
}
