/**
 * Unit tests for handleLogMaintenanceTicket.
 *
 * Covers: happy path INSERT, unit not found, ambiguous unit,
 * default severity (medium), severity passthrough,
 * idempotency on (org, unit, summary) within 5m, RLS scoping.
 */

import { describe, expect, it } from 'vitest';

import { handleLogMaintenanceTicket } from '../log-maintenance-ticket';
import { ORG_ID, PROPERTY_ID, UNIT_ID, makeAdmin } from './__helpers';

const TICKET_ID = '99999999-9999-4999-8999-999999999999';

const UNIT_ROW = {
  id: UNIT_ID,
  label: '2B',
  property_id: PROPERTY_ID,
};

describe('handleLogMaintenanceTicket', () => {
  it('inserts a ticket with default severity when only required fields provided', async () => {
    const { admin, calls } = makeAdmin({
      units: [
        { data: { id: UNIT_ID }, error: null }, // ref verify
        { data: UNIT_ROW, error: null }, // unit fetch
      ],
      maintenance_tickets: [
        { data: [], error: null }, // idempotency miss
        {
          data: {
            id: TICKET_ID,
            summary: 'Leaky faucet',
            severity: 'medium',
            status: 'open',
          },
          error: null,
        }, // insert
      ],
    });

    const result = await handleLogMaintenanceTicket({
      admin,
      organizationId: ORG_ID,
      payload: {
        unitRef: { unitId: UNIT_ID },
        summary: 'Leaky faucet',
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.confidence).toBe(1.0);
    expect(result.data).toMatchObject({
      ticketId: TICKET_ID,
      unitLabel: '2B',
      summary: 'Leaky faucet',
      severity: 'medium',
      status: 'open',
    });

    const insertCall = calls.find(
      (c) => c.table === 'maintenance_tickets' && c.op === 'insert',
    );
    expect(insertCall?.insertValues).toMatchObject({
      organization_id: ORG_ID,
      property_id: PROPERTY_ID,
      unit_id: UNIT_ID,
      summary: 'Leaky faucet',
      severity: 'medium',
      status: 'open',
      reported_by: null,
    });
  });

  it('passes through explicit severity and reportedBy', async () => {
    const { admin, calls } = makeAdmin({
      units: [
        { data: { id: UNIT_ID }, error: null },
        { data: UNIT_ROW, error: null },
      ],
      maintenance_tickets: [
        { data: [], error: null },
        {
          data: {
            id: TICKET_ID,
            summary: 'No hot water',
            severity: 'urgent',
            status: 'open',
          },
          error: null,
        },
      ],
    });

    const result = await handleLogMaintenanceTicket({
      admin,
      organizationId: ORG_ID,
      payload: {
        unitRef: { unitId: UNIT_ID },
        summary: 'No hot water',
        severity: 'urgent',
        reportedBy: 'Jessica Ramirez',
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect((result.data as { severity: string }).severity).toBe('urgent');

    const insertCall = calls.find(
      (c) => c.table === 'maintenance_tickets' && c.op === 'insert',
    );
    expect(insertCall?.insertValues).toMatchObject({
      severity: 'urgent',
      reported_by: 'Jessica Ramirez',
    });
  });

  it('returns unit_not_found when unitRef UUID is unknown', async () => {
    const { admin } = makeAdmin({
      units: [{ data: null, error: null }],
    });

    const result = await handleLogMaintenanceTicket({
      admin,
      organizationId: ORG_ID,
      payload: {
        unitRef: { unitId: UNIT_ID },
        summary: 'Leaky faucet',
      },
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('unit_not_found');
    expect(result.confidence).toBe(0);
  });

  it('returns ambiguous_unit when label resolves to 2+ units', async () => {
    const { admin } = makeAdmin({
      properties: [{ data: [{ id: PROPERTY_ID }], error: null }],
      units: [
        // resolveUnit returns 2 matches.
        { data: [{ id: UNIT_ID }, { id: 'u2' }], error: null },
      ],
    });

    const result = await handleLogMaintenanceTicket({
      admin,
      organizationId: ORG_ID,
      payload: {
        unitRef: { unitLabel: '2B', propertyName: 'House' },
        summary: 'Leaky faucet',
      },
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('ambiguous_unit');
    expect(result.confidence).toBe(0.2);
  });

  it('resolves unitRef via label and reports confidence 0.8', async () => {
    const { admin } = makeAdmin({
      properties: [{ data: [{ id: PROPERTY_ID }], error: null }],
      units: [
        { data: [{ id: UNIT_ID }], error: null }, // resolveUnit
        { data: UNIT_ROW, error: null }, // unit fetch
      ],
      maintenance_tickets: [
        { data: [], error: null },
        {
          data: { id: TICKET_ID, summary: 's', severity: 'medium', status: 'open' },
          error: null,
        },
      ],
    });

    const result = await handleLogMaintenanceTicket({
      admin,
      organizationId: ORG_ID,
      payload: {
        unitRef: { unitLabel: '2B', propertyName: 'Vaba' },
        summary: 's',
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.confidence).toBe(0.8);
  });

  it('returns idempotent: true when same (unit, summary) exists in window', async () => {
    const { admin, calls } = makeAdmin({
      units: [
        { data: { id: UNIT_ID }, error: null },
        { data: UNIT_ROW, error: null },
      ],
      maintenance_tickets: [
        // Idempotency lookup hits.
        {
          data: [
            { id: TICKET_ID, summary: 'Leaky faucet', severity: 'medium', status: 'open' },
          ],
          error: null,
        },
      ],
    });

    const result = await handleLogMaintenanceTicket({
      admin,
      organizationId: ORG_ID,
      payload: {
        unitRef: { unitId: UNIT_ID },
        summary: 'Leaky faucet',
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.idempotent).toBe(true);
    expect((result.data as { ticketId: string }).ticketId).toBe(TICKET_ID);
    // No insert call.
    expect(
      calls.find((c) => c.table === 'maintenance_tickets' && c.op === 'insert'),
    ).toBeUndefined();
  });

  it('scopes every query by organization_id', async () => {
    const { admin, calls } = makeAdmin({
      units: [
        { data: { id: UNIT_ID }, error: null },
        { data: UNIT_ROW, error: null },
      ],
      maintenance_tickets: [
        { data: [], error: null },
        {
          data: { id: TICKET_ID, summary: 's', severity: 'medium', status: 'open' },
          error: null,
        },
      ],
    });

    await handleLogMaintenanceTicket({
      admin,
      organizationId: ORG_ID,
      payload: {
        unitRef: { unitId: UNIT_ID },
        summary: 's',
      },
    });

    for (const call of calls) {
      if (call.table === 'units' || call.table === 'maintenance_tickets') {
        const hasOrgEq = call.eqs.some(
          ([col, val]) => col === 'organization_id' && val === ORG_ID,
        );
        const hasOrgInsert = call.insertValues?.organization_id === ORG_ID;
        expect(hasOrgEq || hasOrgInsert).toBe(true);
      }
    }
  });
});
