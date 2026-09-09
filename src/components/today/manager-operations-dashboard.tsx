'use client';

import Link from 'next/link';
import { useState } from 'react';

import { formatAgoPhrase } from '@/lib/today/format';
import type { QueueItem, QueueStatus } from '@/types/today';

import styles from './manager-operations-dashboard.module.css';

const MAX_QUEUE_ROWS = 5;

const STATUS_LABELS: Record<QueueStatus, string> = {
  review: 'Review',
  draft: 'Draft',
  waiting: 'Waiting',
  escalated: 'Escalated',
  resolved: 'Resolved',
};

export interface ManagerOperationsDashboardProps {
  dateLabel: string;
  propertiesCount: number;
  tenantsCount: number;
  checkedAgoLabel: string;
  queueItems: readonly QueueItem[];
}

type DetailKind = 'work-order' | 'rent' | 'operational';

function sourceHref(item: QueueItem): string | null {
  const href = item.sourceHref ?? item.primaryAction.handler;
  return href.startsWith('/') ? href : null;
}

function detailKind(item: QueueItem): DetailKind {
  const sourceLabel = item.sourceLabel?.toLowerCase() ?? '';
  if (sourceLabel.includes('work order')) return 'work-order';
  if (item.channel === 'rent' || sourceLabel.includes('ledger')) return 'rent';
  return 'operational';
}

function detailEyebrow(kind: DetailKind): string {
  if (kind === 'work-order') return 'WORK ORDER DOSSIER';
  if (kind === 'rent') return 'RENT OPERATIONAL DETAIL';
  return 'OPERATIONAL DETAIL';
}

function queueCountLabel(count: number): string {
  return `${count} current ${count === 1 ? 'row' : 'rows'}`;
}

function SummaryMetric({
  label,
  value,
  detail,
  tone,
}: {
  label: string;
  value: number;
  detail: string;
  tone: 'clay' | 'gold' | 'green' | 'navy';
}) {
  const quiet = value === 0;

  return (
    <div
      className={`${styles.summaryMetric} ${quiet ? styles.summaryMetricQuiet : ''}`}
      data-summary-value={value}
    >
      <p className={styles.metricLabel}>
        <span className={`${styles.metricDot} ${styles[`metricDot${tone}`]}`} />
        {label}
      </p>
      <p className={styles.metricValue}>{value}</p>
      <p className={styles.metricDetail}>{detail}</p>
    </div>
  );
}

function QueueRow({
  item,
  selected,
  onSelect,
}: {
  item: QueueItem;
  selected: boolean;
  onSelect: () => void;
}) {
  const href = sourceHref(item);

  return (
    <li
      className={`${styles.queueRow} ${selected ? styles.queueRowSelected : ''}`}
      data-testid="manager-queue-row"
      data-selected={selected ? 'true' : 'false'}
    >
      <button
        type="button"
        className={styles.rowSelect}
        onClick={onSelect}
        aria-pressed={selected}
        aria-label={`Select ${item.title}`}
      >
        <span className={styles.rowMain}>
          <span className={styles.rowTitle}>{item.title}</span>
          {item.meta.length > 0 ? (
            <span className={styles.rowMeta}>{item.meta.join(' · ')}</span>
          ) : (
            <span className={styles.rowMeta}>No additional context returned</span>
          )}
          <span className={styles.rowRecommendation}>{item.recommendation}</span>
          <span className={styles.rowBoundary}>
            {item.ownerRule || 'Current review boundary applies'}
          </span>
        </span>
        <span className={styles.rowFacts}>
          <span
            className={`${styles.statusPill} ${styles[`status${item.status}`]}`}
          >
            {STATUS_LABELS[item.status]}
          </span>
          <span className={styles.rowTime}>
            {item.timestamp || 'Time unavailable'}
          </span>
        </span>
      </button>
      {href ? (
        <Link
          href={href}
          className={styles.rowLink}
          aria-label={`Inspect source record for ${item.title}`}
        >
          Inspect <span aria-hidden="true">→</span>
        </Link>
      ) : (
        <span className={styles.routeUnavailable}>Route unavailable</span>
      )}
    </li>
  );
}

