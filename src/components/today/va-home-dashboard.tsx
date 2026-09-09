import Link from "next/link";

import { formatAgoPhrase } from "@/lib/today/format";
import type { VaHomeDeadline, VaHomeMetric } from "@/lib/today/va-presentation";
import type { QueueItem, QueueStatus, WatchSignal } from "@/types/today";

import styles from "./va-home-dashboard.module.css";

export interface VaHomeDashboardProps {
  userName: string | null;
  dateLabel: string;
  propertiesCount: number;
  tenantsCount: number;
  checkedAgoLabel: string;
  metrics: readonly VaHomeMetric[];
  queueItems: readonly QueueItem[];
  deadlines: readonly VaHomeDeadline[];
  watchSignals: readonly WatchSignal[];
  draftsSentToday: number;
  callsHandledToday: number;
  callsToday: number;
}

const STATUS_LABELS: Record<QueueStatus, string> = {
  review: "Review",
  draft: "Prepare",
  waiting: "Waiting",
  escalated: "Escalated",
  resolved: "Resolved",
};

function plural(count: number, singular: string): string {
  return count === 1 ? singular : `${singular}s`;
}

function evidenceHref(item: QueueItem): string | null {
  const href = item.sourceHref ?? item.primaryAction.handler;
  return href.startsWith("/") ? href : null;
}

function SingleTaskDossier({ item }: { item: QueueItem }) {
  const href = evidenceHref(item);
  const context = item.meta.filter((token) => token.trim().length > 0);
  const prompts = item.contextSuggestions.filter(
    (prompt) => prompt.trim().length > 0,
  );

  return (
    <article
      className={styles.singleDossier}
      data-testid="va-home-single-dossier"
      data-queue-id={item.id}
      aria-labelledby={`va-home-dossier-${item.id}`}
    >
      <header className={styles.dossierHero}>
        <div className={styles.dossierHeading}>
          <div className={styles.dossierTopline}>
            <span
              className={`va-home-status va-home-status--${item.status}`}
            >
              {STATUS_LABELS[item.status]}
            </span>
            <span className={styles.dossierTime}>
              {item.timestamp || "Timestamp unavailable"}
            </span>
          </div>
          <p className={styles.dossierEyebrow}>SELECTED TASK DOSSIER</p>
          <h3 id={`va-home-dossier-${item.id}`} className={styles.dossierTitle}>
            {item.title}
          </h3>
          {context.length > 0 ? (
            <ul className={styles.contextTokens} aria-label="Task context">
              {context.map((token, index) => (
                <li key={`${item.id}-dossier-meta-${index}`}>{token}</li>
              ))}
            </ul>
          ) : (
            <p className={styles.unavailable}>Record context unavailable</p>
          )}
        </div>

        <div className={styles.dossierActions} aria-label="Task actions">
          {href ? (
            <Link href={href} className={styles.evidenceAction}>
              {item.sourceLabel ?? "Inspect record"}
              <span aria-hidden="true"> →</span>
            </Link>
          ) : (
            <span className={styles.unavailable}>
              Evidence route unavailable
            </span>
          )}
        </div>
      </header>

      <div className={styles.briefGrid}>
        <section className={styles.briefPanel} aria-label="Preparation brief">
          <p className={styles.detailLabel}>WHAT TO PREPARE</p>
          <p className={styles.primaryDetail}>{item.recommendation}</p>
        </section>
        <section className={styles.briefPanel} aria-label="Queue reason">
          <p className={styles.detailLabel}>WHY THIS IS HERE</p>
          <p className={styles.detailCopy}>
            {item.reason || "A source reason was not returned for this task."}
          </p>
        </section>
      </div>

      <div className={styles.contextGrid}>
        <section aria-label="Handoff prompts">
          <p className={styles.detailLabel}>HANDOFF PROMPTS</p>
          {prompts.length > 0 ? (
            <ul className={styles.promptList}>
              {prompts.map((prompt) => (
                <li key={prompt}>{prompt}</li>
              ))}
            </ul>
          ) : (
            <p className={styles.detailCopy}>
              No task-specific prompts were returned.
            </p>
          )}
        </section>

        <section aria-label="Owner handoff boundary">
          <p className={styles.detailLabel}>OWNER HANDOFF BOUNDARY</p>
          <div className={styles.boundaryCopy}>
            <strong>{item.ownerRule ?? "Owner review required"}</strong>
            <span>
              {item.nextStep ??
                "No further action is available from this queue."}
            </span>
          </div>
          <p className={styles.waitingImpact}>
            <span>If it waits</span>
            {item.ifIgnored ||
              "No recorded impact is available for this task."}
          </p>
        </section>
      </div>
    </article>
  );
}

