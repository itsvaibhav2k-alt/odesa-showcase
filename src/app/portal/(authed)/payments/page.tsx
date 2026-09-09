import type { Metadata } from "next";

import {
  PortalPageTitle,
  PortalSectionHeader,
} from "@/components/portal/portal-shell";
import styles from "@/components/portal/resident.module.css";
import { formatDollars, formatLongDate, formatMonthDay, monthName } from "@/lib/portal/format";
import {
  getPortalOverview,
  listPortalPayments,
  type PortalPaymentEntry,
} from "@/lib/portal/queries";
import { requirePortalSession } from "@/lib/portal/session";

import { PayButton } from "../pay-button";

export const metadata: Metadata = {
  title: "Payments — Odesa",
};

function methodLabel(method: string | null): string | null {
  if (method === "card") return "Paid online by card";
  if (method === "us_bank_account") return "Paid online by bank account";
  return null;
}

export default async function PortalPaymentsPage() {
  const session = await requirePortalSession();
  const [overview, payments] = await Promise.all([
    getPortalOverview(session),
    listPortalPayments(session),
  ]);
  const cycle = overview.hasActiveLease ? overview.cycle : null;
  const balance = cycle?.balanceDollars ?? 0;
  const isOutstanding = Boolean(cycle?.status.isOutstanding && balance > 0);
  const dueDate = cycle?.dueDate ? formatMonthDay(cycle.dueDate) : null;

  return (
    <div data-testid="portal-payments-page">
      <PortalPageTitle
        eyebrow="Account"
        description="Your current rent standing and recorded payment history."
      >
        Payments
      </PortalPageTitle>

      <div className={styles.content}>
        <section className={styles.section} aria-labelledby="payment-summary-title">
          <PortalSectionHeader>
            <span id="payment-summary-title">Account summary</span>
          </PortalSectionHeader>
          <div className={styles.summaryGrid}>
            <div className={styles.summaryCell}>
              <p className={styles.amountLabel}>Current status</p>
              <p className={styles.summaryValue}>
                {isOutstanding ? "Payment due" : "All set"}
              </p>
            </div>
            <div className={styles.summaryCell}>
              <p className={styles.amountLabel}>Due date</p>
              <p className={styles.summaryValue}>{dueDate ?? "Not listed"}</p>
            </div>
          </div>
          {isOutstanding ? (
            <div className={styles.card}>
              <span className={`${styles.status} ${styles.statusAttention}`}>
                Balance outstanding
              </span>
              <p>
                Your current balance and due standing are shown on Home. Secure
                checkout opens in a separate payment page.
              </p>
              <PayButton label="Pay now" />
            </div>
          ) : (
            <span className={`${styles.status} ${styles.statusHealthy}`}>
              No current balance due
            </span>
          )}
        </section>

        <section className={styles.section} aria-labelledby="payment-history-title">
          <PortalSectionHeader>
            <span id="payment-history-title">Payment history</span>
          </PortalSectionHeader>
          {payments.length === 0 ? (
            <div className={styles.emptyState}>
              <h2>No payments yet</h2>
              <p>Online and property-team-recorded payments will appear here.</p>
            </div>
          ) : (
            <div className={styles.ruledList} role="list">
              {payments.map((entry, index) => (
                <PaymentRow key={`${entry.kind}-${index}`} entry={entry} />
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function PaymentRow({ entry }: { entry: PortalPaymentEntry }) {
  const date =
    entry.kind === "stripe"
      ? formatLongDate(entry.paidAt) ?? "Date unavailable"
      : `${monthName(entry.cycleMonth) ?? "Rent"} ${entry.cycleMonth.slice(0, 4)}`;
  const provenance =
    entry.kind === "stripe"
      ? methodLabel(entry.method) ?? "Paid online"
      : "Recorded by your property team";

  return (
    <div className={styles.row} role="listitem">
      <div className={styles.rowPrimary}>
        <p className={styles.rowTitle}>{date}</p>
        <p className={styles.rowSubtle}>{provenance}</p>
        {entry.kind === "stripe" && entry.receiptUrl ? (
          <a
            className={styles.sectionLink}
            href={entry.receiptUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            View receipt
          </a>
        ) : null}
      </div>
      <div className={styles.rowValue}>
        <p className={styles.rowAmount}>{formatDollars(entry.amountDollars)}</p>
        <span className={`${styles.status} ${styles.statusHealthy}`}>Recorded</span>
      </div>
    </div>
  );
}
