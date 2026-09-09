/**
 * Accountant-safe read models.
 *
 * Only fields emitted by the Accountant projection boundary belong here.
 * Provider identifiers, contact details, organization ids, storage keys,
 * document URLs, and canonical write fields are deliberately absent.
 */

export type AccountantDataAvailability = 'available' | 'denied';

interface AccountantPropertyContextBase {
  propertyId: string;
  propertyName: string;
  propertyArchivedAt: string | null;
}

export interface AccountantPropertyOnlyContext
  extends AccountantPropertyContextBase {
  contextKind: 'property';
  unitId: null;
  unitLabel: null;
  tenantId: null;
  tenantName: null;
  leaseId: null;
  leaseStatus: null;
  leaseStartDate: null;
  leaseEndDate: null;
}

export interface AccountantLeaseContext extends AccountantPropertyContextBase {
  contextKind: 'lease';
  unitId: string;
  unitLabel: string;
  tenantId: string;
  tenantName: string;
  leaseId: string;
  leaseStatus: 'active' | 'pending' | 'expired' | 'terminated';
  leaseStartDate: string | null;
  leaseEndDate: string | null;
}

export type AccountantPropertyLeaseContext =
  | AccountantPropertyOnlyContext
  | AccountantLeaseContext;

export interface AccountantRentEvent extends AccountantPropertyContextBase {
  rentEventId: string;
  unitId: string;
  unitLabel: string;
  tenantId: string;
  tenantName: string;
  leaseId: string;
  cycleMonth: string;
  dueDate: string | null;
  amountDueCents: number;
  amountPaidCents: number;
  status: string;
  waivedAmountCents: number | null;
  waivedAt: string | null;
}

export interface AccountantPaymentRecord
  extends AccountantPropertyContextBase {
  paymentId: string;
  unitId: string;
  unitLabel: string;
  tenantId: string;
  tenantName: string;
  leaseId: string;
  amountCents: number;
  /** Accountant projections are USD-only; unsupported currency rows fail out. */
  currency: 'USD';
  status: string;
  /** Canonical payment timestamp. Null is always rendered as unavailable. */
  paidAt: string | null;
  /**
   * Why this row belongs to the requested register window. A recorded
   * exception is never counted or rendered as an actual payment time.
   */
  periodBasis: 'payment_time' | 'record_created_exception';
  rentEventId: string | null;
  matched: boolean;
  receiptPresent: boolean;
}

export type AccountantDocumentEvidenceClass =
  | 'lease_evidence'
  | 'property_accounting_evidence';

export interface AccountantDocumentRecord
  extends AccountantPropertyContextBase {
  documentId: string;
  unitId: string | null;
  unitLabel: string | null;
  tenantId: string | null;
  tenantName: string | null;
  leaseId: string | null;
  leaseStatus: 'active' | 'pending' | 'expired' | 'terminated' | null;
  evidenceClass: AccountantDocumentEvidenceClass;
  title: string;
  type: string;
  expiryDate: string | null;
  createdAt: string;
}

export type AccountantCloseState =
  | 'no_properties'
  | 'access_limited'
  | 'needs_evidence'
  | 'payment_matching_required'
  | 'rent_ledger_reviewed';

export type AccountantIssueKind =
  | 'unmatched_payment'
  | 'missing_rent_cycle'
  | 'missing_lease_document'
  | 'payment_time_unavailable'
  | 'outstanding_balance';

export type AccountantIssuePriority = 'high' | 'medium' | 'low';

export interface AccountantIssueEvidence {
  label: string;
  value: string;
  tone?: 'neutral' | 'warning' | 'unavailable';
}

/** One immutable, evidence-backed row in the reconciliation work register. */
export interface AccountantReconciliationIssue
  extends AccountantPropertyContextBase {
  id: string;
  kind: AccountantIssueKind;
  priority: AccountantIssuePriority;
  title: string;
  summary: string;
  unitId: string | null;
  unitLabel: string | null;
  tenantId: string | null;
  tenantName: string | null;
  leaseId: string | null;
  amountCents: number | null;
  /** Only a canonical paid_at may populate payment occurrence time. */
  occurredAt: string | null;
  evidence: AccountantIssueEvidence[];
}

export interface AccountantPropertyReconciliation
  extends AccountantPropertyContextBase {
  leaseCount: number;
  billedCents: number | null;
  collectedCents: number | null;
  outstandingCents: number | null;
  missingCycleCount: number | null;
  missingLeaseDocumentCount: number | null;
  unmatchedPaymentCount: number | null;
  issueCount: number;
}

export interface AccountantReconciliationDesk {
  cycleMonth: string;
  periodLabel: string;
  availability: {
    rent: AccountantDataAvailability;
    financials: AccountantDataAvailability;
    documents: AccountantDataAvailability;
  };
  closeState: AccountantCloseState;
  fullCloseAvailable: false;
  fullCloseUnavailableReason: 'expense_imports_not_connected';
  canExport: boolean;
  propertyCount: number;
  activeLeaseCount: number;
  leasesWithCycleCount: number | null;
  missingCycleCount: number | null;
  missingLeaseDocumentCount: number | null;
  paymentRecordCount: number | null;
  providerConfirmedPaymentCount: number | null;
  unmatchedPaymentCount: number | null;
  billedCents: number | null;
  collectedCents: number | null;
  outstandingCents: number | null;
  providerConfirmedCents: number | null;
  properties: AccountantPropertyReconciliation[];
  issues: AccountantReconciliationIssue[];
  paymentHistory: AccountantPaymentRecord[];
}

export interface AccountantRentLedgerModel {
  cycleMonth: string;
  periodLabel: string;
  billedCents: number;
  collectedCents: number;
  outstandingCents: number;
  canExport: boolean;
  rows: AccountantRentEvent[];
  properties: AccountantPropertyReconciliation[];
}

export interface AccountantFinancialsModel {
  periodKey: 'mtd' | 'last' | 'qtd' | 'ytd';
  cycleStart: string;
  cycleEnd: string;
  fromDate: string;
  toDate: string;
  periodLabel: string;
  /** Null when view_rent is denied; zero would falsely assert no obligation. */
  billedCents: number | null;
  collectedCents: number | null;
  outstandingCents: number | null;
  providerConfirmedCents: number;
  unmatchedPaymentCount: number;
  canExport: boolean;
  events: AccountantRentEvent[];
  payments: AccountantPaymentRecord[];
  properties: AccountantPropertyReconciliation[];
}

export interface AccountantDocumentsModel {
  rows: AccountantDocumentRecord[];
  missingLeaseEvidence: AccountantLeaseContext[];
  missingCount: number;
  canExport: boolean;
  properties: AccountantPropertyReconciliation[];
}
