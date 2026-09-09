/**
 * Unit tests for handleAddAppliance.
 *
 * Covers: happy path with property + unit UUIDs, idempotency on
 * (org, property, unit, type, make, model), update-on-drift, ambiguous
 * property, and RLS scoping (every query carries organization_id).
 */

import { describe, expect, it } from 'vitest';

import { handleAddAppliance } from '../add-appliance';
import { ORG_ID, PROPERTY_ID, UNIT_ID, makeAdmin } from './__helpers';

const APPLIANCE_ID = '77777777-7777-4777-8777-777777777777';

const BY_ID_PAYLOAD = {
  propertyRef: { propertyId: PROPERTY_ID },
  unitRef: { unitId: UNIT_ID },
  type: 'fridge' as const,
  make: 'Samsung',
  model: 'RF28',
};

describe('handleAddAppliance', () => {
  it('inserts a new appliance when refs resolve and no duplicate exists', async () => {
    const { admin, calls } = makeAdmin({
      properties: [{ data: { id: PROPERTY_ID }, error: null }],
      units: [{ data: { id: UNIT_ID }, error: null }],
      appliances: [
        { data: null, error: null }, // idempotency lookup → none
        {
          data: {
            id: APPLIANCE_ID,
            type: 'fridge',
            make: 'Samsung',
            model: 'RF28',
            unit_id: UNIT_ID,
            property_id: PROPERTY_ID,
          },
          error: null,
        },
      ],
    });

    const result = await handleAddAppliance({
      admin,
      organizationId: ORG_ID,
      payload: BY_ID_PAYLOAD,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.confidence).toBe(1.0);
    expect(result.idempotent).toBeUndefined();
    expect(result.data).toMatchObject({ id: APPLIANCE_ID });

    const insertCall = calls.find((c) => c.op === 'insert');
    expect(insertCall?.insertValues).toMatchObject({
      organization_id: ORG_ID,
      property_id: PROPERTY_ID,
      unit_id: UNIT_ID,
      type: 'fridge',
      make: 'Samsung',
      model: 'RF28',
      confidence: 0.7,
      source: 'agent',
    });
  });

  it('returns idempotent: true when same natural key + no field drift', async () => {
    const { admin, calls } = makeAdmin({
      properties: [{ data: { id: PROPERTY_ID }, error: null }],
      units: [{ data: { id: UNIT_ID }, error: null }],
      appliances: [
        {
          data: {
            id: APPLIANCE_ID,
            type: 'fridge',
            make: 'Samsung',
            model: 'RF28',
            serial_number: null,
            install_date: null,
            last_service_date: null,
            warranty_expires_at: null,
            notes: null,
            confidence: 0.7,
            source: 'agent',
            unit_id: UNIT_ID,
            property_id: PROPERTY_ID,
          },
          error: null,
        },
      ],
    });

    const result = await handleAddAppliance({
      admin,
      organizationId: ORG_ID,
      payload: BY_ID_PAYLOAD,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.idempotent).toBe(true);
    expect(calls.find((c) => c.op === 'insert')).toBeUndefined();
    expect(calls.find((c) => c.op === 'update')).toBeUndefined();
  });

  it('updates existing row when payload supplies a different notes value', async () => {
    const { admin, calls } = makeAdmin({
      properties: [{ data: { id: PROPERTY_ID }, error: null }],
      units: [{ data: { id: UNIT_ID }, error: null }],
      appliances: [
        {
          data: {
            id: APPLIANCE_ID,
            type: 'fridge',
            make: 'Samsung',
            model: 'RF28',
            serial_number: null,
            install_date: null,
            last_service_date: null,
            warranty_expires_at: null,
            notes: 'leaks sometimes',
            confidence: 0.7,
            source: 'agent',
            unit_id: UNIT_ID,
            property_id: PROPERTY_ID,
          },
          error: null,
        },
        {
          data: { id: APPLIANCE_ID, notes: 'no longer leaking' },
          error: null,
        },
      ],
    });

    const result = await handleAddAppliance({
      admin,
      organizationId: ORG_ID,
      payload: { ...BY_ID_PAYLOAD, notes: 'no longer leaking' },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.idempotent).toBe(false);
    const updateCall = calls.find((c) => c.op === 'update');
    expect(updateCall?.updateValues).toMatchObject({
      notes: 'no longer leaking',
    });
  });

  it('omits unit_id (NULL) for property-wide appliances', async () => {
    const { admin, calls } = makeAdmin({
      properties: [{ data: { id: PROPERTY_ID }, error: null }],
      appliances: [
        { data: null, error: null },
        { data: { id: APPLIANCE_ID, type: 'hvac', unit_id: null }, error: null },
      ],
    });

    const result = await handleAddAppliance({
      admin,
      organizationId: ORG_ID,
      payload: {
        propertyRef: { propertyId: PROPERTY_ID },
        type: 'hvac',
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const insertCall = calls.find((c) => c.op === 'insert');
    expect(insertCall?.insertValues?.unit_id).toBeNull();

    // Idempotency lookup should use is(unit_id, NULL).
    const lookupCall = calls.find(
      (c) => c.table === 'appliances' && c.op === 'select',
    );
    expect(lookupCall?.iss).toContainEqual(['unit_id', null]);
  });

  it('returns ambiguous_property on multi-match', async () => {
    const { admin } = makeAdmin({
      properties: [
        { data: [{ id: PROPERTY_ID }, { id: 'other' }], error: null },
      ],
    });

    const result = await handleAddAppliance({
      admin,
      organizationId: ORG_ID,
      payload: { ...BY_ID_PAYLOAD, propertyRef: { propertyName: 'house' } },
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('ambiguous_property');
    expect(result.confidence).toBe(0.2);
  });

  it('scopes every query by organization_id (RLS)', async () => {
    const { admin, calls } = makeAdmin({
      properties: [{ data: { id: PROPERTY_ID }, error: null }],
      units: [{ data: { id: UNIT_ID }, error: null }],
      appliances: [
        { data: null, error: null },
        { data: { id: APPLIANCE_ID }, error: null },
      ],
    });

    await handleAddAppliance({
      admin,
      organizationId: ORG_ID,
      payload: BY_ID_PAYLOAD,
    });

    for (const call of calls) {
      if (call.op === 'insert') {
        expect(call.insertValues?.organization_id).toBe(ORG_ID);
      } else {
        expect(call.eqs).toContainEqual(['organization_id', ORG_ID]);
      }
    }
  });

  it('honors explicit confidence + source (owner-confirm path)', async () => {
    const { admin, calls } = makeAdmin({
      properties: [{ data: { id: PROPERTY_ID }, error: null }],
      units: [{ data: { id: UNIT_ID }, error: null }],
      appliances: [
        { data: null, error: null },
        { data: { id: APPLIANCE_ID }, error: null },
      ],
    });

    await handleAddAppliance({
      admin,
      organizationId: ORG_ID,
      payload: { ...BY_ID_PAYLOAD, confidence: 1.0, source: 'owner' },
    });

    const insertCall = calls.find((c) => c.op === 'insert');
    expect(insertCall?.insertValues).toMatchObject({
      confidence: 1.0,
      source: 'owner',
    });
  });
});
