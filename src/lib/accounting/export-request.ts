import type {
  AccountantDocumentFilter,
  AccountantPaymentFilter,
  AccountantRentFilter,
} from './register-state';
import type { AccountantIssueFilter } from './view-state';

export type AccountantExportRequest =
  | {
      kind: 'reconciliation';
      cycleMonth: string;
      propertyId: string | null;
      issueFilter: AccountantIssueFilter;
      query: string;
    }
  | {
      kind: 'rent-ledger';
      cycleMonth: string;
      propertyId: string | null;
      state: AccountantRentFilter;
      query: string;
    }
  | {
      kind: 'payment-history';
      fromDate: string;
      toDate: string;
      propertyId: string | null;
      state: AccountantPaymentFilter;
      query: string;
    }
  | {
      kind: 'document-index';
      propertyId: string | null;
      type: AccountantDocumentFilter;
      query: string;
    };

export type AccountantExportRequestResult =
  | { ok: true; value: AccountantExportRequest }
  | { ok: false; error: string };

const IDENTIFIER = /^[A-Za-z0-9:_-]+$/;
const MAX_PAYMENT_EXPORT_DAY_SPAN = 365;

function invalid(error: string): AccountantExportRequestResult {
  return { ok: false, error };
}

function hasExactKeys(
  params: URLSearchParams,
  allowed: readonly string[],
): boolean {
  const allowedSet = new Set(allowed);
  for (const key of new Set(params.keys())) {
    if (!allowedSet.has(key) || params.getAll(key).length !== 1) return false;
  }
  return true;
}

function propertyId(params: URLSearchParams): string | null | undefined {
  const value = params.get('property');
  if (value === null) return null;
  return value.length > 0 && value.length <= 128 && IDENTIFIER.test(value)
    ? value
    : undefined;
}

function query(params: URLSearchParams): string | undefined {
  const value = params.get('q') ?? '';
  return value.length <= 80 ? value : undefined;
}

function cycle(value: string | null): string | null {
  if (value === null) return null;
  const normalized = /^\d{4}-\d{2}$/.test(value) ? `${value}-01` : value;
  const match = /^(\d{4})-(\d{2})-01$/.exec(normalized);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  return year >= 1 && year <= 9998 && month >= 1 && month <= 12
    ? normalized
    : null;
}

function date(value: string | null): string | null {
  if (value === null) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  const year = match ? Number(match[1]) : 0;
  if (!match || year < 1 || year > 9998) return null;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.valueOf()) &&
    parsed.toISOString().slice(0, 10) === value
    ? value
    : null;
}

function withinPaymentExportSpan(fromDate: string, toDate: string): boolean {
  const milliseconds =
    Date.parse(`${toDate}T00:00:00.000Z`) -
    Date.parse(`${fromDate}T00:00:00.000Z`);
  return milliseconds <= MAX_PAYMENT_EXPORT_DAY_SPAN * 86_400_000;
}

function enumValue<Value extends string>(
  value: string | null,
  allowed: readonly Value[],
  fallback: Value,
): Value | undefined {
  if (value === null) return fallback;
  return allowed.includes(value as Value) ? (value as Value) : undefined;
}

export function parseAccountantExportRequest(
  params: URLSearchParams,
): AccountantExportRequestResult {
  const kind = params.get('kind');
  const property = propertyId(params);
  const search = query(params);
  if (property === undefined || search === undefined) {
    return invalid('Invalid export filters');
  }

  if (kind === 'reconciliation') {
    if (!hasExactKeys(params, ['kind', 'cycle', 'property', 'issue', 'q'])) {
      return invalid('Unexpected or duplicate export parameter');
    }
    const cycleMonth = cycle(params.get('cycle'));
    const issueFilter = enumValue(
      params.get('issue'),
      ['all', 'matching', 'rent', 'documents'] as const,
      'all',
    );
    if (!cycleMonth || !issueFilter) return invalid('Invalid export filters');
    return {
      ok: true,
      value: {
        kind,
        cycleMonth,
        propertyId: property,
        issueFilter,
        query: search,
      },
    };
  }

  if (kind === 'rent-ledger') {
    if (!hasExactKeys(params, ['kind', 'cycle', 'property', 'state', 'q'])) {
      return invalid('Unexpected or duplicate export parameter');
    }
    const cycleMonth = cycle(params.get('cycle'));
    const state = enumValue(
      params.get('state'),
      ['all', 'outstanding', 'settled', 'waived'] as const,
      'all',
    );
    if (!cycleMonth || !state) return invalid('Invalid export filters');
    return {
      ok: true,
      value: {
        kind,
        cycleMonth,
        propertyId: property,
        state,
        query: search,
      },
    };
  }

  if (kind === 'payment-history') {
    if (
      !hasExactKeys(params, [
        'kind',
        'from',
        'to',
        'property',
        'state',
        'q',
      ])
    ) {
      return invalid('Unexpected or duplicate export parameter');
    }
    const fromDate = date(params.get('from'));
    const toDate = date(params.get('to'));
    const state = enumValue(
      params.get('state'),
      [
        'all',
        'confirmed',
        'unmatched',
        'timestamp_missing',
        'pending',
        'other',
      ] as const,
      'all',
    );
    if (
      !fromDate ||
      !toDate ||
      fromDate > toDate ||
      !withinPaymentExportSpan(fromDate, toDate) ||
      !state
    ) {
      return invalid('Invalid export filters');
    }
    return {
      ok: true,
      value: {
        kind,
        fromDate,
        toDate,
        propertyId: property,
        state,
        query: search,
      },
    };
  }

  if (kind === 'document-index') {
    if (!hasExactKeys(params, ['kind', 'property', 'type', 'q'])) {
      return invalid('Unexpected or duplicate export parameter');
    }
    const type = enumValue(
      params.get('type'),
      ['all', 'lease', 'property'] as const,
      'all',
    );
    if (!type) return invalid('Invalid export filters');
    return {
      ok: true,
      value: {
        kind,
        propertyId: property,
        type,
        query: search,
      },
    };
  }

  return invalid('Invalid export kind');
}
