/**
 * Wave 6 — payload schema parsing assertions.
 *
 * The 9 new write-action payload schemas live alongside the original
 * 5 in `WORKER_PAYLOAD_SCHEMAS`. These tests guard the discriminator
 * map (every action_type maps to a real schema) and lock the happy +
 * reject behaviour for each new schema so a downstream change can't
 * silently widen / narrow the contract.
 */

import { describe, expect, it } from 'vitest';

import {
  WORKER_ACTION_TYPES,
  WORKER_PAYLOAD_SCHEMAS,
  addTenantPayloadSchema,
  addUnitPayloadSchema,
  archiveLeasePayloadSchema,
  createPropertyPayloadSchema,
  logMaintenanceTicketPayloadSchema,
  sendTenantMessagePayloadSchema,
  setLeaseTermsPayloadSchema,
  updatePropertyRulesPayloadSchema,
  updateRentPayloadSchema,
} from '../types';

describe('WORKER_PAYLOAD_SCHEMAS', () => {
  it('has a schema entry for every WORKER_ACTION_TYPES member', () => {
    for (const action of WORKER_ACTION_TYPES) {
      expect(WORKER_PAYLOAD_SCHEMAS[action]).toBeDefined();
    }
  });

  it('exposes 25 action_types (5 v1 + 1 v2 polish + 10 wave-6 + 7 wave-7 + 1 health + 1 voice)', () => {
    expect(WORKER_ACTION_TYPES.length).toBe(25);
  });

  it('keeps every wave-6 action_type registered', () => {
    const wave6 = [
      'create_property',
      'add_unit',
      'add_tenant',
      'set_lease_terms',
      'update_rent',
      'send_tenant_message',
      'log_maintenance_ticket',
      'update_property_rules',
      'archive_lease',
    ] as const;
    for (const a of wave6) {
      expect(WORKER_ACTION_TYPES).toContain(a);
      expect(WORKER_PAYLOAD_SCHEMAS[a]).toBeDefined();
    }
  });
});

describe('createPropertyPayloadSchema', () => {
  it('accepts a fully-specified property', () => {
    const parsed = createPropertyPayloadSchema.safeParse({
      name: 'Vaba House',
      addressStreet: '25911 Sycamore Grove Pl',
      addressCity: 'Aldie',
      addressState: 'VA',
      addressZip: '20105',
      timezone: 'America/New_York',
    });
    expect(parsed.success).toBe(true);
  });

  it('accepts when timezone is omitted', () => {
    const parsed = createPropertyPayloadSchema.safeParse({
      name: 'Vaba House',
      addressStreet: '25911 Sycamore Grove Pl',
      addressCity: 'Aldie',
      addressState: 'VA',
      addressZip: '20105',
    });
    expect(parsed.success).toBe(true);
  });

  it('rejects 1-char state', () => {
    const parsed = createPropertyPayloadSchema.safeParse({
      name: 'Vaba House',
      addressStreet: '25911 Sycamore Grove Pl',
      addressCity: 'Aldie',
      addressState: 'V',
      addressZip: '20105',
    });
    expect(parsed.success).toBe(false);
  });

  it('rejects empty name', () => {
    const parsed = createPropertyPayloadSchema.safeParse({
      name: '',
      addressStreet: '1 Main St',
      addressCity: 'Aldie',
      addressState: 'VA',
      addressZip: '20105',
    });
    expect(parsed.success).toBe(false);
  });
});

describe('addUnitPayloadSchema', () => {
  it('accepts propertyRef as id or name', () => {
    expect(
      addUnitPayloadSchema.safeParse({
        propertyRef: { propertyId: '11111111-1111-4111-8111-111111111111' },
        label: 'A',
        bedrooms: 2,
        bathrooms: 1,
      }).success,
    ).toBe(true);
    expect(
      addUnitPayloadSchema.safeParse({
        propertyRef: { propertyName: 'Vaba House' },
        label: 'A',
        bedrooms: 2,
        bathrooms: 1.5,
        squareFeet: 900,
      }).success,
    ).toBe(true);
  });

  it('coerces non-uuid propertyId into propertyName (LLM forgiveness)', () => {
    // Sonnet 4.6 sometimes sends `{ propertyId: "vaba house" }` —
    // we treat the value as a name lookup rather than rejecting,
    // so the handler can resolve via substring match.
    const parsed = addUnitPayloadSchema.safeParse({
      propertyRef: { propertyId: 'not-a-uuid' },
      label: 'A',
      bedrooms: 2,
      bathrooms: 1,
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.propertyRef).toEqual({ propertyName: 'not-a-uuid' });
    }
  });

  it('rejects negative bedroom count', () => {
    expect(
      addUnitPayloadSchema.safeParse({
        propertyRef: { propertyName: 'Vaba House' },
        label: 'A',
        bedrooms: -1,
        bathrooms: 1,
      }).success,
    ).toBe(false);
  });
});

