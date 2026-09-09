/**
 * Sanity tests for formatProposalSummary — the Wave 6 narration helper
 * used by handleOperatorInbound to render committed proposals as
 * natural-language past-tense summaries below the assistant's reply.
 *
 * One case per Wave-6 action_type, plus a couple of legacy-fallback
 * cases to confirm the default branch keeps shipping the existing
 * "Drafted X (auto)" line for non-write proposals.
 */

import { describe, expect, it } from 'vitest';

import {
  formatProposalSummary,
  humanizeHandlerError,
  reduceEvent,
} from '../handle-operator-inbound';
import type {
  ActionProposal,
  WorkerActionType,
} from '@/lib/agent/worker/types';

describe('formatProposalSummary', () => {
  it('should narrate create_property with the address tail', () => {
    const out = formatProposalSummary(
      'create_property',
      {
        name: 'Vaba House',
        addressStreet: '25911 Sycamore Grove Pl',
        addressCity: 'Aldie',
        addressState: 'VA',
        addressZip: '20105',
      },
      null,
    );
    expect(out).toBe(
      '✓ Created "Vaba House" at 25911 Sycamore Grove Pl, Aldie VA 20105.',
    );
  });

  it('should narrate add_unit with bedroom/bathroom dims', () => {
    const out = formatProposalSummary(
      'add_unit',
      { label: 'Apt 4', bedrooms: 2, bathrooms: 1 },
      null,
    );
    expect(out).toBe('✓ Added unit Apt 4 (2br/1ba).');
  });

  it('should narrate add_tenant with phone', () => {
    const out = formatProposalSummary(
      'add_tenant',
      { fullName: 'Jane Doe', phoneE164: '+15555550100' },
      null,
    );
    expect(out).toBe('✓ Added tenant Jane Doe (+15555550100).');
  });

  it('should narrate set_lease_terms with rent + due day', () => {
    const out = formatProposalSummary(
      'set_lease_terms',
      {
        leaseRef: { tenantName: 'Jane Doe' },
        rentAmount: 2500,
        rentDueDay: 1,
        startDate: '2026-06-01',
      },
      null,
    );
    expect(out).toBe(
      '✓ Set lease for Jane Doe: $2,500/mo, due day 1.',
    );
  });

  it('should narrate update_rent with the new amount', () => {
    const out = formatProposalSummary(
      'update_rent',
      { leaseRef: { tenantName: 'Jane Doe' }, rentAmount: 2750 },
      null,
    );
    expect(out).toBe(
      "✓ Updated Jane Doe's rent to $2,750/mo.",
    );
  });

  it('should narrate send_tenant_message with the tenant name', () => {
    const out = formatProposalSummary(
      'send_tenant_message',
      { tenantRef: { tenantName: 'Jane Doe' }, body: 'rent due in 3 days' },
      null,
    );
    expect(out).toBe('✓ Sent message to Jane Doe.');
  });

  it('should narrate log_maintenance_ticket with severity', () => {
    const out = formatProposalSummary(
      'log_maintenance_ticket',
      {
        unitRef: { unitLabel: 'Apt 4' },
        summary: 'leaky kitchen faucet',
        severity: 'high',
      },
      null,
    );
    expect(out).toBe(
      '✓ Logged ticket: leaky kitchen faucet (high).',
    );
  });

  it('should narrate update_property_rules with the property name', () => {
    const out = formatProposalSummary(
      'update_property_rules',
      {
        propertyRef: { propertyName: 'Vaba House' },
        rulesText: 'Quiet hours 10pm-7am.',
      },
      null,
    );
    expect(out).toBe('✓ Updated "Vaba House" rules.');
  });

  it('should narrate archive_lease with optional reason', () => {
    const out = formatProposalSummary(
      'archive_lease',
      { leaseRef: { tenantName: 'Jane Doe' }, reason: 'tenant moved out' },
      null,
    );
    expect(out).toBe(
      "✓ Archived Jane Doe's lease (tenant moved out).",
    );
  });

  it('should narrate request_rent_payment with amount and month label', () => {
    const out = formatProposalSummary(
      'request_rent_payment',
      {
        tenantRef: { tenantName: 'Test Person' },
        amountCents: 240000,
        dueDate: '2026-06-01',
      },
      null,
    );
    expect(out).toBe('✓ Sent rent link to Test Person ($2,400 for June 2026).');
  });

  it('should narrate request_rent_payment with amount only when dueDate is missing', () => {
    const out = formatProposalSummary(
      'request_rent_payment',
      { tenantRef: { tenantName: 'Test Person' }, amountCents: 240000 },
      null,
    );
    expect(out).toBe('✓ Sent rent link to Test Person ($2,400).');
  });

  // ---- Wave 7 — property data depth (Stream P) ----

  it('should narrate add_appliance with type, make/model, and unit', () => {
    const out = formatProposalSummary(
      'add_appliance',
      {
        propertyRef: { propertyName: 'Vaba House' },
        unitRef: { unitLabel: '1' },
        type: 'fridge',
        make: 'Samsung',
        model: 'RF28',
      },
      null,
    );
    expect(out).toBe('✓ Logged fridge: Samsung RF28 in unit 1.');
  });

  it('should narrate add_appliance without unit when property-wide', () => {
    const out = formatProposalSummary(
      'add_appliance',
      { propertyRef: { propertyName: 'Vaba House' }, type: 'hvac' },
      null,
    );
    expect(out).toBe('✓ Logged hvac.');
  });

  it('should narrate update_appliance with type', () => {
    const out = formatProposalSummary(
      'update_appliance',
      {
        applianceRef: { propertyName: 'Vaba House', type: 'fridge' },
        notes: 'fixed',
      },
      null,
    );
    expect(out).toBe('✓ Updated fridge details.');
  });

  it('should narrate set_property_vendor with category, property, vendor', () => {
    const out = formatProposalSummary(
      'set_property_vendor',
      {
        propertyRef: { propertyName: 'vaba house' },
        category: 'plumbing',
        vendorRef: { vendorName: 'Joe Plumbing' },
      },
      null,
    );
    expect(out).toBe('✓ Set plumbing for "vaba house": Joe Plumbing.');
  });

  it('should narrate update_tenant_preference with channel + parking', () => {
    const out = formatProposalSummary(
      'update_tenant_preference',
      {
        tenantRef: { tenantName: 'Test Person' },
        preferredChannel: 'email',
        parkingSpace: '12B',
      },
      null,
    );
    expect(out).toBe(
      "✓ Updated Test Person's preferences: prefers email, parking 12B.",
    );
  });

  it('should narrate update_tenant_preference with empty pets array', () => {
    const out = formatProposalSummary(
      'update_tenant_preference',
      { tenantRef: { tenantName: 'Test Person' }, pets: [] },
      null,
    );
    expect(out).toBe("✓ Updated Test Person's preferences: 0 pets.");
  });

  // ---- Legacy + fallback cases ----

  it('should fall back to "(auto)" suffix for legacy draft_sms_reply', () => {
    const out = formatProposalSummary(
      'draft_sms_reply',
      { body: 'pay rent please', tone: 'firm' },
      null,
    );
    expect(out).toBe('✓ Drafted SMS reply (auto)');
  });

  it('should narrate set_lease_terms with a generic "tenant" when ref is opaque', () => {
    const out = formatProposalSummary(
      'set_lease_terms',
      {
        leaseRef: { leaseId: '00000000-0000-0000-0000-000000000000' },
        rentAmount: 1800,
        rentDueDay: 5,
        startDate: '2026-06-01',
      },
      null,
    );
    expect(out).toBe(
      '✓ Set lease for tenant: $1,800/mo, due day 5.',
    );
  });

  it('should prefer payload over data when both are present', () => {
    const out = formatProposalSummary(
      'add_tenant',
      { fullName: 'Jane Doe', phoneE164: '+15555550100' },
      { full_name: 'Other Person', phone_e164: '+15555550999' },
    );
    expect(out).toBe('✓ Added tenant Jane Doe (+15555550100).');
  });
});

