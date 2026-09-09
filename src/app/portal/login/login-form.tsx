"use client";

import { useActionState, useState } from "react";

import styles from "@/components/portal/resident.module.css";

import {
  confirmPortalCodeAction,
  requestPortalCodeAction,
  type PortalLoginState,
} from "./actions";

const INITIAL: PortalLoginState = { ok: false, error: null, phoneE164: null };

function ErrorLine({ error, testId }: { error: string | null; testId: string }) {
  if (!error) return null;
  return (
    <p role="alert" data-testid={testId} className={styles.error}>
      {error}
    </p>
  );
}

export function PortalLoginForm() {
  const [requestState, requestAction, requestPending] = useActionState(
    requestPortalCodeAction,
    INITIAL,
  );
  const [confirmState, confirmAction, confirmPending] = useActionState(
    confirmPortalCodeAction,
    INITIAL,
  );
  const [phoneOverride, setPhoneOverride] = useState<string | null>(null);

  const activePhone =
    phoneOverride === null && requestState.ok ? requestState.phoneE164 : null;

  if (!activePhone) {
    return (
      <form
        action={requestAction}
        className={styles.stack}
        data-testid="portal-phone-form"
        onSubmit={() => setPhoneOverride(null)}
      >
        <div className={styles.field}>
          <label htmlFor="portal-phone">Your phone number</label>
          <input
            id="portal-phone"
            name="phone"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            placeholder="(555) 123-4567"
            required
            autoFocus
            defaultValue={requestState.phoneE164 ?? ""}
            data-testid="portal-phone-input"
            onChange={() => setPhoneOverride(null)}
          />
        </div>
        <ErrorLine error={requestState.error} testId="portal-phone-error" />
        <button
          type="submit"
          disabled={requestPending}
          data-testid="portal-phone-submit"
          className={`${styles.buttonDark} ${styles.buttonBlock} ${requestPending ? styles.buttonDisabled : ""}`}
        >
          {requestPending ? "Sending code…" : "Text me a code"}
        </button>
        <p className={styles.fieldHint}>
          We’ll text a 6-digit code to the number your property team has on
          file. No password needed.
        </p>
      </form>
    );
  }

  return (
    <div className={styles.stack} data-testid="portal-code-step">
      <p className={styles.fieldHint}>
        We texted a 6-digit code to <strong>{activePhone}</strong>. It expires
        in 10 minutes.
      </p>
      <form action={confirmAction} className={styles.stack} data-testid="portal-code-form">
        <input type="hidden" name="phone" value={activePhone} />
        <div className={styles.field}>
          <label htmlFor="portal-code">Your code</label>
          <input
            id="portal-code"
            name="code"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]{6}"
            maxLength={6}
            placeholder="123456"
            required
            autoFocus
            data-testid="portal-code-input"
            className={styles.codeInput}
          />
        </div>
        <ErrorLine error={confirmState.error} testId="portal-code-error" />
        <button
          type="submit"
          disabled={confirmPending}
          data-testid="portal-code-submit"
          className={`${styles.buttonDark} ${styles.buttonBlock} ${confirmPending ? styles.buttonDisabled : ""}`}
        >
          {confirmPending ? "Signing in…" : "Unlock my portal"}
        </button>
      </form>

      <div className={styles.formLinks}>
        <form action={requestAction}>
          <input type="hidden" name="phone" value={activePhone} />
          <button
            type="submit"
            disabled={requestPending}
            data-testid="portal-resend"
            className={styles.textButton}
          >
            {requestPending ? "Sending…" : "Send a new code"}
          </button>
        </form>
        <button
          type="button"
          data-testid="portal-change-phone"
          className={styles.textButton}
          onClick={() => setPhoneOverride("clear")}
        >
          Use a different number
        </button>
      </div>

      <p className={styles.fieldHint}>
        If you previously texted STOP, text START to your property’s number,
        then request a new code.
      </p>
    </div>
  );
}
