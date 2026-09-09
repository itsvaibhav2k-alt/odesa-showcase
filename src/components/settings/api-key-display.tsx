'use client';

/**
 * One-time API key reveal modal — Settings → Integrations.
 *
 * After `createApiKey` server action returns, the parent component
 * mounts this with the freshly minted Poke key. We display the key in
 * a monospace block, offer a Copy button, and a Done button that
 * dismisses. Once dismissed the key cannot be recovered — only its
 * sha256 prefix lives in the DB.
 *
 * The dialog is built on the existing shadcn `dialog` primitive
 * (Base UI under the hood). No new shadcn pieces introduced.
 */

import { useState } from 'react';
import { Check, Copy } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

interface ApiKeyDisplayProps {
  /** The full key, shown ONCE. Parent unmounts after dismissal. */
  apiKey: string;
  /** Optional label the operator gave the key. */
  label?: string;
  /** Called when the dialog closes (Done button or backdrop). */
  onClose: () => void;
}

export function ApiKeyDisplay({
  apiKey,
  label,
  onClose,
}: ApiKeyDisplayProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(apiKey);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent
        data-testid="api-key-display"
        className="sm:max-w-md"
      >
        <DialogHeader>
          <DialogTitle>New Poke API key{label ? ` · ${label}` : ''}</DialogTitle>
          <DialogDescription data-testid="api-key-display-warning">
            You won&apos;t see this key again. Copy it now and paste it into
            Poke. If you lose it, revoke and generate a new one.
          </DialogDescription>
        </DialogHeader>

        <div
          data-testid="api-key-display-key"
          style={{
            background: 'var(--paper-100)',
            border: '1px solid var(--ink-200)',
            borderRadius: '10px',
            padding: '14px 16px',
            fontFamily:
              "var(--font-mono-metrics), 'JetBrains Mono', monospace",
            fontSize: '13px',
            lineHeight: 1.5,
            color: 'var(--ink-900)',
            wordBreak: 'break-all',
            userSelect: 'all',
          }}
        >
          {apiKey}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={handleCopy}
            data-testid="api-key-display-copy"
          >
            {copied ? (
              <>
                <Check />
                Copied
              </>
            ) : (
              <>
                <Copy />
                Copy
              </>
            )}
          </Button>
          <DialogClose
            render={
              <Button
                type="button"
                data-testid="api-key-display-done"
              >
                Done
              </Button>
            }
          />
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
