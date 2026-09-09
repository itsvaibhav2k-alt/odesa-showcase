import type {
  AccountantDocumentRecord,
  AccountantDocumentEvidenceClass,
  AccountantLeaseContext,
  AccountantPaymentRecord,
  AccountantPropertyLeaseContext,
  AccountantRentEvent,
} from './types';

type ProjectionRow = Record<string, unknown>;

const CONTEXT_KEYS = [
  'property_id',
  'property_name',
  'property_archived_at',
  'unit_id',
  'unit_label',
  'tenant_id',
  'tenant_name',
  'lease_id',
  'lease_status',
  'lease_start_date',
  'lease_end_date',
] as const;

const RENT_KEYS = [
  'rent_event_id',
  'property_id',
  'property_name',
  'property_archived_at',
  'unit_id',
  'unit_label',
  'tenant_id',
  'tenant_name',
  'lease_id',
  'cycle_month',
  'due_date',
  'amount_due_cents',
  'amount_paid_cents',
  'status',
  'waived_amount_cents',
  'waived_at',
] as const;

const PAYMENT_KEYS = [
  'payment_id',
  'property_id',
  'property_name',
  'property_archived_at',
  'unit_id',
  'unit_label',
  'tenant_id',
  'tenant_name',
  'lease_id',
  'amount_cents',
  'currency',
  'status',
  'paid_at',
  'period_basis',
  'rent_event_id',
  'matched',
  'receipt_present',
] as const;

const DOCUMENT_KEYS = [
  'document_id',
  'property_id',
  'property_name',
  'property_archived_at',
  'unit_id',
  'unit_label',
  'tenant_id',
  'tenant_name',
  'lease_id',
  'lease_status',
  'evidence_class',
  'title',
  'type',
  'expiry_date',
  'created_at',
] as const;

export class AccountantProjectionError extends Error {
  constructor() {
    super('Accountant data is temporarily unavailable');
    this.name = 'AccountantProjectionError';
  }
}

function rows(value: unknown): ProjectionRow[] {
  if (
    !Array.isArray(value) ||
    !value.every(
      (row) => row !== null && typeof row === 'object' && !Array.isArray(row),
    )
  ) {
    throw new AccountantProjectionError();
  }
  return value as ProjectionRow[];
}

function exactKeys(
  row: ProjectionRow,
  expected: readonly string[],
): void {
  const actual = Object.keys(row);
  const allowed = new Set(expected);
  if (
    actual.length !== expected.length ||
    actual.some((key) => !allowed.has(key))
  ) {
    throw new AccountantProjectionError();
  }
}

function text(row: ProjectionRow, key: string): string {
  const value = row[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw new AccountantProjectionError();
  }
  return value;
}

function nullableText(row: ProjectionRow, key: string): string | null {
  const value = row[key];
  if (value === null) return null;
  if (typeof value !== 'string' || value.length === 0) {
    throw new AccountantProjectionError();
  }
  return value;
}

function integer(row: ProjectionRow, key: string): number {
  const value = row[key];
  const parsed =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && /^-?\d+$/.test(value)
        ? Number(value)
        : Number.NaN;
  if (!Number.isSafeInteger(parsed)) throw new AccountantProjectionError();
  return parsed;
}

function nonnegativeInteger(row: ProjectionRow, key: string): number {
  const value = integer(row, key);
  if (value < 0) throw new AccountantProjectionError();
  return value;
}

function nullableNonnegativeInteger(
  row: ProjectionRow,
  key: string,
): number | null {
  return row[key] === null ? null : nonnegativeInteger(row, key);
}

function boolean(row: ProjectionRow, key: string): boolean {
  const value = row[key];
  if (typeof value !== 'boolean') throw new AccountantProjectionError();
  return value;
}

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIMESTAMP_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?(Z|([+-])(\d{2}):(\d{2}))$/;

function calendarDate(value: string): string {
  const match = DATE_PATTERN.exec(value);
  if (!match) throw new AccountantProjectionError();
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
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
  return value;
}

function nullableDate(row: ProjectionRow, key: string): string | null {
  const value = nullableText(row, key);
  return value === null ? null : calendarDate(value);
}