export function VaHomeDashboard({
  userName,
  dateLabel,
  propertiesCount,
  tenantsCount,
  checkedAgoLabel,
  metrics,
  queueItems,
  deadlines,
  watchSignals,
  draftsSentToday,
  callsHandledToday,
  callsToday,
}: VaHomeDashboardProps) {
  const displayName = userName?.trim() || null;
  const hasRecordedActivity =
    draftsSentToday > 0 || callsHandledToday > 0 || callsToday > 0;
  const queueMode =
    queueItems.length === 0
      ? "empty"
      : queueItems.length === 1
        ? "single"
        : "list";

  const activityRows = [
    {
      key: "drafts",
      label: "Drafts sent",
      context: "Draft records marked sent today",
      count: draftsSentToday,
      tone: "clay",
    },
    {
      key: "calls-handled",
      label: "Calls resolved without owner review",
      context: "Recorded resolution subset for today's calls",
      count: callsHandledToday,
      tone: "green",
    },
    {
      key: "calls-recorded",
      label: "Calls recorded",
      context: "Call records returned for today",
      count: callsToday,
      tone: "gold",
    },
  ] as const;

  return (
    <div className="va-home-root" data-testid="va-home-dashboard">
      <header className="va-home-welcome">
        <div className="va-home-welcome-copy">
          <p className="va-home-kicker">OPERATIONS ASSISTANT HOME</p>
          <h1 className="va-home-title">
            {displayName ? (
              <>
                Welcome back, <em>{displayName}</em>.
              </>
            ) : (
              <>
                Welcome to <em>your shift</em>.
              </>
            )}
          </h1>
          <p className="va-home-context">
            <span suppressHydrationWarning>{dateLabel}</span>
            <span aria-hidden="true">·</span>
            <span className="va-home-mono">{propertiesCount}</span>{" "}
            {plural(propertiesCount, "property")}
            <span aria-hidden="true">·</span>
            <span className="va-home-mono">{tenantsCount}</span>{" "}
            {plural(tenantsCount, "tenant")}
          </p>
        </div>

        <div className="va-home-freshness">
          <span className="va-home-live-dot" aria-hidden="true" />
          <span>Data current</span>
          <span aria-hidden="true">·</span>
          <span suppressHydrationWarning>
            {formatAgoPhrase("checked", checkedAgoLabel)}
          </span>
        </div>
      </header>

      <section className="va-home-summary" aria-label="Shift summary">
        <dl className="va-home-summary-grid">
          {metrics.map((metric) => (
            <div
              key={metric.key}
              className={`va-home-metric va-home-metric--${metric.tone}`}
              data-testid={`va-home-metric-${metric.key}`}
              data-active={metric.active ? "true" : "false"}
            >
              <dt className="va-home-metric-label">{metric.label}</dt>
              <dd className="va-home-metric-body">
                <span className="va-home-metric-value">{metric.value}</span>
                <span className="va-home-metric-detail">{metric.detail}</span>
              </dd>
            </div>
          ))}
        </dl>
      </section>

      <div className="va-home-main-grid">
        <section
          id="needs-escalation"
          className="va-home-queue"
          data-testid="va-home-priority-queue"
          data-queue-mode={queueMode}
          aria-labelledby="va-home-queue-title"
        >
          <div className="va-home-section-head va-home-queue-head">
            <div>
              <p className="va-home-section-kicker">NEEDS ATTENTION</p>
              <h2 id="va-home-queue-title" className="va-home-section-title">
                Operations Assistant priority queue
              </h2>
            </div>
            <div className="va-home-head-meta">
              <span className="va-home-count-chip">{queueItems.length}</span>
              <span>inspect · prepare · hand off</span>
            </div>
          </div>

          {queueItems.length === 0 ? (
            <div className="va-home-empty" data-testid="va-home-queue-empty">
              <strong>The current priority queue is clear.</strong>
              <span>No attention items were returned for this shift.</span>
            </div>
          ) : queueItems.length === 1 ? (
            <SingleTaskDossier item={queueItems[0]} />
          ) : (
            <ol className="va-home-queue-list">
              {queueItems.map((item) => {
                const href = evidenceHref(item);
                return (
                  <li
                    key={item.id}
                    className="va-home-queue-row"
                    data-testid="va-home-queue-row"
                    data-queue-id={item.id}
                  >
                    <div className="va-home-row-status">
                      <span
                        className={`va-home-status va-home-status--${item.status}`}
                      >
                        {STATUS_LABELS[item.status]}
                      </span>
                    </div>

                    <div className="va-home-row-body">
                      <h3 className="va-home-row-title">{item.title}</h3>
                      {item.meta.length > 0 ? (
                        <p className="va-home-row-context">
                          {item.meta.map((token, index) => (
                            <span key={`${item.id}-meta-${index}`}>
                              {index > 0 ? (
                                <span aria-hidden="true"> · </span>
                              ) : null}
                              {token}
                            </span>
                          ))}
                        </p>
                      ) : (
                        <p className="va-home-row-context">
                          Record context unavailable
                        </p>
                      )}
                      <p className="va-home-row-brief">{item.recommendation}</p>
                      <p className="va-home-row-boundary">
                        <span>{item.ownerRule ?? "Owner review required"}</span>
                        {item.nextStep ? <span>{item.nextStep}</span> : null}
                      </p>
                    </div>

                    <div className="va-home-row-evidence">
                      <span className="va-home-row-time">
                        {item.timestamp || "Timestamp unavailable"}
                      </span>
                      {href ? (
                        <Link href={href} className="va-home-evidence-link">
                          {item.sourceLabel ?? "Inspect record"}
                          <span aria-hidden="true"> →</span>
                        </Link>
                      ) : (
                        <span className="va-home-route-unavailable">
                          Evidence route unavailable
                        </span>
                      )}
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        </section>

        <aside
          className="va-home-assistant"
          aria-labelledby="va-home-assistant-title"
        >
          <div className="va-home-assistant-mark" aria-hidden="true">
            o
          </div>
          <p className="va-home-section-kicker">HANDOFF BOUNDARY</p>
          <h2 id="va-home-assistant-title" className="va-home-section-title">
            Work from the recorded evidence
          </h2>
          <p className="va-home-assistant-summary">
            {queueItems.length > 0
              ? `${queueItems.length} ${plural(queueItems.length, "item")} in the current queue. Open each source record and separate known facts from missing context for the owner.`
              : "The current queue is clear. Record any new source evidence before preparing an owner handoff."}
          </p>

          <div className="va-home-boundary-note">
            <span className="va-home-boundary-dot" aria-hidden="true" />
            <p>
              <strong>Operations Assistant workspace boundary</strong>
              Tenant, money, lease, and vendor-facing decisions remain with the
              owner.
            </p>
          </div>
        </aside>
      </div>

      <div className="va-home-lower-grid" data-testid="va-home-lower-modules">
        <section
          className="va-home-module va-home-module--schedule"
          data-testid="va-home-schedule"
          aria-labelledby="va-home-schedule-title"
        >
          <header className="va-home-module-head">
            <div>
              <p className="va-home-section-kicker">PORTFOLIO DEADLINES</p>
              <h2 id="va-home-schedule-title">Today’s schedule</h2>
              <p>Lease endings and move-ins · next 7 days</p>
            </div>
            <span
              className="va-home-module-count"
              aria-label={`${deadlines.length} ${plural(deadlines.length, "deadline")} in the next 7 days`}
            >
              {deadlines.length}
            </span>
          </header>

          <div className="va-home-module-scope">
            <span className="va-home-module-dot" aria-hidden="true" />
            <p>
              Portfolio deadlines only. Calendar events are not included in this
              view.
            </p>
          </div>

          {deadlines.length === 0 ? (
            <div
              className="va-home-module-empty"
              data-testid="va-home-schedule-empty"
            >
              <strong>No portfolio deadlines in this window.</strong>
              <span>
                No lease endings or move-ins were returned for the next 7 days.
              </span>
            </div>
          ) : (
            <ul className="va-home-module-list" aria-label="Upcoming deadlines">
              {deadlines.map((deadline) => (
                <li
                  key={deadline.id}
                  className="va-home-schedule-row"
                  data-testid="va-home-schedule-row"
                >
                  <time dateTime={deadline.dateIso}>{deadline.dateLabel}</time>
                  <span className="va-home-module-row-copy">
                    <strong>{deadline.title}</strong>
                    <span>
                      {deadline.context ?? "Unit context unavailable"}
                    </span>
                  </span>
                  <span className="va-home-deadline-kind">
                    {deadline.label}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section
          className="va-home-module va-home-module--activity"
          data-testid="va-home-activity"
          aria-labelledby="va-home-activity-title"
        >
          <header className="va-home-module-head">
            <div>
              <p className="va-home-section-kicker">RECORDED TODAY</p>
              <h2 id="va-home-activity-title">Recent activity</h2>
              <p>Current draft and call aggregates</p>
            </div>
            <span className="va-home-module-status">CURRENT</span>
          </header>

          <div className="va-home-module-scope">
            <span className="va-home-module-dot" aria-hidden="true" />
            <p>
              Counts are current aggregates. Event-level timestamps are not
              available in this view.
            </p>
          </div>

          {hasRecordedActivity ? (
            <ul
              className="va-home-module-list"
              aria-label="Recorded activity counts"
            >
              {activityRows.map((activity) => (
                <li
                  key={activity.key}
                  className="va-home-activity-row"
                  data-testid={`va-home-activity-${activity.key}`}
                >
                  <span
                    className={`va-home-activity-mark va-home-activity-mark--${activity.tone}`}
                    aria-hidden="true"
                  />
                  <span className="va-home-module-row-copy">
                    <strong>{activity.label}</strong>
                    <span>{activity.context}</span>
                  </span>
                  <span className="va-home-activity-count">
                    <strong>{activity.count}</strong>
                    <span>today</span>
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <div
              className="va-home-module-empty"
              data-testid="va-home-activity-empty"
            >
              <strong>No recent activity recorded.</strong>
              <span>No draft or call activity is recorded today.</span>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
