/**
 * Unit tests for `caseMetaCells`.
 *
 * Covers both flavours (general + vendor), the cell-omission rules
 * (no `—` placeholders), and the formatters (rent, lease, on-time,
 * tenant-tone).
 */
import { describe, expect, it } from 'vitest';

import {
  caseMetaCells,
  pickCaseMetaFlavour,
} from '@/lib/inbox/case-meta-cells';
import { emptyCaseContext } from '@/lib/inbox/case-context';
import type {
  CaseContext,
  WorkOrderSummary,
} from '@/lib/inbox/case-context';

function makeWorkOrder(
  overrides: Partial<WorkOrderSummary> = {},
): WorkOrderSummary {
  return {
    id: 'wo-1',
    category: 'plumbing',
    urgency: 'urgent',
    status: 'open',
    openedAt: '2026-05-20T10:00:00.000Z',
    vendor: { id: 'v-1', name: 'Joe Plumbing', acceptanceRate: 0.9 },
    backupVendor: { id: 'v-2', name: 'Acme Plumbers' },
    slaState: 'on_track',
    ...overrides,
  };
}

function makeContext(overrides: Partial<CaseContext> = {}): CaseContext {
  return {
    ...emptyCaseContext(),
    ...overrides,
  };
}

describe('pickCaseMetaFlavour', () => {
  it('returns vendor when status=escalated and a work order exists', () => {
    expect(
      pickCaseMetaFlavour({ workOrder: makeWorkOrder() }, 'escalated'),
    ).toBe('vendor');
  });

  it('returns general when status=escalated but no work order', () => {
    expect(pickCaseMetaFlavour({ workOrder: null }, 'escalated')).toBe(
      'general',
    );
  });

  it('returns general for review/draft/handled even with work order', () => {
    const ctx = { workOrder: makeWorkOrder() };
    expect(pickCaseMetaFlavour(ctx, 'review')).toBe('general');
    expect(pickCaseMetaFlavour(ctx, 'draft')).toBe('general');
    expect(pickCaseMetaFlavour(ctx, 'handled')).toBe('general');
    expect(pickCaseMetaFlavour(ctx, 'watching')).toBe('general');
  });
});

describe('caseMetaCells — general flavour', () => {
  it('emits all five cells when every source is present', () => {
    const ctx = makeContext({
      lease: {
        startDate: '2024-08-01T00:00:00.000Z',
        endDate: '2026-08-01T00:00:00.000Z',
        rentAmountCents: 300_000,
      },
      payments: {
        onTimeCount: 11,
        totalRecent: 12,
        balanceCents: 0,
        daysLateTier: null,
      },
    });
    const cells = caseMetaCells(ctx, 'review', {
      unitLabel: 'Unit 3A',
      propertyName: 'Maplewoods',
      tenantSinceYear: 2024,
    });
    expect(cells.map((c) => c.id)).toEqual([
      'unit',
      'rent',
      'lease',
      'tenant-since',
      'on-time',
    ]);
    expect(cells.find((c) => c.id === 'unit')?.value).toBe(
      'Unit 3A · Maplewoods',
    );
    expect(cells.find((c) => c.id === 'rent')?.value).toBe('$3,000 /mo');
    expect(cells.find((c) => c.id === 'lease')?.value).toBe('2024–2026');
    expect(cells.find((c) => c.id === 'tenant-since')?.value).toBe('2024');
    expect(cells.find((c) => c.id === 'on-time')?.value).toBe('11/12');
  });

  it('collapses to fewer cells when sources are missing — no placeholders', () => {
    const ctx = makeContext({
      lease: null,
      payments: {
        onTimeCount: 0,
        totalRecent: 0,
        balanceCents: 0,
        daysLateTier: null,
      },
    });
    const cells = caseMetaCells(ctx, 'review', {
      unitLabel: 'Unit 7',
      tenantSinceYear: null,
    });
    // Only unit cell survives.
    expect(cells.map((c) => c.id)).toEqual(['unit']);
    expect(cells.find((c) => c.id === 'unit')?.value).toBe('Unit 7');
    // No `—` placeholders ever — empty fields are dropped.
    for (const cell of cells) {
      expect(cell.value).not.toContain('—');
    }
  });

  it('handles unit-only label when property is missing', () => {
    const ctx = makeContext();
    const cells = caseMetaCells(ctx, 'review', {
      unitLabel: 'Apt 12B',
      propertyName: null,
    });
    expect(cells.find((c) => c.id === 'unit')?.value).toBe('Apt 12B');
  });

  it('handles property-only label when unit is missing', () => {
    const ctx = makeContext();
    const cells = caseMetaCells(ctx, 'review', {
      unitLabel: null,
      propertyName: 'Maplewoods',
    });
    expect(cells.find((c) => c.id === 'unit')?.value).toBe('Maplewoods');
  });

  it('omits unit cell entirely when both unit + property are missing', () => {
    const ctx = makeContext();
    const cells = caseMetaCells(ctx, 'review', {
      unitLabel: null,
      propertyName: null,
    });
    expect(cells.find((c) => c.id === 'unit')).toBeUndefined();
  });

  it('omits rent cell when amount is null or zero', () => {
    const ctx = makeContext({
      lease: {
        startDate: '2024-01-01T00:00:00.000Z',
        endDate: null,
        rentAmountCents: 0,
      },
    });
    const cells = caseMetaCells(ctx, 'review', {});
    expect(cells.find((c) => c.id === 'rent')).toBeUndefined();
  });

  it('formats lease term with one-sided dates', () => {
    const ctx = makeContext({
      lease: {
        startDate: '2024-01-01T00:00:00.000Z',
        endDate: null,
        rentAmountCents: null,
      },
    });
    const cells = caseMetaCells(ctx, 'review', {});
    expect(cells.find((c) => c.id === 'lease')?.value).toBe('from 2024');
  });
});

