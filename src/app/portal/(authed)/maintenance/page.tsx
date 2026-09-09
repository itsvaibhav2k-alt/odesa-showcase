import type { Metadata } from "next";

import {
  PortalPageTitle,
  PortalSectionHeader,
} from "@/components/portal/portal-shell";
import styles from "@/components/portal/resident.module.css";
import { formatMonthDay } from "@/lib/portal/format";
import {
  listPortalWorkOrders,
  type PortalWorkOrder,
} from "@/lib/portal/queries";
import { requirePortalSession } from "@/lib/portal/session";

import { CATEGORY_LABELS, URGENCY_LABELS } from "./labels";
import { MaintenanceForm } from "./maintenance-form";

export const metadata: Metadata = {
  title: "Maintenance — Odesa",
};

const STATUS_LABELS: Record<string, string> = {
  open: "Received",
  assigned: "In progress",
  in_progress: "In progress",
  completed: "Done",
  cancelled: "Closed",
};

function statusLabel(status: string): string {
  return STATUS_LABELS[status] ?? "Received";
}

function categoryLabel(category: string): string {
  return (CATEGORY_LABELS as Record<string, string>)[category] ?? "General repair";
}

function urgencyLabel(urgency: string): string {
  return (URGENCY_LABELS as Record<string, string>)[urgency] ?? "Routine";
}

function WorkOrderRow({ order }: { order: PortalWorkOrder }) {
  const reported = formatMonthDay(order.createdAt);
  const done = order.status === "completed" || order.status === "cancelled";
  const attention = order.urgency === "emergency" && !done;

  return (
    <div
      className={styles.ledgerRow}
      role="listitem"
      data-testid="portal-maintenance-item"
    >
      <span
        className={`${styles.ledgerDot} ${
          done
            ? styles.ledgerDotHealthy
            : attention
              ? styles.ledgerDotAttention
              : ""
        }`}
        aria-hidden="true"
      />
      <div className={styles.ledgerBody}>
        <div className={styles.ledgerTopline}>
          <p className={styles.rowTitle}>{categoryLabel(order.category)}</p>
          <span
            className={`${styles.status} ${
              done ? styles.statusHealthy : attention ? styles.statusAttention : styles.statusPending
            }`}
          >
            {statusLabel(order.status)}
          </span>
        </div>
        <p className={styles.cardStrong}>{order.description}</p>
        <p className={styles.rowSubtle}>
          {reported ? `Reported ${reported}` : "Date unavailable"} ·{" "}
          {urgencyLabel(order.urgency)}
        </p>
      </div>
    </div>
  );
}

export default async function PortalMaintenancePage() {
  const session = await requirePortalSession();
  const orders = await listPortalWorkOrders(session);
  const activeCount = orders.filter(
    (order) => order.status !== "completed" && order.status !== "cancelled",
  ).length;

  return (
    <div data-testid="portal-maintenance-page">
      <PortalPageTitle
        eyebrow="Home care"
        description="Report an issue and follow the status recorded for each request."
      >
        Maintenance
      </PortalPageTitle>

      <div className={styles.content}>
        <section className={styles.section} aria-labelledby="request-ledger-title">
          <PortalSectionHeader
            action={
              <span
                className={`${styles.status} ${
                  activeCount > 0 ? styles.statusPending : styles.statusHealthy
                }`}
              >
                {activeCount} active
              </span>
            }
          >
            <span id="request-ledger-title">Request ledger</span>
          </PortalSectionHeader>

          {orders.length === 0 ? (
            <div
              className={styles.emptyState}
              data-testid="portal-maintenance-empty"
            >
              <h2>No requests yet</h2>
              <p>
                When something in your home needs attention, record it below.
              </p>
            </div>
          ) : (
            <div
              className={styles.ruledList}
              role="list"
              data-testid="portal-maintenance-list"
            >
              {orders.map((order) => (
                <WorkOrderRow key={order.id} order={order} />
              ))}
            </div>
          )}
        </section>

        <section
          className={styles.section}
          id="report-issue"
          aria-labelledby="report-issue-title"
        >
          <PortalSectionHeader>
            <span id="report-issue-title">Report an issue</span>
          </PortalSectionHeader>
          <p className={styles.fieldHint}>
            Add the location and what you can observe. For immediate danger,
            contact local emergency services first.
          </p>
          <MaintenanceForm />
        </section>
      </div>
    </div>
  );
}
