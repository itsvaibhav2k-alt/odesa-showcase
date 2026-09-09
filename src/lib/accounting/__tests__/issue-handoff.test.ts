import { describe, expect, it } from 'vitest';

import { buildAccountantIssueHandoff } from '../issue-handoff';
import type { AccountantReconciliationIssue } from '../types';

const issue: AccountantReconciliationIssue = {
  id: 'unmatched_payment:payment-1',
  kind: 'unmatched_payment',
  priority: 'high',
  title: 'Payment needs a rent-cycle match',
  summary: 'A canonical payment row is not linked.',
  propertyId: 'property-1',
  propertyName: 'Oakwood Commons',
  propertyArchivedAt: null,
  unitId: 'unit-1',
  unitLabel: '101',
  tenantId: 'tenant-1',
  tenantName: 'Marcus Alvarez',
  leaseId: 'lease-1',
  amountCents: 120_000,
  occurredAt: '2026-08-04T16:00:00.000Z',
  evidence: [],
};

describe('Accountant discrepancy handoffs', () => {
  it('opens the exact payment row in the narrowest containing financial period', () => {
    expect(
      buildAccountantIssueHandoff(issue, '2026-08-01', '2026-09-01'),
    ).toEqual({
      label: 'Open Financials',
      href: '/financials?period=last&property=property-1&state=unmatched&q=Marcus+Alvarez&payment=payment-1',
    });
  });

  it('uses QTD then YTD for older months and omits an unsupported prior-year handoff', () => {
    expect(
      buildAccountantIssueHandoff(issue, '2026-07-01', '2026-09-01')?.href,
    ).toContain('period=qtd');
    expect(
      buildAccountantIssueHandoff(issue, '2026-02-01', '2026-09-01')?.href,
    ).toContain('period=ytd');
    expect(
      buildAccountantIssueHandoff(issue, '2025-12-01', '2026-09-01'),
    ).toBeNull();
  });

  it('carries cycle, property, and selected canonical rent event', () => {
    expect(
      buildAccountantIssueHandoff(
        {
          ...issue,
          id: 'outstanding_balance:rent-event-1',
          kind: 'outstanding_balance',
        },
        '2026-08-01',
        '2026-08-01',
      ),
    ).toEqual({
      label: 'Open Rent',
      href: '/rent?cycle=2026-08&property=property-1&state=outstanding&q=Marcus+Alvarez&event=rent-event-1',
    });
  });

  it('opens the property missing-evidence lane without inventing a document id', () => {
    expect(
      buildAccountantIssueHandoff(
        {
          ...issue,
          id: 'missing_lease_document:lease-1',
          kind: 'missing_lease_document',
        },
        '2026-08-01',
        '2026-08-01',
      ),
    ).toEqual({
      label: 'Open Documents',
      href: '/documents?property=property-1&type=lease&q=Marcus+Alvarez&context=missing_lease_evidence',
    });
  });

  it('labels a missing-cycle empty Rent result with its reconciliation context', () => {
    expect(
      buildAccountantIssueHandoff(
        {
          ...issue,
          id: 'missing_rent_cycle:lease-1',
          kind: 'missing_rent_cycle',
        },
        '2026-08-01',
        '2026-08-01',
      ),
    ).toEqual({
      label: 'Open Rent',
      href: '/rent?cycle=2026-08&property=property-1&q=Marcus+Alvarez&context=missing_cycle',
    });
  });
});
