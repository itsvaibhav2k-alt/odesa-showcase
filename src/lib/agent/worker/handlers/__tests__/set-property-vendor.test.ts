/**
 * Unit tests for handleSetPropertyVendor.
 *
 * Covers: insert with both refs by UUID, idempotency on PK
 * (org, property, category) when nothing changed, update-on-vendor-
 * change, name resolution path, ambiguous vendor, RLS scoping.
 */

import { describe, expect, it } from 'vitest';

import { handleSetPropertyVendor } from '../set-property-vendor';
import { ORG_ID, PROPERTY_ID, makeAdmin } from './__helpers';

const VENDOR_ID = '88888888-8888-4888-8888-888888888888';
const NEW_VENDOR_ID = '99999999-9999-4999-8999-999999999999';

const BY_ID_PAYLOAD = {
  propertyRef: { propertyId: PROPERTY_ID },
  category: 'plumbing' as const,
  vendorRef: { vendorId: VENDOR_ID },
};

describe('handleSetPropertyVendor', () => {
  it('inserts a row when no existing assignment exists', async () => {
    const { admin, calls } = makeAdmin({
      properties: [{ data: { id: PROPERTY_ID }, error: null }],
      vendors: [{ data: [{ id: VENDOR_ID }], error: null }],
      property_vendors: [
        { data: null, error: null }, // idempotency lookup → none
        {
          data: {
            property_id: PROPERTY_ID,
            category: 'plumbing',
            vendor_id: VENDOR_ID,
          },
          error: null,
        },
      ],
    });

    const result = await handleSetPropertyVendor({
      admin,
      organizationId: ORG_ID,
      payload: BY_ID_PAYLOAD,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.confidence).toBe(1.0);

    const insertCall = calls.find((c) => c.op === 'insert');
    expect(insertCall?.insertValues).toMatchObject({
      organization_id: ORG_ID,
      property_id: PROPERTY_ID,
      category: 'plumbing',
      vendor_id: VENDOR_ID,
      confidence: 0.7,
      source: 'agent',
    });
  });

  it('returns idempotent: true when row exists with same vendor + no notes drift', async () => {
    const { admin, calls } = makeAdmin({
      properties: [{ data: { id: PROPERTY_ID }, error: null }],
      vendors: [{ data: [{ id: VENDOR_ID }], error: null }],
      property_vendors: [
        {
          data: {
            vendor_id: VENDOR_ID,
            notes: null,
            confidence: 0.7,
            source: 'agent',
          },
          error: null,
        },
      ],
    });

    const result = await handleSetPropertyVendor({
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

  it('updates vendor_id on conflict when assignment changes', async () => {
    const { admin, calls } = makeAdmin({
      properties: [{ data: { id: PROPERTY_ID }, error: null }],
      vendors: [{ data: [{ id: NEW_VENDOR_ID }], error: null }],
      property_vendors: [
        {
          data: {
            vendor_id: VENDOR_ID,
            notes: null,
            confidence: 0.7,
            source: 'agent',
          },
          error: null,
        },
        {
          data: { vendor_id: NEW_VENDOR_ID, category: 'plumbing' },
          error: null,
        },
      ],
    });

    const result = await handleSetPropertyVendor({
      admin,
      organizationId: ORG_ID,
      payload: {
        propertyRef: { propertyId: PROPERTY_ID },
        category: 'plumbing',
        vendorRef: { vendorId: NEW_VENDOR_ID },
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.idempotent).toBe(false);
    const updateCall = calls.find((c) => c.op === 'update');
    expect(updateCall?.updateValues).toMatchObject({ vendor_id: NEW_VENDOR_ID });
  });

  it('resolves vendorName ref and reports confidence 0.8', async () => {
    const { admin } = makeAdmin({
      properties: [{ data: { id: PROPERTY_ID }, error: null }],
      // resolveVendor by name → single match
      vendors: [{ data: [{ id: VENDOR_ID }], error: null }],
      property_vendors: [
        { data: null, error: null },
        { data: { vendor_id: VENDOR_ID }, error: null },
      ],
    });

    const result = await handleSetPropertyVendor({
      admin,
      organizationId: ORG_ID,
      payload: {
        propertyRef: { propertyId: PROPERTY_ID },
        category: 'plumbing',
        vendorRef: { vendorName: 'Joe Plumbing' },
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.confidence).toBe(0.8);
  });

  it('returns ambiguous_vendor when name matches multiple', async () => {
    const { admin } = makeAdmin({
      properties: [{ data: { id: PROPERTY_ID }, error: null }],
      vendors: [{ data: [{ id: VENDOR_ID }, { id: 'other' }], error: null }],
    });

    const result = await handleSetPropertyVendor({
      admin,
      organizationId: ORG_ID,
      payload: {
        propertyRef: { propertyId: PROPERTY_ID },
        category: 'plumbing',
        vendorRef: { vendorName: 'plumbing' },
      },
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('ambiguous_vendor');
    expect(result.confidence).toBe(0.2);
  });

  it('scopes every query by organization_id (RLS)', async () => {
    const { admin, calls } = makeAdmin({
      properties: [{ data: { id: PROPERTY_ID }, error: null }],
      vendors: [{ data: [{ id: VENDOR_ID }], error: null }],
      property_vendors: [
        { data: null, error: null },
        { data: { vendor_id: VENDOR_ID }, error: null },
      ],
    });

    await handleSetPropertyVendor({
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
});
