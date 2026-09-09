import { ArrowUpRight, Check, LockKeyhole } from "lucide-react";
import Link from "next/link";

import styles from "@/components/today/va-escalations-desk.module.css";
import type { DraftDetail } from "@/components/inbox/types";
import type { QueueItem, QueueStatus } from "@/types/today";

export interface VaEscalationsDeskProps {
  items: readonly QueueItem[];
  referencedProposal?: DraftDetail | null;
  referencedProposalRequested?: boolean;
}

const STATUS_LABELS: Record<QueueStatus, string> = {
  review: "Review",
  draft: "Prepare",
  waiting: "Waiting",
  escalated: "Escalated",
  resolved: "Resolved",
};

const CHANNEL_LABELS: Record<QueueItem["channel"], string> = {
  lease: "Lease",
  maintenance: "Maintenance",
  rent: "Rent",
  inbox: "Inbox",
  vendor: "Vendor",
  documents: "Documents",
};

function evidenceHref(item: QueueItem): string | null {
  const href = item.sourceHref ?? item.primaryAction.handler;
  return href.startsWith("/") ? href : null;
}

export function VaEscalationsDesk({
  items,
  referencedProposal = null,
  referencedProposalRequested = false,
}: VaEscalationsDeskProps) {
  const ownerBoundCount = items.filter((item) => item.ownerRule).length;
  const linkedSourceCount = items.filter((item) => evidenceHref(item)).length;
  const leadItem = items[0] ?? null;
  const leadHref = leadItem ? evidenceHref(leadItem) : null;
  return (
    <div className={styles.surface}>
      <div className={styles.desk} data-testid="va-escalations-desk">
        <header className={styles.hero}>
          <div>
            <p className={styles.kicker}>OWNER HANDOFFS</p>
            <h1 className={styles.title}>
              Escalation <em>desk</em>.
            </h1>
            <p className={styles.subtitle}>
              Owner-bound handoffs and unresolved operational exceptions.
            </p>
          </div>
          <div
            className={styles.liveState}
            aria-label={`${items.length} active escalations`}
          >
            <span className={styles.liveDot} aria-hidden="true" />
            <span className={styles.mono}>{items.length}</span>
            <span>
              {items.length === 1 ? "active escalation" : "active escalations"}
            </span>
          </div>
        </header>

        <dl className={styles.metrics} aria-label="Escalation summary">
          <div className={styles.metric} data-tone="clay">
            <dt className={styles.metricLabel}>Open escalations</dt>
            <dd className={styles.metricBody}>
              <span className={styles.metricValue}>{items.length}</span>
              <span className={styles.metricDetail}>Finite handoff queue</span>
            </dd>
          </div>
          <div className={styles.metric} data-tone="gold">
            <dt className={styles.metricLabel}>Awaiting owner</dt>
            <dd className={styles.metricBody}>
              <span className={styles.metricValue}>{ownerBoundCount}</span>
              <span className={styles.metricDetail}>
                Decision stays with owner
              </span>
            </dd>
          </div>
          <div className={styles.metric} data-tone="green">
            <dt className={styles.metricLabel}>Source records</dt>
            <dd className={styles.metricBody}>
              <span className={styles.metricValue}>{linkedSourceCount}</span>
              <span className={styles.metricDetail}>
                Inspectable evidence links
              </span>
            </dd>
          </div>
          <div className={styles.metric} data-tone="quiet">
            <dt className={styles.metricLabel}>Workspace authority</dt>
            <dd className={styles.metricBody}>
              <span className={styles.metricValue}>Read</span>
              <span className={styles.metricDetail}>
                Prepare context, do not commit
              </span>
            </dd>
          </div>
        </dl>

        {referencedProposalRequested ? (
          <section
            className={styles.proposalReference}
            data-testid="va-referenced-proposal"
            aria-labelledby="va-referenced-proposal-title"
          >
            <header className={styles.proposalReferenceHead}>
              <div>
                <p className={styles.sectionKicker}>REFERENCED CALL PROPOSAL</p>
                <h2
                  id="va-referenced-proposal-title"
                  className={styles.sectionTitle}
                >
                  {referencedProposal?.draftType ??
                    "Referenced proposal unavailable"}
                </h2>
              </div>
              <span className={styles.referenceState}>Read only</span>
            </header>
            {referencedProposal ? (
              <div className={styles.proposalReferenceGrid}>
                <div>
                  <p className={styles.contextLabel}>Recipient context</p>
                  <p className={styles.referencePrimary}>
                    {referencedProposal.recipient}
                  </p>
                  <p className={styles.referenceSecondary}>
                    {[
                      referencedProposal.tenant.property,
                      referencedProposal.tenant.unit,
                      referencedProposal.draftedAt,
                    ]
                      .filter(Boolean)
                      .join(" · ") || "No additional context recorded"}
                  </p>
                </div>
                <div>
                  <p className={styles.contextLabel}>Recorded reasoning</p>
                  <p className={styles.referencePrimary}>
                    {referencedProposal.reasoning ||
                      "No reasoning was recorded on this proposal."}
                  </p>
                </div>
                <div>
                  <p className={styles.contextLabel}>Prepared content</p>
                  <p className={styles.referencePrimary}>
                    {referencedProposal.smsBody ||
                      "No prepared message body was recorded."}
                  </p>
                </div>
              </div>
            ) : (
              <p className={styles.referenceUnavailable}>
                This proposal is missing or is not visible to the current
                workspace. No alternate record was substituted.
              </p>
            )}
            <footer className={styles.proposalBoundary}>
              Prepare an owner handoff from this source context. Approval,
              editing, rejection, and sending remain with the owner.
            </footer>
          </section>
        ) : null}

        <div className={styles.workspace}>
          <div className={styles.leftColumn}>
            <section
              className={styles.ledger}
              aria-labelledby="va-escalations-title"
            >
              <header className={styles.ledgerHead}>
                <div>
                  <p className={styles.sectionKicker}>ESCALATION QUEUE</p>
                  <h2 id="va-escalations-title" className={styles.sectionTitle}>
                    Owner handoffs requiring review
                  </h2>
                  <p className={styles.sectionDescription}>
                    Sorted by the order returned from the current urgent-items
                    query.
                  </p>
                </div>
                <div className={styles.headMeta}>
                  <span className={styles.countChip}>{items.length}</span>
                  <span>inspect · document · hand off</span>
                </div>
              </header>

              <div className={styles.tableHeader} aria-hidden="true">
                <span>State</span>
                <span>Escalation and context</span>
                <span>Category</span>
                <span>Owner boundary</span>
                <span>Evidence</span>
              </div>

              {items.length === 0 ? (
                <div
                  className={styles.empty}
                  data-testid="va-escalations-empty"
                >
                  <strong>No active escalations.</strong>
                  <span>
                    No owner-bound handoffs were returned for this workspace.
                  </span>
                </div>
              ) : (
                <ol className={styles.list}>
                  {items.map((item) => {
                    const href = evidenceHref(item);
                    return (
                      <li
                        key={item.id}
                        className={styles.row}
                        data-testid="va-escalation-row"
                      >
                        <div className={styles.rowStatus}>
                          <span
                            className={styles.status}
                            data-status={item.status}
                          >
                            {STATUS_LABELS[item.status]}
                          </span>
                        </div>

                        <div className={styles.rowMain}>
                          <h3 className={styles.rowTitle}>{item.title}</h3>
                          <p className={styles.rowMeta}>
                            {item.meta.join(" · ") ||
                              "Record context unavailable"}
                          </p>
                          <p className={styles.rowRecommendation}>
                            {item.recommendation}
                          </p>
                        </div>

                        <div className={`${styles.cell} ${styles.channelCell}`}>
                          <span className={styles.cellPrimary}>
                            {CHANNEL_LABELS[item.channel]}
                          </span>
                          <span className={styles.cellSecondary}>
                            {item.property || "Property unavailable"}
                          </span>
                        </div>

                        <div className={`${styles.cell} ${styles.ownerCell}`}>
                          <span className={styles.ownerState}>
                            {item.ownerRule ?? "Owner review required"}
                          </span>
                        </div>

                        <div
                          className={`${styles.actionCell} ${styles.timestampCell}`}
                        >
                          {href ? (
                            <Link href={href} className={styles.evidenceLink}>
                              <span>
                                {item.sourceLabel ?? "Inspect record"}
                              </span>
                              <ArrowUpRight
                                size={12}
                                strokeWidth={1.8}
                                aria-hidden="true"
                              />
                            </Link>
                          ) : (
                            <span className={styles.routeUnavailable}>
                              Evidence route unavailable
                            </span>
                          )}
                          <span className={styles.timestamp}>
                            {item.timestamp || "Time unavailable"}
                          </span>
                        </div>
                      </li>
                    );
                  })}
                </ol>
              )}
            </section>

            <section
              className={styles.handoffBrief}
              aria-labelledby="current-handoff-title"
              data-testid="va-current-handoff"
            >
              <header className={styles.briefHead}>
                <div>
                  <p className={styles.sectionKicker}>CURRENT HANDOFF</p>
                  <h2 id="current-handoff-title" className={styles.briefTitle}>
                    {leadItem ? leadItem.title : "No escalation selected"}
                  </h2>
                  <p className={styles.sectionDescription}>
                    Owner-ready context assembled from the selected queue
                    record.
                  </p>
                </div>
                {leadHref ? (
                  <Link href={leadHref} className={styles.evidenceLink}>
                    <span>{leadItem?.sourceLabel ?? "Inspect source"}</span>
                    <ArrowUpRight
                      size={12}
                      strokeWidth={1.8}
                      aria-hidden="true"
                    />
                  </Link>
                ) : (
                  <span className={styles.routeUnavailable}>
                    Evidence route unavailable
                  </span>
                )}
              </header>

              <div className={styles.briefGrid}>
                <article className={styles.briefBlock}>
                  <p className={styles.contextLabel}>Known context</p>
                  <p className={styles.briefPrimary}>
                    {leadItem?.meta.join(" · ") ||
                      "No active escalation context was returned."}
                  </p>
                  <p className={styles.briefSecondary}>
                    {leadItem?.reason ??
                      "This item is present because it was returned by the current urgent-items query."}
                  </p>
                </article>

                <article className={styles.briefBlock}>
                  <p className={styles.contextLabel}>Prepared recommendation</p>
                  <p className={styles.briefPrimary}>
                    {leadItem?.recommendation ??
                      "No recommendation is needed while the queue is clear."}
                  </p>
                  <p className={styles.briefSecondary}>
                    Recommendation only. The owner retains the decision.
                  </p>
                </article>

                <article className={styles.briefBlock}>
                  <p className={styles.contextLabel}>Owner boundary</p>
                  <p className={styles.briefPrimary}>
                    {leadItem?.ownerRule ??
                      "No owner decision is currently pending."}
                  </p>
                  <p className={styles.briefSecondary}>
                    No tenant message, vendor dispatch, money action, or lease
                    decision happens here.
                  </p>
                </article>

                <article className={styles.briefBlock}>
                  <p className={styles.contextLabel}>Next step</p>
                  <p className={styles.briefPrimary}>
                    {leadItem?.nextStep ??
                      "No escalation follow-up is required."}
                  </p>
                  <p className={styles.briefSecondary}>
                    {leadItem?.ifIgnored ??
                      "No additional consequence is recorded on this item."}
                  </p>
                </article>
              </div>

              <footer className={styles.briefFooter}>
                <span className={styles.boundaryDot} aria-hidden="true" />
                <p>
                  <strong>Handoff state</strong>
                  {leadItem
                    ? "Evidence is available for inspection. Context may be prepared, but commitment remains locked."
                    : "The escalation queue is clear. No owner handoff needs preparation."}
                </p>
              </footer>
            </section>
          </div>

          <aside
            className={styles.rail}
            aria-label="Escalation preparation tools"
          >
            <section
              className={styles.railCard}
              aria-labelledby="handoff-workflow-title"
            >
              <p className={styles.sectionKicker}>HANDOFF WORKFLOW</p>
              <h2 id="handoff-workflow-title" className={styles.sectionTitle}>
                Prepare, do not decide
              </h2>
              <ol className={styles.workflowList}>
                <li className={styles.workflowStep} data-state="complete">
                  <span className={styles.stepNumber} aria-hidden="true">
                    <Check size={12} />
                  </span>
                  <span className={styles.stepCopy}>
                    <strong>Inspect the source</strong>
                    <span>Validate the facts already on record.</span>
                  </span>
                </li>
                <li className={styles.workflowStep} data-state="active">
                  <span className={styles.stepNumber}>2</span>
                  <span className={styles.stepCopy}>
                    <strong>Document context</strong>
                    <span>Capture gaps and open questions.</span>
                  </span>
                </li>
                <li className={styles.workflowStep} data-state="pending">
                  <span className={styles.stepNumber}>3</span>
                  <span className={styles.stepCopy}>
                    <strong>Prepare the handoff</strong>
                    <span>Separate evidence from recommendation.</span>
                  </span>
                </li>
                <li className={styles.workflowStep} data-state="locked">
                  <span className={styles.stepNumber} aria-hidden="true">
                    <LockKeyhole size={11} />
                  </span>
                  <span className={styles.stepCopy}>
                    <strong>Owner decides</strong>
                    <span>No approval control is exposed here.</span>
                  </span>
                </li>
              </ol>
            </section>

            <section
              className={`${styles.railCard} ${styles.assistantCard}`}
              aria-labelledby="escalations-assistant-title"
            >
              <p className={styles.sectionKicker}>SOURCE BOUNDARY</p>
              <h2
                id="escalations-assistant-title"
                className={styles.sectionTitle}
              >
                Build from recorded evidence
              </h2>
              <p className={styles.assistantSummary}>
                Use the linked source records to separate known facts from
                missing context. Approval and commitments stay with the owner.
              </p>
            </section>
          </aside>
        </div>
      </div>
    </div>
  );
}
