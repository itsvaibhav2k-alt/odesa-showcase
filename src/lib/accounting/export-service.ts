import type { AccountantExportRequest } from './export-request';
import {
  buildDocumentIndexExport,
  buildPaymentHistoryExport,
  buildReconciliationExport,
  buildRentLedgerExport,
  type AccountantCsvArtifact,
} from './exports';
import {
  loadAccountantDocuments,
  loadAccountantPaymentHistory,
  loadAccountantReconciliation,
  loadAccountantRentLedger,
  type AccountantProjectionClient,
} from './repository';

export class AccountantExportAccessError extends Error {
  readonly status = 403;

  constructor() {
    super('Forbidden');
    this.name = 'AccountantExportAccessError';
  }
}

function requireCapabilities(
  capabilities: ReadonlySet<string>,
  ...required: string[]
): void {
  if (required.some((capability) => !capabilities.has(capability))) {
    throw new AccountantExportAccessError();
  }
}

export async function createAccountantExport(
  client: AccountantProjectionClient,
  capabilities: ReadonlySet<string>,
  request: AccountantExportRequest,
): Promise<AccountantCsvArtifact> {
  requireCapabilities(capabilities, 'export_financials');

  if (request.kind === 'reconciliation') {
    requireCapabilities(capabilities, 'view_dashboard');
    const model = await loadAccountantReconciliation(client, {
      cycleMonth: request.cycleMonth,
      capabilities,
    });
    return buildReconciliationExport(model.issues, {
      cycleMonth: request.cycleMonth,
      propertyId: request.propertyId,
      issueFilter: request.issueFilter,
      query: request.query,
      selectedIssueId: null,
      page: 1,
    });
  }

  if (request.kind === 'rent-ledger') {
    requireCapabilities(capabilities, 'view_rent');
    const model = await loadAccountantRentLedger(client, {
      cycleMonth: request.cycleMonth,
      capabilities,
    });
    return buildRentLedgerExport(model.rows, {
      cycleMonth: request.cycleMonth,
      propertyId: request.propertyId,
      state: request.state,
      query: request.query,
      eventId: null,
      page: 1,
    });
  }

  if (request.kind === 'payment-history') {
    requireCapabilities(capabilities, 'view_financials');
    const rows = await loadAccountantPaymentHistory(client, {
      fromDate: request.fromDate,
      toDate: request.toDate,
      capabilities,
    });
    return buildPaymentHistoryExport(
      rows,
      {
        period: 'mtd',
        propertyId: request.propertyId,
        state: request.state,
        query: request.query,
        paymentId: null,
        page: 1,
      },
      { fromDate: request.fromDate, toDate: request.toDate },
    );
  }

  requireCapabilities(capabilities, 'view_documents');
  const model = await loadAccountantDocuments(client, { capabilities });
  return buildDocumentIndexExport(model.rows, {
    propertyId: request.propertyId,
    type: request.type,
    query: request.query,
    documentId: null,
    page: 1,
  });
}
