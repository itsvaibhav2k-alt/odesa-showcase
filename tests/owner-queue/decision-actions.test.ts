/**
 * Unit tests for the Owner Queue pure decision-control maps.
 *
 * Covers each helper across the seeded action types (the kinds the seed script
 * inserts: rent reminder / collections `send_tenant_message`, emergency
 * `dispatch_vendor`, lease renewal `update_rent`, rent payment
 * `request_rent_payment`) plus the gate display language.
 *
 * Safety guard: a sweep asserting NONE of the maps ever produce the forbidden
 * strings "Hold", "Switch", or "Authorize" — these were explicitly removed and
 * must never regress. The sweep also forbids any PAST-TENSE dispatch claim
 * ("dispatched vendor", "vendor contacted", "vendor notified"): committing a
 * dispatch_vendor proposal contacts nobody, so no owner-facing string may ever
 * imply the vendor was actually reached.
 */
import { describe, expect, it } from 'vitest';

import {
  actionLabelFor,
  boundaryCopyFor,
  directCommitKindFor,
  editKindFor,
  financialLabelFor,
  gateDisplayFor,
  gateReasonFor,
  ifIgnoredCopyFor,
  normalizeSourceLabel,
  type Gate,
  type Recommendation,
} from '@/lib/owner-queue/decision-actions';

/** The action types the owner-queue seeds insert (seed.sql + seed script). */
const SEEDED_ACTION_TYPES = [
  'send_tenant_message',
  'dispatch_vendor',
  'update_rent',
  'request_rent_payment',
  'log_maintenance_ticket',
] as const;

const GATES: Gate[] = ['auto', 'review', 'block'];

const FORBIDDEN = [
  /hold/i,
  /switch/i,
  /authorize/i,
  // Vendor Dispatch Truth: never claim the vendor was actually reached.
  /dispatched vendor/i,
  /vendor contacted/i,
  /vendor notified/i,
];

// ---------------------------------------------------------------------------
// actionLabelFor
// ---------------------------------------------------------------------------

describe('actionLabelFor', () => {
  it('returns "Record dispatch approval" for dispatch_vendor (never "Authorize")', () => {
    expect(actionLabelFor('dispatch_vendor', 'approve')).toBe('Record dispatch approval');
  });

  it('returns "Preview + approve" for tenant-facing messages', () => {
    expect(actionLabelFor('send_tenant_message', 'approve')).toBe(
      'Preview + approve',
    );
    expect(actionLabelFor('draft_sms_reply', 'hold')).toBe('Preview + approve');
  });

  it('returns "Edit terms" for lease/rent money writes', () => {
    expect(actionLabelFor('update_rent', 'hold')).toBe('Edit terms');
    expect(actionLabelFor('set_lease_terms', 'approve')).toBe('Edit terms');
  });

  it('returns "Draft renewal" for archive_lease', () => {
    expect(actionLabelFor('archive_lease', 'hold')).toBe('Draft renewal');
  });

  it('returns "Log ticket" for log_maintenance_ticket', () => {
    expect(actionLabelFor('log_maintenance_ticket', 'approve')).toBe(
      'Log ticket',
    );
  });

  it('returns "Acknowledge" for health_flag (never falls through to escalate)', () => {
    expect(actionLabelFor('health_flag', 'hold')).toBe('Acknowledge');
    expect(actionLabelFor('health_flag', 'approve')).toBe('Acknowledge');
  });

  it('returns "Acknowledge" for voice_call_review (never falls through to escalate)', () => {
    expect(actionLabelFor('voice_call_review', 'hold')).toBe('Acknowledge');
    expect(actionLabelFor('voice_call_review', 'approve')).toBe('Acknowledge');
  });

  it('returns the non-committing "Review guidance" for update_rulebook', () => {
    expect(actionLabelFor('update_rulebook', 'hold')).toBe('Review guidance');
    expect(actionLabelFor('update_rulebook', 'approve')).toBe('Review guidance');
  });

  it('returns the drawer-opening "Edit terms" for request_rent_payment', () => {
    expect(actionLabelFor('request_rent_payment', 'hold')).toBe('Edit terms');
  });

  it('returns "Escalate to owner" for an unmapped non-decline action', () => {
    expect(actionLabelFor('schedule_calendar_event', 'hold')).toBe(
      'Escalate to owner',
    );
    expect(actionLabelFor(null, 'approve')).toBe('Escalate to owner');
  });

  it('always returns "Decline" when the recommendation is decline', () => {
    for (const type of SEEDED_ACTION_TYPES) {
      expect(actionLabelFor(type, 'decline')).toBe('Decline');
    }
  });
});

