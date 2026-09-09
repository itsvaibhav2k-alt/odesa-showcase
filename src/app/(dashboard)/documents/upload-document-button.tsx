'use client';

/**
 * UploadDocumentButton — dark pill in the /documents masthead + upload modal.
 *
 * The pill sits in the ListPageShell title row (titleAction slot). Clicking it
 * opens a compact modal (same backdrop/dialog idiom as the add-property modal
 * in property-mall): file picker, document type, explicit current-lease
 * association for lease files, and optional title override. Submit calls the
 * `uploadDocumentAction` server action, then router.refresh() so the
 * server-rendered list picks up the new row.
 *
 * Type/size are pre-checked client-side for fast feedback; the server action
 * re-validates at the boundary (the real gate).
 */

import {
  useRef,
  useState,
  useTransition,
  type CSSProperties,
  type FormEvent,
} from 'react';
import { useRouter } from 'next/navigation';
import { Minus, Upload } from 'lucide-react';

import {
  ALLOWED_DOCUMENT_MIME_TYPES,
  DOCUMENT_KINDS,
  MAX_DOCUMENT_BYTES,
  resolveDocumentMime,
  type DocumentKind,
} from '@/lib/documents/upload';
import { uploadDocumentAction } from './actions';

const KIND_LABELS: Record<DocumentKind, string> = {
  lease: 'Lease',
  inspection: 'Inspection',
  insurance: 'Insurance',
  notice: 'Notice',
  tax: 'Tax',
  hoa: 'HOA',
};

const ACCEPT_ATTR = [
  '.pdf',
  '.png',
  '.jpg',
  '.jpeg',
  '.heic',
  ...ALLOWED_DOCUMENT_MIME_TYPES,
].join(',');

const pillStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 7,
  height: 34,
  padding: '0 16px',
  borderRadius: 999,
  border: '1px solid var(--ink)',
  background: 'var(--ink)',
  color: 'var(--panel)',
  fontFamily: 'var(--font-sans-operator), system-ui, sans-serif',
  fontSize: 12.5,
  fontWeight: 500,
  letterSpacing: '0.01em',
  whiteSpace: 'nowrap',
  cursor: 'pointer',
};

const modalBackdropStyle: CSSProperties = {
  position: 'fixed',
  inset: 0,
  zIndex: 80,
  display: 'grid',
  placeItems: 'center',
  padding: 24,
  background: 'rgba(34, 29, 23, 0.18)',
  backdropFilter: 'blur(3px)',
};

const modalStyle: CSSProperties = {
  width: 'min(460px, 100%)',
  border: '1px solid var(--hairline)',
  borderRadius: 14,
  background: 'var(--panel)',
  boxShadow: '0 30px 80px rgba(35, 29, 22, 0.26)',
  color: 'var(--ink)',
  overflow: 'hidden',
};

const modalHeaderStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 16,
  padding: '24px 26px 6px',
};

const modalTitleStyle: CSSProperties = {
  margin: 0,
  fontFamily: 'var(--font-serif-display), Georgia, serif',
  fontStyle: 'italic',
  fontSize: 26,
  fontWeight: 400,
  lineHeight: 1.1,
};

const iconButtonStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 30,
  height: 30,
  border: '1px solid var(--hairline)',
  borderRadius: 8,
  background: 'var(--panel-clean)',
  color: 'var(--ink-2)',
  cursor: 'pointer',
};

const modalFormStyle: CSSProperties = {
  display: 'grid',
  gap: 16,
  padding: '18px 26px 26px',
};

const fieldStyle: CSSProperties = {
  display: 'grid',
  gap: 7,
};

const labelTextStyle: CSSProperties = {
  fontSize: 12,
  fontWeight: 500,
  color: 'var(--ink-3)',
};

const inputBoxStyle: CSSProperties = {
  width: '100%',
  height: 46,
  border: '1px solid var(--hairline)',
  borderRadius: 9,
  background: 'var(--panel-clean)',
  color: 'var(--ink)',
  padding: '0 12px',
  fontSize: 14,
  fontFamily: 'var(--font-sans-operator), system-ui, sans-serif',
  outline: 0,
};

const fileBoxStyle: CSSProperties = {
  ...inputBoxStyle,
  height: 'auto',
  padding: '11px 12px',
  fontSize: 13,
};

const hintStyle: CSSProperties = {
  fontSize: 11.5,
  color: 'var(--ink-3)',
  lineHeight: 1.4,
};

const errorStyle: CSSProperties = {
  color: 'var(--clay-ink)',
  fontSize: 12.5,
  lineHeight: 1.4,
};

const footerStyle: CSSProperties = {
  display: 'flex',
  justifyContent: 'flex-end',
  gap: 10,
  paddingTop: 2,
};

const secondaryButtonStyle: CSSProperties = {
  height: 40,
  padding: '0 16px',
  border: '1px solid var(--hairline)',
  borderRadius: 9,
  background: 'var(--panel)',
  color: 'var(--ink-2)',
  fontSize: 14,
  cursor: 'pointer',
};