function DetailPanel({
  item,
  queueItems,
  onSelect,
}: {
  item: QueueItem | null;
  queueItems: readonly QueueItem[];
  onSelect: (id: string) => void;
}) {
  if (!item) {
    return (
      <section
        className={`${styles.panel} ${styles.equalHeightPanel}`}
        data-testid="manager-operation-detail"
        data-equal-height-panel="true"
        aria-labelledby="manager-detail-title"
      >
        <header className={styles.panelHeader}>
          <p className={styles.eyebrow}>OPERATIONAL DETAIL</p>
          <h2 id="manager-detail-title" className={styles.panelTitle}>
            No selected item
          </h2>
        </header>
        <div className={`${styles.detailScroll} ${styles.emptyDetail}`}>
          <span className={styles.emptyMark} aria-hidden="true" />
          <p>No priority rows were returned for this shift.</p>
          <span>The detail ledger will remain empty until a real row exists.</span>
        </div>
      </section>
    );
  }

  const kind = detailKind(item);
  const href = sourceHref(item);
  const remainingItems = queueItems.filter((candidate) => candidate.id !== item.id);

  return (
    <section
      className={`${styles.panel} ${styles.equalHeightPanel}`}
      data-testid="manager-operation-detail"
      data-equal-height-panel="true"
      data-detail-kind={kind}
      aria-labelledby={`manager-detail-${item.id}`}
    >
      <header className={styles.detailHeader}>
        <div>
          <p className={styles.eyebrow}>{detailEyebrow(kind)}</p>
          <h2 id={`manager-detail-${item.id}`} className={styles.detailTitle}>
            {item.title}
          </h2>
        </div>
        <span
          className={`${styles.statusPill} ${styles[`status${item.status}`]}`}
        >
          {STATUS_LABELS[item.status]}
        </span>
      </header>

      <div className={styles.detailScroll} data-testid="manager-detail-scroll">
        <section className={styles.detailSection}>
          <p className={styles.detailLabel}>1 · CURRENT STATE</p>
          <p className={styles.detailLead}>{item.recommendation}</p>
        </section>

        <section className={styles.detailSection}>
          <p className={styles.detailLabel}>2 · KNOWN CONTEXT</p>
          {item.meta.length > 0 ? (
            <ul className={styles.contextList} aria-label="Known context">
              {item.meta.map((token, index) => (
                <li key={`${item.id}-context-${index}`}>{token}</li>
              ))}
            </ul>
          ) : (
            <p className={styles.unavailable}>No additional context returned.</p>
          )}
        </section>

        <section className={styles.detailSection}>
          <p className={styles.detailLabel}>3 · QUEUE EVIDENCE</p>
          <p className={styles.detailCopy}>
            {item.reason || 'No queue reason was returned for this item.'}
          </p>
        </section>

        <section className={styles.detailSection}>
          <p className={styles.detailLabel}>4 · RECORDED TIME ANCHOR</p>
          <time className={styles.recordedTime}>
            {item.timestamp || 'Time unavailable'}
          </time>
        </section>

        <div className={styles.detailTwoUp}>
          <section className={styles.detailSection}>
            <p className={styles.detailLabel}>5 · OPERATOR BOUNDARY</p>
            <p className={styles.boundaryTitle}>
              {item.ownerRule || 'No owner boundary label was returned.'}
            </p>
            <p className={styles.detailCopy}>
              {item.nextStep || 'No next-step boundary was returned.'}
            </p>
          </section>

          <section className={styles.detailSection}>
            <p className={styles.detailLabel}>6 · AVAILABLE ROUTE</p>
            {href ? (
              <Link href={href} className={styles.primaryLink}>
                Inspect source record <span aria-hidden="true">→</span>
              </Link>
            ) : (
              <p className={styles.unavailable}>No source route was returned.</p>
            )}
          </section>
        </div>

        <section className={styles.detailSection}>
          <p className={styles.detailLabel}>7 · IF IT WAITS</p>
          <p className={styles.detailCopy}>
            {item.ifIgnored || 'No recorded waiting impact was returned.'}
          </p>
        </section>

        <section className={`${styles.detailSection} ${styles.remainingShift}`}>
          <div className={styles.remainingShiftHeader}>
            <div>
              <p className={styles.detailLabel}>8 · REMAINING SHIFT</p>
              <p className={styles.remainingShiftCopy}>
                Other current rows in this priority scope.
              </p>
            </div>
            <span className={styles.remainingCount}>{remainingItems.length} LEFT</span>
          </div>
          {remainingItems.length > 0 ? (
            <div className={styles.remainingList}>
              {remainingItems.map((candidate) => (
                <button
                  key={candidate.id}
                  type="button"
                  className={styles.remainingItem}
                  onClick={() => onSelect(candidate.id)}
                  data-testid="manager-remaining-item"
                  aria-label={`Select ${candidate.title} from remaining shift`}
                >
                  <span>
                    <strong>{candidate.title}</strong>
                    <small>{candidate.meta.slice(0, 2).join(' · ') || 'No additional context returned'}</small>
                  </span>
                  <span className={styles.remainingItemState}>
                    {STATUS_LABELS[candidate.status]} · {candidate.timestamp || 'Time unavailable'}
                  </span>
                </button>
              ))}
            </div>
          ) : (
          <p className={styles.unavailable}>No other current rows are in this shift.</p>
          )}
        </section>
      </div>
    </section>
  );
}

