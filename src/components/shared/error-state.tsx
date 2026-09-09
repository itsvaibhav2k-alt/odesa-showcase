'use client';

import { AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface ErrorStateProps {
  title?: string;
  message?: string;
  onRetry?: () => void;
}

export function ErrorState({
  title = 'Something went wrong',
  message = 'Failed to load data. Please try again.',
  onRetry,
}: ErrorStateProps) {
  return (
    <div
      data-testid="error-state"
      className="flex flex-col items-center justify-center py-16 text-center"
    >
      <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-red-50">
        <AlertTriangle className="h-6 w-6 text-red-500" />
      </div>
      <h3 className="mt-4 heading-4 text-[#0F1524]">
        {title}
      </h3>
      <p className="mt-1 max-w-sm text-sm text-[#4A5064]">
        {message}
      </p>
      {onRetry && (
        <Button
          data-testid="retry-btn"
          onClick={onRetry}
          className="mt-6"
          variant="outline"
        >
          Try again
        </Button>
      )}
    </div>
  );
}
