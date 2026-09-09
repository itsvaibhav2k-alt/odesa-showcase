'use client';

/**
 * Financials route error boundary.
 *
 * Catches render/data failures thrown by the `/financials` server
 * component (e.g. a failed portfolio summary query) and renders the
 * shared `ErrorState`. The `reset` callback Next.js provides is wired to
 * the retry control so the user can re-attempt the failed render in place.
 */

import { ErrorState } from '@/components/shared/error-state';

interface FinancialsErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function FinancialsError({ reset }: FinancialsErrorProps) {
  return (
    <div
      data-testid="financials-error-boundary"
      className="today-theme"
      style={{
        minHeight: '100vh',
        background: 'var(--panel-clean)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <ErrorState
        title="Couldn't load financials"
        message="We hit a problem loading your portfolio financials. Please try again."
        onRetry={reset}
      />
    </div>
  );
}
