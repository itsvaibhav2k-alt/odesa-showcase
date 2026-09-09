import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ReconciliationWorkspace } from '../reconciliation-workspace';
import type {
  AccountantReconciliationDesk,
  AccountantReconciliationIssue,
} from '@/lib/accounting/types';
import type { AccountantViewState } from '@/lib/accounting/view-state';

const push = vi.fn();

vi.mock('next/navigation', () => ({
  usePathname: () => '/today',
  useRouter: () => ({ push }),
}));

const issue: AccountantReconciliationIssue = {
  id: 'unmatched_payment:payment-1',
  kind: 'unmatched_payment',
  priority: 'high',
  title: 'Payment needs a rent-cycle match',
  summary: 'A canonical payment row is not linked to a rent event.',
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
  evidence: [
    { label: 'Payment time', value: 'Aug 4, 2026' },
    { label: 'Rent-event match', value: 'Missing', tone: 'warning' },
  ],
};

const model: AccountantReconciliationDesk = {
  cycleMonth: '2026-08-01',
  periodLabel: 'August 2026',
  availability: {
    rent: 'available',
    financials: 'available',
    documents: 'available',
  },
  closeState: 'payment_matching_required',
  fullCloseAvailable: false,
  fullCloseUnavailableReason: 'expense_imports_not_connected',
  canExport: true,
  propertyCount: 1,
  activeLeaseCount: 1,
  leasesWithCycleCount: 1,
  missingCycleCount: 0,
  missingLeaseDocumentCount: 0,
  paymentRecordCount: 1,
  providerConfirmedPaymentCount: 1,
  unmatchedPaymentCount: 1,
  billedCents: 180_000,
  collectedCents: 120_000,
  outstandingCents: 60_000,
  providerConfirmedCents: 120_000,
  properties: [
    {
      propertyId: 'property-1',
      propertyName: 'Oakwood Commons',
      propertyArchivedAt: null,
      leaseCount: 1,
      billedCents: 180_000,
      collectedCents: 120_000,
      outstandingCents: 60_000,
      missingCycleCount: 0,
      missingLeaseDocumentCount: 0,
      unmatchedPaymentCount: 1,
      issueCount: 1,
    },
  ],
  issues: [issue],
  paymentHistory: [],
};

const baseState: AccountantViewState = {
  cycleMonth: '2026-08-01',
  propertyId: null,
  issueFilter: 'all',
  query: '',
  selectedIssueId: null,
  page: 1,
};

const issuePage = {
  page: 1,
  pageCount: 1,
  range: { from: 1, to: 1, total: 1 },
};