// ---------------------------------------------------------------------------
// humanizeHandlerError — narration mapping for soft handler failures
// ---------------------------------------------------------------------------

describe('humanizeHandlerError', () => {
  it('maps lease_not_found_attach_unit_first to a unit-attach hint', () => {
    expect(humanizeHandlerError('lease_not_found_attach_unit_first')).toContain(
      'attach a unit',
    );
  });

  it('keeps unknown internal error codes out of customer copy', () => {
    const reason = humanizeHandlerError('boom_unknown_thing');

    expect(reason).toBe(
      'the operation needs reconciliation before another attempt.',
    );
    expect(reason).not.toContain('boom_unknown_thing');
  });

  it('returns a generic phrase when error is undefined', () => {
    expect(humanizeHandlerError(undefined)).toBe('handler did not complete');
  });
});

// ---------------------------------------------------------------------------
// reduceEvent — proposal.committed narration honors handlerOutcome
// ---------------------------------------------------------------------------
//
// Bug 4 (2026-05-07): proposal.committed used to render "✓ Done" even
// when the wave-6 handler returned ok:false. Operator saw a fake
// success while the DB was unchanged. The committed event now carries
// `handlerOutcome` and reduceEvent emits a "⚠ Couldn't <verb> — <why>"
// line instead of the success summary when the outcome is not ok.

