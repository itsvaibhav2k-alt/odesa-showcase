'use client';

/**
 * Preferred Vendors table — Settings section 2.
 *
 * Columns: Category / Name / Phone / Last Dispatched (meta) / Acceptance
 * rate (success-coloured bar). No modals — "add" expands an inline row
 * at the top; row click swaps the row into inline-edit mode; delete is
 * a two-click confirm on a trash icon in the last column.
 *
 * Optimistic updates:
 *  - Create/update: we add/replace the row in local state right away,
 *    then call the server action. On success we replace with the real
 *    row (keeps ids / any server-computed fields fresh). On failure we
 *    revert and surface the error via the per-row save badge.
 *  - Delete: we remove the row immediately; on failure we re-insert it.
 *
 * State locality: every action's save-state lives on the row so the
 * "Saved" badge is visibly attached to the row the landlord just edited
 * rather than appearing somewhere else on screen.
 */

import { useMemo, useState, useTransition } from 'react';
import { Plus, Trash2 } from 'lucide-react';

import {
  createVendor,
  deleteVendor,
  updateVendor,
} from '@/app/(dashboard)/settings/actions';
import { categoryLabel } from '@/lib/validation/vendor';
import type { WorkOrderCategory } from '@/types/database';
import {
  OptimisticSaveBadge,
  type OptimisticSaveState,
} from './optimistic-save-badge';
import {
  VendorForm,
  type VendorFormPayload,
} from './vendor-form';

export interface VendorTableRow {
  id: string;
  name: string;
  category: WorkOrderCategory;
  phoneE164: string | null;
  acceptanceRate: number;
  lastDispatchedAt: string | null;
}

interface VendorsTableProps {
  initialRows: VendorTableRow[];
}

type RowState = OptimisticSaveState;

