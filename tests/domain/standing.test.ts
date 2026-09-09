import { describe, it, expect } from 'vitest';
import { deriveRentCycleStatus, type RentEventStatus } from '@/lib/domain/rent-cycle';
import {
  deriveTenantStanding,
  standingLabel,
  standingNarrative,
  type TenantStanding,
} from '@/lib/domain/standing';

describe('standing', () => {
  describe('deriveTenantStanding', () => {
    it('should be good when there is no current cycle', () => {
      expect(deriveTenantStanding(null)).toBe('good');
    });

    it('should be good when the cycle is paid', () => {
      const cycle = deriveRentCycleStatus({
        status: 'paid',
        dueDate: '2026-06-01',
        amountDueCents: 2000_00,
        amountPaidCents: 2000_00,
        todayIso: '2026-06-12',
      });
      expect(deriveTenantStanding(cycle)).toBe('good');
    });

    it('should be due when the cycle is due but not late', () => {
      const cycle = deriveRentCycleStatus({
        status: 'pending',
        dueDate: '2026-06-15',
        amountDueCents: 2000_00,
        amountPaidCents: 0,
        todayIso: '2026-06-12',
      });
      expect(deriveTenantStanding(cycle)).toBe('due');
    });

    it('should be behind when the cycle is late (the audit case)', () => {
      const cycle = deriveRentCycleStatus({
        status: 'pending',
        dueDate: '2026-06-01',
        amountDueCents: 2000_00,
        amountPaidCents: 0,
        todayIso: '2026-06-12',
      });
      expect(deriveTenantStanding(cycle)).toBe('behind');
    });

    it('should be on_plan when the cycle is on a payment plan', () => {
      const cycle = deriveRentCycleStatus({
        status: 'plan_agreed',
        dueDate: '2026-06-01',
        amountDueCents: 2000_00,
        amountPaidCents: 500_00,
        todayIso: '2026-06-12',
      });
      expect(deriveTenantStanding(cycle)).toBe('on_plan');
    });

    it('should be escalated when the cycle is escalated', () => {
      const cycle = deriveRentCycleStatus({
        status: 'escalated',
        dueDate: null,
        amountDueCents: 2000_00,
        amountPaidCents: 0,
        todayIso: '2026-06-12',
      });
      expect(deriveTenantStanding(cycle)).toBe('escalated');
    });

    it('should never claim good for an unknown cycle with a balance', () => {
      const cycle = deriveRentCycleStatus({
        status: 'bogus' as RentEventStatus,
        dueDate: null,
        amountDueCents: 100_00,
        amountPaidCents: 0,
        todayIso: '2026-06-12',
      });
      expect(deriveTenantStanding(cycle)).not.toBe('good');
    });
  });

  describe('standingLabel', () => {
    it('should map each standing to its chip label', () => {
      const cases: Array<[TenantStanding, string]> = [
        ['good', 'Current'],
        ['due', 'Due'],
        ['behind', 'Behind'],
        ['on_plan', 'On plan'],
        ['escalated', 'Escalated'],
      ];
      for (const [standing, expected] of cases) {
        expect(standingLabel(standing)).toBe(expected);
      }
    });
  });

  describe('standingNarrative', () => {
    it('should say good standing only for good', () => {
      const narrative = standingNarrative('good', 'Sam', 0, 0);
      expect(narrative).toContain('good standing');
      expect(narrative).toContain('rent is current');
    });

    it('should never say good standing or rent is current for the audit case', () => {
      // Vaibhav: $2,000 unpaid, 11 days past due — standing is behind.
      const narrative = standingNarrative('behind', 'Vaibhav', 2000_00, 11);

      expect(narrative).not.toContain('good standing');
      expect(narrative).not.toContain('rent is current');
      expect(narrative).toContain('Vaibhav');
      expect(narrative).toContain('$2,000');
      expect(narrative).toContain('11 days');
    });

    it('should use singular day grammar for one day late', () => {
      const narrative = standingNarrative('behind', 'Sam', 1500_00, 1);
      expect(narrative).toContain('1 day');
      expect(narrative).not.toContain('1 days');
    });

    it('should state the balance as whole dollars for due', () => {
      const narrative = standingNarrative('due', 'Sam', 1450_00, 0);
      expect(narrative).toContain('$1,450');
      expect(narrative).not.toContain('good standing');
    });

    it('should state the balance for on_plan without calling it late', () => {
      const narrative = standingNarrative('on_plan', 'Sam', 800_00, 0);
      expect(narrative).toContain('$800');
      expect(narrative).toContain('payment plan');
      expect(narrative.toLowerCase()).not.toContain('late');
    });

    it('should state the balance for escalated', () => {
      const narrative = standingNarrative('escalated', 'Sam', 2000_00, 11);
      expect(narrative).toContain('$2,000');
      expect(narrative).toContain('escalated');
      expect(narrative).not.toContain('good standing');
    });
  });

  describe('single source of truth', () => {
    it('should keep the chip and the narrative in agreement for the audit case', () => {
      // Arrange — one derived value drives both surfaces.
      const cycle = deriveRentCycleStatus({
        status: 'pending',
        dueDate: '2026-06-01',
        amountDueCents: 2000_00,
        amountPaidCents: 0,
        todayIso: '2026-06-12',
      });
      const standing = deriveTenantStanding(cycle);

      // Act
      const chip = standingLabel(standing);
      const note = standingNarrative(standing, 'Vaibhav', cycle.balanceCents, cycle.daysLate);

      // Assert — chip says Behind, note never contradicts it.
      expect(chip).toBe('Behind');
      expect(note).not.toContain('good standing');
      expect(note).not.toContain('rent is current');
    });
  });
});
