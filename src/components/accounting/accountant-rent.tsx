import type { ReactElement } from 'react';

import {
  buildRentRegisterParams,
  deriveRentEvidenceState,
  type normalizeRentRegister,
} from '@/lib/accounting/register-state';
import type { AccountantRentLedgerModel } from '@/lib/accounting/types';

import { formatAccountingDate, formatAccountingMoney, sentenceCase } from './format';
import {
  ACCOUNTING_REGISTER_CSS,
  RegisterBoundary,
  RegisterPagination,
  RegisterSummary,
} from './register-ui';
import { AccountantRouteDossier } from './route-dossier';

type RentRegister = ReturnType<typeof normalizeRentRegister>;

function rentHref(
  state: RentRegister['state'],
  changes: Partial<RentRegister['state']>,
): string {
  const next = {
    ...state,
    ...changes,
    eventId: changes.eventId ?? null,
    page: changes.page ?? 1,
  };
  return `/rent?${buildRentRegisterParams(next).toString()}`;
}

export function AccountantRentRegister({
  model,
  register,
}: {
  model: AccountantRentLedgerModel;
  register: RentRegister;
}): ReactElement {
  const rows = register.filteredRows;
  const netDue = rows.reduce((sum, row) => sum + row.amountDueCents, 0);
  const collected = rows.reduce((sum, row) => sum + row.amountPaidCents, 0);
  const open = rows.reduce(
    (sum, row) => sum + Math.max(row.amountDueCents - row.amountPaidCents, 0),
    0,
  );
  const waived = rows.reduce(
    (sum, row) => sum + (row.waivedAmountCents ?? 0),
    0,
  );
  const properties = [...model.properties].sort((a, b) =>
    a.propertyName.localeCompare(b.propertyName),
  );
  const exportParams = new URLSearchParams({ kind: 'rent-ledger' });
  for (const [key, value] of buildRentRegisterParams(register.state, {
    selection: false,
    page: false,
    context: false,
  })) {
    exportParams.set(key, value);
  }
  const previousHref =
    register.page.page > 1
      ? rentHref(register.state, { page: register.page.page - 1 })
      : null;
  const nextHref =
    register.page.page < register.page.pageCount
      ? rentHref(register.state, { page: register.page.page + 1 })
      : null;

  return (
    <div className="accounting-route-register" data-testid="accountant-rent-ledger">
      <RegisterSummary
        values={[
          { label: 'Current obligation', value: formatAccountingMoney(netDue) },
          { label: 'Ledger collected', value: formatAccountingMoney(collected) },
          { label: 'Open balance', value: formatAccountingMoney(open) },
          { label: 'Waived', value: formatAccountingMoney(waived) },
        ]}
      />

      {register.state.context === 'missing_cycle' ? (
        <RegisterBoundary>
          <strong>Missing-cycle review context.</strong> This filtered view was
          opened from a missing-cycle handoff. If no canonical rent event
          appears, the read-only register cannot create or infer one.
        </RegisterBoundary>
      ) : null}

      <section className="accounting-route-filters" aria-label="Rent filters">
        <form action="/rent" method="get">
          <input type="hidden" name="property" value={register.state.propertyId ?? ''} />
          <input type="hidden" name="state" value={register.state.state} />
          <input type="hidden" name="q" value={register.state.query} />
          <label>
            <span>Cycle month</span>
            <input type="month" name="cycle" defaultValue={register.state.cycleMonth.slice(0, 7)} />
          </label>
          <button type="submit">Load</button>
        </form>
        <form action="/rent" method="get">
          <input type="hidden" name="cycle" value={register.state.cycleMonth.slice(0, 7)} />
          <input type="hidden" name="state" value={register.state.state} />
          <input type="hidden" name="q" value={register.state.query} />
          <label>
            <span>Property</span>
            <select name="property" defaultValue={register.state.propertyId ?? ''}>
              <option value="">All assigned properties</option>
              {properties.map((property) => (
                <option key={property.propertyId} value={property.propertyId}>
                  {property.propertyName}{property.propertyArchivedAt ? ' — archived' : ''}
                </option>
              ))}
            </select>
          </label>
          <button type="submit">Apply</button>
        </form>
        <form action="/rent" method="get">
          <input type="hidden" name="cycle" value={register.state.cycleMonth.slice(0, 7)} />
          <input type="hidden" name="property" value={register.state.propertyId ?? ''} />
          <input type="hidden" name="state" value={register.state.state} />
          <label>
            <span>Search</span>
            <input type="search" name="q" defaultValue={register.state.query} placeholder="Property, unit, resident…" />
          </label>
          <button type="submit">Search</button>
        </form>
        {model.canExport ? (
          <a className="accounting-route-export" href={`/api/accounting/export?${exportParams.toString()}`}>
            Export filtered rent rows
          </a>
        ) : null}
      </section>

      <nav className="accounting-route-tabs" aria-label="Rent evidence state">
        {(['all', 'outstanding', 'settled', 'waived'] as const).map((state) => (
          <a
            key={state}
            href={rentHref(register.state, { state })}
            aria-current={register.state.state === state ? 'page' : undefined}
          >
            {sentenceCase(state)}
          </a>
        ))}
      </nav>

      <div className={`accounting-route-layout${register.selectedRow ? ' has-selection' : ''}`}>
        <section className="accounting-route-sheet" aria-labelledby="rent-register-title">
          <header>
            <div><span>Canonical rent events</span><h2 id="rent-register-title">Scoped rent register</h2></div>
            <strong>{model.periodLabel}</strong>
          </header>
          {register.page.rows.length === 0 ? (
            <p className="accounting-route-empty">No rent events match the authorized period and filters.</p>
          ) : (
            <div className="accounting-route-table-wrap">
              <table className="accounting-route-table">
                <thead><tr><th>Property / unit</th><th>Resident</th><th>Due</th><th className="numeric">Current obligation</th><th className="numeric">Collected</th><th className="numeric">Open</th><th className="numeric">Waived</th><th>Evidence state</th></tr></thead>
                <tbody>
                  {register.page.rows.map((row) => {
                    const evidenceState = deriveRentEvidenceState(row);
                    const href = rentHref(register.state, { eventId: row.rentEventId, page: register.page.page });
                    return (
                      <tr key={row.rentEventId} data-selected={row.rentEventId === register.state.eventId ? 'true' : 'false'}>
                        <th scope="row"><a id={`accountant-rent-row-${row.rentEventId}`} href={href}>{row.propertyName}<span className="accounting-route-secondary">Unit {row.unitLabel}{row.propertyArchivedAt ? ' · Archived' : ''}</span></a></th>
                        <td>{row.tenantName}</td>
                        <td>{formatAccountingDate(row.dueDate)}</td>
                        <td className="numeric">{formatAccountingMoney(row.amountDueCents)}</td>
                        <td className="numeric">{formatAccountingMoney(row.amountPaidCents)}</td>
                        <td className="numeric">{formatAccountingMoney(Math.max(row.amountDueCents - row.amountPaidCents, 0))}</td>
                        <td className="numeric">{formatAccountingMoney(row.waivedAmountCents ?? 0)}</td>
                        <td>{sentenceCase(evidenceState)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <RegisterPagination {...register.page.range} previousHref={previousHref} nextHref={nextHref} />
        </section>
        <AccountantRouteDossier
          open={register.selectedRow !== null}
          ariaLabel="Rent evidence dossier"
          closeHref={rentHref(register.state, {
            eventId: null,
            page: register.page.page,
          })}
          triggerId={
            register.selectedRow
              ? `accountant-rent-row-${register.selectedRow.rentEventId}`
              : null
          }
        >
          {register.selectedRow ? (
            <>
            <span>Selected rent evidence</span><h2>{register.selectedRow.propertyName} · Unit {register.selectedRow.unitLabel}</h2>
            <p>Canonical rent-cycle values only. The stored status label is not used to override the money evidence.</p>
            <dl>
              <div><dt>Resident</dt><dd>{register.selectedRow.tenantName}</dd></div>
              <div><dt>Evidence state</dt><dd>{sentenceCase(deriveRentEvidenceState(register.selectedRow))}</dd></div>
              <div><dt>Due date</dt><dd>{formatAccountingDate(register.selectedRow.dueDate)}</dd></div>
              <div><dt>Open balance</dt><dd>{formatAccountingMoney(Math.max(register.selectedRow.amountDueCents - register.selectedRow.amountPaidCents, 0))}</dd></div>
            </dl>
            </>
          ) : null}
        </AccountantRouteDossier>
      </div>

      <RegisterBoundary><strong>Read-only.</strong> Payment recording, waivers, lease changes, and money movement are unavailable to Accountants.</RegisterBoundary>
      <style>{ACCOUNTING_REGISTER_CSS}</style>
    </div>
  );
}
