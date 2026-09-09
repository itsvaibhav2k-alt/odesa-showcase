"use client";

import { useActionState } from "react";

import styles from "@/components/portal/resident.module.css";

import { createPortalPaymentAction, type PortalPayState } from "./actions";

const INITIAL_STATE: PortalPayState = { error: null };

export function PayButton({ label }: { label: string }) {
  const [state, formAction, pending] = useActionState<PortalPayState, FormData>(
    createPortalPaymentAction,
    INITIAL_STATE,
  );

  return (
    <form action={formAction} className={styles.payForm}>
      <button
        type="submit"
        disabled={pending}
        data-testid="portal-pay-button"
        className={`${styles.button} ${styles.buttonBlock} ${pending ? styles.buttonDisabled : ""}`}
      >
        {pending ? "Opening secure checkout…" : label}
      </button>
      {state.error ? (
        <p role="alert" data-testid="portal-pay-error" className={styles.payError}>
          {state.error}
        </p>
      ) : null}
    </form>
  );
}
