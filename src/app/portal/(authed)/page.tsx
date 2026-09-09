import type { Metadata } from "next";
import Link from "next/link";
import {
  CreditCard,
  FileText,
  MessageCircle,
  Wrench,
} from "lucide-react";

import {
  PortalPageTitle,
  PortalSectionHeader,
} from "@/components/portal/portal-shell";
import styles from "@/components/portal/resident.module.css";
import {
  formatDollars,
  formatLongDate,
  formatMonthDay,
  monthName,
} from "@/lib/portal/format";
import {
  getPortalLease,
  getPortalOverview,
  getPortalThread,
  listPortalPayments,
  listPortalWorkOrders,
  type PortalRentCycle,
  type PortalWorkOrder,
} from "@/lib/portal/queries";
import { requirePortalSession } from "@/lib/portal/session";

import { PayButton } from "./pay-button";

export const metadata: Metadata = {
  title: "Home — Odesa",
};

function heroCopy(
  cycle: PortalRentCycle | null,
  rentAmountDollars: number,
): { sentence: string; detail: string | null; title: string } {
  if (!cycle) {
    return {
      title: "Current",
      sentence: "Nothing is due right now",
      detail: `Your monthly rent is ${formatDollars(rentAmountDollars)}. We’ll show the next payment here when it is recorded.`,
    };
  }

  const month = monthName(cycle.cycleMonth) ?? "this month";
  if (!cycle.status.isOutstanding) {
    return {
      title: "All set",
      sentence: `You’re all set for ${month}`,
      detail: "Your rent is paid — nothing else to do this month.",
    };
  }

  const due = cycle.dueDate ? formatMonthDay(cycle.dueDate) : null;
  const sentence = `You have a balance of ${formatDollars(cycle.balanceDollars)}`;
  if (cycle.status.isOnPlan) {
    return {
      title: formatDollars(cycle.balanceDollars),
      sentence,
      detail: "Your account reflects a payment plan with the property team.",
    };
  }
  if (cycle.status.isLate || cycle.status.isEscalated) {
    return {
      title: formatDollars(cycle.balanceDollars),
      sentence,
      detail: due ? `It was due on ${due}.` : "It is past due.",
    };
  }
  return {
    title: formatDollars(cycle.balanceDollars),
    sentence,
    detail: due ? `It is due on ${due}.` : null,
  };
}

const WORK_ORDER_STATUS: Record<string, string> = {
  open: "Received",
  assigned: "In progress",
  in_progress: "In progress",
  completed: "Done",
  cancelled: "Closed",
};

function workOrderStatus(order: PortalWorkOrder): string {
  return WORK_ORDER_STATUS[order.status] ?? "Received";
}

function workOrderUrgency(urgency: string): string | null {
  if (urgency === "emergency") return "Emergency";
  if (urgency === "urgent") return "Urgent";
  return null;
}

