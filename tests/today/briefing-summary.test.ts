import { describe, it, expect } from 'vitest';
import {
  synthesizeBriefing,
  synthesizeBriefingHeader,
  type BriefingInput,
} from '@/lib/today/briefing-summary';
import type { UrgentItem } from '@/lib/today/queries';

const CHECKS = 'Odesa checked rent, work orders, tenant inbox, and lease deadlines.';

function baseInput(overrides: Partial<BriefingInput> = {}): BriefingInput {
  return {
    urgentCount: 0,
    draftsCount: 0,
    checksSummary: CHECKS,
    ...overrides,
  };
}

function urgentItem(overrides: Partial<UrgentItem> = {}): UrgentItem {
  return {
    id: 'urgent-1',
    kind: 'rent',
    tenantName: 'Dana Reed',
    unitLabel: '2A',
    statusLabel: 'Past due',
    ageAnchor: '2026-08-07T12:00:00.000Z',
    href: '/rent',
    channel: null,
    ...overrides,
  };
}

describe('briefing-summary', () => {
  describe('synthesizeBriefing', () => {
    it('should read quiet and healthy when nothing is urgent', () => {
      // Arrange
      const input = baseInput({ urgentCount: 0 });

      // Act
      const result = synthesizeBriefing(input);

      // Assert
      expect(result.sentence).toBe('Nothing urgent needs you.');
      expect(result.tone).toBe('healthy');
    });

    it('should ask for review in the singular when one item is urgent', () => {
      const result = synthesizeBriefing(baseInput({ urgentCount: 1 }));

      expect(result.sentence).toBe('One thing needs your review.');
      expect(result.tone).toBe('review');
    });

    it('should ask for review in the plural when several items are urgent', () => {
      const result = synthesizeBriefing(baseInput({ urgentCount: 3 }));

      expect(result.sentence).toBe('Three things need your review.');
      expect(result.tone).toBe('review');
    });

    it('should fall back to digits for counts above nine', () => {
      const result = synthesizeBriefing(baseInput({ urgentCount: 12 }));

      expect(result.sentence).toBe('12 things need your review.');
    });

    it('should always lead bullets with the checked line', () => {
      const result = synthesizeBriefing(baseInput());

      expect(result.bullets[0]).toBe(CHECKS);
    });

    it('should omit the drafts bullet when no drafts are pending', () => {
      const result = synthesizeBriefing(baseInput({ draftsCount: 0 }));

      expect(result.bullets).toEqual([CHECKS]);
      expect(result.bullets.some((b) => b.includes('drafted'))).toBe(false);
    });

    it('should add a singular drafts bullet for one draft', () => {
      const result = synthesizeBriefing(baseInput({ draftsCount: 1 }));

      expect(result.bullets).toContain('One rent follow-up is drafted for review.');
    });

    it('should add a plural drafts bullet for several drafts', () => {
      const result = synthesizeBriefing(baseInput({ draftsCount: 2 }));

      expect(result.bullets).toContain('Two rent follow-ups are drafted for review.');
    });

    it('should add a deadline bullet when a deadline is present', () => {
      const result = synthesizeBriefing(
        baseInput({ nextDeadline: { label: 'Lease ends · Unit 4B', date: 'May 28' } }),
      );

      expect(result.bullets).toContain('Lease ends · Unit 4B on May 28.');
    });

    it('should omit the deadline bullet when no deadline is present', () => {
      const result = synthesizeBriefing(baseInput());

      expect(result.bullets.some((b) => b.includes(' on '))).toBe(false);
    });

    it('should cap at three bullets with drafts and a deadline together', () => {
      const result = synthesizeBriefing(
        baseInput({
          urgentCount: 2,
          draftsCount: 2,
          nextDeadline: { label: 'Move-in · Unit 2A', date: 'May 24' },
        }),
      );

      expect(result.bullets).toHaveLength(3);
      expect(result.bullets[0]).toBe(CHECKS);
    });

    it('should treat negative or non-finite counts as zero', () => {
      const result = synthesizeBriefing(
        baseInput({ urgentCount: -4, draftsCount: Number.NaN }),
      );

      expect(result.sentence).toBe('Nothing urgent needs you.');
      expect(result.tone).toBe('healthy');
      expect(result.bullets).toEqual([CHECKS]);
    });
  });

  describe('synthesizeBriefingHeader', () => {
    it('describes current records without inventing an overnight run or send schedule', () => {
      const result = synthesizeBriefingHeader({
        urgentItems: [urgentItem()],
        draftsCount: 1,
        rentCollectedPct: 82,
      });
      const copy = JSON.stringify(result);

      expect(result.sentence.prefix).toBe('Two current items; ');
      expect(result.secondaryLabel).toBe('Show all two current items');
      expect(copy).not.toMatch(/overnight|4 PM|queued|scheduled to send/i);
    });

    it('routes a quiet day to the canonical Owner Queue', () => {
      const result = synthesizeBriefingHeader({
        urgentItems: [],
        draftsCount: 0,
        rentCollectedPct: null,
      });

      expect(result.cta).toEqual({
        label: 'Open Owner Queue',
        href: '/owner-queue',
      });
    });
  });
});
