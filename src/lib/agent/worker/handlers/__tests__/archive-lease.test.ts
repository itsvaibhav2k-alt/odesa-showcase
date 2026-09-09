/**
 * Unit tests for handleArchiveLease.
 *
 * Covers: happy path UPDATE with leaseId, idempotent no-op when already
 * terminated, tenantName resolution, ambiguous lease error, RLS scoping.
 */

import { describe, expect, it } from 'vitest';

import { handleArchiveLease } from '../archive-lease';
import { LEASE_ID, ORG_ID, TENANT_ID, UNIT_ID, makeAdmin } from './__helpers';

describe('handleArchiveLease', () => {
  it('terminates an active lease and sets end_date', async () => {
    const { admin, calls } = makeAdmin({
      leases: [
        { data: { id: LEASE_ID }, error: null }, // verify
        {
          data: { id: LEASE_ID, status: 'active', end_date: null, tenant_id: TENANT_ID, unit_id: UNIT_ID },
          error: null,
        }, // current
        {
          data: { id: LEASE_ID, status: 'terminated', end_date: '2026-05-07', tenant_id: TENANT_ID, unit_id: UNIT_ID },
          error: null,
        }, // update
      ],
    });

    const result = await handleArchiveLease({
      admin,
      organizationId: ORG_ID,
      payload: { leaseRef: { leaseId: LEASE_ID } },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.confidence).toBe(1.0);

    const updateCall = calls.find((c) => c.op === 'update');
    expect(updateCall?.updateValues?.status).toBe('terminated');
    expect(updateCall?.updateValues?.end_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('returns idempotent: true when lease is already terminated', async () => {
    const { admin, calls } = makeAdmin({
      leases: [
        { data: { id: LEASE_ID }, error: null }, // verify
        {
          data: { id: LEASE_ID, status: 'terminated', end_date: '2026-01-01', tenant_id: TENANT_ID, unit_id: UNIT_ID },
          error: null,
        },
      ],
    });

    const result = await handleArchiveLease({
      admin,
      organizationId: ORG_ID,
      payload: { leaseRef: { leaseId: LEASE_ID } },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.idempotent).toBe(true);
    expect(calls.find((c) => c.op === 'update')).toBeUndefined();
  });

  it('resolves leaseRef via tenantName and reports confidence 0.8', async () => {
    const { admin } = makeAdmin({
      tenants: [{ data: [{ id: TENANT_ID }], error: null }],
      leases: [
        { data: [{ id: LEASE_ID }], error: null }, // resolveLease
        {
          data: { id: LEASE_ID, status: 'active', end_date: null, tenant_id: TENANT_ID, unit_id: UNIT_ID },
          error: null,
        }, // current
        {
          data: { id: LEASE_ID, status: 'terminated', end_date: '2026-05-07', tenant_id: TENANT_ID, unit_id: UNIT_ID },
          error: null,
        }, // update
      ],
    });

    const result = await handleArchiveLease({
      admin,
      organizationId: ORG_ID,
      payload: { leaseRef: { tenantName: 'Jessica' }, reason: 'tenant moved' },
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

    const result = await handleArchiveLease({
      admin,
      organizationId: ORG_ID,
      payload: { leaseRef: { tenantName: 'Jessica' } },
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('ambiguous_lease');
    expect(result.confidence).toBe(0.2);
  });

  it('scopes every lease query by organization_id', async () => {
    const { admin, calls } = makeAdmin({
      leases: [
        { data: { id: LEASE_ID }, error: null },
        { data: { id: LEASE_ID, status: 'active', end_date: null }, error: null },
        { data: { id: LEASE_ID, status: 'terminated', end_date: '2026-05-07' }, error: null },
      ],
    });

    await handleArchiveLease({
      admin,
      organizationId: ORG_ID,
      payload: { leaseRef: { leaseId: LEASE_ID } },
    });

    for (const call of calls) {
      expect(call.eqs).toContainEqual(['organization_id', ORG_ID]);
    }
  });
});
