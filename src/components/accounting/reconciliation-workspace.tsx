'use client';

import { usePathname, useRouter } from 'next/navigation';
import {
  type FormEvent,
  type ReactElement,
  useEffect,
  useRef,
  useState,
} from 'react';

import type {
  AccountantReconciliationDesk,
  AccountantReconciliationIssue,
} from '@/lib/accounting/types';
import {
  buildAccountantExportParams,
  buildAccountantViewParams,
  type AccountantIssueFilter,
  type AccountantViewState,
} from '@/lib/accounting/view-state';
import { buildAccountantIssueHandoff } from '@/lib/accounting/issue-handoff';
import { formatAccountingTimestamp } from './format';

const ISSUE_LABEL: Record<AccountantReconciliationIssue['kind'], string> = {
  unmatched_payment: 'Payment matching',
  missing_rent_cycle: 'Missing rent cycle',
  missing_lease_document: 'Missing lease evidence',
  payment_time_unavailable: 'Payment time unavailable',
  outstanding_balance: 'Open rent balance',
};

const FILTERS: ReadonlyArray<{
  id: AccountantIssueFilter;
  label: string;
}> = [
  { id: 'all', label: 'All discrepancies' },
  { id: 'matching', label: 'Payment matching' },
  { id: 'rent', label: 'Rent evidence' },
  { id: 'documents', label: 'Documents' },
];

function formatMoney(cents: number | null): string {
  if (cents === null) return 'Unavailable';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 2,
  }).format(cents / 100);
}

function useMobileDossier(): boolean {
  const [mobile, setMobile] = useState(false);
  useEffect(() => {
    const media = window.matchMedia('(max-width: 760px)');
    const sync = () => setMobile(media.matches);
    sync();
    media.addEventListener('change', sync);
    return () => media.removeEventListener('change', sync);
  }, []);
  return mobile;
}

interface ReconciliationWorkspaceProps {
  model: AccountantReconciliationDesk;
  state: AccountantViewState;
  visibleIssues: readonly AccountantReconciliationIssue[];
  selectedIssue: AccountantReconciliationIssue | null;
  filteredIssueCount: number;
  issuePage: {
    page: number;
    pageCount: number;
    range: { from: number; to: number; total: number };
  };
  currentCycleMonth: string;
}

