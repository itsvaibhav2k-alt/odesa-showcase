'use client';

import { useEffect, useRef } from 'react';

function setupMotion(root: HTMLElement) {
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const revealSelectors = [
    '.chapter__head',
    '.portal__head',
    '.rules__boundary',
    '.note',
    '.cta__inner',
    '.demo-stage__top',
    '.demo-console',
  ];
  const sequenceGroups: Array<[string, string]> = [
    ['.trace', '.moment'],
    ['.portal__strip', '.portal__item'],
    ['.briefing', ':scope > *'],
    ['.rules-grid', '.rule'],
    ['.steps', '.step'],
    ['.rows', '.rows__item'],
    ['.fit-grid', ':scope > *'],
    ['.compare', '.compare__col'],
    ['.notfit__list', ':scope > *'],
    ['.ledger-rows', '.ledger-row'],
    ['.faq-list', '.qa'],
    ['.pilot-two', ':scope > *'],
    ['.access-grid', ':scope > *'],
    ['.creed-list', ':scope > *'],
    ['.demo-proof-grid', ':scope > *'],
    ['.demo-explain .rules-grid', '.rule'],
  ];

  const targets = new Set<Element>(root.querySelectorAll(revealSelectors.join(',')));
  sequenceGroups.forEach(([groupSelector, childSelector]) => {
    root.querySelectorAll(groupSelector).forEach((group) => {
      group.querySelectorAll<HTMLElement>(childSelector).forEach((child, index) => {
        child.style.setProperty('--reveal-delay', `${Math.min(index * 55, 275)}ms`);
        targets.add(child);
      });
    });
  });
  targets.forEach((target) => target.classList.add('motion-reveal'));

  const loadTargets = [
    ...root.querySelectorAll('.masthead'),
    ...root.querySelectorAll('.hero__content > *, .page-hero__inner > *, .demo-hero__copy > *'),
    ...root.querySelectorAll('.hero__proof, .page-hero__band, .demo-hero__art'),
  ];
  loadTargets.forEach((target, index) => {
    target.classList.add('motion-load');
    (target as HTMLElement).style.setProperty('--load-delay', `${Math.min(index * 65, 390)}ms`);
  });
  root.classList.add('motion-ready');

  if (reduceMotion || !('IntersectionObserver' in window)) {
    targets.forEach((target) => target.classList.add('is-revealed'));
    loadTargets.forEach((target) => target.classList.add('is-revealed'));
    return () => undefined;
  }

  const frame = requestAnimationFrame(() => {
    requestAnimationFrame(() => loadTargets.forEach((target) => target.classList.add('is-revealed')));
  });
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('is-revealed');
        observer.unobserve(entry.target);
      });
    },
    { rootMargin: '0px 0px -7% 0px', threshold: 0.06 }
  );
  targets.forEach((target) => observer.observe(target));
  return () => {
    cancelAnimationFrame(frame);
    observer.disconnect();
  };
}

function setupPilotForm(root: HTMLElement) {
  const form = root.querySelector<HTMLFormElement>('.access__form');
  const status = root.querySelector<HTMLElement>('.access__sent');
  if (!form || !status) return () => undefined;

  const submit = async (event: SubmitEvent) => {
    event.preventDefault();
    const button = form.querySelector<HTMLButtonElement>('button[type="submit"]');
    const data = new FormData(form);
    const email = String(data.get('email') ?? '').trim();
    const fullName = String(data.get('name') ?? '').trim();
    const note = String(data.get('note') ?? '').trim();
    const parsedUnits = Number.parseInt(String(data.get('units') ?? ''), 10);
    if (!form.reportValidity() || !email || button?.disabled) return;

    form.setAttribute('aria-busy', 'true');
    if (button) {
      button.disabled = true;
      button.textContent = 'Requesting access…';
    }
    status.classList.remove('is-visible');
    status.textContent = '';
    status.dataset.state = '';

    try {
      const response = await fetch('/api/waitlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          fullName: fullName || undefined,
          unitCount: Number.isFinite(parsedUnits) && parsedUnits > 0 ? parsedUnits : undefined,
          currentStack: note || undefined,
          source: 'night-garden-pilot',
        }),
      });
      let result: { ok?: boolean; duplicate?: boolean; error?: string } = {};
      try {
        result = (await response.json()) as typeof result;
      } catch {
        // A proxy or transient server failure can return HTML. Treat it as a
        // failed request; never infer success from the response body shape.
      }
      if (!response.ok || !result.ok) {
        throw new Error(
          response.status === 400
            ? 'Check your email and unit count, then try again.'
            : 'We could not save your request. Please try again.',
        );
      }
      form.hidden = true;
      status.textContent = result.duplicate
        ? 'You are already on the pilot list. We will follow up to begin intake.'
        : 'Thanks. Your request was received. We will follow up to begin intake with your rules first.';
      status.dataset.state = 'success';
      status.classList.add('is-visible');
      status.focus();
    } catch (error) {
      status.textContent = error instanceof Error ? error.message : 'Could not submit your request. Please try again.';
      status.dataset.state = 'error';
      status.classList.add('is-visible');
      status.focus();
      if (button) {
        button.disabled = false;
        button.textContent = 'Request access';
      }
    } finally {
      form.setAttribute('aria-busy', 'false');
    }
  };

  form.addEventListener('submit', submit);
  return () => form.removeEventListener('submit', submit);
}

function loadDemoScript(root: HTMLElement) {
  if (!root.classList.contains('page-demo')) return () => undefined;
  const script = document.createElement('script');
  script.src = '/night-garden/demo.js?v=20260715';
  script.async = true;
  root.appendChild(script);
  return () => script.remove();
}

export default function NightGardenShell({
  html,
  pageClass,
}: {
  html: string;
  pageClass: string;
}) {
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const cleanups = [setupMotion(root), setupPilotForm(root), loadDemoScript(root)];
    return () => cleanups.forEach((cleanup) => cleanup());
  }, [pageClass]);

  return (
    <div
      ref={rootRef}
      className={`ng-site ${pageClass}`}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
