import type {
  AccountantCloseState,
  AccountantDocumentRecord,
  AccountantLeaseContext,
  AccountantPaymentRecord,
  AccountantPropertyLeaseContext,
  AccountantPropertyReconciliation,
  AccountantReconciliationDesk,
  AccountantReconciliationIssue,
  AccountantRentEvent,
} from './types';
import {
  deriveRentEvidenceState,
  isConfirmedPaymentRecord,
  requiresRentEventMatch,
} from './register-state';

export interface BuildReconciliationInput {
  cycleMonth: string;
  periodLabel: string;
  availability: AccountantReconciliationDesk['availability'];
  canExport?: boolean;
  leases: readonly AccountantPropertyLeaseContext[];
  rentEvents: readonly AccountantRentEvent[];
  payments: readonly AccountantPaymentRecord[];
  documents: readonly AccountantDocumentRecord[];
}

const ISSUE_ORDER = {
  unmatched_payment: 0,
  missing_rent_cycle: 1,
  missing_lease_document: 2,
  payment_time_unavailable: 3,
  outstanding_balance: 4,
} as const;

const PRIORITY_ORDER = { high: 0, medium: 1, low: 2 } as const;

function activeForClose(
  context: AccountantPropertyLeaseContext,
): context is AccountantLeaseContext {
  return (
    context.contextKind === 'lease' &&
    (context.leaseStatus === 'active' || context.leaseStatus === 'pending')
  );
}

function settledPaymentStatus(status: string): boolean {
  return status.toLowerCase() === 'succeeded';
}

function sumMoney(
  rows: readonly AccountantRentEvent[],
  pick: (row: AccountantRentEvent) => number,
): number {
  return rows.reduce((total, row) => total + pick(row), 0);
}

function issueBase(
  row:
    | AccountantLeaseContext
    | AccountantRentEvent
    | AccountantPaymentRecord,
) {
  return {
    propertyId: row.propertyId,
    propertyName: row.propertyName,
    propertyArchivedAt: row.propertyArchivedAt,
    unitId: row.unitId,
    unitLabel: row.unitLabel,
    tenantId: row.tenantId,
    tenantName: row.tenantName,
    leaseId: row.leaseId,
  };
}

