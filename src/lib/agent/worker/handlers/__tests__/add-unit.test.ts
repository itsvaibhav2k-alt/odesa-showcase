/**
 * Unit tests for handleAddUnit.
 *
 * Covers: happy path with propertyId ref, name resolution path,
 * idempotency on (property_id + label), ambiguous property error,
 * tenant-name label guard, and RLS scoping.
 */

import { describe, expect, it } from 'vitest';

import { handleAddUnit } from '../add-unit';
import { ORG_ID, PROPERTY_ID, TENANT_ID, UNIT_ID, makeAdmin } from './__helpers';

const BY_ID_PAYLOAD = {
  propertyRef: { propertyId: PROPERTY_ID },
  label: '2B',
  bedrooms: 2,
  bathrooms: 1,
};

describe('handleAddUnit', () => {
  it('inserts a new unit when ref is propertyId and no duplicate exists', async () => {
    const { admin, calls } = makeAdmin({
      properties: [
        { data: { id: PROPERTY_ID }, error: null }, // verify org-scope
      ],
      units: [
        { data: null, error: null }, // idempotency lookup → none
        { data: { id: UNIT_ID, label: '2B', property_id: PROPERTY_ID }, error: null }, // insert
      ],
    });

    const result = await handleAddUnit({
      admin,
      organizationId: ORG_ID,
      payload: BY_ID_PAYLOAD,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.confidence).toBe(1.0);
    expect(result.idempotent).toBeUndefined();
    expect(result.data).toMatchObject({ id: UNIT_ID });
    // 1 properties query + 2 units queries.
    expect(calls.filter((c) => c.table === 'units')).toHaveLength(2);
    expect(calls.filter((c) => c.op === 'insert')[0].insertValues).toMatchObject({
      organization_id: ORG_ID,
      property_id: PROPERTY_ID,
      label: '2B',
      bedrooms: 2,
      bathrooms: 1,
    });
  });

  it('returns idempotent: true when same property + label + fields exist', async () => {
    const { admin, calls } = makeAdmin({
      properties: [{ data: { id: PROPERTY_ID }, error: null }],
      units: [
        {
          data: {
            id: UNIT_ID,
            label: '2B',
            bedrooms: 2,
            bathrooms: 1,
            square_feet: null,
            property_id: PROPERTY_ID,
          },
          error: null,
        },
      ],
    });

    const result = await handleAddUnit({
      admin,
      organizationId: ORG_ID,
      payload: BY_ID_PAYLOAD,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.idempotent).toBe(true);
    // No insert/update call.
    expect(calls.find((c) => c.op === 'insert')).toBeUndefined();
    expect(calls.find((c) => c.op === 'update')).toBeUndefined();
  });

  it('updates existing unit when bedrooms/bathrooms differ from payload', async () => {
    const { admin, calls } = makeAdmin({
      properties: [{ data: { id: PROPERTY_ID }, error: null }],
      units: [
        // Existing unit is 1br/1ba — payload wants 3br/2ba.
        {
          data: {
            id: UNIT_ID,
            label: '1',
            bedrooms: 1,
            bathrooms: 1,
            square_feet: null,
            property_id: PROPERTY_ID,
          },
          error: null,
        },
        {
          data: {
            id: UNIT_ID,
            label: '1',
            bedrooms: 3,
            bathrooms: 2,
            square_feet: null,
            property_id: PROPERTY_ID,
          },
          error: null,
        }, // update result
      ],
    });

    const result = await handleAddUnit({
      admin,
      organizationId: ORG_ID,
      payload: {
        propertyRef: { propertyId: PROPERTY_ID },
        label: '1',
        bedrooms: 3,
        bathrooms: 2,
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.idempotent).toBe(false);
    expect(result.reasoning).toContain('Updated existing unit');

    const updateCall = calls.find((c) => c.op === 'update');
    expect(updateCall).toBeDefined();
    expect(updateCall?.updateValues).toMatchObject({ bedrooms: 3, bathrooms: 2 });
    // square_feet must NOT appear when payload omits it.
    expect(updateCall?.updateValues).not.toHaveProperty('square_feet');
    expect(updateCall?.eqs).toContainEqual(['organization_id', ORG_ID]);
    expect(updateCall?.eqs).toContainEqual(['id', UNIT_ID]);
  });

  it('does NOT update when only squareFeet is omitted but bed/bath match', async () => {
    const { admin, calls } = makeAdmin({
      properties: [{ data: { id: PROPERTY_ID }, error: null }],
      units: [
        {
          data: {
            id: UNIT_ID,
            label: '2B',
            bedrooms: 2,
            bathrooms: 1,
            square_feet: 800, // existing has sqft
            property_id: PROPERTY_ID,
          },
          error: null,
        },
      ],
    });

    const result = await handleAddUnit({
      admin,
      organizationId: ORG_ID,
      payload: BY_ID_PAYLOAD, // no squareFeet — must not clobber existing 800
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.idempotent).toBe(true);
    expect(calls.find((c) => c.op === 'update')).toBeUndefined();
  });

  it('resolves propertyName ref and reports confidence 0.8', async () => {
    const { admin } = makeAdmin({
      // resolveProperty sees ilike → returns single match
      properties: [{ data: [{ id: PROPERTY_ID }], error: null }],
      units: [
        { data: null, error: null },
        { data: { id: UNIT_ID }, error: null },
      ],
    });

    const result = await handleAddUnit({
      admin,
      organizationId: ORG_ID,
      payload: { ...BY_ID_PAYLOAD, propertyRef: { propertyName: 'Vaba' } },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.confidence).toBe(0.8);
  });

  it('returns ambiguous_property when name matches multiple', async () => {
    const { admin } = makeAdmin({
      properties: [{ data: [{ id: PROPERTY_ID }, { id: 'p2' }], error: null }],
    });

    const result = await handleAddUnit({
      admin,
      organizationId: ORG_ID,
      payload: { ...BY_ID_PAYLOAD, propertyRef: { propertyName: 'house' } },
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('ambiguous_property');
    expect(result.confidence).toBe(0.2);
  });

  it('scopes every query by organization_id', async () => {
    const { admin, calls } = makeAdmin({
      properties: [{ data: { id: PROPERTY_ID }, error: null }],
      tenants: [{ data: [], error: null }],
      units: [
        { data: null, error: null },
        { data: { id: UNIT_ID }, error: null },
      ],
    });

    await handleAddUnit({
      admin,
      organizationId: ORG_ID,
      payload: BY_ID_PAYLOAD,
    });

    // properties verification + tenants guard + units lookup all org-scoped.
    expect(calls[0].eqs).toContainEqual(['organization_id', ORG_ID]);
    expect(calls[1].table).toBe('tenants');
    expect(calls[1].eqs).toContainEqual(['organization_id', ORG_ID]);
    expect(calls[2].eqs).toContainEqual(['organization_id', ORG_ID]);
    // Insert insertValues carries the org id.
    expect(calls[3].insertValues?.organization_id).toBe(ORG_ID);
  });

  describe('tenant-name label guard', () => {
    const TENANTS = [
      { data: [{ id: TENANT_ID, full_name: 'Hannah Anders' }], error: null },
    ];

    const guardPayload = (label: string) => ({
      propertyRef: { propertyId: PROPERTY_ID },
      label,
      bedrooms: 1,
      bathrooms: 1,
    });

    const runGuard = async (label: string, accepted: boolean) => {
      const { admin, calls } = makeAdmin({
        properties: [{ data: { id: PROPERTY_ID }, error: null }],
        tenants: [...TENANTS],
        units: accepted
          ? [
              { data: null, error: null },
              { data: { id: UNIT_ID, label }, error: null },
            ]
          : [],
      });

      const result = await handleAddUnit({
        admin,
        organizationId: ORG_ID,
        payload: guardPayload(label),
      });

      return { result, calls };
    };

    it('rejects a label equal to a same-org tenant full name', async () => {
      const { result, calls } = await runGuard('Hannah Anders', false);

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toBe('label_looks_like_tenant_name');
      expect(result.confidence).toBe(0.2);
      // Never reaches the units table.
      expect(calls.find((c) => c.table === 'units')).toBeUndefined();
      expect(calls.find((c) => c.op === 'insert')).toBeUndefined();
    });

    it('rejects case and whitespace variants of the tenant name', async () => {
      const { result } = await runGuard('  HANNAH   anders ', false);

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toBe('label_looks_like_tenant_name');
    });

    it('rejects punctuation variants of the tenant name', async () => {
      const { result } = await runGuard('Hannah-Anders.', false);

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toBe('label_looks_like_tenant_name');
    });

    it('rejects first+last tokens concatenated', async () => {
      const { result } = await runGuard('HannahAnders', false);

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toBe('label_looks_like_tenant_name');
    });

    it('rejects two alphabetic words matching tenant name tokens reversed', async () => {
      const { result } = await runGuard('Anders Hannah', false);

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toBe('label_looks_like_tenant_name');
    });

    it('accepts "Unit A" even with tenant "Hannah Anders" (no substring match)', async () => {
      const { result } = await runGuard('Unit A', true);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data).toMatchObject({ id: UNIT_ID });
    });

    it('accepts the single-letter label "A"', async () => {
      const { result } = await runGuard('A', true);

      expect(result.ok).toBe(true);
    });

    it('accepts "Apt 4"', async () => {
      const { result } = await runGuard('Apt 4', true);

      expect(result.ok).toBe(true);
    });

    it('accepts pure numeric "101" without querying tenants', async () => {
      const { result, calls } = await runGuard('101', true);

      expect(result.ok).toBe(true);
      // No letters in the label → no tenant lookup at all.
      expect(calls.find((c) => c.table === 'tenants')).toBeUndefined();
    });

    it('returns tenant_lookup_failed when the tenants query errors', async () => {
      const { admin } = makeAdmin({
        properties: [{ data: { id: PROPERTY_ID }, error: null }],
        tenants: [{ data: null, error: { message: 'boom' } }],
      });

      const result = await handleAddUnit({
        admin,
        organizationId: ORG_ID,
        payload: guardPayload('Unit A'),
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toBe('tenant_lookup_failed: boom');
      expect(result.confidence).toBe(0);
    });
  });
});
