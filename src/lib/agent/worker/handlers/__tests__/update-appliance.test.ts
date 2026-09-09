/**
 * Unit tests for handleUpdateAppliance.
 *
 * Covers: happy path with applianceId UUID, name-fuzzy ref resolution,
 * idempotency on no-fields-supplied, owner-source confidence bump,
 * and ambiguous appliance.
 */

import { describe, expect, it } from 'vitest';

import { handleUpdateAppliance } from '../update-appliance';
import { ORG_ID, PROPERTY_ID, makeAdmin } from './__helpers';

const APPLIANCE_ID = '77777777-7777-4777-8777-777777777777';

describe('handleUpdateAppliance', () => {
  it('updates an appliance by UUID with only the fields supplied', async () => {
    const { admin, calls } = makeAdmin({
      appliances: [
        // resolveAppliance UUID short-circuit
        { data: [{ id: APPLIANCE_ID }], error: null },
        // update result
        {
          data: {
            id: APPLIANCE_ID,
            type: 'fridge',
            make: 'Samsung',
            model: 'RF28',
            notes: 'fixed',
          },
          error: null,
        },
      ],
    });

    const result = await handleUpdateAppliance({
      admin,
      organizationId: ORG_ID,
      payload: {
        applianceRef: { applianceId: APPLIANCE_ID },
        notes: 'fixed',
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.confidence).toBe(1.0);
    const updateCall = calls.find((c) => c.op === 'update');
    expect(updateCall?.updateValues).toEqual({ notes: 'fixed' });
    // Source / confidence not in payload → not in update.
    expect(updateCall?.updateValues).not.toHaveProperty('confidence');
    expect(updateCall?.updateValues).not.toHaveProperty('source');
  });

  it('bumps stored confidence to 1.0 when source = owner', async () => {
    const { admin, calls } = makeAdmin({
      appliances: [
        { data: [{ id: APPLIANCE_ID }], error: null },
        { data: { id: APPLIANCE_ID, confidence: 1.0, source: 'owner' }, error: null },
      ],
    });

    await handleUpdateAppliance({
      admin,
      organizationId: ORG_ID,
      payload: {
        applianceRef: { applianceId: APPLIANCE_ID },
        notes: 'verified',
        source: 'owner',
      },
    });

    const updateCall = calls.find((c) => c.op === 'update');
    expect(updateCall?.updateValues).toMatchObject({
      notes: 'verified',
      source: 'owner',
      confidence: 1.0,
    });
  });

  it('returns idempotent: true when only ref is supplied (no field updates)', async () => {
    const { admin, calls } = makeAdmin({
      appliances: [
        { data: [{ id: APPLIANCE_ID }], error: null },
        // read-back of current row
        {
          data: {
            id: APPLIANCE_ID,
            type: 'fridge',
            make: 'Samsung',
            model: 'RF28',
            notes: null,
            confidence: 0.7,
            source: 'agent',
          },
          error: null,
        },
      ],
    });

    const result = await handleUpdateAppliance({
      admin,
      organizationId: ORG_ID,
      payload: { applianceRef: { applianceId: APPLIANCE_ID } },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.idempotent).toBe(true);
    expect(calls.find((c) => c.op === 'update')).toBeUndefined();
  });

  it('resolves applianceRef by name and reports confidence 0.8', async () => {
    const { admin } = makeAdmin({
      properties: [{ data: [{ id: PROPERTY_ID }], error: null }],
      appliances: [
        // resolveAppliance fuzzy lookup → single match
        { data: [{ id: APPLIANCE_ID }], error: null },
        { data: { id: APPLIANCE_ID, make: 'LG' }, error: null },
      ],
    });

    const result = await handleUpdateAppliance({
      admin,
      organizationId: ORG_ID,
      payload: {
        applianceRef: { propertyName: 'vaba', type: 'fridge' },
        make: 'LG',
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.confidence).toBe(0.8);
  });

  it('returns ambiguous_appliance on multi-match', async () => {
    const { admin } = makeAdmin({
      properties: [{ data: [{ id: PROPERTY_ID }], error: null }],
      appliances: [
        { data: [{ id: APPLIANCE_ID }, { id: 'other' }], error: null },
      ],
    });

    const result = await handleUpdateAppliance({
      admin,
      organizationId: ORG_ID,
      payload: {
        applianceRef: { propertyName: 'vaba', type: 'fridge' },
        make: 'LG',
      },
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('ambiguous_appliance');
    expect(result.confidence).toBe(0.2);
  });

  it('scopes every UPDATE by organization_id (RLS)', async () => {
    const { admin, calls } = makeAdmin({
      appliances: [
        { data: [{ id: APPLIANCE_ID }], error: null },
        { data: { id: APPLIANCE_ID }, error: null },
      ],
    });

    await handleUpdateAppliance({
      admin,
      organizationId: ORG_ID,
      payload: {
        applianceRef: { applianceId: APPLIANCE_ID },
        notes: 'x',
      },
    });

    const updateCall = calls.find((c) => c.op === 'update');
    expect(updateCall?.eqs).toContainEqual(['organization_id', ORG_ID]);
    expect(updateCall?.eqs).toContainEqual(['id', APPLIANCE_ID]);
  });
});
