import type { Metadata } from "next";
import { KeyRound } from "lucide-react";

import styles from "@/components/portal/resident.module.css";

import { PortalLoginForm } from "./login-form";

export const metadata: Metadata = {
  title: "Sign in — Odesa",
};

export default function PortalLoginPage() {
  return (
    <main
      className={`${styles.portal} ${styles.authPage}`}
      data-testid="portal-login-page"
    >
      <section className={styles.authCard}>
        <div className={styles.authBrand}>
          <div>
            <p className={styles.wordmark}>Odesa</p>
            <p className={styles.eyebrow}>Resident portal</p>
          </div>
          <span className={styles.keyMark} aria-hidden="true">
            <KeyRound size={21} strokeWidth={1.8} />
          </span>
        </div>

        <div className={styles.authCopy}>
          <h1 className={styles.display}>Your home, in hand.</h1>
          <p>
            Sign in to review rent, maintenance, messages, and your lease.
          </p>
        </div>

        <PortalLoginForm />

        <p className={styles.authFootnote}>
          Secure resident access uses the phone number already connected to
          your tenancy.
        </p>
      </section>
    </main>
  );
}
