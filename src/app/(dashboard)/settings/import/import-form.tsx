'use client';

/**
 * <ImportForm> — client component for /settings/import.
 *
 * Two-step flow:
 *   1. Pick source + file → POST /api/import/csv → render preview.
 *   2. "Apply import" → POST /api/import/commit → render final summary.
 *
 * The file input is gated to `.csv,text/csv` and capped at 5MB
 * client-side (the route enforces the same limit server-side).
 */

import { useRef, useState, useTransition } from 'react';

import { Button } from '@/components/ui/button';

const SOURCES = [
  { value: 'appfolio', label: 'AppFolio' },
  { value: 'buildium', label: 'Buildium' },
  { value: 'rentredi', label: 'RentRedi' },
  { value: 'generic', label: 'Generic / hand-built' },
] as const;

type Source = (typeof SOURCES)[number]['value'];

interface PlanSummaryShape {
  willInsert: number;
  willSkip: number;
  willUpdate: number;
}

interface PreviewResponse {
  success: true;
  idempotencyKey: string;
  source: Source;
  summary: {
    properties: PlanSummaryShape;
    units: PlanSummaryShape;
    tenants: PlanSummaryShape;
    leases: PlanSummaryShape;
  };
  warnings: string[];
  plan: {
    properties: ReadonlyArray<unknown>;
    units: ReadonlyArray<unknown>;
    tenants: ReadonlyArray<unknown>;
    leases: ReadonlyArray<unknown>;
  };
}

interface CommitSummaryShape {
  inserted: { properties: number; units: number; tenants: number; leases: number };
  skipped: { properties: number; units: number; tenants: number; leases: number };
  errors: string[];
}

const MAX_BYTES = 5 * 1024 * 1024;

