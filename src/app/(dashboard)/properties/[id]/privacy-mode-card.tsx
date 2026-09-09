'use client';

/**
 * Per-property Privacy Mode card.
 *
 * Lives on the property detail page (NOT settings) because privacy mode
 * is property-scoped — a landlord can run sensitive properties on-prem
 * while keeping smaller portfolios on the hosted Anthropic API. Source
 * columns are properties.privacy_mode + properties.ollama_host.
 *
 * Two modes:
 *   - 'hosted'  → Anthropic API (default). No further configuration.
 *   - 'on_prem' → customer's Ollama server. Reveals an OLLAMA_HOST
 *                 input + "Test connection" probe that calls
 *                 testOllamaConnection() server-side and renders the
 *                 ProviderHealth result inline.
 *
 * Persistence:
 *   - Mode radio change auto-saves immediately (matches Odesa Settings
 *     convention — no Save button anywhere).
 *   - Host input auto-saves on blur OR after a 1s debounce, since
 *     URL typing is ergonomically incompatible with per-keystroke saves.
 *   - Probe button is independent of save state and always reflects
 *     whatever's currently in the input field.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import {
  OptimisticSaveBadge,
  type OptimisticSaveState,
} from '@/components/settings/optimistic-save-badge';

import {
  testOllamaConnection,
  updatePrivacyMode,
} from './actions';

type PrivacyMode = 'hosted' | 'on_prem';

interface PrivacyModeCardProps {
  propertyId: string;
  initialPrivacyMode: PrivacyMode;
  initialOllamaHost: string | null;
}

interface HealthResult {
  ok: boolean;
  latencyMs: number;
  error?: string;
}

const HOST_DEBOUNCE_MS = 1000;
const SAVED_HOLD_MS = 2200;

export function PrivacyModeCard({
  propertyId,
  initialPrivacyMode,
  initialOllamaHost,
}: PrivacyModeCardProps) {
  const [mode, setMode] = useState<PrivacyMode>(initialPrivacyMode);
  const [host, setHost] = useState<string>(initialOllamaHost ?? '');
  const [saveState, setSaveState] = useState<OptimisticSaveState>('idle');

  const [probing, setProbing] = useState(false);
  const [health, setHealth] = useState<HealthResult | null>(null);

  const lastSavedRef = useRef<{ mode: PrivacyMode; host: string }>({
    mode: initialPrivacyMode,
    host: initialOllamaHost ?? '',
  });
  const hostDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearSavedRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (hostDebounceRef.current) clearTimeout(hostDebounceRef.current);
      if (clearSavedRef.current) clearTimeout(clearSavedRef.current);
    };
  }, []);

  const persist = useCallback(
    async (nextMode: PrivacyMode, nextHost: string) => {
      const prev = lastSavedRef.current;
      if (prev.mode === nextMode && prev.host === nextHost) {
        setSaveState('idle');
        return;
      }
      setSaveState('saving');
      const result = await updatePrivacyMode({
        propertyId,
        privacyMode: nextMode,
        ollamaHost: nextMode === 'hosted' ? null : nextHost,
      });
      if (!result.success) {
        setSaveState('error');
        return;
      }
      lastSavedRef.current = {
        mode: result.data.privacyMode,
        host: result.data.ollamaHost ?? '',
      };
      setSaveState('saved');
      if (clearSavedRef.current) clearTimeout(clearSavedRef.current);
      clearSavedRef.current = setTimeout(() => setSaveState('idle'), SAVED_HOLD_MS);
    },
    [propertyId],
  );

  function handleModeChange(next: PrivacyMode) {
    setMode(next);
    // Mode change is a single click — fire immediately, no debounce.
    if (hostDebounceRef.current) {
      clearTimeout(hostDebounceRef.current);
      hostDebounceRef.current = null;
    }
    void persist(next, host);
  }

  function handleHostChange(next: string) {
    setHost(next);
    if (hostDebounceRef.current) clearTimeout(hostDebounceRef.current);
    hostDebounceRef.current = setTimeout(() => {
      void persist(mode, next);
    }, HOST_DEBOUNCE_MS);
  }

  function handleHostBlur() {
    if (hostDebounceRef.current) {
      clearTimeout(hostDebounceRef.current);
      hostDebounceRef.current = null;
    }
    void persist(mode, host);
  }

  async function handleProbe() {
    if (probing) return;
    if (host.trim() === '') {
      setHealth({ ok: false, latencyMs: 0, error: 'Enter a host first' });
      return;
    }
    setProbing(true);
    setHealth(null);
    const result = await testOllamaConnection({ ollamaHost: host });
    setProbing(false);
    if (!result.success) {
      setHealth({ ok: false, latencyMs: 0, error: result.error });
      return;
    }
    setHealth(result.data);
  }

  return (
    <section
      data-testid="property-privacy-mode-card"
      aria-labelledby="property-privacy-mode-heading"
      className="flex flex-col gap-4"
      style={{
        background: 'var(--paper-0)',
        border: '1px solid var(--ink-200)',
        borderRadius: 'var(--radius-lg-odesa)',
        padding: '24px 28px',
      }}
    >
      <header className="flex items-baseline justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h2
            id="property-privacy-mode-heading"
            className="font-serif-display"
            style={{
              fontSize: '20px',
              lineHeight: 1.2,
              letterSpacing: '-0.005em',
              color: 'var(--ink-900)',
            }}
          >
            Privacy mode
          </h2>
          <p
            style={{
              fontSize: '13px',
              lineHeight: 1.5,
              color: 'var(--ink-600)',
              maxWidth: '60ch',
            }}
          >
            Choose where this property&apos;s worker model runs. Hosted uses
            Anthropic&apos;s API; on-prem keeps every prompt inside your own
            Ollama server.
          </p>
        </div>
        <OptimisticSaveBadge
          state={saveState}
          testId="privacy-mode"
          onRetry={() => void persist(mode, host)}
        />
      </header>

      <div
        role="radiogroup"
        aria-label="Privacy mode"
        className="grid gap-3"
        style={{ gridTemplateColumns: '1fr 1fr' }}
      >
        <ModeOption
          testId="property-privacy-mode-hosted"
          value="hosted"
          checked={mode === 'hosted'}
          title="Hosted"
          description="Anthropic Haiku 4.5 over the official API. Fastest path; covered by Anthropic's API data-handling terms."
          onSelect={() => handleModeChange('hosted')}
        />
        <ModeOption
          testId="property-privacy-mode-on-prem"
          value="on_prem"
          checked={mode === 'on_prem'}
          title="On-prem"
          description="Llama 3.3 on your Ollama server. Nothing leaves your network — responses are slower."
          onSelect={() => handleModeChange('on_prem')}
        />
      </div>

      {mode === 'on_prem' ? (
        <div
          data-testid="property-privacy-mode-on-prem-config"
          className="flex flex-col gap-2"
          style={{
            paddingTop: '16px',
            borderTop: '1px solid var(--ink-200)',
          }}
        >
          <label className="flex flex-col gap-1.5">
            <span
              className="meta-label"
              style={{ color: 'var(--ink-500)' }}
            >
              Ollama host
            </span>
            <input
              data-testid="property-privacy-mode-host"
              type="url"
              value={host}
              onChange={(e) => handleHostChange(e.target.value)}
              onBlur={handleHostBlur}
              placeholder="http://ollama.local:11434"
              spellCheck={false}
              autoComplete="off"
              className="h-10 w-full rounded-md px-3"
              style={{
                background: 'var(--paper-50)',
                border: '1px solid var(--ink-200)',
                color: 'var(--ink-800)',
                fontFamily: "var(--font-mono-metrics), 'JetBrains Mono', monospace",
                fontSize: '13px',
                outline: 'none',
              }}
            />
          </label>

          <div className="flex items-center justify-between gap-3">
            <button
              type="button"
              data-testid="property-privacy-mode-test"
              onClick={() => void handleProbe()}
              disabled={probing}
              className="rounded-md text-sm font-medium disabled:opacity-50"
              style={{
                background: 'transparent',
                color: 'var(--navy-700)',
                border: '1px solid var(--navy-700)',
                padding: '8px 14px',
                cursor: probing ? 'progress' : 'pointer',
              }}
            >
              {probing ? 'Testing…' : 'Test connection'}
            </button>

            <HealthInline result={health} probing={probing} />
          </div>
        </div>
      ) : null}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Internal primitives
// ---------------------------------------------------------------------------

interface ModeOptionProps {
  testId: string;
  value: PrivacyMode;
  checked: boolean;
  title: string;
  description: string;
  onSelect: () => void;
}

function ModeOption({
  testId,
  value,
  checked,
  title,
  description,
  onSelect,
}: ModeOptionProps) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={checked}
      data-testid={testId}
      data-state={checked ? 'on' : 'off'}
      data-value={value}
      onClick={onSelect}
      className="flex flex-col items-start gap-1.5 rounded-md text-left"
      style={{
        background: checked ? 'var(--navy-100)' : 'var(--paper-50)',
        border: `1px solid ${checked ? 'var(--navy-700)' : 'var(--ink-200)'}`,
        padding: '14px 16px',
        cursor: 'pointer',
        transition:
          'border-color 180ms var(--ease-smooth), background-color 180ms var(--ease-smooth)',
      }}
    >
      <span
        className="meta-label"
        style={{
          color: checked ? 'var(--navy-700)' : 'var(--ink-500)',
        }}
      >
        {title}
      </span>
      <span
        style={{
          fontSize: '13px',
          lineHeight: 1.5,
          color: 'var(--ink-700)',
        }}
      >
        {description}
      </span>
    </button>
  );
}

interface HealthInlineProps {
  result: HealthResult | null;
  probing: boolean;
}

function HealthInline({ result, probing }: HealthInlineProps) {
  if (probing) {
    return (
      <span
        data-testid="property-privacy-mode-health"
        data-state="probing"
        style={{
          fontSize: '12px',
          color: 'var(--ink-500)',
        }}
      >
        Reaching server…
      </span>
    );
  }
  if (!result) return null;
  if (result.ok) {
    return (
      <span
        data-testid="property-privacy-mode-health"
        data-state="ok"
        className="tabular-nums"
        style={{
          fontFamily: "var(--font-mono-metrics), 'JetBrains Mono', monospace",
          fontSize: '12px',
          color: 'var(--success-600)',
        }}
      >
        Reachable · {result.latencyMs} ms
      </span>
    );
  }
  return (
    <span
      data-testid="property-privacy-mode-health"
      data-state="error"
      style={{
        fontSize: '12px',
        color: 'var(--error-600)',
        maxWidth: '40ch',
      }}
    >
      {result.error ?? 'Could not reach server'}
    </span>
  );
}
