import type {
  AccountantDocumentRecord,
  AccountantPaymentRecord,
  AccountantRentEvent,
} from './types';

export type AccountantRentEvidenceState =
  | 'outstanding'
  | 'settled'
  | 'waived';

export type AccountantRentFilter = 'all' | AccountantRentEvidenceState;

export type AccountantPaymentEvidenceState =
  | 'confirmed'
  | 'unmatched'
  | 'timestamp_missing'
  | 'pending'
  | 'other';

export type AccountantPaymentFilter =
  | 'all'
  | AccountantPaymentEvidenceState;

export type AccountantDocumentFilter =
  | 'all'
  | 'lease'
  | 'property';

const CONFIRMED_PAYMENT_STATUSES = new Set(['succeeded']);

const PENDING_PAYMENT_STATUSES = new Set([
  'pending',
  'processing',
  'requires_action',
]);

function includesQuery(values: readonly (string | null)[], query: string) {
  const needle = query.trim().toLocaleLowerCase('en-US');
  return (
    needle.length === 0 ||
    values.some((value) =>
      (value ?? '').toLocaleLowerCase('en-US').includes(needle),
    )
  );
}

export function deriveRentEvidenceState(
  row: AccountantRentEvent,
): AccountantRentEvidenceState {
  if (row.amountDueCents - row.amountPaidCents > 0) {
    return 'outstanding';
  }
  if ((row.waivedAmountCents ?? 0) > 0 || row.waivedAt !== null) {
    return 'waived';
  }
  return 'settled';
}

export function filterAccountantRent(
  rows: readonly AccountantRentEvent[],
  filter: {
    cycleMonth: string;
    propertyId: string | null;
    state: AccountantRentFilter;
    query: string;
  },
): AccountantRentEvent[] {
  return rows
    .filter((row) => {
      if (row.cycleMonth !== filter.cycleMonth) return false;
      if (filter.propertyId && row.propertyId !== filter.propertyId) {
        return false;
      }
      if (
        filter.state !== 'all' &&
        deriveRentEvidenceState(row) !== filter.state
      ) {
        return false;
      }
      return includesQuery(
        [row.propertyName, row.unitLabel, row.tenantName, row.status],
        filter.query,
      );
    })
    .sort(
      (a, b) =>
        a.propertyName.localeCompare(b.propertyName) ||
        a.unitLabel.localeCompare(b.unitLabel) ||
        a.tenantName.localeCompare(b.tenantName) ||
        a.rentEventId.localeCompare(b.rentEventId),
    );
}

export function isConfirmedPaymentRecord(
  row: AccountantPaymentRecord,
): boolean {
  return (
    row.paidAt !== null &&
    CONFIRMED_PAYMENT_STATUSES.has(row.status.toLowerCase())
  );
}

export function requiresRentEventMatch(
  row: AccountantPaymentRecord,
): boolean {
  return row.status.toLowerCase() === 'succeeded' && !row.matched;
}

export function paymentEvidenceState(
  row: AccountantPaymentRecord,
): AccountantPaymentEvidenceState {
  const status = row.status.toLowerCase();
  if (CONFIRMED_PAYMENT_STATUSES.has(status)) {
    if (requiresRentEventMatch(row)) return 'unmatched';
    return row.paidAt === null ? 'timestamp_missing' : 'confirmed';
  }
  if (PENDING_PAYMENT_STATUSES.has(status)) return 'pending';
  return 'other';
}

function matchesPaymentFilter(
  row: AccountantPaymentRecord,
  filter: AccountantPaymentFilter,
): boolean {
  if (filter === 'all') return true;
  if (filter === 'unmatched') return requiresRentEventMatch(row);
  if (filter === 'timestamp_missing') {
    return (
      CONFIRMED_PAYMENT_STATUSES.has(row.status.toLowerCase()) &&
      row.paidAt === null
    );
  }
  return paymentEvidenceState(row) === filter;
}

