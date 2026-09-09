import type { Metadata } from "next";
import Link from "next/link";
import { Minus } from "lucide-react";

import styles from "@/components/portal/resident.module.css";

export const metadata: Metadata = {
  title: "Payment canceled — Odesa",
};

export default function PortalPaymentCancelPage() {
  return (
    <main
      className={`${styles.portal} ${styles.resultPage}`}
      data-testid="portal-payment-cancel-page"
    >
      <section className={styles.resultCard}>
        <span
          className={`${styles.resultMark} ${styles.resultMarkCancelled}`}
          aria-hidden="true"
        >
          <Minus size={24} strokeWidth={2.2} />
        </span>
        <div className={styles.resultCopy}>
          <p className={styles.eyebrow}>Checkout closed</p>
          <h1 className={styles.display}>No worries</h1>
          <p>Nothing was charged.</p>
          <p>You can return to your portal and pay when you are ready.</p>
        </div>
        <Link className={`${styles.buttonDark} ${styles.buttonBlock}`} href="/portal">
          Back to your portal
        </Link>
      </section>
    </main>
  );
}