export function ImportForm() {
  const [source, setSource] = useState<Source>('appfolio');
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [commit, setCommit] = useState<CommitSummaryShape | null>(null);

  const [previewing, startPreview] = useTransition();
  const [committing, startCommit] = useTransition();

  const handleFile = (next: File | null) => {
    setError(null);
    setPreview(null);
    setCommit(null);
    if (next && next.size > MAX_BYTES) {
      setError(`File exceeds 5MB limit (${(next.size / 1024 / 1024).toFixed(2)}MB)`);
      setFile(null);
      return;
    }
    setFile(next);
  };

  const submitPreview = () => {
    if (!file) {
      setError('Pick a CSV file first.');
      return;
    }
    setError(null);
    startPreview(async () => {
      const fd = new FormData();
      fd.set('source', source);
      fd.set('file', file);
      const res = await fetch('/api/import/csv', { method: 'POST', body: fd });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) {
        const rowFeedback = json?.validation?.issues
          ?.map((issue: { row: number | null; message: string }) =>
            `${issue.row ? `Row ${issue.row}: ` : ''}${issue.message.replace(/^Row \d+:\s*/, '')}`)
          .join(' ');
        setError(rowFeedback || json?.error || `Preview failed (${res.status})`);
        return;
      }
      setPreview(json as PreviewResponse);
    });
  };

  const submitCommit = () => {
    if (!file) {
      setError('Pick a CSV file first.');
      return;
    }
    setError(null);
    startCommit(async () => {
      const fd = new FormData();
      fd.set('source', source);
      fd.set('file', file);
      const res = await fetch('/api/import/commit', {
        method: 'POST',
        body: fd,
        headers: { 'Idempotency-Key': preview?.idempotencyKey ?? '' },
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) {
        const rowFeedback = json?.validation?.issues
          ?.map((issue: { row: number | null; message: string }) =>
            `${issue.row ? `Row ${issue.row}: ` : ''}${issue.message.replace(/^Row \d+:\s*/, '')}`)
          .join(' ');
        setError(rowFeedback || json?.error || `Commit failed (${res.status})`);
        return;
      }
      setCommit(json.summary as CommitSummaryShape);
    });
  };

  return (
    <section
      data-testid="import-form"
      style={{
        background: 'var(--paper-0)',
        border: '1px solid var(--ink-200)',
        borderRadius: 'var(--radius-lg-odesa)',
        padding: '28px 32px',
        display: 'flex',
        flexDirection: 'column',
        gap: '24px',
      }}
    >
      <fieldset className="flex flex-col gap-2" data-testid="import-source-fieldset">
        <legend className="meta-label" style={{ color: 'var(--ink-500)' }}>
          Source
        </legend>
        <div className="flex flex-col gap-2 sm:flex-row sm:gap-4">
          {SOURCES.map((s) => (
            <label
              key={s.value}
              className="inline-flex items-center gap-2 text-sm"
              data-testid={`import-source-${s.value}`}
            >
              <input
                type="radio"
                name="source"
                value={s.value}
                checked={source === s.value}
                onChange={() => setSource(s.value)}
              />
              <span>{s.label}</span>
            </label>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          <a
            href={`/api/import/template?source=${source}`}
            target="_blank"
            rel="noreferrer"
            data-testid="import-template-link"
            className="underline"
          >
            Download {SOURCES.find((s) => s.value === source)?.label} template
          </a>
        </p>
      </fieldset>

      <div className="flex flex-col gap-2">
        <label
          htmlFor="import-file"
          className="meta-label"
          style={{ color: 'var(--ink-500)' }}
        >
          CSV file (max 5MB)
        </label>
        <input
          id="import-file"
          ref={fileInputRef}
          type="file"
          accept=".csv,text/csv"
          onChange={(e) => handleFile(e.target.files?.[0] ?? null)}
          data-testid="import-file-input"
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          onClick={submitPreview}
          disabled={previewing || !file}
          data-testid="import-preview-button"
        >
          {previewing ? 'Previewing...' : 'Preview import'}
        </Button>
        {preview && (
          <Button
            type="button"
            variant="default"
            onClick={submitCommit}
            disabled={committing}
            data-testid="import-commit-button"
          >
            {committing ? 'Applying...' : 'Apply import'}
          </Button>
        )}
      </div>

      {error && (
        <p
          className="text-sm text-destructive"
          role="alert"
          data-testid="import-error"
        >
          {error}
        </p>
      )}

      {preview && (
        <div data-testid="import-preview" className="flex flex-col gap-3">
          <h3 className="text-sm font-medium">Preview</h3>
          <table className="text-sm" style={{ borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th align="left">Table</th>
                <th align="right">Will insert</th>
                <th align="right">Will skip</th>
              </tr>
            </thead>
            <tbody>
              {(['properties', 'units', 'tenants', 'leases'] as const).map((k) => (
                <tr key={k}>
                  <td>{k}</td>
                  <td align="right" data-testid={`import-preview-${k}-insert`}>
                    {preview.summary[k].willInsert}
                  </td>
                  <td align="right" data-testid={`import-preview-${k}-skip`}>
                    {preview.summary[k].willSkip}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {preview.warnings.length > 0 && (
            <details className="text-xs text-muted-foreground">
              <summary>{preview.warnings.length} warnings</summary>
              <ul className="ml-4 list-disc">
                {preview.warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}

      {commit && (
        <div
          data-testid="import-commit-summary"
          className="rounded border border-foreground/10 p-4 text-sm"
        >
          <h3 className="font-medium">Import complete</h3>
          <ul className="mt-2 ml-4 list-disc">
            {(['properties', 'units', 'tenants', 'leases'] as const).map((k) => (
              <li key={k}>
                {k}: <strong>{commit.inserted[k]}</strong> inserted,{' '}
                {commit.skipped[k]} skipped
              </li>
            ))}
          </ul>
          {commit.errors.length > 0 && (
            <p className="mt-2 text-destructive">
              {commit.errors.length} errors; check server logs.
            </p>
          )}
        </div>
      )}
    </section>
  );
}
