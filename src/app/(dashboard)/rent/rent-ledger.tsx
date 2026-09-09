'use client';

/**
 * Dense rent operator console: status filters, resident search, a scroll-bound
 * account ledger, evidence-backed collection watch, confirmed recent payments,
 * and the existing guarded record/waive/edit flows.
 */

import {
  ChartNoAxesCombined,
  Columns3,
  Ellipsis,
  MessageSquareText,
  PlugZap,
  Search,
  SlidersHorizontal,
  Sparkles,
  WalletCards,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from 'react';

import { RecordPaymentModal } from '@/components/rent/record-payment-modal';
import { WaiveRentModal } from '@/components/rent/waive-rent-modal';
import { StatusChip, type StatusChipTone } from '@/components/shared/status-chip';
import type {
  FacetSpec,
  RentFacetId,
  RentLedgerRow,
  RentStatus,
  RentSummary,
} from '@/lib/properties/mock-portfolio-views';
import type { RecentRentPayment } from '@/lib/rent/queries';

import { LeaseTermsEditor } from './lease-terms-editor';
import styles from './rent-console.module.css';

export interface RentLedgerProps {
  facets: readonly FacetSpec<RentFacetId>[];
  rows: readonly RentLedgerRow[];
  summary: RentSummary;
  recentPayments: readonly RecentRentPayment[];
  initialFacet?: RentFacetId;
  /** The global assistant is an owner-reserved capability. */
  canUseAssistant?: boolean;
}

export function rentAssistantHref(period: string, prompt: string): string {
  const query = `Rent context — ${period}: ${prompt.trim()}`;
  return `/assistant?q=${encodeURIComponent(query)}`;
}

const STATUS_RANK: Record<RentStatus, number> = {
  outstanding: 0,
  'on-plan': 1,
  paid: 2,
};

const STATUS_TONE: Record<RentStatus, StatusChipTone> = {
  paid: 'green',
  outstanding: 'clay',
  'on-plan': 'amber',
};

function matchesFacet(facet: RentFacetId, row: RentLedgerRow): boolean {
  switch (facet) {
    case 'all':
      return true;
    case 'paid':
      return row.statusPill.status === 'paid';
    case 'outstanding':
      return row.statusPill.status === 'outstanding';
    case 'on-plan':
      return row.statusPill.status === 'on-plan';
  }
}

function byExceptionFirst(rows: readonly RentLedgerRow[]): RentLedgerRow[] {
  return rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => {
      const rank = STATUS_RANK[a.row.statusPill.status] - STATUS_RANK[b.row.statusPill.status];
      return rank !== 0 ? rank : a.index - b.index;
    })
    .map(({ row }) => row);
}

function metric(summary: RentSummary, label: string): string {
  return summary.metrics.find((item) => item.label === label)?.value ?? '—';
}

function formatDollars(dollars: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: Number.isInteger(dollars) ? 0 : 2,
  }).format(dollars);
}

function formatCents(cents: number): string {
  return formatDollars(cents / 100);
}

function sumOutstanding(rows: readonly RentLedgerRow[]): number {
  return rows.reduce((total, row) => total + (row.outstandingDollars ?? 0), 0);
}

/** Deterministic display of a confirmed paid_at timestamp (timezone is explicit). */
function confirmedPaymentDate(iso: string): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return 'Confirmed';
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(parsed);
}

function paymentMethodLabel(method: string | null): string {
  if (method === 'card') return 'Card';
  if (method === 'us_bank_account') return 'ACH';
  return method ? method.replaceAll('_', ' ') : 'Method unavailable';
}

function rowEvidence(
  row: RentLedgerRow,
  payment: RecentRentPayment | undefined,
): { primary: string; secondary: string } {
  if (payment) {
    return {
      primary: `Paid ${confirmedPaymentDate(payment.paidAt)}`,
      secondary: `Confirmed · ${paymentMethodLabel(payment.paymentMethodType)}`,
    };
  }
  if (row.statusPill.label === 'Waived') {
    return { primary: 'Balance waived', secondary: 'Waiver audit on account' };
  }
  if (row.statusPill.status === 'paid') {
    return { primary: 'Balance settled', secondary: 'No payment time on ledger' };
  }
  if (row.statusPill.status === 'on-plan') {
    return { primary: 'Plan status recorded', secondary: 'Balance remains open' };
  }
  if (/escalated/i.test(row.statusPill.label)) {
    return { primary: 'Owner review required', secondary: 'No payment recorded' };
  }
  if (/overdue/i.test(row.statusPill.label)) {
    return { primary: 'No payment recorded', secondary: 'Past due' };
  }
  return { primary: 'Awaiting payment', secondary: 'No payment recorded' };
}

interface WatchGroupProps {
  label: string;
  rows: readonly RentLedgerRow[];
  dotClass: string;
  emptyLabel?: string;
}

