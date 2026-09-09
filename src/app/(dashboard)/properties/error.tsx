'use client';

/**
 * Properties route error boundary.
 *
 * Catches render/data failures thrown by the `/properties` server component
 * (e.g. a failed portfolio query) and renders the shared `ErrorState`. The
 * `reset` callback Next.js provides is wired to the retry control so the user
 * can re-attempt the failed render in place.
 */

import { ErrorState } from '@/components/shared/error-state';

interface PropertiesErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function PropertiesError({ reset }: PropertiesErrorProps) {
  return (
    <div
      data-testid="properties-error-boundary"
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
        title="Couldn't load properties"
        message="We hit a problem loading your portfolio. Please try again."
        onRetry={reset}
      />
    </div>
  );
}
