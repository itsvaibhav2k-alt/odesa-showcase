'use client';

/**
 * Property detail route error boundary.
 *
 * Catches render/data failures thrown by the `/properties/[id]` server
 * component (e.g. a failed property brief query) and renders the shared
 * `ErrorState`. Next.js's `reset` callback is wired to the retry control so the
 * user can re-attempt the failed render in place.
 */

import { ErrorState } from '@/components/shared/error-state';

interface PropertyDetailErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function PropertyDetailError({ reset }: PropertyDetailErrorProps) {
  return (
    <div
      data-testid="property-detail-error-boundary"
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
        title="Couldn't load this property"
        message="We hit a problem loading this property. Please try again."
        onRetry={reset}
      />
    </div>
  );
}
