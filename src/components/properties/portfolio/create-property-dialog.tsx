"use client";

import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import { useEffect, useState, useTransition, type FormEvent } from "react";
import {
  createPortfolioProperty,
  type CreatePortfolioPropertyInput,
} from "@/app/(dashboard)/properties/actions";
import styles from "./assigned-properties-workspace.module.css";

export function CreatePropertyDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    if (!open) return;
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose, open]);

  if (!open) return null;

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const form = event.currentTarget;
    const data = new FormData(form);
    const input: CreatePortfolioPropertyInput = {
      name: String(data.get("name") ?? ""),
      // The current persistence model has no property-type column. The action
      // still accepts this legacy field, so keep it internal rather than
      // presenting a setting that would not be saved.
      propertyType: "single-family",
      addressStreet: String(data.get("addressStreet") ?? ""),
      addressCity: String(data.get("addressCity") ?? ""),
      addressState: String(data.get("addressState") ?? ""),
      addressZip: String(data.get("addressZip") ?? ""),
      unitCount: Number(data.get("unitCount") ?? 1),
    };

    startTransition(async () => {
      const result = await createPortfolioProperty(input);
      if (!result.success) {
        setError(result.error);
        return;
      }
      form.reset();
      onClose();
      router.refresh();
    });
  }

  return (
    <div className={styles.modalBackdrop}>
      <div
        className={styles.modal}
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-property-title"
      >
        <div className={styles.modalHeader}>
          <div>
            <span className={styles.eyebrow}>Portfolio record</span>
            <h2 id="add-property-title">Add property</h2>
          </div>
          <button
            type="button"
            className={styles.iconButton}
            aria-label="Close add property dialog"
            title="Close dialog"
            onClick={onClose}
          >
            <X size={17} aria-hidden="true" />
          </button>
        </div>

        <form
          className={styles.modalForm}
          data-testid="add-property-form"
          onSubmit={handleSubmit}
        >
          <label>
            <span>Name</span>
            <input name="name" required maxLength={200} autoFocus />
          </label>

          <label>
            <span>Unit count</span>
            <input
              name="unitCount"
              type="number"
              min={1}
              max={200}
              defaultValue={1}
              required
            />
          </label>

          <label>
            <span>Street</span>
            <input name="addressStreet" required maxLength={200} />
          </label>

          <div className={styles.addressGrid}>
            <label>
              <span>City</span>
              <input name="addressCity" required maxLength={100} />
            </label>
            <label>
              <span>State</span>
              <input
                name="addressState"
                required
                maxLength={2}
                autoCapitalize="characters"
              />
            </label>
            <label>
              <span>ZIP</span>
              <input name="addressZip" required inputMode="numeric" />
            </label>
          </div>

          {error ? (
            <p className={styles.formError} role="alert">
              {error}
            </p>
          ) : null}

          <div className={styles.modalFooter}>
            <p>Creates the property and its recorded unit rows.</p>
            <div>
              <button
                type="button"
                className={styles.secondaryButton}
                onClick={onClose}
              >
                Cancel
              </button>
              <button
                type="submit"
                className={styles.primaryButton}
                disabled={isPending}
              >
                {isPending ? "Adding…" : "Add property"}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
