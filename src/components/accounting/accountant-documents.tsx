import type { ReactElement } from 'react';

import { buildDocumentRegisterParams, type normalizeDocumentRegister } from '@/lib/accounting/register-state';
import type { AccountantDocumentsModel } from '@/lib/accounting/types';

import { formatAccountingDate, sentenceCase } from './format';
import { ACCOUNTING_REGISTER_CSS, RegisterBoundary, RegisterPagination } from './register-ui';
import { AccountantRouteDossier } from './route-dossier';

type DocumentRegister = ReturnType<typeof normalizeDocumentRegister>;
const MISSING_EVIDENCE_PREVIEW_LIMIT = 8;

function documentHref(state: DocumentRegister['state'], changes: Partial<DocumentRegister['state']>): string {
  const next = { ...state, ...changes, documentId: changes.documentId ?? null, page: changes.page ?? 1 };
  const params = buildDocumentRegisterParams(next);
  return params.size ? `/documents?${params.toString()}` : '/documents';
}

function missingEvidenceHref(
  lease: AccountantDocumentsModel['missingLeaseEvidence'][number],
): string {
  const params = new URLSearchParams({
    property: lease.propertyId,
    issue: 'documents',
    q: lease.tenantName,
    selected: `missing_lease_document:${lease.leaseId}`,
  });
  return `/today?${params.toString()}`;
}

