import type {
  AccountantIssueKind,
  AccountantReconciliationIssue,
} from './types';
import { normalizeRegisterPage } from './register-state';

export type AccountantIssueFilter =
  | 'all'
  | 'matching'
  | 'rent'
  | 'documents';

export interface AccountantViewState {
  cycleMonth: string;
  propertyId: string | null;
  issueFilter: AccountantIssueFilter;
  query: string;
  selectedIssueId: string | null;
  page: number;
}

export interface AccountantViewSearchInput {
  cycle?: string | string[];
  property?: string | string[];
  issue?: string | string[];
  q?: string | string[];
  selected?: string | string[];
  page?: string | string[];
}

const ISSUE_FILTERS: readonly AccountantIssueFilter[] = [
  'all',
  'matching',
  'rent',
  'documents',
];

const FILTER_KINDS: Record<
  Exclude<AccountantIssueFilter, 'all'>,
  readonly AccountantIssueKind[]
> = {
  matching: ['unmatched_payment', 'payment_time_unavailable'],
  rent: ['missing_rent_cycle', 'outstanding_balance'],
  documents: ['missing_lease_document'],
};

function scalar(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function currentCycle(now: Date): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-01`;
}

export function normalizeAccountantCycle(
  value: string | string[] | undefined,
  now = new Date(),
): string {
  const raw = scalar(value);
  const normalized = raw && /^\d{4}-\d{2}$/.test(raw) ? `${raw}-01` : raw;
  const match = normalized ? /^(\d{4})-(\d{2})-01$/.exec(normalized) : null;
  if (!normalized || !match) return currentCycle(now);
  const year = Number(match[1]);
  const month = Number(match[2]);
  return year >= 1 && year <= 9998 && month >= 1 && month <= 12
    ? normalized
    : currentCycle(now);
}

export function normalizeAccountantCycleContext(
  value: string | string[] | undefined,
  now = new Date(),
): { selectedCycleMonth: string; currentCycleMonth: string } {
  return {
    selectedCycleMonth: normalizeAccountantCycle(value, now),
    currentCycleMonth: normalizeAccountantCycle(undefined, now),
  };
}

function boundedIdentifier(
  value: string | string[] | undefined,
): string | null {
  const normalized = scalar(value)?.trim() ?? '';
  if (
    normalized.length === 0 ||
    normalized.length > 128 ||
    !/^[A-Za-z0-9:_-]+$/.test(normalized)
  ) {
    return null;
  }
  return normalized;
}

function propertyRequest(value: string | string[] | undefined): {
  propertyId: string | null;
  malformed: boolean;
} {
  if (value === undefined || value === '') {
    return { propertyId: null, malformed: false };
  }
  if (Array.isArray(value) && value.length !== 1) {
    return { propertyId: null, malformed: true };
  }
  const raw = Array.isArray(value) ? value[0] : value;
  if (raw === '') return { propertyId: null, malformed: false };
  const propertyId = boundedIdentifier(raw);
  return { propertyId, malformed: propertyId === null };
}

function issueFilter(
  value: string | string[] | undefined,
): AccountantIssueFilter {
  const raw = scalar(value) ?? '';
  return (ISSUE_FILTERS as readonly string[]).includes(raw)
    ? (raw as AccountantIssueFilter)
    : 'all';
}

function boundedQuery(value: string | string[] | undefined): string {
  return (scalar(value)?.trim() ?? '').slice(0, 80);
}

export function filterAccountantIssues(
  issues: readonly AccountantReconciliationIssue[],
  state: Pick<
    AccountantViewState,
    'propertyId' | 'issueFilter' | 'query'
  >,
): AccountantReconciliationIssue[] {
  const query = state.query.toLocaleLowerCase('en-US');
  const allowedKinds =
    state.issueFilter === 'all' ? null : FILTER_KINDS[state.issueFilter];
  return issues.filter((issue) => {
    if (state.propertyId && issue.propertyId !== state.propertyId) return false;
    if (allowedKinds && !allowedKinds.includes(issue.kind)) return false;
    if (!query) return true;
    return [
      issue.title,
      issue.summary,
      issue.propertyName,
      issue.unitLabel,
      issue.tenantName,
      issue.kind,
    ]
      .filter((value): value is string => typeof value === 'string')
      .some((value) => value.toLocaleLowerCase('en-US').includes(query));
  });
}

export function buildAccountantViewParams(
  state: AccountantViewState,
): URLSearchParams {
  const params = new URLSearchParams();
  params.set('cycle', state.cycleMonth.slice(0, 7));
  if (state.propertyId) params.set('property', state.propertyId);
  if (state.issueFilter !== 'all') params.set('issue', state.issueFilter);
  if (state.query) params.set('q', state.query);
  if (state.selectedIssueId) params.set('selected', state.selectedIssueId);
  if (state.page > 1) params.set('page', String(state.page));
  return params;
}

export function normalizeAccountantView(
  raw: AccountantViewSearchInput,
  issues: readonly AccountantReconciliationIssue[],
  now = new Date(),
  pageSize = 40,
  authorizedPropertyIds: ReadonlySet<string> = new Set(
    issues.map((issue) => issue.propertyId),
  ),
) {
  const requestedProperty = propertyRequest(raw.property);
  const requestedPropertyId = requestedProperty.propertyId;
  const unknownPropertyRequested =
    requestedProperty.malformed ||
    (requestedPropertyId !== null &&
      !authorizedPropertyIds.has(requestedPropertyId));
  const base = {
    cycleMonth: normalizeAccountantCycle(raw.cycle, now),
    propertyId: unknownPropertyRequested ? null : requestedPropertyId,
    issueFilter: issueFilter(raw.issue),
    query: boundedQuery(raw.q),
  };
  // An out-of-scope direct identifier is a deny state. Keeping the normalized
  // property value null prevents it from being propagated to downstream
  // projections, but must never turn the request into an all-properties view.
  const filteredIssues = unknownPropertyRequested
    ? []
    : filterAccountantIssues(issues, base);
  const requestedSelection = boundedIdentifier(raw.selected);
  const requestedPage = Number(scalar(raw.page));
  const issuePage = normalizeRegisterPage(filteredIssues, {
    requestedPage:
      Number.isSafeInteger(requestedPage) && requestedPage > 0
        ? requestedPage
        : 1,
    selectedId: requestedSelection,
    pageSize,
    id: (issue) => issue.id,
  });
  const selectedIssueId = issuePage.selectedId;
  const state: AccountantViewState = {
    ...base,
    selectedIssueId,
    page: issuePage.page,
  };
  return {
    state,
    visibleIssues: issuePage.rows,
    filteredIssueCount: filteredIssues.length,
    issuePage,
    selectedIssue:
      issuePage.rows.find((issue) => issue.id === selectedIssueId) ?? null,
    staleSelectionCleared: issuePage.staleSelectionCleared,
    unknownPropertyRequested,
    searchParams: buildAccountantViewParams(state),
  };
}

export type AccountantExportKind =
  | 'reconciliation'
  | 'rent-ledger'
  | 'payment-history'
  | 'document-index';

export function buildAccountantExportParams(
  kind: AccountantExportKind,
  state: AccountantViewState,
): URLSearchParams {
  const params = buildAccountantViewParams({ ...state, selectedIssueId: null });
  params.delete('page');
  const result = new URLSearchParams({ kind });
  for (const [key, value] of params) result.set(key, value);
  return result;
}