function formatLastDispatched(iso: string | null): string {
  if (!iso) return 'Never dispatched';
  const d = new Date(iso);
  if (Number.isNaN(d.valueOf())) return '—';
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const day = 24 * 60 * 60 * 1000;
  if (diffMs < day) return 'Today';
  if (diffMs < 2 * day) return 'Yesterday';
  const days = Math.floor(diffMs / day);
  if (days < 30) return `${days} days ago`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function formatAcceptanceRate(rate: number): string {
  const pct = Math.round(rate * 100);
  return `${pct}%`;
}

export function VendorsTable({ initialRows }: VendorsTableProps) {
  const [rows, setRows] = useState<VendorTableRow[]>(initialRows);
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [rowState, setRowState] = useState<Record<string, RowState>>({});
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  // Sort rows alphabetically for stable ordering after optimistic inserts.
  const sortedRows = useMemo(
    () => [...rows].sort((a, b) => a.name.localeCompare(b.name)),
    [rows],
  );

  function setStateFor(id: string, next: RowState) {
    setRowState((prev) => ({ ...prev, [id]: next }));
  }

  function clearSavedAfterDelay(id: string) {
    // Mirror the 2s hold the badge implements internally, then clear
    // the map entry so the next row render doesn't replay the fade.
    setTimeout(() => {
      setRowState((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
    }, 2_200);
  }

  async function handleCreate(payload: VendorFormPayload) {
    // Optimistically insert a temp row so the badge has somewhere to live.
    const tempId = `temp-${Date.now()}`;
    const optimistic: VendorTableRow = {
      id: tempId,
      name: payload.name,
      category: payload.category,
      phoneE164: payload.phoneE164 === '' ? null : payload.phoneE164,
      acceptanceRate: 0,
      lastDispatchedAt: null,
    };
    setRows((prev) => [...prev, optimistic]);
    setStateFor(tempId, 'saving');
    setAdding(false);

    startTransition(async () => {
      const res = await createVendor({
        name: payload.name,
        category: payload.category,
        phoneE164: payload.phoneE164 || null,
      });

      if (!res.success) {
        // Leave the temp row visible in error state; landlord can retry.
        setStateFor(tempId, 'error');
        return;
      }

      // Swap the temp row for the server row.
      setRows((prev) =>
        prev.map((r) =>
          r.id === tempId
            ? {
                id: res.data.id,
                name: res.data.name,
                category: res.data.category,
                phoneE164: res.data.phoneE164,
                acceptanceRate: res.data.acceptanceRate,
                lastDispatchedAt: null,
              }
            : r,
        ),
      );
      setRowState((prev) => {
        const next = { ...prev };
        delete next[tempId];
        next[res.data.id] = 'saved';
        return next;
      });
      clearSavedAfterDelay(res.data.id);
    });
  }

  async function handleUpdate(
    existingId: string,
    payload: VendorFormPayload,
  ) {
    // Snapshot the old row so we can revert on error.
    const before = rows.find((r) => r.id === existingId);
    if (!before) return;

    const optimistic: VendorTableRow = {
      ...before,
      name: payload.name,
      category: payload.category,
      phoneE164: payload.phoneE164 === '' ? null : payload.phoneE164,
    };
    setRows((prev) => prev.map((r) => (r.id === existingId ? optimistic : r)));
    setStateFor(existingId, 'saving');
    setEditingId(null);

    startTransition(async () => {
      const res = await updateVendor({
        id: existingId,
        name: payload.name,
        category: payload.category,
        phoneE164: payload.phoneE164 || null,
      });

      if (!res.success) {
        // Revert.
        setRows((prev) => prev.map((r) => (r.id === existingId ? before : r)));
        setStateFor(existingId, 'error');
        return;
      }

      setStateFor(existingId, 'saved');
      clearSavedAfterDelay(existingId);
    });
  }

  async function handleDelete(id: string) {
    const before = rows.find((r) => r.id === id);
    if (!before) return;

    setRows((prev) => prev.filter((r) => r.id !== id));
    setDeleteConfirmId(null);
    setStateFor(id, 'saving');

    startTransition(async () => {
      const res = await deleteVendor({ id });
      if (!res.success) {
        setRows((prev) => [...prev, before]);
        setStateFor(id, 'error');
        return;
      }
      setRowState((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
    });
  }

  return (
    <section
      data-testid="settings-vendors-section"
      className="flex flex-col gap-4"
    >
      <div className="flex items-center justify-between">
        <p
          className="meta-label"
          style={{ color: 'var(--ink-500)' }}
        >
          {sortedRows.length} vendor{sortedRows.length === 1 ? '' : 's'}
        </p>
        {!adding ? (
          <button
            type="button"
            data-testid="settings-vendor-add-button"
            onClick={() => setAdding(true)}
            className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium"
            style={{
              background: 'transparent',
              color: 'var(--navy-700)',
              border: '1px solid var(--navy-700)',
            }}
          >
            <Plus className="size-4" />
            Add vendor
          </button>
        ) : null}
      </div>

      <div
        data-testid="settings-vendors-table"
        className="flex flex-col"
        style={{
          background: 'var(--paper-0)',
          border: '1px solid var(--ink-200)',
          borderRadius: 'var(--radius-lg-odesa)',
          overflow: 'hidden',
        }}
      >
        {/* Header row */}
        <div
          className="grid items-center"
          style={{
            gridTemplateColumns: '160px 1fr 180px 130px 130px 40px',
            padding: '12px 20px',
            background: 'var(--paper-50)',
            borderBottom: '1px solid var(--ink-200)',
          }}
        >
          <span className="meta-label" style={{ color: 'var(--ink-500)' }}>
            Category
          </span>
          <span className="meta-label" style={{ color: 'var(--ink-500)' }}>
            Name
          </span>
          <span className="meta-label" style={{ color: 'var(--ink-500)' }}>
            Phone
          </span>
          <span className="meta-label" style={{ color: 'var(--ink-500)' }}>
            Last Dispatched
          </span>
          <span className="meta-label" style={{ color: 'var(--ink-500)' }}>
            Acceptance
          </span>
          <span aria-hidden />
        </div>

        {/* Inline-add row */}
        {adding ? (
          <div
            data-testid="settings-vendor-add-row"
            style={{
              padding: '12px 20px',
              borderBottom: '1px solid var(--ink-200)',
              background: 'var(--paper-50)',
            }}
          >
            <VendorForm
              initial={null}
              testId="settings-vendor-new"
              onSubmit={handleCreate}
              onCancel={() => setAdding(false)}
            />
          </div>
        ) : null}

        {/* Rows */}
        {sortedRows.length === 0 && !adding ? (
          <div
            data-testid="settings-vendors-empty"
            style={{
              padding: '32px 20px',
              textAlign: 'center',
              color: 'var(--ink-500)',
              fontSize: '14px',
            }}
          >
            Add your first preferred vendor to speed up maintenance dispatch.
          </div>
        ) : (
          sortedRows.map((row) => {
            const saveState = rowState[row.id] ?? 'idle';
            const isEditing = editingId === row.id;
            const isDeleteConfirm = deleteConfirmId === row.id;

            // Arm the 2s delete confirm — if the landlord doesn't click
            // a second time, the row quietly reverts.
            if (isDeleteConfirm) {
              setTimeout(() => {
                setDeleteConfirmId((cur) => (cur === row.id ? null : cur));
              }, 2_000);
            }

            if (isEditing) {
              return (
                <div
                  key={row.id}
                  data-testid={`settings-vendor-row-${row.id}`}
                  data-state="editing"
                  style={{
                    padding: '12px 20px',
                    borderBottom: '1px solid var(--ink-200)',
                  }}
                >
                  <VendorForm
                    initial={{
                      name: row.name,
                      category: row.category,
                      phoneE164: row.phoneE164 ?? '',
                    }}
                    testId={`settings-vendor-edit-${row.id}`}
                    onSubmit={(payload) => handleUpdate(row.id, payload)}
                    onCancel={() => setEditingId(null)}
                  />
                </div>
              );
            }

            return (
              <div
                key={row.id}
                data-testid={`settings-vendor-row-${row.id}`}
                data-state="display"
                onClick={(e) => {
                  // Ignore clicks on the trash icon — its own handler runs.
                  const target = e.target as HTMLElement;
                  if (target.closest('[data-testid^="settings-vendor-delete"]')) {
                    return;
                  }
                  if (!row.id.startsWith('temp-')) {
                    setEditingId(row.id);
                  }
                }}
                className="grid items-center transition-row-hover cursor-pointer"
                style={{
                  gridTemplateColumns:
                    '160px 1fr 180px 130px 130px 40px',
                  padding: '14px 20px',
                  borderBottom: '1px solid var(--ink-200)',
                  fontSize: '14px',
                  color: 'var(--ink-800)',
                }}
              >
                <span
                  data-testid={`settings-vendor-category-${row.id}`}
                  style={{
                    fontSize: '13px',
                    color: 'var(--ink-700)',
                  }}
                >
                  {categoryLabel(row.category)}
                </span>
                <span
                  data-testid={`settings-vendor-name-${row.id}`}
                  className="flex items-center gap-2"
                >
                  {row.name}
                  <OptimisticSaveBadge
                    state={saveState}
                    testId={`vendor-${row.id}`}
                    onRetry={() => setEditingId(row.id)}
                  />
                </span>
                <span
                  data-testid={`settings-vendor-phone-${row.id}`}
                  className="tabular-nums"
                  style={{
                    fontFamily:
                      "var(--font-mono-metrics), 'JetBrains Mono', monospace",
                    fontSize: '13px',
                    color: 'var(--ink-700)',
                  }}
                >
                  {row.phoneE164 ?? '—'}
                </span>
                <span
                  data-testid={`settings-vendor-last-${row.id}`}
                  className="meta-label"
                  style={{
                    color: 'var(--ink-500)',
                    textTransform: 'none',
                    letterSpacing: '0.02em',
                    fontSize: '12px',
                  }}
                >
                  {formatLastDispatched(row.lastDispatchedAt)}
                </span>
                <span
                  data-testid={`settings-vendor-acceptance-${row.id}`}
                  className="flex items-center gap-2"
                >
                  <span
                    aria-hidden
                    className="h-1.5 flex-1 rounded-full"
                    style={{ background: 'var(--paper-300)' }}
                  >
                    <span
                      className="block h-full rounded-full"
                      style={{
                        width: `${Math.round(row.acceptanceRate * 100)}%`,
                        background: 'var(--success-600)',
                      }}
                    />
                  </span>
                  <span
                    className="tabular-nums"
                    style={{
                      fontFamily:
                        "var(--font-mono-metrics), 'JetBrains Mono', monospace",
                      fontSize: '12px',
                      color: 'var(--ink-700)',
                      minWidth: '32px',
                      textAlign: 'right',
                    }}
                  >
                    {formatAcceptanceRate(row.acceptanceRate)}
                  </span>
                </span>
                <button
                  type="button"
                  data-testid={
                    isDeleteConfirm
                      ? `settings-vendor-delete-confirm-${row.id}`
                      : `settings-vendor-delete-${row.id}`
                  }
                  onClick={(e) => {
                    e.stopPropagation();
                    if (row.id.startsWith('temp-')) return;
                    if (isDeleteConfirm) {
                      void handleDelete(row.id);
                    } else {
                      setDeleteConfirmId(row.id);
                    }
                  }}
                  className="inline-flex size-8 items-center justify-center rounded-md"
                  style={{
                    background: isDeleteConfirm
                      ? 'var(--error-600)'
                      : 'transparent',
                    color: isDeleteConfirm ? '#fff' : 'var(--ink-500)',
                  }}
                  aria-label={
                    isDeleteConfirm ? 'Click again to confirm delete' : 'Delete vendor'
                  }
                  title={
                    isDeleteConfirm ? 'Click again to confirm delete' : 'Delete vendor'
                  }
                >
                  <Trash2 className="size-4" />
                </button>
              </div>
            );
          })
        )}
      </div>
    </section>
  );
}