function fakeProposal(actionType: WorkerActionType): ActionProposal {
  return {
    id: 'proposal-1',
    organizationId: 'org-1',
    propertyId: 'prop-1',
    workerModel: 'dispatcher-direct',
    action_type: actionType,
    payload: {
      leaseRef: { tenantName: 'Test Person' },
      rentAmount: 2400,
      rentDueDay: 1,
      startDate: '2026-06-01',
    } as ActionProposal['payload'],
    routing: null,
    reasoning: 'Dispatcher-supplied set_lease_terms',
    confidence: 0.9,
    context_fact_ids: [],
    gate_decision: 'auto',
    status: 'committed',
    createdAt: '2026-05-07T00:00:00Z',
  };
}

describe('reduceEvent / proposal.committed', () => {
  it('renders the success summary when no handlerOutcome is attached', () => {
    const actions: string[] = [];
    reduceEvent(
      {
        type: 'proposal.committed',
        proposal: fakeProposal('set_lease_terms'),
      },
      () => {},
      (line) => actions.push(line),
    );
    expect(actions).toHaveLength(1);
    expect(actions[0]).toContain('Set lease for Test Person');
    expect(actions[0]!.startsWith('✓')).toBe(true); // ✓
  });

  it('renders a failure line when handlerOutcome.ok is false', () => {
    const actions: string[] = [];
    reduceEvent(
      {
        type: 'proposal.committed',
        proposal: fakeProposal('set_lease_terms'),
        handlerOutcome: {
          ok: false,
          error: 'lease_not_found_attach_unit_first',
          confidence: 0,
        },
      },
      () => {},
      (line) => actions.push(line),
    );
    expect(actions).toHaveLength(1);
    expect(actions[0]).toContain("Couldn't");
    expect(actions[0]).toContain('attach a unit');
    expect(actions[0]!.startsWith('⚠')).toBe(true); // ⚠
  });

  it('renders the success summary when handlerOutcome.ok is true', () => {
    const actions: string[] = [];
    reduceEvent(
      {
        type: 'proposal.committed',
        proposal: fakeProposal('set_lease_terms'),
        handlerOutcome: { ok: true, confidence: 1.0 },
      },
      () => {},
      (line) => actions.push(line),
    );
    expect(actions).toHaveLength(1);
    expect(actions[0]).toContain('Set lease for Test Person');
  });
});