export function filterAccountantPayments(
  rows: readonly AccountantPaymentRecord[],
  filter: {
    propertyId: string | null;
    state: AccountantPaymentFilter;
    query: string;
  },
): AccountantPaymentRecord[] {
  return rows
    .filter((row) => {
      if (filter.propertyId && row.propertyId !== filter.propertyId) {
        return false;
      }
      if (!matchesPaymentFilter(row, filter.state)) {
        return false;
      }
      return includesQuery(
        [row.propertyName, row.unitLabel, row.tenantName, row.status],
        filter.query,
      );
    })
    .sort((a, b) => {
      if (a.paidAt && b.paidAt) {
        const paidOrder = b.paidAt.localeCompare(a.paidAt);
        if (paidOrder !== 0) return paidOrder;
      } else if (a.paidAt) {
        return -1;
      } else if (b.paidAt) {
        return 1;
      }
      return a.paymentId.localeCompare(b.paymentId);
    });
}

export function filterAccountantDocuments(
  rows: readonly AccountantDocumentRecord[],
  filter: {
    propertyId: string | null;
    type: AccountantDocumentFilter;
    query: string;
  },
): AccountantDocumentRecord[] {
  return rows
    .filter((row) => {
      if (filter.propertyId && row.propertyId !== filter.propertyId) {
        return false;
      }
      if (filter.type === 'lease' && row.evidenceClass !== 'lease_evidence') {
        return false;
      }
      if (
        filter.type === 'property' &&
        row.evidenceClass !== 'property_accounting_evidence'
      ) {
        return false;
      }
      return includesQuery(
        [row.propertyName, row.unitLabel, row.tenantName, row.title, row.type],
        filter.query,
      );
    })
    .sort(
      (a, b) =>
        a.propertyName.localeCompare(b.propertyName) ||
        (a.unitLabel ?? '').localeCompare(b.unitLabel ?? '') ||
        a.title.localeCompare(b.title) ||
        a.documentId.localeCompare(b.documentId),
    );
}

export interface RegisterPage<Row> {
  rows: Row[];
  page: number;
  pageCount: number;
  selectedId: string | null;
  staleSelectionCleared: boolean;
  range: { from: number; to: number; total: number };
}

type RawValue = string | string[] | undefined;

export interface AccountantRegisterSearchInput {
  cycle?: RawValue;
  period?: RawValue;
  property?: RawValue;
  state?: RawValue;
  type?: RawValue;
  q?: RawValue;
  event?: RawValue;
  payment?: RawValue;
  document?: RawValue;
  context?: RawValue;
  page?: RawValue;
}

function scalar(value: RawValue): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function identifier(value: RawValue): string | null {
  const normalized = scalar(value)?.trim() ?? '';
  return normalized.length > 0 &&
    normalized.length <= 128 &&
    /^[A-Za-z0-9:_-]+$/.test(normalized)
    ? normalized
    : null;
}

function query(value: RawValue): string {
  return (scalar(value)?.trim() ?? '').slice(0, 80);
}

function requestedPage(value: RawValue): number {
  const parsed = Number(scalar(value));
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 1;
}

function enumValue<Value extends string>(
  value: RawValue,
  allowed: readonly Value[],
  fallback: Value,
): Value {
  const raw = scalar(value);
  return allowed.includes(raw as Value) ? (raw as Value) : fallback;
}

function optionalEnumValue<Value extends string>(
  value: RawValue,
  allowed: readonly Value[],
): Value | null {
  const raw = scalar(value);
  return allowed.includes(raw as Value) ? (raw as Value) : null;
}