describe('addTenantPayloadSchema', () => {
  it('accepts a tenant without a unitRef', () => {
    expect(
      addTenantPayloadSchema.safeParse({
        fullName: 'Jessica Ramirez',
        phoneE164: '+15551234567',
      }).success,
    ).toBe(true);
  });

  it('accepts a tenant with email + DOB + unit by name', () => {
    expect(
      addTenantPayloadSchema.safeParse({
        fullName: 'Jessica Ramirez',
        phoneE164: '+15551234567',
        email: 'jessica@example.com',
        dateOfBirth: '1992-04-15',
        unitRef: { unitLabel: 'A', propertyName: 'Vaba House' },
      }).success,
    ).toBe(true);
  });

  it('rejects malformed phone numbers', () => {
    expect(
      addTenantPayloadSchema.safeParse({
        fullName: 'Jessica Ramirez',
        phoneE164: '15551234567',
      }).success,
    ).toBe(false);
  });

  it('rejects malformed dateOfBirth', () => {
    expect(
      addTenantPayloadSchema.safeParse({
        fullName: 'Jessica Ramirez',
        phoneE164: '+15551234567',
        dateOfBirth: '04/15/1992',
      }).success,
    ).toBe(false);
  });
});

describe('setLeaseTermsPayloadSchema', () => {
  it('accepts a lease keyed by tenant name', () => {
    expect(
      setLeaseTermsPayloadSchema.safeParse({
        leaseRef: { tenantName: 'Jessica' },
        rentAmount: 2200,
        rentDueDay: 1,
        startDate: '2026-06-01',
      }).success,
    ).toBe(true);
  });

  it('accepts a lease keyed by tenantId+unitId', () => {
    expect(
      setLeaseTermsPayloadSchema.safeParse({
        leaseRef: {
          tenantId: '11111111-1111-4111-8111-111111111111',
          unitId: '22222222-2222-4222-8222-222222222222',
        },
        rentAmount: 2200,
        rentDueDay: 1,
        startDate: '2026-06-01',
        status: 'pending',
      }).success,
    ).toBe(true);
  });

  it('rejects rentDueDay > 28', () => {
    expect(
      setLeaseTermsPayloadSchema.safeParse({
        leaseRef: { tenantName: 'Jessica' },
        rentAmount: 2200,
        rentDueDay: 31,
        startDate: '2026-06-01',
      }).success,
    ).toBe(false);
  });
});

describe('updateRentPayloadSchema', () => {
  it('accepts positive integer rent', () => {
    expect(
      updateRentPayloadSchema.safeParse({
        leaseRef: { tenantName: 'Jessica' },
        rentAmount: 2400,
      }).success,
    ).toBe(true);
  });

  it('rejects non-positive rent', () => {
    expect(
      updateRentPayloadSchema.safeParse({
        leaseRef: { tenantName: 'Jessica' },
        rentAmount: 0,
      }).success,
    ).toBe(false);
  });
});

describe('sendTenantMessagePayloadSchema', () => {
  it('accepts a body up to 2000 chars', () => {
    expect(
      sendTenantMessagePayloadSchema.safeParse({
        tenantRef: { tenantName: 'Jessica' },
        body: 'Hey, just a heads up rent posted.',
      }).success,
    ).toBe(true);
  });

  it('rejects an empty body', () => {
    expect(
      sendTenantMessagePayloadSchema.safeParse({
        tenantRef: { tenantName: 'Jessica' },
        body: '',
      }).success,
    ).toBe(false);
  });
});

describe('logMaintenanceTicketPayloadSchema', () => {
  it('accepts a ticket with all fields', () => {
    expect(
      logMaintenanceTicketPayloadSchema.safeParse({
        unitRef: { unitLabel: 'A', propertyName: 'Vaba House' },
        summary: 'Disposal jammed',
        severity: 'medium',
        reportedBy: 'Jessica',
      }).success,
    ).toBe(true);
  });

  it('accepts a ticket without severity', () => {
    expect(
      logMaintenanceTicketPayloadSchema.safeParse({
        unitRef: { unitId: '11111111-1111-4111-8111-111111111111' },
        summary: 'Leaky faucet',
      }).success,
    ).toBe(true);
  });

  it('rejects unknown severity', () => {
    expect(
      logMaintenanceTicketPayloadSchema.safeParse({
        unitRef: { unitId: '11111111-1111-4111-8111-111111111111' },
        summary: 'Leaky faucet',
        severity: 'critical',
      }).success,
    ).toBe(false);
  });
});

