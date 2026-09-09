/**
 * Case-meta strip cell selector.
 *
 * Given a `CaseContext` + the current queue-status kind, returns the
 * ordered list of mono-label / tabular-value cells the strip should
 * render. Two flavours:
 *
 *   - Owner-review / rent / general:
 *       `Unit`, `Rent`, `Lease`, `Tenant since`, `On-time`.
 *   - Vendor-escalated:
 *       `Work order`, `Vendor`, `SLA breach`, `Backup`, `Tenant tone`.
 *
 * Cells whose underlying data is missing are filtered out — no `—`
 * placeholders. The strip collapses gracefully to 4 or 3 cells.
 *
 * The selector is pure (no React) so it's table-tested and reusable
 * from a server-side preview pass.
 */
import type {
  CaseContext,
  PaymentSummary,
  WorkOrderSummary,
} from '@/lib/inbox/case-context';

export type CaseMetaFlavour = 'general' | 'vendor';

export type CaseMetaStatus =
  | 'review'
  | 'draft'
  | 'escalated'
  | 'handled'
  | 'watching';

export interface CaseMetaCell {
  /** Stable id for React keys + e2e hooks. */
  id: string;
  /** Mono uppercase label, e.g. `UNIT`. */
  label: string;
  /** Tabular-numeral value, e.g. `$3,000 /mo`. */
  value: string;
}

const VENDOR_FLAVOUR_STATUSES: ReadonlySet<CaseMetaStatus> = new Set([
  'escalated',
]);

/**
 * Pick the flavour the strip should render. Vendor flavour fires only
 * for vendor-escalated rows that actually have a work-order; everything
 * else (including review/draft/handled) gets the general flavour.
 */
export function pickCaseMetaFlavour(
  ctx: { workOrder: WorkOrderSummary | null },
  status: CaseMetaStatus,
): CaseMetaFlavour {
  if (VENDOR_FLAVOUR_STATUSES.has(status) && ctx.workOrder) return 'vendor';
  return 'general';
}

/**
 * Build the list of cells for a case-meta strip.
 *
 * @param caseContext - The composed case context (always non-null per Wave 3).
 * @param status      - The queue-status kind (`review` | `draft` | `escalated` | `handled` | `watching`).
 * @param extras      - Optional cell sources the data layer doesn't own:
 *                      `unitLabel` (from the conversation row) and
 *                      `tenantSinceYear` (already computed in tenant context).
 * @returns Ordered, non-empty list of cells. Cells with no underlying
 *          data are filtered out so the strip collapses gracefully.
 */
export function caseMetaCells(
  caseContext: CaseContext,
  status: CaseMetaStatus,
  extras: {
    unitLabel?: string | null;
    propertyName?: string | null;
    tenantSinceYear?: number | null;
  } = {},
): CaseMetaCell[] {
  const flavour = pickCaseMetaFlavour(caseContext, status);

  if (flavour === 'vendor') {
    return vendorCells(caseContext.workOrder, caseContext.payments);
  }
  return generalCells(caseContext, extras);
}

// ---------------------------------------------------------------------------
// General flavour
// ---------------------------------------------------------------------------

function generalCells(
  caseContext: CaseContext,
  extras: {
    unitLabel?: string | null;
    propertyName?: string | null;
    tenantSinceYear?: number | null;
  },
): CaseMetaCell[] {
  const cells: CaseMetaCell[] = [];
  const { lease, payments } = caseContext;

  // Unit (from extras — the conversation row carries unit + property).
  const unitLabel = composeUnitLabel(extras.unitLabel, extras.propertyName);
  if (unitLabel) {
    cells.push({ id: 'unit', label: 'UNIT', value: unitLabel });
  }

  // Rent — formatted with tabular numerals.
  if (lease?.rentAmountCents != null && lease.rentAmountCents > 0) {
    cells.push({
      id: 'rent',
      label: 'RENT',
      value: formatRentPerMonth(lease.rentAmountCents),
    });
  }

  // Lease term.
  const leaseLabel = formatLeaseTerm(lease?.startDate, lease?.endDate);
  if (leaseLabel) {
    cells.push({ id: 'lease', label: 'LEASE', value: leaseLabel });
  }

  // Tenant since.
  if (extras.tenantSinceYear) {
    cells.push({
      id: 'tenant-since',
      label: 'TENANT SINCE',
      value: String(extras.tenantSinceYear),
    });
  }

  // On-time payment ratio.
  const onTime = formatOnTime(payments);
  if (onTime) {
    cells.push({ id: 'on-time', label: 'ON-TIME', value: onTime });
  }

  return cells;
}

