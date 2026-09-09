/**
 * Generic data-table primitive used across the property detail tabs
 * (Units, Appliances, Vendors, Maintenance, Payments, etc.).
 *
 * Pure presentational. No hooks, no `'use client'` — renders cleanly
 * on the server. Interactivity (e.g. row click that pushes URL state)
 * lives in the client parent; this component just forwards the row
 * through `onRowClick`.
 *
 * Styling rules (per Wave 8 playbook):
 *   - design tokens from `globals.css` only (var(--paper-...), var(--ink-...))
 *   - no inline `style={{...}}`
 *   - zebra rows; hover affordance only when `onRowClick` is provided
 */

import * as React from 'react';

import { cn } from '@/lib/utils';

export type ColumnAlign = 'left' | 'right' | 'center';

export interface DataTableColumn<T> {
  /** Property key on T, or an arbitrary string identifier when `render` is used. */
  key: keyof T | string;
  header: string;
  /** Custom cell renderer; falls back to `String(row[key])` when omitted. */
  render?: (row: T) => React.ReactNode;
  align?: ColumnAlign;
  /** Optional fixed width passed through to <col>. e.g. '120px', '20%'. */
  width?: string;
}

export interface DataTableProps<T> {
  rows: ReadonlyArray<T>;
  columns: ReadonlyArray<DataTableColumn<T>>;
  /** Stable key extractor. Required so React reconciles row identity. */
  getRowKey: (row: T) => string;
  emptyState?: React.ReactNode;
  onRowClick?: (row: T) => void;
  /** Optional className applied to the outer wrapper. */
  className?: string;
  /** Optional test-id forwarded to the wrapper div. */
  'data-testid'?: string;
}

const ALIGN_CLASS: Record<ColumnAlign, string> = {
  left: 'text-left',
  right: 'text-right',
  center: 'text-center',
};

export function DataTable<T>({
  rows,
  columns,
  getRowKey,
  emptyState,
  onRowClick,
  className,
  'data-testid': dataTestId,
}: DataTableProps<T>) {
  if (rows.length === 0) {
    return (
      <div
        data-slot='data-table-empty'
        data-testid={dataTestId}
        className={cn(
          'rounded-md border border-[var(--paper-300)] bg-[var(--paper-0)] px-6 py-8',
          'text-sm leading-relaxed text-[var(--ink-500)]',
          className,
        )}
      >
        {emptyState ?? 'No data to display.'}
      </div>
    );
  }

  const interactive = typeof onRowClick === 'function';

  return (
    <div
      data-slot='data-table'
      data-testid={dataTestId}
      className={cn(
        'overflow-hidden rounded-md border border-[var(--paper-300)] bg-[var(--paper-0)]',
        className,
      )}
    >
      <table className='w-full border-collapse text-sm'>
        {columns.some((c) => c.width) && (
          <colgroup>
            {columns.map((col) => (
              <col
                key={String(col.key)}
                {...(col.width ? { style: { width: col.width } } : {})}
              />
            ))}
          </colgroup>
        )}
        <thead>
          <tr className='border-b border-[var(--paper-300)] bg-[var(--paper-100)]'>
            {columns.map((col) => (
              <th
                key={String(col.key)}
                scope='col'
                className={cn(
                  'px-4 py-2.5 text-xs font-medium uppercase tracking-wide text-[var(--ink-500)]',
                  ALIGN_CLASS[col.align ?? 'left'],
                )}
              >
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, idx) => {
            const zebra =
              idx % 2 === 1 ? 'bg-[var(--paper-50)]' : 'bg-[var(--paper-0)]';
            return (
              <tr
                key={getRowKey(row)}
                data-testid='data-table-row'
                onClick={interactive ? () => onRowClick(row) : undefined}
                onKeyDown={
                  interactive
                    ? (e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          onRowClick(row);
                        }
                      }
                    : undefined
                }
                tabIndex={interactive ? 0 : undefined}
                role={interactive ? 'button' : undefined}
                className={cn(
                  'border-b border-[var(--paper-200)] text-[var(--ink-700)]',
                  zebra,
                  interactive &&
                    'cursor-pointer transition-colors hover:bg-[var(--paper-200)] focus:bg-[var(--paper-200)] focus:outline-none',
                )}
              >
                {columns.map((col) => (
                  <td
                    key={String(col.key)}
                    className={cn(
                      'px-4 py-3 align-middle',
                      ALIGN_CLASS[col.align ?? 'left'],
                    )}
                  >
                    {col.render
                      ? col.render(row)
                      : renderDefaultCell(row, col.key)}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function renderDefaultCell<T>(row: T, key: keyof T | string): React.ReactNode {
  // String keys not present on T fall back to em-dash so type-mismatched
  // synthetic columns don't crash the row.
  const value = (row as Record<string, unknown>)[key as string];
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'string' || typeof value === 'number') return value;
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  return String(value);
}