describe('updatePropertyRulesPayloadSchema', () => {
  it('accepts a rules text body up to 4000 chars', () => {
    expect(
      updatePropertyRulesPayloadSchema.safeParse({
        propertyRef: { propertyName: 'Vaba House' },
        rulesText: 'No smoking. Quiet hours 10pm-7am.',
      }).success,
    ).toBe(true);
  });

  it('rejects rules text > 4000 chars', () => {
    expect(
      updatePropertyRulesPayloadSchema.safeParse({
        propertyRef: { propertyName: 'Vaba House' },
        rulesText: 'x'.repeat(4001),
      }).success,
    ).toBe(false);
  });
});

describe('archiveLeasePayloadSchema', () => {
  it('accepts archive by tenant name with reason', () => {
    expect(
      archiveLeasePayloadSchema.safeParse({
        leaseRef: { tenantName: 'Jessica' },
        reason: 'moved out',
      }).success,
    ).toBe(true);
  });

  it('accepts archive by leaseId without reason', () => {
    expect(
      archiveLeasePayloadSchema.safeParse({
        leaseRef: { leaseId: '11111111-1111-4111-8111-111111111111' },
      }).success,
    ).toBe(true);
  });

  it('rejects reason longer than 500 chars', () => {
    expect(
      archiveLeasePayloadSchema.safeParse({
        leaseRef: { tenantName: 'Jessica' },
        reason: 'x'.repeat(501),
      }).success,
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// LLM-shape forgiveness regression — Sonnet 4.6 stress-test fix (2026-05-07)
// ---------------------------------------------------------------------------
//
// During iMessage stress testing, Sonnet 4.6 emitted ref payloads in
// shapes the strict union rejected:
//   1. Both `propertyId` and `propertyName` keys, with one undefined.
//   2. A non-UUID value under `propertyId` (the LLM treated the field
//      as a free-form name slot).
//   3. The propertyName hoisted to the payload's top level instead of
//      nested under `propertyRef`.
// All three now coerce into the canonical `{ propertyName }` (or
// `{ propertyId }` when the value is UUID-shaped) so the handler's
// resolve-refs path takes over.

describe('payload shape forgiveness (Sonnet 4.6 regression)', () => {
  it('accepts add_unit when propertyName is hoisted to the top level', () => {
    const parsed = addUnitPayloadSchema.safeParse({
      propertyName: 'Vaba House',
      label: '1',
      bedrooms: 3,
      bathrooms: 2,
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.propertyRef).toEqual({ propertyName: 'Vaba House' });
    }
  });

  it('accepts add_unit when both propertyId and propertyName are present (one undefined)', () => {
    const parsed = addUnitPayloadSchema.safeParse({
      propertyRef: { propertyId: undefined, propertyName: 'Vaba House' },
      label: '1',
      bedrooms: 3,
      bathrooms: 2,
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.propertyRef).toEqual({ propertyName: 'Vaba House' });
    }
  });

  it('accepts add_tenant when unitLabel is hoisted to the top level alongside propertyName', () => {
    const parsed = addTenantPayloadSchema.safeParse({
      fullName: 'Test Person',
      phoneE164: '+15555550100',
      unitLabel: '1',
      propertyName: 'Vaba House',
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.unitRef).toEqual({
        unitLabel: '1',
        propertyName: 'Vaba House',
      });
    }
  });

  it('accepts set_lease_terms with tenantName hoisted to the top level', () => {
    const parsed = setLeaseTermsPayloadSchema.safeParse({
      tenantName: 'Test Person',
      rentAmount: 2400,
      rentDueDay: 1,
      startDate: '2026-06-01',
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.leaseRef).toEqual({ tenantName: 'Test Person' });
    }
  });

  it('accepts update_rent with tenantName hoisted to the top level', () => {
    const parsed = updateRentPayloadSchema.safeParse({
      tenantName: 'Test Person',
      rentAmount: 2750,
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.leaseRef).toEqual({ tenantName: 'Test Person' });
    }
  });

  it('accepts log_maintenance_ticket with unitLabel-only unitRef', () => {
    const parsed = logMaintenanceTicketPayloadSchema.safeParse({
      unitRef: { unitLabel: '1' },
      summary: 'Leaky faucet',
    });
    expect(parsed.success).toBe(true);
  });

  it('accepts send_tenant_message with hoisted tenantName', () => {
    const parsed = sendTenantMessagePayloadSchema.safeParse({
      tenantName: 'Jessica',
      body: 'rent posted',
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.tenantRef).toEqual({ tenantName: 'Jessica' });
    }
  });

  it('still rejects add_unit with no property reference at all', () => {
    const parsed = addUnitPayloadSchema.safeParse({
      label: '1',
      bedrooms: 3,
      bathrooms: 2,
    });
    expect(parsed.success).toBe(false);
  });
});
