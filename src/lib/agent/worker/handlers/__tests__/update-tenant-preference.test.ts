/**
 * Unit tests for handleUpdateTenantPreference.
 *
 * Covers: happy path with tenantId UUID + only one column updated,
 * pets array stored as snake_case jsonb, owner-source confidence bump,
 * idempotent path when no fields supplied, ambiguous tenant, RLS
 * scoping.
 */

import { describe, expect, it } from 'vitest';

import { handleUpdateTenantPreference } from '../update-tenant-preference';
import { ORG_ID, TENANT_ID, makeAdmin } from './__helpers';

describe('handleUpdateTenantPreference', () => {
  it('updates only the columns supplied (preferred_channel)', async () => {
    const { admin, calls } = makeAdmin({
      tenants: [
        { data: { id: TENANT_ID }, error: null }, // resolveTenant via UUID
        {
          data: {
            id: TENANT_ID,
            full_name: 'Test Person',
            preferred_channel: 'email',
            language: 'en',
          },
          error: null,
        },
      ],
    });

    const result = await handleUpdateTenantPreference({
      admin,
      organizationId: ORG_ID,
      payload: {
        tenantRef: { tenantId: TENANT_ID },
        preferredChannel: 'email',
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const updateCall = calls.find((c) => c.op === 'update');
    expect(updateCall?.updateValues).toMatchObject({
      preferred_channel: 'email',
      preferences_source: 'agent',
      preferences_confidence: 0.7,
    });
    // Must NOT touch unrelated columns.
    expect(updateCall?.updateValues).not.toHaveProperty('language');
    expect(updateCall?.updateValues).not.toHaveProperty('parking_space');
    expect(updateCall?.updateValues).not.toHaveProperty('pets_jsonb');
  });

  it('persists pets array as snake_case jsonb', async () => {
    const { admin, calls } = makeAdmin({
      tenants: [
        { data: { id: TENANT_ID }, error: null },
        {
          data: { id: TENANT_ID, full_name: 'Test Person' },
          error: null,
        },
      ],
    });

    await handleUpdateTenantPreference({
      admin,
      organizationId: ORG_ID,
      payload: {
        tenantRef: { tenantId: TENANT_ID },
        pets: [
          { type: 'dog', name: 'Rex', depositPaid: true },
          { type: 'cat' },
        ],
      },
    });

    const updateCall = calls.find((c) => c.op === 'update');
    expect(updateCall?.updateValues?.pets_jsonb).toEqual([
      { type: 'dog', name: 'Rex', deposit_paid: true },
      { type: 'cat', name: null, deposit_paid: false },
    ]);
  });

  it('bumps preferences_confidence to 1.0 when source = owner', async () => {
    const { admin, calls } = makeAdmin({
      tenants: [
        { data: { id: TENANT_ID }, error: null },
        { data: { id: TENANT_ID, full_name: 'Test Person' }, error: null },
      ],
    });

    await handleUpdateTenantPreference({
      admin,
      organizationId: ORG_ID,
      payload: {
        tenantRef: { tenantId: TENANT_ID },
        parkingSpace: '12B',
        source: 'owner',
      },
    });

    const updateCall = calls.find((c) => c.op === 'update');
    expect(updateCall?.updateValues).toMatchObject({
      parking_space: '12B',
      preferences_source: 'owner',
      preferences_confidence: 1.0,
    });
  });

  it('returns idempotent when no preference fields supplied', async () => {
    const { admin, calls } = makeAdmin({
      tenants: [
        { data: { id: TENANT_ID }, error: null },
        {
          data: { id: TENANT_ID, full_name: 'Test Person' },
          error: null,
        },
      ],
    });

    const result = await handleUpdateTenantPreference({
      admin,
      organizationId: ORG_ID,
      payload: { tenantRef: { tenantId: TENANT_ID } },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.idempotent).toBe(true);
    expect(calls.find((c) => c.op === 'update')).toBeUndefined();
  });

  it('returns ambiguous_tenant on multi-match by name', async () => {
    const { admin } = makeAdmin({
      tenants: [{ data: [{ id: TENANT_ID }, { id: 'other' }], error: null }],
    });

    const result = await handleUpdateTenantPreference({
      admin,
      organizationId: ORG_ID,
      payload: {
        tenantRef: { tenantName: 'Test' },
        preferredChannel: 'sms',
      },
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('ambiguous_tenant');
    expect(result.confidence).toBe(0.2);
  });

  it('scopes every query by organization_id (RLS)', async () => {
    const { admin, calls } = makeAdmin({
      tenants: [
        { data: { id: TENANT_ID }, error: null },
        { data: { id: TENANT_ID, full_name: 'X' }, error: null },
      ],
    });

    await handleUpdateTenantPreference({
      admin,
      organizationId: ORG_ID,
      payload: {
        tenantRef: { tenantId: TENANT_ID },
        language: 'es',
      },
    });

    for (const call of calls) {
      expect(call.eqs).toContainEqual(['organization_id', ORG_ID]);
    }
  });
});