export function ReconciliationWorkspace({
  model,
  state,
  visibleIssues,
  selectedIssue,
  filteredIssueCount,
  issuePage,
  currentCycleMonth,
}: ReconciliationWorkspaceProps): ReactElement {
  const router = useRouter();
  const pathname = usePathname();
  const mobile = useMobileDossier();
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const rowRefs = useRef(new Map<string, HTMLButtonElement>());
  const restoreFocusId = useRef<string | null>(null);
  const lastSelectedIssueId = useRef<string | null>(selectedIssue?.id ?? null);

  const navigate = (
    changes: Partial<AccountantViewState>,
    options: { retainSelection?: boolean } = {},
  ) => {
    const next: AccountantViewState = {
      ...state,
      ...changes,
      selectedIssueId:
        changes.selectedIssueId !== undefined
          ? changes.selectedIssueId
          : options.retainSelection
            ? state.selectedIssueId
            : null,
    };
    const params = buildAccountantViewParams(next);
    router.push(`${pathname}?${params.toString()}`);
  };

  const closeDossier = () => {
    if (!selectedIssue) return;
    restoreFocusId.current = selectedIssue.id;
    navigate({ selectedIssueId: null }, { retainSelection: true });
  };

  useEffect(() => {
    if (selectedIssue) {
      lastSelectedIssueId.current = selectedIssue.id;
      return;
    }
    const issueId = restoreFocusId.current ?? lastSelectedIssueId.current;
    if (!issueId) return;
    restoreFocusId.current = null;
    lastSelectedIssueId.current = null;
    window.setTimeout(() => rowRefs.current.get(issueId)?.focus(), 0);
  }, [selectedIssue]);

  useEffect(() => {
    if (!mobile || !selectedIssue) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeRef.current?.focus();
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [mobile, selectedIssue]);

  const exportParams = buildAccountantExportParams('reconciliation', state);
  const properties = [...model.properties].sort((a, b) =>
    a.propertyName.localeCompare(b.propertyName),
  );
  const selectedProperty = state.propertyId
    ? model.properties.find(
        (property) => property.propertyId === state.propertyId,
      ) ?? null
    : null;
  const positionIssues = selectedProperty
    ? model.issues.filter(
        (issue) => issue.propertyId === selectedProperty.propertyId,
      )
    : model.issues;
  const positionCloseState = selectedProperty
    ? Object.values(model.availability).some((value) => value === 'denied')
      ? 'access_limited'
      : positionIssues.some((issue) => issue.kind === 'unmatched_payment')
        ? 'payment_matching_required'
        : positionIssues.length > 0
          ? 'needs_evidence'
          : 'rent_ledger_reviewed'
    : model.closeState;
  const position = selectedProperty
    ? {
        propertyCount: 1,
        billedCents: selectedProperty.billedCents,
        collectedCents: selectedProperty.collectedCents,
        outstandingCents: selectedProperty.outstandingCents,
      }
    : model;

  return (
    <div
      data-testid="accounting-workspace"
      data-has-selection={selectedIssue ? 'true' : 'false'}
      className="accounting-workspace"
    >
      <section className="accounting-position" aria-label="Close position">
        <div className="accounting-position-copy">
          <span className="accounting-eyebrow">Month-close position</span>
          <strong>
            {positionCloseState === 'payment_matching_required'
              ? 'Matching required before review'
              : positionCloseState === 'needs_evidence'
                ? 'Evidence gaps remain'
                : positionCloseState === 'access_limited'
                  ? 'Access is incomplete'
                  : positionCloseState === 'no_properties'
                    ? 'No properties in authorized scope'
                    : 'Rent evidence reviewed'}
          </strong>
          <span>
            Expense imports are not connected; this is a rent-evidence close,
            not a full book close or NOI statement. Period boundaries currently
            use UTC.
          </span>
        </div>
        <dl className="accounting-fact-strip">
          <div>
            <dt>Scoped</dt>
            <dd>{position.propertyCount}</dd>
          </div>
          <div>
            <dt>Net due</dt>
            <dd>{formatMoney(position.billedCents)}</dd>
          </div>
          <div>
            <dt>Ledger collected</dt>
            <dd>{formatMoney(position.collectedCents)}</dd>
          </div>
          <div>
            <dt>Open</dt>
            <dd>{formatMoney(position.outstandingCents)}</dd>
          </div>
        </dl>
      </section>

      <section className="accounting-toolbar" aria-label="Register filters">
        <form
          className="accounting-period-form"
          onSubmit={(event: FormEvent<HTMLFormElement>) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            const cycle = String(form.get('cycle') ?? '');
            navigate({ cycleMonth: `${cycle}-01`, page: 1 });
          }}
        >
          <label>
            <span>Close month</span>
            <input
              name="cycle"
              type="month"
              defaultValue={state.cycleMonth.slice(0, 7)}
              key={state.cycleMonth}
            />
          </label>
          <button type="submit">Load</button>
        </form>

        <label className="accounting-select-label">
          <span>Property scope</span>
          <select
            value={state.propertyId ?? ''}
            onChange={(event) =>
              navigate({
                propertyId: event.currentTarget.value || null,
                page: 1,
              })
            }
          >
            <option value="">All assigned properties</option>
            {properties.map((property) => (
              <option key={property.propertyId} value={property.propertyId}>
                {property.propertyName}
                {property.propertyArchivedAt ? ' — archived' : ''}
              </option>
            ))}
          </select>
        </label>

        <form
          className="accounting-search"
          onSubmit={(event: FormEvent<HTMLFormElement>) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            navigate({
              query: String(form.get('q') ?? '').trim().slice(0, 80),
              page: 1,
            });
          }}
        >
          <label>
            <span>Search register</span>
            <input
              name="q"
              type="search"
              defaultValue={state.query}
              key={state.query}
              placeholder="Property, unit, resident…"
            />
          </label>
          <button type="submit">Search</button>
        </form>

        {model.canExport ? (
          <a
            className="accounting-export"
            href={`/api/accounting/export?${exportParams.toString()}`}
          >
            Export filtered register
          </a>
        ) : null}
      </section>

      <nav className="accounting-filter-tabs" aria-label="Discrepancy type">
        {FILTERS.map((filter) => (
          <button
            key={filter.id}
            type="button"
            aria-pressed={state.issueFilter === filter.id}
            onClick={() => navigate({ issueFilter: filter.id, page: 1 })}
          >
            {filter.label}
          </button>
        ))}
      </nav>

      <div
        className={`accounting-register-layout${selectedIssue && !mobile ? ' has-dossier' : ''}`}
      >
        <section
          className="accounting-register"
          aria-labelledby="accounting-register-title"
        >
          <header>
            <div>
              <span className="accounting-eyebrow">Reconciliation register</span>
              <h2 id="accounting-register-title">Discrepancies and evidence</h2>
            </div>
            <span className="accounting-row-count">
              {issuePage.range.from}–{issuePage.range.to} of{' '}
              {filteredIssueCount} filtered / {model.issues.length} scoped
            </span>
          </header>

          {visibleIssues.length === 0 ? (
            <div className="accounting-empty" data-testid="accounting-empty">
              <strong>No discrepancies match these filters.</strong>
              <span>
                This does not claim a full close; expenses remain not connected.
              </span>
            </div>
          ) : (
            <div className="accounting-issue-list">
              {visibleIssues.map((issue) => {
                const active = issue.id === selectedIssue?.id;
                return (
                  <button
                    key={issue.id}
                    ref={(node) => {
                      if (node) rowRefs.current.set(issue.id, node);
                      else rowRefs.current.delete(issue.id);
                    }}
                    type="button"
                    className="accounting-issue-row"
                    aria-label={`${issue.title} — ${issue.propertyName}${issue.unitLabel ? `, unit ${issue.unitLabel}` : ''}`}
                    aria-pressed={active}
                    onClick={() =>
                      navigate(
                        { selectedIssueId: issue.id },
                        { retainSelection: true },
                      )
                    }
                  >
                    <span
                      className={`accounting-priority priority-${issue.priority}`}
                      aria-label={`${issue.priority} priority`}
                    />
                    <span className="accounting-issue-primary">
                      <span className="accounting-issue-kind">
                        {ISSUE_LABEL[issue.kind]}
                      </span>
                      <strong>{issue.title}</strong>
                      <span>
                        {issue.propertyName}
                        {issue.unitLabel ? ` · Unit ${issue.unitLabel}` : ''}
                        {issue.tenantName ? ` · ${issue.tenantName}` : ''}
                        {issue.propertyArchivedAt ? ' · Archived property' : ''}
                      </span>
                    </span>
                    <span className="accounting-issue-value">
                      {issue.amountCents === null
                        ? 'Evidence'
                        : formatMoney(issue.amountCents)}
                      <small>{active ? 'Selected' : 'Inspect'}</small>
                    </span>
                  </button>
                );
              })}
            </div>
          )}
          {issuePage.pageCount > 1 ? (
            <nav
              className="accounting-register-pagination"
              aria-label="Reconciliation register pages"
            >
              <button
                type="button"
                disabled={issuePage.page === 1}
                onClick={() => navigate({ page: issuePage.page - 1 })}
              >
                Previous
              </button>
              <span>
                Page {issuePage.page} of {issuePage.pageCount}
              </span>
              <button
                type="button"
                disabled={issuePage.page === issuePage.pageCount}
                onClick={() => navigate({ page: issuePage.page + 1 })}
              >
                Next
              </button>
            </nav>
          ) : null}
        </section>

        {selectedIssue && !mobile ? (
          <IssueDossier
            issue={selectedIssue}
            cycleMonth={state.cycleMonth}
            currentCycleMonth={currentCycleMonth}
            onClose={closeDossier}
          />
        ) : null}
      </div>

      {selectedIssue && mobile ? (
        <div className="accounting-mobile-backdrop" aria-hidden={false}>
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="accounting-mobile-dossier-title"
            className="accounting-mobile-dossier"
            data-testid="accounting-dossier"
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault();
                closeDossier();
                return;
              }
              if (event.key === 'Tab') {
                const focusable = Array.from(
                  event.currentTarget.querySelectorAll<HTMLElement>(
                    'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
                  ),
                );
                const first = focusable[0];
                const last = focusable.at(-1);
                if (
                  event.shiftKey &&
                  first &&
                  last &&
                  document.activeElement === first
                ) {
                  event.preventDefault();
                  last.focus();
                } else if (
                  !event.shiftKey &&
                  first &&
                  last &&
                  document.activeElement === last
                ) {
                  event.preventDefault();
                  first.focus();
                }
              }
            }}
          >
            <IssueDossierContent
              issue={selectedIssue}
              cycleMonth={state.cycleMonth}
              currentCycleMonth={currentCycleMonth}
              titleId="accounting-mobile-dossier-title"
              closeRef={closeRef}
              onClose={closeDossier}
            />
          </div>
        </div>
      ) : null}

      <footer className="accounting-boundary" data-testid="accounting-boundary">
        <strong>Read and export only.</strong>
        <span>
          Accountants cannot record or waive payments, alter leases, operate
          properties, contact residents or vendors, or move money.
        </span>
      </footer>

      <style>{WORKSPACE_CSS}</style>
    </div>
  );
}

