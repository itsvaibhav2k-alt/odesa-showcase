import type { ReactElement } from 'react';

export function AccountantUnavailableState({
  label = 'Accounting evidence is unavailable',
}: {
  label?: string;
}): ReactElement {
  return (
    <section
      data-testid="accountant-unavailable"
      role="status"
      style={{
        border: '1px solid var(--accountant-border, #ded3bf)',
        borderRadius: 8,
        background: 'var(--accountant-cream, #fffdf8)',
        padding: '18px',
        color: 'var(--accountant-muted, #776b5e)',
        fontSize: 13,
        lineHeight: 1.55,
      }}
    >
      <strong style={{ display: 'block', color: 'var(--accountant-ink, #211d18)' }}>
        {label}
      </strong>
      The authorized projection could not be read. No totals or records have
      been inferred; refresh after the local data connection is restored.
    </section>
  );
}
