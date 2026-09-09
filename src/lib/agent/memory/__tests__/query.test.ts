import { beforeEach, describe, expect, it } from 'vitest';

import { countActiveFacts, getActiveFacts, supersedeFact } from '../query';
import {
  PROPERTY_ID,
  TENANT_ID,
  VENDOR_ID,
  createMockState,
  createSupabaseMock,
  makeTypedRow,
  resetCounter,
  setForcedError,
  type MockState,
} from './test-utils';

describe('getActiveFacts', () => {
  let state: MockState;

  beforeEach(() => {
    resetCounter();
    state = createMockState();
  });

  it('returns only non-superseded facts for the property', async () => {
    const db = createSupabaseMock(state);

    const active = makeTypedRow('vendor_relationship', {
      created_at: '2026-04-15T00:00:00Z',
    });
    const superseded = makeTypedRow('vendor_relationship', {
      created_at: '2026-04-01T00:00:00Z',
      superseded_at: '2026-04-15T00:00:00Z',
      superseded_by: active.id,
    });
    state.rows.push(active, superseded);

    const result = await getActiveFacts({ db, propertyId: PROPERTY_ID });

    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe(active.id);
    expect(result[0]!.factType).toBe('vendor_relationship');
  });

  it('filters by factType when supplied', async () => {
    const db = createSupabaseMock(state);
    state.rows.push(
      makeTypedRow('vendor_relationship', { subject_id: VENDOR_ID }),
      makeTypedRow('tenant_pattern', { subject_id: TENANT_ID }),
      makeTypedRow('building_quirk'),
      makeTypedRow('owner_rule'),
    );

    const tenants = await getActiveFacts({
      db,
      propertyId: PROPERTY_ID,
      factType: 'tenant_pattern',
    });
    expect(tenants).toHaveLength(1);
    expect(tenants[0]!.factType).toBe('tenant_pattern');
    if (tenants[0]!.factType === 'tenant_pattern') {
      expect(tenants[0]!.content.payment_cadence).toBe('pays on the 5th');
    }
  });

  it('hydrates the discriminated union — narrowing each fact_type', async () => {
    const db = createSupabaseMock(state);
    state.rows.push(
      makeTypedRow('vendor_relationship', { subject_id: VENDOR_ID }),
      makeTypedRow('tenant_pattern', { subject_id: TENANT_ID }),
      makeTypedRow('building_quirk'),
      makeTypedRow('derived_rule'),
      makeTypedRow('owner_rule'),
    );

    const all = await getActiveFacts({ db, propertyId: PROPERTY_ID });
    expect(all).toHaveLength(5);

    const byType = Object.fromEntries(all.map((f) => [f.factType, f]));
    expect(byType.vendor_relationship).toBeDefined();
    expect(byType.tenant_pattern).toBeDefined();
    expect(byType.building_quirk).toBeDefined();
    expect(byType.derived_rule).toBeDefined();
    expect(byType.owner_rule).toBeDefined();

    const vendor = byType.vendor_relationship!;
    if (vendor.factType === 'vendor_relationship') {
      expect(vendor.content.acceptance_rate).toBe(0.8);
      expect(vendor.subjectId).toBe(VENDOR_ID);
    }
  });

  it('orders newest-first', async () => {
    const db = createSupabaseMock(state);
    state.rows.push(
      makeTypedRow('tenant_pattern', { created_at: '2026-04-01T00:00:00Z' }),
      makeTypedRow('tenant_pattern', { created_at: '2026-04-15T00:00:00Z' }),
      makeTypedRow('tenant_pattern', { created_at: '2026-04-10T00:00:00Z' }),
    );

    const ordered = await getActiveFacts({ db, propertyId: PROPERTY_ID });
    expect(ordered.map((f) => f.createdAt)).toEqual([
      '2026-04-15T00:00:00Z',
      '2026-04-10T00:00:00Z',
      '2026-04-01T00:00:00Z',
    ]);
  });

  it('throws on Supabase error', async () => {
    const db = createSupabaseMock(state);
    setForcedError(state, 'memory_facts', 'select', 'rls denied');

    await expect(
      getActiveFacts({ db, propertyId: PROPERTY_ID }),
    ).rejects.toThrow(/getActiveFacts failed.*rls denied/);
  });
});

describe('supersedeFact', () => {
  let state: MockState;

  beforeEach(() => {
    resetCounter();
    state = createMockState();
  });

  it('stamps superseded_at + superseded_by on the row', async () => {
    const db = createSupabaseMock(state);
    const old = makeTypedRow('vendor_relationship');
    const replacement = makeTypedRow('vendor_relationship');
    state.rows.push(old, replacement);

    const updated = await supersedeFact({
      db,
      currentId: old.id,
      replacementId: replacement.id,
    });

    expect(updated).toBe(1);
    expect(state.updates).toHaveLength(1);
    expect(state.updates[0]!.patch.superseded_by).toBe(replacement.id);
    expect(typeof state.updates[0]!.patch.superseded_at).toBe('string');
    // Mutation visible on the row
    expect(old.superseded_at).not.toBeNull();
    expect(old.superseded_by).toBe(replacement.id);
  });

  it('is idempotent — already-superseded rows produce 0 updates', async () => {
    const db = createSupabaseMock(state);
    const row = makeTypedRow('tenant_pattern', {
      superseded_at: '2026-04-01T00:00:00Z',
    });
    state.rows.push(row);

    const updated = await supersedeFact({
      db,
      currentId: row.id,
      replacementId: null,
    });

    expect(updated).toBe(0);
  });

  it('throws on Supabase error', async () => {
    const db = createSupabaseMock(state);
    setForcedError(state, 'memory_facts', 'update', 'fk constraint');

    await expect(
      supersedeFact({ db, currentId: 'irrelevant', replacementId: null }),
    ).rejects.toThrow(/supersedeFact failed.*fk constraint/);
  });
});

describe('countActiveFacts', () => {
  let state: MockState;

  beforeEach(() => {
    resetCounter();
    state = createMockState();
  });

  it('counts active facts (excludes superseded)', async () => {
    const db = createSupabaseMock(state);
    state.rows.push(
      makeTypedRow('tenant_pattern'),
      makeTypedRow('tenant_pattern'),
      makeTypedRow('tenant_pattern', { superseded_at: '2026-04-01T00:00:00Z' }),
    );

    const total = await countActiveFacts({ db, propertyId: PROPERTY_ID });
    expect(total).toBe(2);
  });

  it('respects factType filter', async () => {
    const db = createSupabaseMock(state);
    state.rows.push(
      makeTypedRow('tenant_pattern'),
      makeTypedRow('vendor_relationship'),
      makeTypedRow('building_quirk'),
    );

    const tenants = await countActiveFacts({
      db,
      propertyId: PROPERTY_ID,
      factType: 'tenant_pattern',
    });
    expect(tenants).toBe(1);
  });
});
