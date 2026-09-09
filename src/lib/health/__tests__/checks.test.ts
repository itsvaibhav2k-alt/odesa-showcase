/**
 * Unit tests for the pure health-check detection logic (Feature 5).
 *
 * Drives `buildHealthFlags` (and the per-check helpers) on fixture rows
 * with a fixed clock. Covers, per check: the happy detection path, the
 * threshold boundary, status filtering, suppression conditions, and
 * unresolvable-property skips. Also locks the payload contract: every
 * candidate parses against `healthFlagPayloadSchema` and carries no
 * money-shaped keys.
 */

import { describe, expect, it } from 'vitest';

import { healthFlagPayloadSchema } from '@/lib/agent/worker/types';
import {
  buildHealthFlags,
  detectLeasesEndingSoon,
  detectStaleRentEscalations,
  detectStaleWorkOrders,
  detectVacantUnits,
  type EscalatedRentEventSourceRow,
  type HealthCheckSourceRows,
  type LeaseSourceRow,
  type UnitSourceRow,
  type WorkOrderSourceRow,
} from '../checks';

const NOW = new Date('2026-06-11T10:00:00.000Z');

// Seed-style UUIDs on purpose — zod4 .uuid() rejects them; the schema's
// UUID_LIKE regex must not.
const PROPERTY_A = '33333333-3333-3333-3333-333333333333';
const UNIT_1 = '44444444-4444-4444-4444-444444444401';
const UNIT_2 = '44444444-4444-4444-4444-444444444402';
const LEASE_1 = '55555555-5555-5555-5555-555555555501';
const LEASE_2 = '55555555-5555-5555-5555-555555555502';
const WO_1 = '66666666-6666-6666-6666-666666666601';
const RE_1 = '77777777-7777-7777-7777-777777777701';

const unit1: UnitSourceRow = { id: UNIT_1, property_id: PROPERTY_A, label: '2B' };
const unit2: UnitSourceRow = { id: UNIT_2, property_id: PROPERTY_A, label: '3A' };

function activeLease(overrides: Partial<LeaseSourceRow> = {}): LeaseSourceRow {
  return {
    id: LEASE_1,
    unit_id: UNIT_1,
    status: 'active',
    start_date: '2025-08-01',
    end_date: null,
    ...overrides,
  };
}

function workOrder(overrides: Partial<WorkOrderSourceRow> = {}): WorkOrderSourceRow {
  return {
    id: WO_1,
    unit_id: UNIT_1,
    status: 'open',
    urgency: 'routine',
    description: 'Leaky kitchen faucet',
    created_at: '2026-06-01T10:00:00.000Z', // 10 days before NOW
    ...overrides,
  };
}

function escalatedEvent(
  overrides: Partial<EscalatedRentEventSourceRow> = {},
): EscalatedRentEventSourceRow {
  return {
    id: RE_1,
    lease_id: LEASE_1,
    status: 'escalated',
    cycle_month: '2026-06-01',
    updated_at: '2026-06-06T10:00:00.000Z', // 5 days before NOW
    ...overrides,
  };
}

const unitsById = new Map([
  [UNIT_1, unit1],
  [UNIT_2, unit2],
]);

// ---------------------------------------------------------------------------
// (a) work_order_stale
// ---------------------------------------------------------------------------

