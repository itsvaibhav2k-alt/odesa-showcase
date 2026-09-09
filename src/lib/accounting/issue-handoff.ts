import {
  buildDocumentRegisterParams,
  buildFinancialRegisterParams,
  buildRentRegisterParams,
  type AccountantFinancialPeriod,
} from './register-state';
import type { AccountantReconciliationIssue } from './types';

export interface AccountantIssueHandoff {
  label: 'Open Rent' | 'Open Financials' | 'Open Documents';
  href: string;
}

const CYCLE = /^(\d{4})-(\d{2})-01$/;
const SAFE_ID = /^[A-Za-z0-9:_-]{1,128}$/;

function cycleParts(value: string) {
  const match = CYCLE.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  return year >= 1 && month >= 1 && month <= 12
    ? { year, month }
    : null;
}

function priorCycle(value: string): string | null {
  const parts = cycleParts(value);
  if (!parts) return null;
  return parts.month === 1
    ? `${String(parts.year - 1).padStart(4, '0')}-12-01`
    : `${String(parts.year).padStart(4, '0')}-${String(parts.month - 1).padStart(2, '0')}-01`;
}

function containingPeriod(
  cycleMonth: string,
  currentCycleMonth: string,
): AccountantFinancialPeriod | null {
  const cycle = cycleParts(cycleMonth);
  const current = cycleParts(currentCycleMonth);
  if (!cycle || !current || cycleMonth > currentCycleMonth) return null;
  if (cycleMonth === currentCycleMonth) return 'mtd';
  if (cycleMonth === priorCycle(currentCycleMonth)) return 'last';
  if (cycle.year !== current.year) return null;
  const quarterStart = Math.floor((current.month - 1) / 3) * 3 + 1;
  return cycle.month >= quarterStart ? 'qtd' : 'ytd';
}

function sourceId(issue: AccountantReconciliationIssue): string | null {
  const separator = issue.id.indexOf(':');
  const value = separator >= 0 ? issue.id.slice(separator + 1) : '';
  return SAFE_ID.test(value) ? value : null;
}

function query(issue: AccountantReconciliationIssue): string {
  return (issue.tenantName ?? issue.unitLabel ?? '').trim().slice(0, 80);
}

export function buildAccountantIssueHandoff(
  issue: AccountantReconciliationIssue,
  cycleMonth: string,
  currentCycleMonth: string,
): AccountantIssueHandoff | null {
  if (issue.kind === 'missing_lease_document') {
    const params = buildDocumentRegisterParams({
      propertyId: issue.propertyId,
      type: 'lease',
      query: query(issue),
      documentId: null,
      context: 'missing_lease_evidence',
      page: 1,
    });
    return {
      label: 'Open Documents',
      href: `/documents?${params.toString()}`,
    };
  }

  if (
    issue.kind === 'missing_rent_cycle' ||
    issue.kind === 'outstanding_balance'
  ) {
    const id =
      issue.kind === 'outstanding_balance' ? sourceId(issue) : null;
    if (issue.kind === 'outstanding_balance' && !id) return null;
    const params = buildRentRegisterParams({
      cycleMonth,
      propertyId: issue.propertyId,
      state:
        issue.kind === 'outstanding_balance' ? 'outstanding' : 'all',
      query: query(issue),
      eventId: id,
      context:
        issue.kind === 'missing_rent_cycle' ? 'missing_cycle' : null,
      page: 1,
    });
    return { label: 'Open Rent', href: `/rent?${params.toString()}` };
  }

  const period = containingPeriod(cycleMonth, currentCycleMonth);
  const paymentId = sourceId(issue);
  if (!period || !paymentId) return null;
  const params = buildFinancialRegisterParams({
    period,
    propertyId: issue.propertyId,
    state:
      issue.kind === 'unmatched_payment'
        ? 'unmatched'
        : 'timestamp_missing',
    query: query(issue),
    paymentId,
    page: 1,
  });
  return {
    label: 'Open Financials',
    href: `/financials?${params.toString()}`,
  };
}