function IssueDossier({
  issue,
  cycleMonth,
  currentCycleMonth,
  onClose,
}: {
  issue: AccountantReconciliationIssue;
  cycleMonth: string;
  currentCycleMonth: string;
  onClose: () => void;
}): ReactElement {
  return (
    <aside
      className="accounting-dossier"
      data-testid="accounting-dossier"
      aria-labelledby="accounting-desktop-dossier-title"
    >
      <IssueDossierContent
        issue={issue}
        cycleMonth={cycleMonth}
        currentCycleMonth={currentCycleMonth}
        titleId="accounting-desktop-dossier-title"
        onClose={onClose}
      />
    </aside>
  );
}

function IssueDossierContent({
  issue,
  cycleMonth,
  currentCycleMonth,
  titleId,
  onClose,
  closeRef,
}: {
  issue: AccountantReconciliationIssue;
  cycleMonth: string;
  currentCycleMonth: string;
  titleId: string;
  onClose: () => void;
  closeRef?: React.RefObject<HTMLButtonElement | null>;
}): ReactElement {
  const handoff = buildAccountantIssueHandoff(
    issue,
    cycleMonth,
    currentCycleMonth,
  );
  return (
    <div className="accounting-dossier-content">
      <header>
        <div>
          <span className="accounting-eyebrow">Evidence dossier</span>
          <h2 id={titleId}>{issue.title}</h2>
        </div>
        <button
          ref={closeRef}
          type="button"
          aria-label="Close evidence dossier"
          onClick={onClose}
        >
          ×
        </button>
      </header>

      <p className="accounting-dossier-summary">{issue.summary}</p>

      <dl className="accounting-dossier-context">
        <div>
          <dt>Property</dt>
          <dd>
            {issue.propertyName}
            {issue.propertyArchivedAt ? ' · Archived' : ''}
          </dd>
        </div>
        <div>
          <dt>Unit / resident</dt>
          <dd>
            {issue.unitLabel ? `Unit ${issue.unitLabel}` : 'Property level'}
            {issue.tenantName ? ` · ${issue.tenantName}` : ''}
          </dd>
        </div>
        <div>
          <dt>Amount under review</dt>
          <dd>{formatMoney(issue.amountCents)}</dd>
        </div>
        {issue.kind === 'unmatched_payment' ||
        issue.kind === 'payment_time_unavailable' ? (
          <div>
            <dt>Canonical payment time (UTC)</dt>
            <dd>{formatAccountingTimestamp(issue.occurredAt)}</dd>
          </div>
        ) : null}
      </dl>

      <section aria-label="Available evidence">
        <span className="accounting-eyebrow">Available evidence</span>
        <dl className="accounting-evidence-list">
          {issue.evidence.map((evidence) => (
            <div key={`${evidence.label}:${evidence.value}`}>
              <dt>{evidence.label}</dt>
              <dd data-tone={evidence.tone ?? 'neutral'}>{evidence.value}</dd>
            </div>
          ))}
        </dl>
      </section>

      {handoff ? (
        <a className="accounting-dossier-link" href={handoff.href}>
          {handoff.label} →
        </a>
      ) : (
        <p className="accounting-dossier-note">
          This month is outside the supported Financials periods. The evidence
          remains available in this read-only dossier and exact export.
        </p>
      )}
      <p className="accounting-dossier-note">
        No correction or money action is available in this dossier. It records
        what evidence exists and what remains unavailable.
      </p>
    </div>
  );
}

