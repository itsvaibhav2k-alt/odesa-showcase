import { resolvePeriodCycles, type PeriodKey } from '@/lib/financials/trend';

import {
  AccountantProjectionError,
  mapAccountantDocuments,
  mapAccountantLeaseContext,
  mapAccountantPayments,
  mapAccountantRentEvents,
} from './projection';
import { buildAccountantReconciliationDesk } from './reconciliation';
import {
  filterAccountantDocuments,
  filterAccountantPayments,
  isConfirmedPaymentRecord,
  requiresRentEventMatch,
} from './register-state';
import type {
  AccountantDocumentsModel,
  AccountantFinancialsModel,
  AccountantLeaseContext,
  AccountantReconciliationDesk,
  AccountantRentLedgerModel,
} from './types';

export interface AccountantProjectionResult {
  data: unknown;
  error: unknown;
}

/** Minimal structural contract supported by the server Supabase client. */
export interface AccountantProjectionClient {
  rpc(
    name: string,
    args?: Record<string, unknown>,
  ): PromiseLike<AccountantProjectionResult>;
}

export type AccountantProjectionCapability =
  | 'view_dashboard'
  | 'view_rent'
  | 'view_financials'
  | 'view_documents'
  | 'export_financials';

interface ReconciliationOptions {
  cycleMonth: string;
  capabilities: ReadonlySet<string>;
}

interface RentOptions {
  cycleMonth: string;
  capabilities: ReadonlySet<string>;
}

interface FinancialsOptions {
  periodKey: PeriodKey;
  currentCycleMonth: string;
  capabilities: ReadonlySet<string>;
}

interface DocumentsOptions {
  capabilities: ReadonlySet<string>;
}

interface PaymentHistoryOptions {
  fromDate: string;
  toDate: string;
  capabilities: ReadonlySet<string>;
}

const CYCLE_PATTERN = /^(\d{4})-(\d{2})-01$/;
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const MAX_PAYMENT_DAY_SPAN = 365;

function assertCycleMonth(value: string): void {
  const match = CYCLE_PATTERN.exec(value);
  const year = match ? Number(match[1]) : 0;
  const month = match ? Number(match[2]) : 0;
  if (year < 1 || year > 9998 || month < 1 || month > 12) {
    throw new AccountantProjectionError();
  }
}

function nextCycleMonth(value: string): string {
  assertCycleMonth(value);
  const match = CYCLE_PATTERN.exec(value) as RegExpExecArray;
  const year = Number(match[1]);
  const month = Number(match[2]);
  return month === 12
    ? `${String(year + 1).padStart(4, '0')}-01-01`
    : `${String(year).padStart(4, '0')}-${String(month + 1).padStart(2, '0')}-01`;
}

function assertDate(value: string): void {
  const match = DATE_PATTERN.exec(value);
  const year = match ? Number(match[1]) : 0;
  const month = match ? Number(match[2]) : 0;
  const day = match ? Number(match[3]) : 0;
  const parsed = new Date(0);
  parsed.setUTCFullYear(year, month - 1, day);
  parsed.setUTCHours(0, 0, 0, 0);
  if (
    year < 1 ||
    year > 9998 ||
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    throw new AccountantProjectionError();
  }
}

function atUtcStart(value: string): string {
  assertDate(value);
  return `${value}T00:00:00.000Z`;
}

function periodLabel(cycleMonth: string): string {
  assertCycleMonth(cycleMonth);
  const date = new Date(`${cycleMonth}T00:00:00.000Z`);
  if (Number.isNaN(date.valueOf())) throw new AccountantProjectionError();
  return new Intl.DateTimeFormat('en-US', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date);
}

function dayAfter(value: string): string {
  assertDate(value);
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.valueOf())) throw new AccountantProjectionError();
  date.setUTCDate(date.getUTCDate() + 1);
  const result = date.toISOString();
  if (!result.startsWith('+')) return result;
  throw new AccountantProjectionError();
}

async function projection(
  client: AccountantProjectionClient,
  name: string,
  args: Record<string, unknown> = {},
): Promise<unknown> {
  let result: unknown;
  try {
    result = await client.rpc(name, args);
  } catch {
    throw new AccountantProjectionError();
  }
  if (
    result === null ||
    typeof result !== 'object' ||
    Array.isArray(result) ||
    !Object.prototype.hasOwnProperty.call(result, 'data') ||
    !Object.prototype.hasOwnProperty.call(result, 'error')
  ) {
    throw new AccountantProjectionError();
  }
  const envelope = result as AccountantProjectionResult;
  if (envelope.error !== null) throw new AccountantProjectionError();
  return envelope.data;
}

function requireCapabilities(
  capabilities: ReadonlySet<string>,
  ...required: AccountantProjectionCapability[]
): void {
  if (required.some((capability) => !capabilities.has(capability))) {
    throw new AccountantProjectionError();
  }
}

