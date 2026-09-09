'use client';

/**
 * Poke MCP keys card — Settings → Integrations.
 *
 * Three responsibilities, all client-side because they involve
 * navigator.clipboard, dialog state, and confirm flows:
 *
 *   1. Display the org's MCP SSE URL with a Copy button.
 *   2. List existing (un-revoked) keys: label, prefix, last_used_at,
 *      Revoke button.
 *   3. "Generate Poke key" button: opens an inline label form, calls
 *      `createApiKey`, on success mounts `ApiKeyDisplay` to reveal the
 *      plaintext exactly once.
 */

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Check, Copy, KeyRound, Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ApiKeyDisplay } from '@/components/settings/api-key-display';
import {
  createApiKey,
  revokeApiKey,
  type CreateApiKeyResult,
} from '@/app/(dashboard)/settings/integrations/actions';
import type { ApiKeyRow } from '@/app/(dashboard)/settings/integrations/page';

interface IntegrationsKeysCardProps {
  mcpSseUrl: string;
  keys: ApiKeyRow[];
}

type Mode = 'idle' | 'naming';

function formatLastUsed(iso: string | null): string {
  if (!iso) return 'Never used';
  try {
    const date = new Date(iso);
    return `Used ${date.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
    })}`;
  } catch {
    return iso;
  }
}

