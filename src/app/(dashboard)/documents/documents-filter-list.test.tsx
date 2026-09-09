import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { DocumentsFilterList } from './documents-filter-list';
import type {
  DocumentRow,
  FacetSpec,
  DocumentFacetId,
} from '@/lib/properties/mock-portfolio-views';

const FACETS: FacetSpec<DocumentFacetId>[] = [
  { id: 'all', label: 'All', count: 2 },
  { id: 'leases', label: 'Leases', count: 1 },
  { id: 'inspections', label: 'Inspections', count: 1 },
  { id: 'insurance', label: 'Insurance', count: 0 },
  { id: 'notices', label: 'Notices', count: 0 },
];

const ROWS: DocumentRow[] = [
  {
    title: 'Lease — Maya Chen',
    type: 'lease',
    badge: 'Active',
    related: 'Truth House · 2A',
    span: 'Jul 2026 – Jul 2027',
    href: '/tenants/maya',
  },
  {
    title: 'Move-in inspection — 2A',
    type: 'inspection',
    badge: 'Inspection',
    related: 'Truth House · 2A',
    span: '—',
    href: '/properties/truth/units/2a',
  },
];

describe('DocumentsFilterList states', () => {
  it('renders populated rows and filters them by type', () => {
    render(<DocumentsFilterList facets={FACETS} rows={ROWS} />);
    const list = screen.getByTestId('documents-list');

    expect(within(list).getByText('Lease — Maya Chen')).toBeInTheDocument();
    expect(within(list).getByText('Move-in inspection — 2A')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('filter-btn-inspections'));

    expect(within(list).queryByText('Lease — Maya Chen')).not.toBeInTheDocument();
    expect(within(list).getByText('Move-in inspection — 2A')).toBeInTheDocument();
  });

  it('explains a truly empty document ledger', () => {
    render(
      <DocumentsFilterList
        facets={FACETS.map((facet) => ({ ...facet, count: 0 }))}
        rows={[]}
      />,
    );

    expect(screen.getByText(/No documents yet\. Upload a lease/)).toBeInTheDocument();
  });

  it('uses read-only archive copy for a VA empty state', () => {
    render(
      <DocumentsFilterList
        facets={FACETS.map((facet) => ({ ...facet, count: 0 }))}
        rows={[]}
        readOnly
      />,
    );

    expect(screen.getByText(/No documents are on file yet/)).toBeInTheDocument();
    expect(screen.getByText(/An owner can add/)).toBeInTheDocument();
    expect(screen.queryByText(/Upload a lease/)).not.toBeInTheDocument();
  });

  it('distinguishes an empty filter from an empty ledger', () => {
    render(<DocumentsFilterList facets={FACETS} rows={ROWS} />);

    fireEvent.click(screen.getByTestId('filter-btn-insurance'));

    expect(
      screen.getByText('No insurance documents. Switch filters or upload one.'),
    ).toBeInTheDocument();
  });
});
