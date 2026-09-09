/**
 * Unit tests for handleSetLeaseTerms.
 *
 * Covers: UPDATE via leaseId UUID, INSERT via tenantId+unitId pair when
 * no active lease exists, status mapping ('ended' → 'terminated'),
 * tenantName ambiguous error, RLS scoping.
 */

import { describe, expect, it } from 'vitest';

import { handleSetLeaseTerms } from '../set-lease-terms';
import {
  LEASE_ID,
  ORG_ID,
  TENANT_ID,
  UNIT_ID,
  makeAdmin,
} from './__helpers';

const TERMS = {
  rentAmount: 2000,
  rentDueDay: 1,
  startDate: '2026-06-01',
};

describe('handleSetLeaseTerms', () => {
  it('updates an existing lease when leaseRef is leaseId', async () => {
    const { admin, calls } = makeAdmin({
      leases: [
        { data: { id: LEASE_ID }, error: null }, // org-scope verify
        { data: { id: LEASE_ID, rent_amount: 2000 }, error: null }, // update
      ],
    });

    const result = await handleSetLeaseTerms({
      admin,
      organizationId: ORG_ID,
      payload: { leaseRef: { leaseId: LEASE_ID }, ...TERMS },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.confidence).toBe(1.0);

    const updateCall = calls.find((c) => c.op === 'update');
    expect(updateCall?.updateValues).toMatchObject({
      rent_amount: 2000,
      rent_due_day: 1,
      start_date: '2026-06-01',
    });
    expect(updateCall?.eqs).toContainEqual(['organization_id', ORG_ID]);
  });

  it('inserts a lease when tenantId+unitId pair has no active lease', async () => {
    const { admin, calls } = makeAdmin({
      leases: [
        { data: null, error: null }, // existing-lease lookup → none
        { data: { id: LEASE_ID, status: 'active' }, error: null }, // insert
      ],
    });

    const result = await handleSetLeaseTerms({
      admin,
      organizationId: ORG_ID,
      payload: {
        leaseRef: { tenantId: TENANT_ID, unitId: UNIT_ID },
        ...TERMS,
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.confidence).toBe(1.0);
    const insertCall = calls.find((c) => c.op === 'insert');
    expect(insertCall?.insertValues).toMatchObject({
      organization_id: ORG_ID,
      tenant_id: TENANT_ID,
      unit_id: UNIT_ID,
      status: 'active',
    });
  });

  it("maps payload status 'ended' to DB enum 'terminated'", async () => {
    const { admin, calls } = makeAdmin({
      leases: [
        { data: { id: LEASE_ID }, error: null }, // verify
        { data: { id: LEASE_ID, status: 'terminated' }, error: null }, // update
      ],
    });

    await handleSetLeaseTerms({
      admin,
      organizationId: ORG_ID,
      payload: { leaseRef: { leaseId: LEASE_ID }, ...TERMS, status: 'ended' },
    });

    const updateCall = calls.find((c) => c.op === 'update');
    expect(updateCall?.updateValues?.status).toBe('terminated');
  });

  it('returns lease_not_found_attach_unit_first when tenantName has no active or pending lease', async () => {
    const { admin } = makeAdmin({
      tenants: [{ data: [{ id: TENANT_ID }], error: null }],
      // active/pending lease lookup → empty
      leases: [{ data: [], error: null }],
    });

    const result = await handleSetLeaseTerms({
      admin,
      organizationId: ORG_ID,
      payload: {
        leaseRef: { tenantName: 'Jessica' },
        ...TERMS,
      },
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('lease_not_found_attach_unit_first');
  });

  it('updates the single pending lease when tenantName matches one tenant with one pending lease', async () => {
    const { admin, calls } = makeAdmin({
      tenants: [{ data: [{ id: TENANT_ID }], error: null }],
      leases: [
        // single pending lease found via tenantName fallback
        { data: [{ id: LEASE_ID }], error: null },
        // update result
        { data: { id: LEASE_ID, rent_amount: 2400 }, error: null },
      ],
    });

    const result = await handleSetLeaseTerms({
      admin,
      organizationId: ORG_ID,
      payload: {
        leaseRef: { tenantName: 'Test Person' },
        rentAmount: 2400,
        rentDueDay: 1,
        startDate: '2026-06-01',
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.confidence).toBe(0.8);
    const updateCall = calls.find((c) => c.op === 'update');
    expect(updateCall?.updateValues).toMatchObject({
      rent_amount: 2400,
      rent_due_day: 1,
      start_date: '2026-06-01',
    });
    expect(updateCall?.eqs).toContainEqual(['id', LEASE_ID]);
  });

  it('updates the lease for tenantName + unitLabel when a pending lease exists for the pair', async () => {
    const { admin, calls } = makeAdmin({
      tenants: [{ data: [{ id: TENANT_ID }], error: null }], // resolveTenant
      units: [{ data: [{ id: UNIT_ID }], error: null }],     // resolveUnit
      leases: [
        // pair lookup → existing
        { data: { id: LEASE_ID }, error: null },
        // update result
        { data: { id: LEASE_ID, rent_amount: 2400 }, error: null },
      ],
    });

    const result = await handleSetLeaseTerms({
      admin,
      organizationId: ORG_ID,
      payload: {
        leaseRef: { tenantName: 'Test Person', unitLabel: '1' },
        rentAmount: 2400,
        rentDueDay: 1,
        startDate: '2026-06-01',
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.confidence).toBe(0.8);
    const updateCall = calls.find((c) => c.op === 'update');
    expect(updateCall?.eqs).toContainEqual(['id', LEASE_ID]);
  });

  it('inserts a lease for tenantName + unitLabel when no lease exists for the pair', async () => {
    const { admin, calls } = makeAdmin({
      tenants: [{ data: [{ id: TENANT_ID }], error: null }],
      units: [{ data: [{ id: UNIT_ID }], error: null }],
      leases: [
        // pair lookup → none
        { data: null, error: null },
        // insert result
        { data: { id: LEASE_ID, status: 'active' }, error: null },
      ],
    });

    const result = await handleSetLeaseTerms({
      admin,
      organizationId: ORG_ID,
      payload: {
        leaseRef: { tenantName: 'Test Person', unitLabel: '1' },
        rentAmount: 2400,
        rentDueDay: 1,
        startDate: '2026-06-01',
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.confidence).toBe(0.8);
    const insertCall = calls.find((c) => c.op === 'insert');
    expect(insertCall?.insertValues).toMatchObject({
      organization_id: ORG_ID,
      tenant_id: TENANT_ID,
      unit_id: UNIT_ID,
      rent_amount: 2400,
      rent_due_day: 1,
      start_date: '2026-06-01',
      status: 'active',
    });
  });

  it('returns ambiguous_lease when tenantName has multiple active leases', async () => {
    const { admin } = makeAdmin({
      tenants: [{ data: [{ id: TENANT_ID }], error: null }],
      leases: [{ data: [{ id: 'l1' }, { id: 'l2' }], error: null }],
    });

    const result = await handleSetLeaseTerms({
      admin,
      organizationId: ORG_ID,
      payload: {
        leaseRef: { tenantName: 'Jessica' },
        ...TERMS,
      },
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('ambiguous_lease');
    expect(result.confidence).toBe(0.2);
  });

  it('scopes every leases query by organization_id', async () => {
    const { admin, calls } = makeAdmin({
      leases: [
        { data: { id: LEASE_ID }, error: null },
        { data: { id: LEASE_ID }, error: null },
      ],
    });

    await handleSetLeaseTerms({
      admin,
      organizationId: ORG_ID,
      payload: { leaseRef: { leaseId: LEASE_ID }, ...TERMS },
    });

    for (const call of calls) {
      expect(call.eqs).toContainEqual(['organization_id', ORG_ID]);
    }
  });
});
