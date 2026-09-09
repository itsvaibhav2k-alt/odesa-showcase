/**
 * Unit tests for the generic `DataTable<T>` primitive.
 *
 * Covers the two behaviors the playbook calls out (empty state slot,
 * onRowClick wiring) plus enough surface area to lock in column
 * rendering, custom renderers, and keyboard accessibility.
 */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import { DataTable, type DataTableColumn } from '@/components/ui/data-table';

interface Person {
  id: string;
  name: string;
  age: number;
}

const COLUMNS: DataTableColumn<Person>[] = [
  { key: 'name', header: 'Name' },
  { key: 'age', header: 'Age', align: 'right' },
];

describe('DataTable', () => {
  describe('empty state', () => {
    it('renders the empty slot when rows is empty', () => {
      render(
        <DataTable<Person>
          rows={[]}
          columns={COLUMNS}
          getRowKey={(r) => r.id}
          emptyState={<span>No people yet.</span>}
        />,
      );

      expect(screen.getByText('No people yet.')).toBeInTheDocument();
      // No <table> rendered in empty state.
      expect(screen.queryByRole('table')).not.toBeInTheDocument();
    });

    it('falls back to a default message when no empty slot is provided', () => {
      render(
        <DataTable<Person>
          rows={[]}
          columns={COLUMNS}
          getRowKey={(r) => r.id}
        />,
      );

      expect(screen.getByText('No data to display.')).toBeInTheDocument();
    });
  });

  describe('rendering', () => {
    it('renders headers and one row per item with default cell values', () => {
      const rows: Person[] = [
        { id: 'a', name: 'Ada', age: 36 },
        { id: 'b', name: 'Linus', age: 54 },
      ];

      render(
        <DataTable<Person>
          rows={rows}
          columns={COLUMNS}
          getRowKey={(r) => r.id}
        />,
      );

      expect(screen.getByText('Name')).toBeInTheDocument();
      expect(screen.getByText('Age')).toBeInTheDocument();
      expect(screen.getByText('Ada')).toBeInTheDocument();
      expect(screen.getByText('Linus')).toBeInTheDocument();
      expect(screen.getAllByTestId('data-table-row')).toHaveLength(2);
    });

    it('uses a custom render function when provided', () => {
      const rows: Person[] = [{ id: 'a', name: 'Ada', age: 36 }];
      const columns: DataTableColumn<Person>[] = [
        {
          key: 'name',
          header: 'Person',
          render: (r) => <strong data-testid='custom'>{r.name.toUpperCase()}</strong>,
        },
      ];

      render(
        <DataTable<Person>
          rows={rows}
          columns={columns}
          getRowKey={(r) => r.id}
        />,
      );

      expect(screen.getByTestId('custom')).toHaveTextContent('ADA');
    });

    it('renders an em-dash for null / undefined / empty default cell values', () => {
      const rows = [{ id: 'a', name: '', age: 0 }] as Person[];
      const columns: DataTableColumn<Person>[] = [
        { key: 'name', header: 'Name' },
        { key: 'missing', header: 'Missing' },
      ];

      render(
        <DataTable
          rows={rows}
          columns={columns}
          getRowKey={(r) => r.id}
        />,
      );

      // Two em-dashes: one for empty `name`, one for unknown `missing` key.
      const dashes = screen.getAllByText('—');
      expect(dashes.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('onRowClick', () => {
    it('fires onRowClick with the row payload when a row is clicked', () => {
      const handler = vi.fn();
      const rows: Person[] = [
        { id: 'a', name: 'Ada', age: 36 },
        { id: 'b', name: 'Linus', age: 54 },
      ];

      render(
        <DataTable<Person>
          rows={rows}
          columns={COLUMNS}
          getRowKey={(r) => r.id}
          onRowClick={handler}
        />,
      );

      const [firstRow, secondRow] = screen.getAllByTestId('data-table-row');
      fireEvent.click(secondRow);

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith(rows[1]);

      fireEvent.click(firstRow);
      expect(handler).toHaveBeenCalledTimes(2);
      expect(handler).toHaveBeenLastCalledWith(rows[0]);
    });

    it('makes rows keyboard-activatable when onRowClick is set', () => {
      const handler = vi.fn();
      render(
        <DataTable<Person>
          rows={[{ id: 'a', name: 'Ada', age: 36 }]}
          columns={COLUMNS}
          getRowKey={(r) => r.id}
          onRowClick={handler}
        />,
      );

      const row = screen.getByTestId('data-table-row');
      expect(row).toHaveAttribute('role', 'button');
      expect(row).toHaveAttribute('tabIndex', '0');

      fireEvent.keyDown(row, { key: 'Enter' });
      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('renders non-interactive rows when onRowClick is omitted', () => {
      render(
        <DataTable<Person>
          rows={[{ id: 'a', name: 'Ada', age: 36 }]}
          columns={COLUMNS}
          getRowKey={(r) => r.id}
        />,
      );

      const row = screen.getByTestId('data-table-row');
      expect(row).not.toHaveAttribute('role');
      expect(row).not.toHaveAttribute('tabIndex');
    });
  });
});
