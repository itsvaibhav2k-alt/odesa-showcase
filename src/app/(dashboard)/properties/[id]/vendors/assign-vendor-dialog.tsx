'use client';

/**
 * AssignVendorDialog — owner-side affordance to set/change a vendor
 * for a property+category.
 *
 * Compact: a single inline form per row. Picker is `<select>` over the
 * org vendor roster passed in from the server page. Notes optional.
 */

import * as React from 'react';

import { assignVendorAction } from './actions';
import type { VendorCategory } from './shared-types';

export interface AssignVendorDialogProps {
  propertyId: string;
  category: VendorCategory;
  currentVendorId: string | null;
  vendors: ReadonlyArray<{
    id: string;
    name: string;
    category: string | null;
  }>;
}

export function AssignVendorDialog({
  propertyId,
  category,
  currentVendorId,
  vendors,
}: AssignVendorDialogProps): React.ReactElement {
  const [open, setOpen] = React.useState(false);
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function onSubmit(formData: FormData) {
    setPending(true);
    setError(null);
    try {
      const result = await assignVendorAction(
        { propertyId, category },
        formData,
      );
      if (!result.success) {
        setError(result.error);
        return;
      }
      setOpen(false);
    } finally {
      setPending(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        data-testid="assign-vendor-trigger"
        data-category={category}
        onClick={() => setOpen(true)}
        style={triggerStyle}
      >
        {currentVendorId ? 'Change' : 'Assign'}
      </button>
    );
  }

  // Surface category-matching vendors first so the operator sees the
  // most relevant option at the top of the picker.
  const matching = vendors.filter((v) => v.category === category);
  const others = vendors.filter((v) => v.category !== category);

  return (
    <form
      action={onSubmit}
      data-testid="assign-vendor-form"
      data-category={category}
      style={{
        display: 'flex',
        gap: '6px',
        alignItems: 'center',
        flexWrap: 'wrap',
      }}
    >
      <select
        name="vendorId"
        defaultValue={currentVendorId ?? ''}
        required
        style={inputStyle}
      >
        <option value="" disabled>
          Pick a vendor…
        </option>
        {matching.length > 0 ? (
          <optgroup label={`${category} vendors`}>
            {matching.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </optgroup>
        ) : null}
        {others.length > 0 ? (
          <optgroup label="Other vendors">
            {others.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </optgroup>
        ) : null}
      </select>
      <input
        name="notes"
        type="text"
        placeholder="Notes (optional)"
        style={{ ...inputStyle, minWidth: '160px' }}
      />
      <button
        type="submit"
        data-testid="assign-vendor-submit"
        disabled={pending}
        style={submitStyle}
      >
        {pending ? '…' : 'Save'}
      </button>
      <button
        type="button"
        onClick={() => setOpen(false)}
        disabled={pending}
        style={cancelStyle}
      >
        Cancel
      </button>
      {error ? (
        <span
          role="alert"
          style={{ color: 'var(--danger, #b91c1c)', fontSize: '12px' }}
        >
          {error}
        </span>
      ) : null}
    </form>
  );
}

const triggerStyle: React.CSSProperties = {
  padding: '6px 10px',
  border: '1px solid var(--ink-200)',
  borderRadius: '6px',
  background: 'var(--paper-0)',
  color: 'var(--ink-900)',
  cursor: 'pointer',
  fontSize: '12px',
};

const inputStyle: React.CSSProperties = {
  padding: '6px 8px',
  border: '1px solid var(--ink-200)',
  borderRadius: '6px',
  background: 'var(--paper-0)',
  fontSize: '13px',
  color: 'var(--ink-900)',
};

const submitStyle: React.CSSProperties = {
  padding: '6px 10px',
  border: '1px solid var(--ink-900)',
  borderRadius: '6px',
  background: 'var(--ink-900)',
  color: 'var(--paper-0)',
  cursor: 'pointer',
  fontSize: '12px',
};

const cancelStyle: React.CSSProperties = {
  padding: '6px 10px',
  border: '1px solid var(--ink-200)',
  borderRadius: '6px',
  background: 'transparent',
  color: 'var(--ink-500)',
  cursor: 'pointer',
  fontSize: '12px',
};
