import type { ReactElement } from 'react';

import {
  buildFinancialRegisterParams,
  isConfirmedPaymentRecord,
  paymentEvidenceState,
  requiresRentEventMatch,
  type normalizeFinancialRegister,
} from '@/lib/accounting/register-state';
import type { AccountantFinancialsModel } from '@/lib/accounting/types';

import { formatAccountingMoney, formatAccountingTimestamp, sentenceCase } from './format';
import { ACCOUNTING_REGISTER_CSS, RegisterBoundary, RegisterPagination, RegisterSummary } from './register-ui';
import { AccountantRouteDossier } from './route-dossier';

type FinancialRegister = ReturnType<typeof normalizeFinancialRegister>;

function financialHref(state: FinancialRegister['state'], changes: Partial<FinancialRegister['state']>): string {
  const next = { ...state, ...changes, paymentId: changes.paymentId ?? null, page: changes.page ?? 1 };
  return `/financials?${buildFinancialRegisterParams(next).toString()}`;
}

export function AccountantFinancialRegister({ model, register }: { model: AccountantFinancialsModel; register: FinancialRegister }): ReactElement {
  const visiblePayments = register.filteredRows;
  const properties = [...model.properties].sort((a, b) =>
    a.propertyName.localeCompare(b.propertyName),
  );
  const confirmed = visiblePayments
    .filter(isConfirmedPaymentRecord)
    .reduce((sum, row) => sum + row.amountCents, 0);
  const unmatched = visiblePayments.filter(requiresRentEventMatch).length;
  const missingPaymentTime = visiblePayments.filter(
    (row) => row.status.toLowerCase() === 'succeeded' && row.paidAt === null,
  ).length;
  const exportParams = new URLSearchParams({
    kind: 'payment-history',
    from: model.fromDate,
    to: model.toDate,
  });
  if (register.state.propertyId) exportParams.set('property', register.state.propertyId);
  if (register.state.state !== 'all') exportParams.set('state', register.state.state);
  if (register.state.query) exportParams.set('q', register.state.query);
  const previousHref = register.page.page > 1 ? financialHref(register.state, { page: register.page.page - 1 }) : null;
  const nextHref = register.page.page < register.page.pageCount ? financialHref(register.state, { page: register.page.page + 1 }) : null;

  return (
    <div className="accounting-route-register" data-testid="accountant-financials">
      <nav className="accounting-route-tabs" aria-label="Financial period">
        {([
          ['mtd', 'Month to date'], ['last', 'Last month'], ['qtd', 'Quarter to date'], ['ytd', 'Year to date'],
        ] as const).map(([period, label]) => (
          <a key={period} href={financialHref(register.state, { period })} aria-current={register.state.period === period ? 'page' : undefined}>{label}</a>
        ))}
      </nav>
      <RegisterSummary values={[
        { label: 'Visible payment rows', value: String(visiblePayments.length) },
        { label: 'Confirmed evidence', value: formatAccountingMoney(confirmed) },
        { label: 'Matching required', value: String(unmatched) },
        { label: 'Payment time unavailable', value: String(missingPaymentTime) },
      ]} />
      {model.billedCents === null ? (
        <RegisterBoundary>
          <strong>Rent obligation access is unavailable.</strong> Payment
          evidence remains visible under Financials, but billed, ledger-collected,
          and outstanding rent totals are not shown as zero.
        </RegisterBoundary>
      ) : null}
      <RegisterBoundary><strong>Expense imports are not connected.</strong> Spend, NOI, margin, and a full book close are unavailable. Period boundaries currently use UTC. Rows with a canonical paid_at are scoped by payment time. Rows missing paid_at are explicitly labeled recorded exceptions and never contribute to confirmed payment totals. Canonical rent obligations remain in Rent.</RegisterBoundary>

      <section className="accounting-route-filters" aria-label="Payment filters">
        <form action="/financials" method="get">
          <input type="hidden" name="period" value={register.state.period} /><input type="hidden" name="state" value={register.state.state} /><input type="hidden" name="q" value={register.state.query} />
          <label><span>Property</span><select name="property" defaultValue={register.state.propertyId ?? ''}><option value="">All assigned properties</option>{properties.map((property) => <option key={property.propertyId} value={property.propertyId}>{property.propertyName}{property.propertyArchivedAt ? ' — archived' : ''}</option>)}</select></label><button type="submit">Apply</button>
        </form>
        <form action="/financials" method="get">
          <input type="hidden" name="period" value={register.state.period} /><input type="hidden" name="property" value={register.state.propertyId ?? ''} /><input type="hidden" name="q" value={register.state.query} />
          <label><span>Evidence state</span><select name="state" defaultValue={register.state.state}>{(['all', 'confirmed', 'unmatched', 'timestamp_missing', 'pending', 'other'] as const).map((state) => <option key={state} value={state}>{sentenceCase(state)}</option>)}</select></label><button type="submit">Apply</button>
        </form>
        <form action="/financials" method="get">
          <input type="hidden" name="period" value={register.state.period} /><input type="hidden" name="property" value={register.state.propertyId ?? ''} /><input type="hidden" name="state" value={register.state.state} />
          <label><span>Search</span><input type="search" name="q" defaultValue={register.state.query} placeholder="Property, unit, resident…" /></label><button type="submit">Search</button>
        </form>
        {model.canExport ? <a className="accounting-route-export" href={`/api/accounting/export?${exportParams.toString()}`}>Export filtered payment rows</a> : null}
      </section>

      <div className={`accounting-route-layout${register.selectedRow ? ' has-selection' : ''}`}>
        <section className="accounting-route-sheet" aria-labelledby="payment-register-title">
          <header><div><span>Canonical payment rows</span><h2 id="payment-register-title">Payment evidence register</h2></div><strong>{model.periodLabel}</strong></header>
          {register.page.rows.length === 0 ? <p className="accounting-route-empty">No payment rows match the authorized period and filters.</p> : (
            <div className="accounting-route-table-wrap"><table className="accounting-route-table"><thead><tr><th>Property / unit</th><th>Resident</th><th className="numeric">Amount</th><th>Status</th><th>Payment time (UTC)</th><th>Period inclusion</th><th>Match</th><th>Receipt</th></tr></thead><tbody>
              {register.page.rows.map((row) => <tr key={row.paymentId} data-selected={row.paymentId === register.state.paymentId ? 'true' : 'false'}>
                <th scope="row"><a id={`accountant-payment-row-${row.paymentId}`} href={financialHref(register.state, { paymentId: row.paymentId, page: register.page.page })}>{row.propertyName}<span className="accounting-route-secondary">Unit {row.unitLabel}{row.propertyArchivedAt ? ' · Archived' : ''}</span></a></th>
                <td>{row.tenantName}</td><td className="numeric">{formatAccountingMoney(row.amountCents, row.currency)}</td><td>{sentenceCase(row.status)}</td><td>{row.paidAt ? formatAccountingTimestamp(row.paidAt) : 'Payment time unavailable'}</td><td>{row.periodBasis === 'payment_time' ? 'Canonical payment time' : 'Recorded exception'}</td><td>{row.matched ? 'Matched' : requiresRentEventMatch(row) ? 'Matching required' : 'Not required for this status'}</td><td>{row.receiptPresent ? 'Present' : 'Unavailable'}</td>
              </tr>)}
            </tbody></table></div>
          )}
          <RegisterPagination {...register.page.range} previousHref={previousHref} nextHref={nextHref} />
        </section>
        <AccountantRouteDossier open={register.selectedRow !== null} ariaLabel="Payment evidence dossier" closeHref={financialHref(register.state, { paymentId: null, page: register.page.page })} triggerId={register.selectedRow ? `accountant-payment-row-${register.selectedRow.paymentId}` : null}>
          {register.selectedRow ? <><span>Selected payment row</span><h2>{register.selectedRow.propertyName} · {formatAccountingMoney(register.selectedRow.amountCents, register.selectedRow.currency)}</h2><p>This is a real canonical payment row. A missing paid_at remains unavailable and is never replaced by record creation or rent-event update time.</p><dl><div><dt>Resident</dt><dd>{register.selectedRow.tenantName}</dd></div><div><dt>Evidence state</dt><dd>{sentenceCase(paymentEvidenceState(register.selectedRow))}</dd></div><div><dt>Payment time (UTC)</dt><dd>{register.selectedRow.paidAt ? formatAccountingTimestamp(register.selectedRow.paidAt) : 'Unavailable'}</dd></div><div><dt>Period inclusion</dt><dd>{register.selectedRow.periodBasis === 'payment_time' ? 'Canonical payment time' : 'Recorded exception; payment time unavailable'}</dd></div><div><dt>Rent-event match</dt><dd>{register.selectedRow.matched ? 'Matched' : requiresRentEventMatch(register.selectedRow) ? 'Missing' : 'Not required for this status'}</dd></div></dl></> : null}
        </AccountantRouteDossier>
      </div>
      <RegisterBoundary><strong>No money movement.</strong> Payment recording, refunds, transfers, waivers, and lease changes are unavailable.</RegisterBoundary>
      <style>{ACCOUNTING_REGISTER_CSS}</style>
    </div>
  );
}