const primaryButtonStyle: CSSProperties = {
  height: 40,
  padding: '0 18px',
  border: '1px solid var(--ink)',
  borderRadius: 9,
  background: 'var(--ink)',
  color: 'var(--panel)',
  fontSize: 14,
  fontWeight: 500,
  cursor: 'pointer',
};

function clientFileError(file: File | null): string | null {
  if (!file) return 'Choose a file to upload.';
  if (!resolveDocumentMime(file)) {
    return 'Unsupported file type — upload a PDF, PNG, JPG, or HEIC.';
  }
  if (file.size > MAX_DOCUMENT_BYTES) {
    return 'File is larger than the 10MB limit.';
  }
  return null;
}

export interface LeaseUploadOption {
  id: string;
  label: string;
}

export function UploadDocumentButton({
  leaseOptions,
}: {
  leaseOptions: ReadonlyArray<LeaseUploadOption>;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [kind, setKind] = useState<DocumentKind>('lease');
  const fileInputRef = useRef<HTMLInputElement>(null);

  function close(): void {
    if (pending) return;
    setOpen(false);
    setError(null);
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    setError(null);

    const form = event.currentTarget;
    const file = fileInputRef.current?.files?.[0] ?? null;

    const fileError = clientFileError(file);
    if (fileError) {
      setError(fileError);
      return;
    }

    const formData = new FormData(form);
    if (formData.get('kind') === 'lease' && !formData.get('leaseId')) {
      setError('Select the exact current lease this document belongs to.');
      return;
    }

    startTransition(async () => {
      const result = await uploadDocumentAction(formData);
      if (!result.success) {
        setError(result.error);
        return;
      }
      router.refresh();
      setOpen(false);
    });
  }

  return (
    <>
      <button
        type="button"
        style={pillStyle}
        onClick={() => setOpen(true)}
        data-testid="upload-document-button"
      >
        <Upload size={13} strokeWidth={1.8} aria-hidden="true" />
        Upload
      </button>

      {open ? (
        <div
          role="presentation"
          style={modalBackdropStyle}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) close();
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="upload-document-title"
            style={modalStyle}
          >
            <div style={modalHeaderStyle}>
              <h3 id="upload-document-title" style={modalTitleStyle}>
                Upload document
              </h3>
              <button
                type="button"
                aria-label="Close upload document"
                style={iconButtonStyle}
                onClick={close}
                disabled={pending}
              >
                <Minus size={16} strokeWidth={1.8} />
              </button>
            </div>

            <form
              data-testid="upload-document-form"
              style={modalFormStyle}
              onSubmit={handleSubmit}
            >
              <label style={fieldStyle}>
                <span style={labelTextStyle}>File</span>
                <input
                  ref={fileInputRef}
                  name="file"
                  aria-label="File"
                  type="file"
                  required
                  accept={ACCEPT_ATTR}
                  style={fileBoxStyle}
                />
                <span style={hintStyle}>PDF, PNG, JPG, or HEIC · up to 10MB</span>
              </label>

              <label style={fieldStyle}>
                <span style={labelTextStyle}>Type</span>
                <select
                  name="kind"
                  aria-label="Type"
                  value={kind}
                  style={inputBoxStyle}
                  onChange={(event) => setKind(event.currentTarget.value as DocumentKind)}
                >
                  {DOCUMENT_KINDS.map((kind) => (
                    <option key={kind} value={kind}>
                      {KIND_LABELS[kind]}
                    </option>
                  ))}
                </select>
              </label>

              {kind === 'lease' ? (
                <label style={fieldStyle}>
                  <span style={labelTextStyle}>Current lease</span>
                  <select
                    name="leaseId"
                    aria-label="Current lease"
                    defaultValue=""
                    required
                    style={inputBoxStyle}
                    data-testid="upload-document-lease"
                  >
                    <option value="" disabled>
                      Select the exact lease…
                    </option>
                    {leaseOptions.map((lease) => (
                      <option key={lease.id} value={lease.id}>
                        {lease.label}
                      </option>
                    ))}
                  </select>
                  <span style={hintStyle}>
                    {leaseOptions.length > 0
                      ? 'This exact association controls lease status and Missing.'
                      : 'No active or pending leases are available to associate.'}
                  </span>
                </label>
              ) : null}

              <label style={fieldStyle}>
                <span style={labelTextStyle}>Title (optional)</span>
                <input
                  name="name"
                  maxLength={200}
                  style={inputBoxStyle}
                  placeholder="Defaults to the file name"
                />
              </label>

              {error ? (
                <p role="alert" style={errorStyle}>
                  {error}
                </p>
              ) : null}

              <div style={footerStyle}>
                <button
                  type="button"
                  style={secondaryButtonStyle}
                  onClick={close}
                  disabled={pending}
                >
                  Cancel
                </button>
                <button type="submit" style={primaryButtonStyle} disabled={pending}>
                  {pending ? 'Uploading…' : 'Upload'}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </>
  );
}
