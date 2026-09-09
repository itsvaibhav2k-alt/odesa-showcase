/**
 * PropertyFinancialTable — per-property P&L rollup for `/financials`.
 *
 * Server component, warm-operator palette (token-matched to the rest of
 * the console rather than the `--paper-*` `DataTable`, which belongs to a
 * different theme). Columns: property, occupancy, billed, collected,
 * outstanding, late, collection %, and a risk badge driven by the
 * domain's `riskLevel`. Rows are attention-ordered via the pure
 * `orderPropertiesByRisk` (worst risk first, then largest outstanding).
 *
 * Spend / NOI columns are deliberately absent: expense imports aren't
 * connected, so there is no honest operating-result figure per property.
 * The collection / late columns are real (integer cents → formatted).
 */

import type { CSSProperties } from 'react';

import { StatusChip } from '@/components/shared/status-chip';
import { formatMoneyCents, formatPct } from '@/lib/financials/format';
import { orderPropertiesByRisk } from '@/lib/financials/summary';
import type { PropertyFinancialSnapshot } from '@/lib/financials/types';

import { riskTone } from './tone';

export interface PropertyFinancialTableProps {
  properties: PropertyFinancialSnapshot[];
}

const wrapStyle: CSSProperties = {
  border: '1px solid var(--hairline)',
  borderRadius: 12,
  overflow: 'hidden',
  background: 'var(--panel-lift)',
};

const tableStyle: CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse',
  fontSize: '13px',
};

const thStyle: CSSProperties = {
  textAlign: 'left',
  padding: '11px 14px',
  fontFamily: 'var(--font-mono-operator), ui-monospace, monospace',
  fontSize: '9.5px',
  letterSpacing: '0.1em',
  textTransform: 'uppercase',
  color: 'var(--ink-3)',
  borderBottom: '1px solid var(--hairline)',
  background: 'var(--panel)',
  whiteSpace: 'nowrap',
};

const thRightStyle: CSSProperties = { ...thStyle, textAlign: 'right' };

const tdStyle: CSSProperties = {
  padding: '13px 14px',
  borderBottom: '1px solid var(--hairline-faint)',
  color: 'var(--ink)',
  verticalAlign: 'middle',
};

const tdRightStyle: CSSProperties = {
  ...tdStyle,
  textAlign: 'right',
  fontFamily: 'var(--font-mono-operator), ui-monospace, monospace',
  fontFeatureSettings: "'tnum' 1",
};

const nameStyle: CSSProperties = {
  fontWeight: 500,
  color: 'var(--ink)',
};

const emptyStyle: CSSProperties = {
  padding: '28px 18px',
  textAlign: 'center',
  fontSize: '13px',
  color: 'var(--ink-3)',
  border: '1px solid var(--hairline)',
  borderRadius: 12,
  background: 'var(--panel-lift)',
};

export function PropertyFinancialTable({ properties }: PropertyFinancialTableProps) {
  if (properties.length === 0) {
    return (
      <div style={emptyStyle} data-testid="property-financial-table-empty">
        No properties in this portfolio yet.
      </div>
    );
  }

  return (
    <div style={wrapStyle} data-testid="property-financial-table">
      <table style={tableStyle}>
        <thead>
          <tr>
            <th style={thStyle}>Property</th>
            <th style={thRightStyle}>Occupancy</th>
            <th style={thRightStyle}>Billed</th>
            <th style={thRightStyle}>Collected</th>
            <th style={thRightStyle}>Outstanding</th>
            <th style={thRightStyle}>Late</th>
            <th style={thRightStyle}>Collection</th>
            <th style={thStyle}>Risk</th>
          </tr>
        </thead>
        <tbody>
          {orderPropertiesByRisk(properties).map((property) => {
            const risk = riskTone(property.riskLevel);
            const outstandingColor =
              property.rentOutstandingCents > 0 ? 'var(--clay)' : 'var(--ink-3)';
            const lateColor = property.rentLateCents > 0 ? 'var(--clay)' : 'var(--ink-3)';
            return (
              <tr key={property.propertyId} data-testid="property-financial-row">
                <td style={tdStyle}>
                  <span style={nameStyle}>{property.propertyName}</span>
                </td>
                <td style={tdRightStyle}>
                  {property.occupiedUnits}/{property.units}
                </td>
                <td style={tdRightStyle}>{formatMoneyCents(property.rentBilledCents)}</td>
                <td style={{ ...tdRightStyle, color: 'var(--green-ink)' }}>
                  {formatMoneyCents(property.rentCollectedCents)}
                </td>
                <td style={{ ...tdRightStyle, color: outstandingColor }}>
                  {formatMoneyCents(property.rentOutstandingCents)}
                </td>
                <td style={{ ...tdRightStyle, color: lateColor }}>
                  {formatMoneyCents(property.rentLateCents)}
                </td>
                <td style={tdRightStyle}>{formatPct(property.collectionRatePct)}</td>
                <td style={tdStyle}>
                  <StatusChip tone={risk.tone} label={risk.label} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