export function AccountantDocumentRegister({ model, register }: { model: AccountantDocumentsModel; register: DocumentRegister }): ReactElement {
  const exportParams = new URLSearchParams({ kind: 'document-index' });
  for (const [key, value] of buildDocumentRegisterParams(register.state, { selection: false, page: false, context: false })) exportParams.set(key, value);
  const previousHref = register.page.page > 1 ? documentHref(register.state, { page: register.page.page - 1 }) : null;
  const nextHref = register.page.page < register.page.pageCount ? documentHref(register.state, { page: register.page.page + 1 }) : null;
  const missingQuery = register.state.query.toLocaleLowerCase('en-US');
  const missing = register.state.type === 'property'
    ? []
    : model.missingLeaseEvidence.filter((lease) => {
        if (
          register.state.propertyId &&
          lease.propertyId !== register.state.propertyId
        ) {
          return false;
        }
        return (
          !missingQuery ||
          [
            lease.propertyName,
            lease.unitLabel,
            lease.tenantName,
          ].some((value) =>
            value.toLocaleLowerCase('en-US').includes(missingQuery),
          )
        );
      });
  const missingPreview = missing.slice(0, MISSING_EVIDENCE_PREVIEW_LIMIT);
  const properties = [...model.properties].sort((a, b) =>
    a.propertyName.localeCompare(b.propertyName),
  );

  return (
    <div className="accounting-route-register" data-testid="accountant-documents">
      {register.state.context === 'missing_lease_evidence' ? <RegisterBoundary><strong>Missing-evidence review context.</strong> This filtered view was opened from a missing-evidence handoff. Only currently eligible owner-classified metadata appears; this index cannot upload or reclassify a file.</RegisterBoundary> : null}
      <section className="accounting-route-sheet" aria-labelledby="missing-evidence-title">
        <header><div><span>Close evidence</span><h2 id="missing-evidence-title">Missing linked lease evidence</h2></div><strong>{missing.length || 'Clear'}</strong></header>
        {missing.length === 0 ? <p className="accounting-route-empty">No missing eligible lease evidence is visible in the selected authorized scope and filters.</p> : <div>{missingPreview.map((lease) => <div key={lease.leaseId} style={{ padding: '11px 14px', borderTop: '1px solid var(--ar-soft)', fontSize: 12, display: 'flex', gap: 12, justifyContent: 'space-between' }}><span>{lease.propertyName} · Unit {lease.unitLabel} · {lease.tenantName}</span><a href={missingEvidenceHref(lease)}>Review discrepancy</a></div>)}{missing.length > missingPreview.length ? <p className="accounting-route-empty">Showing the first {missingPreview.length} of {missing.length}. Narrow the property or search filter to review the rest.</p> : null}</div>}
      </section>

      <section className="accounting-route-filters" aria-label="Document filters">
        <form action="/documents" method="get"><input type="hidden" name="type" value={register.state.type} /><input type="hidden" name="q" value={register.state.query} /><label><span>Property</span><select name="property" defaultValue={register.state.propertyId ?? ''}><option value="">All assigned properties</option>{properties.map((property) => <option key={property.propertyId} value={property.propertyId}>{property.propertyName}{property.propertyArchivedAt ? ' — archived' : ''}</option>)}</select></label><button type="submit">Apply</button></form>
        <form action="/documents" method="get"><input type="hidden" name="property" value={register.state.propertyId ?? ''} /><input type="hidden" name="q" value={register.state.query} /><label><span>Evidence class</span><select name="type" defaultValue={register.state.type}><option value="all">All classified evidence</option><option value="lease">Lease evidence</option><option value="property">Property accounting evidence</option></select></label><button type="submit">Apply</button></form>
        <form action="/documents" method="get"><input type="hidden" name="property" value={register.state.propertyId ?? ''} /><input type="hidden" name="type" value={register.state.type} /><label><span>Search</span><input type="search" name="q" defaultValue={register.state.query} placeholder="Document, property, resident…" /></label><button type="submit">Search</button></form>
        {model.canExport ? <a className="accounting-route-export" href={`/api/accounting/export?${exportParams.toString()}`}>Export filtered document rows</a> : null}
      </section>

      <div className={`accounting-route-layout${register.selectedRow ? ' has-selection' : ''}`}>
        <section className="accounting-route-sheet" aria-labelledby="document-register-title">
          <header><div><span>Explicitly classified metadata</span><h2 id="document-register-title">Accounting evidence index</h2></div><strong>{register.page.range.total} visible</strong></header>
          {register.page.rows.length === 0 ? <p className="accounting-route-empty">No classified accounting documents match these filters.</p> : <div className="accounting-route-table-wrap"><table className="accounting-route-table"><thead><tr><th>Document</th><th>Property / unit</th><th>Resident</th><th>Evidence class</th><th>Type</th><th>Expires</th><th>Indexed</th></tr></thead><tbody>{register.page.rows.map((row) => <tr key={row.documentId} data-selected={row.documentId === register.state.documentId ? 'true' : 'false'}><th scope="row"><a id={`accountant-document-row-${row.documentId}`} href={documentHref(register.state, { documentId: row.documentId, page: register.page.page })}>{row.title}</a></th><td>{row.propertyName}<span className="accounting-route-secondary">{row.unitLabel ? `Unit ${row.unitLabel}` : 'Property level'}{row.propertyArchivedAt ? ' · Archived' : ''}</span></td><td>{row.tenantName ?? '—'}</td><td>{row.evidenceClass === 'lease_evidence' ? 'Lease evidence' : 'Property accounting'}</td><td>{sentenceCase(row.type)}</td><td>{formatAccountingDate(row.expiryDate, 'No expiry')}</td><td>{formatAccountingDate(row.createdAt)}</td></tr>)}</tbody></table></div>}
          <RegisterPagination {...register.page.range} previousHref={previousHref} nextHref={nextHref} />
        </section>
        <AccountantRouteDossier open={register.selectedRow !== null} ariaLabel="Document evidence dossier" closeHref={documentHref(register.state, { documentId: null, page: register.page.page })} triggerId={register.selectedRow ? `accountant-document-row-${register.selectedRow.documentId}` : null}>
          {register.selectedRow ? <><span>Selected evidence metadata</span><h2>{register.selectedRow.title}</h2><p>Only owner-classified accounting metadata is exposed. File bytes are unavailable from this Accountant index.</p><dl><div><dt>Property</dt><dd>{register.selectedRow.propertyName}</dd></div><div><dt>Evidence class</dt><dd>{register.selectedRow.evidenceClass === 'lease_evidence' ? 'Lease evidence' : 'Property accounting'}</dd></div><div><dt>Lease status</dt><dd>{register.selectedRow.leaseStatus ? sentenceCase(register.selectedRow.leaseStatus) : 'Not applicable'}</dd></div><div><dt>Indexed</dt><dd>{formatAccountingDate(register.selectedRow.createdAt)}</dd></div></dl></> : null}
        </AccountantRouteDossier>
      </div>
      <RegisterBoundary><strong>Metadata only.</strong> Property scope is necessary but not sufficient: only explicitly owner-classified accounting evidence appears. Editing and raw file access are unavailable.</RegisterBoundary>
      <style>{ACCOUNTING_REGISTER_CSS}</style>
    </div>
  );
}
