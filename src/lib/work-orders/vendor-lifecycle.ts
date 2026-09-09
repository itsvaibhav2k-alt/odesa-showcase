/**
 * Pure, IO-free derivations for the work-order vendor lifecycle.
 *
 * Shared by the WO detail island, the property maintenance room, the vendor
 * work-order lists and the open-items reconciliation. Because it is pure it can
 * run on the server or the client and needs no mocking to test.
 *
 * The "Awaiting reply · Nh" chip is DISPLAY-ONLY: it derives an elapsed-hours
 * hint from `vendorAssignedAt`. The system never infers a `no_response` from a
 * timeout — that value only ever comes from an explicit operator action.
 */

import type { WorkOrderStatus, WorkOrderVendorResponse } from '@/types/database';

export type VendorLifecycleChip = {
  label: string;
  tone: 'good' | 'warn' | 'clay' | 'neutral';
};

/**
 * Hours a vendor has been assigned without a recorded response.
 *
 * @param vendorAssignedAt - ISO timestamp the vendor was assigned, or null.
 * @param nowMs - override for "now" (defaults to Date.now()); keeps this pure/testable.
 * @returns whole hours elapsed (>= 0), or null when there is no assign time.
 */
export function awaitingHours(
  vendorAssignedAt: string | null,
  nowMs: number = Date.now(),
): number | null {
  if (!vendorAssignedAt) {
    return null;
  }
  const assignedMs = Date.parse(vendorAssignedAt);
  if (Number.isNaN(assignedMs)) {
    return null;
  }
  return Math.max(0, Math.floor((nowMs - assignedMs) / 3_600_000));
}

/**
 * Summarize the vendor half of a work order as a single honest chip.
 *
 * Returns null when there is nothing worth asserting (an open ticket with no
 * vendor yet). Terminal review/cancel states win over vendor-response state.
 *
 * @returns a chip, or null when no chip should render.
 */
export function deriveVendorChip(
  wo: {
    status: WorkOrderStatus;
    vendorId: string | null;
    vendorName: string | null;
    vendorResponse: WorkOrderVendorResponse | null;
    vendorAssignedAt: string | null;
    reviewedAt: string | null;
  },
  nowMs: number = Date.now(),
): VendorLifecycleChip | null {
  if (wo.status === 'cancelled') {
    return { label: 'Cancelled', tone: 'neutral' };
  }
  if (wo.status === 'completed') {
    return wo.reviewedAt
      ? { label: 'Approved', tone: 'good' }
      : { label: 'Needs owner review', tone: 'warn' };
  }

  // open / assigned / in_progress with no vendor yet -> nothing to assert.
  if (!wo.vendorId) {
    return null;
  }

  switch (wo.vendorResponse) {
    case 'accepted':
      return { label: 'Vendor accepted', tone: 'good' };
    case 'declined':
      return { label: 'Vendor declined — reassign', tone: 'clay' };
    case 'no_response':
      return { label: 'No response — reassign', tone: 'clay' };
    default:
      break;
  }

  // Vendor assigned, no response recorded. "Awaiting reply" is only honest
  // while still in the assigned state (not yet started).
  if (wo.status === 'assigned') {
    const hours = awaitingHours(wo.vendorAssignedAt, nowMs);
    return {
      label: hours === null ? 'Awaiting reply' : `Awaiting reply · ${hours}h`,
      tone: 'warn',
    };
  }

  return null;
}

// self-check (eyeball, no framework — matches the contract's chip table):
//   {status:'open', vendorId:null, ...}                         -> null
//   {status:'assigned', vendorId:'v', vendorResponse:null,
//     vendorAssignedAt:<3h ago>}                                -> 'Awaiting reply · 3h' / warn
//   {..., vendorResponse:'accepted'}                            -> 'Vendor accepted' / good
//   {..., vendorResponse:'declined'}                            -> 'Vendor declined — reassign' / clay
//   {..., vendorResponse:'no_response'}                         -> 'No response — reassign' / clay
//   {status:'completed', reviewedAt:null}                       -> 'Needs owner review' / warn
//   {status:'completed', reviewedAt:<ts>}                       -> 'Approved' / good
//   {status:'cancelled'}                                        -> 'Cancelled' / neutral
//   awaitingHours(null) -> null; awaitingHours(<1h ago>) -> 1