function timestamp(value: string): string {
  const match = TIMESTAMP_PATTERN.exec(value);
  if (!match) throw new AccountantProjectionError();
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const millisecond = Number((match[7] ?? '').padEnd(3, '0').slice(0, 3));
  const offsetHour = match[8] === 'Z' ? 0 : Number(match[10]);
  const offsetMinute = match[8] === 'Z' ? 0 : Number(match[11]);
  if (
    year < 1 ||
    year > 9998 ||
    hour > 23 ||
    minute > 59 ||
    second > 59 ||
    offsetHour > 14 ||
    offsetMinute > 59 ||
    (offsetHour === 14 && offsetMinute !== 0)
  ) {
    throw new AccountantProjectionError();
  }

  const local = new Date(0);
  local.setUTCFullYear(year, month - 1, day);
  local.setUTCHours(hour, minute, second, millisecond);
  if (
    local.getUTCFullYear() !== year ||
    local.getUTCMonth() !== month - 1 ||
    local.getUTCDate() !== day ||
    local.getUTCHours() !== hour ||
    local.getUTCMinutes() !== minute ||
    local.getUTCSeconds() !== second
  ) {
    throw new AccountantProjectionError();
  }

  const direction = match[9] === '-' ? -1 : 1;
  const offset = direction * (offsetHour * 60 + offsetMinute) * 60_000;
  const normalized = new Date(local.getTime() - offset);
  const normalizedYear = normalized.getUTCFullYear();
  if (normalizedYear < 1 || normalizedYear > 9998) {
    throw new AccountantProjectionError();
  }
  const fraction = (match[7] ?? '').padEnd(6, '0');
  return `${normalized.toISOString().slice(0, 19)}.${fraction}Z`;
}

function nullableTimestamp(row: ProjectionRow, key: string): string | null {
  const value = nullableText(row, key);
  return value === null ? null : timestamp(value);
}

function property(row: ProjectionRow) {
  return {
    propertyId: text(row, 'property_id'),
    propertyName: text(row, 'property_name'),
    propertyArchivedAt: nullableTimestamp(row, 'property_archived_at'),
  };
}

function leaseStatus(row: ProjectionRow): AccountantLeaseContext['leaseStatus'] {
  const value = text(row, 'lease_status');
  if (
    value !== 'active' &&
    value !== 'pending' &&
    value !== 'expired' &&
    value !== 'terminated'
  ) {
    throw new AccountantProjectionError();
  }
  return value;
}

export function mapAccountantLeaseContext(
  value: unknown,
): AccountantPropertyLeaseContext[] {
  return rows(value).map((row) => {
    exactKeys(row, CONTEXT_KEYS);
    const context = property(row);
    const leaseId = nullableText(row, 'lease_id');
    if (leaseId === null) {
      if (
        nullableText(row, 'unit_id') !== null ||
        nullableText(row, 'unit_label') !== null ||
        nullableText(row, 'tenant_id') !== null ||
        nullableText(row, 'tenant_name') !== null ||
        nullableText(row, 'lease_status') !== null ||
        nullableDate(row, 'lease_start_date') !== null ||
        nullableDate(row, 'lease_end_date') !== null
      ) {
        throw new AccountantProjectionError();
      }
      return {
        ...context,
        contextKind: 'property' as const,
        unitId: null,
        unitLabel: null,
        tenantId: null,
        tenantName: null,
        leaseId: null,
        leaseStatus: null,
        leaseStartDate: null,
        leaseEndDate: null,
      };
    }
    return {
      ...context,
      contextKind: 'lease' as const,
      unitId: text(row, 'unit_id'),
      unitLabel: text(row, 'unit_label'),
      tenantId: text(row, 'tenant_id'),
      tenantName: text(row, 'tenant_name'),
      leaseId,
      leaseStatus: leaseStatus(row),
      leaseStartDate: nullableDate(row, 'lease_start_date'),
      leaseEndDate: nullableDate(row, 'lease_end_date'),
    };
  });
}

export function mapAccountantRentEvents(value: unknown): AccountantRentEvent[] {
  return rows(value).map((row) => {
    exactKeys(row, RENT_KEYS);
    const cycleMonth = calendarDate(text(row, 'cycle_month'));
    if (!cycleMonth.endsWith('-01')) throw new AccountantProjectionError();
    return {
      ...property(row),
      rentEventId: text(row, 'rent_event_id'),
      unitId: text(row, 'unit_id'),
      unitLabel: text(row, 'unit_label'),
      tenantId: text(row, 'tenant_id'),
      tenantName: text(row, 'tenant_name'),
      leaseId: text(row, 'lease_id'),
      cycleMonth,
      dueDate: nullableDate(row, 'due_date'),
      amountDueCents: nonnegativeInteger(row, 'amount_due_cents'),
      amountPaidCents: nonnegativeInteger(row, 'amount_paid_cents'),
      status: text(row, 'status'),
      waivedAmountCents: nullableNonnegativeInteger(
        row,
        'waived_amount_cents',
      ),
      waivedAt: nullableTimestamp(row, 'waived_at'),
    };
  });
}

