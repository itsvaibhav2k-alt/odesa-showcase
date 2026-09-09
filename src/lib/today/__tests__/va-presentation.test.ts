import { describe, expect, it } from 'vitest';

import {
  adaptQueueItemForVa,
  buildVaHomeDeadlines,
  buildVaHomeMetrics,
} from '@/lib/today/va-presentation';
import type { QueueItem } from '@/types/today';

function queueItem(): QueueItem {
  return {
    id: 'queue-1',
    status: 'review',
    title: 'Known queue item',
    property: 'Galaxy A',
    meta: ['real source'],
    recommendation: 'Owner recommendation',
    timestamp: '10m ago',
    channel: 'inbox',
    contextLabel: 'Case context',
    contextSuggestions: [],
    contextPlaceholder: 'Ask about this case',
    primaryAction: { label: 'Review', handler: '/review/rent/queue-1' },
    reason: 'Grounded reason',
    sourceLabel: 'View source',
    sourceHref: '/rent',
  };
}

describe('VA Today presentation', () => {
  it('derives active summary metrics only from supplied real counts', () => {
    const metrics = buildVaHomeMetrics({
      queueCount: 3,
      urgentWorkOrdersCount: 1,
      draftsAwaitingOwner: 2,
      callsAwaitingOwner: 1,
      callsToday: 4,
      callsHandledToday: 3,
    });
    const byKey = Object.fromEntries(
      metrics.map((metric) => [metric.key, metric]),
    );

    expect(metrics).toHaveLength(4);
    expect(byKey.attention).toMatchObject({ value: 3, active: true });
    expect(byKey['work-orders']).toMatchObject({ value: 1, active: true });
    expect(byKey.owner).toMatchObject({
      value: 3,
      detail: '2 drafts · 1 flagged call',
      active: true,
    });
    expect(byKey.calls).toMatchObject({
      value: 4,
      detail: '3 resolved without owner review',
      active: true,
    });
  });

  it('keeps zero-heavy summary cells quiet and explicit', () => {
    const metrics = buildVaHomeMetrics({
      queueCount: 0,
      urgentWorkOrdersCount: 0,
      draftsAwaitingOwner: 0,
      callsAwaitingOwner: 0,
      callsToday: 0,
      callsHandledToday: 0,
    });

    expect(metrics.every((metric) => metric.value === 0)).toBe(true);
    expect(metrics.every((metric) => metric.active === false)).toBe(true);
    expect(metrics.every((metric) => metric.tone === 'quiet')).toBe(true);
    expect(metrics.map((metric) => metric.detail).join(' ')).toContain(
      'No calls recorded today',
    );
    expect(metrics.map((metric) => metric.detail).join(' ')).not.toMatch(
      /trend|SLA|satisfaction/i,
    );
  });

  it('builds only supplied lease and move-in deadlines in date order', () => {
    const deadlines = buildVaHomeDeadlines({
      leases: [
        {
          leaseId: 'lease-1',
          tenantName: 'Riley Johnson',
          unitLabel: '205',
          endDate: '2026-08-08',
        },
      ],
      moveIns: [
        {
          tenantName: 'Morgan Lee',
          unitLabel: '101',
          date: '2026-08-05',
        },
      ],
    });

    expect(deadlines).toHaveLength(2);
    expect(deadlines.map((deadline) => deadline.title)).toEqual([
      'Morgan Lee',
      'Riley Johnson',
    ]);
    expect(deadlines.map((deadline) => deadline.label)).toEqual([
      'Move-in',
      'Lease ends',
    ]);
    expect(buildVaHomeDeadlines({ leases: [], moveIns: [] })).toEqual([]);
  });

  it.each(['rent', 'work_order', 'conversation'] as const)(
    'reframes %s as preparation while preserving grounded evidence',
    (kind) => {
      const original = queueItem();
      const adapted = adaptQueueItemForVa(original, kind);

      expect(adapted.id).toBe(original.id);
      expect(adapted.meta).toBe(original.meta);
      expect(adapted.reason).toBe(original.reason);
      expect(adapted.sourceHref).toBe(original.sourceHref);
      expect(adapted.ownerRule).toBe('Owner approval required');
      expect(adapted.recommendation).toMatch(/prepare|verify|summarize/i);
      expect(adapted.nextStep).toMatch(/owner|cannot be sent|unsent/i);
      expect(adapted.contextSuggestions.join(' ')).toMatch(
        /owner review|owner handoff|owner needs to decide/i,
      );
      expect(adapted).not.toHaveProperty('assignee');
      expect(adapted).not.toHaveProperty('sla');
    },
  );

  it('does not infer that a work order is unassigned in the Operations Assistant view', () => {
    const original = queueItem();
    original.ifIgnored =
      'If you do nothing, the work order stays open and unassigned.';

    const adapted = adaptQueueItemForVa(original, 'work_order');

    expect(adapted.ifIgnored).toBe(
      'The work order remains active in the queue until the owner reviews it.',
    );
    expect(adapted.ifIgnored).not.toMatch(/unassigned/i);
  });
});
