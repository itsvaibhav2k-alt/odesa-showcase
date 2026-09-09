/**
 * TextExportActions — generic copy/download pair for a block of text.
 *
 * Reused for both the call transcript and the effective prompt, so the
 * naming stays neutral. Copy uses the clipboard API (swallows failure —
 * e2e has zero-console-error tolerance) and flips to "Copied" for ~2s.
 * Download builds a text/plain Blob and clicks a temporary anchor.
 */

'use client';

import { useState } from 'react';
import type { CSSProperties } from 'react';

const buttonStyle: CSSProperties = {
  background: 'var(--panel-lift)',
  color: 'var(--ink-2)',
  border: '1px solid var(--hairline)',
  borderRadius: 10,
  padding: '6px 12px',
  fontSize: '12px',
  fontWeight: 600,
  cursor: 'pointer',
  transition: 'all 0.15s ease',
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
};

export function TextExportActions({
  text,
  filename,
  idPrefix,
}: {
  text: string;
  filename: string;
  idPrefix: string;
}) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard?.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  const handleDownload = () => {
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div style={{ display: 'inline-flex', gap: 8 }}>
      <button
        type="button"
        onClick={handleCopy}
        style={buttonStyle}
        data-testid={`${idPrefix}-copy`}
      >
        {copied ? 'Copied' : 'Copy'}
      </button>
      <button
        type="button"
        onClick={handleDownload}
        style={buttonStyle}
        data-testid={`${idPrefix}-download`}
      >
        Download
      </button>
    </div>
  );
}