// ---------------------------------------------------------------------------
// Vendor flavour
// ---------------------------------------------------------------------------

function vendorCells(
  workOrder: WorkOrderSummary | null,
  payments: PaymentSummary,
): CaseMetaCell[] {
  const cells: CaseMetaCell[] = [];

  if (!workOrder) return cells;

  // Work order — category + urgency.
  cells.push({
    id: 'work-order',
    label: 'WORK ORDER',
    value: composeWorkOrderLabel(workOrder),
  });

  // Vendor.
  if (workOrder.vendor?.name) {
    cells.push({
      id: 'vendor',
      label: 'VENDOR',
      value: workOrder.vendor.name,
    });
  }

  // SLA breach state.
  if (workOrder.slaState === 'breached') {
    cells.push({ id: 'sla', label: 'SLA', value: 'BREACHED' });
  } else if (workOrder.slaState === 'at_risk') {
    cells.push({ id: 'sla', label: 'SLA', value: 'AT RISK' });
  }

  // Backup vendor.
  if (workOrder.backupVendor?.name) {
    cells.push({
      id: 'backup',
      label: 'BACKUP',
      value: workOrder.backupVendor.name,
    });
  }

  // Tenant tone — surface pay history as a quick-glance trust signal.
  const tone = formatTenantTone(payments);
  if (tone) {
    cells.push({ id: 'tone', label: 'TENANT TONE', value: tone });
  }

  return cells;
}

// ---------------------------------------------------------------------------
// Formatters
// ---------------------------------------------------------------------------

function composeUnitLabel(
  unit: string | null | undefined,
  property: string | null | undefined,
): string | null {
  const u = (unit ?? '').trim();
  const p = (property ?? '').trim();
  if (!u && !p) return null;
  if (u && p) return `${u} · ${p}`;
  return u || p;
}

const RENT_FORMAT = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

function formatRentPerMonth(cents: number): string {
  const dollars = Math.round(cents / 100);
  return `${RENT_FORMAT.format(dollars)} /mo`;
}

function formatLeaseTerm(
  startDate: string | null | undefined,
  endDate: string | null | undefined,
): string | null {
  const startYear = parseYear(startDate);
  const endYear = parseYear(endDate);
  if (!startYear && !endYear) return null;
  if (startYear && endYear) return `${startYear}–${endYear}`;
  if (startYear) return `from ${startYear}`;
  return endYear ? `ends ${endYear}` : null;
}

function parseYear(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.getUTCFullYear();
}

function formatOnTime(payments: PaymentSummary): string | null {
  if (payments.totalRecent === 0) return null;
  return `${payments.onTimeCount}/${payments.totalRecent}`;
}

function composeWorkOrderLabel(wo: WorkOrderSummary): string {
  const category = capitalize(wo.category);
  if (wo.urgency === 'emergency') return `${category} · EMERGENCY`;
  if (wo.urgency === 'urgent') return `${category} · Urgent`;
  return category;
}

function capitalize(s: string): string {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function formatTenantTone(payments: PaymentSummary): string | null {
  if (payments.totalRecent === 0) return null;
  const ratio = payments.onTimeCount / payments.totalRecent;
  if (ratio >= 0.95) return 'Reliable';
  if (ratio >= 0.8) return 'Steady';
  if (ratio >= 0.5) return 'Wobbly';
  return 'Strained';
}