function buildIssues(input: {
  rentEvidenceAvailable: boolean;
  financialEvidenceAvailable: boolean;
  documentEvidenceAvailable: boolean;
  currentLeases: readonly AccountantLeaseContext[];
  rentEvents: readonly AccountantRentEvent[];
  payments: readonly AccountantPaymentRecord[];
  documents: readonly AccountantDocumentRecord[];
}): AccountantReconciliationIssue[] {
  const issues: AccountantReconciliationIssue[] = [];
  const leaseIdsWithCycle = new Set(
    input.rentEvents.map((event) => event.leaseId),
  );
  const leaseIdsWithDocument = new Set(
    input.documents
      .filter(
        (document) =>
          document.evidenceClass === 'lease_evidence' &&
          document.leaseId !== null,
      )
      .map((document) => document.leaseId as string),
  );

  if (input.financialEvidenceAvailable) {
    for (const payment of input.payments) {
      if (requiresRentEventMatch(payment)) {
        issues.push({
          ...issueBase(payment),
          id: `unmatched_payment:${payment.paymentId}`,
          kind: 'unmatched_payment',
          priority: 'high',
          title: 'Payment needs a rent-cycle match',
          summary:
            'A canonical payment row is not linked to a canonical rent event.',
          amountCents: payment.amountCents,
          occurredAt: payment.paidAt,
          evidence: [
            { label: 'Payment status', value: payment.status },
            {
              label: 'Payment time',
              value: payment.paidAt ?? 'Unavailable',
              tone: payment.paidAt ? 'neutral' : 'unavailable',
            },
            { label: 'Rent-event match', value: 'Missing', tone: 'warning' },
          ],
        });
      }

      // An unmatched row already carries the unavailable paid_at evidence in
      // its higher-priority dossier. Emit a separate timestamp finding only
      // once matching is complete so one canonical row does not create two
      // duplicate-looking work items.
      if (
        payment.matched &&
        payment.paidAt === null &&
        settledPaymentStatus(payment.status)
      ) {
        issues.push({
          ...issueBase(payment),
          id: `payment_time_unavailable:${payment.paymentId}`,
          kind: 'payment_time_unavailable',
          priority: 'medium',
          title: 'Payment time is unavailable',
          summary:
            'The payment row is settled, but no canonical paid_at evidence is present.',
          amountCents: payment.amountCents,
          occurredAt: null,
          evidence: [
            { label: 'Payment status', value: payment.status },
            {
              label: 'Paid at',
              value: 'Unavailable',
              tone: 'unavailable',
            },
          ],
        });
      }
    }
  }

  if (input.rentEvidenceAvailable) {
    for (const lease of input.currentLeases) {
      if (!leaseIdsWithCycle.has(lease.leaseId)) {
        issues.push({
          ...issueBase(lease),
          id: `missing_rent_cycle:${lease.leaseId}`,
          kind: 'missing_rent_cycle',
          priority: 'high',
          title: 'Rent cycle is missing',
          summary: 'No canonical rent event exists for this lease and period.',
          amountCents: null,
          occurredAt: null,
          evidence: [
            { label: 'Lease status', value: lease.leaseStatus },
            { label: 'Cycle', value: 'Missing', tone: 'warning' },
          ],
        });
      }
    }
  }

  if (input.documentEvidenceAvailable) {
    for (const lease of input.currentLeases) {
      if (!leaseIdsWithDocument.has(lease.leaseId)) {
        issues.push({
          ...issueBase(lease),
          id: `missing_lease_document:${lease.leaseId}`,
          kind: 'missing_lease_document',
          priority: 'medium',
          title: 'Linked lease evidence is missing',
          summary:
            'No eligible, explicitly linked lease document is in the accounting projection.',
          amountCents: null,
          occurredAt: null,
          evidence: [
            { label: 'Lease status', value: lease.leaseStatus },
            {
              label: 'Eligible lease file',
              value: 'Missing',
              tone: 'warning',
            },
          ],
        });
      }
    }
  }

  if (input.rentEvidenceAvailable) {
    for (const event of input.rentEvents) {
      const outstanding = Math.max(
        event.amountDueCents - event.amountPaidCents,
        0,
      );
      if (outstanding === 0) continue;
      issues.push({
        ...issueBase(event),
        id: `outstanding_balance:${event.rentEventId}`,
        kind: 'outstanding_balance',
        priority: 'low',
        title: 'Rent balance remains open',
        summary:
          'The canonical rent event has a billed amount greater than its collected amount.',
        amountCents: outstanding,
        occurredAt: null,
        evidence: [
          {
            label: 'Evidence state',
            value:
              deriveRentEvidenceState(event).charAt(0).toUpperCase() +
              deriveRentEvidenceState(event).slice(1),
          },
          { label: 'Due date', value: event.dueDate ?? 'Unavailable' },
        ],
      });
    }
  }

  return issues.sort(
    (a, b) =>
      PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority] ||
      ISSUE_ORDER[a.kind] - ISSUE_ORDER[b.kind] ||
      a.propertyName.localeCompare(b.propertyName) ||
      (a.unitLabel ?? '').localeCompare(b.unitLabel ?? '') ||
      a.id.localeCompare(b.id),
  );
}

function closeState(input: {
  propertyCount: number;
  availability: AccountantReconciliationDesk['availability'];
  issues: readonly AccountantReconciliationIssue[];
}): AccountantCloseState {
  if (input.propertyCount === 0) return 'no_properties';
  if (Object.values(input.availability).some((value) => value === 'denied')) {
    return 'access_limited';
  }
  if (input.issues.some((issue) => issue.kind === 'unmatched_payment')) {
    return 'payment_matching_required';
  }
  if (input.issues.length > 0) return 'needs_evidence';
  return 'rent_ledger_reviewed';
}

