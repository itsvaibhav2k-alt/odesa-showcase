/**
 * Maintenance tab for `/properties/[id]` (Wave 8).
 *
 * Server component. Queries `listMaintenanceTicketsForProperty` and
 * groups the rows by status into three sections in fixed order:
 *
 *   1. Open
 *   2. In progress
 *   3. Resolved
 *
 * `cancelled` rows are intentionally dropped from the main view — the
 * Wave 8 playbook calls them out as optional/collapsed. Empty state
 * renders when there is no work at all on the property.
 *
 * NOTE: `maintenance_tickets` has no FK to `appliances` (only `unit_id`),
 * so we surface unit context only.
 */

import * as React from 'react';

import { DataTable, type DataTableColumn } from '@/components/ui/data-table';
import { StatusChip, type StatusChipTone } from '@/components/shared/status-chip';
import {
  listMaintenanceTicketsForProperty,
  type MaintenanceTicketRow,
} from '@/lib/properties/queries';
import type { VendorLifecycleChip } from '@/lib/work-orders/vendor-lifecycle';
import { formatRelativeTime } from '@/lib/utils/relative-time';

import { MaintenanceStatusPill } from './status-pill';
import { InlinePriorityEditor } from './inline-priority-editor';

/** Honest lifecycle chip tone → StatusChip palette tone (matches vendor WO list). */
const CHIP_TONE_TO_STATUSCHIP: Record<VendorLifecycleChip['tone'], StatusChipTone> = {
  good: 'green',
  warn: 'amber-soft',
  clay: 'clay',
  neutral: 'neutral-gold',
};

export interface MaintenanceTabProps {
  organizationId: string;
  propertyId: string;
}

const VISIBLE_STATUSES: ReadonlyArray<MaintenanceTicketRow['status']> = [
  'open',
  'in_progress',
  'resolved',
];

const SECTION_LABELS: Record<MaintenanceTicketRow['status'], string> = {
  open: 'Open',
  in_progress: 'In progress',
  resolved: 'Resolved',
  cancelled: 'Cancelled',
};

export async function MaintenanceTab({
  organizationId,
  propertyId,
}: MaintenanceTabProps): Promise<React.ReactElement> {
  const tickets = await listMaintenanceTicketsForProperty(
    organizationId,
    propertyId,
  );

  if (tickets.length === 0) {
    return (
      <div
        data-testid='maintenance-tab-empty'
        className='rounded-md border border-[var(--ink-200)] bg-[var(--paper-0)] px-8 py-9 text-sm leading-relaxed text-[var(--ink-500)]'
      >
        No maintenance tickets yet. Odesa creates them automatically when a
        tenant reports an issue in chat.
      </div>
    );
  }

  const buckets = groupByStatus(tickets);

  return (
    <div
      data-testid='maintenance-tab'
      style={{ display: 'flex', flexDirection: 'column', gap: '32px' }}
    >
      {VISIBLE_STATUSES.map((status) => {
        const rows = buckets[status] ?? [];
        if (rows.length === 0) return null;
        return (
          <MaintenanceSection key={status} status={status} rows={rows} />
        );
      })}
    </div>
  );
}

function MaintenanceSection({
  status,
  rows,
}: {
  status: MaintenanceTicketRow['status'];
  rows: MaintenanceTicketRow[];
}): React.ReactElement {
  return (
    <section
      data-testid={`maintenance-section-${status}`}
      data-row-count={rows.length}
      style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}
    >
      <header
        style={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
        }}
      >
        <h2
          className='font-serif-display'
          style={{ fontSize: '18px', color: 'var(--ink-900)', margin: 0 }}
        >
          {SECTION_LABELS[status]}
        </h2>
        <span
          className='meta-label'
          data-testid={`maintenance-section-${status}-count`}
        >
          {rows.length} {rows.length === 1 ? 'ticket' : 'tickets'}
        </span>
      </header>
      <DataTable<MaintenanceTicketRow>
        rows={rows}
        columns={MAINTENANCE_COLUMNS}
        getRowKey={(r) => r.id}
        data-testid={`maintenance-table-${status}`}
      />
    </section>
  );
}

function groupByStatus(
  rows: MaintenanceTicketRow[],
): Record<MaintenanceTicketRow['status'], MaintenanceTicketRow[]> {
  const out: Record<MaintenanceTicketRow['status'], MaintenanceTicketRow[]> = {
    open: [],
    in_progress: [],
    resolved: [],
    cancelled: [],
  };
  for (const row of rows) out[row.status].push(row);
  return out;
}

const MAINTENANCE_COLUMNS: ReadonlyArray<DataTableColumn<MaintenanceTicketRow>> = [
  {
    key: 'summary',
    header: 'Summary',
    render: (row) => (
      <span style={{ color: 'var(--ink-900)' }}>{row.summary}</span>
    ),
  },
  {
    key: 'unitLabel',
    header: 'Unit',
    render: (row) => row.unitLabel ?? '—',
  },
  {
    key: 'severity',
    header: 'Priority',
    render: (row) => <InlinePriorityEditor woId={row.id} urgency={row.urgency} />,
  },
  {
    key: 'status',
    header: 'Status',
    render: (row) => (
      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '6px',
          flexWrap: 'wrap',
        }}
      >
        <MaintenanceStatusPill status={row.status} />
        {row.vendorChip ? (
          <StatusChip
            tone={CHIP_TONE_TO_STATUSCHIP[row.vendorChip.tone]}
            label={row.vendorChip.label}
          />
        ) : null}
      </span>
    ),
  },
  {
    key: 'createdAt',
    header: 'Created',
    render: (row) => formatRelativeTime(row.createdAt),
  },
  {
    key: 'reportedBy',
    header: 'Reported by',
    render: (row) => row.reportedBy ?? '—',
  },
];