async function readContext(
  client: AccountantProjectionClient,
  capability: 'view_dashboard' | 'view_rent' | 'view_financials' | 'view_documents',
) {
  return mapAccountantLeaseContext(
    await projection(client, 'accountant_property_lease_context', {
      p_capability: capability,
    }),
  );
}

async function readRent(
  client: AccountantProjectionClient,
  cycleStart: string,
  cycleEnd: string,
) {
  assertCycleMonth(cycleStart);
  assertCycleMonth(cycleEnd);
  if (cycleStart > cycleEnd) throw new AccountantProjectionError();
  return mapAccountantRentEvents(
    await projection(client, 'accountant_rent_events', {
      p_cycle_start: cycleStart,
      p_cycle_end: cycleEnd,
    }),
  );
}

async function readPayments(
  client: AccountantProjectionClient,
  fromDate: string,
  toDate: string,
) {
  assertDate(fromDate);
  assertDate(toDate);
  const span =
    Date.parse(`${toDate}T00:00:00.000Z`) -
    Date.parse(`${fromDate}T00:00:00.000Z`);
  if (
    fromDate > toDate ||
    span > MAX_PAYMENT_DAY_SPAN * 86_400_000
  ) {
    throw new AccountantProjectionError();
  }
  return mapAccountantPayments(
    await projection(client, 'accountant_payment_history', {
      p_from: atUtcStart(fromDate),
      p_before: dayAfter(toDate),
      p_include_recorded_exceptions: true,
    }),
  );
}

async function readDocuments(client: AccountantProjectionClient) {
  return mapAccountantDocuments(
    await projection(client, 'accountant_document_index'),
  );
}

function sortRentRows<
  Row extends {
    propertyName: string;
    unitLabel: string;
    tenantName: string;
    rentEventId: string;
  },
>(rows: readonly Row[]): Row[] {
  return [...rows].sort(
    (a, b) =>
      a.propertyName.localeCompare(b.propertyName) ||
      a.unitLabel.localeCompare(b.unitLabel) ||
      a.tenantName.localeCompare(b.tenantName) ||
      a.rentEventId.localeCompare(b.rentEventId),
  );
}

export async function loadAccountantReconciliation(
  client: AccountantProjectionClient,
  options: ReconciliationOptions,
): Promise<AccountantReconciliationDesk> {
  assertCycleMonth(options.cycleMonth);
  if (!options.capabilities.has('view_dashboard')) {
    throw new AccountantProjectionError();
  }

  const availability = {
    rent: options.capabilities.has('view_rent')
      ? ('available' as const)
      : ('denied' as const),
    financials: options.capabilities.has('view_financials')
      ? ('available' as const)
      : ('denied' as const),
    documents: options.capabilities.has('view_documents')
      ? ('available' as const)
      : ('denied' as const),
  };
  const canReadRent = availability.rent === 'available';
  const paymentTo = new Date(
    `${nextCycleMonth(options.cycleMonth)}T00:00:00.000Z`,
  );
  paymentTo.setUTCDate(paymentTo.getUTCDate() - 1);
  const cycleEndDate = paymentTo.toISOString().slice(0, 10);

  const [leases, rentEvents, payments, documents] = await Promise.all([
    readContext(client, 'view_dashboard'),
    canReadRent
      ? readRent(client, options.cycleMonth, options.cycleMonth)
      : Promise.resolve([]),
    availability.financials === 'available'
      ? readPayments(client, options.cycleMonth, cycleEndDate)
      : Promise.resolve([]),
    availability.documents === 'available'
      ? readDocuments(client)
      : Promise.resolve([]),
  ]);

  return buildAccountantReconciliationDesk({
    cycleMonth: options.cycleMonth,
    periodLabel: periodLabel(options.cycleMonth),
    availability,
    canExport: options.capabilities.has('export_financials'),
    leases,
    rentEvents,
    payments,
    documents,
  });
}

export async function loadAccountantRentLedger(
  client: AccountantProjectionClient,
  options: RentOptions,
): Promise<AccountantRentLedgerModel> {
  requireCapabilities(options.capabilities, 'view_rent');
  assertCycleMonth(options.cycleMonth);
  const [leases, rows] = await Promise.all([
    readContext(client, 'view_rent'),
    readRent(client, options.cycleMonth, options.cycleMonth),
  ]);
  const reconciliation = buildAccountantReconciliationDesk({
    cycleMonth: options.cycleMonth,
    periodLabel: periodLabel(options.cycleMonth),
    availability: {
      rent: 'available',
      financials: 'denied',
      documents: 'denied',
    },
    leases,
    rentEvents: rows,
    payments: [],
    documents: [],
  });
  const billedCents = rows.reduce(
    (total, row) => total + row.amountDueCents,
    0,
  );
  const collectedCents = rows.reduce(
    (total, row) => total + row.amountPaidCents,
    0,
  );
  return {
    cycleMonth: options.cycleMonth,
    periodLabel: periodLabel(options.cycleMonth),
    billedCents,
    collectedCents,
    outstandingCents: Math.max(billedCents - collectedCents, 0),
    canExport: options.capabilities.has('export_financials'),
    rows: sortRentRows(rows),
    properties: reconciliation.properties,
  };
}

