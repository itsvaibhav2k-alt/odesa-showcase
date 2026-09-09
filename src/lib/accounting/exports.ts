import { buildAccountantCsv, type AccountantCsvColumn } from './csv';
import {
  deriveRentEvidenceState,
  filterAccountantDocuments,
  filterAccountantPayments,
  filterAccountantRent,
  paymentEvidenceState,
  type AccountantDocumentViewState,
  type AccountantFinancialViewState,
  type AccountantRentViewState,
} from './register-state';
import type {
  AccountantDocumentRecord,
  AccountantPaymentRecord,
  AccountantReconciliationIssue,
  AccountantRentEvent,
} from './types';
import {
  filterAccountantIssues,
  type AccountantViewState,
} from './view-state';

export interface AccountantCsvArtifact {
  filename: string;
  csv: string;
  rowCount: number;
}

export const ACCOUNTANT_EXPORT_MAX_ROWS = 10_000;
export const ACCOUNTANT_EXPORT_MAX_BYTES = 8 * 1024 * 1024;

export class AccountantExportLimitError extends Error {
  constructor() {
    super('Accounting export exceeds the supported exact-export limit');
    this.name = 'AccountantExportLimitError';
  }
}

function money(cents: number): string {
  return (cents / 100).toFixed(2);
}

function label(value: string): string {
  const words = value.replaceAll('_', ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

const RENT_COLUMNS: readonly AccountantCsvColumn<AccountantRentEvent>[] = [
  { header: 'Property', value: (row) => row.propertyName },
  { header: 'Archived property', value: (row) => row.propertyArchivedAt !== null },
  { header: 'Unit', value: (row) => row.unitLabel },
  { header: 'Due date', value: (row) => row.dueDate },
  { header: 'Current obligation', value: (row) => money(row.amountDueCents) },
  { header: 'Collected in ledger', value: (row) => money(row.amountPaidCents) },
  {
    header: 'Open balance',
    value: (row) => money(Math.max(row.amountDueCents - row.amountPaidCents, 0)),
  },
  {
    header: 'Waived amount',
    value: (row) => money(row.waivedAmountCents ?? 0),
  },
  {
    header: 'Evidence state',
    value: (row) => label(deriveRentEvidenceState(row)),
  },
];

const PAYMENT_COLUMNS: readonly AccountantCsvColumn<AccountantPaymentRecord>[] = [
  { header: 'Property', value: (row) => row.propertyName },
  { header: 'Archived property', value: (row) => row.propertyArchivedAt !== null },
  { header: 'Unit', value: (row) => row.unitLabel },
  { header: 'Amount', value: (row) => money(row.amountCents) },
  { header: 'Currency', value: (row) => row.currency },
  { header: 'Status', value: (row) => label(row.status) },
  { header: 'Payment time', value: (row) => row.paidAt ?? 'Unavailable' },
  {
    header: 'Period inclusion',
    value: (row) =>
      row.periodBasis === 'payment_time'
        ? 'Canonical payment time'
        : 'Recorded exception; payment time unavailable',
  },
  { header: 'Evidence state', value: (row) => label(paymentEvidenceState(row)) },
  { header: 'Matched to rent event', value: (row) => row.matched },
  { header: 'Receipt present', value: (row) => row.receiptPresent },
];

const DOCUMENT_COLUMNS: readonly AccountantCsvColumn<AccountantDocumentRecord>[] = [
  { header: 'Document', value: (row) => row.title },
  { header: 'Property', value: (row) => row.propertyName },
  { header: 'Archived property', value: (row) => row.propertyArchivedAt !== null },
  { header: 'Unit', value: (row) => row.unitLabel },
  {
    header: 'Evidence class',
    value: (row) =>
      row.evidenceClass === 'lease_evidence'
        ? 'Lease evidence'
        : 'Property accounting',
  },
  { header: 'Type', value: (row) => label(row.type) },
  { header: 'Expires', value: (row) => row.expiryDate ?? 'No expiry' },
  { header: 'Indexed', value: (row) => row.createdAt },
];

const ISSUE_KIND_LABEL: Record<AccountantReconciliationIssue['kind'], string> = {
  unmatched_payment: 'Payment matching',
  missing_rent_cycle: 'Missing rent cycle',
  missing_lease_document: 'Missing lease evidence',
  payment_time_unavailable: 'Payment time unavailable',
  outstanding_balance: 'Open rent balance',
};

const RECONCILIATION_COLUMNS: readonly AccountantCsvColumn<AccountantReconciliationIssue>[] = [
  { header: 'Discrepancy', value: (row) => ISSUE_KIND_LABEL[row.kind] },
  { header: 'Priority', value: (row) => label(row.priority) },
  { header: 'Finding', value: (row) => row.title },
  { header: 'Property', value: (row) => row.propertyName },
  { header: 'Archived property', value: (row) => row.propertyArchivedAt !== null },
  { header: 'Unit', value: (row) => row.unitLabel },
  {
    header: 'Amount under review',
    value: (row) => (row.amountCents === null ? '' : money(row.amountCents)),
  },
  {
    header: 'Canonical payment time',
    value: (row) =>
      row.kind === 'unmatched_payment' ||
      row.kind === 'payment_time_unavailable'
        ? row.occurredAt ?? 'Unavailable'
        : '',
  },
];

function artifact<Row>(
  filename: string,
  rows: readonly Row[],
  columns: readonly AccountantCsvColumn<Row>[],
): AccountantCsvArtifact {
  if (rows.length > ACCOUNTANT_EXPORT_MAX_ROWS) {
    throw new AccountantExportLimitError();
  }
  const csv = buildAccountantCsv(rows, columns);
  if (new TextEncoder().encode(csv).byteLength > ACCOUNTANT_EXPORT_MAX_BYTES) {
    throw new AccountantExportLimitError();
  }
  return {
    filename,
    csv,
    rowCount: rows.length,
  };
}

export function buildRentLedgerExport(
  rows: readonly AccountantRentEvent[],
  state: AccountantRentViewState,
): AccountantCsvArtifact {
  const filtered = filterAccountantRent(rows, state);
  return artifact(
    `odesa-rent-ledger-${state.cycleMonth.slice(0, 7)}.csv`,
    filtered,
    RENT_COLUMNS,
  );
}

export function buildPaymentHistoryExport(
  rows: readonly AccountantPaymentRecord[],
  state: AccountantFinancialViewState,
  period: { fromDate: string; toDate: string },
): AccountantCsvArtifact {
  return artifact(
    `odesa-payment-history-${period.fromDate}-${period.toDate}.csv`,
    filterAccountantPayments(rows, state),
    PAYMENT_COLUMNS,
  );
}

export function buildDocumentIndexExport(
  rows: readonly AccountantDocumentRecord[],
  state: AccountantDocumentViewState,
): AccountantCsvArtifact {
  return artifact(
    'odesa-document-index.csv',
    filterAccountantDocuments(rows, state),
    DOCUMENT_COLUMNS,
  );
}

export function buildReconciliationExport(
  rows: readonly AccountantReconciliationIssue[],
  state: AccountantViewState,
): AccountantCsvArtifact {
  return artifact(
    `odesa-reconciliation-${state.cycleMonth.slice(0, 7)}.csv`,
    filterAccountantIssues(rows, state),
    RECONCILIATION_COLUMNS,
  );
}
