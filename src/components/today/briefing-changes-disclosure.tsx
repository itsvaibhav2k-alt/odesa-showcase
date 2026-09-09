'use client';

/**
 * Briefing "Show all N changes" disclosure.
 *
 * The only interactive piece of the otherwise-static briefing card: an inline
 * toggle that opens a small popover listing every overnight change. Each row is
 * a link to where the operator acts on it (a `/review/...` page or `/inbox`).
 * Closes on Escape or an outside click. Terracotta dot = still needs you; muted
 * dot = Odesa already handled / drafted it.
 */

import { useEffect, useRef, useState, type CSSProperties } from 'react';
import Link from 'next/link';

import type { BriefingChange } from '@/lib/today/briefing-summary';

interface BriefingChangesDisclosureProps {
  /** Collapsed label, e.g. "Show all six changes". */
  label: string;
  changes: BriefingChange[];
}

const toggleStyle: CSSProperties = {
  background: 'none',
  border: 'none',
  font: 'inherit',
  fontFamily: 'var(--font-sans-operator)',
  fontSize: '12px',
  color: 'var(--ink-3)',
  borderBottom: '1px dotted var(--ink-4)',
  paddingBottom: '1px',
  cursor: 'pointer',
};

const popoverStyle: CSSProperties = {
  position: 'absolute',
  top: 'calc(100% + 8px)',
  left: 0,
  zIndex: 20,
  width: '380px',
  maxWidth: '80vw',
  maxHeight: '320px',
  overflowY: 'auto',
  background: 'var(--panel-lift)',
  border: '1px solid var(--hairline)',
  borderRadius: '10px',
  boxShadow: '0 10px 30px rgba(40, 30, 20, 0.12)',
  padding: '6px',
};

const rowStyle: CSSProperties = {
  display: 'flex',
  gap: '9px',
  alignItems: 'flex-start',
  padding: '8px 10px',
  borderRadius: '8px',
  textDecoration: 'none',
  color: 'var(--ink-2)',
  fontSize: '12.5px',
  lineHeight: 1.45,
};

export function BriefingChangesDisclosure({
  label,
  changes,
}: BriefingChangesDisclosureProps) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLSpanElement | null>(null);

  useEffect(() => {
    if (!open) return;

    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }
    function onClick(event: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onClick);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onClick);
    };
  }, [open]);

  return (
    <span ref={wrapRef} style={{ position: 'relative', display: 'inline-block' }}>
      <button
        type="button"
        data-briefing-changes-toggle
        aria-expanded={open}
        style={toggleStyle}
        onClick={() => setOpen((value) => !value)}
      >
        {open ? 'Hide changes' : label}
      </button>

      {open ? (
        <div role="list" data-briefing-changes style={popoverStyle}>
          {changes.map((change, idx) => (
            <Link
              key={idx}
              href={change.href}
              role="listitem"
              data-change-row
              style={rowStyle}
            >
              <span
                aria-hidden="true"
                style={{
                  width: '6px',
                  height: '6px',
                  borderRadius: '50%',
                  marginTop: '6px',
                  flexShrink: 0,
                  background: change.needsYou ? 'var(--terracotta)' : 'var(--ink-4)',
                }}
              />
              <span>
                {change.segments.map((seg, j) =>
                  seg.kind === 'text' ? (
                    <span key={j}>{seg.value}</span>
                  ) : (
                    <b
                      key={j}
                      className={seg.kind === 'num' ? 'num' : undefined}
                      style={{ color: 'var(--ink)', fontWeight: 450 }}
                    >
                      {seg.value}
                    </b>
                  ),
                )}
              </span>
            </Link>
          ))}
        </div>
      ) : null}
    </span>
  );
}
