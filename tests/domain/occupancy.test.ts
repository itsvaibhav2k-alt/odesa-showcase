import { describe, it, expect } from 'vitest';
import {
  deriveLeaseStatus,
  deriveUnitOccupancyStatus,
  type OccupancyLeaseInput,
} from '@/lib/domain/occupancy';

const TODAY = '2026-06-12';

function lease(overrides: Partial<OccupancyLeaseInput>): OccupancyLeaseInput {
  return { status: 'active', endDate: null, ...overrides };
}

describe('occupancy', () => {
  describe('deriveLeaseStatus', () => {
    it('should be active for an active lease with no end date', () => {
      expect(deriveLeaseStatus(lease({ endDate: null }), TODAY)).toBe('active');
    });

    it('should be active for an active lease ending today', () => {
      expect(deriveLeaseStatus(lease({ endDate: TODAY }), TODAY)).toBe('active');
    });

    it('should be active for an active lease ending in the future', () => {
      expect(deriveLeaseStatus(lease({ endDate: '2026-12-31' }), TODAY)).toBe('active');
    });

    it('should be active_past_end for an active lease whose end date has passed', () => {
      expect(deriveLeaseStatus(lease({ endDate: '2026-06-01' }), TODAY)).toBe('active_past_end');
    });

    it('should pass through pending, expired, and terminated', () => {
      expect(deriveLeaseStatus(lease({ status: 'pending' }), TODAY)).toBe('pending');
      expect(deriveLeaseStatus(lease({ status: 'expired' }), TODAY)).toBe('expired');
      expect(deriveLeaseStatus(lease({ status: 'terminated' }), TODAY)).toBe('terminated');
    });
  });

  describe('deriveUnitOccupancyStatus', () => {
    it('should be occupied for an active lease with end date in the future', () => {
      const result = deriveUnitOccupancyStatus([lease({ endDate: '2026-12-31' })], TODAY);
      expect(result).toBe('occupied');
    });

    it('should be occupied for an active lease with no end date', () => {
      const result = deriveUnitOccupancyStatus([lease({ endDate: null })], TODAY);
      expect(result).toBe('occupied');
    });

    it('should be occupied for an active lease ending today', () => {
      const result = deriveUnitOccupancyStatus([lease({ endDate: TODAY })], TODAY);
      expect(result).toBe('occupied');
    });

    it('should be active_past_end for an active lease past its end date, not vacant', () => {
      // Still a tenant relationship — never report this unit as vacant.
      const result = deriveUnitOccupancyStatus([lease({ endDate: '2026-06-01' })], TODAY);
      expect(result).toBe('active_past_end');
    });

    it('should be pending_move_in for a pending lease only, not vacant or occupied', () => {
      const result = deriveUnitOccupancyStatus([lease({ status: 'pending' })], TODAY);
      expect(result).toBe('pending_move_in');
    });

    it('should be vacant with no leases at all', () => {
      expect(deriveUnitOccupancyStatus([], TODAY)).toBe('vacant');
    });

    it('should be vacant when only expired or terminated leases exist', () => {
      const result = deriveUnitOccupancyStatus(
        [
          lease({ status: 'expired', endDate: '2025-12-31' }),
          lease({ status: 'terminated', endDate: '2026-01-31' }),
        ],
        TODAY,
      );
      expect(result).toBe('vacant');
    });

    it('should be needs_review for multiple active leases, never silently pick one', () => {
      const result = deriveUnitOccupancyStatus(
        [lease({ endDate: '2026-12-31' }), lease({ endDate: null })],
        TODAY,
      );
      expect(result).toBe('needs_review');
    });

    it('should be needs_review for a conflicting active and pending lease', () => {
      const result = deriveUnitOccupancyStatus(
        [lease({ endDate: '2026-12-31' }), lease({ status: 'pending' })],
        TODAY,
      );
      expect(result).toBe('needs_review');
    });

    it('should be needs_review for an active_past_end lease alongside a pending lease', () => {
      const result = deriveUnitOccupancyStatus(
        [lease({ endDate: '2026-06-01' }), lease({ status: 'pending' })],
        TODAY,
      );
      expect(result).toBe('needs_review');
    });

    it('should ignore expired and terminated leases when deciding occupancy', () => {
      const result = deriveUnitOccupancyStatus(
        [
          lease({ status: 'expired', endDate: '2025-12-31' }),
          lease({ endDate: '2026-12-31' }),
        ],
        TODAY,
      );
      expect(result).toBe('occupied');
    });
  });
});