function WatchGroup({ label, rows, dotClass, emptyLabel }: WatchGroupProps) {
  const names = rows
    .slice(0, 2)
    .map((row) => `${row.tenantName} · ${row.unit}`)
    .join(', ');
  return (
    <div className={styles.watchGroup}>
      <div className={styles.watchLine}>
        <span className={`${styles.watchDot} ${dotClass}`} aria-hidden="true" />
        <span>
          {rows.length} {label}
        </span>
        <strong>{formatDollars(sumOutstanding(rows))}</strong>
      </div>
      <p className={styles.watchNames}>{names || emptyLabel || 'No accounts'}</p>
    </div>
  );
}

export function RentLedger({
  facets,
  rows,
  summary,
  recentPayments,
  initialFacet,
  canUseAssistant = false,
}: RentLedgerProps) {
  const router = useRouter();
  const ledgerRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState<RentFacetId>(initialFacet ?? 'all');
  const [search, setSearch] = useState('');
  const [showEvidence, setShowEvidence] = useState(true);
  const [detailsKey, setDetailsKey] = useState<string | null>(null);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [askValue, setAskValue] = useState('');

  const visible = useMemo(() => {
    const query = search.trim().toLowerCase();
    return byExceptionFirst(
      rows.filter((row) => {
        if (!matchesFacet(active, row)) return false;
        if (!query) return true;
        return [row.tenantName, row.property, row.unit, row.statusPill.label]
          .join(' ')
          .toLowerCase()
          .includes(query);
      }),
    );
  }, [active, rows, search]);

  const paymentsByEvent = useMemo(
    () =>
      new Map(
        recentPayments.flatMap((payment) =>
          payment.rentEventId ? [[payment.rentEventId, payment] as const] : [],
        ),
      ),
    [recentPayments],
  );

  const overdueRows = rows.filter(
    (row) =>
      row.statusPill.status === 'outstanding' &&
      /overdue|escalated/i.test(row.statusPill.label),
  );
  const dueRows = rows.filter(
    (row) =>
      row.statusPill.status === 'outstanding' &&
      !/overdue|escalated/i.test(row.statusPill.label),
  );
  const planRows = rows.filter((row) => row.statusPill.status === 'on-plan');

  function showOutstanding() {
    setActive('outstanding');
    setSearch('');
    ledgerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function askOdesa(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const query = askValue.trim();
    if (!query) return;
    router.push(rentAssistantHref(summary.period, query));
  }

  const gridClass = `${styles.tableGrid} ${showEvidence ? '' : styles.tableGridNoEvidence}`;

  return (
    <div className={styles.workspace}>
      <section
        className={styles.ledgerPanel}
        data-testid="rent-ledger"
        role="list"
        aria-label={`${summary.period} rent accounts`}
        ref={ledgerRef}
      >
        <div className={styles.ledgerToolbar}>
          <div
            className={styles.facetGroup}
            data-testid="filter-bar"
            role="group"
            aria-label="Rent status"
          >
            {facets.map((facet) => {
              const isActive = facet.id === active;
              return (
                <button
                  key={facet.id}
                  type="button"
                  className={`${styles.facetButton} ${isActive ? styles.facetActive : ''}`}
                  data-testid={`filter-btn-${facet.id}`}
                  aria-pressed={isActive}
                  onClick={() => setActive(facet.id)}
                >
                  {facet.label}
                  <span>{facet.count}</span>
                </button>
              );
            })}
          </div>

          <div className={styles.toolbarTools}>
            <button
              type="button"
              className={styles.toolButton}
              onClick={showOutstanding}
              aria-label="Show collection exceptions"
            >
              <SlidersHorizontal size={12} aria-hidden="true" />
              Exceptions
            </button>

            <details className={styles.columnsDetails}>
              <summary className={`${styles.toolButton} ${styles.columnsSummary}`}>
                <Columns3 size={12} aria-hidden="true" />
                Columns
              </summary>
              <div className={styles.columnsMenu}>
                <label>
                  <input
                    type="checkbox"
                    checked={showEvidence}
                    onChange={(event) => setShowEvidence(event.target.checked)}
                  />
                  Ledger evidence
                </label>
              </div>
            </details>

            <label className={styles.searchShell}>
              <Search size={12} aria-hidden="true" />
              <span className="sr-only">Search residents</span>
              <input
                className={styles.searchInput}
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search residents…"
                aria-label="Search residents"
              />
            </label>
          </div>
        </div>

        <div className={styles.tableViewport}>
          <div className={`${gridClass} ${styles.tableHeader}`} aria-hidden="true">
            <span>Resident / unit</span>
            <span className={styles.alignRight}>Amount</span>
            <span>Due date</span>
            <span>Status</span>
            {showEvidence ? <span>Ledger evidence</span> : null}
            <span className={styles.alignRight}>Actions</span>
          </div>

          {visible.length > 0 ? (
            visible.map((row) => {
              const key = `${row.propSlug}-${row.unitSlug}`;
              const detailsOpen = detailsKey === key;
              const editorOpen = editingKey === key;
              const isException = row.statusPill.status === 'outstanding';
              const isPlan = row.statusPill.status === 'on-plan';
              const canRecord =
                isException &&
                row.rentEventId &&
                row.leaseId &&
                (row.outstandingDollars ?? 0) > 0;
              const evidence = rowEvidence(
                row,
                row.rentEventId ? paymentsByEvent.get(row.rentEventId) : undefined,
              );

              return (
                <div
                  key={key}
                  className={styles.rowGroup}
                  role="listitem"
                  data-testid="rent-row"
                >
                  <div
                    className={`${gridClass} ${styles.tableRow} ${isException ? styles.exceptionRow : ''} ${isPlan ? styles.planRow : ''}`}
                  >
                    <div className={styles.identity}>
                      <span className={styles.avatar} aria-hidden="true">
                        {row.initial}
                      </span>
                      <Link
                        href={row.href}
                        className={styles.residentLink}
                        aria-label={`Open ${row.tenantName} at ${row.property}, ${row.unit}`}
                      >
                        <div className={styles.residentName}>{row.tenantName}</div>
                        <div className={styles.residentUnit}>
                          {row.property} · {row.unit}
                        </div>
                      </Link>
                    </div>

                    <div className={styles.amountCell}>{row.amount}</div>
                    <div
                      className={`${styles.dueCell} ${/late/i.test(row.when) ? styles.lateDue : ''}`}
                    >
                      {row.when}
                    </div>
                    <div>
                      <StatusChip
                        tone={STATUS_TONE[row.statusPill.status]}
                        label={row.statusPill.label}
                      />
                    </div>
                    {showEvidence ? (
                      <div className={styles.evidenceCell}>
                        <div className={styles.evidenceMain}>{evidence.primary}</div>
                        <div className={styles.evidenceSub}>{evidence.secondary}</div>
                      </div>
                    ) : null}
                    <div className={styles.rowActions}>
                      {canRecord ? (
                        <RecordPaymentModal
                          rentEventId={row.rentEventId!}
                          leaseId={row.leaseId!}
                          outstandingDollars={row.outstandingDollars ?? 0}
                          tenantName={row.tenantName}
                          unitLabel={`${row.property} · ${row.unit}`}
                          cycleLabel={summary.period}
                        />
                      ) : (
                        <Link href={row.href} className={styles.rowAction}>
                          Open account
                        </Link>
                      )}
                      <button
                        type="button"
                        className={styles.moreButton}
                        aria-label={`More actions for ${row.tenantName}`}
                        aria-expanded={detailsOpen}
                        onClick={() => {
                          setDetailsKey(detailsOpen ? null : key);
                          setEditingKey(null);
                        }}
                      >
                        <Ellipsis size={14} aria-hidden="true" />
                      </button>
                    </div>
                  </div>

                  {detailsOpen ? (
                    <div className={styles.rowTray}>
                      <Link href={row.href} className={styles.trayLink}>
                        Open account
                      </Link>
                      {row.leaseTerms ? (
                        <button
                          type="button"
                          className={styles.trayButton}
                          aria-expanded={editorOpen}
                          aria-label={`Edit lease terms for ${row.tenantName}`}
                          data-testid="rent-edit-terms-toggle"
                          onClick={() => setEditingKey(editorOpen ? null : key)}
                        >
                          {editorOpen ? 'Close terms' : 'Edit terms'}
                        </button>
                      ) : null}
                      {isException &&
                      row.rentEventId &&
                      row.leaseId &&
                      (row.outstandingDollars ?? 0) > 0 ? (
                        <WaiveRentModal
                          rentEventId={row.rentEventId}
                          leaseId={row.leaseId}
                          outstandingDollars={row.outstandingDollars ?? 0}
                          tenantName={row.tenantName}
                          unitLabel={`${row.property} · ${row.unit}`}
                          cycleLabel={summary.period}
                        />
                      ) : null}
                    </div>
                  ) : null}

                  {row.leaseTerms && editorOpen ? (
                    <div className={styles.editPanel}>
                      <LeaseTermsEditor
                        terms={row.leaseTerms}
                        tenantName={row.tenantName}
                        unitLabel={`${row.property} · ${row.unit}`}
                        onClose={() => setEditingKey(null)}
                      />
                    </div>
                  ) : null}
                </div>
              );
            })
          ) : (
            <div className={styles.emptyState} data-testid="rent-empty">
              {rows.length === 0
                ? `No rent billed for ${summary.period} yet.`
                : search.trim()
                  ? `No residents match “${search.trim()}”.`
                  : 'No rent accounts match this status.'}
            </div>
          )}
        </div>

        <footer className={styles.ledgerFooter}>
          <span className={styles.footerLabel}>
            Showing {visible.length} of {rows.length} accounts · {summary.period}
          </span>
          <div className={styles.footerTotals}>
            <span>Billed {metric(summary, 'Billed')}</span>
            <span>Collected {metric(summary, 'Collected')}</span>
            <span className={styles.footerOutstanding}>
              Outstanding {metric(summary, 'Outstanding')}
            </span>
          </div>
        </footer>
      </section>

      <aside className={styles.rail} aria-label="Rent collection context">
        <section className={styles.railCard}>
          <div className={styles.railHeader}>
            <h2 className={styles.railTitle}>Collection watch</h2>
            <button type="button" className={styles.railLink} onClick={showOutstanding}>
              View all
            </button>
          </div>
          <WatchGroup
            label="overdue"
            rows={overdueRows}
            dotClass={styles.dotOverdue}
            emptyLabel="No overdue accounts"
          />
          <WatchGroup
            label="outstanding"
            rows={dueRows}
            dotClass={styles.dotOutstanding}
            emptyLabel="Nothing else outstanding"
          />
          <WatchGroup
            label="on a plan"
            rows={planRows}
            dotClass={styles.dotPlan}
            emptyLabel="No payment plans recorded"
          />
        </section>

        <section className={styles.railCard}>
          <div className={styles.railHeader}>
            <h2 className={styles.railTitle}>Recent confirmed payments</h2>
            <button
              type="button"
              className={styles.railLink}
              onClick={() => setActive('paid')}
            >
              View paid
            </button>
          </div>
          {recentPayments.length > 0 ? (
            <div className={styles.paymentList}>
              {recentPayments.map((payment) => {
                const amount = formatCents(payment.amountCents);
                return (
                  <div className={styles.paymentRow} key={payment.id}>
                    <span className={styles.paymentAvatar} aria-hidden="true">
                      {payment.tenantName.charAt(0).toUpperCase() || '?'}
                    </span>
                    <div>
                      <div className={styles.paymentName}>{payment.tenantName}</div>
                      <div className={styles.paymentMeta}>
                        {confirmedPaymentDate(payment.paidAt)} ·{' '}
                        {paymentMethodLabel(payment.paymentMethodType)} · UTC
                      </div>
                    </div>
                    {payment.receiptUrl ? (
                      <a
                        href={payment.receiptUrl}
                        target="_blank"
                        rel="noreferrer"
                        className={styles.paymentAmount}
                        aria-label={`${amount} receipt for ${payment.tenantName}`}
                      >
                        {amount}
                      </a>
                    ) : (
                      <span className={styles.paymentAmount}>{amount}</span>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <p className={styles.emptyRail}>
              No confirmed payment timestamps are available. Paid ledger rows remain visible above.
            </p>
          )}
        </section>

        <section className={styles.railCard}>
          <div className={styles.railHeader}>
            <h2 className={styles.railTitle}>Quick actions</h2>
          </div>
          <div className={styles.quickGrid}>
            <button type="button" className={styles.quickButton} onClick={showOutstanding}>
              <WalletCards size={12} aria-hidden="true" />
              Review outstanding
            </button>
            {canUseAssistant ? (
              <Link
                href={rentAssistantHref(
                  summary.period,
                  'Draft reminders for overdue rent for owner review. Do not send them.',
                )}
                className={styles.quickLink}
              >
                <MessageSquareText size={12} aria-hidden="true" />
                Draft reminders
              </Link>
            ) : null}
            <Link href="/financials" className={styles.quickLink}>
              <ChartNoAxesCombined size={12} aria-hidden="true" />
              Open financials
            </Link>
            <Link href="/settings/integrations" className={styles.quickLink}>
              <PlugZap size={12} aria-hidden="true" />
              Payment setup
            </Link>
          </div>
          {canUseAssistant ? (
            <form className={styles.askForm} onSubmit={askOdesa}>
              <Sparkles size={12} aria-hidden="true" />
              <label className="sr-only" htmlFor="rent-quick-ask">
                Ask Odesa about rent
              </label>
              <input
                id="rent-quick-ask"
                className={styles.askInput}
                value={askValue}
                onChange={(event) => setAskValue(event.target.value)}
                placeholder="Ask Odesa about rent…"
                data-testid="ask-odesa-bar-input"
              />
              <button
                type="submit"
                className={styles.askButton}
                disabled={!askValue.trim()}
                data-testid="ask-odesa-bar-submit"
              >
                Ask
              </button>
            </form>
          ) : null}
        </section>
      </aside>
    </div>
  );
}
