'use client';

/**
 * Inline priority override for a work order row in the property Maintenance
 * room. The AI sets urgency on the call and it is inconsistent across identical
 * requests, so the operator can correct it in place. Auto-saves through the
 * shared `updateWorkOrderFieldsAction` (RLS-scoped, org-checked, audit-logged);
 * reverts on failure. `revalidatePath` refreshes the room on success.
 */

import * as React from 'react';
import type { CSSProperties } from 'react';

import { updateWorkOrderFieldsAction } from '@/lib/work-orders/actions';

const OPTIONS = [
  { value: 'routine', label: 'Routine' },
  { value: 'urgent', label: 'Urgent' },
  { value: 'emergency', label: 'Emergency' },
] as const;

type Urgency = (typeof OPTIONS)[number]['value'];

const selectStyle: CSSProperties = {
  height: '28px',
  borderRadius: '7px',
  border: '1px solid var(--hairline)',
  background: 'var(--panel-clean)',
  color: 'var(--ink-1)',
  padding: '0 6px',
  fontFamily: 'var(--font-sans-operator), system-ui, sans-serif',
  fontSize: '12.5px',
  cursor: 'pointer',
};

export function InlinePriorityEditor({
  woId,
  urgency,
}: {
  woId: string;
  urgency: Urgency;
}): React.ReactElement {
  const [pending, startTransition] = React.useTransition();
  const [value, setValue] = React.useState<Urgency>(urgency);
  const [failed, setFailed] = React.useState(false);

  return (
    <select
      value={value}
      disabled={pending}
      aria-label="Priority"
      data-testid="inline-priority"
      style={failed ? { ...selectStyle, borderColor: 'var(--clay, #b3421f)' } : selectStyle}
      onChange={(e) => {
        const next = e.target.value as Urgency;
        setValue(next);
        setFailed(false);
        startTransition(async () => {
          const res = await updateWorkOrderFieldsAction(woId, { urgency: next });
          if (!res.ok) {
            setValue(urgency);
            setFailed(true);
          }
        });
      }}
    >
      {OPTIONS.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