export default async function PortalHomePage() {
  const session = await requirePortalSession();
  const [overview, payments, workOrders, thread, lease] = await Promise.all([
    getPortalOverview(session),
    listPortalPayments(session),
    listPortalWorkOrders(session),
    getPortalThread(session),
    getPortalLease(session),
  ]);

  const greeting = overview.firstName ? `Hi, ${overview.firstName}` : "Welcome home";

  if (!overview.hasActiveLease) {
    return (
      <div data-testid="portal-home-page">
        <PortalPageTitle eyebrow="Resident keyring">{greeting}</PortalPageTitle>
        <div className={styles.content}>
          <section className={styles.emptyState}>
            <h2>We couldn’t find an active lease</h2>
            <p>
              If that does not look right, contact your property team so they
              can review your resident access.
            </p>
          </section>
        </div>
      </div>
    );
  }

  const { sentence, detail, title } = heroCopy(
    overview.cycle,
    overview.rentAmountDollars,
  );
  const balanceDollars = overview.cycle?.balanceDollars ?? 0;
  const activeOrder = workOrders.find(
    (order) => order.status !== "completed" && order.status !== "cancelled",
  );
  const recentPayment = payments[0];
  const recentMessage = thread.messages.at(-1);
  const leaseEnd = lease?.endDate ? formatLongDate(lease.endDate) : null;
  const smsHref = thread.textUsNumber ? `sms:${thread.textUsNumber}` : null;

  return (
    <div data-testid="portal-home-page">
      <PortalPageTitle
        eyebrow="Resident keyring"
        description="Rent, repairs, messages, and lease details for your home."
      >
        {greeting}
      </PortalPageTitle>

      <div className={styles.content}>
        <section
          className={styles.hero}
          id="rent-payment"
          data-testid="portal-rent-standing"
        >
          <div className={styles.heroCopy}>
            <p className={styles.eyebrow}>Rent standing</p>
            <p className={styles.heroTitle}>{title}</p>
            <p className={styles.heroDetail}>{sentence}</p>
            {detail ? <p className={styles.heroDetail}>{detail}</p> : null}
          </div>
          <div className={styles.heroActions}>
            {balanceDollars > 0 ? (
              <PayButton label={`Pay ${formatDollars(balanceDollars)}`} />
            ) : (
              <Link className={styles.buttonQuiet} href="/portal/payments">
                View payments
              </Link>
            )}
          </div>
        </section>

        <section className={styles.section} aria-labelledby="quick-actions-title">
          <PortalSectionHeader>
            <span id="quick-actions-title">At your fingertips</span>
          </PortalSectionHeader>
          <div className={styles.quickGrid}>
            <Link
              className={styles.quickAction}
              href={balanceDollars > 0 ? "#rent-payment" : "/portal/payments"}
            >
              <span className={styles.quickIcon} aria-hidden="true">
                <CreditCard size={18} />
              </span>
              <span>{balanceDollars > 0 ? "Pay rent" : "Payments"}</span>
            </Link>
            <Link className={styles.quickAction} href="/portal/maintenance#report-issue">
              <span className={styles.quickIcon} aria-hidden="true">
                <Wrench size={18} />
              </span>
              <span>Report an issue</span>
            </Link>
            <Link className={styles.quickAction} href="/portal/lease">
              <span className={styles.quickIcon} aria-hidden="true">
                <FileText size={18} />
              </span>
              <span>View lease</span>
            </Link>
            {smsHref ? (
              <a className={styles.quickAction} href={smsHref}>
                <span className={styles.quickIcon} aria-hidden="true">
                  <MessageCircle size={18} />
                </span>
                <span>Text the team</span>
              </a>
            ) : (
              <div
                className={`${styles.quickAction} ${styles.buttonDisabled}`}
                aria-disabled="true"
              >
                <span className={styles.quickIcon} aria-hidden="true">
                  <MessageCircle size={18} />
                </span>
                <span>Text not connected</span>
              </div>
            )}
          </div>
        </section>

        <div className={styles.homeGrid}>
          <div className={styles.homePrimary}>
            <section className={styles.section} aria-labelledby="maintenance-title">
              <PortalSectionHeader
                action={
                  <Link className={styles.sectionLink} href="/portal/maintenance">
                    All requests
                  </Link>
                }
              >
                <span id="maintenance-title">Maintenance</span>
              </PortalSectionHeader>
              {activeOrder ? (
                <div className={styles.card}>
                  <span
                    className={`${styles.status} ${styles.statusPending}`}
                  >
                    {workOrderStatus(activeOrder)}
                  </span>
                  <p className={styles.cardStrong}>{activeOrder.description}</p>
                  <p>
                    Reported {formatMonthDay(activeOrder.createdAt) ?? "recently"}
                    {workOrderUrgency(activeOrder.urgency)
                      ? ` · ${workOrderUrgency(activeOrder.urgency)}`
                      : ""}
                  </p>
                </div>
              ) : (
                <div className={styles.emptyState}>
                  <h3>No active requests</h3>
                  <p>Your completed and past requests remain in Maintenance.</p>
                </div>
              )}
            </section>

            <section className={styles.section} aria-labelledby="activity-title">
              <PortalSectionHeader>
                <span id="activity-title">Recent account activity</span>
              </PortalSectionHeader>
              {!recentPayment && workOrders.length === 0 && !recentMessage ? (
                <div className={styles.emptyState}>
                  <h3>No recent activity</h3>
                  <p>Payments, requests, and messages will appear here.</p>
                </div>
              ) : (
                <div className={styles.ruledList}>
                  {recentPayment ? (
                    <div className={styles.row}>
                      <div className={styles.rowPrimary}>
                        <p className={styles.rowTitle}>Rent payment</p>
                        <p className={styles.rowSubtle}>
                          {recentPayment.kind === "stripe"
                            ? `Paid online · ${formatLongDate(recentPayment.paidAt) ?? "Recorded"}`
                            : `${monthName(recentPayment.cycleMonth) ?? "Rent"} · Recorded by the property team`}
                        </p>
                      </div>
                      <div className={styles.rowValue}>
                        <p className={styles.rowAmount}>
                          {formatDollars(recentPayment.amountDollars)}
                        </p>
                      </div>
                    </div>
                  ) : null}
                  {workOrders[0] ? (
                    <div className={styles.row}>
                      <div className={styles.rowPrimary}>
                        <p className={styles.rowTitle}>Maintenance request</p>
                        <p className={styles.rowSubtle}>{workOrders[0].description}</p>
                      </div>
                      <span className={`${styles.status} ${styles.statusPending}`}>
                        {workOrderStatus(workOrders[0])}
                      </span>
                    </div>
                  ) : null}
                  {recentMessage ? (
                    <div className={styles.row}>
                      <div className={styles.rowPrimary}>
                        <p className={styles.rowTitle}>
                          {recentMessage.fromYou ? "Message from you" : "Property team message"}
                        </p>
                        <p className={styles.rowSubtle}>{recentMessage.body}</p>
                      </div>
                    </div>
                  ) : null}
                </div>
              )}
            </section>
          </div>

          <aside className={styles.homeAside}>
            <section className={styles.section} aria-labelledby="lease-summary-title">
              <PortalSectionHeader
                action={
                  <Link className={styles.sectionLink} href="/portal/lease">
                    View lease
                  </Link>
                }
              >
                <span id="lease-summary-title">Your lease</span>
              </PortalSectionHeader>
              <div className={styles.card}>
                <span className={`${styles.status} ${styles.statusHealthy}`}>
                  Active home
                </span>
                <p className={styles.cardStrong}>{overview.addressLine}</p>
                <p>
                  {leaseEnd ? `Current term ends ${leaseEnd}.` : "Current lease details are on file."}
                </p>
                {lease?.documentUrl ? <p>Lease document available.</p> : null}
              </div>
            </section>
          </aside>
        </div>
      </div>
    </div>
  );
}
