'use client';

/**
 * UnitsTable — the Units tab content on `/properties/[id]`.
 *
 * Renders one row per unit with: label, tenant, rent, status pill,
 * last payment date, and an open-maintenance count badge. Row click
 * merges `room=units` + `unit=<id>` into the existing search params and
 * `router.push`es (no scroll) so the parent server component re-renders
 * and opens the unit drawer. Push (not replace) lets Back close the
 * drawer; cloning the params keeps `?room=units` instead of dropping it.
 *
 * Client component because it needs `useRouter` for URL state.
 */

import { useRouter, useSearchParams } from 'next/navigation';
import * as React from 'react';

import type { UnitTableRow, UnitTableStatus } from '@/lib/properties/queries';
import { Badge } from '@/components/ui/badge';
import { DataTable, type DataTableColumn } from '@/components/ui/data-table';

export interface UnitsTableProps {
  propertyId: string;
  units: ReadonlyArray<UnitTableRow>;
}

const DASH = '—';

export function UnitsTable({
  propertyId,
  units,
}: UnitsTableProps): React.ReactElement {
  const router = useRouter();
  const searchParams = useSearchParams();

  const columns = React.useMemo<DataTableColumn<UnitTableRow>[]>(
    () => [
      {
        key: 'label',
        header: 'Unit',
        render: (row) => (
          <span
            data-testid={`units-table-row-${row.id}-label`}
            className='font-medium tabular-nums'
          >
            {row.label}
          </span>
        ),
      },
      {
        key: 'tenantName',
        header: 'Tenant',
        render: (row) =>
          row.tenantName ? (
            row.tenantName
          ) : (
            <span className='text-[var(--ink-400)]'>{DASH}</span>
          ),
      },
      {
        key: 'rentAmountCents',
        header: 'Rent',
        align: 'right',
        render: (row) =>
          row.rentAmountCents != null ? (
            <span className='tabular-nums'>{formatRent(row.rentAmountCents)}</span>
          ) : (
            <span className='text-[var(--ink-400)]'>{DASH}</span>
          ),
      },
      {
        key: 'status',
        header: 'Status',
        render: (row) => <StatusPill status={row.status} />,
      },
      {
        key: 'lastPaymentDate',
        header: 'Last payment',
        render: (row) =>
          row.lastPaymentDate ? (
            <span className='tabular-nums text-[var(--ink-700)]'>
              {formatPaymentDate(row.lastPaymentDate)}
            </span>
          ) : (
            <span className='text-[var(--ink-400)]'>{DASH}</span>
          ),
      },
      {
        key: 'openMaintCount',
        header: 'Open maint.',
        align: 'right',
        render: (row) =>
          row.openMaintCount > 0 ? (
            <Badge
              data-testid={`units-table-row-${row.id}-maint`}
              variant='destructive'
            >
              {row.openMaintCount}
            </Badge>
          ) : (
            <span className='text-[var(--ink-400)]'>{DASH}</span>
          ),
      },
    ],
    [],
  );

  return (
    <DataTable<UnitTableRow>
      data-testid='units-table'
      rows={units}
      columns={columns}
      getRowKey={(row) => row.id}
      onRowClick={(row) => {
        // Clone the current params so we never drop `?room=units` (a bare
        // `?unit=` would). Set both keys, then push so Back closes the unit
        // drawer; `scroll: false` avoids bouncing to the top when it opens.
        const params = new URLSearchParams(searchParams.toString());
        params.set('room', 'units');
        params.set('unit', row.id);
        router.push(`?${params.toString()}`, { scroll: false });
      }}
      emptyState={
        <div data-testid='units-table-empty'>
          No units yet. Add one from onboarding to populate this property.
          <span className='sr-only' data-property-id={propertyId} />
        </div>
      }
    />
  );
}

interface StatusPillProps {
  status: UnitTableStatus;
}

function StatusPill({ status }: StatusPillProps): React.ReactElement {
  const { label, variant } = STATUS_META[status];
  return (
    <Badge data-testid={`units-table-status-${status}`} variant={variant}>
      {label}
    </Badge>
  );
}

const STATUS_META: Record<
  UnitTableStatus,
  { label: string; variant: 'default' | 'secondary' | 'outline' | 'destructive' }
> = {
  occupied: { label: 'Occupied', variant: 'secondary' },
  vacant: { label: 'Vacant', variant: 'outline' },
  notice: { label: 'Notice', variant: 'destructive' },
  pending: { label: 'Lease pending', variant: 'default' },
};

function formatRent(cents: number): string {
  const dollars = Math.round(cents) / 100;
  return `$${Math.round(dollars).toLocaleString('en-US')}/mo`;
}

function formatPaymentDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
}
