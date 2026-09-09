/**
 * Tests for the property Maintenance tab (Wave 8).
 *
 * Mocks the query module so we can render the server component in
 * isolation and assert the empty state + grouped sections + row counts.
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';

vi.mock('@/lib/properties/queries', async () => {
  const actual = await vi.importActual<
    typeof import('@/lib/properties/queries')
  >('@/lib/properties/queries');
  return {
    ...actual,
    listMaintenanceTicketsForProperty: vi.fn(),
  };
});

import { listMaintenanceTicketsForProperty } from '@/lib/properties/queries';
import type { MaintenanceTicketRow } from '@/lib/properties/queries';

import { MaintenanceTab } from '../maintenance-tab';

function makeRow(
  o: Partial<MaintenanceTicketRow> & { id: string },
): MaintenanceTicketRow {
  return {
    id: o.id,
    summary: o.summary ?? `Summary ${o.id}`,
    severity: o.severity ?? 'medium',
    urgency: o.urgency ?? 'routine',
    status: o.status ?? 'open',
    reportedBy: o.reportedBy ?? null,
    createdAt: o.createdAt ?? '2026-05-01T00:00:00.000Z',
    unitId: o.unitId ?? 'unit-1',
    unitLabel: o.unitLabel ?? 'Apt 1A',
  };
}

async function renderTab(): Promise<void> {
  // Server component → resolved promise → JSX element.
  const element = await MaintenanceTab({
    organizationId: 'org-1',
    propertyId: 'prop-1',
  });
  render(element);
}

describe('MaintenanceTab', () => {
  it('renders the empty state when there are no tickets', async () => {
    vi.mocked(listMaintenanceTicketsForProperty).mockResolvedValue([]);

    await renderTab();

    expect(screen.getByTestId('maintenance-tab-empty')).toBeInTheDocument();
    expect(screen.queryByTestId('maintenance-tab')).not.toBeInTheDocument();
  });

  it('renders separate sections for open, in_progress, resolved', async () => {
    vi.mocked(listMaintenanceTicketsForProperty).mockResolvedValue([
      makeRow({ id: 'o1', status: 'open' }),
      makeRow({ id: 'o2', status: 'open' }),
      makeRow({ id: 'p1', status: 'in_progress' }),
      makeRow({ id: 'r1', status: 'resolved' }),
    ]);

    await renderTab();

    const openSection = screen.getByTestId('maintenance-section-open');
    const progressSection = screen.getByTestId('maintenance-section-in_progress');
    const resolvedSection = screen.getByTestId('maintenance-section-resolved');

    expect(openSection).toHaveAttribute('data-row-count', '2');
    expect(progressSection).toHaveAttribute('data-row-count', '1');
    expect(resolvedSection).toHaveAttribute('data-row-count', '1');

    expect(
      within(openSection).getByTestId('maintenance-section-open-count'),
    ).toHaveTextContent('2 tickets');
    expect(
      within(progressSection).getByTestId('maintenance-section-in_progress-count'),
    ).toHaveTextContent('1 ticket');
  });

  it('omits the cancelled bucket from the main view', async () => {
    vi.mocked(listMaintenanceTicketsForProperty).mockResolvedValue([
      makeRow({ id: 'o1', status: 'open' }),
      makeRow({ id: 'c1', status: 'cancelled' }),
    ]);

    await renderTab();

    expect(screen.getByTestId('maintenance-section-open')).toBeInTheDocument();
    expect(
      screen.queryByTestId('maintenance-section-cancelled'),
    ).not.toBeInTheDocument();
  });

  it('renders unit em-dash when unitLabel is null', async () => {
    vi.mocked(listMaintenanceTicketsForProperty).mockResolvedValue([
      makeRow({
        id: 'o1',
        status: 'open',
        unitLabel: null,
        summary: 'Roof leak',
      }),
    ]);

    await renderTab();

    const section = screen.getByTestId('maintenance-section-open');
    // Summary text confirms the row rendered; em-dash sits in the Unit cell.
    expect(within(section).getByText('Roof leak')).toBeInTheDocument();
    expect(within(section).getAllByText('—').length).toBeGreaterThanOrEqual(1);
  });

  it('renders a status pill per row', async () => {
    vi.mocked(listMaintenanceTicketsForProperty).mockResolvedValue([
      makeRow({ id: 'o1', status: 'open' }),
      makeRow({ id: 'p1', status: 'in_progress' }),
    ]);

    await renderTab();

    expect(screen.getByTestId('maintenance-status-open')).toBeInTheDocument();
    expect(
      screen.getByTestId('maintenance-status-in_progress'),
    ).toBeInTheDocument();
  });
});