export async function loadAccountantFinancials(
  client: AccountantProjectionClient,
  options: FinancialsOptions,
): Promise<AccountantFinancialsModel> {
  requireCapabilities(options.capabilities, 'view_financials');
  assertCycleMonth(options.currentCycleMonth);
  const resolved = resolvePeriodCycles(
    options.periodKey,
    options.currentCycleMonth,
  );
  const cycleStart = resolved.cycleMonths.at(0);
  const cycleEnd = resolved.cycleMonths.at(-1);
  if (!cycleStart || !cycleEnd) throw new AccountantProjectionError();
  const canReadRent = options.capabilities.has('view_rent');
  const [leases, events, payments] = await Promise.all([
    readContext(client, 'view_financials'),
    canReadRent
      ? readRent(client, cycleStart, cycleEnd)
      : Promise.resolve([]),
    readPayments(
      client,
      resolved.period.startDate,
      resolved.period.endDate,
    ),
  ]);
  const reconciliation = buildAccountantReconciliationDesk({
    cycleMonth: cycleEnd,
    periodLabel: resolved.period.label,
    availability: {
      rent: canReadRent ? 'available' : 'denied',
      financials: 'available',
      documents: 'denied',
    },
    leases,
    rentEvents: events,
    payments,
    documents: [],
  });
  const billedCents = canReadRent
    ? events.reduce((total, row) => total + row.amountDueCents, 0)
    : null;
  const collectedCents = canReadRent
    ? events.reduce((total, row) => total + row.amountPaidCents, 0)
    : null;
  const sortedPayments = filterAccountantPayments(payments, {
    propertyId: null,
    state: 'all',
    query: '',
  });
  return {
    periodKey: options.periodKey,
    cycleStart,
    cycleEnd,
    fromDate: resolved.period.startDate,
    toDate: resolved.period.endDate,
    periodLabel: resolved.period.label,
    billedCents,
    collectedCents,
    outstandingCents:
      billedCents === null || collectedCents === null
        ? null
        : Math.max(billedCents - collectedCents, 0),
    providerConfirmedCents: payments.reduce(
      (total, payment) =>
        total + (isConfirmedPaymentRecord(payment) ? payment.amountCents : 0),
      0,
    ),
    unmatchedPaymentCount: payments.filter(requiresRentEventMatch).length,
    canExport: options.capabilities.has('export_financials'),
    events: sortRentRows(events),
    payments: sortedPayments,
    properties: reconciliation.properties,
  };
}

export async function loadAccountantDocuments(
  client: AccountantProjectionClient,
  options: DocumentsOptions,
): Promise<AccountantDocumentsModel> {
  requireCapabilities(options.capabilities, 'view_documents');
  const [leases, documents] = await Promise.all([
    readContext(client, 'view_documents'),
    readDocuments(client),
  ]);
  const eligibleLeaseIds = new Set(
    documents
      .filter(
        (document) =>
          document.evidenceClass === 'lease_evidence' &&
          document.leaseId !== null,
      )
      .map((document) => document.leaseId),
  );
  const missingLeaseEvidence = leases
    .filter(
      (lease): lease is AccountantLeaseContext =>
        lease.contextKind === 'lease' &&
        (lease.leaseStatus === 'active' || lease.leaseStatus === 'pending') &&
        !eligibleLeaseIds.has(lease.leaseId),
    )
    .sort(
      (a, b) =>
        a.propertyName.localeCompare(b.propertyName) ||
        a.unitLabel.localeCompare(b.unitLabel) ||
        a.leaseId.localeCompare(b.leaseId),
    );
  const reconciliation = buildAccountantReconciliationDesk({
    cycleMonth: '2000-01-01',
    periodLabel: 'Document evidence',
    availability: {
      rent: 'denied',
      financials: 'denied',
      documents: 'available',
    },
    leases,
    rentEvents: [],
    payments: [],
    documents,
  });
  return {
    rows: filterAccountantDocuments(documents, {
      propertyId: null,
      type: 'all',
      query: '',
    }),
    missingLeaseEvidence,
    missingCount: missingLeaseEvidence.length,
    canExport: options.capabilities.has('export_financials'),
    properties: reconciliation.properties,
  };
}

export async function loadAccountantPaymentHistory(
  client: AccountantProjectionClient,
  options: PaymentHistoryOptions,
) {
  requireCapabilities(options.capabilities, 'view_financials');
  const payments = await readPayments(
    client,
    options.fromDate,
    options.toDate,
  );
  return filterAccountantPayments(payments, {
    propertyId: null,
    state: 'all',
    query: '',
  });
}
