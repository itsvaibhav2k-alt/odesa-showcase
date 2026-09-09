/**
 * Unit tests for handleCreateProperty.
 *
 * Covers: happy path INSERT, idempotency on (name + street + org),
 * validation/error path, and RLS scoping (every query filters
 * organization_id).
 */

import { describe, expect, it } from 'vitest';

import { handleCreateProperty } from '../create-property';
import { ORG_ID, PROPERTY_ID, makeAdmin } from './__helpers';

const PAYLOAD = {
  name: 'Vaba House',
  addressStreet: '25911 Sycamore Grove Pl',
  addressCity: 'Aldie',
  addressState: 'VA',
  addressZip: '20105',
};

describe('handleCreateProperty', () => {
  it('inserts a new property when no row exists for the natural key', async () => {
    const { admin, calls } = makeAdmin({
      properties: [
        // idempotency lookup → none
        { data: null, error: null },
        // insert returning row
        {
          data: { id: PROPERTY_ID, name: PAYLOAD.name, address_street: PAYLOAD.addressStreet },
          error: null,
        },
      ],
    });

    const result = await handleCreateProperty({
      admin,
      organizationId: ORG_ID,
      payload: PAYLOAD,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.confidence).toBe(1.0);
    expect(result.idempotent).toBeUndefined();
    expect(result.data).toMatchObject({ id: PROPERTY_ID });

    expect(calls[0].op).toBe('select');
    expect(calls[1].op).toBe('insert');
    // Insert payload contains org_id + the address fields.
    expect(calls[1].insertValues).toMatchObject({
      organization_id: ORG_ID,
      name: PAYLOAD.name,
      address_street: PAYLOAD.addressStreet,
      address_city: PAYLOAD.addressCity,
      address_state: PAYLOAD.addressState,
      address_zip: PAYLOAD.addressZip,
      timezone: 'America/New_York',
    });
  });

  it('returns idempotent: true when the natural key already exists', async () => {
    const { admin, calls } = makeAdmin({
      properties: [
        {
          data: { id: PROPERTY_ID, name: PAYLOAD.name, address_street: PAYLOAD.addressStreet },
          error: null,
        },
      ],
    });

    const result = await handleCreateProperty({
      admin,
      organizationId: ORG_ID,
      payload: PAYLOAD,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.idempotent).toBe(true);
    expect(result.data).toMatchObject({ id: PROPERTY_ID });
    // Only the lookup ran — no insert.
    expect(calls).toHaveLength(1);
    expect(calls[0].op).toBe('select');
  });

  it('returns ok: false on insert error', async () => {
    const { admin } = makeAdmin({
      properties: [
        { data: null, error: null }, // lookup → none
        { data: null, error: { message: 'unique_violation' } }, // insert fails
      ],
    });

    const result = await handleCreateProperty({
      admin,
      organizationId: ORG_ID,
      payload: PAYLOAD,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('unique_violation');
  });

  it('scopes every query by organization_id', async () => {
    const { admin, calls } = makeAdmin({
      properties: [
        { data: null, error: null },
        { data: { id: PROPERTY_ID }, error: null },
      ],
    });

    await handleCreateProperty({
      admin,
      organizationId: ORG_ID,
      payload: PAYLOAD,
    });

    // Lookup query filters org_id + name + street.
    const lookupEqColumns = calls[0].eqs.map(([k]) => k);
    expect(lookupEqColumns).toContain('organization_id');
    expect(calls[0].eqs).toContainEqual(['organization_id', ORG_ID]);

    // Insert payload is org-scoped.
    expect(calls[1].insertValues?.organization_id).toBe(ORG_ID);
  });

  it('uses the supplied timezone when present', async () => {
    const { admin, calls } = makeAdmin({
      properties: [
        { data: null, error: null },
        { data: { id: PROPERTY_ID }, error: null },
      ],
    });

    await handleCreateProperty({
      admin,
      organizationId: ORG_ID,
      payload: { ...PAYLOAD, timezone: 'America/Los_Angeles' },
    });

    expect(calls[1].insertValues?.timezone).toBe('America/Los_Angeles');
  });
});