const WORKSPACE_CSS = `
  .accounting-workspace {
    --acct-ink: #211d18;
    --acct-muted: #786c5e;
    --acct-border: #ded3bf;
    --acct-border-soft: #ebe3d4;
    --acct-panel: #fffdf8;
    --acct-lift: #f8f3e8;
    display: grid;
    gap: 14px;
    color: var(--acct-ink);
    font-family: var(--font-sans-operator), 'IBM Plex Sans', sans-serif;
  }
  .accounting-eyebrow,
  .accounting-toolbar label > span,
  .accounting-fact-strip dt,
  .accounting-dossier-context dt,
  .accounting-evidence-list dt {
    font-family: var(--font-mono-operator), 'IBM Plex Mono', monospace;
    font-size: 9.5px;
    letter-spacing: .12em;
    text-transform: uppercase;
    color: var(--acct-muted);
  }
  .accounting-position {
    display: grid;
    grid-template-columns: minmax(260px, .85fr) minmax(430px, 1.15fr);
    border: 1px solid var(--acct-border);
    border-radius: 12px;
    background: var(--acct-panel);
    overflow: hidden;
  }
  .accounting-position-copy {
    display: grid;
    gap: 5px;
    padding: 16px 18px;
    border-right: 1px solid var(--acct-border-soft);
    background: var(--acct-lift);
  }
  .accounting-position-copy strong { font-size: 15px; font-weight: 600; }
  .accounting-position-copy > span:last-child {
    color: var(--acct-muted); font-size: 11.5px; line-height: 1.45;
  }
  .accounting-fact-strip {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    margin: 0;
  }
  .accounting-fact-strip > div {
    padding: 16px 14px;
    border-left: 1px solid var(--acct-border-soft);
  }
  .accounting-fact-strip > div:first-child { border-left: 0; }
  .accounting-fact-strip dd {
    margin: 5px 0 0;
    font: 500 13px var(--font-mono-operator), monospace;
    font-variant-numeric: tabular-nums;
  }
  .accounting-toolbar {
    display: grid;
    grid-template-columns: auto minmax(190px, .8fr) minmax(230px, 1fr) auto;
    align-items: end;
    gap: 9px;
    padding: 10px;
    border: 1px solid var(--acct-border);
    border-radius: 10px;
    background: var(--acct-panel);
  }
  .accounting-period-form, .accounting-search { display: flex; align-items: end; gap: 5px; }
  .accounting-toolbar label { display: grid; gap: 4px; min-width: 0; }
  .accounting-toolbar input, .accounting-toolbar select {
    width: 100%;
    height: 34px;
    border: 1px solid var(--acct-border);
    border-radius: 6px;
    background: #fffefa;
    padding: 0 9px;
    color: var(--acct-ink);
    font: 12px var(--font-sans-operator), sans-serif;
  }
  .accounting-toolbar button, .accounting-export {
    min-height: 34px;
    border: 1px solid var(--acct-border);
    border-radius: 6px;
    background: var(--acct-lift);
    padding: 8px 10px;
    color: var(--acct-ink);
    font: 500 11px var(--font-sans-operator), sans-serif;
    text-decoration: none;
    white-space: nowrap;
  }
  .accounting-export { background: #172b4d; border-color: #172b4d; color: #fffdf8; }
  .accounting-filter-tabs { display: flex; gap: 6px; flex-wrap: wrap; }
  .accounting-filter-tabs button {
    border: 1px solid var(--acct-border);
    border-radius: 999px;
    padding: 6px 10px;
    background: var(--acct-panel);
    color: #655a4e;
    font-size: 11px;
  }
  .accounting-filter-tabs button[aria-pressed='true'] {
    background: #29251f; border-color: #29251f; color: #fffdf8;
  }
  .accounting-register-layout { display: grid; grid-template-columns: minmax(0, 1fr); gap: 12px; }
  .accounting-register-layout.has-dossier { grid-template-columns: minmax(0, 1.65fr) minmax(300px, .85fr); }
  .accounting-register, .accounting-dossier {
    min-width: 0;
    border: 1px solid var(--acct-border);
    border-radius: 12px;
    background: var(--acct-panel);
    overflow: hidden;
  }
  .accounting-register > header {
    display: flex; align-items: center; justify-content: space-between; gap: 12px;
    padding: 14px 16px; border-bottom: 1px solid var(--acct-border-soft);
    background: var(--acct-lift);
  }
  .accounting-register h2, .accounting-dossier h2 {
    margin: 3px 0 0; font-size: 16px; font-weight: 600; line-height: 1.25;
  }
  .accounting-row-count { color: var(--acct-muted); font: 10.5px var(--font-mono-operator), monospace; }
  .accounting-issue-list { display: grid; }
  .accounting-issue-row {
    display: grid;
    grid-template-columns: 7px minmax(0, 1fr) auto;
    gap: 12px;
    align-items: center;
    width: 100%;
    padding: 13px 15px;
    border: 0;
    border-top: 1px solid var(--acct-border-soft);
    background: transparent;
    color: inherit;
    text-align: left;
  }
  .accounting-issue-row:first-child { border-top: 0; }
  .accounting-issue-row:hover, .accounting-issue-row[aria-pressed='true'] { background: #fbf6eb; }
  .accounting-issue-row:focus-visible { outline: 2px solid #1b3a6b; outline-offset: -3px; }
  .accounting-priority { width: 7px; height: 7px; border-radius: 50%; background: #a49584; }
  .accounting-priority.priority-high { background: #ae5138; }
  .accounting-priority.priority-medium { background: #ba8730; }
  .accounting-issue-primary { display: grid; gap: 2px; min-width: 0; }
  .accounting-issue-kind { color: var(--acct-muted); font: 9.5px var(--font-mono-operator), monospace; text-transform: uppercase; letter-spacing: .08em; }
  .accounting-issue-primary strong { font-size: 13px; font-weight: 600; }
  .accounting-issue-primary > span:last-child { color: var(--acct-muted); font-size: 11.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .accounting-issue-value { display: grid; gap: 2px; text-align: right; font: 500 12px var(--font-mono-operator), monospace; }
  .accounting-issue-value small { color: var(--acct-muted); font: 10px var(--font-sans-operator), sans-serif; }
  .accounting-empty { display: grid; gap: 5px; padding: 28px 18px; }
  .accounting-empty strong { font-size: 13px; }
  .accounting-empty span { color: var(--acct-muted); font-size: 12px; }
  .accounting-register-pagination {
    display: flex; align-items: center; justify-content: flex-end; gap: 10px;
    padding: 10px 14px; border-top: 1px solid var(--acct-border-soft);
    color: var(--acct-muted); font: 10.5px var(--font-mono-operator), monospace;
  }
  .accounting-register-pagination button {
    min-height: 30px; padding: 5px 9px; border: 1px solid var(--acct-border);
    border-radius: 6px; background: var(--acct-lift); color: var(--acct-ink);
    font: 500 11px var(--font-sans-operator), sans-serif;
  }
  .accounting-register-pagination button:disabled { opacity: .45; }
  .accounting-dossier { align-self: start; position: sticky; top: 12px; }
  .accounting-dossier-content { display: grid; gap: 17px; padding: 17px; }
  .accounting-dossier-content > header { display: flex; justify-content: space-between; gap: 14px; align-items: start; }
  .accounting-dossier-content > header button {
    width: 30px; height: 30px; flex: 0 0 auto; border: 1px solid var(--acct-border);
    border-radius: 50%; background: var(--acct-lift); color: var(--acct-ink); font-size: 19px;
  }
  .accounting-dossier-summary, .accounting-dossier-note { margin: 0; color: var(--acct-muted); font-size: 12px; line-height: 1.55; }
  .accounting-dossier-context, .accounting-evidence-list { display: grid; gap: 0; margin: 0; border: 1px solid var(--acct-border-soft); border-radius: 8px; overflow: hidden; }
  .accounting-dossier-context > div, .accounting-evidence-list > div {
    display: grid; grid-template-columns: minmax(105px, .7fr) minmax(0, 1.3fr);
    gap: 12px; padding: 10px 11px; border-top: 1px solid var(--acct-border-soft);
  }
  .accounting-dossier-context > div:first-child, .accounting-evidence-list > div:first-child { border-top: 0; }
  .accounting-dossier-context dd, .accounting-evidence-list dd { margin: 0; font-size: 11.5px; overflow-wrap: anywhere; }
  .accounting-evidence-list dd[data-tone='warning'], .accounting-evidence-list dd[data-tone='unavailable'] { color: #9c4f38; }
  .accounting-dossier-link { color: #1b3a6b; font-size: 12px; font-weight: 600; text-decoration: none; }
  .accounting-boundary {
    display: flex; gap: 8px; align-items: baseline; flex-wrap: wrap;
    padding: 11px 13px; border: 1px solid var(--acct-border-soft); border-radius: 8px;
    background: var(--acct-lift); font-size: 11.5px; color: var(--acct-muted);
  }
  .accounting-boundary strong { color: var(--acct-ink); }
  .accounting-mobile-backdrop { position: fixed; inset: 0; z-index: 80; background: rgba(34, 28, 21, .32); display: flex; align-items: end; }
  .accounting-mobile-dossier { width: 100%; max-height: min(86dvh, 760px); overflow: auto; border-radius: 16px 16px 0 0; background: var(--acct-panel); box-shadow: 0 -16px 42px rgba(34, 28, 21, .2); }
  @media (max-width: 940px) {
    .accounting-position { grid-template-columns: minmax(0, 1fr); }
    .accounting-position-copy { border-right: 0; border-bottom: 1px solid var(--acct-border-soft); }
    .accounting-toolbar { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .accounting-export { text-align: center; }
    .accounting-register-layout.has-dossier { grid-template-columns: minmax(0, 1.35fr) minmax(280px, .85fr); }
  }
  @media (max-width: 760px) {
    .accounting-position-copy { padding: 14px; }
    .accounting-fact-strip { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .accounting-fact-strip > div:nth-child(3) { border-left: 0; border-top: 1px solid var(--acct-border-soft); }
    .accounting-fact-strip > div:nth-child(4) { border-top: 1px solid var(--acct-border-soft); }
    .accounting-toolbar { grid-template-columns: minmax(0, 1fr); }
    .accounting-period-form, .accounting-search { display: grid; grid-template-columns: minmax(0, 1fr) auto; }
    .accounting-register > header { align-items: start; }
    .accounting-row-count { text-align: right; }
    .accounting-issue-row { grid-template-columns: 7px minmax(0, 1fr); }
    .accounting-issue-value { grid-column: 2; text-align: left; grid-template-columns: auto auto; justify-content: start; gap: 8px; }
  }
`;