function matchMedia(matches: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn().mockImplementation(() => ({
      matches,
      media: '(max-width: 760px)',
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

describe('ReconciliationWorkspace', () => {
  beforeEach(() => {
    push.mockReset();
    matchMedia(false);
  });

  it('uses the full register width until a real row is selected', () => {
    render(
      <ReconciliationWorkspace
        model={model}
        state={baseState}
        visibleIssues={[issue]}
        selectedIssue={null}
        filteredIssueCount={1}
        issuePage={issuePage}
        currentCycleMonth="2026-08-01"
      />,
    );

    expect(screen.getByTestId('accounting-workspace')).toHaveAttribute(
      'data-has-selection',
      'false',
    );
    expect(screen.queryByTestId('accounting-dossier')).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /Payment needs a rent-cycle match/i }),
    ).toBeVisible();
  });

  it('does not label a nonpayment discrepancy with an unavailable payment time', () => {
    const missingCycle: AccountantReconciliationIssue = {
      ...issue,
      id: 'missing_rent_cycle:lease-1',
      kind: 'missing_rent_cycle',
      title: 'Rent cycle is missing',
      amountCents: null,
      occurredAt: null,
      evidence: [{ label: 'Cycle', value: 'Missing', tone: 'warning' }],
    };
    render(
      <ReconciliationWorkspace
        model={{ ...model, issues: [missingCycle] }}
        state={{ ...baseState, selectedIssueId: missingCycle.id }}
        visibleIssues={[missingCycle]}
        selectedIssue={missingCycle}
        filteredIssueCount={1}
        issuePage={issuePage}
        currentCycleMonth="2026-08-01"
      />,
    );

    expect(screen.queryByText('Canonical payment time')).not.toBeInTheDocument();
  });

  it('writes selection and filter state to the URL while clearing stale selection', () => {
    render(
      <ReconciliationWorkspace
        model={model}
        state={baseState}
        visibleIssues={[issue]}
        selectedIssue={null}
        filteredIssueCount={1}
        issuePage={issuePage}
        currentCycleMonth="2026-08-01"
      />,
    );

    fireEvent.click(
      screen.getByRole('button', { name: /Payment needs a rent-cycle match/i }),
    );
    expect(push).toHaveBeenLastCalledWith(
      '/today?cycle=2026-08&selected=unmatched_payment%3Apayment-1',
    );

    fireEvent.change(screen.getByLabelText('Property scope'), {
      target: { value: 'property-1' },
    });
    expect(push).toHaveBeenLastCalledWith(
      '/today?cycle=2026-08&property=property-1',
    );
  });

  it('opens a mobile dossier, closes on Escape, and restores row focus', async () => {
    matchMedia(true);
    const rendered = render(
      <ReconciliationWorkspace
        model={model}
        state={{ ...baseState, selectedIssueId: issue.id }}
        visibleIssues={[issue]}
        selectedIssue={issue}
        filteredIssueCount={1}
        issuePage={issuePage}
        currentCycleMonth="2026-08-01"
      />,
    );

    const dialog = await screen.findByRole('dialog', {
      name: 'Payment needs a rent-cycle match',
    });
    const close = screen.getByRole('button', { name: 'Close evidence dossier' });
    await waitFor(() => expect(close).toHaveFocus());
    expect(document.body.style.overflow).toBe('hidden');

    fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true });
    expect(screen.getByRole('link', { name: 'Open Financials →' }))
      .toHaveFocus();
    expect(screen.getByRole('link', { name: 'Open Financials →' }))
      .toHaveAttribute(
        'href',
        '/financials?period=mtd&property=property-1&state=unmatched&q=Marcus+Alvarez&payment=payment-1',
      );
    fireEvent.keyDown(dialog, { key: 'Tab' });
    expect(close).toHaveFocus();

    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(push).toHaveBeenLastCalledWith('/today?cycle=2026-08');
    expect(close).toHaveFocus();

    rendered.rerender(
      <ReconciliationWorkspace
        model={model}
        state={baseState}
        visibleIssues={[issue]}
        selectedIssue={null}
        filteredIssueCount={1}
        issuePage={issuePage}
        currentCycleMonth="2026-08-01"
      />,
    );
    await waitFor(() =>
      expect(
        screen.getByRole('button', {
          name: /Payment needs a rent-cycle match/i,
        }),
      ).toHaveFocus(),
    );
    expect(document.body.style.overflow).toBe('');
  });

  it('links export to the exact visible period and filters', () => {
    render(
      <ReconciliationWorkspace
        model={model}
        state={{
          ...baseState,
          propertyId: 'property-1',
          issueFilter: 'matching',
          query: 'Marcus',
        }}
        visibleIssues={[issue]}
        selectedIssue={null}
        filteredIssueCount={1}
        issuePage={issuePage}
        currentCycleMonth="2026-08-01"
      />,
    );

    expect(screen.getByRole('link', { name: 'Export filtered register' }))
      .toHaveAttribute(
        'href',
        '/api/accounting/export?kind=reconciliation&cycle=2026-08&property=property-1&issue=matching&q=Marcus',
      );
  });

  it('keeps the close headline and totals honest when property scope is filtered', () => {
    const filteredModel: AccountantReconciliationDesk = {
      ...model,
      propertyCount: 2,
      billedCents: 185_000,
      collectedCents: 125_000,
      properties: [
        ...model.properties,
        {
          propertyId: 'property-2',
          propertyName: 'Archive Annex',
          propertyArchivedAt: '2026-07-31T00:00:00.000Z',
          leaseCount: 1,
          billedCents: 5_000,
          collectedCents: 5_000,
          outstandingCents: 0,
          missingCycleCount: 0,
          missingLeaseDocumentCount: 0,
          unmatchedPaymentCount: 0,
          issueCount: 0,
        },
      ],
    };
    render(
      <ReconciliationWorkspace
        model={filteredModel}
        state={{ ...baseState, propertyId: 'property-2' }}
        visibleIssues={[]}
        selectedIssue={null}
        filteredIssueCount={0}
        issuePage={{
          page: 1,
          pageCount: 1,
          range: { from: 0, to: 0, total: 0 },
        }}
        currentCycleMonth="2026-08-01"
      />,
    );

    const position = screen.getByRole('region', { name: 'Close position' });
    expect(within(position).getByText('Rent evidence reviewed')).toBeVisible();
    expect(within(position).getByText('Scoped').nextElementSibling).toHaveTextContent('1');
    expect(within(position).getByText('Net due').nextElementSibling).toHaveTextContent('$50.00');
    expect(within(position).getByText('Ledger collected').nextElementSibling).toHaveTextContent('$50.00');
    expect(within(position).getByText('Open').nextElementSibling).toHaveTextContent('$0.00');
  });

  it('restores the selected discrepancy row when browser Back closes the dossier', async () => {
    matchMedia(true);
    const rendered = render(
      <ReconciliationWorkspace
        model={model}
        state={{ ...baseState, selectedIssueId: issue.id }}
        visibleIssues={[issue]}
        selectedIssue={issue}
        filteredIssueCount={1}
        issuePage={issuePage}
        currentCycleMonth="2026-08-01"
      />,
    );
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Close evidence dossier' }),
      ).toHaveFocus(),
    );

    rendered.rerender(
      <ReconciliationWorkspace
        model={model}
        state={baseState}
        visibleIssues={[issue]}
        selectedIssue={null}
        filteredIssueCount={1}
        issuePage={issuePage}
        currentCycleMonth="2026-08-01"
      />,
    );
    await waitFor(() =>
      expect(
        screen.getByRole('button', {
          name: /Payment needs a rent-cycle match/i,
        }),
      ).toHaveFocus(),
    );
  });
});