export function buildAccountantReconciliationDesk(
  input: BuildReconciliationInput,
): AccountantReconciliationDesk {
  const currentLeases = input.leases.filter(activeForClose);
  const rentEvidenceAvailable = input.availability.rent === 'available';
  const financialEvidenceAvailable =
    input.availability.financials === 'available';
  const documentEvidenceAvailable =
    input.availability.documents === 'available';
  const rentEvents = rentEvidenceAvailable ? input.rentEvents : [];
  const payments = financialEvidenceAvailable ? input.payments : [];
  const documents = documentEvidenceAvailable ? input.documents : [];

  const issues = buildIssues({
    rentEvidenceAvailable,
    financialEvidenceAvailable,
    documentEvidenceAvailable,
    currentLeases,
    rentEvents,
    payments,
    documents,
  });

  const propertyIds = new Set<string>();
  for (const row of input.leases) propertyIds.add(row.propertyId);
  for (const row of rentEvents) propertyIds.add(row.propertyId);
  for (const row of payments) propertyIds.add(row.propertyId);
  for (const row of documents) propertyIds.add(row.propertyId);

  const leaseIdsWithCycle = new Set(
    rentEvents.map((event) => event.leaseId),
  );
  const leaseIdsWithDocument = new Set(
    documents
      .filter(
        (document) =>
          document.evidenceClass === 'lease_evidence' &&
          document.leaseId !== null,
      )
      .map((document) => document.leaseId as string),
  );

  const properties: AccountantPropertyReconciliation[] = [];
  for (const propertyId of propertyIds) {
    const leases = currentLeases.filter((row) => row.propertyId === propertyId);
    const events = rentEvents.filter(
      (row) => row.propertyId === propertyId,
    );
    const propertyPayments = payments.filter(
      (row) => row.propertyId === propertyId,
    );
    const representative =
      input.leases.find((row) => row.propertyId === propertyId) ??
      rentEvents.find((row) => row.propertyId === propertyId) ??
      payments.find((row) => row.propertyId === propertyId) ??
      documents.find((row) => row.propertyId === propertyId);
    if (!representative) continue;

    const billed = sumMoney(events, (row) => row.amountDueCents);
    const collected = sumMoney(events, (row) => row.amountPaidCents);
    properties.push({
      propertyId,
      propertyName: representative.propertyName,
      propertyArchivedAt: representative.propertyArchivedAt,
      leaseCount: leases.length,
      billedCents: rentEvidenceAvailable ? billed : null,
      collectedCents: rentEvidenceAvailable ? collected : null,
      outstandingCents: rentEvidenceAvailable
        ? Math.max(billed - collected, 0)
        : null,
      missingCycleCount: rentEvidenceAvailable
        ? leases.filter((lease) => !leaseIdsWithCycle.has(lease.leaseId)).length
        : null,
      missingLeaseDocumentCount: documentEvidenceAvailable
        ? leases.filter(
            (lease) => !leaseIdsWithDocument.has(lease.leaseId),
          ).length
        : null,
      unmatchedPaymentCount: financialEvidenceAvailable
        ? propertyPayments.filter(requiresRentEventMatch).length
        : null,
      issueCount: issues.filter((issue) => issue.propertyId === propertyId)
        .length,
    });
  }

  properties.sort(
    (a, b) =>
      b.issueCount - a.issueCount ||
      (b.outstandingCents ?? -1) - (a.outstandingCents ?? -1) ||
      a.propertyName.localeCompare(b.propertyName),
  );

  const billed = sumMoney(rentEvents, (row) => row.amountDueCents);
  const collected = sumMoney(rentEvents, (row) => row.amountPaidCents);
  const missingCycleCount = rentEvidenceAvailable
    ? currentLeases.filter((lease) => !leaseIdsWithCycle.has(lease.leaseId))
        .length
    : null;
  const missingLeaseDocumentCount = documentEvidenceAvailable
    ? currentLeases.filter(
        (lease) => !leaseIdsWithDocument.has(lease.leaseId),
      ).length
    : null;

  return {
    cycleMonth: input.cycleMonth,
    periodLabel: input.periodLabel,
    availability: input.availability,
    closeState: closeState({
      propertyCount: propertyIds.size,
      availability: input.availability,
      issues,
    }),
    fullCloseAvailable: false,
    fullCloseUnavailableReason: 'expense_imports_not_connected',
    canExport: input.canExport === true,
    propertyCount: propertyIds.size,
    activeLeaseCount: currentLeases.length,
    leasesWithCycleCount:
      missingCycleCount === null
        ? null
        : Math.max(currentLeases.length - missingCycleCount, 0),
    missingCycleCount,
    missingLeaseDocumentCount,
    paymentRecordCount: financialEvidenceAvailable
      ? payments.length
      : null,
    providerConfirmedPaymentCount: financialEvidenceAvailable
      ? payments.filter(isConfirmedPaymentRecord).length
      : null,
    unmatchedPaymentCount: financialEvidenceAvailable
      ? payments.filter(requiresRentEventMatch).length
      : null,
    billedCents: rentEvidenceAvailable ? billed : null,
    collectedCents: rentEvidenceAvailable ? collected : null,
    outstandingCents: rentEvidenceAvailable
      ? Math.max(billed - collected, 0)
      : null,
    providerConfirmedCents: financialEvidenceAvailable
      ? payments.reduce(
          (total, payment) =>
            total +
            (isConfirmedPaymentRecord(payment) ? payment.amountCents : 0),
          0,
        )
      : null,
    properties,
    issues,
    paymentHistory: financialEvidenceAvailable
      ? [...payments].sort((a, b) => {
          if (a.paidAt && b.paidAt) return b.paidAt.localeCompare(a.paidAt);
          if (a.paidAt) return -1;
          if (b.paidAt) return 1;
          return a.paymentId.localeCompare(b.paymentId);
        })
      : [],
  };
}
