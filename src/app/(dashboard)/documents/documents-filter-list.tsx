'use client';

/**
 * DocumentsFilterList — the Property Archive index for `/documents`.
 *
 * Art direction: an archive finding aid / accession register. A ruled column
 * head opens the index; rows are retrievable accession entries (type code +
 * title + provenance + dates + status); an archive-scope margin reads what's on
 * file and what still needs to be found. Provenance and expiry come only from
 * real fields — the archive never implies OCR, coverage extraction, or citation
 * readiness.
 *
 * Owns the active filter facet (client state) and renders the FilterBar plus
 * the filtered DocumentRow list inside the `documents-list` sheet. The TESTID /
 * class contract is preserved: `documents-list`, `.document-row`, the facet
 * buttons, and the exact empty-state copy the unit tests pin.
 *
 * 'use client' — needs useState for the controlled filter.
 */

import { useMemo, useState, type CSSProperties } from 'react';
import { FilterBar, type FilterOption } from '@/components/properties/list/filter-bar';
import { DocumentRow } from '@/components/properties/list/document-row';
import {
  ColumnHead,
  OfficeRail,
  RailFigure,
  WorkspaceGrid,
  instrumentSheetStyle,
} from '@/components/properties/list/office-primitives';
import type {
  DocumentFacetId,
  DocumentRow as DocumentRowData,
  DocumentType,
  FacetSpec,
} from '@/lib/properties/mock-portfolio-views';

export interface DocumentsFilterListProps {
  facets: readonly FacetSpec<DocumentFacetId>[];
  rows: readonly DocumentRowData[];
  /** VA context mode: archive reads remain available; upload prompts do not. */
  readOnly?: boolean;
}

/** Matches DocumentRow's grid so the column head aligns to the row columns. */
const ARCHIVE_GRID = 'minmax(0, 1fr) 150px 132px 16px';

/** Document types included by each facet ("all" => every row). */
const FACET_TYPES: Record<DocumentFacetId, readonly DocumentType[] | null> = {
  all: null,
  leases: ['lease'],
  inspections: ['inspection'],
  insurance: ['insurance'],
  notices: ['notice'],
};

function inFacet(facet: DocumentFacetId, row: DocumentRowData): boolean {
  const types = FACET_TYPES[facet];
  return types === null ? true : types.includes(row.type);
}

/**
 * Empty-state copy. Truly-empty (no documents at all) gets onboarding copy that
 * explains what the archive does — honestly: it files each document under its
 * property/tenant/vendor and tracks lease and policy expiry (no OCR or citation
 * claims). Facet-empty (documents exist, none match) names the facet and offers
 * the way out. The unit tests pin both strings' shape.
 */
function emptyCopy(
  facet: DocumentFacetId,
  hasAnyRows: boolean,
  readOnly: boolean,
): string {
  if (!hasAnyRows) {
    if (readOnly) {
      return 'No documents are on file yet. An owner can add lease, insurance, or vendor records; use this archive as shift context.';
    }
    return 'No documents yet. Upload a lease, insurance certificate, or W-9 — Odesa files each under its property, tenant, or vendor and tracks lease and policy expiry.';
  }
  const facetLabel = FACET_TYPES[facet]?.[0] ?? 'matching';
  if (readOnly) {
    return `No ${facetLabel} documents. Switch filters to review another record type.`;
  }
  return `No ${facetLabel} documents. Switch filters or upload one.`;
}

const emptyStyle: CSSProperties = {
  padding: '22px 18px',
  fontSize: '12.5px',
  lineHeight: 1.55,
  color: 'var(--ink-2)',
};

/** Count rows carrying a given badge label. */
function badgeCount(rows: readonly DocumentRowData[], badge: string): number {
  return rows.reduce((n, r) => (r.badge === badge ? n + 1 : n), 0);
}

export function DocumentsFilterList({
  facets,
  rows,
  readOnly = false,
}: DocumentsFilterListProps) {
  const [active, setActive] = useState<DocumentFacetId>('all');

  const options: FilterOption[] = facets.map((f) => ({ id: f.id, label: `${f.label} ${f.count}` }));
  const facetCount = (id: DocumentFacetId) => facets.find((f) => f.id === id)?.count ?? 0;

  const visible = useMemo(() => rows.filter((row) => inFacet(active, row)), [rows, active]);

  const scope = useMemo(
    () => ({
      files: rows.length,
      leases: facetCount('leases'),
      insurance: facetCount('insurance'),
      missing: badgeCount(rows, 'Missing'),
      needsReview: badgeCount(rows, 'Needs review'),
      expiring: badgeCount(rows, 'Expiring') + badgeCount(rows, 'Expired'),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, facets],
  );

  const index = (
    <div style={instrumentSheetStyle} data-testid="documents-list">
      {visible.length > 0 ? (
        <>
          <ColumnHead
            template={ARCHIVE_GRID}
            cells={[
              { label: 'Record' },
              { label: 'Dates' },
              { label: 'Status' },
              { label: '' },
            ]}
          />
          {visible.map((row) => (
            <DocumentRow key={row.title} row={row} />
          ))}
        </>
      ) : (
        <p style={emptyStyle}>
          {emptyCopy(active, rows.length > 0, readOnly)}
        </p>
      )}
    </div>
  );

  const rail = (
    <OfficeRail title="Archive scope" note="What's on file — and what still needs to be found.">
      <RailFigure label="Files on record" value={String(scope.files)} headline />
      <RailFigure label="Lease records" value={String(scope.leases)} />
      <RailFigure label="Insurance files" value={String(scope.insurance)} />
      <RailFigure label="Missing" value={String(scope.missing)} tone={scope.missing > 0 ? 'clay' : undefined} />
      <RailFigure
        label="Needs review"
        value={String(scope.needsReview)}
        tone={scope.needsReview > 0 ? 'amber' : undefined}
      />
      <RailFigure
        label="Expiry flagged"
        value={String(scope.expiring)}
        tone={scope.expiring > 0 ? 'amber' : undefined}
      />
    </OfficeRail>
  );

  return (
    <>
      <FilterBar
        label="Type"
        filters={options}
        value={active}
        onChange={(id) => setActive(id as DocumentFacetId)}
      />

      {rows.length === 0 ? index : <WorkspaceGrid main={index} rail={rail} />}
    </>
  );
}
