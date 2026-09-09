import type { Metadata } from "next";
import Link from "next/link";
import { Check } from "lucide-react";

import styles from "@/components/portal/resident.module.css";

export const metadata: Metadata = {
  title: "Payment received — Odesa",
};

export default function PortalPaymentSuccessPage() {
  return (
    <main
      className={`${styles.portal} ${styles.resultPage}`}
      data-testid="portal-payment-success-page"
    >
      <section className={styles.resultCard}>
        <span className={styles.resultMark} aria-hidden="true">
          <Check size={24} strokeWidth={2.2} />
        </span>
        <div className={styles.resultCopy}>
          <p className={styles.eyebrow}>Payment return</p>
          <h1 className={styles.display}>Payment received</h1>
          <p>
            Thanks. Your payment may take a moment to appear in the account
            history after processing completes.
          </p>
        </div>
        <Link className={`${styles.buttonDark} ${styles.buttonBlock}`} href="/portal/payments">
          See your payments
        </Link>
        <p className={styles.authFootnote}>
          If prompted, sign in with the phone number connected to your tenancy.
        </p>
      </section>
    </main>
  );
}
