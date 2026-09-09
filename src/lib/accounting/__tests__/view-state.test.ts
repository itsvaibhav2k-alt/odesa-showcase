import { describe, expect, it } from 'vitest';

import {
  buildAccountantExportParams,
  normalizeAccountantCycleContext,
  normalizeAccountantView,
} from '../view-state';
import type { AccountantReconciliationIssue } from '../types';

const issues: AccountantReconciliationIssue[] = [
  {
    id: 'unmatched_payment:payment-1',
    kind: 'unmatched_payment',
    priority: 'high',
    title: 'Payment needs a rent-cycle match',
    summary: 'A real payment row is not linked to a rent event.',
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
  },
  {
    id: 'missing_lease_document:lease-2',
    kind: 'missing_lease_document',
    priority: 'medium',
    title: 'Linked lease evidence missing',
    summary: 'No eligible linked lease file is in the accounting projection.',
    propertyId: 'property-2',
    propertyName: '17th Street Row',
    propertyArchivedAt: null,
    unitId: 'unit-2',
    unitLabel: 'C',
    tenantId: 'tenant-2',
    tenantName: 'Jessica Kim',
    leaseId: 'lease-2',
    amountCents: null,
    occurredAt: null,
    evidence: [],
  },
];

describe('accountant URL state', () => {
  it('keeps a historical selected close month separate from the real current month', () => {
    expect(
      normalizeAccountantCycleContext(
        '2026-07',
        new Date('2026-08-12T12:00:00.000Z'),
      ),
    ).toEqual({
      selectedCycleMonth: '2026-07-01',
      currentCycleMonth: '2026-08-01',
    });
  });

  it('round-trips valid period, filter, query, and selected-row state', () => {
    const normalized = normalizeAccountantView(
      {
        cycle: '2026-08',
        property: 'property-1',
        issue: 'matching',
        q: ' marcus ',
        selected: 'unmatched_payment:payment-1',
      },
      issues,
      new Date('2026-08-12T12:00:00.000Z'),
    );

    expect(normalized.state).toEqual({
      cycleMonth: '2026-08-01',
      propertyId: 'property-1',
      issueFilter: 'matching',
      query: 'marcus',
      selectedIssueId: 'unmatched_payment:payment-1',
      page: 1,
    });
    expect(normalized.visibleIssues).toHaveLength(1);
    expect(normalized.staleSelectionCleared).toBe(false);
    expect(normalized.searchParams.toString()).toBe(
      'cycle=2026-08&property=property-1&issue=matching&q=marcus&selected=unmatched_payment%3Apayment-1',
    );
  });

  it('clears a dossier selection when a filter removes that row', () => {
    const normalized = normalizeAccountantView(
      {
        property: 'property-2',
        selected: 'unmatched_payment:payment-1',
      },
      issues,
      new Date('2026-08-12T12:00:00.000Z'),
    );

    expect(normalized.visibleIssues).toEqual([
      expect.objectContaining({ id: 'missing_lease_document:lease-2' }),
    ]);
    expect(normalized.state.selectedIssueId).toBeNull();
    expect(normalized.staleSelectionCleared).toBe(true);
    expect(normalized.searchParams.has('selected')).toBe(false);
  });

  it('fails malformed values to bounded defaults without retaining injected state', () => {
    const normalized = normalizeAccountantView(
      {
        cycle: '2026-19',
        issue: 'everything',
        property: ' '.repeat(200),
        q: 'x'.repeat(500),
        selected: 'unknown:known-id',
      },
      issues,
      new Date('2026-08-12T12:00:00.000Z'),
    );

    expect(normalized.state.cycleMonth).toBe('2026-08-01');
    expect(normalized.state.issueFilter).toBe('all');
    expect(normalized.state.propertyId).toBeNull();
    expect(normalized.state.query).toHaveLength(80);
    expect(normalized.state.selectedIssueId).toBeNull();
  });

  it('rejects year zero before a period reaches the database date boundary', () => {
    const normalized = normalizeAccountantView(
      { cycle: '0000-02' },
      issues,
      new Date('2026-08-12T12:00:00.000Z'),
    );

    expect(normalized.state.cycleMonth).toBe('2026-08-01');
    expect(
      normalizeAccountantView(
        { cycle: '9999-12' },
        issues,
        new Date('2026-08-12T12:00:00.000Z'),
      ).state.cycleMonth,
    ).toBe('2026-08-01');
  });

  it('builds export parameters from the same visible filters', () => {
    const normalized = normalizeAccountantView(
      {
        cycle: '2026-08',
        property: 'property-1',
        issue: 'matching',
        q: 'Marcus',
        selected: 'unmatched_payment:payment-1',
      },
      issues,
      new Date('2026-08-12T12:00:00.000Z'),
    );

    expect(
      buildAccountantExportParams('reconciliation', {
        ...normalized.state,
        page: 3,
      }).toString(),
    ).toBe(
      'kind=reconciliation&cycle=2026-08&property=property-1&issue=matching&q=Marcus',
    );
  });

  it('paginates the register and resolves a selected discrepancy to its page', () => {
    const manyIssues = Array.from({ length: 45 }, (_, index) => ({
      ...issues[0],
      id: `unmatched_payment:payment-${index}`,
    }));
    const normalized = normalizeAccountantView(
      { selected: 'unmatched_payment:payment-42' },
      manyIssues,
      new Date('2026-08-12T12:00:00.000Z'),
      20,
    );

    expect(normalized.state.page).toBe(3);
    expect(normalized.visibleIssues).toHaveLength(5);
    expect(normalized.selectedIssue?.id).toBe(
      'unmatched_payment:payment-42',
    );
    expect(normalized.searchParams.toString()).toContain('page=3');
  });

  it('preserves assigned properties without issues and flags unknown property ids', () => {
    const authorized = new Set(['property-1', 'property-2', 'property-empty']);
    const empty = normalizeAccountantView(
      { property: 'property-empty' },
      issues,
      new Date('2026-08-12T12:00:00.000Z'),
      40,
      authorized,
    );
    expect(empty).toMatchObject({
      unknownPropertyRequested: false,
      state: { propertyId: 'property-empty' },
      visibleIssues: [],
    });

    const unknown = normalizeAccountantView(
      { property: 'property-revoked' },
      issues,
      new Date('2026-08-12T12:00:00.000Z'),
      40,
      authorized,
    );
    expect(unknown.state.propertyId).toBeNull();
    expect(unknown.unknownPropertyRequested).toBe(true);
    expect(unknown.visibleIssues).toEqual([]);
    expect(unknown.filteredIssueCount).toBe(0);
  });

  it.each([
    { label: 'wildcard', property: '*' },
    { label: 'overlong', property: 'x'.repeat(129) },
    { label: 'duplicate', property: ['property-1', 'property-2'] },
  ])('denies $label property input instead of broadening', ({ property }) => {
    const normalized = normalizeAccountantView(
      { property },
      issues,
      new Date('2026-08-12T12:00:00.000Z'),
      40,
      new Set(['property-1', 'property-2']),
    );

    expect(normalized.unknownPropertyRequested).toBe(true);
    expect(normalized.visibleIssues).toEqual([]);
  });
});