function cycleMonth(value: RawValue, now: Date): string {
  const current = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-01`;
  const raw = scalar(value);
  const normalized = raw && /^\d{4}-\d{2}$/.test(raw) ? `${raw}-01` : raw;
  const match = normalized ? /^(\d{4})-(\d{2})-01$/.exec(normalized) : null;
  if (!normalized || !match) return current;
  const year = Number(match[1]);
  const month = Number(match[2]);
  return year >= 1 && year <= 9998 && month >= 1 && month <= 12
    ? normalized
    : current;
}

function resolvePropertyId(
  value: RawValue,
  authorizedPropertyIds: ReadonlySet<string>,
): { propertyId: string | null; unknownPropertyRequested: boolean } {
  if (value === undefined || value === '') {
    return { propertyId: null, unknownPropertyRequested: false };
  }
  if (Array.isArray(value) && value.length !== 1) {
    return { propertyId: null, unknownPropertyRequested: true };
  }
  const raw = Array.isArray(value) ? value[0] : value;
  if (raw === '') return { propertyId: null, unknownPropertyRequested: false };
  const requested = identifier(raw);
  if (requested === null) {
    return { propertyId: null, unknownPropertyRequested: true };
  }
  const unknownPropertyRequested =
    !authorizedPropertyIds.has(requested);
  return {
    propertyId: unknownPropertyRequested ? null : requested,
    unknownPropertyRequested,
  };
}

function propertyIds(
  rows: readonly { propertyId: string }[],
  authoritative?: ReadonlySet<string>,
): ReadonlySet<string> {
  return authoritative ?? new Set(rows.map((row) => row.propertyId));
}

export interface AccountantRentViewState {
  cycleMonth: string;
  propertyId: string | null;
  state: AccountantRentFilter;
  query: string;
  eventId: string | null;
  context?: 'missing_cycle' | null;
  page: number;
}

export function normalizeRentRegister(
  raw: AccountantRegisterSearchInput,
  rows: readonly AccountantRentEvent[],
  now = new Date(),
  pageSize = 40,
  authorizedPropertyIds?: ReadonlySet<string>,
) {
  const property = resolvePropertyId(
    raw.property,
    propertyIds(rows, authorizedPropertyIds),
  );
  const base = {
    cycleMonth: cycleMonth(raw.cycle, now),
    propertyId: property.propertyId,
    state: enumValue(
      raw.state,
      ['all', 'outstanding', 'settled', 'waived'] as const,
      'all',
    ),
    query: query(raw.q),
    context: optionalEnumValue(raw.context, ['missing_cycle'] as const),
  };
  const filteredRows = property.unknownPropertyRequested
    ? []
    : filterAccountantRent(rows, base);
  const page = normalizeRegisterPage(filteredRows, {
    requestedPage: requestedPage(raw.page),
    selectedId: identifier(raw.event),
    pageSize,
    id: (row) => row.rentEventId,
  });
  const state: AccountantRentViewState = {
    ...base,
    eventId: page.selectedId,
    page: page.page,
  };
  return {
    state,
    filteredRows,
    page,
    unknownPropertyRequested: property.unknownPropertyRequested,
    selectedRow:
      page.rows.find((row) => row.rentEventId === page.selectedId) ?? null,
  };
}

export function buildRentRegisterParams(
  state: AccountantRentViewState,
  options: { selection?: boolean; page?: boolean; context?: boolean } = {},
): URLSearchParams {
  const params = new URLSearchParams({ cycle: state.cycleMonth.slice(0, 7) });
  if (state.propertyId) params.set('property', state.propertyId);
  if (state.state !== 'all') params.set('state', state.state);
  if (state.query) params.set('q', state.query);
  if (options.context !== false && state.context) {
    params.set('context', state.context);
  }
  if (options.selection !== false && state.eventId) {
    params.set('event', state.eventId);
  }
  if (options.page !== false && state.page > 1) {
    params.set('page', String(state.page));
  }
  return params;
}

export type AccountantFinancialPeriod = 'mtd' | 'last' | 'qtd' | 'ytd';

export interface AccountantFinancialViewState {
  period: AccountantFinancialPeriod;
  propertyId: string | null;
  state: AccountantPaymentFilter;
  query: string;
  paymentId: string | null;
  page: number;
}

export function normalizeFinancialRegister(
  raw: AccountantRegisterSearchInput,
  rows: readonly AccountantPaymentRecord[],
  pageSize = 40,
  authorizedPropertyIds?: ReadonlySet<string>,
) {
  const property = resolvePropertyId(
    raw.property,
    propertyIds(rows, authorizedPropertyIds),
  );
  const base = {
    period: enumValue(
      raw.period,
      ['mtd', 'last', 'qtd', 'ytd'] as const,
      'mtd',
    ),
    propertyId: property.propertyId,
    state: enumValue(
      raw.state,
      [
        'all',
        'confirmed',
        'unmatched',
        'timestamp_missing',
        'pending',
        'other',
      ] as const,
      'all',
    ),
    query: query(raw.q),
  };
  const filteredRows = property.unknownPropertyRequested
    ? []
    : filterAccountantPayments(rows, base);
  const page = normalizeRegisterPage(filteredRows, {
    requestedPage: requestedPage(raw.page),
    selectedId: identifier(raw.payment),
    pageSize,
    id: (row) => row.paymentId,
  });
  const state: AccountantFinancialViewState = {
    ...base,
    paymentId: page.selectedId,
    page: page.page,
  };
  return {
    state,
    filteredRows,
    page,
    unknownPropertyRequested: property.unknownPropertyRequested,
    selectedRow:
      page.rows.find((row) => row.paymentId === page.selectedId) ?? null,
  };
}

export function buildFinancialRegisterParams(
  state: AccountantFinancialViewState,
  options: { selection?: boolean; page?: boolean } = {},
): URLSearchParams {
  const params = new URLSearchParams({ period: state.period });
  if (state.propertyId) params.set('property', state.propertyId);
  if (state.state !== 'all') params.set('state', state.state);
  if (state.query) params.set('q', state.query);
  if (options.selection !== false && state.paymentId) {
    params.set('payment', state.paymentId);
  }
  if (options.page !== false && state.page > 1) {
    params.set('page', String(state.page));
  }
  return params;
}

export interface AccountantDocumentViewState {
  propertyId: string | null;
  type: AccountantDocumentFilter;
  query: string;
  documentId: string | null;
  context?: 'missing_lease_evidence' | null;
  page: number;
}

export function normalizeDocumentRegister(
  raw: AccountantRegisterSearchInput,
  rows: readonly AccountantDocumentRecord[],
  pageSize = 40,
  authorizedPropertyIds?: ReadonlySet<string>,
) {
  const property = resolvePropertyId(
    raw.property,
    propertyIds(rows, authorizedPropertyIds),
  );
  const base = {
    propertyId: property.propertyId,
    type: enumValue(raw.type, ['all', 'lease', 'property'] as const, 'all'),
    query: query(raw.q),
    context: optionalEnumValue(
      raw.context,
      ['missing_lease_evidence'] as const,
    ),
  };
  const filteredRows = property.unknownPropertyRequested
    ? []
    : filterAccountantDocuments(rows, base);
  const page = normalizeRegisterPage(filteredRows, {
    requestedPage: requestedPage(raw.page),
    selectedId: identifier(raw.document),
    pageSize,
    id: (row) => row.documentId,
  });
  const state: AccountantDocumentViewState = {
    ...base,
    documentId: page.selectedId,
    page: page.page,
  };
  return {
    state,
    filteredRows,
    page,
    unknownPropertyRequested: property.unknownPropertyRequested,
    selectedRow:
      page.rows.find((row) => row.documentId === page.selectedId) ?? null,
  };
}

export function buildDocumentRegisterParams(
  state: AccountantDocumentViewState,
  options: { selection?: boolean; page?: boolean; context?: boolean } = {},
): URLSearchParams {
  const params = new URLSearchParams();
  if (state.propertyId) params.set('property', state.propertyId);
  if (state.type !== 'all') params.set('type', state.type);
  if (state.query) params.set('q', state.query);
  if (options.context !== false && state.context) {
    params.set('context', state.context);
  }
  if (options.selection !== false && state.documentId) {
    params.set('document', state.documentId);
  }
  if (options.page !== false && state.page > 1) {
    params.set('page', String(state.page));
  }
  return params;
}

export function normalizeRegisterPage<Row>(
  rows: readonly Row[],
  options: {
    requestedPage: number;
    selectedId: string | null;
    pageSize: number;
    id: (row: Row) => string;
  },
): RegisterPage<Row> {
  const pageSize = Math.max(1, Math.min(Math.trunc(options.pageSize), 200));
  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));
  const requested = Number.isFinite(options.requestedPage)
    ? Math.trunc(options.requestedPage)
    : 1;
  const selectedIndex =
    options.selectedId === null
      ? -1
      : rows.findIndex((row) => options.id(row) === options.selectedId);
  const page =
    selectedIndex >= 0
      ? Math.floor(selectedIndex / pageSize) + 1
      : Math.min(Math.max(requested, 1), pageCount);
  const start = (page - 1) * pageSize;
  const pageRows = rows.slice(start, start + pageSize);
  const selectedId = selectedIndex >= 0 ? options.selectedId : null;
  return {
    rows: pageRows,
    page,
    pageCount,
    selectedId,
    staleSelectionCleared:
      options.selectedId !== null && selectedId === null,
    range: {
      from: rows.length === 0 ? 0 : start + 1,
      to: Math.min(start + pageSize, rows.length),
      total: rows.length,
    },
  };
}
