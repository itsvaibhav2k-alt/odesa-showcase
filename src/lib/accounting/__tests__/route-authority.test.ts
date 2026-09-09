import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  canAccessRoute,
  requiredCapabilityForRoute,
} from '@/lib/authz/access-policy';

const ACCOUNTANT_ROUTES = {
  '/today': 'view_dashboard',
  '/rent': 'view_rent',
  '/financials': 'view_financials',
  '/documents': 'view_documents',
} as const;

describe('Accountant route authority manifest', () => {
  it('maps the four rendered routes to independent exact capabilities', () => {
    for (const [route, capability] of Object.entries(ACCOUNTANT_ROUTES)) {
      expect(requiredCapabilityForRoute(route)).toBe(capability);
      expect(canAccessRoute({ role: 'accountant' }, route)).toBe(true);
    }
  });

  it.each([
    '/calls',
    '/calls/test',
    '/inbox',
    '/assistant',
    '/work-orders',
    '/properties',
    '/tenants',
    '/vendors',
    '/owner-queue',
    '/settings',
    '/onboarding',
    '/review/work_order/known-id',
  ])('denies %s to the Accountant preset', (route) => {
    expect(canAccessRoute({ role: 'accountant' }, route)).toBe(false);
  });

  it('wires every rendered surface and export to Accountant projections', () => {
    const files = [
      ['src/app/(dashboard)/today/page.tsx', 'loadAccountantReconciliation'],
      ['src/app/(dashboard)/rent/page.tsx', 'loadAccountantRentLedger'],
      ['src/app/(dashboard)/financials/page.tsx', 'loadAccountantFinancials'],
      ['src/app/(dashboard)/documents/page.tsx', 'loadAccountantDocuments'],
      ['src/app/api/accounting/export/route.ts', 'handleAccountantExportHttp'],
    ] as const;

    for (const [relative, seam] of files) {
      const source = readFileSync(join(process.cwd(), relative), 'utf8');
      expect(source, relative).toContain(seam);
      expect(source, relative).toContain('Accountant');
    }
  });
});
