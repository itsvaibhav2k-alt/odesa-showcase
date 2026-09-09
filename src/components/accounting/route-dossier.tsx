'use client';

import { useRouter } from 'next/navigation';
import {
  type KeyboardEvent,
  type ReactElement,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from 'react';

function useMobileSheet(): boolean {
  const [mobile, setMobile] = useState(false);
  useEffect(() => {
    const media = window.matchMedia('(max-width: 760px)');
    const sync = () => setMobile(media.matches);
    sync();
    media.addEventListener('change', sync);
    return () => media.removeEventListener('change', sync);
  }, []);
  return mobile;
}

function trapFocus(event: KeyboardEvent<HTMLElement>) {
  if (event.key !== 'Tab') return;
  const focusable = Array.from(
    event.currentTarget.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ),
  );
  const first = focusable[0];
  const last = focusable.at(-1);
  if (!first || !last) return;
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

export function AccountantRouteDossier({
  open,
  ariaLabel,
  closeHref,
  triggerId,
  children,
}: {
  open: boolean;
  ariaLabel: string;
  closeHref: string;
  triggerId: string | null;
  children: ReactNode;
}): ReactElement | null {
  const router = useRouter();
  const mobile = useMobileSheet();
  const closeRef = useRef<HTMLAnchorElement | null>(null);
  const restoreFocus = useRef(false);
  const lastTriggerId = useRef<string | null>(triggerId);
  const wasOpen = useRef(open);

  const close = () => {
    restoreFocus.current = true;
    router.push(closeHref);
  };

  useEffect(() => {
    if (open) {
      if (triggerId) lastTriggerId.current = triggerId;
      wasOpen.current = true;
      return;
    }
    const closedFromOpenState = wasOpen.current;
    wasOpen.current = false;
    if (!restoreFocus.current && !closedFromOpenState) return;
    restoreFocus.current = false;
    const targetId = lastTriggerId.current;
    lastTriggerId.current = null;
    window.setTimeout(() => {
      if (targetId) document.getElementById(targetId)?.focus();
    }, 0);
  }, [open, triggerId]);

  useEffect(() => {
    if (!open || !mobile) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeRef.current?.focus();
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [mobile, open]);

  if (!open) return null;

  const content = (
    <>
      <a
        ref={closeRef}
        className="accounting-route-dossier-close"
        href={closeHref}
        onClick={(event) => {
          event.preventDefault();
          close();
        }}
      >
        Close dossier
      </a>
      {children}
    </>
  );

  if (!mobile) {
    return (
      <aside className="accounting-route-dossier" aria-label={ariaLabel}>
        {content}
      </aside>
    );
  }

  return (
    <div className="accounting-route-dossier-backdrop">
      <section
        className="accounting-route-dossier accounting-route-dossier-sheet"
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            close();
            return;
          }
          trapFocus(event);
        }}
      >
        {content}
      </section>
    </div>
  );
}
