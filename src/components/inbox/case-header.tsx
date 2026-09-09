'use client';

/**
 * CaseHeader — case-file column header (Wave 5).
 *
 * Avatar + tenant name + contact metadata (phone · unit · property)
 * + status chip on the right + Snooze/Mute controls.
 *
 * Status chip reuses the queue chip palette so the operator's eye
 * lands on the same visual language across rows and the open case.
 *
 * Snooze + Mute are wired to the `snoozeConversation` / `muteConversation`
 * server actions via the conversations context — they persist to the
 * conversation and reflect its `snoozedActive` / `muted` state.
 */

import { useEffect, useRef, useState, type CSSProperties } from 'react';

import type { ConversationDetail } from '@/lib/inbox/conversation-queries';
import type { QueueStatus } from '@/lib/inbox/queue-status';
import { useConversations } from './conversations-context';

const CHIP_STYLES: Record<
  QueueStatus['kind'],
  { bg: string; fg: string; border: string }
> = {
  review: {
    bg: 'var(--amber-bg)',
    fg: 'var(--amber-ink)',
    border: 'var(--amber-border)',
  },
  draft: {
    bg: 'var(--neutral-bg)',
    fg: 'var(--neutral-ink)',
    border: 'var(--neutral-border)',
  },
  escalated: {
    bg: 'var(--clay-bg)',
    fg: 'var(--clay-ink)',
    border: 'var(--clay-border)',
  },
  handled: {
    bg: 'var(--green-bg)',
    fg: 'var(--green-ink)',
    border: 'var(--green-border)',
  },
  watching: {
    bg: 'var(--canvas-deep)',
    fg: 'var(--ink-3, #87796A)',
    border: 'var(--hairline-strong)',
  },
};

const AVATAR_TONES = [
  { bg: '#E8D4C2', fg: '#6B3F26' },
  { bg: '#DDD3BC', fg: '#4A402D' },
  { bg: '#E5C7B5', fg: '#6F3922' },
  { bg: '#D9DFC8', fg: '#3F4A29' },
  { bg: '#D6D1C2', fg: '#494232' },
] as const;

function avatarToneForName(name: string): (typeof AVATAR_TONES)[number] {
  const code =
    name.trim().toUpperCase().charCodeAt(0) || AVATAR_TONES.length;
  return AVATAR_TONES[code % AVATAR_TONES.length] ?? AVATAR_TONES[0]!;
}

export interface CaseHeaderProps {
  detail: ConversationDetail;
  status: QueueStatus;
  /** Operations Assistant mode keeps evidence visible and owner controls absent. */
  readOnly?: boolean;
}

export function CaseHeader({ detail, status, readOnly = false }: CaseHeaderProps) {
  const { tenant } = detail;
  const initial = tenant.name.trim().charAt(0).toUpperCase() || '?';
  const tone = avatarToneForName(tenant.name);
  const chip = CHIP_STYLES[status.kind];

  const { snoozeConversation, muteConversation, snoozing, muting } =
    useConversations();
  const isMuted = detail.muted;
  // Whether the snooze is still active is computed server-side at load time
  // (keeps the render pure — no clock reads here).
  const isSnoozed = detail.snoozedActive;

  return (
    <header
      data-testid='inbox-thread-header'
      className='flex items-center gap-4 px-9 py-4'
      style={{
        background: 'var(--panel-clean, #FFFDF6)',
        borderBottom: '1px solid var(--hairline-faint, #EAE0CA)',
      }}
    >
      <span
        aria-hidden='true'
        className='flex items-center justify-center flex-shrink-0'
        style={{
          width: '36px',
          height: '36px',
          borderRadius: '50%',
          background: tone.bg,
          color: tone.fg,
          fontFamily: 'var(--font-sans-operator, system-ui, sans-serif)',
          fontSize: '14px',
          fontWeight: 500,
        }}
      >
        {initial}
      </span>

      <div className='flex-1 min-w-0 flex flex-col gap-0.5'>
        <div className='flex items-baseline gap-3'>
          <h2
            className='truncate'
            style={{
              fontFamily: 'var(--font-serif-display, Georgia, serif)',
              fontStyle: 'italic',
              fontSize: '22px',
              fontWeight: 500,
              color: 'var(--ink, #1B1712)',
              letterSpacing: '-0.005em',
            }}
          >
            {tenant.name}
          </h2>
        </div>
        <div
          className='flex items-center gap-2 text-[11.5px]'
          style={{
            fontFamily: 'var(--font-mono-operator, ui-monospace, monospace)',
            color: 'var(--ink-3, #87796A)',
          }}
        >
          {tenant.phoneE164 ? (
            <span className='num tracking-[0.02em]'>{tenant.phoneE164}</span>
          ) : null}
          {tenant.phoneE164 && (tenant.unitLabel || tenant.propertyName) ? (
            <HeaderDot />
          ) : null}
          {tenant.unitLabel ? (
            <span className='tracking-[0.04em]'>{tenant.unitLabel}</span>
          ) : null}
          {tenant.unitLabel && tenant.propertyName ? <HeaderDot /> : null}
          {tenant.propertyName ? (
            <span className='tracking-[0.04em]'>{tenant.propertyName}</span>
          ) : null}
        </div>
      </div>

      <span
        className='inline-flex items-center gap-1.5 uppercase tracking-[0.08em] flex-shrink-0'
        style={{
          background: chip.bg,
          color: chip.fg,
          border: `1px solid ${chip.border}`,
          borderRadius: '5px',
          padding: '4px 10px',
          fontSize: '10.5px',
          fontFamily: 'var(--font-mono-operator, ui-monospace, monospace)',
          lineHeight: 1.2,
        }}
      >
        <span
          aria-hidden='true'
          style={{
            display: 'inline-block',
            width: '5px',
            height: '5px',
            borderRadius: '50%',
            background: 'currentColor',
            opacity: status.kind === 'review' ? 1 : 0.65,
          }}
        />
        {status.label}
      </span>

      {!readOnly ? (
        <div className='flex items-center gap-2 flex-shrink-0'>
          <SnoozeControl
            isSnoozed={isSnoozed}
            snoozedUntil={detail.snoozedUntil}
            busy={snoozing}
            onSnooze={(iso) => void snoozeConversation(iso)}
            onClear={() => void snoozeConversation(null)}
          />
          <HeaderToggleButton
            dataAction='mute'
            label={muting ? '…' : isMuted ? 'Muted' : 'Mute'}
            active={isMuted}
            disabled={muting}
            onClick={() => void muteConversation(!isMuted)}
          />
        </div>
      ) : null}
    </header>
  );
}

