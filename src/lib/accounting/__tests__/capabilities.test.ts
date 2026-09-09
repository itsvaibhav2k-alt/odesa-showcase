import { describe, expect, it } from 'vitest';

import {
  ACCOUNTANT_CAPABILITY_CEILING,
  isAccountantCapability,
  resolveAccountantCapabilities,
} from '../capabilities';

describe('Accountant immutable capability ceiling', () => {
  it('contains only read/reconcile/export capabilities', () => {
    expect(ACCOUNTANT_CAPABILITY_CEILING).toEqual([
      'view_dashboard',
      'view_rent',
      'view_financials',
      'view_documents',
      'export_financials',
    ]);
    expect(isAccountantCapability(null)).toBe(false);
    expect(isAccountantCapability('view_calls')).toBe(false);
  });

  it('lets explicit denies narrow the preset', () => {
    expect(
      [...resolveAccountantCapabilities(ACCOUNTANT_CAPABILITY_CEILING, [
        { capability: 'view_documents', effect: 'deny' },
      ])],
    ).toEqual([
      'view_dashboard',
      'view_rent',
      'view_financials',
      'export_financials',
    ]);
  });

  it.each([
    'view_calls',
    'view_inbox',
    'manage_work_orders',
    'view_vendors',
    'record_payment',
    'manage_settings',
    'approve_tenant_message',
  ])('ignores a malicious allow override for %s', (capability) => {
    const effective = resolveAccountantCapabilities([], [
      { capability, effect: 'allow' },
    ]);
    expect((effective as ReadonlySet<string>).has(capability)).toBe(false);
  });

  it('makes deny dominant and ignores malformed runtime overrides', () => {
    const effective = resolveAccountantCapabilities(
      ['view_rent', 'view_calls'],
      [
        { capability: 'view_rent', effect: 'allow' },
        { capability: 'view_rent', effect: 'deny' },
        { capability: null, effect: 'allow' },
        { capability: 'view_financials', effect: 'surprise' },
      ],
    );
    expect([...effective]).toEqual([]);
  });
});
