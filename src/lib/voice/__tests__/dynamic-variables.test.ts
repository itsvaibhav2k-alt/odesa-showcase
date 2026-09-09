import { describe, expect, it } from 'vitest';

import { buildDynamicVariables } from '../dynamic-variables';
import { disclosureAllowed } from '../policy';
import type { ResolvedCaller } from '../resolve-caller';
import type { CallerKind } from '../types';

/**
 * buildDynamicVariables is the FIRST disclosure channel of a call. Its one
 * load-bearing invariant: unknown/ambiguous callers (and any caller lacking the
 * matching grant) hear NOTHING — an empty object. Everything else is a bonus.
 */
function caller(kind: CallerKind, extra: Partial<ResolvedCaller> = {}): ResolvedCaller {
  return {
    callerKind: kind,
    organizationId: 'org-1',
    tenantId: null,
    vendorId: null,
    propertyId: null,
    unitId: null,
    displayName: null,
    ...extra,
  };
}

describe('buildDynamicVariables', () => {
  it('returns {} for an unknown caller (zero private data)', () => {
    const resolved = caller('unknown_caller', { displayName: 'Should Not Leak' });
    expect(
      buildDynamicVariables({ resolved, grant: disclosureAllowed('unknown_caller') }),
    ).toEqual({});
  });

  it('returns {} for an ambiguous caller', () => {
    const resolved = caller('ambiguous', { displayName: 'Should Not Leak' });
    expect(buildDynamicVariables({ resolved, grant: disclosureAllowed('ambiguous') })).toEqual({});
  });

  it('returns {} for a verified tenant when the ledger grant is absent (defense in depth)', () => {
    const resolved = caller('verified_tenant', { displayName: 'Marcus', tenantId: 't1' });
    // Hostile grant override: even a verified tenant hears nothing without the grant.
    const grant = { tenantIdentity: false, ledger: false, ownerPortfolio: false, vendorJobContext: false };
    expect(buildDynamicVariables({ resolved, grant, ledgerStatusLine: 'x' })).toEqual({});
  });

  it('emits gated, all-string variables for a verified tenant', () => {
    const resolved = caller('verified_tenant', { displayName: 'Marcus Alvarez', tenantId: 't1' });
    const vars = buildDynamicVariables({
      resolved,
      grant: disclosureAllowed('verified_tenant'),
      unitLabel: '2B',
      ledgerStatusLine: 'the ledger currently shows late_3 for 2026-07-01; $1200 outstanding',
    });
    expect(vars.caller_name).toBe('Marcus Alvarez');
    expect(vars.unit_label).toBe('2B');
    expect(vars.ledger_status_line).toContain('the ledger currently shows');
    Object.values(vars).forEach((v) => expect(typeof v).toBe('string'));
  });

  it('emits owner briefing hint for a verified owner', () => {
    const resolved = caller('verified_owner', { displayName: 'Owner' });
    const vars = buildDynamicVariables({ resolved, grant: disclosureAllowed('verified_owner') });
    expect(vars.caller_name).toBe('Owner');
    expect(vars.briefing_hint).toBe('owner briefing available');
  });

  it('emits a string open_job_count for a known vendor', () => {
    const resolved = caller('known_vendor', { displayName: 'Beltway Plumbing', vendorId: 'v1' });
    const vars = buildDynamicVariables({
      resolved,
      grant: disclosureAllowed('known_vendor'),
      openJobCount: 3,
    });
    expect(vars.vendor_name).toBe('Beltway Plumbing');
    expect(vars.open_job_count).toBe('3');
  });
});
