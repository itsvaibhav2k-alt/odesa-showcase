import { describe, expect, it } from 'vitest';

import {
  canonicalAccountantHref,
  resolveAccountantRouteDecision,
} from '../canonical-search';
import { normalizeAccountantView } from '../view-state';

describe('Accountant canonical search URLs', () => {
  it('does not redirect for an exact canonical query regardless of key order', () => {
    expect(
      canonicalAccountantHref(
        '/rent',
        {
          q: 'Marcus',
          property: 'property-1',
          cycle: '2026-08',
        },
        new URLSearchParams({
          cycle: '2026-08',
          property: 'property-1',
          q: 'Marcus',
        }),
      ),
    ).toEqual({
      changed: false,
      href: '/rent?cycle=2026-08&property=property-1&q=Marcus',
    });
  });

  it('drops duplicate, stale, empty, and unknown state in one canonical redirect', () => {
    expect(
      canonicalAccountantHref(
        '/today',
        {
          cycle: ['2026-08', '2026-09'],
          property: '',
          selected: 'filtered-out-id',
          page: '999',
          surprise: 'private-mode',
        },
        new URLSearchParams({ cycle: '2026-08' }),
      ),
    ).toEqual({
      changed: true,
      href: '/today?cycle=2026-08',
    });
  });

  it('returns a path-only href for a canonical empty document query', () => {
    expect(
      canonicalAccountantHref(
        '/documents',
        { type: 'bogus', page: '-4' },
        new URLSearchParams(),
      ),
    ).toEqual({ changed: true, href: '/documents' });
  });

  it('returns not-found before canonicalization can broaden an unknown property', () => {
    const raw = { property: 'property-revoked' };
    const normalized = normalizeAccountantView(
      raw,
      [],
      new Date('2026-08-12T12:00:00.000Z'),
      40,
      new Set(['property-authorized']),
    );

    expect(
      resolveAccountantRouteDecision(
        '/today',
        raw,
        normalized.searchParams,
        normalized.unknownPropertyRequested,
      ),
    ).toEqual({ kind: 'not_found' });
  });
});
