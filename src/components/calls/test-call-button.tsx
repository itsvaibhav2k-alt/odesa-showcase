/**
 * TestCallButton — dashboard action for generating safe test calls.
 *
 * Calls the /api/retell/test-call endpoint to create a realistic voice_calls
 * artifact without any external provider interaction. Shows loading state
 * during creation and navigates to the call detail on success.
 */

'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { CSSProperties } from 'react';

import type { TestCallScenario } from '@/lib/voice/test-call-fixtures';

const buttonStyle: CSSProperties = {
  background: 'var(--green-bg)',
  color: 'var(--green-ink)',
  border: '1px solid var(--green-border)',
  borderRadius: 10,
  padding: '10px 16px',
  fontSize: '13px',
  fontWeight: 600,
  cursor: 'pointer',
  transition: 'all 0.15s ease',
  display: 'inline-flex',
  alignItems: 'center',
  gap: 8,
};

const disabledStyle: CSSProperties = {
  ...buttonStyle,
  opacity: 0.5,
  cursor: 'not-allowed',
};

const errorStyle: CSSProperties = {
  marginTop: 8,
  padding: '8px 12px',
  background: 'var(--red-bg)',
  color: 'var(--red-ink)',
  border: '1px solid var(--red-border)',
  borderRadius: 8,
  fontSize: '12px',
};

export interface TestCallButtonProps {
  scenario?: TestCallScenario;
  label?: string;
  testId?: string;
}

export function TestCallButton({
  scenario,
  label = 'Run safe test call',
  testId = 'test-call-button',
}: TestCallButtonProps = {}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleTestCall = async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/retell/test-call', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: scenario ? JSON.stringify({ scenario }) : undefined,
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to create test call');
      }

      // Navigate to the call detail page
      router.push(data.href);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'An error occurred';
      setError(message);
      setLoading(false);
    }
  };

  return (
    <div>
      <button
        onClick={handleTestCall}
        disabled={loading}
        style={loading ? disabledStyle : buttonStyle}
        data-testid={testId}
      >
        {loading ? (
          <>
            <span aria-hidden="true">⏳</span>
            Creating test call...
          </>
        ) : (
          <>
            <span aria-hidden="true">📞</span>
            {label}
          </>
        )}
      </button>

      {error && (
        <div style={errorStyle} role="alert" data-testid="test-call-error">
          {error}
        </div>
      )}
    </div>
  );
}