function HeaderDot() {
  return (
    <span
      aria-hidden='true'
      style={{
        display: 'inline-block',
        width: '3px',
        height: '3px',
        borderRadius: '50%',
        background: 'var(--hairline-strong, #C9BC9C)',
        margin: '0 4px',
        transform: 'translateY(-1px)',
      }}
    />
  );
}

function headerButtonStyle(active: boolean): CSSProperties {
  return {
    background: active ? 'var(--neutral-bg, #EFE7D2)' : 'transparent',
    border: '1px solid var(--hairline-faint, #EAE0CA)',
    borderRadius: '5px',
    padding: '4px 10px',
    fontSize: '11px',
    fontFamily: 'var(--font-mono-operator, ui-monospace, monospace)',
    color: active ? 'var(--ink, #1B1712)' : 'var(--ink-3, #87796A)',
    letterSpacing: '0.04em',
    cursor: 'pointer',
  };
}

function HeaderToggleButton({
  dataAction,
  label,
  active,
  disabled,
  onClick,
}: {
  dataAction: string;
  label: string;
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type='button'
      data-action={dataAction}
      disabled={disabled}
      onClick={onClick}
      className='transition-colors'
      style={headerButtonStyle(active)}
    >
      {label}
    </button>
  );
}

const SNOOZE_OPTIONS: { label: string; kind: 'tomorrow' | '3days' | 'nextweek' }[] =
  [
    { label: 'Tomorrow', kind: 'tomorrow' },
    { label: 'In 3 days', kind: '3days' },
    { label: 'Next week', kind: 'nextweek' },
  ];

function snoozeUntilIso(kind: 'tomorrow' | '3days' | 'nextweek'): string {
  const d = new Date();
  if (kind === 'tomorrow') {
    d.setDate(d.getDate() + 1);
    d.setHours(9, 0, 0, 0);
  } else if (kind === '3days') {
    d.setDate(d.getDate() + 3);
  } else {
    d.setDate(d.getDate() + 7);
  }
  return d.toISOString();
}

function formatSnoozeLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function SnoozeControl({
  isSnoozed,
  snoozedUntil,
  busy,
  onSnooze,
  onClear,
}: {
  isSnoozed: boolean;
  snoozedUntil: string | null;
  busy: boolean;
  onSnooze: (untilIso: string) => void;
  onClear: () => void;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    function onDoc(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDoc);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDoc);
    };
  }, [open]);

  if (isSnoozed) {
    return (
      <button
        type='button'
        data-action='snooze'
        disabled={busy}
        onClick={onClear}
        title={
          snoozedUntil
            ? `Snoozed until ${formatSnoozeLabel(snoozedUntil)} — click to wake`
            : undefined
        }
        className='transition-colors'
        style={headerButtonStyle(true)}
      >
        {busy
          ? '…'
          : `Snoozed${snoozedUntil ? ` · ${formatSnoozeLabel(snoozedUntil)}` : ''}`}
      </button>
    );
  }

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <button
        type='button'
        data-action='snooze'
        aria-expanded={open}
        disabled={busy}
        onClick={() => setOpen((o) => !o)}
        className='transition-colors'
        style={headerButtonStyle(false)}
      >
        {busy ? '…' : 'Snooze'}
      </button>
      {open ? (
        <div
          role='menu'
          data-snooze-menu
          style={{
            position: 'absolute',
            top: 'calc(100% + 6px)',
            right: 0,
            zIndex: 30,
            minWidth: '150px',
            background: 'var(--panel-lift, #FFFDF6)',
            border: '1px solid var(--hairline-strong, #C9BC9C)',
            borderRadius: '15px',
            boxShadow: '0 16px 36px rgba(39, 31, 22, 0.16)',
            padding: '6px',
          }}
        >
          {SNOOZE_OPTIONS.map((opt) => (
            <button
              key={opt.kind}
              type='button'
              role='menuitem'
              data-snooze-option={opt.kind}
              onClick={() => {
                setOpen(false);
                onSnooze(snoozeUntilIso(opt.kind));
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'var(--canvas-deep, #E8DEC8)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'transparent';
              }}
              style={{
                display: 'block',
                width: '100%',
                textAlign: 'left',
                background: 'transparent',
                border: 'none',
                borderRadius: '9px',
                padding: '8px 12px',
                fontSize: '12px',
                fontFamily: 'var(--font-sans-operator, system-ui, sans-serif)',
                color: 'var(--ink, #1B1712)',
                cursor: 'pointer',
                transition: 'background 120ms ease',
              }}
            >
              {opt.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
