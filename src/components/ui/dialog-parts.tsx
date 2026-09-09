'use client';

/**
 * Shared dialog primitives — the warm-premium "briefing card" menu standard.
 *
 * Extracted from the Add-tenant dialog so every menu shares one language:
 *   - `DialogHero`  — icon badge + eyebrow + serif title + description.
 *   - `Field`       — label (with optional/required marker) over a control.
 *   - `InputShell`  — elevated field shell with a leading icon + focus ring.
 *   - `TextControl` / `SelectControl` — border-less controls for the shell.
 *
 * DE-VIBE-CODED by design: solid surfaces only (no gradients), no decorative
 * illustrations, no sparkle icons. Colors come from the warm tokens; the
 * primary CTA orange lives in `--primary` (see the Button component). This
 * keeps the polished structure without the generated-UI tells.
 */

import * as React from 'react';
import { ChevronDown, type LucideIcon } from 'lucide-react';

import { DialogTitle } from '@/components/ui/dialog';

/* ------------------------------------------------------------------ */
/* Hero header                                                         */
/* ------------------------------------------------------------------ */

export function DialogHero({
  icon: Icon,
  eyebrow,
  title,
  titleId,
  description,
}: {
  icon: LucideIcon;
  eyebrow: string;
  title: string;
  titleId: string;
  description: React.ReactNode;
}): React.ReactElement {
  return (
    <div className='grid gap-6 border-b border-[var(--hairline-faint)] bg-[var(--panel)] px-8 pt-9 pb-7'>
      <div className='flex flex-col gap-4'>
        <span className='flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--amber-bg-soft)] text-[var(--clay-ink)] ring-1 ring-[var(--clay-border)]'>
          <Icon size={22} strokeWidth={1.8} />
        </span>
        <div className='flex flex-col gap-2'>
          <p className='text-[10px] font-medium uppercase tracking-[0.18em] text-[var(--ink-500)]'>
            {eyebrow}
          </p>
          <DialogTitle
            id={titleId}
            className='font-serif-display text-[30px] leading-[1.05] font-normal tracking-[-0.02em] text-[var(--ink-900)] sm:text-[32px]'
          >
            {title}
          </DialogTitle>
          <p className='max-w-[52ch] text-[13px] leading-relaxed text-[var(--ink-500)]'>
            {description}
          </p>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Form primitives                                                     */
/* ------------------------------------------------------------------ */

export function Field({
  id,
  label,
  optional,
  children,
}: {
  id: string;
  label: string;
  optional?: boolean;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <div className='flex flex-col gap-2'>
      <label
        htmlFor={id}
        className='flex items-baseline gap-1.5 text-[12px] font-medium text-[var(--ink-700)]'
      >
        {label}
        {optional ? (
          <span className='text-[11px] font-normal text-[var(--ink-400)]'>
            optional
          </span>
        ) : (
          <span aria-hidden className='text-[var(--terracotta)]'>
            *
          </span>
        )}
      </label>
      {children}
    </div>
  );
}

export function InputShell({
  icon: Icon,
  children,
}: {
  icon: LucideIcon;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <div className='flex min-h-[52px] items-center gap-2.5 rounded-xl border border-[var(--hairline-faint)] bg-[var(--panel-lift)] px-3 transition-colors hover:border-[var(--hairline-strong)] focus-within:border-[var(--clay-border)] focus-within:ring-2 focus-within:ring-[var(--clay-border)]/40'>
      <Icon size={16} aria-hidden className='shrink-0 text-[var(--ink-500)]' />
      {children}
    </div>
  );
}

const CONTROL_BASE =
  'border-0 bg-transparent py-2 text-[14px] text-[var(--ink-900)] outline-none placeholder:text-[var(--ink-400)] disabled:cursor-not-allowed disabled:opacity-50';

export function TextControl(
  props: React.InputHTMLAttributes<HTMLInputElement>,
): React.ReactElement {
  const { className, ...rest } = props;
  return (
    <input
      {...rest}
      className={`${CONTROL_BASE} min-w-0 flex-1 ${className ?? ''}`}
    />
  );
}

export function SelectControl({
  className,
  children,
  style,
  ...rest
}: React.SelectHTMLAttributes<HTMLSelectElement>): React.ReactElement {
  return (
    <div className='relative min-w-0 flex-1'>
      <select
        {...rest}
        style={{
          WebkitAppearance: 'none',
          MozAppearance: 'none',
          appearance: 'none',
          ...style,
        }}
        className={`${CONTROL_BASE} w-full cursor-pointer pr-7 ${className ?? ''}`}
      >
        {children}
      </select>
      <ChevronDown
        size={16}
        aria-hidden
        className='pointer-events-none absolute right-0 top-1/2 -translate-y-1/2 text-[var(--ink-500)]'
      />
    </div>
  );
}
