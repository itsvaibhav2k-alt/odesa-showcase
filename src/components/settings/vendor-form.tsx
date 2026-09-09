'use client';

/**
 * Inline vendor form — used for both "add new" and "edit existing" rows.
 *
 * The Settings vendors section opts out of modals entirely (per spec
 * §11.4 — scroll is the organizing principle). This component renders
 * three inputs in a single row: category select, name, phone. It calls
 * `onSubmit` with the raw payload and leaves the `OptimisticSaveBadge`
 * + actual server-action plumbing to the parent table so state stays
 * near the list.
 *
 * A11y:
 *  - Each input has a visible label via the meta-label sibling above it.
 *  - Enter submits the row; Escape cancels.
 */

import { useEffect, useRef, useState, type FormEvent } from 'react';

import {
  VENDOR_CATEGORIES,
  categoryLabel,
} from '@/lib/validation/vendor';
import type { WorkOrderCategory } from '@/types/database';

export interface VendorFormPayload {
  name: string;
  category: WorkOrderCategory;
  phoneE164: string;
}

export interface VendorFormProps {
  /** Existing row in edit mode; `null` for a new row. */
  initial?: VendorFormPayload | null;
  /** Called with the form payload when the landlord hits save / Enter. */
  onSubmit: (payload: VendorFormPayload) => void;
  /** Called when the landlord hits Escape or clicks Cancel. */
  onCancel: () => void;
  /** Disables the inputs while a save is in flight. */
  disabled?: boolean;
  /** Optional testid prefix; defaults to `settings-vendor-form`. */
  testId?: string;
  /**
   * Auto-focus the first field on mount. Defaults to true — the entire
   * point of inline editing is "click-to-edit, type immediately".
   */
  autoFocus?: boolean;
}

const BLANK: VendorFormPayload = {
  name: '',
  category: 'plumbing',
  phoneE164: '',
};

export function VendorForm({
  initial,
  onSubmit,
  onCancel,
  disabled,
  testId,
  autoFocus = true,
}: VendorFormProps) {
  const [draft, setDraft] = useState<VendorFormPayload>(initial ?? BLANK);
  const nameRef = useRef<HTMLInputElement | null>(null);
  const prefix = testId ?? 'settings-vendor-form';

  useEffect(() => {
    if (autoFocus) nameRef.current?.focus();
  }, [autoFocus]);

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (disabled) return;
    const name = draft.name.trim();
    if (name === '') return;
    onSubmit({ ...draft, name });
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      onCancel();
    }
  }

  return (
    <form
      data-testid={prefix}
      onSubmit={handleSubmit}
      onKeyDown={handleKeyDown}
      className="grid items-center gap-3"
      style={{
        gridTemplateColumns: '160px 1fr 180px 110px',
      }}
    >
      <select
        data-testid={`${prefix}-category`}
        value={draft.category}
        disabled={disabled}
        onChange={(e) =>
          setDraft({ ...draft, category: e.target.value as WorkOrderCategory })
        }
        className="h-9 rounded-md px-2"
        style={{
          background: 'var(--paper-0)',
          border: '1px solid var(--ink-200)',
          color: 'var(--ink-800)',
          fontSize: '14px',
        }}
      >
        {VENDOR_CATEGORIES.map((c) => (
          <option key={c} value={c}>
            {categoryLabel(c)}
          </option>
        ))}
      </select>

      <input
        ref={nameRef}
        data-testid={`${prefix}-name`}
        type="text"
        placeholder="Vendor name"
        value={draft.name}
        disabled={disabled}
        onChange={(e) => setDraft({ ...draft, name: e.target.value })}
        className="h-9 rounded-md px-2"
        style={{
          background: 'var(--paper-0)',
          border: '1px solid var(--ink-200)',
          color: 'var(--ink-800)',
          fontSize: '14px',
        }}
      />

      <input
        data-testid={`${prefix}-phone`}
        type="tel"
        placeholder="+1 555 555 0100"
        value={draft.phoneE164}
        disabled={disabled}
        onChange={(e) => setDraft({ ...draft, phoneE164: e.target.value })}
        className="h-9 rounded-md px-2 tabular-nums"
        style={{
          background: 'var(--paper-0)',
          border: '1px solid var(--ink-200)',
          color: 'var(--ink-800)',
          fontFamily: "var(--font-mono-metrics), 'JetBrains Mono', monospace",
          fontSize: '13px',
        }}
      />

      <div className="flex gap-1">
        <button
          type="submit"
          data-testid={`${prefix}-submit`}
          disabled={disabled || draft.name.trim() === ''}
          className="h-9 rounded-md px-3 text-sm font-medium disabled:opacity-50"
          style={{
            background: 'var(--navy-700)',
            color: '#fff',
          }}
        >
          Save
        </button>
        <button
          type="button"
          data-testid={`${prefix}-cancel`}
          onClick={onCancel}
          className="h-9 rounded-md px-3 text-sm"
          style={{
            background: 'transparent',
            color: 'var(--ink-600)',
            border: '1px solid var(--ink-200)',
          }}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