describe('caseMetaCells — vendor flavour', () => {
  it('emits work-order, vendor, SLA, backup, tone for a fully populated breach', () => {
    const ctx = makeContext({
      workOrder: makeWorkOrder({ slaState: 'breached', urgency: 'emergency' }),
      payments: {
        onTimeCount: 12,
        totalRecent: 12,
        balanceCents: 0,
        daysLateTier: null,
      },
    });
    const cells = caseMetaCells(ctx, 'escalated');
    expect(cells.map((c) => c.id)).toEqual([
      'work-order',
      'vendor',
      'sla',
      'backup',
      'tone',
    ]);
    expect(cells.find((c) => c.id === 'work-order')?.value).toBe(
      'Plumbing · EMERGENCY',
    );
    expect(cells.find((c) => c.id === 'vendor')?.value).toBe('Joe Plumbing');
    expect(cells.find((c) => c.id === 'sla')?.value).toBe('BREACHED');
    expect(cells.find((c) => c.id === 'backup')?.value).toBe('Acme Plumbers');
    expect(cells.find((c) => c.id === 'tone')?.value).toBe('Reliable');
  });

  it('omits the SLA cell when on_track', () => {
    const ctx = makeContext({
      workOrder: makeWorkOrder({ slaState: 'on_track' }),
    });
    const cells = caseMetaCells(ctx, 'escalated');
    expect(cells.find((c) => c.id === 'sla')).toBeUndefined();
  });

  it('emits AT RISK for at_risk', () => {
    const ctx = makeContext({
      workOrder: makeWorkOrder({ slaState: 'at_risk' }),
    });
    const cells = caseMetaCells(ctx, 'escalated');
    expect(cells.find((c) => c.id === 'sla')?.value).toBe('AT RISK');
  });

  it('omits vendor and backup when they are null', () => {
    const ctx = makeContext({
      workOrder: makeWorkOrder({
        vendor: null,
        backupVendor: null,
        slaState: 'breached',
      }),
    });
    const cells = caseMetaCells(ctx, 'escalated');
    expect(cells.find((c) => c.id === 'vendor')).toBeUndefined();
    expect(cells.find((c) => c.id === 'backup')).toBeUndefined();
    // Strip collapses to: work-order, sla. (tone needs payments.totalRecent > 0)
    expect(cells.map((c) => c.id)).toEqual(['work-order', 'sla']);
  });

  it('classifies tenant tone correctly', () => {
    const mkPay = (onTime: number, total: number) => ({
      onTimeCount: onTime,
      totalRecent: total,
      balanceCents: 0,
      daysLateTier: null,
    });
    const reliable = caseMetaCells(
      makeContext({
        workOrder: makeWorkOrder({ slaState: 'breached' }),
        payments: mkPay(12, 12),
      }),
      'escalated',
    );
    expect(reliable.find((c) => c.id === 'tone')?.value).toBe('Reliable');

    const steady = caseMetaCells(
      makeContext({
        workOrder: makeWorkOrder({ slaState: 'breached' }),
        payments: mkPay(10, 12),
      }),
      'escalated',
    );
    expect(steady.find((c) => c.id === 'tone')?.value).toBe('Steady');

    const wobbly = caseMetaCells(
      makeContext({
        workOrder: makeWorkOrder({ slaState: 'breached' }),
        payments: mkPay(7, 12),
      }),
      'escalated',
    );
    expect(wobbly.find((c) => c.id === 'tone')?.value).toBe('Wobbly');

    const strained = caseMetaCells(
      makeContext({
        workOrder: makeWorkOrder({ slaState: 'breached' }),
        payments: mkPay(2, 12),
      }),
      'escalated',
    );
    expect(strained.find((c) => c.id === 'tone')?.value).toBe('Strained');
  });

  it('falls back to general flavour when escalated but no work order', () => {
    const ctx = makeContext({ workOrder: null });
    const cells = caseMetaCells(ctx, 'escalated', { unitLabel: 'Unit 1' });
    expect(cells.map((c) => c.id)).toEqual(['unit']);
  });
});
