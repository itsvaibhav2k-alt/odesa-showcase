import type { Metadata } from "next";
import type { ReactNode } from "react";
import { ExternalLink } from "lucide-react";

import {
  PortalPageTitle,
  PortalSectionHeader,
} from "@/components/portal/portal-shell";
import styles from "@/components/portal/resident.module.css";
import { formatDollars, formatLongDate, ordinal } from "@/lib/portal/format";
import { getPortalLease, type PortalLease } from "@/lib/portal/queries";
import { requirePortalSession } from "@/lib/portal/session";

export const metadata: Metadata = {
  title: "Your lease — Odesa",
};

function LeaseRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className={styles.factRow}>
      <span className={styles.factLabel}>{label}</span>
      <p className={styles.factValue}>{value}</p>
    </div>
  );
}

function leaseRows(lease: PortalLease): Array<{ label: string; value: ReactNode }> {
  const rows: Array<{ label: string; value: ReactNode }> = [];

  if (lease.addressLine) rows.push({ label: "Home", value: lease.addressLine });
  const starts = lease.startDate ? formatLongDate(lease.startDate) : null;
  const ends = lease.endDate ? formatLongDate(lease.endDate) : null;
  if (starts) rows.push({ label: "Lease starts", value: starts });
  if (ends) rows.push({ label: "Lease ends", value: ends });
  if (lease.graceDays != null && lease.graceDays > 0) {
    rows.push({
      label: "Grace period",
      value: `${lease.graceDays} day${lease.graceDays === 1 ? "" : "s"} after the due date`,
    });
  }
  if (lease.lateFeeDollars != null) {
    rows.push({
      label: "Late fee",
      value: (
        <>
          {formatDollars(lease.lateFeeDollars)}
          {lease.graceDays != null && lease.graceDays > 0
            ? " after the grace period"
            : " if rent is late"}
        </>
      ),
    });
  }

  return rows;
}

export default async function PortalLeasePage() {
  const session = await requirePortalSession();
  const lease = await getPortalLease(session);

  if (!lease) {
    return (
      <div data-testid="portal-lease-page">
        <PortalPageTitle eyebrow="Home record">Your lease</PortalPageTitle>
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

  const rows = leaseRows(lease);

  return (
    <div data-testid="portal-lease-page">
      <PortalPageTitle
        eyebrow="Home record"
        description="The selected home’s key monthly terms, dates, and document."
      >
        Your lease
      </PortalPageTitle>

      <div className={styles.content}>
        <section className={styles.section} aria-labelledby="monthly-terms-title">
          <PortalSectionHeader>
            <span id="monthly-terms-title">Monthly terms</span>
          </PortalSectionHeader>
          <div className={styles.summaryGrid}>
            <div className={styles.summaryCell}>
              <p className={styles.amountLabel}>Monthly rent</p>
              <p className={styles.summaryValue}>
                {formatDollars(lease.rentAmountDollars)}
              </p>
            </div>
            <div className={styles.summaryCell}>
              <p className={styles.amountLabel}>Rent due</p>
              <p className={styles.summaryValue}>{ordinal(lease.dueDay)}</p>
              <p className={styles.rowSubtle}>of each month</p>
            </div>
          </div>
        </section>

        <section className={styles.section} aria-labelledby="lease-facts-title">
          <PortalSectionHeader>
            <span id="lease-facts-title">Lease facts</span>
          </PortalSectionHeader>
          <div className={styles.ruledList}>
            {rows.map((row) => (
              <LeaseRow key={row.label} label={row.label} value={row.value} />
            ))}
          </div>
        </section>

        <section className={styles.section} aria-labelledby="lease-document-title">
          <PortalSectionHeader>
            <span id="lease-document-title">Lease document</span>
          </PortalSectionHeader>
          {lease.documentUrl ? (
            <a
              className={`${styles.buttonSecondary} ${styles.buttonBlock}`}
              href={lease.documentUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              Open lease PDF
              <ExternalLink size={17} aria-hidden="true" />
            </a>
          ) : (
            <div className={styles.emptyState}>
              <h3>No lease document available</h3>
              <p>The key terms above are the lease details currently on file.</p>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
