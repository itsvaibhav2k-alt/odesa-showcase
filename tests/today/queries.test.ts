import { describe, it, expect } from 'vitest';
import { sumLateBalanceCents, type RentBalanceRow } from '@/lib/today/queries';

describe('queries', () => {
  describe('sumLateBalanceCents', () => {
    it('should sum (due - paid) across rows, converting dollars to cents', () => {
      // Arrange
      const rows: RentBalanceRow[] = [
        { amount_due: 1200, amount_paid: 500 },
        { amount_due: 800, amount_paid: 0 },
      ];

      // Act
      const total = sumLateBalanceCents(rows);

      // Assert — (700 + 800) dollars => 150000 cents
      expect(total).toBe(150_000);
    });

    it('should return 0 for no rows', () => {
      expect(sumLateBalanceCents([])).toBe(0);
    });

    it('should floor a per-row overpayment at zero', () => {
      const rows: RentBalanceRow[] = [
        { amount_due: 1000, amount_paid: 1200 }, // credit, contributes 0
        { amount_due: 500, amount_paid: 0 }, // 500 owed
      ];
      expect(sumLateBalanceCents(rows)).toBe(500_00);
    });

    it('should treat null amounts as zero', () => {
      const rows: RentBalanceRow[] = [
        { amount_due: 300, amount_paid: null },
        { amount_due: null, amount_paid: null },
      ];
      expect(sumLateBalanceCents(rows)).toBe(300_00);
    });

    it('should round fractional cents to the nearest cent', () => {
      const rows: RentBalanceRow[] = [{ amount_due: 10.005, amount_paid: 0 }];
      // 10.005 * 100 = 1000.49.. -> rounds to 1001 cents
      expect(sumLateBalanceCents(rows)).toBe(1001);
    });
  });
});
