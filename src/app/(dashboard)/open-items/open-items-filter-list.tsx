'use client';

/**
 * OpenItemsFilterList — interactive island for /open-items.
 *
 * Owns the active filter facet (client state) and renders the FilterBar plus
 * the filtered OpenItemRow list inside the mockup's `.brief` container. Facets
 * map directly to OpenItemKind (maintenance / rent / owner / leasing); "all"
 * passes everything through. The last visible row drops its bottom border.
 *
 * 'use client' — needs useState for the controlled filter.
 */

import { useState, type CSSProperties } from 'react';
import { FilterBar, type FilterOption } from '@/components/properties/list/filter-bar';
import { OpenItemRow } from '@/components/properties/list/open-item-row';
import type {
  FacetSpec,
  OpenItemFacetId,
  OpenItemRow as OpenItemRowData,
} from '@/lib/properties/mock-portfolio-views';

export interface OpenItemsFilterListProps {
  facets: readonly FacetSpec<OpenItemFacetId>[];
  rows: readonly OpenItemRowData[];
}

function inFacet(facet: OpenItemFacetId, row: OpenItemRowData): boolean {
  return facet === 'all' ? true : row.kind === facet;
}

/** Matches the mockup's `.brief` panel with the open-items padding override. */
const briefStyle: CSSProperties = {
  background: 'var(--panel-lift)',
  border: '1px solid var(--hairline)',
  borderRadius: 12,
  padding: '6px 20px 12px',
};

const emptyStyle: CSSProperties = {
  padding: '14px 0',
  fontSize: '12.5px',
  color: 'var(--ink-3)',
};

export function OpenItemsFilterList({ facets, rows }: OpenItemsFilterListProps) {
  const [active, setActive] = useState<OpenItemFacetId>('all');

  const options: FilterOption[] = facets.map((f) => ({
    id: f.id,
    label: `${f.label} ${f.count}`,
  }));

  const visible = rows.filter((row) => inFacet(active, row));

  return (
    <>
      <FilterBar
        label="Filter"
        filters={options}
        value={active}
        onChange={(id) => setActive(id as OpenItemFacetId)}
      />

      <div style={briefStyle} data-testid="open-items-list">
        {visible.length > 0 ? (
          visible.map((row, idx) => (
            <OpenItemRow key={row.index} row={row} hasBorder={idx < visible.length - 1} />
          ))
        ) : (
          <p style={emptyStyle}>No open items match this filter.</p>
        )}
      </div>
    </>
  );
}