export function IntegrationsKeysCard({
  mcpSseUrl,
  keys,
}: IntegrationsKeysCardProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [urlCopied, setUrlCopied] = useState(false);
  const [mode, setMode] = useState<Mode>('idle');
  const [label, setLabel] = useState('Poke');
  const [error, setError] = useState<string | null>(null);
  const [revealed, setRevealed] = useState<CreateApiKeyResult | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  const handleCopyUrl = async () => {
    try {
      await navigator.clipboard.writeText(mcpSseUrl);
      setUrlCopied(true);
      window.setTimeout(() => setUrlCopied(false), 1600);
    } catch {
      setUrlCopied(false);
    }
  };

  const handleStartGenerate = () => {
    setMode('naming');
    setLabel('Poke');
    setError(null);
  };

  const handleCancelGenerate = () => {
    setMode('idle');
    setError(null);
  };

  const handleGenerate = (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    startTransition(async () => {
      try {
        const result = await createApiKey({ label: label.trim() });
        if (!result.success) {
          setError(result.error);
          return;
        }
        setRevealed(result.data);
        setMode('idle');
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to mint key');
      }
    });
  };

  const handleRevokeClick = (id: string) => {
    if (confirmingId !== id) {
      setConfirmingId(id);
      window.setTimeout(() => {
        setConfirmingId((current) => (current === id ? null : current));
      }, 4000);
      return;
    }
    setConfirmingId(null);
    startTransition(async () => {
      try {
        const result = await revokeApiKey({ id });
        if (!result.success) {
          setError(result.error);
          return;
        }
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to revoke');
      }
    });
  };

  const handleDismissReveal = () => setRevealed(null);

  return (
    <section
      data-testid="integrations-keys-card"
      style={{
        background: 'var(--paper-0)',
        border: '1px solid var(--ink-200)',
        borderRadius: 'var(--radius-lg-odesa)',
        padding: '28px 32px',
        display: 'flex',
        flexDirection: 'column',
        gap: '28px',
      }}
    >
      {/* MCP SSE URL */}
      <div>
        <p className="meta-label" style={{ color: 'var(--ink-500)' }}>
          MCP endpoint
        </p>
        <div
          style={{
            marginTop: '10px',
            display: 'flex',
            gap: '12px',
            alignItems: 'center',
            flexWrap: 'wrap',
          }}
        >
          <code
            data-testid="integrations-mcp-url"
            style={{
              flex: '1 1 auto',
              fontFamily:
                "var(--font-mono-metrics), 'JetBrains Mono', monospace",
              fontSize: '13px',
              padding: '10px 14px',
              background: 'var(--paper-100)',
              border: '1px solid var(--ink-200)',
              borderRadius: '8px',
              color: 'var(--ink-800)',
              wordBreak: 'break-all',
              minWidth: '0',
            }}
          >
            {mcpSseUrl}
          </code>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleCopyUrl}
            data-testid="integrations-mcp-url-copy"
          >
            {urlCopied ? (
              <>
                <Check />
                Copied
              </>
            ) : (
              <>
                <Copy />
                Copy URL
              </>
            )}
          </Button>
        </div>
      </div>

      {/* Existing keys */}
      <div>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '12px',
          }}
        >
          <p className="meta-label" style={{ color: 'var(--ink-500)' }}>
            Active keys
          </p>
          {mode === 'idle' ? (
            <Button
              type="button"
              size="sm"
              onClick={handleStartGenerate}
              disabled={pending}
              data-testid="integrations-generate-key"
            >
              <KeyRound />
              Generate Poke key
            </Button>
          ) : null}
        </div>

        {mode === 'naming' ? (
          <form
            onSubmit={handleGenerate}
            data-testid="integrations-key-form"
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '12px',
              padding: '16px',
              background: 'var(--paper-100)',
              border: '1px solid var(--ink-200)',
              borderRadius: '10px',
              marginBottom: '16px',
            }}
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <Label htmlFor="integrations-key-label" className="meta-label" style={{ color: 'var(--ink-500)' }}>
                Label
              </Label>
              <Input
                id="integrations-key-label"
                data-testid="integrations-key-label-input"
                type="text"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                disabled={pending}
                maxLength={80}
                placeholder="Poke"
                style={{ maxWidth: '320px' }}
                autoFocus
              />
              <p style={{ fontSize: '12px', color: 'var(--ink-500)' }}>
                Helps you find the key later.
              </p>
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <Button
                type="submit"
                size="sm"
                disabled={pending || label.trim() === ''}
                data-testid="integrations-key-confirm"
              >
                {pending ? 'Generating…' : 'Generate key'}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={handleCancelGenerate}
                disabled={pending}
              >
                Cancel
              </Button>
            </div>
          </form>
        ) : null}

        {keys.length === 0 ? (
          <p
            data-testid="integrations-keys-empty"
            style={{
              fontSize: '14px',
              color: 'var(--ink-500)',
              padding: '16px 0',
            }}
          >
            No keys yet. Generate one to connect Poke.
          </p>
        ) : (
          <ul
            data-testid="integrations-keys-list"
            style={{
              listStyle: 'none',
              margin: 0,
              padding: 0,
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            {keys.map((key, idx) => {
              const isConfirming = confirmingId === key.id;
              return (
                <li
                  key={key.id}
                  data-testid={`integrations-key-row-${key.id}`}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '14px 0',
                    borderTop:
                      idx === 0 ? 'none' : '1px solid var(--ink-100, #ECEAE3)',
                    gap: '16px',
                  }}
                >
                  <div style={{ minWidth: 0 }}>
                    <p
                      style={{
                        fontSize: '14px',
                        fontWeight: 600,
                        color: 'var(--ink-900)',
                      }}
                    >
                      {key.label}
                    </p>
                    <p
                      style={{
                        fontFamily:
                          "var(--font-mono-metrics), 'JetBrains Mono', monospace",
                        fontSize: '12px',
                        color: 'var(--ink-500)',
                        marginTop: '2px',
                      }}
                    >
                      {key.prefix}…
                      <span style={{ marginLeft: '12px', fontFamily: 'inherit' }}>
                        {formatLastUsed(key.lastUsedAt)}
                      </span>
                    </p>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant={isConfirming ? 'destructive' : 'ghost'}
                    onClick={() => handleRevokeClick(key.id)}
                    disabled={pending}
                    data-testid={`integrations-key-revoke-${key.id}`}
                  >
                    <Trash2 />
                    {isConfirming ? 'Confirm revoke' : 'Revoke'}
                  </Button>
                </li>
              );
            })}
          </ul>
        )}

        {error ? (
          <p
            role="alert"
            data-testid="integrations-keys-error"
            style={{
              marginTop: '12px',
              fontSize: '13px',
              color: 'var(--destructive, #b3261e)',
            }}
          >
            {error}
          </p>
        ) : null}
      </div>

      {revealed ? (
        <ApiKeyDisplay
          apiKey={revealed.key}
          label={revealed.label}
          onClose={handleDismissReveal}
        />
      ) : null}
    </section>
  );
}