export function ManagerOperationsDashboard({
  dateLabel,
  propertiesCount,
  tenantsCount,
  checkedAgoLabel,
  queueItems,
}: ManagerOperationsDashboardProps) {
  const visibleItems = queueItems.slice(0, MAX_QUEUE_ROWS);
  const [selectedId, setSelectedId] = useState<string | null>(
    visibleItems[0]?.id ?? null,
  );
  const selectedItem =
    visibleItems.find((item) => item.id === selectedId) ??
    visibleItems[0] ??
    null;
  const workOrderCount = visibleItems.filter(
    (item) => detailKind(item) === 'work-order',
  ).length;
  const rentCount = visibleItems.filter(
    (item) => detailKind(item) === 'rent',
  ).length;
  const otherCount = visibleItems.length - workOrderCount - rentCount;

  return (
    <div className={styles.root} data-testid="manager-operations-dashboard">
      <header className={styles.intro}>
        <div>
          <p className={styles.kicker}>OPERATIONS · SHIFT DESK</p>
          <h1 className={styles.pageTitle}>Your operating shift</h1>
          <p className={styles.pageDeck}>
            A finite ledger of current items that need inspection or owner
            attention.
          </p>
        </div>
        <dl className={styles.scope} aria-label="Current shift scope">
          <div>
            <dt>DATE</dt>
            <dd>{dateLabel}</dd>
          </div>
          <div>
            <dt>SCOPE</dt>
            <dd>
              {propertiesCount} {propertiesCount === 1 ? 'property' : 'properties'}
              {' · '}
              {tenantsCount} {tenantsCount === 1 ? 'tenant' : 'tenants'}
            </dd>
          </div>
          <div>
            <dt>FRESHNESS</dt>
            <dd>{formatAgoPhrase('Refreshed', checkedAgoLabel)}</dd>
          </div>
        </dl>
      </header>

      <section
        className={styles.summary}
        data-testid="manager-operations-summary"
        aria-labelledby="manager-summary-title"
      >
        <div className={styles.summaryIntro}>
          <p className={styles.eyebrow}>OPERATIONS SUMMARY</p>
          <h2 id="manager-summary-title">Returned priority scope</h2>
          <p>Counts describe only the current rows shown below.</p>
        </div>
        <div className={styles.summaryGrid}>
          <SummaryMetric
            label="CURRENT QUEUE"
            value={visibleItems.length}
            detail="Up to five returned rows"
            tone="clay"
          />
          <SummaryMetric
            label="WORK ORDER ROWS"
            value={workOrderCount}
            detail="Explicitly linked work orders"
            tone="gold"
          />
          <SummaryMetric
            label="RENT ROWS"
            value={rentCount}
            detail="Current rent exceptions"
            tone="green"
          />
          <SummaryMetric
            label="OTHER ROWS"
            value={otherCount}
            detail="Other operational items"
            tone="navy"
          />
        </div>
      </section>

      <div
        className={styles.workspace}
        data-testid="manager-operations-workspace"
        data-equal-height-desktop="true"
      >
        <section
          className={`${styles.panel} ${styles.equalHeightPanel}`}
          data-testid="manager-priority-queue"
          data-equal-height-panel="true"
          aria-labelledby="manager-queue-title"
        >
          <header className={styles.panelHeader}>
            <div>
              <p className={styles.eyebrow}>OPERATIONAL LEDGER</p>
              <h2 id="manager-queue-title" className={styles.panelTitle}>
                Today’s priority queue
              </h2>
            </div>
            <p className={styles.queueCount}>{queueCountLabel(visibleItems.length)}</p>
          </header>

          <div className={styles.queueColumns} aria-hidden="true">
            <span>ITEM / CONTEXT</span>
            <span>STATE / AGE</span>
            <span>NEXT MOVE</span>
          </div>

          <div className={styles.queueScroll} data-testid="manager-queue-scroll">
            {visibleItems.length > 0 ? (
              <ol className={styles.queueList}>
                {visibleItems.map((item) => (
                  <QueueRow
                    key={item.id}
                    item={item}
                    selected={item.id === selectedItem?.id}
                    onSelect={() => setSelectedId(item.id)}
                  />
                ))}
              </ol>
            ) : (
              <div className={styles.emptyQueue} data-testid="manager-queue-empty">
                <span className={styles.emptyMark} aria-hidden="true" />
                <p>No priority rows were returned for this shift.</p>
                <span>Nothing is being inferred beyond the current queue.</span>
              </div>
            )}
          </div>
        </section>

        <DetailPanel
          item={selectedItem}
          queueItems={visibleItems}
          onSelect={setSelectedId}
        />
      </div>
    </div>
  );
}
