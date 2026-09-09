"use client";

import { useActionState, useEffect, useRef } from "react";

import styles from "@/components/portal/resident.module.css";
import {
  WORK_ORDER_CATEGORIES,
  WORK_ORDER_URGENCIES,
} from "@/lib/work-orders/create";

import {
  createPortalMaintenanceAction,
  type PortalMaintenanceState,
} from "./actions";
import { CATEGORY_LABELS, URGENCY_LABELS } from "./labels";

const INITIAL: PortalMaintenanceState = { ok: false, error: null };

export function MaintenanceForm() {
  const [state, formAction, pending] = useActionState(
    createPortalMaintenanceAction,
    INITIAL,
  );
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.ok) formRef.current?.reset();
  }, [state]);

  return (
    <form
      ref={formRef}
      action={formAction}
      className={styles.formCard}
      data-testid="portal-maintenance-form"
    >
      <div className={styles.field}>
        <label htmlFor="wo-description">What needs fixing?</label>
        <textarea
          id="wo-description"
          name="description"
          required
          minLength={3}
          maxLength={2000}
          rows={5}
          placeholder="Example: Water is dripping below the kitchen sink near the back wall."
          data-testid="portal-maintenance-description"
        />
        <p className={styles.fieldHint}>Include where the issue is and what you notice.</p>
      </div>

      <div className={styles.field}>
        <label htmlFor="wo-category">Type of issue</label>
        <select
          id="wo-category"
          name="category"
          defaultValue="general"
          data-testid="portal-maintenance-category"
        >
          {WORK_ORDER_CATEGORIES.map((category) => (
            <option key={category} value={category}>
              {CATEGORY_LABELS[category]}
            </option>
          ))}
        </select>
      </div>

      <div className={styles.field}>
        <label htmlFor="wo-urgency">Urgency</label>
        <select
          id="wo-urgency"
          name="urgency"
          defaultValue="routine"
          data-testid="portal-maintenance-urgency"
        >
          {WORK_ORDER_URGENCIES.map((urgency) => (
            <option key={urgency} value={urgency}>
              {URGENCY_LABELS[urgency]}
            </option>
          ))}
        </select>
      </div>

      <button
        type="submit"
        disabled={pending}
        data-testid="portal-maintenance-submit"
        className={`${styles.button} ${styles.buttonBlock} ${pending ? styles.buttonDisabled : ""}`}
      >
        {pending ? "Recording request…" : "Send request"}
      </button>

      {state.error ? (
        <p role="alert" data-testid="portal-maintenance-error" className={styles.error}>
          {state.error}
        </p>
      ) : null}
      {state.ok ? (
        <p role="status" data-testid="portal-maintenance-success" className={styles.success}>
          Request recorded. It now appears above as “Received.”
        </p>
      ) : null}
    </form>
  );
}
