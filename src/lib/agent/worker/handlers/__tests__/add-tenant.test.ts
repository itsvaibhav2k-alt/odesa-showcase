/**
 * Unit tests for handleAddTenant.
 *
 * Covers: happy path INSERT (no unit), idempotency on phone+org,
 * with-unit path that also creates a draft lease, ambiguous unit
 * error, and RLS scoping.
 */

import { describe, expect, it } from 'vitest';

import { handleAddTenant } from '../add-tenant';
import { LEASE_ID, ORG_ID, TENANT_ID, UNIT_ID, makeAdmin } from './__helpers';

const PAYLOAD_NO_UNIT = {
  fullName: 'Jessica Ramirez',
  phoneE164: '+15551234567',
  email: 'jess@example.com',
};

describe('handleAddTenant', () => {
  it('inserts a tenant without a draft lease when no unitRef is given', async () => {
    const { admin, calls } = makeAdmin({
      tenants: [
        { data: null, error: null }, // idempotency lookup → none
        { data: { id: TENANT_ID, full_name: PAYLOAD_NO_UNIT.fullName }, error: null }, // insert
      ],
    });

    const result = await handleAddTenant({
      admin,
      organizationId: ORG_ID,
      payload: PAYLOAD_NO_UNIT,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.confidence).toBe(1.0);
    expect((result.data as { draftLeaseId: string | null }).draftLeaseId).toBeNull();
    expect(calls.find((c) => c.table === 'leases')).toBeUndefined();
    expect(calls[1].insertValues).toMatchObject({
      organization_id: ORG_ID,
      full_name: PAYLOAD_NO_UNIT.fullName,
      phone_e164: PAYLOAD_NO_UNIT.phoneE164,
      email: PAYLOAD_NO_UNIT.email,
    });
  });

  it('returns idempotent: true when phone matches existing tenant', async () => {
    const { admin, calls } = makeAdmin({
      tenants: [
        {
          data: { id: TENANT_ID, full_name: PAYLOAD_NO_UNIT.fullName, phone_e164: PAYLOAD_NO_UNIT.phoneE164 },
          error: null,
        },
      ],
    });

    const result = await handleAddTenant({
      admin,
      organizationId: ORG_ID,
      payload: PAYLOAD_NO_UNIT,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.idempotent).toBe(true);
    expect(calls).toHaveLength(1);
  });

  it('inserts a draft lease when unitRef is provided', async () => {
    const { admin, calls } = makeAdmin({
      units: [{ data: { id: UNIT_ID }, error: null }], // unitRef verify
      tenants: [
        { data: null, error: null }, // idempotency
        { data: { id: TENANT_ID, full_name: 'Alice' }, error: null }, // insert
      ],
      leases: [{ data: { id: LEASE_ID }, error: null }], // draft lease insert
    });

    const result = await handleAddTenant({
      admin,
      organizationId: ORG_ID,
      payload: {
        fullName: 'Alice',
        phoneE164: '+15559876543',
        unitRef: { unitId: UNIT_ID },
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect((result.data as { draftLeaseId: string | null }).draftLeaseId).toBe(LEASE_ID);

    const leaseInsert = calls.find((c) => c.table === 'leases' && c.op === 'insert');
    expect(leaseInsert?.insertValues).toMatchObject({
      organization_id: ORG_ID,
      tenant_id: TENANT_ID,
      unit_id: UNIT_ID,
      status: 'pending',
      rent_amount: 0,
      rent_due_day: 1,
    });
  });

  it('creates a draft lease when existing tenant has no lease for the new unit', async () => {
    const { admin, calls } = makeAdmin({
      // unitRef verify (UUID path)
      units: [{ data: { id: UNIT_ID }, error: null }],
      // tenant lookup → existing tenant
      tenants: [
        {
          data: {
            id: TENANT_ID,
            full_name: 'Test Person',
            phone_e164: '+15555550100',
          },
          error: null,
        },
      ],
      leases: [
        // pair lookup → none
        { data: null, error: null },
        // draft lease insert
        { data: { id: LEASE_ID }, error: null },
      ],
    });

    const result = await handleAddTenant({
      admin,
      organizationId: ORG_ID,
      payload: {
        fullName: 'Test Person',
        phoneE164: '+15555550100',
        unitRef: { unitId: UNIT_ID },
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect((result.data as { draftLeaseId: string | null }).draftLeaseId).toBe(LEASE_ID);
    expect(result.idempotent).toBe(false);

    const leaseInsert = calls.find(
      (c) => c.table === 'leases' && c.op === 'insert',
    );
    expect(leaseInsert?.insertValues).toMatchObject({
      organization_id: ORG_ID,
      tenant_id: TENANT_ID,
      unit_id: UNIT_ID,
      status: 'pending',
      rent_amount: 0,
      rent_due_day: 1,
    });
  });

  it('reuses existing pending lease when tenant + unit already linked', async () => {
    const { admin, calls } = makeAdmin({
      units: [{ data: { id: UNIT_ID }, error: null }],
      tenants: [
        {
          data: { id: TENANT_ID, full_name: 'Test Person' },
          error: null,
        },
      ],
      leases: [
        // pair lookup → existing pending lease
        { data: { id: LEASE_ID }, error: null },
      ],
    });

    const result = await handleAddTenant({
      admin,
      organizationId: ORG_ID,
      payload: {
        fullName: 'Test Person',
        phoneE164: '+15555550100',
        unitRef: { unitId: UNIT_ID },
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect((result.data as { draftLeaseId: string | null }).draftLeaseId).toBe(LEASE_ID);
    // No second leases insert.
    expect(
      calls.filter((c) => c.table === 'leases' && c.op === 'insert'),
    ).toHaveLength(0);
  });

  it('returns ambiguous_unit when unitRef name resolution is ambiguous', async () => {
    const { admin } = makeAdmin({
      // resolveUnit(propertyName='House') → resolveProperty matches one,
      // then units lookup matches multiple → ambiguous.
      properties: [{ data: [{ id: 'prop-1' }], error: null }],
      units: [{ data: [{ id: UNIT_ID }, { id: 'u2' }], error: null }],
    });

    const result = await handleAddTenant({
      admin,
      organizationId: ORG_ID,
      payload: {
        fullName: 'Bob',
        phoneE164: '+15550001111',
        unitRef: { unitLabel: 'A', propertyName: 'House' },
      },
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('ambiguous_unit');
    expect(result.confidence).toBe(0.2);
  });

  it('scopes every query by organization_id', async () => {
    const { admin, calls } = makeAdmin({
      tenants: [
        { data: null, error: null },
        { data: { id: TENANT_ID }, error: null },
      ],
    });

    await handleAddTenant({
      admin,
      organizationId: ORG_ID,
      payload: PAYLOAD_NO_UNIT,
    });

    // Idempotency lookup is org-scoped.
    expect(calls[0].eqs).toContainEqual(['organization_id', ORG_ID]);
    // Insert is org-scoped.
    expect(calls[1].insertValues?.organization_id).toBe(ORG_ID);
  });
});
