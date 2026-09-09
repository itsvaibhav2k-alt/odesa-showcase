export type AccountantRawSearch = Record<
  string,
  string | string[] | undefined
>;

function sortedEntries(params: URLSearchParams): string[][] {
  return [...params.entries()]
    .map(([key, value]) => [key, value])
    .sort(
      (a, b) =>
        a[0].localeCompare(b[0]) || a[1].localeCompare(b[1]),
    );
}

function rawParams(raw: AccountantRawSearch): URLSearchParams {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(raw)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const item of value) params.append(key, item);
    } else {
      params.append(key, value);
    }
  }
  return params;
}

/**
 * Compare semantic query pairs, not their input ordering. Duplicate and
 * unknown raw keys remain visible to the comparison and therefore force a
 * redirect to the single-valued allowlisted canonical query.
 */
export function canonicalAccountantHref(
  pathname: string,
  raw: AccountantRawSearch,
  canonical: URLSearchParams,
): { changed: boolean; href: string } {
  const query = canonical.toString();
  const href = query ? `${pathname}?${query}` : pathname;
  return {
    changed:
      JSON.stringify(sortedEntries(rawParams(raw))) !==
      JSON.stringify(sortedEntries(canonical)),
    href,
  };
}

export type AccountantRouteDecision =
  | { kind: 'not_found' }
  | { kind: 'redirect'; href: string }
  | { kind: 'render'; href: string };

/**
 * Route-level ordering for Accountant query state. A direct property id that
 * the authoritative scope does not contain is resolved before canonical URL
 * cleanup. Otherwise dropping that id could broaden a denied request into an
 * all-properties render on the redirect.
 */
export function resolveAccountantRouteDecision(
  pathname: string,
  raw: AccountantRawSearch,
  canonical: URLSearchParams,
  unknownPropertyRequested: boolean,
): AccountantRouteDecision {
  if (unknownPropertyRequested) return { kind: 'not_found' };
  const target = canonicalAccountantHref(pathname, raw, canonical);
  return target.changed
    ? { kind: 'redirect', href: target.href }
    : { kind: 'render', href: target.href };
}