describe('detectStaleWorkOrders', () => {
  it('should flag an open work order older than 7 days', () => {
    const flags = detectStaleWorkOrders([workOrder()], unitsById, NOW);

    expect(flags).toHaveLength(1);
    expect(flags[0].propertyId).toBe(PROPERTY_A);
    expect(flags[0].payload.kind).toBe('work_order_stale');
    expect(flags[0].payload.subject).toBe(WO_1);
    expect(flags[0].payload.refs).toContainEqual({ type: 'work_order', id: WO_1 });
    expect(flags[0].payload.summary).toContain('open 10 days');
    expect(flags[0].payload.summary).toContain('Leaky kitchen faucet');
  });

  it('should flag a work order just past the 7-day boundary but not one at it', () => {
    const justPast = workOrder({ created_at: '2026-06-04T09:59:59.000Z' });
    const exactlyAt = workOrder({ created_at: '2026-06-04T10:00:00.000Z' });

    expect(detectStaleWorkOrders([justPast], unitsById, NOW)).toHaveLength(1);
    expect(detectStaleWorkOrders([exactlyAt], unitsById, NOW)).toHaveLength(0);
  });

  it('should not flag work orders in a terminal status', () => {
    const completed = workOrder({ status: 'completed' });
    const cancelled = workOrder({ status: 'cancelled' });

    expect(detectStaleWorkOrders([completed, cancelled], unitsById, NOW)).toEqual([]);
  });

  it('should flag assigned and in_progress orders too', () => {
    const rows = [
      workOrder({ status: 'assigned' }),
      workOrder({ id: '66666666-6666-6666-6666-666666666602', status: 'in_progress' }),
    ];

    expect(detectStaleWorkOrders(rows, unitsById, NOW)).toHaveLength(2);
  });

  it('should skip a work order whose unit (and so property) cannot be resolved', () => {
    const orphan = workOrder({ unit_id: '99999999-9999-9999-9999-999999999999' });

    expect(detectStaleWorkOrders([orphan], unitsById, NOW)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// (b) lease_ending_soon
// ---------------------------------------------------------------------------

describe('detectLeasesEndingSoon', () => {
  it('should flag an active lease ending within 60 days with nothing on file', () => {
    const lease = activeLease({ end_date: '2026-07-15' }); // 34 days out
    const flags = detectLeasesEndingSoon([lease], unitsById, NOW);

    expect(flags).toHaveLength(1);
    expect(flags[0].payload.kind).toBe('lease_ending_soon');
    expect(flags[0].payload.subject).toBe(LEASE_1);
    expect(flags[0].payload.summary).toContain('ends in 34 days');
    expect(flags[0].payload.refs).toContainEqual({ type: 'lease', id: LEASE_1 });
  });

  it('should include the 60-day boundary but not 61 days out', () => {
    const at60 = activeLease({ end_date: '2026-08-10' });
    const at61 = activeLease({ end_date: '2026-08-11' });

    expect(detectLeasesEndingSoon([at60], unitsById, NOW)).toHaveLength(1);
    expect(detectLeasesEndingSoon([at61], unitsById, NOW)).toHaveLength(0);
  });

  it('should not flag a lease that already ended', () => {
    const past = activeLease({ end_date: '2026-06-10' });

    expect(detectLeasesEndingSoon([past], unitsById, NOW)).toEqual([]);
  });

  it('should not flag non-active leases or leases without an end date', () => {
    const rows = [
      activeLease({ status: 'terminated', end_date: '2026-07-01' }),
      activeLease({ id: LEASE_2, end_date: null }),
    ];

    expect(detectLeasesEndingSoon(rows, unitsById, NOW)).toEqual([]);
  });

  it('should suppress the flag when a pending lease exists on the same unit (renewal noted)', () => {
    const ending = activeLease({ end_date: '2026-07-15' });
    const renewal = activeLease({
      id: LEASE_2,
      status: 'pending',
      start_date: '2026-07-16',
      end_date: '2027-07-15',
    });

    expect(detectLeasesEndingSoon([ending, renewal], unitsById, NOW)).toEqual([]);
  });

  it('should suppress the flag when a follow-on lease starts after this one ends', () => {
    const ending = activeLease({ end_date: '2026-07-15' });
    const followOn = activeLease({
      id: LEASE_2,
      status: 'active',
      start_date: '2026-08-01',
      end_date: '2027-07-31',
    });

    expect(detectLeasesEndingSoon([ending, followOn], unitsById, NOW)).toEqual([]);
  });

  it('should not suppress for a pending lease on a DIFFERENT unit', () => {
    const ending = activeLease({ end_date: '2026-07-15' });
    const otherUnit = activeLease({
      id: LEASE_2,
      unit_id: UNIT_2,
      status: 'pending',
    });

    expect(detectLeasesEndingSoon([ending, otherUnit], unitsById, NOW)).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// (c) vacant_unit
// ---------------------------------------------------------------------------

describe('detectVacantUnits', () => {
  it('should flag a unit with no active lease', () => {
    const flags = detectVacantUnits([unit1, unit2], [activeLease()], NOW);

    expect(flags).toHaveLength(1);
    expect(flags[0].payload.kind).toBe('vacant_unit');
    expect(flags[0].payload.subject).toBe(UNIT_2);
    expect(flags[0].propertyId).toBe(PROPERTY_A);
    expect(flags[0].payload.summary).toContain('no active lease');
  });

  it('should not flag units covered by an active lease', () => {
    const flags = detectVacantUnits(
      [unit1],
      [activeLease({ unit_id: UNIT_1 })],
      NOW,
    );

    expect(flags).toEqual([]);
  });

  it('should not flag an active lease past its end date (still a tenant relationship)', () => {
    const flags = detectVacantUnits(
      [unit1],
      [activeLease({ end_date: '2026-05-01' })],
      NOW,
    );

    expect(flags).toEqual([]);
  });

  it('should flag a pending-lease unit with finish-lease-terms copy, never as vacant', () => {
    const flags = detectVacantUnits(
      [unit1],
      [activeLease({ status: 'pending' })],
      NOW,
    );

    expect(flags).toHaveLength(1);
    expect(flags[0].payload.kind).toBe('vacant_unit');
    expect(flags[0].payload.summary).toBe(
      'Unit 2B has a pending lease — finish lease terms.',
    );
    expect(flags[0].payload.summary.toLowerCase()).not.toContain('vacant');
  });

  it('should flag a unit whose only lease is terminated (vacant today)', () => {
    const flags = detectVacantUnits(
      [unit1],
      [activeLease({ status: 'terminated' })],
      NOW,
    );

    expect(flags).toHaveLength(1);
    expect(flags[0].payload.summary).toContain('sitting vacant');
  });
});

// ---------------------------------------------------------------------------
// (d) rent_escalation_stale
// ---------------------------------------------------------------------------

describe('detectStaleRentEscalations', () => {
  const leasesById = new Map([[LEASE_1, activeLease()]]);

  it('should flag an escalated rent event untouched for more than 3 days', () => {
    const flags = detectStaleRentEscalations(
      [escalatedEvent()],
      leasesById,
      unitsById,
      NOW,
    );

    expect(flags).toHaveLength(1);
    expect(flags[0].payload.kind).toBe('rent_escalation_stale');
    expect(flags[0].payload.subject).toBe(RE_1);
    expect(flags[0].propertyId).toBe(PROPERTY_A);
    expect(flags[0].payload.summary).toContain('5 days');
  });

  it('should not flag an escalation at or under the 3-day boundary', () => {
    const fresh = escalatedEvent({ updated_at: '2026-06-08T10:00:00.000Z' });

    expect(
      detectStaleRentEscalations([fresh], leasesById, unitsById, NOW),
    ).toEqual([]);
  });

  it('should ignore rows that are not in escalated status', () => {
    const paid = escalatedEvent({ status: 'paid' });

    expect(
      detectStaleRentEscalations([paid], leasesById, unitsById, NOW),
    ).toEqual([]);
  });

  it('should skip an escalation whose lease or unit cannot be resolved', () => {
    const orphan = escalatedEvent({
      lease_id: '99999999-9999-9999-9999-999999999999',
    });

    expect(
      detectStaleRentEscalations([orphan], leasesById, unitsById, NOW),
    ).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// buildHealthFlags — composition + payload contract
// ---------------------------------------------------------------------------

describe('buildHealthFlags', () => {
  const rows: HealthCheckSourceRows = {
    units: [unit1, unit2],
    leases: [activeLease({ end_date: '2026-07-15' })],
    workOrders: [workOrder()],
    escalatedRentEvents: [escalatedEvent()],
  };

  it('should compose all four checks over one org snapshot', () => {
    const flags = buildHealthFlags(rows, NOW);
    const kinds = flags.map((f) => f.payload.kind);

    expect(kinds).toEqual([
      'work_order_stale',
      'lease_ending_soon',
      'vacant_unit',
      'rent_escalation_stale',
    ]);
  });

  it('should produce payloads that parse against healthFlagPayloadSchema (seed UUIDs included)', () => {
    for (const flag of buildHealthFlags(rows, NOW)) {
      const parsed = healthFlagPayloadSchema.safeParse(flag.payload);
      expect(parsed.success, JSON.stringify(flag.payload)).toBe(true);
    }
  });

  it('should never carry money-shaped payload keys that could fabricate a money chip', () => {
    const forbidden = ['amount', 'amountCents', 'amount_cents', 'cost', 'costCents', 'estimate', 'estimatedCost', 'rentAmount', 'rent_amount'];
    for (const flag of buildHealthFlags(rows, NOW)) {
      for (const key of Object.keys(flag.payload)) {
        expect(forbidden).not.toContain(key);
      }
    }
  });

  it('should return an empty list for a healthy snapshot', () => {
    const healthy: HealthCheckSourceRows = {
      units: [unit1],
      leases: [activeLease({ end_date: null })],
      workOrders: [],
      escalatedRentEvents: [],
    };

    expect(buildHealthFlags(healthy, NOW)).toEqual([]);
  });
});
