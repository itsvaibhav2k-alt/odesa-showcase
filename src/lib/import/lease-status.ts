/**
 * Map free-text lease-status strings (from CSV exports) onto the
 * canonical `lease_status` enum used by Odesa's `leases` table.
 *
 * Enum values: 'active' | 'pending' | 'expired' | 'terminated'.
 *
 * Defaults to 'active' so a missing column doesn't reject the row.
 */

import type { LeaseDraft } from './types';

export function normalizeLeaseStatus(raw: string): LeaseDraft['status'] {
  const lower = raw.trim().toLowerCase();
  switch (lower) {
    case 'active':
    case 'current':
      return 'active';
    case 'pending':
    case 'draft':
    case 'future':
      return 'pending';
    case 'expired':
    case 'ended':
    case 'past':
    case 'completed':
      return 'expired';
    case 'terminated':
    case 'cancelled':
    case 'canceled':
    case 'evicted':
      return 'terminated';
    default:
      return 'active';
  }
}
