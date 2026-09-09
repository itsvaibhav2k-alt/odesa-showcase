'use client';

import { ErrorState } from '@/components/shared/error-state';

export default function DocumentsError({ reset }: { reset: () => void }) {
  return (
    <div
      data-testid="documents-error-boundary"
      className="today-theme"
      style={{
        minHeight: 'calc(100dvh - 56px)',
        background: 'var(--panel-clean)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 32,
      }}
    >
      <ErrorState
        title="Couldn't load documents"
        message="Your document ledger is still safe. We hit a problem loading it — please try again."
        onRetry={reset}
      />
    </div>
  );
}