// ---------------------------------------------------------------------------
// directCommitKindFor — the drawer-less commit allow-list (safety boundary)
// ---------------------------------------------------------------------------

describe('directCommitKindFor', () => {
  it('maps health_flag → "acknowledge"', () => {
    expect(directCommitKindFor('health_flag')).toBe('acknowledge');
  });

  it('maps voice_call_review → "acknowledge" (informational, no edit drawer)', () => {
    expect(directCommitKindFor('voice_call_review')).toBe('acknowledge');
  });

  it('maps dispatch_vendor → "dispatch"', () => {
    expect(directCommitKindFor('dispatch_vendor')).toBe('dispatch');
  });

  it('returns null for every message/money/lease type (these open the drawer)', () => {
    expect(directCommitKindFor('send_tenant_message')).toBeNull();
    expect(directCommitKindFor('update_rent')).toBeNull();
    expect(directCommitKindFor('request_rent_payment')).toBeNull();
    expect(directCommitKindFor('set_lease_terms')).toBeNull();
  });

  it('returns null for informational/unknown types (must never silently commit)', () => {
    expect(directCommitKindFor('update_rulebook')).toBeNull();
    expect(directCommitKindFor('not_a_real_verb')).toBeNull();
    expect(directCommitKindFor('')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// boundaryCopyFor
// ---------------------------------------------------------------------------

describe('boundaryCopyFor', () => {
  it('states the vendor is not contacted for dispatch_vendor', () => {
    expect(boundaryCopyFor('dispatch_vendor')).toBe(
      'Vendor is not contacted from this action — Odesa records your approval for the dispatch workflow.',
    );
  });

  it('states no tenant message sends until approved for messages', () => {
    expect(boundaryCopyFor('send_tenant_message')).toBe(
      'No tenant-facing message sends until you approve it.',
    );
  });

  it('states no payment request sends until approved for rent payment', () => {
    expect(boundaryCopyFor('request_rent_payment')).toBe(
      'No payment request sends until you approve it.',
    );
  });

  it('states lease terms only change once approved for lease writes', () => {
    expect(boundaryCopyFor('update_rent')).toBe(
      'Lease terms only change once you approve them.',
    );
  });

  it('states only an internal record is created for log_maintenance_ticket', () => {
    expect(boundaryCopyFor('log_maintenance_ticket')).toBe(
      'Creates an internal work-order record — no tenant or vendor is contacted.',
    );
  });

  it('falls back to "Draft only" for unmapped action types', () => {
    expect(boundaryCopyFor('schedule_calendar_event')).toBe(
      'Draft only — nothing sends until approved.',
    );
    expect(boundaryCopyFor(undefined)).toBe(
      'Draft only — nothing sends until approved.',
    );
  });
});

// ---------------------------------------------------------------------------
// ifIgnoredCopyFor
// ---------------------------------------------------------------------------

describe('ifIgnoredCopyFor', () => {
  it('states no message is sent for tenant-facing messages', () => {
    expect(ifIgnoredCopyFor('send_tenant_message', 'review')).toBe(
      'No message is sent — the tenant hears nothing from Odesa. The decision stays pending in your queue.',
    );
    expect(ifIgnoredCopyFor('draft_sms_reply', 'auto')).toMatch(
      /no message is sent/i,
    );
  });

  it('states the balance stays outstanding for request_rent_payment', () => {
    expect(ifIgnoredCopyFor('request_rent_payment', 'review')).toBe(
      'No payment link is sent and the balance stays outstanding. The decision stays pending in your queue.',
    );
  });

  it('states the lease keeps its terms for lease/rent writes', () => {
    expect(ifIgnoredCopyFor('update_rent', 'review')).toBe(
      'The lease keeps its current terms — no rent change takes effect. The decision stays pending in your queue.',
    );
    expect(ifIgnoredCopyFor('set_lease_terms', 'review')).toMatch(
      /keeps its current terms/i,
    );
  });

  it('states the work order stays open and unassigned for dispatch_vendor', () => {
    expect(ifIgnoredCopyFor('dispatch_vendor', 'review')).toBe(
      'No dispatch is recorded and the work order stays open and unassigned. The decision stays pending in your queue.',
    );
  });

  it('states no record is created for log_maintenance_ticket', () => {
    expect(ifIgnoredCopyFor('log_maintenance_ticket', 'auto')).toBe(
      'No work-order record is created — the report goes untracked. The decision stays pending in your queue.',
    );
  });

  it('reads "until you decline it" for a block gate', () => {
    expect(ifIgnoredCopyFor('send_tenant_message', 'block')).toBe(
      'No message is sent — the tenant hears nothing from Odesa. The proposal stays pending here until you decline it.',
    );
  });

  it('falls back to a calm generic line for unmapped/missing action types', () => {
    expect(ifIgnoredCopyFor('schedule_calendar_event', 'review')).toBe(
      'Nothing happens on its own. The decision stays pending in your queue.',
    );
    expect(ifIgnoredCopyFor(null, undefined)).toBe(
      'Nothing happens on its own. The decision stays pending in your queue.',
    );
  });

  it('is never empty for any seeded action type and gate', () => {
    for (const type of SEEDED_ACTION_TYPES) {
      for (const gate of GATES) {
        expect(ifIgnoredCopyFor(type, gate).trim().length).toBeGreaterThan(0);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// financialLabelFor
// ---------------------------------------------------------------------------

describe('financialLabelFor', () => {
  it('returns "Outstanding balance" for request_rent_payment', () => {
    expect(financialLabelFor('request_rent_payment')).toBe('Outstanding balance');
  });

  it('returns "Estimated vendor cost" for dispatch_vendor', () => {
    expect(financialLabelFor('dispatch_vendor')).toBe('Estimated vendor cost');
  });

  it('returns "Proposed rent" for lease/rent writes', () => {
    expect(financialLabelFor('update_rent')).toBe('Proposed rent');
    expect(financialLabelFor('set_lease_terms')).toBe('Proposed rent');
  });

  it('returns "Authorization requested" for tenant-facing messages', () => {
    expect(financialLabelFor('send_tenant_message')).toBe(
      'Authorization requested',
    );
  });

  it('returns null when no figure applies', () => {
    expect(financialLabelFor('schedule_calendar_event')).toBeNull();
    expect(financialLabelFor(null)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// editKindFor
// ---------------------------------------------------------------------------

describe('editKindFor', () => {
  it('maps each seeded action type to its drawer form', () => {
    expect(editKindFor('dispatch_vendor')).toBe('dispatch');
    expect(editKindFor('request_rent_payment')).toBe('rent_payment');
    expect(editKindFor('update_rent')).toBe('lease');
    expect(editKindFor('set_lease_terms')).toBe('lease');
    expect(editKindFor('send_tenant_message')).toBe('message');
    expect(editKindFor('draft_sms_reply')).toBe('message');
  });

  it('returns null for actions without a supported editable payload', () => {
    expect(editKindFor('schedule_calendar_event')).toBeNull();
    expect(editKindFor(undefined)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// gateDisplayFor
// ---------------------------------------------------------------------------

describe('gateDisplayFor', () => {
  it('maps auto → "Recommended"', () => {
    expect(gateDisplayFor('auto')).toBe('Recommended');
  });

  it('maps review → "Owner review required"', () => {
    expect(gateDisplayFor('review')).toBe('Owner review required');
  });

  it('maps block → "Not recommended"', () => {
    expect(gateDisplayFor('block')).toBe('Not recommended');
  });

  it('defaults unknown/missing gates to "Owner review required"', () => {
    expect(gateDisplayFor('something_else')).toBe('Owner review required');
    expect(gateDisplayFor(null)).toBe('Owner review required');
  });
});

// ---------------------------------------------------------------------------
// gateReasonFor
// ---------------------------------------------------------------------------

describe('gateReasonFor', () => {
  it('pairs review with "tenant-facing" for a message', () => {
    expect(gateReasonFor('review', 'send_tenant_message')).toBe(
      'Owner review required — tenant-facing',
    );
  });

  it('pairs review with "spends money" for dispatch_vendor', () => {
    expect(gateReasonFor('review', 'dispatch_vendor')).toBe(
      'Owner review required — spends money',
    );
  });

  it('pairs review with "changes lease terms" for a lease write', () => {
    expect(gateReasonFor('review', 'update_rent')).toBe(
      'Owner review required — changes lease terms',
    );
  });

  it('pairs review with "requests a payment" for rent payment', () => {
    expect(gateReasonFor('review', 'request_rent_payment')).toBe(
      'Owner review required — requests a payment',
    );
  });

  it('returns the bare display when no cause applies', () => {
    expect(gateReasonFor('auto', 'schedule_calendar_event')).toBe('Recommended');
    expect(gateReasonFor('block', null)).toBe('Not recommended');
  });
});

// ---------------------------------------------------------------------------
// normalizeSourceLabel
// ---------------------------------------------------------------------------

describe('normalizeSourceLabel', () => {
  it('maps known fact types to clean labels', () => {
    expect(normalizeSourceLabel('rent_ledger')).toBe('Rent ledger');
    expect(normalizeSourceLabel('tenant_pattern')).toBe('Tenant messages');
    expect(normalizeSourceLabel('tenant_message')).toBe('Tenant messages');
    expect(normalizeSourceLabel('lease')).toBe('Lease terms');
    expect(normalizeSourceLabel('vendor_relationship')).toBe('Vendor estimate');
    expect(normalizeSourceLabel('work_order')).toBe('Work order');
    expect(normalizeSourceLabel('market_comp')).toBe('Market comps');
  });

  it('humanizes unknown fact types', () => {
    expect(normalizeSourceLabel('insurance_claim')).toBe('Insurance Claim');
  });

  it('truncates overly long unknown labels with an ellipsis', () => {
    const out = normalizeSourceLabel('a_very_long_unknown_fact_type_name_here');
    expect(out.length).toBeLessThanOrEqual(24);
    expect(out.endsWith('…')).toBe(true);
  });

  it('falls back to "Source" for empty/missing input', () => {
    expect(normalizeSourceLabel('')).toBe('Source');
    expect(normalizeSourceLabel('   ')).toBe('Source');
    expect(normalizeSourceLabel(null)).toBe('Source');
  });
});

// ---------------------------------------------------------------------------
// Forbidden-string safety sweep — no map may ever produce Hold/Switch/Authorize.
// ---------------------------------------------------------------------------

describe('forbidden labels never appear', () => {
  const recommendations: Recommendation[] = ['approve', 'hold', 'decline'];

  function assertClean(value: string | null): void {
    if (value == null) return;
    for (const re of FORBIDDEN) {
      expect(value).not.toMatch(re);
    }
  }

  it('never produces "Hold", "Switch", or "Authorize" across all seeded inputs', () => {
    for (const type of SEEDED_ACTION_TYPES) {
      assertClean(boundaryCopyFor(type));
      assertClean(financialLabelFor(type));

      for (const rec of recommendations) {
        assertClean(actionLabelFor(type, rec));
      }
      for (const gate of GATES) {
        assertClean(gateDisplayFor(gate));
        assertClean(gateReasonFor(gate, type));
        assertClean(ifIgnoredCopyFor(type, gate));
      }
    }
  });

  it('never produces forbidden strings for the broader action-type surface', () => {
    const extraTypes = [
      'dispatch_vendor',
      'set_lease_terms',
      'draft_sms_reply',
      'archive_lease',
      'schedule_calendar_event',
      'health_flag',
      'voice_call_review',
      'update_rulebook',
      'request_rent_payment',
      null,
    ];
    for (const type of extraTypes) {
      assertClean(boundaryCopyFor(type));
      assertClean(financialLabelFor(type));
      for (const rec of recommendations) {
        assertClean(actionLabelFor(type, rec));
      }
      for (const gate of GATES) {
        assertClean(gateReasonFor(gate, type));
        assertClean(ifIgnoredCopyFor(type, gate));
      }
    }
  });
});