export function mapAccountantPayments(
  value: unknown,
): AccountantPaymentRecord[] {
  return rows(value).map((row) => {
    exactKeys(row, PAYMENT_KEYS);
    const currency = text(row, 'currency').toUpperCase();
    if (currency !== 'USD') throw new AccountantProjectionError();
    const status = text(row, 'status');
    if (
      status !== 'pending' &&
      status !== 'succeeded' &&
      status !== 'failed' &&
      status !== 'refunded' &&
      status !== 'canceled'
    ) {
      throw new AccountantProjectionError();
    }
    const paidAt = nullableTimestamp(row, 'paid_at');
    const periodBasis = text(row, 'period_basis');
    if (
      (periodBasis !== 'payment_time' &&
        periodBasis !== 'record_created_exception') ||
      (periodBasis === 'payment_time' && paidAt === null) ||
      (periodBasis === 'record_created_exception' && paidAt !== null)
    ) {
      throw new AccountantProjectionError();
    }
    const rentEventId = nullableText(row, 'rent_event_id');
    const matched = boolean(row, 'matched');
    if (matched !== (rentEventId !== null)) {
      throw new AccountantProjectionError();
    }
    return {
      ...property(row),
      paymentId: text(row, 'payment_id'),
      unitId: text(row, 'unit_id'),
      unitLabel: text(row, 'unit_label'),
      tenantId: text(row, 'tenant_id'),
      tenantName: text(row, 'tenant_name'),
      leaseId: text(row, 'lease_id'),
      amountCents: nonnegativeInteger(row, 'amount_cents'),
      currency: 'USD' as const,
      status,
      paidAt,
      periodBasis,
      rentEventId,
      matched,
      receiptPresent: boolean(row, 'receipt_present'),
    };
  });
}

function evidenceClass(row: ProjectionRow): AccountantDocumentEvidenceClass {
  const value = text(row, 'evidence_class');
  if (
    value !== 'lease_evidence' &&
    value !== 'property_accounting_evidence'
  ) {
    throw new AccountantProjectionError();
  }
  return value;
}

export function mapAccountantDocuments(
  value: unknown,
): AccountantDocumentRecord[] {
  return rows(value).map((row) => {
    exactKeys(row, DOCUMENT_KEYS);
    const rawLeaseStatus = nullableText(row, 'lease_status');
    if (
      rawLeaseStatus !== null &&
      rawLeaseStatus !== 'active' &&
      rawLeaseStatus !== 'pending' &&
      rawLeaseStatus !== 'expired' &&
      rawLeaseStatus !== 'terminated'
    ) {
      throw new AccountantProjectionError();
    }
    const classification = evidenceClass(row);
    const unitId = nullableText(row, 'unit_id');
    const unitLabel = nullableText(row, 'unit_label');
    const tenantId = nullableText(row, 'tenant_id');
    const tenantName = nullableText(row, 'tenant_name');
    const leaseId = nullableText(row, 'lease_id');
    const hasLeaseContext =
      unitId !== null &&
      unitLabel !== null &&
      tenantId !== null &&
      tenantName !== null &&
      leaseId !== null &&
      rawLeaseStatus !== null;
    const hasNoLeaseContext =
      unitId === null &&
      unitLabel === null &&
      tenantId === null &&
      tenantName === null &&
      leaseId === null &&
      rawLeaseStatus === null;
    if (
      (classification === 'lease_evidence' && !hasLeaseContext) ||
      (classification === 'property_accounting_evidence' &&
        !hasNoLeaseContext)
    ) {
      throw new AccountantProjectionError();
    }
    return {
      ...property(row),
      documentId: text(row, 'document_id'),
      unitId,
      unitLabel,
      tenantId,
      tenantName,
      leaseId,
      leaseStatus: rawLeaseStatus,
      evidenceClass: classification,
      title: text(row, 'title'),
      type: text(row, 'type'),
      expiryDate: nullableDate(row, 'expiry_date'),
      createdAt: timestamp(text(row, 'created_at')),
    };
  });
}
