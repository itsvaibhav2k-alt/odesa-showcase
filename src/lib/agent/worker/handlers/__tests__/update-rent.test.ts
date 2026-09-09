/**
 * Unit tests for handleUpdateRent.
 *
 * Covers: happy path with leaseId, idempotent no-op when rent matches,
 * tenantName resolution, ambiguous lease error, RLS scoping.
 */

import { describe, expect, it } from 'vitest';

import { handleUpdateRent } from '../update-rent';
import { LEASE_ID, ORG_ID, TENANT_ID, makeAdmin } from './__helpers';

describe('handleUpdateRent', () => {
  it('updates rent_amount when leaseRef is leaseId', async () => {
    const { admin, calls } = makeAdmin({
      leases: [
        { data: { id: LEASE_ID }, error: null }, // verify
        { data: { id: LEASE_ID, rent_amount: 1500 }, error: null }, // current read
        { data: { id: LEASE_ID, rent_amount: 2200, tenant_id: TENANT_ID }, error: null }, // update
      ],
    });

    const result = await handleUpdateRent({
      admin,
      organizationId: ORG_ID,
      payload: { leaseRef: { leaseId: LEASE_ID }, rentAmount: 2200 },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.confidence).toBe(1.0);
    expect(result.idempotent).toBe(false);

    const updateCall = calls.find((c) => c.op === 'update');
    expect(updateCall?.updateValues).toEqual({ rent_amount: 2200 });
  });

  it('returns idempotent: true when rent already matches', async () => {
    const { admin } = makeAdmin({
      leases: [
        { data: { id: LEASE_ID }, error: null }, // verify
        { data: { id: LEASE_ID, rent_amount: 2000 }, error: null }, // current
        { data: { id: LEASE_ID, rent_amount: 2000 }, error: null }, // update
      ],
    });

    const result = await handleUpdateRent({
      admin,
      organizationId: ORG_ID,
      payload: { leaseRef: { leaseId: LEASE_ID }, rentAmount: 2000 },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.idempotent).toBe(true);
  });

  it('resolves leaseRef via tenantName and reports confidence 0.8', async () => {
    const { admin } = makeAdmin({
      tenants: [{ data: [{ id: TENANT_ID }], error: null }],
      leases: [
        { data: [{ id: LEASE_ID }], error: null }, // resolveLease lookup
        { data: { id: LEASE_ID, rent_amount: 1500 }, error: null }, // current
        { data: { id: LEASE_ID, rent_amount: 1800 }, error: null }, // update
      ],
    });

    const result = await handleUpdateRent({
      admin,
      organizationId: ORG_ID,
      payload: { leaseRef: { tenantName: 'Jessica' }, rentAmount: 1800 },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.confidence).toBe(0.8);
  });

  it('returns ambiguous_lease when tenantName has 2+ active leases', async () => {
    const { admin } = makeAdmin({
      tenants: [{ data: [{ id: TENANT_ID }], error: null }],
      leases: [{ data: [{ id: 'l1' }, { id: 'l2' }], error: null }],
    });

    const result = await handleUpdateRent({
      admin,
      organizationId: ORG_ID,
      payload: { leaseRef: { tenantName: 'Jessica' }, rentAmount: 2000 },
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('ambiguous_lease');
    expect(result.confidence).toBe(0.2);
  });

  it('scopes every query by organization_id', async () => {
    const { admin, calls } = makeAdmin({
      leases: [
        { data: { id: LEASE_ID }, error: null },
        { data: { id: LEASE_ID, rent_amount: 1500 }, error: null },
        { data: { id: LEASE_ID, rent_amount: 2000 }, error: null },
      ],
    });

    await handleUpdateRent({
      admin,
      organizationId: ORG_ID,
      payload: { leaseRef: { leaseId: LEASE_ID }, rentAmount: 2000 },
    });

    for (const call of calls) {
      expect(call.eqs).toContainEqual(['organization_id', ORG_ID]);
    }
  });
});
